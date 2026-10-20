import type { ChatMessage } from '../types/plan'

// Older API histories contain the submitted text, newer local messages also retain IDs.
export function submittedAnswers(messages: ChatMessage[], questionIndex: number): Record<string, string> {
  const questions = messages[questionIndex]?.reply
  if (questions?.type !== 'questions') return {}
  const next = messages[questionIndex + 1]
  if (next?.role !== 'user') return {}
  if (next.answers?.length) return Object.fromEntries(next.answers.map((a) => [a.question_id, a.answer]))
  const lines = (next.text ?? '').split('\n')
  return Object.fromEntries(questions.questions.flatMap((q) => {
    const prefix = `${q.text} `
    const line = lines.find((line) => line.startsWith(prefix))
    return line ? [[q.id, line.slice(prefix.length)]] : []
  }))
}
