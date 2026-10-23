import { api } from '../api'
import { conveyor } from '../api/conveyor'
import type { CalculatedPlan } from '../phone/conveyor/wizard/types'
import { answersFromChat, inferTemplate } from './replanCore'

// Пересчёт плана с другой суммой своих денег. Весь расчёт запускается заново на сервере (POST /plans/calculate):
// меняются нехватка, сумма и срок кредита, платёж, вердикт. Если сферу или ответы восстановить не удалось, пересчёта нет и ошибка понятна человеку.
export class ReplanError extends Error {}

export async function recalcWithOwnFunds(planId: string, ownFunds: number): Promise<CalculatedPlan> {
  const rec = await api.getPlan(planId)
  const tpl = inferTemplate(await conveyor.templates(), rec.plan)
  if (!tpl) throw new ReplanError('Не получилось определить сферу плана. Пересчитайте его в чате: напишите, сколько у вас своих денег.')
  let answers: Record<string, number | string> = {}
  if (rec.chat_id) {
    try { answers = answersFromChat((await api.getChat(rec.chat_id)).messages, tpl) } catch { /* без ответов расчёт возьмёт значения по умолчанию */ }
  }
  const exp = rec.plan.business.experience
  return conveyor.calculatePlan({ sphere: tpl.sphere, city: rec.plan.business.city, own_funds_rub: ownFunds, answers, ...(exp ? { experience: exp } : {}) })
}
