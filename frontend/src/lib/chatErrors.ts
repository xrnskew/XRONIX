// Почему сервер отказал в удалении диалога (DELETE /api/chats/{id}). Коды у него общие, а смысл здесь особый,
// поэтому «Действие недоступно в текущем статусе или для этой роли» без пояснения не показываем.
export type DeleteFailure = 'protected' | 'busy' | 'other'

export function deleteFailure(e: unknown): DeleteFailure {
  const code = (e as { code?: string } | null)?.code
  if (code === 'INVALID_TRANSITION') return 'protected' // по плану этого диалога оформлена заявка
  if (code === 'RATE_LIMITED') return 'busy'            // ИИ ещё готовит ответ в этом диалоге
  return 'other'
}

export const DELETE_TEXT: Record<DeleteFailure, string> = {
  protected: 'Этот диалог нельзя удалить: по его плану оформлена заявка, пока она есть, план и диалог сохраняются. Можно убрать диалог из списка.',
  busy: 'В этом диалоге ИИ ещё готовит ответ. Попробуйте удалить чуть позже.',
  other: 'Не удалось удалить диалог. Попробуйте позже.',
}
