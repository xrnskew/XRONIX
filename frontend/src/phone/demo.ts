// Сцены автопоказа: презентация слева выбирает сцену, телефон её отыгрывает.
export type Scene = 'login' | 'chat-empty' | 'chat-demo' | 'chat-final' | 'plan' | 'credit' | 'memory' | 'hold'

export const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

// Прокручивает экран ВНУТРИ телефона (не страницу). Телефон масштабируется через transform, поэтому
// расстояния из getBoundingClientRect приводим к масштабу самого контейнера.
export function scrollPhone(targetId: string | null, smooth = true) {
  const box = document.querySelector<HTMLElement>('[data-phone-scroll]')
  if (!box) return
  const behavior: ScrollBehavior = smooth && !reduceMotion() ? 'smooth' : 'auto'
  if (!targetId) return box.scrollTo({ top: 0, behavior })
  const t = document.getElementById(targetId)
  if (!t) return
  const k = box.clientHeight ? box.getBoundingClientRect().height / box.clientHeight : 1
  const top = (t.getBoundingClientRect().top - box.getBoundingClientRect().top) / k + box.scrollTop - 6
  box.scrollTo({ top, behavior })
}
