export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== 'false'
const BASE = import.meta.env.VITE_API_URL ?? ''
const KEY = 'xronix_token'

export class ApiError extends Error {
  constructor(public code: string, message: string, public status = 0) {
    super(message)
  }
}

// Real sessions are HttpOnly cookies set by the API. Never read or persist their token.
// Remove the legacy credential so an upgrade does not leave it available to scripts.
let token: string | null = null
let authVersion = 0
try { localStorage.removeItem(KEY); sessionStorage.removeItem(KEY) } catch { /* storage unavailable */ }
export const getToken = () => token
export function setToken(t: string | null) { token = USE_MOCKS ? t : null; authVersion++ }

let unauthorized: (() => void) | null = null
export const onUnauthorized = (fn: (() => void) | null) => { unauthorized = fn }

export async function request<T>(method: string, path: string, body?: unknown, timeoutMs = 15_000): Promise<T> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), timeoutMs)
  const version = authVersion
  const form = body instanceof FormData // файлы: браузер сам ставит multipart с границей
  let res: Response
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers: form ? { 'X-Session-Mode': 'cookie' } : { 'Content-Type': 'application/json', 'X-Session-Mode': 'cookie' },
      credentials: 'include',
      body: body === undefined ? undefined : form ? body : JSON.stringify(body),
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
    if (res.status === 401 && code === 'UNAUTHORIZED' && version === authVersion) { setToken(null); if (path !== '/me') unauthorized?.() }
    throw new ApiError(code, err?.message ?? 'Что-то пошло не так. Попробуйте позже.', res.status)
  }
  return data as T
}

// Текст ошибки для человека: сообщение сервера или общее «попробуйте ещё раз»
export const errorText = (e: unknown) => (e instanceof ApiError ? e.message : 'Что-то пошло не так. Попробуйте ещё раз.')
