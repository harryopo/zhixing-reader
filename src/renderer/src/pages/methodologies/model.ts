/** 方法论页的类型与常量表（从 Methodologies.tsx 原样搬出，逻辑未改） */
import type { MethodologyRow } from '../../utils/db-mapper'

/** 界面口径 = 映射器保证会写出的那一组字段，不再自己另立一份行类型 */
export type MethodologyItem = MethodologyRow

export interface BookInfo {
  id: string
  title: string
  author?: string
  cover?: string
}

export type ViewMode = 'card' | 'list' | 'book'
export type MasteryFilter = 'all' | 'todo' | 'mastered'

// ===== 常量 =====

/** 触发场景徽章配色（与设计稿 6 张卡片一致：primary / chart-5 / chart-3 / chart-4 循环） */
export const TRIGGER_PALETTE: { bg: string; color: string }[] = [
  { bg: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--primary)' },
  { bg: 'color-mix(in srgb, var(--chart-5) 14%, transparent)', color: 'var(--chart-5)' },
  {
    bg: 'color-mix(in srgb, var(--chart-3) 22%, transparent)',
    color: 'color-mix(in srgb, var(--chart-3) 70%, var(--foreground))',
  },
  { bg: 'color-mix(in srgb, var(--chart-4) 14%, transparent)', color: 'var(--chart-4)' },
]

/** 视图切换配置 */
export const VIEW_TOGGLES: { mode: ViewMode; label: string; icon: 'grid' | 'list' | 'book-group' }[] = [
  { mode: 'card', label: '卡片', icon: 'grid' },
  { mode: 'list', label: '列表', icon: 'list' },
  { mode: 'book', label: '按书分组', icon: 'book-group' },
]

/** 掌握度筛选配置 */
export const MASTERY_FILTERS: { key: MasteryFilter; label: string; domId: string }[] = [
  { key: 'all', label: '全部', domId: 'filter-all' },
  { key: 'todo', label: '待练习', domId: 'filter-todo' },
  { key: 'mastered', label: '已掌握', domId: 'filter-mastered' },
]
