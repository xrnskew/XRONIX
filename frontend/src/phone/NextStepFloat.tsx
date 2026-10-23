import { useLocation, useNavigate } from 'react-router-dom'
import { useCabinet } from './CabinetContext'
import { Widget } from './ui'
import { SatCard } from '../landing/Satellites'

// Плавающая подсказка на экранах «План» и «Финансы и кредит»: что делать дальше по этому плану
export default function NextStepFloat() {
  const { pathname } = useLocation()
  const { plan, planId } = useCabinet()
  const nav = useNavigate()
  if (!plan || !planId || planId === 'demo' || !(pathname === '/plan' || pathname === '/finance')) return null
  const onPlan = pathname === '/plan'
  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-20 hidden flex-col items-end gap-3 xl:flex">
      <Widget d={0}><SatCard it={{ slot: 'a', kind: 'ai', text: onPlan ? 'Посмотрите, какой кредит потянет этот план' : 'Цифры устраивают? Подайте заявку по этому плану' }} /></Widget>
      <Widget d={1}>
        <button onClick={() => nav(onPlan ? `/finance?plan=${encodeURIComponent(planId)}` : `/new?plan=${encodeURIComponent(planId)}`)} className="pointer-events-auto whitespace-nowrap rounded-full bg-fill px-4 py-2 text-[14px] font-medium text-white">{onPlan ? 'Финансы и кредит →' : 'Подать заявку →'}</button>
      </Widget>
    </div>
  )
}
