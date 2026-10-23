import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { useCabinet } from '../../phone/CabinetContext'
import PlanRoute from '../../phone/PlanRoute'
import PlanScreen from '../../phone/screens/Plan'
import { Logo, Icon } from '../../phone/ui'
import Queue from './Queue'
import CardView from './CardView'
import Stats from './Stats'

// Рабочее место кредитного аналитика (/bank): очередь, карточка заявки с проверками и скорингом, решение, сводка.
// Контракт: /contracts/conveyor.md, «Рабочее место аналитика». Логика решений — docs/CONVEYOR.md, раздел 7.

const tabs = [
  { to: '/bank', label: 'Очередь', d: 'M4 6h16M4 12h16M4 18h10', end: true },
  { to: '/bank/stats', label: 'Сводка', d: 'M4 19V9m6 10V5m6 14v-7m4 7H2', end: false },
]

export default function BankApp() {
  const { user, signOut } = useCabinet()
  return (
    <div className="flex h-svh">
      <aside className="hidden w-[260px] shrink-0 flex-col border-r border-white/5 glass-side p-4 md:flex">
        <div className="mb-6 flex items-center gap-3 px-1">
          <Logo size={36} />
          <div className="leading-tight">
            <div className="font-display text-[15px] font-semibold text-brand">XRONIX · Банк</div>
            <div className="text-[12px] text-muted">Рабочее место аналитика</div>
          </div>
        </div>
        <nav className="space-y-0.5" aria-label="Разделы">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `flex h-10 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors ${isActive ? 'bg-surface-2 text-text' : 'text-muted hover:bg-surface hover:text-text'}`}>
              <Icon d={t.d} />{t.label}
            </NavLink>
          ))}
        </nav>
        <div className="mt-auto flex items-center gap-3 border-t border-white/5 px-1 pt-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[14px] font-semibold" aria-hidden>{user?.name.slice(0, 1).toUpperCase()}</span>
          <div className="min-w-0 flex-1 leading-tight"><div className="truncate text-[14px] font-medium">{user?.name}</div><div className="truncate text-[12px] text-muted">{user?.email}</div></div>
          <button onClick={signOut} title="Выйти" aria-label="Выйти" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-text"><Icon d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" size={18} /></button>
        </div>
      </aside>
      <main className="mx-auto flex min-h-0 w-full max-w-[1280px] flex-1 flex-col">
        {/* узкий экран: боковой панели нет — разделы и выход строкой сверху */}
        <nav className="flex items-center gap-1 border-b border-white/5 px-3 py-2 md:hidden" aria-label="Разделы">
          {tabs.map((t) => <NavLink key={t.to} to={t.to} end={t.end} className={({ isActive }) => `h-9 rounded-lg px-3 text-[14px] leading-9 ${isActive ? 'bg-surface-2 text-text' : 'text-muted'}`}>{t.label}</NavLink>)}
          <button onClick={signOut} className="ml-auto h-9 px-3 text-[14px] text-muted">Выйти</button>
        </nav>
        <div className="min-h-0 flex-1">
        <Routes>
          <Route path="/bank" element={<Queue />} />
          <Route path="/bank/stats" element={<Stats />} />
          <Route path="/bank/:id" element={<CardView />} />
          <Route path="/plan" element={<PlanRoute><PlanScreen /></PlanRoute>} />
          <Route path="*" element={<Navigate to="/bank" replace />} />
        </Routes>
        </div>
      </main>
    </div>
  )
}
