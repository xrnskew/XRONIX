import { useNavigate } from 'react-router-dom'
import { plural, rub } from '../../../lib/format'
import { useCabinet } from '../../CabinetContext'
import { Card, Icon } from '../../ui'
import { PATHS, type Path, type CalculatedPlan } from './types'

// Иконка пути: действующий бизнес, новая точка, запуск с нуля
const ICONS: Record<Path, string> = {
  current: 'M3 9l1.5-5h15L21 9M3 9h18M3 9v11h18V9M9 20v-6h6v6',
  new_point: 'M12 21s-7-6.2-7-11a7 7 0 1114 0c0 4.8-7 11-7 11zM12 7v6M9 10h6',
  no_business: 'M12 21v-9M12 12c0-4 3-7 8-7 0 4-3 7-8 7zM12 15c0-3-2.5-5-6.5-5 0 3 2.5 5 6.5 5',
}

// Шаг мастера: 0. Цель.
// Первые два пути для действующего бизнеса и данных из чата не используют. «Бизнеса пока нет» ведёт в новый чат:
// идею считаем там, а заявку по готовому плану подаёт кнопка на карточке плана (она оформляет заявку как будущий ИП).
const GOALS: { path: Path; title: string; text: string; action: string }[] = [
  { path: 'current', title: 'У меня есть бизнес — нужен кредит на текущие задачи', text: 'Оборот, оборудование, недвижимость или рефинансирование. Сразу к подбору кредита.', action: 'Выбрать' },
  { path: 'new_point', title: 'У меня есть бизнес — открываю новую точку или направление', text: 'Сначала посчитаем проект: вложения, расходы, прибыль. Сумма из расчёта попадёт в заявку.', action: 'Выбрать' },
  { path: 'no_business', title: 'Бизнеса пока нет', text: 'Расскажите идею в чате: посчитаем запуск, а потом подадим заявку по готовому плану как будущий ИП на демо-продукт «Старт».', action: 'Рассказать идею' },
]

// plan — готовый план из чата (по ссылке /new?plan=… или последний план клиента); onPickPlan оформляет по нему заявку
export default function GoalStep({ plan, onPick, onPickPlan }: { plan: CalculatedPlan | null; onPick: (p: Path) => void; onPickPlan: (c: CalculatedPlan) => void }) {
  const nav = useNavigate()
  const { newChat } = useCabinet()
  const stepsOf = (p: Path) => PATHS[p].length - 1 // без самого шага «Цель»
  const pick = (p: Path) => {
    if (p === 'no_business') { newChat(); nav('/chat') } // новый диалог: идею считаем там, а не в этом мастере
    else onPick(p)
  }
  const f = plan?.plan.finance
  return (
    <>
      {plan && f && (
        <Card span={12} className="hero-card">
          <div className="text-[13px] text-text/60">Готовый план из чата</div>
          <div className="mt-1 text-[18px] font-semibold">{plan.plan.title}</div>
          <p className="mt-1 text-[14px] text-text/80">Запуск {rub(f.startup_cost_rub)}, своих {rub(f.own_funds_rub)}, не хватает {rub(f.funding_gap_rub)}.</p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <button type="button" onClick={() => onPickPlan(plan)} className="h-11 rounded-xl bg-fill px-5 text-[15px] font-semibold text-white hover:bg-brand-deep">Подать заявку по этому плану</button>
            <span className="text-[13px] text-text/60">Оформим как будущий ИП: проект уже посчитан, понадобится личный ИНН.</span>
          </div>
        </Card>
      )}
      {GOALS.map((g) => (
        <button key={g.path} onClick={() => pick(g.path)} data-span={4}
          className="card-ring group flex w-full flex-col rounded-[22px] bg-surface p-5 text-left transition-[background-color,transform] duration-200 hover:-translate-y-0.5 hover:bg-surface-2 active:translate-y-0 lg:p-6">
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/12 text-accent-soft transition-colors group-hover:bg-fill group-hover:text-white" aria-hidden>
            <Icon d={ICONS[g.path]} size={24} />
          </span>
          <span className="mt-5 block text-[18px] font-semibold leading-snug">{g.title}</span>
          <span className="mt-1.5 block text-[14px] leading-snug text-muted">{g.text}</span>
          {g.path !== 'no_business' && (
            <span className="mt-auto block pt-5 text-[13px] text-text/60">Ещё {stepsOf(g.path)} {plural(stepsOf(g.path), ['шаг', 'шага', 'шагов'])}: {PATHS[g.path].slice(1).join(', ').toLowerCase()}</span>
          )}
          <span className={`${g.path === 'no_business' ? 'mt-auto pt-5' : 'mt-3 pt-3'} flex items-center justify-between border-t border-white/5 text-[14px] font-semibold text-text/80 transition-colors group-hover:text-accent-soft`}>
            {g.action}
            <span className="transition-transform duration-200 group-hover:translate-x-1" aria-hidden>→</span>
          </span>
        </button>
      ))}
      <Card span={12}>
        <ul className="grid gap-x-8 gap-y-2 text-[14px] leading-snug text-muted md:grid-cols-3">
          <li><span className="font-medium text-text">Около 5 минут.</span> Прогресс сохраняется, можно вернуться позже.</li>
          <li><span className="font-medium text-text">Понадобится:</span> ИНН компании и примерные цифры за год. Для нового бизнеса хватит плана из чата.</li>
          <li><span className="font-medium text-text">Не знаете, что выбрать?</span> <button type="button" onClick={() => { newChat(); nav('/chat') }} className="text-accent-soft underline decoration-accent/30 underline-offset-2 hover:text-text">Расскажите идею в чате →</button></li>
        </ul>
      </Card>
    </>
  )
}
