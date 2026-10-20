// Сцены автопоказа: презентация слева выбирает сцену, телефон её отыгрывает.
export type Scene = 'login' | 'chat-empty' | 'chat-demo' | 'chat-final' | 'plan' | 'credit' | 'memory' | 'hold'

export const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// Прокручивает экран ВНУТРИ телефона (не страницу). Считаем по offsetTop: он не зависит от масштаба и 3D-наклона телефона.
function offsetWithin(el: HTMLElement, box: HTMLElement) {
  let y = 0
  for (let n: HTMLElement | null = el; n && n !== box; n = n.offsetParent as HTMLElement | null) y += n.offsetTop
  return y
}

export function scrollPhone(targetId: string | null, smooth = true) {
  const box = document.querySelector<HTMLElement>('[data-phone-scroll]')
  if (!box) return
  const behavior: ScrollBehavior = smooth && !reduceMotion() ? 'smooth' : 'auto'
  const t = targetId ? document.getElementById(targetId) : null
  box.scrollTo({ top: t ? offsetWithin(t, box) - 6 : 0, behavior })
}
