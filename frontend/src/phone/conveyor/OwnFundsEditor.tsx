import { useState } from 'react'
import { errorText } from '../../api'
import { rub } from '../../lib/format'
import { recordSuccessor } from '../../lib/planAlias'
import { ReplanError, recalcWithOwnFunds } from '../../lib/replan'
import type { Plan } from '../../types/plan'
import { ErrorText, Label, MoneyInput, miniBtn, primaryBtn } from './parts'
import type { CalculatedPlan } from './wizard/types'

// Изменить свои деньги и пересчитать весь план: запуск остаётся по ответам из чата, а нехватка, сумма и срок кредита, платёж и вердикт меняются.
// open/onOpenChange — снаружи, чтобы кнопка в причине отказа могла раскрыть редактор.
export default function OwnFundsEditor({ planId, plan, needed, open, onOpenChange, onRecalculated }: {
  planId: string; plan: Plan; needed?: number | null; open: boolean; onOpenChange: (v: boolean) => void; onRecalculated: (c: CalculatedPlan, message: string) => void
}) {
  const current = plan.finance.own_funds_rub
  const [value, setValue] = useState<number | null>(current)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<string | null>(null)

  const run = async () => {
    if (value == null) return
    setBusy(true); setError(''); setDone(null)
    try {
      const gapBefore = plan.finance.funding_gap_rub
      const next = await recalcWithOwnFunds(planId, value)
      recordSuccessor(planId, next.plan_id, next.plan) // прежний план в чате и ссылках теперь ведёт на этот
      const message = `План пересчитан: своих ${rub(next.plan.finance.own_funds_rub)}, не хватает ${rub(next.plan.finance.funding_gap_rub)} (было ${rub(gapBefore)}).`
      setDone(message)
      onRecalculated(next, message)
    } catch (e) { setError(e instanceof ReplanError ? e.message : errorText(e)) } finally { setBusy(false) }
  }

  return (
    <div className="mt-4 rounded-2xl bg-surface-2/70 p-4 ring-1 ring-white/5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-[14px]"><span className="text-muted">Свои деньги на запуск:</span> <span className="font-semibold tabular-nums">{rub(current)}</span></div>
        {!open && <button type="button" onClick={() => onOpenChange(true)} className={miniBtn}>Изменить свои средства</button>}
      </div>
      {done && <p role="status" className="mt-2 text-[13px] font-medium text-ok">{done}</p>}
      {open && (
        <div className="mt-4 space-y-3">
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_auto]">
            <Label text="Сколько своих денег вложите" hint={needed ? `Для «Старт» нужно не меньше ${rub(needed)}.` : undefined}>
              <MoneyInput id="own-funds" value={value} onChange={setValue} placeholder="Например, 760 000" />
            </Label>
            {needed ? <button type="button" onClick={() => setValue(needed)} className={miniBtn}>Указать {rub(needed)}</button> : null}
          </div>
          <p className="text-[12px] leading-snug text-muted">Пересчитаем весь план: стоимость запуска останется по вашим ответам из чата, а нехватка, сумма кредита, срок, платёж и вывод изменятся. Новый план появится и в разделах «План» и «Финансы».</p>
          <ErrorText>{error}</ErrorText>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={run} disabled={busy || value == null || value === current} className={primaryBtn}>{busy ? 'Считаем…' : 'Пересчитать план'}</button>
            <button type="button" onClick={() => onOpenChange(false)} disabled={busy} className={miniBtn + ' self-center'}>Закрыть</button>
          </div>
        </div>
      )}
    </div>
  )
}
