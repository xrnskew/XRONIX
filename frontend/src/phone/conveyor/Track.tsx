import { AUTO_STATUSES, type Status } from '../../types/conveyor'

// Путь заявки как лента конвейера: шесть этапов, пройденные участки залиты, по текущему
// едет штриховка, пока банк обрабатывает заявку сам. Главный визуальный акцент кабинета.
export const STAGES = ['Подача', 'Проверка', 'Оценка', 'Решение', 'Подписание', 'Выдача']
export const STAGE: Record<Status, number> = { draft: 0, submitted: 1, checking: 1, info_requested: 1, scoring: 2, manual_review: 3, approved: 3, counter_offer: 3, declined: 3, signing: 4, funded: 5, withdrawn: 0, cancelled: 3 }
const STOPPED: Status[] = ['declined', 'cancelled', 'withdrawn']

function state(status: Status) {
  const cur = STAGE[status]
  return { cur, done: status === 'funded', stopped: STOPPED.includes(status), moving: AUTO_STATUSES.includes(status) || status === 'manual_review' }
}

const Check = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
const Cross = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6L6 18" /></svg>

export function ConveyorTrack({ status }: { status: Status }) {
  const { cur, done, stopped, moving } = state(status)
  return (
    <div>
      <ol className="flex items-center sm:mb-7" aria-label="Этапы заявки">
        {STAGES.map((s, i) => {
          const passed = done || i < cur, here = !done && i === cur
          const align = i === 0 ? 'left-0' : i === STAGES.length - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2'
          return (
            <li key={s} aria-current={here ? 'step' : undefined} aria-label={`${s}: ${passed ? 'пройдено' : here ? (stopped ? 'остановлено' : 'сейчас') : 'впереди'}`} className={`flex items-center ${i < STAGES.length - 1 ? 'flex-1' : ''}`}>
              <span className="relative">
                <span className={`pop flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[12px] font-semibold tabular-nums ${
                  passed ? 'bg-ok text-[#06240f]' : here ? (stopped ? 'bg-accent/20 text-accent ring-1 ring-accent/50' : `bg-fill text-white ${moving ? 'node-pulse' : ''}`) : 'bg-surface-3 text-muted'}`}
                  style={{ animationDelay: `${i * 70}ms` }}>
                  {passed ? <Check /> : here && stopped ? <Cross /> : i + 1}
                </span>
                <span className={`absolute top-9 hidden whitespace-nowrap text-[12px] sm:block ${align} ${here ? 'font-semibold text-text' : 'text-muted'}`} aria-hidden>{s}</span>
              </span>
              {i < STAGES.length - 1 && (
                <span className="mx-1.5 h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                  {passed && (done || i + 1 <= cur) ? <span className="fill-in block h-full rounded-full bg-ok" style={{ animationDelay: `${i * 70 + 80}ms` }} />
                    : here && moving ? <span className="belt block h-full w-full rounded-full bg-fill/80" /> : null}
                </span>
              )}
            </li>
          )
        })}
      </ol>
      <p className="mt-2 text-[13px] text-muted sm:hidden">Этап {Math.min(cur + 1, 6)} из 6 · <span className="font-medium text-text">{STAGES[cur]}</span></p>
    </div>
  )
}

// Мини-лента для списка заявок
export function MiniTrack({ status }: { status: Status }) {
  const { cur, done, stopped, moving } = state(status)
  return (
    <div className="flex gap-1" aria-hidden>
      {STAGES.map((s, i) => (
        <span key={s} className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
          {(done || i < cur) && <span className="block h-full bg-ok" />}
          {!done && i === cur && <span className={`block h-full ${stopped ? 'bg-accent/60' : moving ? 'belt bg-fill/80' : 'bg-fill'}`} />}
        </span>
      ))}
    </div>
  )
}
