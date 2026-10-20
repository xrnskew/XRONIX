import { useId, useRef, useState } from 'react'
import { findCities, type City } from '../../data/cities'

export default function CityPicker({ value, onChange, onSelect, label = 'Город', disabled = false }: {
  value: string; onChange: (value: string) => void; onSelect?: (value: string) => void; label?: string; disabled?: boolean
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const options = findCities(value)
  const choose = (city: City) => { onChange(city.name); onSelect?.(city.name); setOpen(false); setActive(-1) }

  return (
    <div className="min-w-0" onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOpen(false) }}>
      <label htmlFor={id} className="mb-1.5 block text-[14px] font-semibold">{label}</label>
      <div className="relative">
        <input ref={input} id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`}
          aria-activedescendant={open && active >= 0 && options[active] ? `${id}-${active}` : undefined}
          disabled={disabled} autoComplete="off" maxLength={60} value={value} placeholder="Начните вводить название города"
          className="h-12 w-full rounded-xl bg-surface-2 pl-3.5 pr-12 text-[15px] text-text outline-none ring-1 ring-white/10 placeholder:text-muted focus:ring-2 focus:ring-accent"
          onFocus={() => setOpen(true)}
          onChange={(e) => { onChange(e.target.value); setOpen(true); setActive(-1) }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault(); setOpen(true)
              const next = options.length ? (active + (e.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length : -1
              setActive(next)
              const option = document.getElementById(`${id}-${next}`)
              if (option && list.current) {
                const bottom = option.offsetTop + option.offsetHeight
                if (option.offsetTop < list.current.scrollTop) list.current.scrollTop = option.offsetTop
                else if (bottom > list.current.scrollTop + list.current.clientHeight) list.current.scrollTop = bottom - list.current.clientHeight
              }
            } else if (e.key === 'Enter' && open && active >= 0 && options[active]) { e.preventDefault(); choose(options[active]) }
            else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); setActive(-1) }
          }} />
        <button type="button" disabled={disabled} aria-label="Показать список городов" aria-expanded={open}
          className="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-lg text-muted hover:bg-white/5"
          onClick={() => { input.current?.focus(); setOpen(!open); setActive(-1) }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
        </button>
      </div>
      {open && <div className="mt-2 overflow-hidden rounded-xl bg-surface ring-1 ring-white/10">
        <ul ref={list} id={`${id}-list`} role="listbox" aria-label="Города" className="thin-scroll relative max-h-60 overflow-y-auto overscroll-contain p-1">
          {options.map((city, i) => <li key={`${city.name}-${city.region}`} id={`${id}-${i}`} role="option" aria-selected={active === i}
            className={`cursor-pointer rounded-lg px-3 py-2.5 ${active === i ? 'bg-accent/15 text-accent' : 'hover:bg-surface-2'}`}
            onMouseDown={(e) => e.preventDefault()} onClick={() => choose(city)}>
            <div className="text-[14px] font-semibold">{city.name}</div><div className="mt-0.5 text-[12px] text-muted">{city.region}</div>
          </li>)}
        </ul>
        {options.length === 0 && <p className="p-3 text-[13px] text-muted">В справочнике не найдено. Можно оставить своё название населённого пункта.</p>}
      </div>}
    </div>
  )
}
