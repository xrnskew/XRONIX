import { plural, rub } from '../../../lib/format'
import { Card, Icon } from '../../ui'
import { PATHS, type Path, type CalculatedPlan } from './types'

// Иконка пути: действующий бизнес, новая точка, запуск с нуля
const ICONS: Record<Path, string> = {
  current: 'M3 9l1.5-5h15L21 9M3 9h18M3 9v11h18V9M9 20v-6h6v6',
  new_point: 'M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11zM12 7v6M9 10h6',
  no_business: 'M12 21v-9M12 12c0-4 3-7 8-7 0 4-3 7-8 7zM12 15c0-3-2.5-5-6.5-5 0 3 2.5 5 6.5 5',
}

// Шаг мастера: 0. Цель
const GOALS: { path: Path; title: string; text: string }[] = [
  { path: 'current', title: 'Кредит для текущего бизнеса', text: 'Оборот, оборудование, недвижимость или рефинансирование. Сразу к подбору кредита.' },
  { path: 'new_point', title: 'Открыть новую точку или направление', text: 'Сначала посчитаем проект: вложения, расходы, прибыль. Сумма из расчёта попадёт в заявку.' },
  { path: 'no_business', title: 'У меня пока нет бизнеса', text: 'Посчитаем запуск и подадим заявку как будущий ИП на демо-продукт «Старт».' },
]
export default function GoalStep({ preset, onPick }: { preset: CalculatedPlan | null; onPick: (p: Path) => void }) {
  // число шагов после выбора цели; с готовым планом из чата шага «Проект» нет
  const stepsOf = (p: Path) => PATHS[p].slice(1).filter((x) => !preset || x !== 'Проект').length
  const goals = preset ? [
    { path: 'current' as Path, title: 'У меня есть бизнес — нужен кредит на текущие задачи', text: 'Оборудование, оборот, недвижимость. План из чата не понадобится: сразу к подбору кредита.' },
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
        <button key={g.path} onClick={() => onPick(g.path)} data-span={goals.length === 3 ? 4 : 6}
          className="card-ring group flex w-full flex-col rounded-[22px] bg-surface p-5 text-left transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-surface-2 active:translate-y-0 lg:p-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/12 text-accent-soft transition-colors group-hover:bg-fill group-hover:text-white" aria-hidden>
            <Icon d={ICONS[g.path]} size={24} />
          </span>
          <span className="mt-5 block text-[18px] font-semibold leading-snug">{g.title}</span>
          <span className="mt-1.5 block text-[14px] leading-snug text-muted">{g.text}</span>
          <span className="mt-auto block pt-5 text-[13px] text-text/60">{stepsOf(g.path)} {plural(stepsOf(g.path), ['шаг', 'шага', 'шагов'])}: {PATHS[g.path].slice(1).filter((x) => !preset || x !== 'Проект').join(', ').toLowerCase()}</span>
        </button>
      ))}
    </>
  )
}
