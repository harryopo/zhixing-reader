/** TokenUsage 页的常量与类型（从 TokenUsage.tsx 原样搬出，逻辑未改） */
import { COLORS } from '@/design/colors'
// ===== 类型 =====
export type TimeRange = 'today' | '7d' | '14d' | '30d'
export type TabKey = 'logs' | 'providers' | 'features'
export type FilterDateRange = '7d' | '30d' | '90d' | 'all'

// ===== 常量 =====
export const FEATURE_LABELS: Record<string, string> = {
  generateCards: '生成卡片',
  generateSummary: '生成摘要',
  generateChapterSummary: '章节摘要',
  generateBookSummary: '全书摘要',
  chat: 'AI对话',
  explain: '解释内容',
}

export const TIME_RANGES: { key: TimeRange; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: '7d', label: '本周' },
  { key: '14d', label: '14天' },
  { key: '30d', label: '本月' },
]

export const TABS: { key: TabKey; label: string }[] = [
  { key: 'logs', label: '调用记录' },
  { key: 'providers', label: '模型统计' },
  { key: 'features', label: '功能统计' },
]

export const DAYS_MAP: Record<TimeRange, number> = { today: 1, '7d': 7, '14d': 14, '30d': 30 }

/** 筛选日期范围 → 天数（'all' 用 3650 天近似 10 年，足够覆盖全量数据） */
export const FILTER_DAYS_MAP: Record<FilterDateRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: 3650,
}

// USD → CNY 汇率（用于预估费用展示，与设计稿 ¥18.60 / 1.24M tokens 量级一致）
export const USD_TO_CNY = 7

/** Layer 2.5 折线图配色（统一 emerald 系，input 深色 / output 浅色，保持双色对比） */
export const CHART_COLORS = {
  input: COLORS.emerald[700], // 输入 tokens（深色）
  output: COLORS.emerald[400], // 输出 tokens（浅色）
} as const
