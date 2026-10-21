import { useEffect, useState, type ReactNode } from 'react'
import dict from '../../data/dictionaries.json'
import type { Status } from '../../types/conveyor'
import { Badge, type Tone } from '../ui'

// Общие кусочки экранов конвейера: поля ввода, статусы, справочники.

export const input = 'h-12 w-full rounded-xl bg-surface-2 px-3.5 text-[15px] text-text outline-none ring-1 ring-white/5 placeholder:text-muted focus:ring-2 focus:ring-accent'
export const primaryBtn = 'h-12 rounded-xl bg-fill px-5 text-[15px] font-semibold text-white transition-opacity hover:bg-brand-deep disabled:opacity-35'
export const ghostBtn = 'h-12 rounded-xl bg-surface-2 px-5 text-[15px] font-semibold text-text transition-colors hover:bg-surface-3 disabled:opacity-35'

export const purposes = dict.purposes as Record<string, { title: string; hint: string; plan?: boolean }>
export const memberRoles = dict.member_roles as Record<string, { title: string; needs_authority: boolean }>
export const collateralKinds = dict.collateral_kinds as Record<string, { title: string }>
export const productNames: Record<string, string> = { fast: 'Кредит без залога', secured: 'Кредит с залогом', mortgage: 'Бизнес-ипотека', revolving: 'Кредитная линия', start: '«Старт» (демо-продукт)', gov_guarantee: 'Кредит с господдержкой' }

// Чей сейчас ход: от этого цвет статуса и группа в списке заявок
export type Move = 'you' | 'bank' | 'done'
export const whoseMove = (s: Status): Move =>
  (['draft', 'info_requested', 'approved', 'counter_offer', 'signing'] as Status[]).includes(s) ? 'you'
    : (['submitted', 'checking', 'scoring', 'manual_review'] as Status[]).includes(s) ? 'bank' : 'done'
const tone = (s: Status): Tone => s === 'funded' ? 'ok' : s === 'declined' ? 'bad' : { you: 'action', bank: 'bank', done: 'muted' }[whoseMove(s)] as Tone
export const StatusBadge = ({ status, title }: { status: Status; title: string }) => <span className="whitespace-nowrap"><Badge tone={tone(status)} dot>{title}</Badge></span>

export function Label({ text, hint, children, warn }: { text: string; hint?: string; children: ReactNode; warn?: boolean }) {
  return (
    <label className="block text-[13px] text-muted">
      <span className="flex items-baseline justify-between gap-2">{text}{warn && <span className="text-[12px] text-warn">проверьте</span>}</span>
      <div className={`mt-1 rounded-xl ${warn ? 'ring-2 ring-warn/60' : ''}`}>{children}</div>
      {hint && <span className="mt-1 block text-[12px] leading-snug text-muted">{hint}</span>}
    </label>
  )
}

// Деньги с пробелами между разрядами; наружу отдаёт число или null
export function MoneyInput({ value, onChange, id, placeholder }: { value: number | null; onChange: (v: number | null) => void; id?: string; placeholder?: string }) {
  const fmt = (v: number | null) => (v == null ? '' : new Intl.NumberFormat('ru-RU').format(v))
  const [text, setText] = useState(fmt(value))
  useEffect(() => { setText((t) => (Number(t.replace(/\D/g, '')) === value ? t : fmt(value))) }, [value])
  return (
    <div className="relative">
      <input id={id} inputMode="numeric" className={`${input} pr-9 tabular-nums`} value={text} placeholder={placeholder}
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 12)
          const n = digits ? Number(digits) : null
          setText(fmt(n)); onChange(n)
        }} />
      <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-[15px] text-muted">₽</span>
    </div>
  )
}

export function Steps({ items, current }: { items: string[]; current: number }) {
  return (
    <ol className="flex flex-wrap gap-x-5 gap-y-2" aria-label="Шаги">
      {items.map((s, i) => (
        <li key={s} aria-current={i === current ? 'step' : undefined} className={`flex items-center gap-2 text-[14px] ${i === current ? 'font-semibold text-text' : i < current ? 'text-text/70' : 'text-muted'}`}>
          <span className={`flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold ${i < current ? 'bg-ok/20 text-ok' : i === current ? 'bg-fill text-white' : 'bg-surface-2 text-muted'}`}>{i < current ? '✓' : i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  )
}

export const ErrorText = ({ children }: { children: ReactNode }) => children ? <p role="alert" className="text-[14px] leading-snug text-accent">{children}</p> : null

export const dateRu = (iso: string) => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })
