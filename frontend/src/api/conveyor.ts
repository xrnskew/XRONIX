import type { AppDocument, Application, ApplicationDraft, ApplicationListItem, Company, FeedItem, InfoRequestKind, MatchItem, MatchRequest, MemberRole, ParsedNeed, RegistryCompany } from '../types/conveyor'
import type { Plan } from '../types/plan'
import type { CalcRequest, Template } from '../lib/projectCalc'
import { USE_MOCKS, request } from './client'
import { mockConveyor } from './mockConveyor'

// Контракт: /contracts/conveyor.md
export interface ConveyorApi {
  registry(inn: string): Promise<RegistryCompany>
  listCompanies(): Promise<Company[]>
  addCompany(inn: string, member_role: MemberRole, future?: boolean): Promise<Company> // future: будущий ИП по личному ИНН
  uploadAuthority(companyId: string, file: File): Promise<Company>
  parseNeed(text: string): Promise<ParsedNeed>
  templates(): Promise<Template[]>
  calculatePlan(b: CalcRequest): Promise<{ plan_id: string; plan: Plan }>
  match(b: MatchRequest): Promise<{ items: MatchItem[] }>
  createApplication(b: ApplicationDraft): Promise<Application>
  patchApplication(id: string, b: ApplicationDraft & { version: number }): Promise<Application>
  submit(id: string, version: number): Promise<Application>
  listApplications(): Promise<ApplicationListItem[]>
  getApplication(id: string): Promise<Application>
  action(id: string, action: 'accept' | 'reject-offer' | 'sign' | 'withdraw', version: number): Promise<Application>
  uploadDocument(id: string, kind: InfoRequestKind, file: File): Promise<AppDocument>
  feed(): Promise<FeedItem[]>
  markRead(ids: string[]): Promise<void>
}

const form = (fields: Record<string, string | File>) => {
  const f = new FormData()
  for (const [k, v] of Object.entries(fields)) f.append(k, v)
  return f
}

const realConveyor: ConveyorApi = {
  registry: (inn) => request('GET', `/registry/${inn}`),
  listCompanies: () => request('GET', '/companies'),
  addCompany: (inn, member_role, future) => request('POST', '/companies', future ? { inn, member_role, future } : { inn, member_role }),
  uploadAuthority: (id, file) => request('POST', `/companies/${id}/authority`, form({ file })),
  parseNeed: (text) => request('POST', '/needs/parse', { text }, 15_000),
  templates: () => request('GET', '/templates'),
  calculatePlan: (b) => request('POST', '/plans/calculate', b),
  match: (b) => request('POST', '/products/match', b),
  createApplication: (b) => request('POST', '/applications', b),
  patchApplication: (id, b) => request('PATCH', `/applications/${id}`, b),
  submit: (id, version) => request('POST', `/applications/${id}/submit`, { version }),
  listApplications: () => request('GET', '/applications'),
  getApplication: (id) => request('GET', `/applications/${id}`),
  action: (id, action, version) => request('POST', `/applications/${id}/${action}`, { version }),
  uploadDocument: (id, kind, file) => request('POST', `/applications/${id}/documents`, form({ kind, file })),
  feed: () => request('GET', '/feed'),
  markRead: (ids) => request('POST', '/feed/read', { ids }),
}

export const conveyor: ConveyorApi = USE_MOCKS ? mockConveyor : realConveyor
