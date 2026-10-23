import { createContext, useContext, type ReactNode } from 'react'

// true в рабочей версии на компьютере (/app): там диалоги в боковой панели, а экраны шире телефона
export const Wide = createContext(false)

// true в рабочей версии (/app): под планом в чате есть «Подобрать кредит», мастер заявки доступен
export const Conveyor = createContext(false)

// delay: порядковый номер для каскадного появления карточек при открытии экрана.
// span: ширина карточки в сетке рабочей версии (из 12 колонок), tall: карточка на две строки сетки. В телефоне не влияют.
export const Card = ({ children, className = '', id, delay, span, tall }: { children: ReactNode; className?: string; id?: string; delay?: number; span?: 5 | 6 | 7 | 12; tall?: boolean }) => (
  <div id={id} data-span={span} data-tall={tall || undefined} className={`card-ring rounded-[22px] bg-surface p-4 ${delay === undefined ? '' : 'rise'} ${className}`} style={delay === undefined ? undefined : { animationDelay: `${delay * 70}ms` }}>{children}</div>
)

// bodyClass — класс тела экрана; например wizard: карточки каждого нового шага мастера плавно появляются
export const Screen = ({ title, sub, children, bodyClass = '' }: { title: string; sub?: ReactNode; children: ReactNode; bodyClass?: string }) => {
  const wide = useContext(Wide)
  if (wide)
    return (
      <div className="flex h-full flex-col">
        <div data-phone-scroll className="thin-scroll relative flex-1 overflow-y-auto px-8 pb-12 pt-8">
          <div className="mb-6">
            <h1 className="font-display text-[30px] font-semibold leading-tight tracking-tight">{title}</h1>
            {sub && <p className="mt-1.5 text-[15px] text-muted">{sub}</p>}
          </div>
          <div className={`wide-grid ${bodyClass}`}>{children}</div>
        </div>
      </div>
    )
  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-3 pt-2">
        <h1 className="text-[26px] font-bold leading-tight tracking-tight">{title}</h1>
        {sub && <p className="mt-0.5 text-[14px] text-muted">{sub}</p>}
      </div>
      <div data-phone-scroll className={`no-scrollbar relative flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-8 ${bodyClass}`}>{children}</div>
    </div>
  )
}

export const SectionTitle = ({ children }: { children: ReactNode }) => (
  <h2 className="mb-3 text-[17px] font-semibold tracking-tight">{children}</h2>
)

export const Stat = ({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }) => (
  <div className="min-w-0">
    <div className="text-[12px] text-muted">{label}</div>
    <div className={`mt-0.5 text-[17px] font-semibold tabular-nums ${tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-accent' : ''}`}>{value}</div>
  </div>
)

export const Button = ({ children, onClick, variant = 'primary', disabled }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost'; disabled?: boolean }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`h-[52px] w-full rounded-2xl px-6 text-[16px] font-semibold transition-all duration-150 active:scale-[.98] ${
      variant === 'primary' ? 'bg-fill text-white shadow-[0_8px_24px_-8px_rgba(255,69,56,.7)] active:bg-brand-deep disabled:bg-surface-3 disabled:text-text/60 disabled:shadow-none' : 'bg-surface-2 text-text active:bg-surface-3 disabled:opacity-40'
    }`}
  >
    {children}
  </button>
)

export const Chip = ({ children, onClick, active }: { children: ReactNode; onClick?: () => void; active?: boolean }) => (
  <button
    type="button"
    onClick={onClick}
    aria-pressed={active}
    className={`min-h-9 rounded-full px-3.5 text-[14px] transition-colors ${active ? 'bg-fill text-white' : 'bg-surface-2 text-text active:bg-surface-3'}`}
  >
    {children}
  </button>
)

// action — ход клиента, bank — ход банка (система или специалист)
export type Tone = 'ok' | 'warn' | 'bad' | 'muted' | 'action' | 'bank'
export const Badge = ({ tone, children, dot }: { tone: Tone; children: ReactNode; dot?: boolean }) => {
  const t = { ok: 'bg-ok/15 text-ok', warn: 'bg-warn/15 text-warn', bad: 'bg-accent/15 text-accent', muted: 'bg-white/10 text-muted', action: 'bg-accent/15 text-accent-soft', bank: 'bg-steel/15 text-steel' }[tone]
  return <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[12px] font-medium ${t}`}>{dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}{children}</span>
}

export const Logo = ({ size = 40 }: { size?: number }) => (
  <div
    className="flex shrink-0 items-center justify-center rounded-[28%] bg-gradient-to-br from-[#ff6a5c] to-[#d12419] font-display font-bold text-white shadow-[0_6px_16px_-6px_rgba(255,69,56,.8)]"
    style={{ width: size, height: size, fontSize: size * 0.46 }}
    aria-hidden
  >
    X
  </div>
)

export const Skeleton = () => (
  <div className="space-y-3" aria-busy="true" aria-label="Загрузка">
    {[150, 190, 130].map((h, i) => <div key={i} className="animate-pulse rounded-[22px] bg-surface" style={{ height: h }} />)}
  </div>
)

// Контурная иконка 24×24 одним путём: разделы меню и кнопки в шапке
export const Icon = ({ d, size = 20 }: { d: string; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
)

// Пустое состояние: иконка, что здесь будет и главное действие (кнопки передаются детьми)
export const EmptyState = ({ icon, title, text, children, ghost, steps }: { icon: string; title: string; text: string; children?: ReactNode; ghost?: string[]; steps?: string[] }) => (
  <div className="flex flex-col items-center px-2 py-8 text-center">
    <span className="pop flex h-16 w-16 items-center justify-center rounded-full bg-accent/12 text-accent-soft ring-1 ring-accent/25" aria-hidden><Icon d={icon} size={28} /></span>
    <p className="mt-4 text-[17px] font-semibold">{title}</p>
    <p className="mt-1 max-w-[360px] text-[14px] leading-snug text-muted">{text}</p>
    {ghost && (
      <div className="mt-6 grid w-full max-w-[520px] grid-cols-3 gap-2.5" aria-hidden>
        {ghost.map((g) => (
          <div key={g} className="rounded-2xl border border-dashed border-white/10 bg-white/[.03] px-3 py-3 text-left">
            <div className="text-[12px] text-muted">{g}</div>
            <div className="mt-1 font-display text-[22px] font-semibold leading-none text-muted/40">—</div>
          </div>
        ))}
      </div>
    )}
    {steps && (
      <ol className="mt-6 flex max-w-[560px] flex-wrap items-center justify-center gap-x-2 gap-y-2 text-[13px] text-muted">
        {steps.map((t, i) => (
          <li key={t} className="flex items-center gap-2">
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/10 text-[11px] font-semibold text-text tabular-nums">{i + 1}</span>{t}
            {i < steps.length - 1 && <span aria-hidden className="mx-1 text-muted/40">→</span>}
          </li>
        ))}
      </ol>
    )}
    {children && <div className="mt-6 flex flex-wrap justify-center gap-3">{children}</div>}
  </div>
)
