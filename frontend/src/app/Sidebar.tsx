import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api'
import { conveyor } from '../api/conveyor'
import { isHiddenChat } from '../lib/hiddenChats'
import { isRecalculated } from '../lib/planAlias'
import { usePolling } from '../lib/usePolling'
import { useCabinet } from '../phone/CabinetContext'
import { whoseMove } from '../phone/conveyor/parts'
import { Icon, Logo } from '../phone/ui'
import type { ChatSummary } from '../types/plan'

// Боковая панель кабинета клиента (md и шире): действие «Новая заявка», разделы с пометками, последние диалоги, карточка профиля.
const ICON = {
  plus: 'M12 5v14M5 12h14',
  chat: 'M4 5h16v11H9l-5 4z',
  plan: 'M4 19V9M10 19V5M16 19v-7M22 19H2',
  finance: 'M3 7h18v10H3zM12 9.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5zM6.5 10v.01M17.5 14v.01',
  apps: 'M6 3h9l4 4v14H6zM14 3v5h5M9 12h7M9 16h7',
  feed: 'M6 8a6 6 0 1112 0c0 7 3 9 3 9H3s3-2 3-9M10 21h4',
  profile: 'M12 12a4 4 0 100-8 4 4 0 000 8zM4 21c0-4 4-6 8-6s8 2 8 6',
  logout: 'M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10',
  back: 'M15 5l-7 7 7 7',
}

// Что показать в пометках и в «Недавних диалогах»; обновляется опросом, при смене экрана и чата
function useSidebarData() {
  const { user, chatId } = useCabinet()
  const { pathname } = useLocation()
  const [action, setAction] = useState(0)   // заявок ждут вашего действия
  const [unread, setUnread] = useState(0)   // непрочитанных событий в ленте
  const [chats, setChats] = useState<ChatSummary[]>([])
  const alive = useRef(true)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const load = () => {
    if (!user) return
    // каждый запрос сам по себе: сбой ленты не должен прятать список диалогов
    conveyor.listApplications().then((l) => alive.current && setAction(l.filter((a) => whoseMove(a.status) === 'you').length)).catch(() => {})
    conveyor.feed().then((l) => alive.current && setUnread(l.filter((f) => !f.read).length)).catch(() => {})
    api.listChats().then((l) => alive.current && setChats([...l].filter((c) => !isRecalculated(c.plan_id) && !isHiddenChat(c.id)).sort((a, b) => b.updated_at.localeCompare(a.updated_at)))).catch(() => {})
  }
  // небольшая задержка: лента помечает события прочитанными уже после открытия, диалог появляется в списке после первого ответа
  useEffect(() => { const t = setTimeout(load, 900); return () => clearTimeout(t) }, [user?.id, pathname, chatId]) // eslint-disable-line react-hooks/exhaustive-deps
  usePolling(load, 20000)
  return { action, unread, chats }
}

const linkCls = (isActive: boolean) =>
  `relative flex h-10 items-center gap-3 rounded-xl px-3 text-[15px] font-medium transition-colors ${isActive ? 'bg-surface-2 text-text before:absolute before:-left-4 before:top-2 before:h-6 before:w-[3px] before:rounded-r-full before:bg-accent' : 'text-muted hover:bg-surface hover:text-text'}`

function Item({ to, icon, label, badge }: { to: string; icon: string; label: string; badge?: ReactNode }) {
  return (
    <NavLink to={to} className={({ isActive }) => linkCls(isActive)}>
      {({ isActive }) => <><span className={isActive ? 'text-accent' : ''}><Icon d={icon} /></span><span className="min-w-0 flex-1 truncate">{label}</span>{badge}</>}
    </NavLink>
  )
}

// Пометка у раздела: жёлтая — нужно ваше действие, красная — новое
const Badge = ({ n, tone, label }: { n: number; tone: 'warn' | 'new'; label: string }) => n > 0 ? (
  <span className={`flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-semibold tabular-nums ${tone === 'warn' ? 'bg-warn/20 text-warn' : 'bg-fill text-white'}`} aria-label={`${label}: ${n}`}>{n > 9 ? '9+' : n}</span>
) : null

const Heading = ({ children }: { children: ReactNode }) => <div className="px-3 pb-1 pt-5 text-[11px] font-semibold uppercase tracking-[.08em] text-muted/70">{children}</div>

export default function Sidebar() {
  const { user, signOut, openChat, chatId } = useCabinet()
  const { pathname } = useLocation()
  const nav = useNavigate()
  const { action, unread, chats } = useSidebarData()
  const open = async (id: string) => { await openChat(id); nav('/chat', { state: { fresh: Date.now() } }) }
  return (
    <aside className="hidden w-[264px] shrink-0 flex-col border-r border-white/5 glass-side p-4 md:flex">
      <div className="mb-5 flex items-center gap-3 px-1">
        <Logo size={36} />
        <div className="leading-tight">
          <div className="font-display text-[15px] font-semibold text-brand">XRONIX</div>
          <div className="text-[12px] text-muted">Кабинет предпринимателя</div>
        </div>
      </div>

      {/* главное действие кабинета отдельной кнопкой, а не пунктом меню */}
      <NavLink to="/new" className="mb-1 flex h-11 items-center justify-center gap-2 rounded-xl bg-fill text-[15px] font-semibold text-white shadow-[0_8px_20px_-10px_rgba(255,69,56,.8)] transition-colors hover:bg-brand-deep">
        <Icon d={ICON.plus} size={18} />Новая заявка
      </NavLink>

      <nav className="no-scrollbar -mx-1 min-h-0 flex-1 overflow-y-auto px-1" aria-label="Разделы кабинета">
        <Heading>Бизнес</Heading>
        <div className="space-y-0.5">
          <Item to="/chat" icon={ICON.chat} label="Подбор бизнеса" />
          <Item to="/plan" icon={ICON.plan} label="План" />
          <Item to="/finance" icon={ICON.finance} label="Финансы и кредит" />
        </div>
        <Heading>Кредит</Heading>
        <div className="space-y-0.5">
          <Item to="/applications" icon={ICON.apps} label="Заявки" badge={<Badge n={action} tone="warn" label="Ждут вашего действия" />} />
          <Item to="/feed" icon={ICON.feed} label="Лента" badge={<Badge n={unread} tone="new" label="Новых событий" />} />
        </div>
        {chats.length > 0 && (
          <>
            <Heading>Недавние диалоги</Heading>
            <ul className="space-y-0.5">
              {chats.slice(0, 4).map((c) => {
                const current = c.id === chatId && pathname === '/chat'
                return (
                  <li key={c.id}>
                    <button type="button" onClick={() => open(c.id)} title={c.title} aria-current={current ? 'true' : undefined}
                      className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-3 text-left text-[14px] transition-colors ${current ? 'bg-surface-2 text-text' : 'text-muted hover:bg-surface hover:text-text'}`}>
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${c.plan_id ? 'bg-ok' : 'bg-white/20'}`} aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{c.title}</span>
                      {c.plan_id && <span className="sr-only">, план готов</span>}
                    </button>
                  </li>
                )
              })}
            </ul>
            <button type="button" onClick={() => nav('/chat', { state: { list: true, fresh: Date.now() } })} className="mt-1 h-8 w-full rounded-lg px-3 text-left text-[13px] text-muted transition-colors hover:text-text">Все диалоги →</button>
          </>
        )}
      </nav>

      <div className="mt-3 space-y-1 border-t border-white/5 pt-3">
        {user && (
          <div className="flex items-center gap-1 rounded-xl p-1 transition-colors hover:bg-surface">
            <NavLink to="/profile" className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1.5" aria-label="Профиль">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent to-brand-deep text-[14px] font-semibold text-white" aria-hidden>{user.name.slice(0, 1).toUpperCase()}</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-[14px] font-medium">{user.name}</span>
                <span className="block truncate text-[12px] text-muted">{user.email}</span>
              </span>
            </NavLink>
            <button onClick={signOut} title="Выйти" aria-label="Выйти" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface-2 hover:text-text">
              <Icon d={ICON.logout} size={18} />
            </button>
          </div>
        )}
        <a href="./" className="flex h-8 items-center gap-2 rounded-lg px-2 text-[13px] text-muted transition-colors hover:text-text">
          <Icon d={ICON.back} size={16} />Презентация проекта
        </a>
      </div>
    </aside>
  )
}
