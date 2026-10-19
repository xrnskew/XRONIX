import type { ReactNode } from 'react'

export const Card = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <div className={`rounded-2xl bg-surface p-4 ${className}`}>{children}</div>
)

export const Screen = ({ title, children }: { title: string; children: ReactNode }) => (
  <div className="flex h-full flex-col">
    <h1 className="px-5 pb-3 pt-2 text-[22px] font-semibold leading-tight">{title}</h1>
    <div className="no-scrollbar flex-1 space-y-3 overflow-y-auto px-4 pb-6">{children}</div>
  </div>
)

export const Stat = ({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'warn' | 'bad' }) => (
  <div>
    <div className="text-[12px] text-muted">{label}</div>
    <div className={`text-[17px] font-semibold ${tone === 'ok' ? 'text-ok' : tone === 'warn' ? 'text-warn' : tone === 'bad' ? 'text-accent' : ''}`}>{value}</div>
  </div>
)

export const Button = ({ children, onClick, variant = 'primary', disabled }: { children: ReactNode; onClick?: () => void; variant?: 'primary' | 'ghost'; disabled?: boolean }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    className={`h-12 w-full rounded-2xl text-[15px] font-semibold transition-colors disabled:opacity-40 ${
      variant === 'primary' ? 'bg-accent text-white active:bg-brand-deep' : 'bg-surface-2 text-text active:bg-line'
    }`}
  >
    {children}
  </button>
)

export const Chip = ({ children, onClick, active }: { children: ReactNode; onClick?: () => void; active?: boolean }) => (
  <button
    onClick={onClick}
    className={`min-h-9 rounded-full px-3.5 text-[14px] transition-colors ${active ? 'bg-accent text-white' : 'bg-surface-2 text-text active:bg-line'}`}
  >
    {children}
  </button>
)
