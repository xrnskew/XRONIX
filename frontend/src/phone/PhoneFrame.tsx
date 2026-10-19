import { useEffect, useState, type ReactNode } from 'react'

const W = 414
const H = 880

// Макет iPhone. Внутри — живой кабинет. Масштабируется по высоте окна, чтобы телефон всегда влезал.
export default function PhoneFrame({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    const fit = () => setScale(Math.min(1, (window.innerHeight - 48) / H, (window.innerWidth - 32) / W))
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  return (
    <div style={{ width: W * scale, height: H * scale }}>
      <div
        className="relative origin-top-left rounded-[58px] bg-[#050506] p-[12px] shadow-[0_40px_80px_-20px_rgba(0,0,0,.55)] ring-1 ring-white/10"
        style={{ width: W, height: H, transform: `scale(${scale})` }}
      >
        <div className="relative h-full w-full overflow-hidden rounded-[46px] bg-bg text-text">
          <div className="absolute left-1/2 top-[10px] z-50 h-[32px] w-[110px] -translate-x-1/2 rounded-full bg-black" aria-hidden />
          <div className="absolute inset-x-0 top-0 z-40 flex h-[52px] items-end justify-between px-8 pb-1 text-[13px] font-semibold" aria-hidden>
            <span>9:41</span>
            <span className="text-[11px] tracking-wide">5G</span>
          </div>
          <div className="absolute inset-0 pt-[52px]">{children}</div>
        </div>
      </div>
    </div>
  )
}
