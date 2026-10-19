import { useState } from 'react'
import { Button, Logo } from '../ui'
import { useCabinet } from '../CabinetContext'
import { ApiError, USE_MOCKS } from '../../api'

const points = ['План запуска по вашей идее', 'Сколько нужно денег и откуда взять', 'Кредит, который бизнес потянет']
const field = 'h-[52px] w-full rounded-2xl bg-surface px-4 text-[16px] text-text outline-none ring-1 ring-white/5 placeholder:text-muted focus:ring-2 focus:ring-accent'

export default function Login() {
  const { signIn, signUp, notice } = useCabinet()
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState(USE_MOCKS ? 'demo@xronix.ru' : '')
  const [pass, setPass] = useState(USE_MOCKS ? 'demo1234' : '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const reg = mode === 'register'

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    if (reg && !name.trim()) return setError('Введите имя.')
    if (!/^\S+@\S+\.\S+$/.test(email)) return setError('Проверьте почту: она должна быть вида name@example.ru.')
    if (reg && pass.length < 8) return setError('Пароль должен быть не короче 8 символов.')
    if (!pass) return setError('Введите пароль.')
    setBusy(true)
    try {
      await (reg ? signUp(name.trim(), email.trim(), pass) : signIn(email.trim(), pass))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось войти. Попробуйте ещё раз.')
      setBusy(false)
    }
  }

  return (
    <form className="relative flex h-full flex-col px-6 pb-10" onSubmit={submit} noValidate>
      <div className="pointer-events-none absolute -top-24 left-1/2 h-[380px] w-[380px] -translate-x-1/2 rounded-full bg-accent/25 blur-[90px]" aria-hidden />
      <div className="relative mb-auto pt-12">
        <Logo size={reg ? 44 : 56} />
        <h1 className="mt-5 font-display text-[28px] font-semibold leading-[1.1] tracking-tight">{reg ? 'Создайте аккаунт' : 'Кабинет предпринимателя'}</h1>
        {!reg && (
          <ul className="mt-5 space-y-2.5">
            {points.map((p) => (
              <li key={p} className="flex items-start gap-3 text-[15px] leading-snug text-text/80">
                <svg className="mt-0.5 shrink-0 text-accent" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                {p}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="relative space-y-3">
        {(error || notice) && <p role="alert" className="rounded-xl bg-accent/12 px-3.5 py-2.5 text-[14px] leading-snug text-accent">{error ?? notice}</p>}
        {reg && (<><label className="sr-only" htmlFor="name">Имя</label><input id="name" className={field} value={name} onChange={(e) => setName(e.target.value)} placeholder="Имя" autoComplete="name" /></>)}
        <label className="sr-only" htmlFor="email">Почта</label>
        <input id="email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Почта" autoComplete="email" />
        <label className="sr-only" htmlFor="pass">Пароль</label>
        <input id="pass" className={field} value={pass} onChange={(e) => setPass(e.target.value)} type="password" placeholder={reg ? 'Пароль, от 8 символов' : 'Пароль'} autoComplete={reg ? 'new-password' : 'current-password'} />
        <Button disabled={busy}>{busy ? 'Подождите…' : reg ? 'Создать аккаунт' : 'Войти'}</Button>
        <button type="button" className="h-10 w-full text-center text-[14px] text-muted" onClick={() => { setMode(reg ? 'login' : 'register'); setError(null) }}>
          {reg ? 'Уже есть аккаунт? Войти' : 'Нет аккаунта? Зарегистрироваться'}
        </button>
        {USE_MOCKS && !reg && <p className="text-center text-[12px] text-muted">Демо-аккаунт уже заполнен</p>}
      </div>
    </form>
  )
}
