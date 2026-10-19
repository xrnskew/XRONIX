import { useEffect, useState } from 'react'

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// Число плавно «набегает» от 0 до target при появлении экрана. При reduced-motion сразу показывает итог.
export function useCountUp(target: number, ms = 900) {
  const [v, setV] = useState(still() ? target : 0)
  useEffect(() => {
    if (still()) { setV(target); return }
    let raf = 0
    const t0 = performance.now()
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms)
      setV(target * (1 - Math.pow(1 - p, 3)))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return v
}
