import type { AiReply, Plan, Profile } from '../types/plan'
import { mockPlan, mockProfile, mockQuestions } from '../mocks/data'

const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== 'false'
const delay = (ms = 700) => new Promise((r) => setTimeout(r, ms))

// Мок-диалог: идея -> вопросы -> ответы -> план. Реальный вызов подключим по контракту.
let step = 0
export async function sendMessage(_chatId: string, text: string): Promise<AiReply> {
  if (!USE_MOCKS) throw new Error('Бэкенд ещё не подключён')
  await delay()
  step += 1
  if (step === 1) return mockQuestions
  step = 0
  return { type: 'plan', text: 'План готов', plan_id: 'demo', plan: mockPlan }
}
export const resetMockDialog = () => { step = 0 }

export async function getPlan(_id: string): Promise<Plan> { await delay(200); return mockPlan }
export async function getProfile(): Promise<Profile> { await delay(200); return mockProfile }
