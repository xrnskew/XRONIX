// Демо-учётки — те же, что засевает бэкенд при SEED_DEMO (docs/CONVEYOR.md, docs/tasks/ROUND2.md, пункт 8)
export const DEMO_PASSWORD = 'demo12345'
export const DEMO_CLIENT = { email: 'client@xronix.demo', name: 'Александр', role: 'client' } as const
export const DEMO_ANALYST = { email: 'analyst@xronix.demo', name: 'Ольга Смирнова', role: 'analyst' } as const

// Демо-учётка по почте и паролю: учётка, 'wrong' при неверном пароле, null для другой почты
export function demoAccount(email: string, password: string) {
  const a = [DEMO_CLIENT, DEMO_ANALYST].find((x) => x.email === email.trim().toLowerCase())
  if (!a) return null
  return password === DEMO_PASSWORD ? a : 'wrong'
}
