import type { Purpose } from '../../../types/conveyor'
import type { Plan } from '../../../types/plan'

// Пути мастера и общие данные шагов (docs/CONVEYOR.md, раздел 3)
export type Path = 'current' | 'new_point' | 'no_business'
export const PATHS: Record<Path, string[]> = {
  current: ['Цель', 'Компания', 'Что нужно', 'Продукт', 'Заявка'],
  new_point: ['Цель', 'Компания', 'Проект', 'Что нужно', 'Продукт', 'Заявка'],
  no_business: ['Цель', 'Проект', 'Основатель', 'Что нужно', 'Продукт', 'Заявка'],
}

export interface Need { purpose: Purpose | null; amount_rub: number | null; term_months: number | null; has_collateral: boolean }
export interface CalculatedPlan { plan_id: string; plan: Plan }
