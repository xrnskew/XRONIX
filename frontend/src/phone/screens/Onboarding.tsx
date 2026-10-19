import { useState } from 'react'
import { Button, Chip, Logo } from '../ui'
import { useCabinet } from '../CabinetContext'
import { ApiError } from '../../api'

const spheres = ['Общепит', 'Розница', 'Услуги', 'Производство', 'IT', 'Другое']
const experience = ['Новичок', '1–3 года', 'Больше 3 лет']
const budgets: [string, number][] = [['до 500 тыс', 300_000], ['500 тыс – 2 млн', 1_000_000], ['больше 2 млн', 3_000_000]]

export default function Onboarding() {
  const { user, saveProfile, skipOnboarding } = useCabinet()
  const [city, setCity] = useState('')
  const [sphere, setSphere] = useState<string | null>(null)
  const [exp, setExp] = useState<string | null>(null)
  const [budget, setBudget] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!city.trim()) return setError('Укажите город: от него зависят аренда и спрос.')
    setBusy(true); setError(null)
    try {
      await saveProfile({
        city: city.trim(),
        experience: exp,
        budget_rub: budget,
        tags: [...new Set([...(user?.tags ?? []), ...(sphere ? [sphere.toLowerCase()] : []), city.trim()])].slice(0, 12),
      })
      skipOnboarding()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить. Попробуйте ещё раз.')
      setBusy(false)
    }
  }

  return (
    <form className="no-scrollbar flex h-full flex-col overflow-y-auto px-6 pb-8 pt-4" onSubmit={submit}>
      <Logo size={44} />
      <h1 className="mt-4 text-[26px] font-bold leading-tight tracking-tight">Расскажите о себе</h1>
      <p className="mt-1 text-[14px] leading-snug text-muted">ИИ учтёт это в плане и подборе кредита. Всё можно изменить в профиле.</p>

      <div className="mt-5 space-y-5">
        <div>
          <label htmlFor="city" className="mb-1.5 block text-[14px] font-semibold">Город</label>
          <input id="city" value={city} onChange={(e) => setCity(e.target.value)} placeholder="Например, Москва" autoComplete="address-level2"
            className="h-12 w-full rounded-xl bg-surface px-3.5 text-[15px] outline-none ring-1 ring-white/5 placeholder:text-muted focus:ring-2 focus:ring-accent" />
        </div>
        <Group title="Сфера" items={spheres.map((s) => [s, s === sphere])} onPick={(s) => setSphere(s === sphere ? null : s)} />
        <Group title="Опыт в бизнесе" items={experience.map((s) => [s, s === exp])} onPick={(s) => setExp(s === exp ? null : s)} />
        <Group title="Стартовый бюджет" items={budgets.map(([l, v]) => [l, v === budget])} onPick={(l) => { const v = budgets.find(([x]) => x === l)![1]; setBudget(v === budget ? null : v) }} />
      </div>

      <div className="mt-auto space-y-2 pt-6">
        {error && <p role="alert" className="rounded-xl bg-accent/12 px-3.5 py-2.5 text-[14px] leading-snug text-accent">{error}</p>}
        <Button disabled={busy}>{busy ? 'Сохраняем…' : 'Продолжить'}</Button>
        <button type="button" className="h-10 w-full text-[14px] text-muted" onClick={skipOnboarding}>Пропустить</button>
      </div>
    </form>
  )
}

function Group({ title, items, onPick }: { title: string; items: [string, boolean][]; onPick: (s: string) => void }) {
  return (
    <div role="group" aria-label={title}>
      <div className="mb-1.5 text-[14px] font-semibold">{title}</div>
      <div className="flex flex-wrap gap-1.5">{items.map(([s, on]) => <Chip key={s} active={on} onClick={() => onPick(s)}>{s}</Chip>)}</div>
    </div>
  )
}
