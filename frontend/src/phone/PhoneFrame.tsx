import { useEffect, useState, type ReactNode } from 'react'
import { uiScale } from '../lib/uiScale'

const W = 414
const H = 880
const R = 60 // радиус скругления корпуса
const DEPTH = 32 // толщина корпуса в 3D, px
const SLICES = 8
const MAX_SCALE = 0.84

// Макет iPhone. Внутри живой кабинет. Масштабируется под окно, чтобы телефон всегда влезал.
//
// Устройство 3D (см. Phone3D): толщина корпуса и тень лежат ОТДЕЛЬНЫМ слоем позади, а лицевая часть
// с экраном это одна плоская картинка (без preserve-3d внутри). Если вложить экран в 3D-сцену, Chrome
// путается, что под курсором: поля ввода перестают ловить мышь, а курсор мигает.
export default function PhoneFrame({ children }: { children: ReactNode }) {
  const [scale, setScale] = useState(1)
  useEffect(() => {
    // На широком экране телефон закреплён и не должен упираться в края окна: оставляем запас под 3D-наклон
    // и не даём ему расти на больших мониторах. На узком экране он лежит над слайдами, ограничение по высоте не нужно.
    const fit = () => {
      const wide = window.innerWidth >= 1024
      setScale(Math.min(wide ? MAX_SCALE * uiScale() : 1, wide ? (window.innerHeight - 150 * uiScale()) / H : 1, (window.innerWidth - 32) / W))
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  const w = W * scale
  const h = H * scale
  const r = R * scale
  const d = DEPTH * scale

  return (
    <div className="relative" style={{ width: w, height: h, transformStyle: 'preserve-3d' }}>
      {/* корпус в глубину: тень и боковые стенки, всё некликабельное */}
      <div className="pointer-events-none absolute inset-0" style={{ transformStyle: 'preserve-3d' }} aria-hidden>
        <div className="absolute" style={{ inset: -40 * scale, transform: `translateZ(${-d - 30}px)`, background: 'radial-gradient(closest-side, rgba(0,0,0,.55), rgba(0,0,0,0))' }} />
        {Array.from({ length: SLICES }, (_, i) => {
          const f = (i + 1) / SLICES
          return <div key={i} className="absolute inset-0" style={{ borderRadius: r, transform: `translateZ(${-f * d}px)`, background: `hsl(240 5% ${28 - f * 15}%)` }} />
        })}
        {[[130, 32], [190, 56], [262, 56]].map(([y, bh]) => (
          <span key={y} className="absolute rounded-l bg-[#2a2a2f]" style={{ left: -3 * scale, top: y * scale, width: 3 * scale, height: bh * scale, transform: `translateZ(${-d / 2}px)` }} />
        ))}
        <span className="absolute rounded-r bg-[#2a2a2f]" style={{ right: -3 * scale, top: 210 * scale, width: 3 * scale, height: 80 * scale, transform: `translateZ(${-d / 2}px)` }} />
      </div>

      {/* лицевая часть: плоская, translateZ(1px) ставит её строго перед корпусом */}
      <div className="absolute inset-0" style={{ transform: 'translateZ(1px)' }}>
        <div
          className="relative origin-top-left rounded-[60px] bg-gradient-to-b from-[#3a3a40] via-[#1a1a1d] to-[#2a2a2f] p-[3px] shadow-[0_50px_90px_-20px_rgba(60,0,0,.55),0_0_0_1px_rgba(255,255,255,.08)] transition-shadow duration-300 group-hover:shadow-[0_50px_90px_-20px_rgba(60,0,0,.55),0_0_0_3px_rgba(255,69,56,.8),0_0_60px_6px_rgba(255,69,56,.35)]"
          style={{ width: W, height: H, transform: `scale(${scale})` }}
        >
          <div className="relative h-full w-full rounded-[57px] bg-black p-[9px]">
            <div className="relative h-full w-full overflow-hidden rounded-[48px] bg-bg text-text">
              <div className="absolute left-1/2 top-[11px] z-50 h-[32px] w-[112px] -translate-x-1/2 rounded-full bg-black" aria-hidden />
              <StatusBar />
              <div className="absolute inset-0 pt-[54px]">{children}</div>
              <div className="pointer-events-none absolute bottom-[8px] left-1/2 z-50 h-[5px] w-[134px] -translate-x-1/2 rounded-full bg-white/80" aria-hidden />
              {/* блик на стекле: широкая полоса, Phone3D сдвигает её transform-ом (дёшево, без перерисовки экрана) */}
              <div className="pointer-events-none absolute inset-0 z-[60] overflow-hidden rounded-[48px]" aria-hidden>
                <div data-glare className="absolute inset-y-0 -left-full w-[300%]" style={{ background: 'linear-gradient(115deg, rgba(255,255,255,0) 42%, rgba(255,255,255,.12) 50%, rgba(255,255,255,0) 58%)' }} />
              </div>
            </div>
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
