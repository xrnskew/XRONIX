import rows from './cities.json' with { type: 'json' }

export interface City { name: string; region: string; population: number }
// Source: https://github.com/arbaev/russia-cities (2023 reference, retrieved 2026-10-19).
// Only public geographic names, regions and population are retained. No network request as you type.
export const cities: City[] = rows.map(([name, region, population]) => ({ name: String(name), region: String(region), population: Number(population) }))
export const normalizeCity = (s: string) => s.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[\s‐‑–—-]+/g, ' ').trim()
const indexed = cities.map((city) => ({ city, name: normalizeCity(city.name), region: normalizeCity(city.region) }))

export function findCities(query: string, limit = 8): City[] {
  const q = normalizeCity(query)
  const words = q.split(' ').filter(Boolean)
  const score = (name: string) => name === q ? 0 : name.startsWith(q) ? 1 : words.every((w) => name.includes(w)) ? 2 : 3
  return indexed.filter(({ name, region }) => !q || words.every((w) => `${name} ${region}`.includes(w)))
    .sort((a, b) => (q ? score(a.name) - score(b.name) : 0) || b.city.population - a.city.population || a.city.name.localeCompare(b.city.name, 'ru'))
    .slice(0, limit).map(({ city }) => city)
}
