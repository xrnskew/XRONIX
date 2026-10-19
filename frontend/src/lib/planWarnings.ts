import type { Plan } from '../types/plan'

const metroCities = new Set(['москва', 'санкт петербург', 'новосибирск', 'екатеринбург', 'нижний новгород', 'казань', 'самара'])
export function unconfirmedMetro(plan: Plan): boolean {
  const city = plan.business.city.toLocaleLowerCase('ru').trim().replace(/ё/g, 'е').replace(/[\s-]+/g, ' ')
  return !metroCities.has(city) && /метро(?=$|[^а-яёa-z])/iu.test(JSON.stringify(plan))
}
export const LOCATION_WARNING = 'В плане указано метро, но его наличие для этого города не подтверждено. Проверьте реальную локацию и пересоздайте план: прогноз спроса и финансов может быть неверным.'
