import { useState } from 'react'
import { Card, Chip, Screen, SectionTitle } from '../ui'
import { useCabinet } from '../PlanContext'

export default function ProfileScreen() {
  const { profile, setProfile } = useCabinet()
  const [tag, setTag] = useState('')
  const field = 'h-12 w-full rounded-xl bg-surface-2 px-3.5 text-[15px] text-text outline-none ring-1 ring-white/5 focus:ring-2 focus:ring-accent'
  const set = (k: 'city' | 'experience', v: string) => setProfile({ ...profile, [k]: v })
  const addTag = () => {
    const t = tag.trim()
    if (t && !profile.tags.includes(t)) setProfile({ ...profile, tags: [...profile.tags, t] })
    setTag('')
  }
  const filled = [profile.name, profile.city, profile.experience, profile.budget_rub, profile.tags.length].filter(Boolean).length
  const pct = Math.round((filled / 5) * 100)
  return (
    <Screen title="Профиль">
      <Card>
        <div className="flex items-center gap-3.5">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#ff6a5c] to-[#d12419] text-[22px] font-bold" aria-hidden>{profile.name[0]}</div>
          <div className="min-w-0">
            <div className="text-[18px] font-bold leading-tight">{profile.name}</div>
            <div className="text-[13px] text-muted">{profile.email}</div>
          </div>
        </div>
        <div className="mt-4">
          <div className="mb-1.5 flex justify-between text-[12px] text-muted"><span>Профиль заполнен</span><span>{pct}%</span></div>
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-accent transition-all" style={{ width: `${pct}%` }} /></div>
        </div>
        <div className="mt-4 space-y-3">
          <label className="block text-[13px] text-muted">Город<input className={`${field} mt-1`} value={profile.city} onChange={(e) => set('city', e.target.value)} /></label>
          <label className="block text-[13px] text-muted">Опыт<input className={`${field} mt-1`} value={profile.experience} onChange={(e) => set('experience', e.target.value)} /></label>
        </div>
      </Card>
      <Card>
        <SectionTitle>Что ИИ знает о вас</SectionTitle>
        <p className="-mt-1.5 mb-3 text-[13px] leading-snug text-muted">Теги учитываются в каждом ответе. Нажмите на тег, чтобы удалить, или добавьте свой.</p>
        <div className="flex flex-wrap gap-1.5">
          {profile.tags.map((t) => (
            <Chip key={t} onClick={() => setProfile({ ...profile, tags: profile.tags.filter((x) => x !== t) })}>{t}<span className="ml-1.5 text-muted" aria-label="удалить">×</span></Chip>
          ))}
        </div>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); addTag() }}>
          <input aria-label="Новый тег" className={field} placeholder="Новый тег" value={tag} onChange={(e) => setTag(e.target.value)} />
          <button className="h-12 shrink-0 rounded-xl bg-accent px-5 text-[14px] font-semibold text-white">Добавить</button>
        </form>
      </Card>
    </Screen>
  )
}
