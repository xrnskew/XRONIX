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

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
let animRaf = 0

// Плавная прокрутка окна к y за ms. Своя, а не scroll-behavior: так листание всегда одинаковое по скорости.
export function scrollToY(y: number, ms = 700) {
  cancelAnimationFrame(animRaf)
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches
  const from = window.scrollY
  const to = Math.max(0, Math.min(y, document.documentElement.scrollHeight - window.innerHeight))
  if (still || ms <= 0 || Math.abs(to - from) < 2) { window.scrollTo(0, to); return }
  const t0 = performance.now()
  const step = (t: number) => {
    const p = Math.min(1, (t - t0) / ms)
    window.scrollTo(0, from + (to - from) * easeInOut(p))
    if (p < 1) animRaf = requestAnimationFrame(step)
  }
  animRaf = requestAnimationFrame(step)
}

export const goToSlide = (id: string) => {
  const el = document.getElementById(id)
  if (el) scrollToY(el.getBoundingClientRect().top + window.scrollY)
}

// Можно ли прокрутить что-то внутри (например, экран телефона) в эту сторону. Тогда колесо отдаём ему.
function innerCanScroll(target: EventTarget | null, dy: number) {
  for (let el = target as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    const oy = getComputedStyle(el).overflowY
    if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 1) {
      if (dy > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true
    }
  }
  return false
}

// Листание по слайдам: один жест колесом или трекпадом = один слайд.
// Пока идёт анимация и пока не кончилась инерция трекпада (пауза в событиях), новые шаги не делаем,
// поэтому длинный свайп не пролистывает сразу несколько слайдов. Если слайд выше экрана (низкое окно),
// сначала прокручиваем его содержимое обычным образом и только у края переходим к следующему.
// Клавиши: стрелки, PageUp/PageDown, пробел, Home/End. На узких экранах ничего не перехватываем.
export function useSlideScroll(ids: string[], enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    let locked = false
    let lastWheel = 0
    let acc = 0

    const sections = () => ids.map((id) => document.getElementById(id)).filter(Boolean) as HTMLElement[]
    const currentIndex = () => {
      const mid = window.innerHeight / 2
      const list = sections()
      let best = 0
      list.forEach((el, k) => { if (el.getBoundingClientRect().top <= mid) best = k })
      return best
    }
    const go = (dir: 1 | -1) => {
      const list = sections()
      const i = currentIndex()
      const el = list[i]
      const r = el.getBoundingClientRect()
      // высокий слайд: сначала дочитать его (если хвост заметный, мелкий хвост просто проскакиваем)
      const tail = window.innerHeight * 0.15
      if (dir > 0 && r.bottom > window.innerHeight + tail) { scrollToY(window.scrollY + Math.min(r.bottom - window.innerHeight, window.innerHeight * 0.8), 450); return }
      if (dir < 0 && r.top < -tail) { scrollToY(window.scrollY + Math.max(r.top, -window.innerHeight * 0.8), 450); return }
      const next = list[Math.max(0, Math.min(list.length - 1, i + dir))]
      if (next !== el) scrollToY(next.getBoundingClientRect().top + window.scrollY)
    }
    const lock = (ms: number) => { locked = true; window.setTimeout(() => { locked = false }, ms) }

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) < Math.abs(e.deltaX)) return // зум и горизонтальная прокрутка
      if (innerCanScroll(e.target, e.deltaY)) return
      e.preventDefault()
      // Колесо над телефоном принадлежит телефону: дошли до края его экрана, и всё, слайды не листаем
      if ((e.target as Element | null)?.closest?.('aside')) return
      const now = performance.now()
      const idle = now - lastWheel
      lastWheel = now
      if (locked) return
      // новый жест после паузы, либо накопили достаточно (мышь даёт ~100 за щелчок, трекпад мелкими порциями)
      if (idle > 220) acc = 0
      acc += e.deltaY
      if (Math.abs(acc) < 30) return
      const dir = acc > 0 ? 1 : -1
      acc = 0
      go(dir)
      // Блокируем на время анимации и дальше, пока идёт хвост инерции трекпада (события чаще, чем раз в 220 мс)
      locked = true
      const waitQuiet = () => { if (performance.now() - lastWheel < 220) window.setTimeout(waitQuiet, 120); else locked = false }
      window.setTimeout(waitQuiet, 750)
    }

    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement
      if (t.closest('input, textarea, select, [contenteditable="true"], aside')) return
      const map: Record<string, 1 | -1> = { ArrowDown: 1, PageDown: 1, ArrowUp: -1, PageUp: -1 }
      let dir = map[e.key]
      if (e.key === ' ') dir = e.shiftKey ? -1 : 1
      if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault()
        const list = sections()
        scrollToY((e.key === 'Home' ? list[0] : list[list.length - 1]).getBoundingClientRect().top + window.scrollY)
        return
      }
      if (!dir) return
      e.preventDefault()
      if (!locked) { go(dir); lock(650) }
    }

    window.addEventListener('wheel', onWheel, { passive: false })
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('wheel', onWheel); window.removeEventListener('keydown', onKey) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled])
}
