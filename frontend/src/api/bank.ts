import type { BankApplication, BankStats, DecisionRequest, QueueItem, Status } from '../types/conveyor'
import { USE_MOCKS, request } from './client'
import { mockBank } from './mockConveyor'

// Рабочее место аналитика. Контракт: /contracts/conveyor.md, «Рабочее место аналитика»; схемы — bank.schema.json
export interface BankApi {
  queue(statuses?: Status[]): Promise<QueueItem[]>
  application(id: string): Promise<BankApplication>
  decide(id: string, b: DecisionRequest): Promise<BankApplication>
  stats(): Promise<BankStats>
}

const realBank: BankApi = {
  queue: (statuses) => request('GET', `/bank/applications${statuses?.length ? `?status=${statuses.join(',')}` : ''}`),
  application: (id) => request('GET', `/bank/applications/${id}`),
  decide: (id, b) => request('POST', `/bank/applications/${id}/decision`, b),
  stats: () => request('GET', '/bank/stats'),
}

export const bank: BankApi = USE_MOCKS ? mockBank : realBank
