import { useEffect, useState } from 'react'
import { errorText } from '../../../api'
import { conveyor } from '../../../api/conveyor'
import type { Company } from '../../../types/conveyor'
import { innHint } from '../../../lib/inn'
import { Card, SectionTitle } from '../../ui'
import { ErrorText, Label, ghostBtn, input, primaryBtn } from '../parts'

// Шаг мастера: Основатель: бизнеса ещё нет, заявка как будущий ИП по личному ИНН
export default function FounderStep({ onBack, onDone }: { onBack: () => void; onDone: (c: Company) => void }) {
  const [list, setList] = useState<Company[]>([])
  const [inn, setInn] = useState('')
  const [blurred, setBlurred] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { conveyor.listCompanies().then((l) => setList(l.filter((c) => c.registry.kind === 'person'))).catch(() => {}) }, [])
  const clean = inn.replace(/\D/g, '')
  const hint = clean && clean.length !== 12 && blurred ? 'Личный ИНН — 12 цифр' : innHint(inn, blurred)
  const ok = clean.length === 12 && !innHint(clean, true)
  const go = async () => {
    setBusy(true); setError('')
    try { onDone(await conveyor.addCompany(clean, 'owner', true)) } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  return (
    <Card span={12}>
      <SectionTitle>Заявка как будущий ИП</SectionTitle>
      <p className="mb-4 text-[14px] leading-snug text-muted">Бизнеса ещё нет — кредит оформим на вас, а ИП нужно будет зарегистрировать до подписания договора. Для проверки кредитной истории нужен личный ИНН: 12 цифр, есть в Госуслугах и в налоговой.</p>
      {list.map((c) => (
        <button key={c.id} onClick={() => onDone(c)} className="mb-3 block w-full rounded-xl bg-surface-2 p-3.5 text-left hover:bg-surface-3">
          <div className="font-semibold">{c.registry.name}</div><div className="text-[13px] text-muted">ИНН {c.registry.inn}</div>
        </button>
      ))}
      <form className="flex flex-col gap-3 sm:flex-row sm:items-start" onSubmit={(e) => { e.preventDefault(); if (ok) go() }}>
        <div className="flex-1">
          <Label text="Личный ИНН">
            <input id="person-inn" className={`${input} tabular-nums`} inputMode="numeric" autoComplete="off" value={inn} maxLength={14} placeholder="12 цифр"
              onChange={(e) => { setInn(e.target.value); setBlurred(false) }} onBlur={() => setBlurred(true)} aria-invalid={!!hint} aria-describedby="person-inn-hint" />
          </Label>
          <p id="person-inn-hint" className="mt-1 min-h-[18px] text-[12px] text-accent">{hint}</p>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
            <span>Нет личного ИНН?</span>
            <button type="button" className="rounded-full bg-surface-2 px-2.5 py-1 text-text transition-colors hover:bg-surface-3" onClick={() => { setInn('772519083310'); setBlurred(true) }}>Подставить тестовый</button>
          </div>
        </div>
        <button className={`${primaryBtn} sm:mt-[22px]`} disabled={!ok || busy}>{busy ? 'Сохраняем…' : 'Продолжить'}</button>
      </form>
      <ErrorText>{error}</ErrorText>
      <button onClick={onBack} className={`${ghostBtn} mt-2`}>Назад</button>
    </Card>
  )
}
