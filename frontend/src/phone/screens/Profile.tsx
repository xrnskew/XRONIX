import { useState } from 'react'
import { Card, Chip, Screen } from '../ui'
import { useCabinet } from '../PlanContext'

export default function ProfileScreen() {
  const { profile, setProfile } = useCabinet()
  const [tag, setTag] = useState('')
  const field = 'h-11 w-full rounded-xl bg-surface-2 px-3 text-[15px] outline-none focus:ring-2 focus:ring-accent'
  const set = (k: 'city' | 'experience', v: string) => setProfile({ ...profile, [k]: v })
  const addTag = () => {
    const t = tag.trim()
    if (t && !profile.tags.includes(t)) setProfile({ ...profile, tags: [...profile.tags, t] })
    setTag('')
  }
  return (
    <Screen title="Профиль">
      <Card className="space-y-3">
        <div>
          <div className="text-[17px] font-semibold">{profile.name}</div>
          <div className="text-[13px] text-muted">{profile.email}</div>
        </div>
        <label className="block text-[13px] text-muted">Город<input className={`${field} mt-1 text-text`} value={profile.city} onChange={(e) => set('city', e.target.value)} /></label>
        <label className="block text-[13px] text-muted">Опыт<input className={`${field} mt-1 text-text`} value={profile.experience} onChange={(e) => set('experience', e.target.value)} /></label>
      </Card>
      <Card>
        <h2 className="text-[16px] font-semibold">Что ИИ знает о вас</h2>
        <p className="mb-3 mt-1 text-[13px] text-muted">Теги учитываются в каждом ответе. Удалите лишнее или добавьте своё.</p>
        <div className="flex flex-wrap gap-1.5">
          {profile.tags.map((t) => (
            <Chip key={t} onClick={() => setProfile({ ...profile, tags: profile.tags.filter((x) => x !== t) })}>{t} ×</Chip>
          ))}
        </div>
        <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); addTag() }}>
          <input aria-label="Новый тег" className={field} placeholder="Новый тег" value={tag} onChange={(e) => setTag(e.target.value)} />
          <button className="h-11 rounded-xl bg-surface-2 px-4 text-[14px] font-semibold">Добавить</button>
        </form>
      </Card>
    </Screen>
  )
}
