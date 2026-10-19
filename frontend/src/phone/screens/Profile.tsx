import { useContext, useState } from 'react'
import { Card, Chip, Screen, SectionTitle, Wide } from '../ui'
import { useCabinet } from '../CabinetContext'
import { ApiError } from '../../api'

const field = 'h-12 w-full rounded-xl bg-surface-2 px-3.5 text-[15px] text-text outline-none ring-1 ring-white/5 focus:ring-2 focus:ring-accent'

export default function ProfileScreen() {
  const { user, saveProfile, signOut } = useCabinet()
  const wide = useContext(Wide)
  const [draft, setDraft] = useState(() => ({ name: user?.name ?? '', city: user?.city ?? '', experience: user?.experience ?? '', budget: user?.budget_rub == null ? '' : String(user.budget_rub) }))
  const [tag, setTag] = useState('')
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; text?: string }>({ kind: 'idle' })
  if (!user) return null

  const dirty = draft.name !== user.name || draft.city !== (user.city ?? '') || draft.experience !== (user.experience ?? '') || draft.budget !== (user.budget_rub == null ? '' : String(user.budget_rub))
  const set = (k: keyof typeof draft, v: string) => { setDraft({ ...draft, [k]: v }); setState({ kind: 'idle' }) }

  async function run(patch: Parameters<typeof saveProfile>[0]) {
    setState({ kind: 'saving' })
    try { await saveProfile(patch); setState({ kind: 'saved' }) }
    catch (e) { setState({ kind: 'error', text: e instanceof ApiError ? e.message : 'Не удалось сохранить. Попробуйте ещё раз.' }) }
  }
  const save = () => {
    const budget = draft.budget.replace(/\s/g, '')
    if (budget && !/^\d+$/.test(budget)) return setState({ kind: 'error', text: 'Бюджет укажите числом в рублях, например 500000.' })
    if (!draft.name.trim()) return setState({ kind: 'error', text: 'Имя не может быть пустым.' })
    run({ name: draft.name.trim(), city: draft.city.trim() || null, experience: draft.experience.trim() || null, budget_rub: budget ? Number(budget) : null })
  }
  const addTag = () => {
    const t = tag.trim().slice(0, 30)
    setTag('')
    if (t && !user.tags.includes(t) && user.tags.length < 12) run({ tags: [...user.tags, t] })
  }

  const filled = [user.name, user.city, user.experience, user.budget_rub, user.tags.length].filter(Boolean).length
  const pct = Math.round((filled / 5) * 100)

  return (
    <Screen title="Профиль" sub={wide ? 'Эти данные ИИ учитывает в каждом плане' : undefined}>
      <Card delay={0} span={7}>
        <div className="flex items-center gap-3.5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#ff6a5c] to-[#d12419] text-[22px] font-bold" aria-hidden>{user.name[0]?.toUpperCase()}</div>
          <div className="min-w-0">
            <div className="truncate text-[18px] font-bold leading-tight">{user.name}</div>
            <div className="truncate text-[13px] text-muted">{user.email}</div>
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-[12px] text-muted"><span>Профиль заполнен</span><span>{pct}%</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
        </div>
        <div className={`mt-4 ${wide ? 'grid grid-cols-2 gap-x-4 gap-y-3' : 'space-y-3'}`}>
          <Field label="Имя" value={draft.name} onChange={(v) => set('name', v)} />
          <Field label="Город" value={draft.city} onChange={(v) => set('city', v)} />
          <Field label="Опыт" value={draft.experience} onChange={(v) => set('experience', v)} />
          <Field label="Стартовый бюджет, ₽" value={draft.budget} onChange={(v) => set('budget', v)} inputMode="numeric" />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button onClick={save} disabled={!dirty || state.kind === 'saving'} className="h-11 rounded-xl bg-fill px-5 text-[14px] font-semibold text-white transition-opacity disabled:opacity-35">
            {state.kind === 'saving' ? 'Сохраняем…' : 'Сохранить'}
          </button>
          <span role="status" className={`text-[13px] ${state.kind === 'error' ? 'text-accent' : 'text-ok'}`}>{state.kind === 'saved' ? 'Сохранено' : state.kind === 'error' ? state.text : ''}</span>
        </div>
      </Card>

      <Card id="profile-tags" delay={1} span={5} className="self-start">
        <SectionTitle>Что ИИ знает о вас</SectionTitle>
        <p className="-mt-1.5 mb-3 text-[13px] leading-snug text-muted">Теги учитываются в каждом ответе. Нажмите на тег, чтобы удалить, или добавьте свой.</p>
        {user.tags.length === 0 && <p className="mb-3 text-[13px] text-muted">Тегов пока нет. После первого плана ИИ добавит их сам.</p>}
        <div className="flex flex-wrap gap-1.5">
          {user.tags.map((t) => (
            <Chip key={t} onClick={() => run({ tags: user.tags.filter((x) => x !== t) })}>{t}<span className="ml-1.5 text-muted" aria-label="удалить">×</span></Chip>
          ))}
        </div>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); addTag() }}>
          <input aria-label="Новый тег" className={field} placeholder="Новый тег" value={tag} maxLength={30} onChange={(e) => setTag(e.target.value)} />
          <button className="h-12 shrink-0 rounded-xl bg-surface-2 px-5 text-[14px] font-semibold">Добавить</button>
        </form>
      </Card>

      {!wide && <button onClick={signOut} className="h-12 w-full rounded-2xl bg-surface-2 text-[15px] font-semibold text-accent active:bg-surface-3">Выйти</button>}
    </Screen>
  )
}

function Field({ label, value, onChange, inputMode }: { label: string; value: string; onChange: (v: string) => void; inputMode?: 'numeric' }) {
  return <label className="block text-[13px] text-muted">{label}<input className={`${field} mt-1`} value={value} onChange={(e) => onChange(e.target.value)} inputMode={inputMode} /></label>
}
