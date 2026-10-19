import { useEffect, useRef, type ReactNode } from 'react'

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// Объёмный телефон: плавно поворачивается к курсору, у каждого слайда свой базовый ракурс,
// слегка «дышит». Над самим телефоном наклон гасится, чтобы им было удобно пользоваться.
export default function Phone3D({ base, enabled, children }: { base: { x: number; y: number }; enabled: boolean; children: ReactNode }) {
  const body = useRef<HTMLDivElement>(null)
  const baseRef = useRef(base)
  baseRef.current = base

  useEffect(() => {
    const el = body.current
    if (!el) return
    if (!enabled || still()) {
      el.style.transform = 'none'
      el.style.setProperty('--glare', '50')
      return
    }
    const cur = { x: 0, y: 0 }
    const ptr = { nx: 0, ny: 0, over: false }
    const onMove = (e: PointerEvent) => {
      const r = el.getBoundingClientRect()
      ptr.nx = clamp((e.clientX - (r.left + r.width / 2)) / (window.innerWidth * 0.5), -1, 1)
      ptr.ny = clamp((e.clientY - (r.top + r.height / 2)) / (window.innerHeight * 0.5), -1, 1)
      ptr.over = el.contains(e.target as Node)
    }
    window.addEventListener('pointermove', onMove, { passive: true })

    let raf = 0
    const t0 = performance.now()
    const loop = (t: number) => {
      const k = ptr.over ? 0.2 : 1
      const b = baseRef.current
      const ty = b.y + ptr.nx * 14 * k
      const tx = b.x - ptr.ny * 9 * k
      cur.x += (tx - cur.x) * 0.07
      cur.y += (ty - cur.y) * 0.07
      const bob = Math.sin((t - t0) / 1700) * 5
      el.style.transform = `translate3d(0, ${bob.toFixed(2)}px, 0) rotateX(${cur.x.toFixed(2)}deg) rotateY(${cur.y.toFixed(2)}deg)`
      el.style.setProperty('--glare', (50 - cur.y * 2.6).toFixed(1))
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => { cancelAnimationFrame(raf); window.removeEventListener('pointermove', onMove) }
  }, [enabled])

  return (
    <div style={{ perspective: '2000px', perspectiveOrigin: '50% 45%' }}>
      <div ref={body} style={{ transformStyle: 'preserve-3d', willChange: 'transform' }}>{children}</div>
    </div>
  )
}
