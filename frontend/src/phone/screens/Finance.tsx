import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, Card, Screen, Stat } from '../ui'
import { useCabinet } from '../PlanContext'
import { annuity, rub } from '../../lib/format'

const verdict = {
  ok: { text: 'Кредит подходит', tone: 'ok' as const },
  risky: { text: 'Есть риски', tone: 'warn' as const },
  not_recommended: { text: 'Не рекомендуем', tone: 'bad' as const },
}

export default function Finance() {
  const { plan } = useCabinet()
  const nav = useNavigate()
  const [amount, setAmount] = useState(plan?.credit.amount_rub ?? 1000000)
  const [months, setMonths] = useState(plan?.credit.recommended_term_months ?? 24)

  if (!plan)
    return (
      <Screen title="Финансы и кредит">
        <Card className="space-y-3 text-center">
          <p className="text-[15px] text-muted">Расчёт появится, когда будет готов план.</p>
          <Button onClick={() => nav('/chat')}>Перейти в чат</Button>
        </Card>
      </Screen>
    )

  const { finance: f, credit: c } = plan
  const rate = c.estimated_rate_percent
  const payment = annuity(amount, rate, months)
  const load = Math.round((payment / Math.max(f.monthly_profit_rub, 1)) * 100)
  const v = verdict[c.verdict]

  return (
    <Screen title="Финансы и кредит">
      <Card>
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Нужно на старт" value={rub(f.startup_cost_rub)} />
          <Stat label="Свои средства" value={rub(f.own_funds_rub)} />
          <Stat label="Не хватает" value={rub(f.funding_gap_rub)} tone="bad" />
          <Stat label="Прибыль в месяц" value={rub(f.monthly_profit_rub)} tone="ok" />
        </div>
      </Card>
      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-semibold">Подходящий кредит</h2>
          <span className={`text-[13px] font-medium ${v.tone === 'ok' ? 'text-ok' : v.tone === 'warn' ? 'text-warn' : 'text-accent'}`}>{v.text}</span>
        </div>
        <p className="mt-1 text-[13px] leading-snug text-muted">{c.comment}</p>
      </Card>
      <Card className="space-y-4">
        <h2 className="text-[16px] font-semibold">Калькулятор платежа</h2>
        <Slider label="Сумма" value={amount} min={100000} max={5000000} step={50000} onChange={setAmount} display={rub(amount)} />
        <Slider label="Срок" value={months} min={6} max={60} step={6} onChange={setMonths} display={`${months} мес.`} />
        <div className="grid grid-cols-3 gap-3 border-t border-line pt-3">
          <Stat label={`Ставка (оценка)`} value={`${rate}%`} />
          <Stat label="Платёж" value={rub(payment)} />
          <Stat label="Нагрузка" value={`${load}%`} tone={load > 50 ? 'bad' : load > 35 ? 'warn' : 'ok'} />
        </div>
        <p className="text-[12px] leading-snug text-muted">Нагрузка — доля платежа в ожидаемой прибыли. Итоговый расчёт делает сервер.</p>
      </Card>
    </Screen>
  )
}

function Slider({ label, value, min, max, step, onChange, display }: { label: string; value: number; min: number; max: number; step: number; onChange: (n: number) => void; display: string }) {
  return (
    <label className="block">
      <div className="mb-1 flex justify-between text-[14px]"><span className="text-muted">{label}</span><span className="font-medium">{display}</span></div>
      <input type="range" className="w-full accent-[#ff4538]" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  )
}
