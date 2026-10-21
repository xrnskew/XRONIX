import { useState } from 'react'
import { api, ApiError } from '../../api'
import { useCabinet } from '../CabinetContext'
import { Card } from '../ui'

const input = 'h-12 w-full rounded-xl bg-surface-2 px-3.5 text-[15px] outline-none ring-1 ring-white/5 focus:ring-2 focus:ring-accent'

// Безопасность — два пункта-строки внизу профиля. Форма смены пароля раскрывается по нажатию:
// большую форму из трёх полей на экране профиля никто не ищет, пока не нужен пароль.
export default function AccountSecurity() {
  const { signOut, demo } = useCabinet()
  const [open, setOpen] = useState(false)
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
  const rowBtn = 'h-10 shrink-0 rounded-xl bg-surface-2 px-4 text-[14px] font-semibold transition-colors hover:bg-surface-3 disabled:opacity-35'
  return (
    <Card span={12} className="!p-0">
      <h2 className="sr-only">Безопасность аккаунта</h2>
      <div className="flex items-center justify-between gap-4 px-4 py-3.5 sm:px-5">
        <div className="min-w-0"><div className="text-[15px] font-medium">Пароль</div><div className="text-[13px] text-muted">После смены войдите заново на всех устройствах</div></div>
        <button type="button" aria-expanded={open} onClick={() => { setOpen(!open); setError('') }} disabled={demo} className={rowBtn}>{open ? 'Отмена' : 'Изменить'}</button>
      </div>
      {open && (
        <form onSubmit={change} className="appear space-y-3 border-t border-white/5 px-4 py-4 sm:px-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="block text-[13px] text-muted">Текущий пароль<input className={`${input} mt-1`} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required maxLength={1024} /></label>
            <label className="block text-[13px] text-muted">Новый пароль<input className={`${input} mt-1`} type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={1024} /></label>
            <label className="block text-[13px] text-muted">Повторите новый<input className={`${input} mt-1`} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} maxLength={1024} /></label>
          </div>
          {error && <p role="alert" className="text-[13px] text-accent">{error}</p>}
          <button disabled={busy} className="h-11 rounded-xl bg-fill px-5 text-[14px] font-semibold text-white disabled:opacity-35">{busy ? 'Подождите…' : 'Сменить пароль'}</button>
        </form>
      )}
      <div className="flex items-center justify-between gap-4 border-t border-white/5 px-4 py-3.5 sm:px-5">
        <div className="min-w-0"><div className="text-[15px] font-medium">Сеансы</div><div className="text-[13px] text-muted">Завершить вход на других устройствах</div></div>
        <button type="button" disabled={busy || demo} onClick={logoutAll} className={`${rowBtn} text-accent`}>Выйти везде</button>
      </div>
      {!open && error && <p role="alert" className="px-4 pb-3 text-[13px] text-accent sm:px-5">{error}</p>}
    </Card>
  )
}
