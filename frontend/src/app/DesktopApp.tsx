import { useEffect, useRef, useState, type ReactNode } from 'react'
import { HashRouter, NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { CabinetProvider, useCabinet } from '../phone/CabinetContext'
import PlanRoute, { planPath } from '../phone/PlanRoute'
import Login from '../phone/screens/Login'
import Onboarding from '../phone/screens/Onboarding'
import Chat from '../phone/screens/Chat'
import PlanScreen from '../phone/screens/Plan'
import Finance from '../phone/screens/Finance'
import ProfileScreen from '../phone/screens/Profile'
import { Logo, Wide } from '../phone/ui'
import { api, ApiError } from '../api'
import type { ChatSummary } from '../types/plan'
import { short } from '../lib/format'
import { useMediaQuery } from '../landing/useSlides'
import AppShader, { pulseShader, setShaderEnergy } from './AppShader'

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
      <section className="relative hidden overflow-hidden p-12 lg:flex lg:flex-col">
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
  const { plan, planId } = useCabinet()
  if (!plan) return null
  const f = plan.finance
  return (
    <NavLink to={planPath('/plan', planId)} className="hero-card card-ring mb-5 block rounded-2xl p-3.5 transition-opacity hover:opacity-90">
      <div className="text-[12px] text-text/55">Текущий план</div>
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
  const { chatId, messages, busy, openChat, newChat, deleteChat } = useCabinet()
  const nav = useNavigate()
  const [items, setItems] = useState<ChatSummary[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null) // id диалога, который просим подтвердить
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  // Список обновляем, когда в чате пришёл ответ: у нового диалога появляется название, у старого план
  useEffect(() => {
    if (busy) return
    api.listChats().then((l) => { setItems(l); setFailed(false) }).catch(() => setFailed(true))
  }, [chatId, messages.length, busy])

  const open = async (id: string) => { try { if (await openChat(id)) nav('/chat') } catch { setFailed(true) } }
  const remove = async (id: string) => {
    setRemoving(true); setRemoveError(null)
    try {
      await deleteChat(id)
      setItems((l) => l?.filter((c) => c.id !== id) ?? null)
      setConfirm(null)
    } catch (e) {
      setRemoveError(e instanceof ApiError && e.code !== 'NETWORK' ? e.message : 'Не удалось удалить диалог. Попробуйте позже.')
    } finally { setRemoving(false) }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <button onClick={() => { newChat(); nav('/chat') }}
        className="mb-4 flex h-11 items-center justify-center gap-2 rounded-xl bg-fill text-[14px] font-semibold text-white transition-colors hover:bg-brand-deep">
        <Icon d="M12 5v14M5 12h14" size={18} />Новый диалог
      </button>
      <div className="px-2 pb-1.5 text-[13px] text-muted">Диалоги</div>
      <div className="no-scrollbar min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {failed && <p className="px-2 py-2 text-[13px] text-accent">Не удалось загрузить диалоги.</p>}
        {!items && !failed && [0, 1, 2].map((i) => <div key={i} className="mx-1 my-1 h-9 animate-pulse rounded-lg bg-surface" aria-hidden />)}
        {items?.length === 0 && <p className="px-2 py-2 text-[13px] leading-snug text-muted">Пока пусто. Опишите идею в чате.</p>}
        {items?.map((c) => confirm === c.id ? (
          <div key={c.id} className="rounded-lg bg-surface-2 p-2.5" role="group" aria-label={`Удалить диалог «${c.title}»`}>
            <p className="text-[13px] leading-snug text-text/80">Удалить «{c.title}»{c.plan_id ? ' вместе с планом' : ''}?</p>
            {removeError && <p role="alert" className="mt-1.5 text-[12px] leading-snug text-accent">{removeError}</p>}
            <div className="mt-2 flex gap-1.5">
              <button onClick={() => remove(c.id)} disabled={removing || busy} className="h-8 rounded-lg bg-fill px-3 text-[13px] font-semibold text-white disabled:opacity-50">{removing ? 'Удаляем…' : 'Удалить'}</button>
              <button onClick={() => { setConfirm(null); setRemoveError(null) }} disabled={removing} className="h-8 rounded-lg px-3 text-[13px] text-muted hover:text-text">Отмена</button>
            </div>
          </div>
        ) : (
          <div key={c.id} className={`group/row flex items-center rounded-lg transition-colors ${c.id === chatId ? 'bg-surface-2' : 'hover:bg-surface'}`}>
            <button onClick={() => open(c.id)} aria-current={c.id === chatId ? 'true' : undefined}
              className={`flex min-w-0 flex-1 items-center gap-2 py-2 pl-2.5 pr-1 text-left text-[14px] ${c.id === chatId ? 'text-text' : 'text-text/75 hover:text-text'}`}>
              <span className="min-w-0 flex-1 truncate">{c.title}</span>
              {c.plan_id && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ok" title="План готов" aria-label="план готов" />}
            </button>
            <button onClick={() => { setConfirm(c.id); setRemoveError(null) }} aria-label={`Удалить диалог «${c.title}»`} title="Удалить"
              className="mr-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted opacity-0 transition-opacity hover:bg-surface-3 hover:text-accent focus-visible:opacity-100 group-hover/row:opacity-100">
              <Icon d="M5 7h14M10 7V5h4v2M7 7l1 12h8l1-12" size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}

function Sidebar() {
  const { user, signOut, planId } = useCabinet()
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
          <NavLink key={t.to} to={planPath(t.to, planId)}
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
  const { status, needsOnboarding, planId, notice } = useCabinet()

  if (status === 'booting')
    return <div className="flex h-svh items-center justify-center" role="status" aria-label="Загрузка"><Logo size={56} /></div>
  if (status === 'out') return <AuthLayout><Login /></AuthLayout>
  if (needsOnboarding) return <Centered><Onboarding /></Centered>

  return (
    <div className="flex h-svh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {notice && <p role="alert" className="bg-accent/10 p-3 text-[14px] text-accent">{notice}</p>}
        <main className="mx-auto min-h-0 w-full max-w-[1180px] flex-1">
          <Routes>
            <Route path="/chat" element={<div className="mx-auto h-full max-w-[880px]"><Chat /></div>} />
            <Route path="/plan" element={<PlanRoute><PlanScreen /></PlanRoute>} />
            <Route path="/finance" element={<PlanRoute><Finance /></PlanRoute>} />
            <Route path="/profile" element={<ProfileScreen />} />
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </main>
        {/* узкий экран: боковой панели нет, разделы внизу, как в телефоне */}
        <nav className="mx-3 mb-4 grid grid-cols-4 rounded-[26px] bg-surface-2/90 p-1.5 ring-1 ring-white/5 md:hidden" aria-label="Разделы кабинета">
          {tabs.map((t) => (
            <NavLink key={t.to} to={planPath(t.to, planId)} className={({ isActive }) => `flex min-h-[50px] flex-col items-center justify-center gap-0.5 rounded-[20px] text-[11px] font-medium transition-colors ${isActive ? 'bg-fill text-white' : 'text-muted'}`}>
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
      <div className="relative min-h-svh text-text">
        <AppShader />
        <HashRouter>
          <CabinetProvider>
            <ShaderSync />
            <Shell />
          </CabinetProvider>
        </HashRouter>
      </div>
    </Wide.Provider>
  )
}
