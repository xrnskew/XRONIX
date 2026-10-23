import { useEffect, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCabinet } from './CabinetContext'
import { latestPlanId } from '../lib/planAlias'
import { Screen, Skeleton } from './ui'

export const planPath = (path: string, id: string | null) =>
  id && (path === '/plan' || path === '/finance') ? `${path}?plan=${encodeURIComponent(id)}` : path

// The URL is authoritative on a deep link; never render the previously selected plan.
export default function PlanRoute({ children }: { children: ReactNode }) {
  const { planId, openPlan, demo } = useCabinet()
  const location = useLocation()
  const nav = useNavigate()
  const asked = new URLSearchParams(location.search).get('plan')
  // в ссылке мог остаться прежний план, который уже пересчитали: ведём на последний
  const requested = asked ? latestPlanId(asked) : null
  useEffect(() => {
    if (demo) return
    if (asked && requested && asked !== requested) { nav(planPath(location.pathname, requested), { replace: true }); return }
    if (requested && requested !== planId) void openPlan(requested)
    else if (!requested && planId) nav(planPath(location.pathname, planId), { replace: true })
  }, [asked, requested, planId, openPlan, demo, location.pathname, nav])
  if (!demo && requested && requested !== planId) return <Screen title="Загрузка плана"><Skeleton /></Screen>
  return children
}
