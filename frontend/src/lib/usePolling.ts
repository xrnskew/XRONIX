import { useEffect, useRef } from 'react'

// Опрос сервера раз в ms, пока enabled. На скрытой вкладке не опрашивает, а при возврате
// обновляет сразу — статус заявки виден свежим, и сервер не получает лишних запросов.
// fn берётся последний, поэтому его не нужно оборачивать в useCallback.
export function usePolling(fn: () => unknown, ms: number, enabled = true) {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!enabled) return
    const t = setInterval(() => { if (!document.hidden) ref.current() }, ms)
    const onShow = () => { if (!document.hidden) ref.current() }
    document.addEventListener('visibilitychange', onShow)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onShow) }
  }, [ms, enabled])
}
