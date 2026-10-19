import { useEffect, useState, type ReactNode } from 'react'
import { MemoryRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { CabinetProvider, useCabinet } from '../phone/CabinetContext'
import Login from '../phone/screens/Login'
import Onboarding from '../phone/screens/Onboarding'
import Chat from '../phone/screens/Chat'
import PlanScreen from '../phone/screens/Plan'
import Finance from '../phone/screens/Finance'
import ProfileScreen from '../phone/screens/Profile'
import { Logo, Wide } from '../phone/ui'
import { api } from '../api'
import type { ChatSummary } from '../types/plan'
import { short } from '../lib/format'
import { useMediaQuery } from '../landing/useSlides'

// Рабочая версия (/app): тот же кабинет, что в телефоне на презентации, но на весь экран и без слайдов.
// Экраны и логика общие с телефоном, своё здесь только обрамление: боковая панель с разделами и диалогами.

const tabs = [
  { to: '/chat', label: 'Чат', d: 'M4 5h16v11H9l-5 4z' },
  { to: '/plan', label: 'План', d: 'M5 4h14v16H5zM8 9h8M8 13h8' },
  { to: '/finance', label: 'Финансы', d: 'M4 19V9m6 10V5m6 14v-7m4 7H2' },
  { to: '/profile', label: 'Профиль', d: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6' },
]

const Icon = ({ d, size = 20 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
)

const points = [
  ['Опишите идею', 'Своими словами, как рассказали бы другу'],
  ['Ответьте на вопросы', 'Бюджет, опыт, город: ИИ спросит только нужное'],
  ['Получите план', 'Шаги, деньги, риски и кредит, который бизнес потянет'],
]

// Вход: слева о продукте, справа форма. Онбординг: экран телефона в карточке по центру.
function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden border-r border-white/5 p-12 lg:flex lg:flex-col">
        <div className="pointer-events-none absolute -left-40 -top-40 h-[620px] w-[620px] rounded-full bg-[radial-gradient(closest-side,rgba(239,49,36,.35),rgba(239,49,36,0))]" aria-hidden />
        <div className="pointer-events-none absolute -bottom-56 right-[-120px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(closest-side,rgba(239,49,36,.16),rgba(239,49,36,0))]" aria-hidden />
        <div className="relative flex items-center gap-3">
          <Logo size={40} />
          <div className="leading-tight">
            <div className="font-display text-[16px] font-semibold text-brand">XRONIX</div>
            <div className="text-[13px] text-muted">Кабинет предпринимателя</div>
          </div>
        </div>
        <div className="relative my-auto max-w-[560px] py-12">
          <h2 className="font-display text-[44px] font-semibold leading-[1.05] tracking-tight xl:text-[52px]">Идея бизнеса. План. Кредит под него.</h2>
          <ol className="mt-10 space-y-5">
            {points.map(([t, d], i) => (
              <li key={t} className="flex gap-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fill font-display text-[15px] font-semibold text-white">{i + 1}</span>
                <div><div className="text-[17px] font-semibold">{t}</div><div className="text-[14px] text-muted">{d}</div></div>
              </li>
            ))}
          </ol>
        </div>
        <a href="./" className="relative inline-flex w-fit items-center gap-2 text-[14px] text-muted transition-colors hover:text-text">
          <Icon d="M15 5l-7 7 7 7" size={16} />Презентация проекта
        </a>
      </section>
      <section className="flex items-center justify-center p-6">
        <div className="w-full max-w-[400px]">
          <div className="mb-10 flex items-center gap-3 lg:hidden"><Logo size={36} /><span className="font-display text-[16px] font-semibold text-brand">XRONIX</span></div>
          {children}
        </div>
      </section>
    </div>
  )
}

const Centered = ({ children }: { children: ReactNode }) => (
  <div className="flex min-h-svh items-center justify-center p-4">
    <div className="card-ring h-[min(760px,calc(100svh-32px))] w-full max-w-[440px] overflow-hidden rounded-[32px] bg-bg pt-6 shadow-[0_40px_80px_-30px_rgba(0,0,0,.9)]">{children}</div>
  </div>
)

// Коротко о текущем плане в боковой панели: главное видно с любого экрана
function PlanBadge() {
  const { plan } = useCabinet()
  if (!plan) return null
  const f = plan.finance
  return (
    <NavLink to="/plan" className="hero-card card-ring mb-5 block rounded-2xl p-3.5 transition-opacity hover:opacity-90">
      <div className="text-[11px] font-medium uppercase tracking-wider text-text/50">Текущий план</div>
      <div className="mt-1 truncate text-[15px] font-semibold">{plan.title}</div>
      <div className="mt-2.5 flex gap-4 text-[12px]">
        <div><div className="text-text/50">На старт</div><div className="mt-0.5 font-semibold tabular-nums">{short(f.startup_cost_rub)} ₽</div></div>
        <div><div className="text-text/50">Прибыль</div><div className="mt-0.5 font-semibold tabular-nums text-ok">{short(f.monthly_profit_rub)} ₽</div></div>
        {f.payback_months != null && <div><div className="text-text/50">Окупаемость</div><div className="mt-0.5 font-semibold tabular-nums">{f.payback_months} мес.</div></div>}
      </div>
    </NavLink>
  )
}

function Dialogs() {
  const { chatId, messages, busy, openChat, newChat } = useCabinet()
  const nav = useNavigate()
  const [items, setItems] = useState<ChatSummary[] | null>(null)
  const [failed, setFailed] = useState(false)

  // Список обновляем, когда в чате пришёл ответ: у нового диалога появляется название, у старого план
  useEffect(() => {
    if (busy) return
    api.listChats().then((l) => { setItems(l); setFailed(false) }).catch(() => setFailed(true))
  }, [chatId, messages.length, busy])

  const open = async (id: string) => { try { await openChat(id); nav('/chat') } catch { setFailed(true) } }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <button onClick={() => { newChat(); nav('/chat') }}
        className="mb-4 flex h-11 items-center justify-center gap-2 rounded-xl bg-fill text-[14px] font-semibold text-white transition-colors hover:bg-brand-deep">
        <Icon d="M12 5v14M5 12h14" size={18} />Новый диалог
      </button>
      <div className="px-2 pb-2 text-[12px] font-medium uppercase tracking-wider text-muted">Диалоги</div>
      <div className="no-scrollbar min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {failed && <p className="px-2 py-2 text-[13px] text-accent">Не удалось загрузить диалоги.</p>}
        {!items && !failed && [0, 1, 2].map((i) => <div key={i} className="mx-1 my-1 h-9 animate-pulse rounded-lg bg-surface" aria-hidden />)}
        {items?.length === 0 && <p className="px-2 py-2 text-[13px] leading-snug text-muted">Пока пусто. Опишите идею в чате.</p>}
        {items?.map((c) => (
          <button key={c.id} onClick={() => open(c.id)} aria-current={c.id === chatId ? 'true' : undefined}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[14px] transition-colors ${c.id === chatId ? 'bg-surface-2 text-text' : 'text-text/75 hover:bg-surface hover:text-text'}`}>
            <span className="min-w-0 flex-1 truncate">{c.title}</span>
            {c.plan_id && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" title="План готов" aria-label="план готов" />}
          </button>
        ))}
      </div>
    </div>
  )
}

function Sidebar() {
  const { user, signOut } = useCabinet()
  return (
    <aside className="hidden w-[288px] shrink-0 flex-col border-r border-white/5 bg-[#0b0b0d]/80 p-4 md:flex">
      <div className="mb-6 flex items-center gap-3 px-1">
        <Logo size={36} />
        <div className="leading-tight">
          <div className="font-display text-[15px] font-semibold text-brand">XRONIX</div>
          <div className="text-[12px] text-muted">Кабинет предпринимателя</div>
        </div>
      </div>
      <nav className="mb-6 space-y-0.5" aria-label="Разделы кабинета">
        {tabs.map((t) => (
          <NavLink key={t.to} to={t.to}
            className={({ isActive }) => `relative flex h-10 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors ${isActive ? 'bg-surface-2 text-text before:absolute before:-left-4 before:top-2 before:h-6 before:w-[3px] before:rounded-r-full before:bg-accent' : 'text-muted hover:bg-surface hover:text-text'}`}>
            {({ isActive }) => <><span className={isActive ? 'text-accent' : ''}><Icon d={t.d} /></span>{t.label}</>}
          </NavLink>
        ))}
      </nav>
      <PlanBadge />
      <Dialogs />
      <div className="mt-4 space-y-1 border-t border-white/5 pt-4">
        {user && (
          <div className="flex items-center gap-3 px-1 pb-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-2 text-[14px] font-semibold" aria-hidden>{user.name.slice(0, 1).toUpperCase()}</span>
            <div className="min-w-0 flex-1 leading-tight">
              <div className="truncate text-[14px] font-medium">{user.name}</div>
              <div className="truncate text-[12px] text-muted">{user.email}</div>
            </div>
            <button onClick={signOut} title="Выйти" aria-label="Выйти" className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-surface hover:text-text">
              <Icon d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" size={18} />
            </button>
          </div>
        )}
        <a href="./" className="flex h-9 items-center gap-2 rounded-lg px-2 text-[13px] text-muted hover:bg-surface hover:text-text">
          <Icon d="M15 5l-7 7 7 7" size={16} />Презентация проекта
        </a>
      </div>
    </aside>
  )
}

function Shell() {
  const { status, needsOnboarding } = useCabinet()
  const nav = useNavigate()
  useEffect(() => { if (status === 'in') nav('/chat', { replace: true }) }, [status]) // eslint-disable-line react-hooks/exhaustive-deps

  if (status === 'booting')
    return <div className="flex h-svh items-center justify-center" role="status" aria-label="Загрузка"><Logo size={56} /></div>
  if (status === 'out') return <AuthLayout><Login /></AuthLayout>
  if (needsOnboarding) return <Centered><Onboarding /></Centered>

  return (
    <div className="flex h-svh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="mx-auto min-h-0 w-full max-w-[1180px] flex-1">
          <Routes>
            <Route path="/chat" element={<div className="mx-auto h-full max-w-[880px]"><Chat /></div>} />
            <Route path="/plan" element={<PlanScreen />} />
            <Route path="/finance" element={<Finance />} />
            <Route path="/profile" element={<ProfileScreen />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </main>
        {/* узкий экран: боковой панели нет, разделы внизу, как в телефоне */}
        <nav className="mx-3 mb-4 grid grid-cols-4 rounded-[26px] bg-surface-2/90 p-1.5 ring-1 ring-white/5 md:hidden" aria-label="Разделы кабинета">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => `flex min-h-[50px] flex-col items-center justify-center gap-0.5 rounded-[20px] text-[11px] font-medium transition-colors ${isActive ? 'bg-fill text-white' : 'text-muted'}`}>
              <Icon d={t.d} size={21} />{t.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </div>
  )
}

export default function DesktopApp() {
  useEffect(() => { document.title = 'XRONIX — кабинет предпринимателя' }, [])
  const wide = useMediaQuery('(min-width: 768px)') // как md: с этой ширины диалоги в боковой панели
  return (
    <Wide.Provider value={wide}>
      <div className="app-bg min-h-svh text-text">
        <MemoryRouter initialEntries={['/chat']}>
          <CabinetProvider>
            <Shell />
          </CabinetProvider>
        </MemoryRouter>
      </div>
    </Wide.Provider>
  )
}
