import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api } from '../../api'
import { useCabinet } from '../CabinetContext'
import { latestPlanId } from '../../lib/planAlias'
import type { Company } from '../../types/conveyor'
import { Icon, Screen } from '../ui'
import { ErrorText, Steps, miniBtn } from './parts'
import ApplicationForm from './ApplicationForm'
import { PATHS, type CalculatedPlan, type Need, type Path } from './wizard/types'
import GoalStep from './wizard/GoalStep'
import CompanyStep from './wizard/CompanyStep'
import NeedStep from './wizard/NeedStep'
import ProductStep from './wizard/ProductStep'
import ProjectStep from './wizard/ProjectStep'
import FounderStep from './wizard/FounderStep'

export type { CalculatedPlan, Need } from './wizard/types'

type Progress = { path: Path; step: number; company: Company | null; project: CalculatedPlan | null; need: Need; appId: string | null; usedPlan?: boolean }
const EMPTY_NEED: Need = { purpose: null, amount_rub: null, term_months: 24, has_collateral: false }
const PROGRESS_KEY = 'xronix_wizard', PROGRESS_TTL = 60 * 60 * 1000
function loadProgress(): Progress | null {
  try {
    const raw = sessionStorage.getItem(PROGRESS_KEY); if (!raw) return null
    const { at, data } = JSON.parse(raw) as { at: number; data: Progress }
    return Date.now() - at < PROGRESS_TTL && data.step > 0 ? data : null
  } catch { return null }
}
function saveProgress(data: Progress) { try { if (data.step === 0 && !data.appId) sessionStorage.removeItem(PROGRESS_KEY); else sessionStorage.setItem(PROGRESS_KEY, JSON.stringify({ at: Date.now(), data })) } catch { /* хранилище недоступно */ } }
function clearProgress() { try { sessionStorage.removeItem(PROGRESS_KEY) } catch { /* хранилище недоступно */ } }

// Три пути (docs/CONVEYOR.md, раздел 3): кредит текущему бизнесу; новая точка или направление — сначала расчёт проекта;
// бизнеса пока нет — расчёт проекта, заявка как будущий ИП на демо-продукт «Старт».
// ?plan=<id> — пришли из чата подбора бизнеса с готовым планом: шаг «Проект» пропускаем.
export default function NewApplication() {
  const query = new URLSearchParams(useLocation().search)
  const planParam = query.get('plan')
  // сумма и срок из калькулятора на экране «Финансы»: перекрывают рекомендацию плана
  const amountParam = Number(query.get('amount')), termParam = Number(query.get('term'))
  const picked = amountParam >= 10_000 && termParam >= 1 && termParam <= 360 ? { amount_rub: Math.round(amountParam), term_months: Math.round(termParam) } : null
  // Прогресс переживает кнопку «назад» браузера: вернулись на /new — продолжаем с того же шага (не дольше часа)
  const saved = useRef(planParam ? null : loadProgress()).current
  const [path, setPath] = useState<Path>(saved?.path ?? 'current')
  const [step, setStep] = useState(saved?.step ?? 0)
  const [company, setCompany] = useState<Company | null>(saved?.company ?? null)
  const [project, setProject] = useState<CalculatedPlan | null>(saved?.project ?? null)
  const [preset, setPreset] = useState<CalculatedPlan | null>(null)
  const [presetError, setPresetError] = useState('')
  const [usedPlan, setUsedPlan] = useState(saved?.usedPlan ?? false) // заявка идёт по готовому плану (кнопка на карточке плана): шаг «Проект» пропускаем
  const { plan: myPlan, planId } = useCabinet()
  useEffect(() => {
    if (!planParam) return
    api.getPlan(latestPlanId(planParam)).then((r) => setPreset({ plan_id: r.plan_id, plan: r.plan })).catch(() => setPresetError('Не удалось открыть план из чата. Можно посчитать проект заново.'))
  }, [planParam])
  const [need, setNeed] = useState<Need>(saved?.need ?? EMPTY_NEED)
  const [appId, setAppId] = useState<string | null>(saved?.appId ?? null)
  useEffect(() => { saveProgress({ path, step, company, project, need, appId, usedPlan }) }, [path, step, company, project, need, appId, usedPlan])
  const nav = useNavigate()
  const steps = usedPlan ? PATHS[path].filter((s) => s !== 'Проект') : PATHS[path], name = steps[step]
  // до выбора цели число шагов зависит от пути: «5–6», а не пять шагов степпера, которые верны только для одного пути
  const lens = (Object.keys(PATHS) as Path[]).map((k) => PATHS[k].length)
  const stepRange = Math.min(...lens) === Math.max(...lens) ? String(lens[0]) : `${Math.min(...lens)}–${Math.max(...lens)}`
  const next = () => setStep(step + 1), back = () => setStep(step - 1)

  const usePlan = (c: CalculatedPlan) => {
    setProject(c)
    const credit = c.plan.credit
    setNeed({ purpose: need.purpose === 'new_direction' ? 'new_direction' : 'new_location', amount_rub: picked?.amount_rub ?? credit.amount_rub ?? (c.plan.finance.funding_gap_rub || null), term_months: picked?.term_months ?? credit.recommended_term_months ?? 36, has_collateral: false })
  }
  const fromPlan = (c: CalculatedPlan) => { usePlan(c); next() }

  return (
    <Screen title="Новая заявка" bodyClass="wizard">
      <div data-span={12} className="flex flex-wrap items-center justify-between gap-2">
        {name === 'Цель'
          ? <p className="text-[14px] text-muted"><span className="font-semibold text-text">Шаг 1 из {stepRange}.</span> Выберите цель, остальные шаги зависят от неё.</p>
          : <Steps items={steps} current={step} />}
        {step > 0 && <button type="button" className={miniBtn} onClick={() => { clearProgress(); setUsedPlan(false); setPath('current'); setStep(0); setCompany(null); setProject(null); setAppId(null); setNeed(EMPTY_NEED) }}><Icon d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8M3 3v5h5" size={15} />Начать заново</button>}
      </div>
      {presetError && <div data-span={12}><ErrorText>{presetError}</ErrorText></div>}
      {name === 'Цель' && <GoalStep plan={preset ?? (myPlan && planId ? { plan_id: planId, plan: myPlan } : null)}
        onPick={(p) => { setUsedPlan(false); setPath(p); setProject(null); setNeed(EMPTY_NEED); setStep(1) }}
        onPickPlan={(c) => { setUsedPlan(true); setPath('no_business'); usePlan(c); setStep(1) }} />}
      {name === 'Компания' && <CompanyStep onDone={(c) => { setCompany(c); next() }} />}
      {name === 'Проект' && <ProjectStep company={company} noBusiness={path === 'no_business'} initial={project} onBack={back} onDone={fromPlan} />}
      {name === 'Основатель' && <FounderStep onBack={back} onDone={(c) => { setCompany(c); next() }} />}
      {name === 'Что нужно' && company && <NeedStep company={company} need={need} setNeed={setNeed} project={project} onBack={back} onDone={next} />}
      {name === 'Продукт' && company && <ProductStep company={company} need={need} setNeed={setNeed} planId={project?.plan_id ?? null} project={project} onPlanChange={(c) => { setProject(c); setNeed({ ...need, amount_rub: c.plan.credit.amount_rub ?? (c.plan.finance.funding_gap_rub || null), term_months: c.plan.credit.recommended_term_months ?? need.term_months }) }} onBack={back} onDone={(id) => { setAppId(id); next() }} />}
      {name === 'Заявка' && appId && <ApplicationForm id={appId} onSubmitted={() => { clearProgress(); nav(`/applications/${appId}`) }} />}
    </Screen>
  )
}
