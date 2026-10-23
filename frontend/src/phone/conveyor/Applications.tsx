import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { conveyor } from '../../api/conveyor'
import type { ApplicationListItem, FeedItem } from '../../types/conveyor'
import { rub } from '../../lib/format'
import { Card, EmptyState, Screen, Skeleton, Widget } from '../ui'
import { SatCard } from '../../landing/Satellites'
import { ErrorText, StatusBadge, dateRu, ghostBtn, primaryBtn, productNames, whoseMove, type Move, statusTone } from './parts'
import { MiniTrack } from './Track'
import { usePolling } from '../../lib/usePolling'

const GROUPS: { move: Move; title: string }[] = [
  { move: 'you', title: 'Нужно ваше действие' },
  { move: 'bank', title: 'В работе у банка' },
  { move: 'done', title: 'Завершены' },
]

const STRIPE: Record<string, string> = { ok: 'before:bg-ok', warn: 'before:bg-warn', bad: 'before:bg-accent', action: 'before:bg-accent-soft', bank: 'before:bg-steel/70', muted: 'before:bg-white/15' }

function AppCard({ a, i }: { a: ApplicationListItem; i: number }) {
  return (
    <Link to={`/applications/${a.id}`} data-span={6} style={{ '--i': i } as React.CSSProperties} className={`stagger card-ring group relative block overflow-hidden rounded-[22px] bg-surface p-4 before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${STRIPE[statusTone(a.status)]}  transition-[background-color,transform] duration-200 hover:bg-surface-2 active:scale-[.99] sm:p-5`}>
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
          <EmptyState icon="M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h4" title="Заявок пока нет" text="Ещё выбираете бизнес — расскажите об идее в чате, посчитаем план и подберём кредит. Бизнес уже есть — укажите ИНН компании и подайте заявку.">
            <Link to="/chat" className={`${primaryBtn} inline-flex items-center`}>Подобрать бизнес</Link>
            <Link to="/new" className={`${ghostBtn} inline-flex items-center`}>Новая заявка</Link>
          </EmptyState>
        </Card>
      )}
      {items && items.length > 0 && (() => {
        const mine = items.filter((a) => whoseMove(a.status) === 'you'), bank = items.filter((a) => whoseMove(a.status) === 'bank'), ok = items.filter((a) => a.status === 'funded' || a.status === 'approved')
        return (
          <div data-span={12} className="flex flex-wrap items-start gap-4">
            <Widget d={0}><SatCard it={{ slot: 'a', kind: 'stat', value: String(items.length), label: `всего заявок, ${bank.length} у банка` }} /></Widget>
            <Widget d={1}>{mine[0]
              ? <Link to={`/applications/${mine[0].id}`} className="block"><SatCard it={{ slot: 'a', kind: 'stat', value: String(mine.length), label: `ждут вас: ${mine[0].number} →` }} /></Link>
              : <SatCard it={{ slot: 'a', kind: 'check', text: 'От вас ничего не нужно' }} />}</Widget>
            {ok.length > 0 && <Widget d={2}><SatCard it={{ slot: 'a', kind: 'stat', value: String(ok.length), label: `одобрено и выдано, ${rub(ok.reduce((n, a) => n + a.amount_rub, 0))}`, ok: true }} /></Widget>}
          </div>
        )
      })()}
      {items && items.length > 0 && GROUPS.map((g, gi) => {
        const before = GROUPS.slice(0, gi).reduce((n, h) => n + items.filter((a) => whoseMove(a.status) === h.move).length, 0)
        const list = items.filter((a) => whoseMove(a.status) === g.move).sort((x, y) => y.updated_at.localeCompare(x.updated_at))
        if (!list.length) return null
        return [
          <h2 key={g.move} className="flex items-baseline gap-2 pt-2 text-[15px] font-semibold first:pt-0">
            {g.title}<span className="text-[13px] font-normal text-muted tabular-nums">{list.length}</span>
          </h2>,
          ...list.map((a, n) => <AppCard key={a.id} a={a} i={before + n} />),
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

function FeedRow({ f, i }: { f: FeedItem; i: number }) {
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
  return <li className="stagger" style={{ '--i': i } as React.CSSProperties}>{f.application_id ? <Link to={`/applications/${f.application_id}`} className="block transition-colors hover:bg-white/[.03]">{body}</Link> : body}</li>
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
      {items?.length === 0 && <Card span={12}><EmptyState icon="M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4" title="Пока тихо" text="Здесь появятся новости по вашим заявкам: решения банка, запросы данных, подсказки." /></Card>}
      {items && byDay(items).map(([day, list]) => (
        <section key={day} data-span={12}>
          <h2 className="mb-2 px-1 text-[13px] font-medium text-muted">{day}</h2>
          <ul className="card-ring divide-y divide-white/5 overflow-hidden rounded-[22px] bg-surface">
            {list.map((f, n) => <FeedRow key={f.id} f={f} i={n} />)}
          </ul>
        </section>
      ))}
    </Screen>
  )
}
