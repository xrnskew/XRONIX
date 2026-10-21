import { rub } from '../../../lib/format'
import { Card } from '../../ui'
import { type Path, type CalculatedPlan } from './types'

// Шаг мастера: 0. Цель
const GOALS: { path: Path; title: string; text: string }[] = [
  { path: 'current', title: 'Кредит для текущего бизнеса', text: 'Оборот, оборудование, недвижимость или рефинансирование. Сразу к подбору кредита.' },
  { path: 'new_point', title: 'Открыть новую точку или направление', text: 'Сначала посчитаем проект: вложения, расходы, прибыль. Сумма из расчёта попадёт в заявку.' },
  { path: 'no_business', title: 'У меня пока нет бизнеса', text: 'Посчитаем запуск и подадим заявку как будущий ИП на демо-продукт «Старт».' },
]
export default function GoalStep({ preset, onPick }: { preset: CalculatedPlan | null; onPick: (p: Path) => void }) {
  const goals = preset ? [
    { path: 'new_point' as Path, title: 'У меня есть бизнес — это будет новая точка', text: 'Выберите компанию: сумма и срок кредита придут из плана.' },
    { path: 'no_business' as Path, title: 'Бизнеса пока нет', text: 'Заявка как будущий ИП на демо-продукт «Старт»: нужен залог или поручитель и не меньше 20% своих денег.' },
  ] : GOALS
  return (
    <>
      {preset && (
        <Card span={12} className="hero-card">
          <div className="text-[13px] text-text/60">План из чата</div>
          <div className="mt-1 text-[18px] font-semibold">{preset.plan.title}</div>
          <p className="mt-1 text-[14px] text-text/80">Запуск {rub(preset.plan.finance.startup_cost_rub)}, своих {rub(preset.plan.finance.own_funds_rub)}, не хватает {rub(preset.plan.finance.funding_gap_rub)}. Как будете запускать?</p>
        </Card>
      )}
      {goals.map((g) => (
        <button key={g.path} onClick={() => onPick(g.path)} data-span={12} className="card-ring block w-full rounded-[22px] bg-surface p-5 text-left transition-colors hover:bg-surface-2 lg:p-6">
          <div className="text-[18px] font-semibold">{g.title}</div>
          <div className="mt-1 text-[14px] leading-snug text-muted">{g.text}</div>
        </button>
      ))}
    </>
  )
}
