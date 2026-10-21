import { useEffect, useRef, type ReactNode } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { CabinetProvider, useCabinet } from '../phone/CabinetContext'
import PlanRoute from '../phone/PlanRoute'
import Login from '../phone/screens/Login'
import Chat from '../phone/screens/Chat'
import PlanScreen from '../phone/screens/Plan'
import Finance from '../phone/screens/Finance'
import ProfileScreen from '../phone/screens/Profile'
import NewApplication from '../phone/conveyor/NewApplication'
import ApplicationView from '../phone/conveyor/ApplicationView'
import { Applications, Feed } from '../phone/conveyor/Applications'
import BankApp from './bank/BankApp'
import { Conveyor, Logo, Wide } from '../phone/ui'
import { useMediaQuery } from '../landing/useSlides'
import AppShader, { pulseShader, setShaderEnergy } from './AppShader'

// Рабочая версия (/app): кредитный конвейер на весь экран, без слайдов (docs/CONVEYOR.md).
// Экраны общие с телефоном, своё здесь только обрамление: боковая панель с разделами.
// Чат подбора бизнеса ведёт модель Дани (/ai/consult), цифры плана считает бэкенд по шаблонам. План и финансы — по #/plan и #/finance.

const tabs = [
  { to: '/chat', label: 'Подбор бизнеса', short: 'Подбор', d: 'M4 5h16v11H9l-5 4z' },
  { to: '/applications', label: 'Заявки', d: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7' },
  { to: '/new', label: 'Новая заявка', short: 'Новая', d: 'M12 5v14M5 12h14' },
  { to: '/feed', label: 'Лента', d: 'M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4' },
  { to: '/profile', label: 'Профиль', d: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6' },
]

const Icon = ({ d, size = 20 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
)

const points = [
  ['Компания по ИНН', 'Реквизиты подтянутся из реестра, вводить их не нужно'],
  ['Подбор кредита', 'Покажем, какие продукты подходят и почему остальные нет'],
  ['Статус онлайн', 'Видно каждый этап: проверка, оценка, решение, подписание'],
]

// Вход: слева о продукте, справа форма. Онбординг: экран телефона в карточке по центру.
function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden overflow-hidden p-12 lg:flex lg:flex-col">
        <div className="relative flex items-center gap-3">
          <Logo size={40} />
          <div className="leading-tight">
            <div className="font-display text-[16px] font-semibold text-brand">XRONIX</div>
            <div className="text-[13px] text-muted">Кабинет предпринимателя</div>
          </div>
        </div>
        <div className="relative my-auto max-w-[560px] py-12">
          <h2 className="font-display text-[44px] font-semibold leading-[1.05] tracking-tight xl:text-[52px]">Кредит для бизнеса. От заявки до денег.</h2>
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
          {children}
        </div>
      </section>
    </div>
  )
}

function Sidebar() {
  const { user, signOut } = useCabinet()
  return (
    <aside className="hidden w-[288px] shrink-0 flex-col border-r border-white/5 bg-[#09090b]/75 p-4 md:flex">
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
      <div className="mt-auto space-y-1 border-t border-white/5 pt-4">
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

// Нажатие «Новая заявка» в меню всегда начинает мастер с начала, даже если он уже открыт
function FreshWizard() {
  return <NewApplication key={useLocation().key} />
}

// Фон отражает работу ИИ: думает — поле разгорается, пришёл новый план — вспышка
function ShaderSync() {
  const { busy, messages, status } = useCabinet()
  const last = messages[messages.length - 1]
  const planId = last?.reply?.type === 'plan' ? last.id : null
  const seen = useRef(planId)
  const wasBusy = useRef(busy)
  // Вспышка только для плана, который пришёл ответом на запрос; план из истории не вспыхивает.
  // Этот эффект объявлен раньше эффекта busy, поэтому видит busy предыдущего рендера.
  useEffect(() => {
    if (planId && planId !== seen.current && wasBusy.current) pulseShader()
    seen.current = planId
  }, [planId])
  useEffect(() => { wasBusy.current = busy }, [busy])
  // на экране входа поле теплее: там оно единственное украшение
  useEffect(() => { setShaderEnergy(busy ? 1 : status === 'out' ? 0.55 : 0) }, [busy, status])
  return null
}

function Shell() {
  const { status, notice, user } = useCabinet()
  const { pathname } = useLocation()

  if (status === 'booting')
    return <div className="flex h-svh items-center justify-center" role="status" aria-label="Загрузка"><Logo size={56} /></div>
  if (status === 'out') return <AuthLayout><Login /></AuthLayout>
  if (user?.role === 'analyst') return <BankApp />

  return (
    <div className="flex h-svh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {notice && <p role="alert" className="bg-accent/10 p-3 text-[14px] text-accent">{notice}</p>}
        <main className="mx-auto min-h-0 w-full max-w-[1180px] flex-1">
          {/* смена раздела — короткое появление экрана; ключ по пути, чтобы анимация шла на каждом переходе */}
          <div key={pathname} className="appear h-full">
          <Routes>
            <Route path="/applications" element={<Applications />} />
            <Route path="/applications/:id" element={<ApplicationView />} />
            <Route path="/new" element={<FreshWizard />} />
            <Route path="/feed" element={<Feed />} />
            <Route path="/chat" element={<div className="mx-auto h-full max-w-[880px]"><Chat /></div>} />
            <Route path="/plan" element={<PlanRoute><PlanScreen /></PlanRoute>} />
            <Route path="/finance" element={<PlanRoute><Finance /></PlanRoute>} />
            <Route path="/profile" element={<ProfileScreen />} />
            <Route path="*" element={<Navigate to="/applications" replace />} />
          </Routes>
          </div>
        </main>
        {/* узкий экран: боковой панели нет, разделы внизу, как в телефоне */}
        <nav className="mx-3 mb-4 grid grid-cols-5 rounded-[26px] bg-surface-2/90 p-1.5 ring-1 ring-white/5 md:hidden" aria-label="Разделы кабинета">
          {tabs.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => `flex min-h-[50px] flex-col items-center justify-center gap-0.5 rounded-[20px] text-[11px] font-medium transition-colors ${isActive ? 'bg-fill text-white' : 'text-muted'}`}>
              <Icon d={t.d} size={21} />{'short' in t ? t.short : t.label}
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
    <Wide.Provider value={wide}><Conveyor.Provider value>
      <div className="relative min-h-svh text-text">
        <AppShader />
        <HashRouter>
          <CabinetProvider>
            <ShaderSync />
            <Shell />
          </CabinetProvider>
        </HashRouter>
      </div>
    </Conveyor.Provider></Wide.Provider>
  )
}
