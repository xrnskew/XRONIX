import { useEffect, useState } from 'react'
import { api, ApiError } from '../api'

export default function ResetPassword({ token }: { token: string }) {
  useEffect(() => {
    history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError('')
    if (password !== confirm) return setError('Пароли не совпадают.')
    setBusy(true)
    try { await api.resetPassword(token, password); setDone(true) }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Не удалось изменить пароль.') }
    finally { setBusy(false) }
  }
  return <main className="flex min-h-screen items-center justify-center bg-background px-5 text-text">
    <div className="w-full max-w-md rounded-3xl bg-surface p-7">
      <h1 className="mb-4 text-[26px] font-bold">Новый пароль</h1>
      {done ? <><p role="status">Пароль изменён, прежние сеансы завершены.</p><a href="/app" className="mt-5 inline-block text-accent">Войти в аккаунт</a></> :
        <form onSubmit={submit} className="space-y-4">
          <label className="block">Новый пароль<input className="mt-1 h-12 w-full rounded-xl bg-surface-2 px-4" type="password" autoComplete="new-password" required minLength={8} maxLength={1024} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <label className="block">Повторите пароль<input className="mt-1 h-12 w-full rounded-xl bg-surface-2 px-4" type="password" autoComplete="new-password" required minLength={8} maxLength={1024} value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>
          {error && <p role="alert" className="text-accent">{error}</p>}
          <button disabled={busy} className="h-12 w-full rounded-xl bg-fill font-semibold text-white disabled:bg-surface-3 disabled:text-text/60">{busy ? 'Сохраняем…' : 'Сохранить пароль'}</button>
          <a href="/app" className="block text-center text-[14px] text-muted">Вернуться ко входу</a>
        </form>}
    </div>
  </main>
}
