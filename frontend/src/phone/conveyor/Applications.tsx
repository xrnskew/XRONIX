import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { conveyor } from '../../api/conveyor'
import type { ApplicationListItem, FeedItem } from '../../types/conveyor'
import { rub } from '../../lib/format'
import { Card, Screen, Skeleton } from '../ui'
import { ErrorText, StatusBadge, dateRu, ghostBtn, primaryBtn, productNames, whoseMove, type Move } from './parts'
import { MiniTrack } from './Track'

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
  useEffect(() => {
    const load = () => conveyor.listApplications().then(setItems).catch(() => setError('Не удалось загрузить заявки.'))
    load()
    const t = setInterval(load, 5000) // статусы меняются сами
    return () => clearInterval(t)
  }, [])

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
      {items?.map((f) => (
        <Card key={f.id} span={12} className={f.read ? '' : 'ring-1 ring-accent/40'}>
          <div className="flex items-start justify-between gap-3">
            <div className="text-[15px] font-semibold">{f.title}</div>
            <span className="shrink-0 text-[12px] text-muted">{dateRu(f.created_at)}</span>
          </div>
          <p className="mt-1 text-[14px] leading-snug text-text/80">{f.text}</p>
          {f.application_id && <Link to={`/applications/${f.application_id}`} className="mt-2 inline-block text-[14px] font-medium text-accent underline-offset-2 hover:underline">Открыть заявку</Link>}
        </Card>
      ))}
    </Screen>
  )
}
