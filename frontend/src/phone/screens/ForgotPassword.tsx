import { useState } from 'react'
import { api, ApiError } from '../../api'

export default function ForgotPassword({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError('')
    try { setMessage((await api.forgotPassword(email.trim())).message) }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Не удалось отправить запрос.') }
    finally { setBusy(false) }
  }
  return <form onSubmit={submit} className="w-full space-y-4 px-4 py-8">
    <h1 className="text-[26px] font-bold">Восстановление пароля</h1>
    <p className="text-[14px] text-muted">Отправим одноразовую ссылку на почту аккаунта. Ссылка действует 15 минут.</p>
    <label className="block text-[13px] text-muted">Почта<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 h-12 w-full rounded-xl bg-surface-2 px-4 text-text outline-none focus:ring-2 focus:ring-accent" /></label>
    {message && <p role="status" className="text-[14px] text-ok">{message}</p>}
    {error && <p role="alert" className="text-[14px] text-accent">{error}</p>}
    <button disabled={busy} className="h-12 w-full rounded-xl bg-fill text-[15px] font-semibold text-white disabled:opacity-35">{busy ? 'Отправляем…' : 'Получить ссылку'}</button>
    <button type="button" onClick={onBack} className="h-10 w-full text-[14px] text-muted">Вернуться ко входу</button>
  </form>
}
