// Фон кабинета: светящиеся точки медленно дрейфуют, кольца с точками вращаются, как на презентации.
// Только transform и opacity, поэтому нагрузка на видеокарту минимальна; при reduced-motion всё стоит на месте.
const RINGS = [
  { x: 82, y: 22, size: 620, dur: 110, rev: false },
  { x: 82, y: 22, size: 880, dur: 170, rev: true },
  { x: 12, y: 86, size: 520, dur: 140, rev: true },
  { x: 12, y: 86, size: 780, dur: 200, rev: false },
]
// детерминированный набор, чтобы фон не прыгал при перерисовке
const DOTS = Array.from({ length: 20 }, (_, i) => {
  const r = (n: number) => { const v = Math.sin(i * 12.9898 + n * 78.233) * 43758.5453; return v - Math.floor(v) }
  return { x: r(1) * 100, y: r(2) * 100, s: 2 + r(3) * 4, dur: 14 + r(4) * 22, dx: (r(5) - .5) * 160, dy: (r(6) - .5) * 160, delay: -r(7) * 30, hue: r(8) }
})
const COLORS = ['255,255,255', '255,255,255', '255,190,180', '190,200,230']

export default function Orbs() {
  return (
    <div className="orbs ambient" aria-hidden>
      {RINGS.map((o, i) => (
        <div key={i} className="orb-ring absolute rounded-full border border-white/[.06]"
          style={{ left: `${o.x}%`, top: `${o.y}%`, width: o.size, height: o.size, marginLeft: -o.size / 2, marginTop: -o.size / 2, animationDuration: `${o.dur}s`, animationDirection: o.rev ? 'reverse' : 'normal' }}>
          <span className="absolute left-1/2 top-0 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/50" />
          <span className="absolute bottom-[16%] right-[4%] h-1.5 w-1.5 rounded-full bg-white/30" />
        </div>
      ))}
      {DOTS.map((d, i) => {
        const c = COLORS[Math.floor(d.hue * COLORS.length)]
        return (
          <span key={i} className="orb-dot absolute rounded-full"
            style={{ left: `${d.x}%`, top: `${d.y}%`, width: d.s, height: d.s, background: `rgba(${c},.55)`, boxShadow: `0 0 ${d.s * 2}px rgba(${c},.25)`,
              ['--dx' as string]: `${d.dx}px`, ['--dy' as string]: `${d.dy}px`, animationDuration: `${d.dur}s`, animationDelay: `${d.delay}s` }} />
        )
      })}
    </div>
  )
}
