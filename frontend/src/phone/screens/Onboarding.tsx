import { useState } from 'react'
import { Button, Logo } from '../ui'
import { useCabinet } from '../CabinetContext'
import { ApiError } from '../../api'
import CityPicker from '../components/CityPicker'

export default function Onboarding() {
  const { user, saveProfile, skipOnboarding } = useCabinet()
  const [city, setCity] = useState(user?.city ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!city.trim()) return setError('Укажите город: от него зависят аренда и спрос.')
    setBusy(true); setError(null)
    try {
      await saveProfile({ city: city.trim() })
      skipOnboarding()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Не удалось сохранить. Попробуйте ещё раз.')
      setBusy(false)
    }
  }

  return (
    <form className="no-scrollbar flex h-full flex-col overflow-y-auto overscroll-contain px-6 pb-8 pt-4" onSubmit={submit}>
      <Logo size={44} />
      <h1 className="mt-4 text-[26px] font-bold leading-tight tracking-tight">Расскажите о себе</h1>
      <p className="mt-1 text-[14px] leading-snug text-muted">Город подставим в чат. Сферу, бюджет и опыт для каждого бизнеса уточним в диалоге.</p>

      <div className="mt-5 space-y-5">
        <CityPicker value={city} onChange={setCity} />
      </div>

      <div className="mt-auto space-y-2 pt-6">
        {error && <p role="alert" className="rounded-xl bg-accent/12 px-3.5 py-2.5 text-[14px] leading-snug text-accent">{error}</p>}
        <Button disabled={busy}>{busy ? 'Сохраняем…' : 'Продолжить'}</Button>
        <button type="button" className="h-10 w-full text-[14px] text-muted" onClick={skipOnboarding}>Пропустить</button>
      </div>
    </form>
  )
}
