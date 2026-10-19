import { createContext, useContext, useEffect, useRef, useState, type ElementType, type ReactNode } from 'react'

const still = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const ease = 'cubic-bezier(.2,.75,.2,1)'

// Слайд сообщает вложенным элементам, виден ли он на экране. Анимации проигрываются каждый раз,
// когда слайд снова входит в кадр, а при выходе сбрасываются без анимации (его уже не видно).
const VisibleCtx = createContext(true)
export const useVisible = () => useContext(VisibleCtx)

export function SectionBox({ id, className = '', children }: { id: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null)
  const [visible, setVisible] = useState(still())
  useEffect(() => {
    if (still() || !ref.current) return
    const io = new IntersectionObserver(([e]) => {
      if (e.intersectionRatio >= 0.3) setVisible(true)
      else if (e.intersectionRatio === 0) setVisible(false)
    }, { threshold: [0, 0.3] })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [])
  return (
    <section ref={ref} id={id} className={className}>
      <VisibleCtx.Provider value={visible}>{children}</VisibleCtx.Provider>
    </section>
  )
}

// Плавное появление: прозрачность и сдвиг вверх. Без filter: blur, он дорогой поверх анимированного фона
export function Reveal({ children, delay = 0, y = 22, className = '', as: Tag = 'div' }: { children: ReactNode; delay?: number; y?: number; className?: string; as?: ElementType }) {
  const on = useVisible()
  return (
    <Tag className={className} style={{
      opacity: on ? 1 : 0,
      transform: on ? 'none' : `translateY(${y}px)`,
      transition: on && !still() ? `opacity .8s ${ease} ${delay}ms, transform .8s ${ease} ${delay}ms` : 'none',
    }}>{children}</Tag>
  )
}

// Заголовок по словам: каждое слово выезжает из-под маски
export function SplitText({ text, className = '', delay = 0, step = 55, as: Tag = 'h2' }: { text: string; className?: string; delay?: number; step?: number; as?: ElementType }) {
  const on = useVisible()
  const words = text.split(' ')
  return (
    <Tag className={className} aria-label={text}>
      {words.map((w, i) => (
        <span key={i} aria-hidden>
          <span className="inline-block overflow-hidden pb-[.16em] align-bottom -mb-[.16em]">
            <span className="inline-block" style={{ transform: on ? 'none' : 'translateY(115%)', transition: on && !still() ? `transform .95s ${ease} ${delay + i * step}ms` : 'none' }}>{w}</span>
          </span>
          {i < words.length - 1 ? ' ' : ''}
        </span>
      ))}
    </Tag>
  )
}

// Текст «проявляется» слово за словом, как будто его читают
export function FadeWords({ text, className = '', delay = 0, step = 38 }: { text: string; className?: string; delay?: number; step?: number }) {
  const on = useVisible()
  return (
    <p className={className}>
      <span className="sr-only">{text}</span>
      <span aria-hidden>
        {text.split(' ').map((w, i, a) => (
          <span key={i} style={{ opacity: on ? 1 : 0.12, transition: on && !still() ? `opacity .6s ease ${delay + i * step}ms` : 'none' }}>{w}{i < a.length - 1 ? ' ' : ''}</span>
        ))}
      </span>
    </p>
  )
}
