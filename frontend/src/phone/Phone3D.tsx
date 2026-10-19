import { useEffect, useRef, type ReactNode } from 'react'

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))
const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// Объёмный телефон: плавно поворачивается к курсору, у каждого слайда свой базовый ракурс, слегка «дышит».
// Пока курсор над телефоном, он замирает полностью: под мышью ничего не двигается, кнопки и поля нажимаются как обычно.
// Наведение определяем по неподвижной обёртке, а не по самому телефону, иначе на краях получилось бы мигание.
// Каждый кадр меняется только transform двух элементов: это работа видеокарты, React и стили не пересчитываются.
export default function Phone3D({ base, enabled, children }: { base: { x: number; y: number }; enabled: boolean; children: ReactNode }) {
  const stage = useRef<HTMLDivElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const baseRef = useRef(base)
  baseRef.current = base

  useEffect(() => {
    const st = stage.current
    const el = body.current
    if (!st || !el) return
    const glare = () => el.querySelector<HTMLElement>('[data-glare]')
    if (!enabled || still()) {
      el.style.transform = 'none'
      const g = glare(); if (g) g.style.transform = 'none'
      return
    }

    let rect = st.getBoundingClientRect()
    const remeasure = () => { rect = st.getBoundingClientRect() }
    const ptr = { nx: 0, ny: 0 }
    let hovered = false
    const onMove = (e: PointerEvent) => {
      ptr.nx = clamp((e.clientX - (rect.left + rect.width / 2)) / (window.innerWidth * 0.5), -1, 1)
      ptr.ny = clamp((e.clientY - (rect.top + rect.height / 2)) / (window.innerHeight * 0.5), -1, 1)
    }
    const enter = () => { hovered = true }
    const leave = () => { hovered = false }
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('resize', remeasure)
    const remeasureTimer = window.setInterval(remeasure, 800) // обёртка может сдвигаться (место под карточки)
    st.addEventListener('pointerenter', enter)
    st.addEventListener('pointerleave', leave)

    const cur = { x: baseRef.current.x, y: baseRef.current.y }
    let bob = 0
    let last = performance.now()
    let raf = 0
    const loop = (t: number) => {
      raf = requestAnimationFrame(loop)
      const dt = Math.min(64, t - last)
      last = t
      if (hovered || document.hidden) return
      bob += dt
      const b = baseRef.current
      cur.x += (b.x - ptr.ny * 8 - cur.x) * 0.07
      cur.y += (Math.min(0, b.y + ptr.nx * 12) - cur.y) * 0.07 // вправо (y > 0) не поворачиваем
      el.style.transform = `translate3d(0, ${(Math.sin(bob / 1700) * 5).toFixed(2)}px, 0) rotateX(${cur.x.toFixed(2)}deg) rotateY(${cur.y.toFixed(2)}deg)`
      const g = glare(); if (g) g.style.transform = `translateX(${(-cur.y * 1.6).toFixed(1)}%)`
    }
    raf = requestAnimationFrame(loop)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('resize', remeasure)
      window.clearInterval(remeasureTimer)
      st.removeEventListener('pointerenter', enter)
      st.removeEventListener('pointerleave', leave)
    }
  }, [enabled])

  return (
    <div ref={stage} className="group" style={{ perspective: '2000px', perspectiveOrigin: '50% 45%' }}>
      <div ref={body} style={{ position: 'relative', transformStyle: 'preserve-3d', willChange: 'transform' }}>{children}</div>
    </div>
  )
}
