import { useEffect, useState } from 'react'
import { errorText } from '../../../api'
import { conveyor } from '../../../api/conveyor'
import type { Company, MemberRole, RegistryCompany } from '../../../types/conveyor'
import { innHint } from '../../../lib/inn'
import { Card, Chip, SectionTitle } from '../../ui'
import { ErrorText, Label, input, memberRoles, primaryBtn } from '../parts'

// Тестовые ИНН из README: проверяющему не нужно искать настоящий ИНН с верной контрольной суммой
const TEST_COMPANIES: [string, string][] = [['Северная выпечка', '7715881399'], ['ИП Лебедев', '777309114120'], ['Вектор Логистик', '7768151886']]

// Шаг мастера: 1. Компания по ИНН
export default function CompanyStep({ onDone }: { onDone: (c: Company) => void }) {
  const [list, setList] = useState<Company[] | null>(null)
  const [inn, setInn] = useState('')
  const [blurred, setBlurred] = useState(false)
  const [found, setFound] = useState<RegistryCompany | null>(null)
  const [role, setRole] = useState<MemberRole | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { conveyor.listCompanies().then((l) => setList(l.filter((c) => c.registry.kind !== 'person'))).catch(() => setList([])) }, [])
  const clean = inn.replace(/\D/g, '')
  const hint = innHint(inn, blurred)
  const canSearch = (clean.length === 10 || clean.length === 12) && !innHint(clean, true)

  const search = async () => {
    setBusy(true); setError(''); setFound(null)
    try { setFound(await conveyor.registry(clean)) } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }
  const confirm = async () => {
    if (!role) return
    setBusy(true); setError('')
    try { onDone(await conveyor.addCompany(clean, role)) } catch (e) { setError(errorText(e)) } finally { setBusy(false) }
  }

  return (
    <>
      {list && list.length > 0 && (
        <Card span={12}>
          <SectionTitle>Ваши компании</SectionTitle>
          <div className="grid gap-2 sm:grid-cols-2">
            {list.map((c) => (
              <button key={c.id} onClick={() => onDone(c)} className="rounded-xl bg-surface-2 p-3.5 text-left transition-colors hover:bg-surface-3">
                <div className="font-semibold">{c.registry.name}</div>
                <div className="mt-0.5 text-[13px] text-muted">ИНН {c.registry.inn} · {memberRoles[c.member_role].title}</div>
              </button>
            ))}
          </div>
        </Card>
      )}
      <Card span={12}>
        <SectionTitle>{list?.length ? 'Другая компания' : 'Ваша компания'}</SectionTitle>
        <p className="mb-4 text-[14px] text-muted">Введите ИНН — остальное подтянем из реестра. Повторно вводить реквизиты не придётся.</p>
        <form className="flex flex-col gap-3 sm:flex-row sm:items-start" onSubmit={(e) => { e.preventDefault(); if (canSearch) search() }}>
          <div className="flex-1">
            <Label text="ИНН компании или ИП">
              <input id="inn" className={`${input} tabular-nums`} inputMode="numeric" autoComplete="off" value={inn} maxLength={14} placeholder="10 или 12 цифр"
                onChange={(e) => { setInn(e.target.value); setFound(null); setBlurred(false) }} onBlur={() => setBlurred(true)} aria-invalid={!!hint} aria-describedby="inn-hint" />
            </Label>
            <p id="inn-hint" className="mt-1 min-h-[18px] text-[12px] text-accent">{hint}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[12px] text-muted" role="group" aria-label="Тестовые ИНН">
              <span>Нет своего ИНН? Тестовая компания:</span>
              {TEST_COMPANIES.map(([title, value]) => (
                <button key={value} type="button" className="rounded-full bg-surface-2 px-2.5 py-1 text-text transition-colors hover:bg-surface-3" onClick={() => { setInn(value); setFound(null); setBlurred(true) }}>{title}</button>
              ))}
            </div>
          </div>
          <button className={`${primaryBtn} sm:mt-[22px]`} disabled={!canSearch || busy}>{busy && !found ? 'Ищем…' : 'Найти'}</button>
        </form>
        <ErrorText>{error}</ErrorText>
        {found && (
          <div className="mt-4 rounded-2xl bg-surface-2 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-[17px] font-semibold">{found.name}</div>
              <span className={`text-[13px] ${found.status === 'active' ? 'text-ok' : 'text-accent'}`}>{found.status === 'active' ? 'Действует' : 'Не действует'}</span>
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-2 text-[14px] sm:grid-cols-2">
              <div><dt className="text-[12px] text-muted">{found.kind === 'ip' ? 'ОГРНИП' : 'ОГРН'}</dt><dd className="tabular-nums">{found.ogrn}</dd></div>
              <div><dt className="text-[12px] text-muted">Зарегистрирована</dt><dd>{found.registered_at ? new Date(found.registered_at).toLocaleDateString('ru-RU') : '—'}</dd></div>
              <div><dt className="text-[12px] text-muted">{found.kind === 'ip' ? 'Предприниматель' : 'Руководитель'}</dt><dd>{found.head_name}</dd></div>
              <div><dt className="text-[12px] text-muted">Основной ОКВЭД</dt><dd>{found.okved ? `${found.okved.code} · ${found.okved.name}` : '—'}</dd></div>
            </dl>
            <p className="mt-2 text-[12px] text-muted">Источник: {found.source}</p>
            <div className="mt-4 text-[14px] font-medium">Кто вы в компании?</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {Object.entries(memberRoles).map(([k, r]) => <Chip key={k} active={role === k} onClick={() => setRole(k as MemberRole)}>{r.title}</Chip>)}
            </div>
            {role && memberRoles[role].needs_authority && <p className="mt-2 text-[13px] leading-snug text-warn">Банк попросит доверенность или приказ о полномочиях. Его можно будет загрузить в заявке.</p>}
            <button onClick={confirm} disabled={!role || busy} className={`${primaryBtn} mt-4`}>Это моя компания</button>
          </div>
        )}
      </Card>
    </>
  )
}
