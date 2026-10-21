import { useEffect, useState } from 'react'

// true, пока экран подходит под медиазапрос; обновляется при изменении размера окна
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
