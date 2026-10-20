import { useState } from 'react'
import { api, ApiError } from '../../api'
import { useCabinet } from '../CabinetContext'
import { Card, SectionTitle } from '../ui'

const input = 'h-12 w-full rounded-xl bg-surface-2 px-3.5 text-[15px] outline-none ring-1 ring-white/5 focus:ring-2 focus:ring-accent'

export default function AccountSecurity() {
  const { signOut, demo } = useCabinet()
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function change(e: React.FormEvent) {
    e.preventDefault(); setError('')
    if (password.length < 8) return setError('Новый пароль должен содержать минимум 8 символов.')
    if (password !== confirm) return setError('Новые пароли не совпадают.')
    setBusy(true)
    try { await api.changePassword(current, password); await signOut() }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Не удалось изменить пароль.'); setBusy(false) }
  }
  async function logoutAll() {
    setBusy(true); setError('')
    try { await api.logoutAll(); await signOut() }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Не удалось завершить сеансы.'); setBusy(false) }
  }
  return <Card span={12}>
    <SectionTitle>Безопасность аккаунта</SectionTitle>
    <p className="mb-3 text-[13px] text-muted">Смена пароля завершит все сеансы. Затем войдите с новым паролем.</p>
    <form onSubmit={change} className="max-w-xl space-y-3">
      <label className="block text-[13px] text-muted">Текущий пароль<input className={input} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required maxLength={1024} /></label>
      <label className="block text-[13px] text-muted">Новый пароль<input className={input} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={1024} /></label>
      <label className="block text-[13px] text-muted">Повторите новый пароль<input className={input} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} maxLength={1024} /></label>
      {error && <p role="alert" className="text-[13px] text-accent">{error}</p>}
      <button disabled={busy || demo} className="h-11 rounded-xl bg-fill px-5 text-[14px] font-semibold text-white disabled:opacity-35">{busy ? 'Подождите…' : 'Изменить пароль'}</button>
    </form>
    <button type="button" disabled={busy || demo} onClick={logoutAll} className="mt-4 h-11 rounded-xl bg-surface-2 px-5 text-[14px] font-semibold text-accent disabled:opacity-35">Выйти со всех устройств</button>
  </Card>
}
