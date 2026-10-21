import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { conveyor } from '../../api/conveyor'
import type { ApplicationListItem, FeedItem } from '../../types/conveyor'
import { rub } from '../../lib/format'
import { Card, Screen, Skeleton } from '../ui'
import { ErrorText, StatusBadge, dateRu, ghostBtn, primaryBtn, productNames, whoseMove, type Move } from './parts'
import { MiniTrack } from './Track'
import { usePolling } from '../../lib/usePolling'

const GROUPS: { move: Move; title: string }[] = [
  { move: 'you', title: 'Нужно ваше действие' },
  { move: 'bank', title: 'В работе у банка' },
  { move: 'done', title: 'Завершены' },
]

function AppCard({ a }: { a: ApplicationListItem }) {
  return (
    <Link to={`/applications/${a.id}`} data-span={6} className="card-ring group block rounded-[22px] bg-surface p-4 transition-[background-color,transform] duration-200 hover:bg-surface-2 active:scale-[.99] sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <span className="whitespace-nowrap text-[12px] text-muted tabular-nums">{a.number}</span>
        <StatusBadge status={a.status} title={a.status_title} />
      </div>
      <div className="mt-2 line-clamp-2 text-[16px] font-semibold leading-snug">{a.company_name}</div>
      <div className="mt-3 flex flex-wrap items-baseline gap-x-2">
        <span className="font-display text-[22px] font-semibold tabular-nums tracking-tight">{rub(a.amount_rub)}</span>
        <span className="text-[14px] text-muted">{productNames[a.product_id]}</span>
      </div>
      <div className="mt-4"><MiniTrack status={a.status} /></div>
      <div className="mt-2 text-[12px] text-muted">Обновлено {dateRu(a.updated_at)}</div>
    </Link>
  )
}

export function Applications() {
  const [items, setItems] = useState<ApplicationListItem[] | null>(null)
  const [error, setError] = useState('')
  const load = () => conveyor.listApplications().then(setItems).catch(() => setError('Не удалось загрузить заявки.'))
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  usePolling(load, 5000) // статусы меняются сами

  return (
    <Screen title="Заявки" sub="Все заявки ваших компаний и их статус">
      <ErrorText>{error}</ErrorText>
      {!items && !error && <Skeleton />}
      {items?.length === 0 && (
        <Card span={12}>
          <p className="text-[16px] font-semibold">Заявок пока нет</p>
          <p className="mt-1 text-[14px] text-muted">Ещё выбираете бизнес — расскажите об идее в чате, посчитаем план и подберём кредит. Бизнес уже есть — укажите ИНН компании и подайте заявку.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link to="/chat" className={`${primaryBtn} inline-flex items-center`}>Подобрать бизнес</Link>
            <Link to="/new" className={`${ghostBtn} inline-flex items-center`}>Новая заявка</Link>
          </div>
        </Card>
      )}
      {items && items.length > 0 && GROUPS.map((g) => {
        const list = items.filter((a) => whoseMove(a.status) === g.move).sort((x, y) => y.updated_at.localeCompare(x.updated_at))
        if (!list.length) return null
        return [
          <h2 key={g.move} className="flex items-baseline gap-2 pt-2 text-[15px] font-semibold first:pt-0">
            {g.title}<span className="text-[13px] font-normal text-muted tabular-nums">{list.length}</span>
          </h2>,
          ...list.map((a) => <AppCard key={a.id} a={a} />),
        ]
      })}
    </Screen>
  )
}

// Тип события — иконка и цвет: решение банка, запрос данных, смена статуса, подсказка
const KIND: Record<FeedItem['kind'], { d: string; cls: string }> = {
  offer: { d: 'M5 12.5l4.5 4.5L19 7.5', cls: 'bg-ok/15 text-ok' },
  info_request: { d: 'M12 8v5M12 16.5v.5M12 3l9 16H3z', cls: 'bg-accent/15 text-accent-soft' },
  status_change: { d: 'M4 12h12M12 6l6 6-6 6', cls: 'bg-steel/15 text-steel' },
  tip: { d: 'M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0012 3z', cls: 'bg-warn/15 text-warn' },
}
const dayTitle = (iso: string) => {
  const d = new Date(iso), today = new Date(), y = new Date(); y.setDate(today.getDate() - 1)
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  return same(d, today) ? 'Сегодня' : same(d, y) ? 'Вчера' : d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })
}
function byDay(items: FeedItem[]) {
  const groups = new Map<string, FeedItem[]>()
  for (const f of items) { const k = dayTitle(f.created_at); groups.set(k, [...(groups.get(k) ?? []), f]) }
  return [...groups.entries()]
}
const time = (iso: string) => new Date(iso).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })

function FeedRow({ f }: { f: FeedItem }) {
  const k = KIND[f.kind] ?? KIND.status_change
  const body = (
    <div className="flex gap-3.5 px-4 py-3.5 sm:px-5">
      <span className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${k.cls}`} aria-hidden>
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d={k.d} /></svg>
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <div className={`text-[15px] leading-snug ${f.read ? 'font-medium' : 'font-semibold'}`}>{f.title}</div>
          <span className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted tabular-nums">
            {!f.read && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-label="Новое" />}{time(f.created_at)}
          </span>
        </div>
        <p className="mt-0.5 text-[14px] leading-snug text-text/70">{f.text}</p>
      </div>
    </div>
  )
  return <li>{f.application_id ? <Link to={`/applications/${f.application_id}`} className="block transition-colors hover:bg-white/[.03]">{body}</Link> : body}</li>
}

export function Feed() {
  const [items, setItems] = useState<FeedItem[] | null>(null)
  useEffect(() => {
    conveyor.feed().then((l) => {
      setItems(l)
      const unread = l.filter((f) => !f.read).map((f) => f.id)
      if (unread.length) conveyor.markRead(unread).catch(() => {})
    }).catch(() => setItems([]))
  }, [])
  return (
    <Screen title="Лента" sub="События по заявкам и подсказки для вашего бизнеса">
      {!items && <Skeleton />}
      {items?.length === 0 && <Card span={12}><p className="text-[15px] text-muted">Здесь появятся новости по вашим заявкам: решения банка, запросы данных, подсказки.</p></Card>}
      {items && byDay(items).map(([day, list]) => (
        <section key={day} data-span={12}>
          <h2 className="mb-2 px-1 text-[13px] font-medium text-muted">{day}</h2>
          <ul className="card-ring divide-y divide-white/5 overflow-hidden rounded-[22px] bg-surface">
            {list.map((f) => <FeedRow key={f.id} f={f} />)}
          </ul>
        </section>
      ))}
    </Screen>
  )
}
