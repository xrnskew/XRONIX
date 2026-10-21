import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../../api'
import type { Company } from '../../types/conveyor'
import { Screen } from '../ui'
import { ErrorText, Steps } from './parts'
import ApplicationForm from './ApplicationForm'
import { PATHS, type CalculatedPlan, type Need, type Path } from './wizard/types'
import GoalStep from './wizard/GoalStep'
import CompanyStep from './wizard/CompanyStep'
import NeedStep from './wizard/NeedStep'
import ProductStep from './wizard/ProductStep'
import ProjectStep from './wizard/ProjectStep'
import FounderStep from './wizard/FounderStep'

export type { CalculatedPlan, Need } from './wizard/types'

// Три пути (docs/CONVEYOR.md, раздел 3): кредит текущему бизнесу; новая точка или направление — сначала расчёт проекта;
// бизнеса пока нет — расчёт проекта, заявка как будущий ИП на демо-продукт «Старт».
// ?plan=<id> — пришли из чата подбора бизнеса с готовым планом: шаг «Проект» пропускаем.
export default function NewApplication() {
  const planParam = new URLSearchParams(useLocation().search).get('plan')
  const [path, setPath] = useState<Path>('current')
  const [step, setStep] = useState(0)
  const [company, setCompany] = useState<Company | null>(null)
  const [project, setProject] = useState<CalculatedPlan | null>(null)
  const [preset, setPreset] = useState<CalculatedPlan | null>(null)
  const [presetError, setPresetError] = useState('')
  useEffect(() => {
    if (!planParam) return
    api.getPlan(planParam).then((r) => setPreset({ plan_id: r.plan_id, plan: r.plan })).catch(() => setPresetError('Не удалось открыть план из чата. Можно посчитать проект заново.'))
  }, [planParam])
  const [need, setNeed] = useState<Need>({ purpose: null, amount_rub: null, term_months: 24, has_collateral: false })
  const [appId, setAppId] = useState<string | null>(null)
  const nav = useNavigate()
  const steps = preset && path !== 'current' ? PATHS[path].filter((s) => s !== 'Проект') : PATHS[path], name = steps[step]
  const next = () => setStep(step + 1), back = () => setStep(step - 1)

  const usePlan = (c: CalculatedPlan) => {
    setProject(c)
    const credit = c.plan.credit
    setNeed({ purpose: need.purpose === 'new_direction' ? 'new_direction' : 'new_location', amount_rub: credit.amount_rub ?? (c.plan.finance.funding_gap_rub || null), term_months: credit.recommended_term_months ?? 36, has_collateral: false })
  }
  const fromPlan = (c: CalculatedPlan) => { usePlan(c); next() }

  return (
    <Screen title="Новая заявка" bodyClass="wizard">
      <div data-span={12}><Steps items={steps} current={step} /></div>
      {presetError && <div data-span={12}><ErrorText>{presetError}</ErrorText></div>}
      {name === 'Цель' && <GoalStep preset={preset} onPick={(p) => { setPath(p); if (preset && p !== 'current') usePlan(preset); else setProject(null); setStep(1) }} />}
      {name === 'Компания' && <CompanyStep onDone={(c) => { setCompany(c); next() }} />}
      {name === 'Проект' && <ProjectStep company={company} noBusiness={path === 'no_business'} initial={project} onBack={back} onDone={fromPlan} />}
      {name === 'Основатель' && <FounderStep onBack={back} onDone={(c) => { setCompany(c); next() }} />}
      {name === 'Что нужно' && company && <NeedStep company={company} need={need} setNeed={setNeed} project={project} onBack={back} onDone={next} />}
      {name === 'Продукт' && company && <ProductStep company={company} need={need} planId={project?.plan_id ?? null} onBack={back} onDone={(id) => { setAppId(id); next() }} />}
      {name === 'Заявка' && appId && <ApplicationForm id={appId} onSubmitted={() => nav(`/applications/${appId}`)} />}
    </Screen>
  )
}
