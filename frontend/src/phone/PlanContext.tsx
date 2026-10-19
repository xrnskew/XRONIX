import { createContext, useContext, useState, type ReactNode } from 'react'
import type { Plan, Profile } from '../types/plan'
import { mockProfile } from '../mocks/data'

interface Ctx {
  plan: Plan | null
  setPlan: (p: Plan) => void
  profile: Profile
  setProfile: (p: Profile) => void
}
const C = createContext<Ctx | null>(null)

export function CabinetProvider({ children }: { children: ReactNode }) {
  const [plan, setPlan] = useState<Plan | null>(null)
  const [profile, setProfile] = useState<Profile>(mockProfile)
  return <C.Provider value={{ plan, setPlan, profile, setProfile }}>{children}</C.Provider>
}
export const useCabinet = () => {
  const c = useContext(C)
  if (!c) throw new Error('CabinetProvider отсутствует')
  return c
}
