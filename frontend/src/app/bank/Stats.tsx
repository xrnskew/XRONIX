import { useEffect, useState } from 'react'
import { errorText } from '../../api'
import { bank } from '../../api/bank'
import type { BankStats, Status } from '../../types/conveyor'
import { decimal } from '../../lib/format'
import { Card, Screen, SectionTitle, Skeleton, Stat } from '../../phone/ui'
import { ErrorText, whoseMove } from '../../phone/conveyor/parts'
import { statuses } from './shared'

// Сводка: заявки по статусам, доля автоматических решений, время до решения
// Цвет полосы — чей ход по заявкам в этом статусе, как у значков статуса
const barTone = (k: Status) => k === 'funded' ? 'bg-ok' : k === 'declined' ? 'bg-accent/45' : { you: 'bg-accent', bank: 'bg-steel', done: 'bg-muted/60' }[whoseMove(k)]
const BAR_LEGEND: [string, string][] = [['bg-steel', 'у банка'], ['bg-accent', 'у клиента'], ['bg-ok', 'выдано'], ['bg-accent/45', 'отказ'], ['bg-muted/60', 'закрыто']]

export default function Stats() {
  const [s, setS] = useState<BankStats | null>(null)
  const [error, setError] = useState('')
  useEffect(() => { bank.stats().then(setS).catch((e) => setError(errorText(e))) }, [])
  if (!s) return <Screen title="Сводка">{error ? <ErrorText>{error}</ErrorText> : <Skeleton />}</Screen>
  const order: Status[] = ['submitted', 'checking', 'scoring', 'manual_review', 'info_requested', 'approved', 'counter_offer', 'signing', 'funded', 'declined', 'withdrawn', 'cancelled']
  const total = Object.values(s.by_status).reduce((a, b) => a + (b ?? 0), 0)
  const max = Math.max(1, ...Object.values(s.by_status).map((v) => v ?? 0))
  return (
    <Screen title="Сводка" sub="Все поданные заявки">
      <Card span={12}>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Заявок подано" value={String(total)} />
          <Stat label="Ждут решения специалиста" value={String(s.by_status.manual_review ?? 0)} tone={s.by_status.manual_review ? 'warn' : undefined} />
          <Stat label="Решено автоматически" value={`${Math.round(s.auto_decision_share * 100)}%`} />
          <Stat label="Среднее время до решения" value={s.avg_minutes_to_decision == null ? '—' : `${decimal(s.avg_minutes_to_decision)} мин`} />
        </div>
      </Card>
      <Card span={12}>
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3">
          <SectionTitle>По статусам</SectionTitle>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-muted">
            {BAR_LEGEND.map(([cls, t]) => <li key={t} className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${cls}`} aria-hidden />{t}</li>)}
          </ul>
        </div>
        <ul className="space-y-2.5">
          {order.filter((k) => s.by_status[k]).map((k, i) => (
            <li key={k} className="grid grid-cols-[minmax(0,170px)_1fr_40px] items-center gap-3 text-[14px]">
              <span>{statuses[k].title}</span>
              <span className="h-2.5 overflow-hidden rounded-full bg-surface-3"><span className={`fill-in block h-full rounded-full ${barTone(k)}`} style={{ width: `${(s.by_status[k]! / max) * 100}%`, animationDelay: `${i * 60}ms` }} /></span>
              <span className="text-right tabular-nums">{s.by_status[k]}</span>
            </li>
          ))}
        </ul>
      </Card>
    </Screen>
  )
}
