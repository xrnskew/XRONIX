import { useEffect, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useCabinet } from './CabinetContext'
import { Screen, Skeleton } from './ui'

export const planPath = (path: string, id: string | null) =>
  id && (path === '/plan' || path === '/finance') ? `${path}?plan=${encodeURIComponent(id)}` : path

// The URL is authoritative on a deep link; never render the previously selected plan.
export default function PlanRoute({ children }: { children: ReactNode }) {
  const { planId, openPlan, demo } = useCabinet()
  const location = useLocation()
  const nav = useNavigate()
  const requested = new URLSearchParams(location.search).get('plan')
  useEffect(() => {
    if (demo) return
    if (requested && requested !== planId) void openPlan(requested)
    else if (!requested && planId) nav(planPath(location.pathname, planId), { replace: true })
  }, [requested, planId, openPlan, demo, location.pathname, nav])
  if (!demo && requested && requested !== planId) return <Screen title="Загрузка плана"><Skeleton /></Screen>
  return children
}
