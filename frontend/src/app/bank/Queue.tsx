import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { errorText } from '../../api'
import { bank } from '../../api/bank'
import type { QueueItem, Status } from '../../types/conveyor'
import { rub } from '../../lib/format'
import { Card, Screen, Skeleton } from '../../phone/ui'
import { ErrorText, StatusBadge, productNames } from '../../phone/conveyor/parts'
import { usePolling } from '../../lib/usePolling'
import { statuses, gradeTone } from './shared'

// Очередь заявок аналитика: фильтры по тому, у кого заявка, сверху — дольше всех ждущие
const FILTERS: { label: string; statuses: Status[] }[] = [
  { label: 'Ждут решения', statuses: ['manual_review'] },
  { label: 'Ждут клиента', statuses: ['info_requested', 'approved', 'counter_offer', 'signing'] },
  { label: 'В обработке системой', statuses: ['submitted', 'checking', 'scoring'] },
  { label: 'Завершены', statuses: ['funded', 'declined', 'withdrawn', 'cancelled'] },
  { label: 'Все', statuses: [] },
]
const EMPTY = ['Заявок, которые ждут решения, нет. Новые появятся здесь сами.', 'Сейчас нет заявок, которые ждут ответа клиента.', 'Система не обрабатывает ни одной заявки.', 'Завершённых заявок пока нет.', 'Заявок пока нет.']
const waited = (m: number) => (m < 60 ? `${m} мин` : m < 1440 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${Math.floor(m / 1440)} дн`)

export default function Queue() {
  const [filter, setFilter] = useState(0)
  const [error, setError] = useState('')
  const nav = useNavigate()
  // Один запрос на все заявки: счётчики вкладок и список считаются на месте, вкладка переключается без ожидания
  const [all, setAll] = useState<QueueItem[] | null>(null)
  const load = () => bank.queue().then((l) => { setAll(l); setError('') }).catch((e) => setError(errorText(e)))
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  usePolling(load, 5000)
  const inFilter = (i: number, q: QueueItem) => !FILTERS[i].statuses.length || FILTERS[i].statuses.includes(q.status)
  const items = all && all.filter((q) => inFilter(filter, q)).sort((a, b) => b.waiting_minutes - a.waiting_minutes)
  return (
    <Screen title="Очередь заявок" sub="Сверху — те, что ждут дольше всех">
      <div data-span={12} className="flex flex-wrap gap-2">
        {FILTERS.map((f, i) => <button key={f.label} onClick={() => setFilter(i)} aria-pressed={filter === i} className={`min-h-9 rounded-full px-3.5 text-[14px] transition-colors ${filter === i ? 'bg-fill text-white' : 'bg-surface-2 hover:bg-surface-3'}`}>{f.label}{all && <span className={`ml-1.5 tabular-nums ${filter === i ? 'text-white/80' : 'text-muted'}`}>{all.filter((q) => inFilter(i, q)).length}</span>}</button>)}
      </div>
      <ErrorText>{error}</ErrorText>
      {!items && !error && <Skeleton />}
      {items?.length === 0 && <Card span={12}><p className="text-[15px] text-muted">{EMPTY[filter]}</p></Card>}
      {items && items.length > 0 && (
        <ul data-span={12} className="space-y-2.5 md:hidden">
          {items.map((q) => (
            <li key={q.id}>
              <Link to={`/bank/${q.id}`} className="card-ring block rounded-[22px] bg-surface p-4 active:bg-surface-2">
                <div className="flex items-center justify-between gap-3 text-[12px] text-muted tabular-nums"><span>{q.number}</span><span>ждёт {waited(q.waiting_minutes)}</span></div>
                <div className="mt-1.5 flex items-start justify-between gap-3">
                  <div className="min-w-0 text-[16px] font-semibold leading-snug">{q.company_name}</div>
                  <span className={`font-display text-[20px] font-semibold leading-none ${gradeTone(q.grade)}`} aria-label={`Класс ${q.grade ?? 'нет'}`}>{q.grade ?? '—'}</span>
                </div>
                <div className="mt-2 text-[14px] tabular-nums">{rub(q.amount_rub)} · {q.term_months} мес. <span className="text-muted">· {productNames[q.product_id]}</span></div>
                <div className="mt-3"><StatusBadge status={q.status} title={statuses[q.status].title} /></div>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {items && items.length > 0 && (
        <div data-span={12} className="card-ring hidden overflow-x-auto rounded-[22px] bg-surface md:block">
          <table className="w-full min-w-[820px] text-left text-[14px]">
            <thead className="text-[13px] text-muted">
              <tr>{['Заявка', 'Компания', 'Продукт', 'Сумма и срок', 'Класс', 'Статус', 'Ждёт'].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody>
              {items.map((q) => (
                <tr key={q.id} onClick={() => nav(`/bank/${q.id}`)} className="cursor-pointer border-t border-white/5 transition-colors hover:bg-surface-2">
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums"><Link to={`/bank/${q.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{q.number}</Link></td>
                  <td className="px-4 py-3"><div className="font-medium">{q.company_name}</div><div className="text-[12px] text-muted tabular-nums">ИНН {q.inn}</div></td>
                  <td className="px-4 py-3">{productNames[q.product_id]}</td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums">{rub(q.amount_rub)}<div className="text-[12px] text-muted">{q.term_months} мес.</div></td>
                  <td className={`px-4 py-3 text-[16px] font-semibold ${gradeTone(q.grade)}`}>{q.grade ?? '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={q.status} title={statuses[q.status].title} /></td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted">{waited(q.waiting_minutes)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Screen>
  )
}
