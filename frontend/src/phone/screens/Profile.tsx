import { useContext, useState } from 'react'
import { Card, Chip, Screen, Wide } from '../ui'
import { useCabinet } from '../CabinetContext'
import { ApiError } from '../../api'
import CityPicker from '../components/CityPicker'
import AccountSecurity from './AccountSecurity'

const field = 'h-12 w-full rounded-xl bg-surface-2 px-3.5 text-[15px] text-text outline-none ring-1 ring-white/5 focus:ring-2 focus:ring-accent'

export default function ProfileScreen() {
  const { user, saveProfile, signOut } = useCabinet()
  const wide = useContext(Wide)
  const [draft, setDraft] = useState(() => ({ name: user?.name ?? '', city: user?.city ?? '' }))
  const [tag, setTag] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const [state, setState] = useState<{ kind: 'idle' | 'saving' | 'saved' | 'error'; text?: string }>({ kind: 'idle' })
  if (!user) return null

  const dirty = draft.name !== user.name || draft.city !== (user.city ?? '')
  const set = (k: keyof typeof draft, v: string) => { setDraft({ ...draft, [k]: v }); setState({ kind: 'idle' }) }

  async function run(patch: Parameters<typeof saveProfile>[0]) {
    setState({ kind: 'saving' })
    try { await saveProfile(patch); setState({ kind: 'saved' }) }
    catch (e) { setState({ kind: 'error', text: e instanceof ApiError ? e.message : 'Не удалось сохранить. Попробуйте ещё раз.' }) }
  }
  const save = () => {
    if (!draft.name.trim()) return setState({ kind: 'error', text: 'Имя не может быть пустым.' })
    const city = draft.city.trim() || null
    run({ name: draft.name.trim(), city })
  }
  const addTag = () => {
    const t = tag.trim().slice(0, 30)
    setTag('')
    if (t && !user.tags.includes(t) && user.tags.length < 12) run({ tags: [...user.tags, t] })
  }

  // Опыт и деньги на старт — свойства конкретного бизнеса: чат спрашивает их для каждого бизнеса, в профиле их нет
  const clearTags = async () => { setConfirmClear(false); await run({ tags: [] }) }

  return (
    <Screen title="Профиль" sub={wide ? 'Город подставляется в чат по умолчанию' : undefined}>
      <Card delay={0} span={7}>
        <div className="flex items-center gap-3.5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#ff6a5c] to-[#d12419] text-[22px] font-bold" aria-hidden>{user.name[0]?.toUpperCase()}</div>
          <div className="min-w-0">
            <div className="truncate text-[18px] font-bold leading-tight">{user.name}</div>
            <div className="truncate text-[13px] text-muted">{user.email}</div>
          </div>
        </div>
        <div className={`mt-4 ${wide ? 'grid grid-cols-2 gap-x-4 gap-y-3' : 'space-y-3'}`}>
          <Field label="Имя" value={draft.name} onChange={(v) => set('name', v)} />
          <CityPicker quiet value={draft.city} onChange={(v) => set('city', v)} />
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button onClick={save} disabled={!dirty || state.kind === 'saving'} className="h-11 rounded-xl bg-fill px-5 text-[14px] font-semibold text-white transition-opacity disabled:opacity-35">
            {state.kind === 'saving' ? 'Сохраняем…' : 'Сохранить'}
          </button>
          <span role="status" className={`text-[13px] ${state.kind === 'error' ? 'text-accent' : 'text-ok'}`}>{state.kind === 'saved' ? 'Сохранено' : state.kind === 'error' ? state.text : ''}</span>
        </div>
      </Card>

      <Card id="profile-tags" delay={1} span={5} className="self-start">
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-[17px] font-semibold tracking-tight">Ваши теги</h2>
          {user.tags.length > 0 && !confirmClear && (
            <button type="button" onClick={() => setConfirmClear(true)} className="text-[13px] text-muted underline-offset-2 transition-colors hover:text-accent hover:underline">Удалить все теги</button>
          )}
          {confirmClear && (
            <span className="flex items-center gap-2 text-[13px]" role="group" aria-label="Подтвердите удаление всех тегов">
              <span className="text-muted">Удалить все?</span>
              <button type="button" onClick={clearTags} className="font-semibold text-accent">Да</button>
              <button type="button" onClick={() => setConfirmClear(false)} className="text-muted hover:text-text">Нет</button>
            </span>
          )}
        </div>
        <p className="mb-3 text-[13px] leading-snug text-muted">Интересы и предпочтения для консультаций. Нажмите на тег, чтобы удалить его. Менять теги можете только вы.</p>
        {user.tags.length === 0 && <p className="mb-3 text-[13px] text-muted">Тегов пока нет. При желании добавьте их вручную.</p>}
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

      <AccountSecurity />

      {!wide && <button onClick={signOut} className="h-12 w-full rounded-2xl bg-surface-2 text-[15px] font-semibold text-accent active:bg-surface-3">Выйти</button>}
    </Screen>
  )
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return <label className="block text-[13px] text-muted">{label}<input className={`${field} mt-1`} value={value} onChange={(e) => onChange(e.target.value)} /></label>
}
