import { useState } from 'react'
import { Button, Logo } from '../ui'
import { useCabinet } from '../PlanContext'

const points = ['План запуска по вашей идее', 'Сколько нужно денег и откуда взять', 'Кредит, который бизнес потянет']

export default function Login() {
  const { setAuthed } = useCabinet()
  const [email, setEmail] = useState('demo@xronix.ru')
  const [pass, setPass] = useState('demo1234')
  const field = 'h-[52px] w-full rounded-2xl bg-surface px-4 text-[16px] text-text outline-none ring-1 ring-white/5 placeholder:text-muted focus:ring-2 focus:ring-accent'
  return (
    <form className="relative flex h-full flex-col px-6 pb-12" onSubmit={(e) => { e.preventDefault(); setAuthed(true) }}>
      <div className="pointer-events-none absolute -top-24 left-1/2 h-[380px] w-[380px] -translate-x-1/2 rounded-full bg-accent/25 blur-[90px]" aria-hidden />
      <div className="relative mb-auto pt-14">
        <Logo size={56} />
        <h1 className="mt-6 font-display text-[30px] font-semibold leading-[1.1] tracking-tight">Кабинет предпринимателя</h1>
        <ul className="mt-6 space-y-3">
          {points.map((p) => (
            <li key={p} className="flex items-start gap-3 text-[15px] leading-snug text-text/80">
              <svg className="mt-0.5 shrink-0 text-accent" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
              {p}
            </li>
          ))}
        </ul>
      </div>
      <div className="relative space-y-3">
        <label className="sr-only" htmlFor="email">Почта</label>
        <input id="email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Почта" autoComplete="email" />
        <label className="sr-only" htmlFor="pass">Пароль</label>
        <input id="pass" className={field} value={pass} onChange={(e) => setPass(e.target.value)} type="password" placeholder="Пароль" autoComplete="current-password" />
        <Button>Войти</Button>
        <p className="text-center text-[13px] text-muted">Демо-аккаунт уже заполнен</p>
      </div>
    </form>
  )
}
