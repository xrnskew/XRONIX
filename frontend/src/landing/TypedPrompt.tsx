import { useEffect, useState } from 'react'

const ideas = ['Хочу открыть кофейню у метро', 'Хочу открыть пекарню в спальном районе', 'Хочу открыть мойку самообслуживания', 'Хочу открыть студию маникюра']
const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// Имитация поля ввода из чата: идея печатается по буквам. Для скринридера и при reduced-motion показывается статичная фраза.
export default function TypedPrompt() {
  const [text, setText] = useState(still() ? ideas[0] : '')

  useEffect(() => {
    if (still()) return
    let i = 0, n = 0, dir = 1, t = 0
    const tick = () => {
      const full = ideas[i]
      n += dir
      setText(full.slice(0, n))
      let wait = dir === 1 ? 55 : 22
      if (dir === 1 && n >= full.length) { dir = -1; wait = 1800 }
      else if (dir === -1 && n <= 0) { dir = 1; i = (i + 1) % ideas.length; wait = 400 }
      t = window.setTimeout(tick, wait)
    }
    t = window.setTimeout(tick, 600)
    return () => window.clearTimeout(t)
  }, [])

  return (
    <div className="flex h-14 max-w-[520px] items-center gap-3 rounded-full bg-white/[.07] pl-6 pr-2 ring-1 ring-white/15" role="img" aria-label={`Пример запроса: ${ideas[0]}`}>
      <span className="min-w-0 flex-1 truncate text-[17px] text-white/90" aria-hidden>
        {text}<span className="caret ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] bg-brand" />
      </span>
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-fill text-white" aria-hidden>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
      </span>
    </div>
  )
}
