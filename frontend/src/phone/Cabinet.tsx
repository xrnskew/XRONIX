import { useState } from 'react'
import { MemoryRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom'
import { CabinetProvider } from './PlanContext'
import Login from './screens/Login'
import Chat from './screens/Chat'
import PlanScreen from './screens/Plan'
import Finance from './screens/Finance'
import ProfileScreen from './screens/Profile'

const tabs = [
  { to: '/chat', label: 'Чат', d: 'M4 5h16v11H9l-5 4z' },
  { to: '/plan', label: 'План', d: 'M5 4h14v16H5zM8 9h8M8 13h8' },
  { to: '/finance', label: 'Финансы', d: 'M4 19V9m6 10V5m6 14v-7m4 7H2' },
  { to: '/profile', label: 'Профиль', d: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6' },
]

export default function Cabinet() {
  const [authed, setAuthed] = useState(false)
  if (!authed) return <Login onDone={() => setAuthed(true)} />
  return (
    <CabinetProvider>
      <MemoryRouter initialEntries={['/chat']}>
        <div className="flex h-full flex-col">
          <main className="min-h-0 flex-1">
            <Routes>
              <Route path="/chat" element={<Chat />} />
              <Route path="/plan" element={<PlanScreen />} />
              <Route path="/finance" element={<Finance />} />
              <Route path="/profile" element={<ProfileScreen />} />
              <Route path="*" element={<Navigate to="/chat" replace />} />
            </Routes>
          </main>
          <nav className="grid grid-cols-4 border-t border-line bg-bg pb-6 pt-1.5" aria-label="Разделы кабинета">
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} className={({ isActive }) => `flex min-h-12 flex-col items-center justify-center gap-0.5 text-[11px] ${isActive ? 'text-accent' : 'text-muted'}`}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={t.d} /></svg>
                {t.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </MemoryRouter>
    </CabinetProvider>
  )
}
