/** 生词本的类型、筛选表与掌握度算法（从 VocabularyPage.tsx 原样搬出，逻辑未改） */
import { getCardMastery } from '../../../../shared/fsrs-metrics'
import type { VocabularyRow } from '../../utils/db-mapper'

/**
 * 评分档位 —— **直接就是 ts-fsrs 的 Rating 枚举值**，不做任何再映射。
 *
 * 2026-09-15 修复：这里原先是 SM-2 风格的 1/3/4/5，而主进程有一张
 * `{1:1, 2:2, 3:3, 4:3, 5:4}` 映射表，于是「困难」(3) 被静默映射成 Good(3) ——
 * ts-fsrs 的 Hard 档在生词本里完全不可达，"想不起来"和"想得很顺"拿到一模一样的调度。
 * 现在两边统一用 1-4。
 */
export enum ReviewRating {
  AGAIN = 1, // 完全忘记
  HARD = 2, // 困难想起
  GOOD = 3, // 正常想起
  EASY = 4, // 轻松想起
}

// ===== 常量 =====
export type FilterKey = 'all' | 'due' | 'mastered' | 'unmastered'
export const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'due', label: '待复习' },
  { key: 'mastered', label: '已掌握' },
  // schema 无 favorite：用未掌握代替设计稿「收藏」，避免假 toast
  { key: 'unmastered', label: '未掌握' },
]

export type MasteryKind = 'pending' | 'mastered' | 'new'

// ===== 工具函数 =====

/** 根据单词状态推导 mastery 类型 */
export function getMasteryKind(item: VocabularyRow): MasteryKind {
  if (item.is_mastered) return 'mastered'
  if ((item.learning_stage ?? 0) === 0 && (item.review_count ?? 0) === 0) return 'new'
  return 'pending'
}

/** mastery 标签 */
export function masteryLabel(kind: MasteryKind): string {
  switch (kind) {
    case 'mastered':
      return '已掌握'
    case 'new':
      return '新增'
    case 'pending':
    default:
      return '待复习'
  }
}

/** 格式化日期（YYYY-MM-DD） */
export function formatDateOnly(val?: string): string {
  if (!val) return '-'
  try {
    const d = new Date(val)
    if (isNaN(d.getTime())) return '-'
    return d.toISOString().split('T')[0]
  } catch {
    return '-'
  }
}

/**
 * 计算掌握度百分比。
 *
 * 2026-09-15 修正口径：此前用 `familiarity_level`（0-5）换算，
 * 而该字段只是复习次数的代理（`min(5, 2 + floor(reps/2))`），与记忆强度无关 ——
 * 一个复习 4 次、真实记忆稳定性 46 天的词会显示 80%「已掌握」，
 * 而同一状态下划线卡片的 FSRS 掌握度只有 29 分。两条口径对不上。
 *
 * 现在统一改为由 FSRS 状态推导（与复习页、书籍详情卡片页同一个函数）。
 * `is_mastered` 仍是用户通过「标记已掌握」显式给出的最高优先级覆盖：
 * 用户说自己会了，就按会了展示，并从待复习队列中移除。
 */
export function calcMasteryPct(item: VocabularyRow): number {
  if (item.is_mastered) return 100
  return getCardMastery({
    stability: item.stability ?? 0,
    difficulty: item.difficulty ?? 0,
    reps: item.repetition_count ?? item.review_count ?? 0,
    lapses: item.lapses ?? 0,
  }).score
}

/** 根据掌握度选状态色 */
export function masteryStatusColor(pct: number): string {
  if (pct >= 80) return 'var(--state-success)'
  if (pct >= 40) return 'var(--state-warning)'
  return 'var(--state-error)'
}

/** 根据掌握度选状态标签 */
export function masteryStatusLabel(pct: number): string {
  if (pct >= 80) return '已掌握'
  if (pct >= 40) return '学习中'
  return '入门'
}

// ===== 主组件 =====
