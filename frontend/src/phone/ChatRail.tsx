import { useNavigate } from 'react-router-dom'
import { useCabinet } from './CabinetContext'
import { Widget } from './ui'
import { SatCard, type Item } from '../landing/Satellites'
import { detectSphere } from '../lib/questionHints'
import { rub, shortParts } from '../lib/format'
import dict from '../data/dictionaries.json'

// Правая колонка чата: карточки в стиле презентации, собираются из самого диалога и плана.
// Что ИИ уже понял — отметки, как только план готов — цифры, прибыль и выручка.
const sphereTitles = (dict as { spheres: Record<string, { title: string }> }).spheres
const money = (s: string) => (/^\s*(нет|ноль|0)\s*$/i.test(s) ? 0 : (() => { const n = Number(s.replace(/[^\d]/g, '')); return s.trim() && n > 0 ? n : null })())
const EXP: Record<string, string> = { none: 'Опыта нет', employee: 'Работал наёмным', owner: 'Был свой бизнес' }
const slot = 'a' as const

export default function ChatRail() {
  const { messages, plan, planId, busy, user } = useCabinet()
  const nav = useNavigate()
  const users = messages.filter((m) => m.role === 'user')
  const given = (id: string) => users.flatMap((m) => m.answers ?? []).filter((a) => a.question_id === id).pop()?.answer
  const sphereKey = detectSphere(users.map((m) => m.text ?? ''))
  const ownAnswer = given('own_funds') != null ? money(given('own_funds')!) : null
  const sphere = plan?.title.split(',')[0] ?? (sphereKey ? sphereTitles[sphereKey]?.title : null) ?? null
  const city = plan?.business.city ?? given('city') ?? user?.city ?? null
  const own = plan ? plan.finance.own_funds_rub : ownAnswer
  const exp = plan?.business.experience ? EXP[plan.business.experience] : given('experience') ?? null
  const missing = [!sphere && 'бизнес', !city && 'город', own == null && 'свои деньги', !exp && 'опыт'].filter(Boolean) as string[]

  // четыре разные карточки по плану (старт, прибыль, выручка, окупаемость) или до трёх, пока план собирается
  const items: (Item | { kind: 'action' })[] = []
  if (plan) {
    const f = plan.finance, start = shortParts(f.startup_cost_rub), profit = shortParts(Math.abs(f.monthly_profit_rub))
    items.push({ slot, kind: 'stat', value: `${start.value} ${start.unit}`, label: 'нужно на старт' })
    items.push({ slot, kind: 'stat', value: `${f.monthly_profit_rub < 0 ? '−' : '+'}${profit.value} ${profit.unit}`, label: 'прибыль в месяц', ok: f.monthly_profit_rub >= 0 })
    if (f.revenue_forecast?.length) items.push({ slot, kind: 'bars', data: f.revenue_forecast })
    if (f.payback_months != null) items.push({ slot, kind: 'chip', text: `Окупится за ${f.payback_months} мес.` })
  } else {
    if (sphere || city) items.push({ slot, kind: 'chip', text: [sphere, city].filter(Boolean).join(' · ') })
    if (busy) items.push({ slot, kind: 'typing' })
    else if (missing.length) items.push({ slot, kind: 'ai', text: `Осталось уточнить: ${missing.join(', ')}` })
    else if (own != null || exp) items.push({ slot, kind: 'check', text: 'Всё нужное известно' })
  }

  return (
    <div role="complementary" aria-label="Сводка по диалогу" className="hidden w-[230px] shrink-0 flex-col items-start justify-around pb-28 pt-24 xl:flex">
      {items.map((it, i) => (
        <Widget key={`${i}-${'text' in it ? it.text : it.kind}`} d={i} className={i % 2 ? 'ml-6' : ''}>
          {it.kind === 'action'
            ? <button onClick={() => nav(`/new?plan=${encodeURIComponent(planId!)}`)} className="whitespace-nowrap rounded-full bg-fill px-4 py-2 text-[14px] font-medium text-white">Подобрать кредит →</button>
            : <SatCard it={it} />}
        </Widget>
      ))}
    </div>
  )
}
