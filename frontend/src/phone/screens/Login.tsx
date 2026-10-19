import { useState } from 'react'
import { Button } from '../ui'

export default function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('demo@xronix.ru')
  const [pass, setPass] = useState('demo1234')
  const field = 'h-12 w-full rounded-2xl bg-surface px-4 text-[15px] text-text outline-none placeholder:text-muted focus:ring-2 focus:ring-accent'
  return (
    <form
      className="flex h-full flex-col justify-end gap-3 px-5 pb-10"
      onSubmit={(e) => { e.preventDefault(); onDone() }}
    >
      <div className="mb-auto pt-16">
        <div className="font-display text-[34px] font-semibold leading-none">XRONIX</div>
        <p className="mt-3 max-w-[260px] text-[15px] leading-snug text-muted">Расскажите идею бизнеса. Получите план и подходящий кредит.</p>
      </div>
      <label className="sr-only" htmlFor="email">Почта</label>
      <input id="email" className={field} value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Почта" autoComplete="email" />
      <label className="sr-only" htmlFor="pass">Пароль</label>
      <input id="pass" className={field} value={pass} onChange={(e) => setPass(e.target.value)} type="password" placeholder="Пароль" autoComplete="current-password" />
      <Button>Войти</Button>
      <p className="text-center text-[13px] text-muted">Демо-аккаунт уже заполнен</p>
    </form>
  )
}
