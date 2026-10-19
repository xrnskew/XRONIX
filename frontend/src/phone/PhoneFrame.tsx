import { useEffect, useState, type ReactNode } from 'react'

const W = 414
const H = 880

// Макет iPhone. Внутри — живой кабинет. Масштабируется под окно, чтобы телефон всегда влезал.
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
        className="relative origin-top-left rounded-[60px] bg-gradient-to-b from-[#3a3a40] via-[#1a1a1d] to-[#2a2a2f] p-[3px] shadow-[0_50px_90px_-20px_rgba(60,0,0,.65),0_0_0_1px_rgba(255,255,255,.08)]"
        style={{ width: W, height: H, transform: `scale(${scale})` }}
      >
        {/* кнопки на корпусе */}
        <span className="absolute -left-[3px] top-[130px] h-8 w-[3px] rounded-l bg-[#2a2a2f]" aria-hidden />
        <span className="absolute -left-[3px] top-[190px] h-14 w-[3px] rounded-l bg-[#2a2a2f]" aria-hidden />
        <span className="absolute -left-[3px] top-[262px] h-14 w-[3px] rounded-l bg-[#2a2a2f]" aria-hidden />
        <span className="absolute -right-[3px] top-[210px] h-20 w-[3px] rounded-r bg-[#2a2a2f]" aria-hidden />

        <div className="relative h-full w-full rounded-[57px] bg-black p-[9px]">
          <div className="relative h-full w-full overflow-hidden rounded-[48px] bg-bg text-text">
            <div className="absolute left-1/2 top-[11px] z-50 h-[32px] w-[112px] -translate-x-1/2 rounded-full bg-black" aria-hidden />
            <StatusBar />
            <div className="absolute inset-0 pt-[54px]">{children}</div>
            <div className="pointer-events-none absolute bottom-[8px] left-1/2 z-50 h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-white/80" aria-hidden />
            <div className="pointer-events-none absolute inset-0 z-[60] rounded-[48px] bg-gradient-to-br from-white/[.07] via-transparent to-transparent" aria-hidden />
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusBar() {
  return (
    <div className="absolute inset-x-0 top-0 z-40 flex h-[54px] items-end justify-between px-9 pb-[6px] text-[15px] font-semibold" aria-hidden>
      <span>9:41</span>
      <span className="flex items-center gap-[6px]">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5" width="3" height="7" rx="1" /><rect x="10" y="2.5" width="3" height="9.5" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M1.5 4.2a9.5 9.5 0 0113 0M4 7a6 6 0 018 0" /><circle cx="8" cy="10" r="1.2" fill="currentColor" stroke="none" /></svg>
        <svg width="27" height="13" viewBox="0 0 27 13" fill="none"><rect x=".5" y=".5" width="22" height="12" rx="3.5" stroke="currentColor" opacity=".45" /><rect x="2" y="2" width="19" height="9" rx="2.2" fill="currentColor" /><rect x="24" y="4.2" width="2" height="4.6" rx="1" fill="currentColor" opacity=".45" /></svg>
      </span>
    </div>
  )
}
