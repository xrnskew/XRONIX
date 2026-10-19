import { useEffect, useState } from 'react'

// Вёрстка нарисована под окно 1440×900. На больших мониторах всю композицию увеличиваем
// одним коэффициентом, сохраняя пропорции: иначе текст и телефон выглядят мелкими посреди пустоты.
// На 1440×900 и меньше коэффициент 1, ничего не меняется.
export const BASE_W = 1440
export const BASE_H = 900
export const uiScale = () => Math.max(1, Math.min(1.8, window.innerWidth / BASE_W, window.innerHeight / BASE_H))

export function useUiScale() {
  const [k, setK] = useState(uiScale)
  useEffect(() => {
    const on = () => setK(uiScale())
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])
  useEffect(() => { document.documentElement.style.setProperty('--ui', String(k)) }, [k])
  return k
}
