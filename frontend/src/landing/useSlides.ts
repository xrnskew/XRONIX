import { useEffect, useState } from 'react'

// Какой слайд сейчас в центре экрана.
// current обновляется сразу (подпись в шапке), settled только когда прокрутка остановилась.
// setState с тем же числом React пропускает, поэтому при прокрутке внутри слайда ничего не перерисовывается.
//
// по нему переключаются сцены телефона, чтобы они не мелькали при быстром скролле.
export function useSlides(ids: string[]) {
  const [current, setCurrent] = useState(0)
  const [settled, setSettled] = useState(0)

  useEffect(() => {
    const pick = () => {
      const mid = window.innerHeight / 2
      let best = 0, bestDist = Infinity
      ids.forEach((id, k) => {
        const el = document.getElementById(id)
        if (!el) return
        const r = el.getBoundingClientRect()
        const d = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid))
        if (d < bestDist) { bestDist = d; best = k }
      })
      return best
    }
    let t = 0
    const onScroll = () => {
      setCurrent(pick())
      window.clearTimeout(t)
      t = window.setTimeout(() => setSettled(pick()), 220)
    }
    onScroll()
    setSettled(pick())
    window.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => { window.removeEventListener('scroll', onScroll); window.removeEventListener('resize', onScroll); window.clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return { current, settled }
}

export function useMediaQuery(q: string) {
  const [m, setM] = useState(() => typeof matchMedia === 'function' && matchMedia(q).matches)
  useEffect(() => {
    const mq = matchMedia(q)
    const on = () => setM(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [q])
  return m
}
