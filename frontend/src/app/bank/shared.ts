import dict from '../../data/dictionaries.json'
import type { DeclineReason, InfoRequestKind, Status } from '../../types/conveyor'

// Общее для экранов аналитика: справочники и цвет класса заявки
export const statuses = dict.statuses as Record<Status, { title: string }>
export const declineReasons = dict.decline_reasons as Record<DeclineReason, { text: string }>
export const infoKinds = dict.info_request_kinds as Record<InfoRequestKind, { title: string; text: string }>

export const gradeTone = (g: string | null) => (g === 'A' ? 'text-ok' : g === 'B' ? 'text-text' : g === 'C' ? 'text-warn' : g === 'D' ? 'text-accent' : 'text-muted')
