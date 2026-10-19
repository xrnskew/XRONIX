export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== 'false'
const BASE = import.meta.env.VITE_API_URL ?? ''
const KEY = 'xronix_token'

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 0) {
    super(message)
  }
}

let token: string | null = null
try { if (!USE_MOCKS) token = localStorage.getItem(KEY) } catch { /* хранилище недоступно */ }

export const getToken = () => token
export function setToken(t: string | null) {
  token = t
  if (USE_MOCKS) return
  try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY) } catch { /* хранилище недоступно */ }
}

let unauthorized: (() => void) | null = null
export const onUnauthorized = (fn: (() => void) | null) => { unauthorized = fn }

export async function request<T>(method: string, path: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  let res: Response
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError')
      throw new ApiError('TIMEOUT', 'Сервер отвечает слишком долго. Попробуйте ещё раз.')
    throw new ApiError('NETWORK', 'Нет соединения с сервером. Проверьте интернет и повторите.')
  } finally {
    clearTimeout(timer)
  }

  let data: unknown = null
  try { data = await res.json() } catch { /* пустое тело */ }
  if (!res.ok) {
    const err = (data as { error?: { code?: string; message?: string } } | null)?.error
    const code = err?.code ?? 'INTERNAL'
    if (res.status === 401 && code === 'UNAUTHORIZED') { setToken(null); unauthorized?.() }
    throw new ApiError(code, err?.message ?? 'Что-то пошло не так. Попробуйте позже.', res.status)
  }
  return data as T
}
