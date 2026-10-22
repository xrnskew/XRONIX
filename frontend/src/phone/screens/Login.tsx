import { useContext, useState } from 'react'
import { Button, Conveyor, Logo, Wide } from '../ui'
import { useCabinet } from '../CabinetContext'
import { ApiError, USE_MOCKS } from '../../api'
import { DEMO_ANALYST, DEMO_CLIENT, DEMO_PASSWORD } from '../../api/demoAccounts'

const points = ['План запуска по вашей идее', 'Сколько нужно денег и откуда взять', 'Кредит, который бизнес потянет']
const field = 'h-[52px] w-full rounded-2xl bg-surface px-4 text-[16px] text-text outline-none ring-1 ring-white/5 placeholder:text-muted focus:ring-2 focus:ring-accent'

const DEMO_ROLES = [
  { email: DEMO_CLIENT.email, role: 'Клиент', name: DEMO_CLIENT.name, hint: 'Предприниматель: чат, план, заявка на кредит' },
  { email: DEMO_ANALYST.email, role: 'Аналитик банка', name: DEMO_ANALYST.name, hint: 'Рабочее место: очередь заявок и решения' },
]

export default function Login() {
  const { signIn, signUp, notice } = useCabinet()
  const wide = useContext(Wide)
  const conveyorOn = useContext(Conveyor) // рабочая версия /app; в телефоне на презентации выбора роли нет
  // В рабочей версии вход начинается с выбора: Клиент, Аналитик банка или Новый пользователь
  const [mode, setMode] = useState<'choose' | 'login' | 'register'>(conveyorOn ? 'choose' : 'login')
  const [name, setName] = useState('')
  const [email, setEmail] = useState(USE_MOCKS ? DEMO_CLIENT.email : '')
  const [pass, setPass] = useState(USE_MOCKS ? DEMO_PASSWORD : '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const reg = mode === 'register'
  const demo = (e: string) => { setError(null); setBusy(true); signIn(e, DEMO_PASSWORD).catch((err) => { setError(err instanceof ApiError ? err.message : 'Не удалось войти. Попробуйте ещё раз.'); setBusy(false) }) }

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


  if (mode === 'choose') return (
    <div className={wide ? 'w-full' : 'relative flex min-h-full flex-col px-6 pb-10'}>
      <div className={wide ? 'mb-8' : 'mb-auto shrink-0 pb-6 pt-12'}>
        {!wide && <Logo size={56} />}
        <h1 className={`font-display font-semibold leading-tight tracking-tight ${wide ? 'text-[30px]' : 'mt-5 text-[28px]'}`}>Кабинет предпринимателя</h1>
        <p className="mt-2 text-[15px] text-text/70">Выберите, как войти. Данные демо-аккаунтов синтетические.</p>
      </div>
      <div className="relative space-y-3">
        {(error || notice) && <p role="alert" className="rounded-xl bg-accent/12 px-3.5 py-2.5 text-[14px] leading-snug text-accent">{error ?? notice}</p>}
        {DEMO_ROLES.map((r) => (
          <button key={r.email} type="button" disabled={busy} onClick={() => demo(r.email)}
            className="card-ring flex w-full items-center justify-between gap-3 rounded-2xl bg-surface px-5 py-4 text-left transition-colors hover:bg-surface-2 disabled:opacity-50">
            <span><span className="block text-[17px] font-semibold">{r.role}</span><span className="block text-[13px] text-muted">{r.hint}</span></span>
            <span className="text-muted" aria-hidden>→</span>
          </button>
        ))}
        <button type="button" disabled={busy} onClick={() => { setMode('register'); setError(null); setName(''); setEmail(''); setPass('') }}
          className="flex w-full items-center justify-between gap-3 rounded-2xl bg-fill px-5 py-4 text-left text-white transition-colors hover:bg-brand-deep disabled:opacity-50">
          <span><span className="block text-[17px] font-semibold">Новый пользователь</span><span className="block text-[13px] text-white/75">Создать свой аккаунт за минуту</span></span>
          <span aria-hidden>→</span>
        </button>
        <button type="button" className="h-10 w-full text-center text-[14px] text-muted" onClick={() => { setMode('login'); setError(null) }}>Уже есть аккаунт? Войти по почте</button>
      </div>
    </div>
  )

  return (
    <form className={wide ? 'w-full' : 'relative flex min-h-full flex-col px-6 pb-10'} onSubmit={submit} noValidate>
      {wide ? (
        <div className="mb-8">
          <h1 className="font-display text-[30px] font-semibold leading-tight tracking-tight">{reg ? 'Создайте аккаунт' : 'Вход в кабинет'}</h1>
          <p className="mt-2 text-[15px] text-text/70">{reg ? 'Займёт минуту. Потом ИИ задаст пару вопросов о вас.' : 'Планы и диалоги сохраняются в аккаунте.'}</p>
        </div>
      ) : (
        <>
          <div className="pointer-events-none absolute -top-24 left-1/2 h-[380px] w-[380px] -translate-x-1/2 rounded-full bg-accent/25 blur-[90px]" aria-hidden />
          <div className="relative mb-auto shrink-0 pb-6 pt-12">
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
        </>
      )}
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
        {conveyorOn && <button type="button" className="h-10 w-full text-center text-[14px] text-muted" onClick={() => { setMode('choose'); setError(null) }}>← Назад к выбору</button>}
        {USE_MOCKS && !reg && !conveyorOn && <p className="text-center text-[12px] text-muted">Демо-аккаунт уже заполнен</p>}
      </div>
    </form>
  )
}
