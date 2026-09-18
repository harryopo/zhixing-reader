/** TokenUsage 页的纯格式化/取数工具（从 TokenUsage.tsx 原样搬出，逻辑未改） */
import { DAYS_MAP, FILTER_DAYS_MAP, USD_TO_CNY } from './constants'
import type { FilterDateRange, TimeRange } from './constants'

/** 模型 → 颜色 token（设计稿：GPT-4o chart-1, Claude chart-5, mini chart-3, 其他 chart-2） */
export function getModelColor(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('gpt-4o') && !m.includes('mini')) return 'var(--chart-1)'
  if (m.includes('claude')) return 'var(--chart-5)'
  if (m.includes('mini')) return 'var(--chart-3)'
  return 'var(--chart-2)'
}

/** 模型 → 显示名（设计稿：GPT-4o / Claude 3.5 / GPT-4o-mini） */
export function getModelDisplayName(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('claude-3.5') || m.includes('claude3.5') || m.includes('claude-3-5')) return 'Claude 3.5'
  if (m.includes('mini')) return 'GPT-4o-mini'
  if (m.includes('gpt-4o')) return 'GPT-4o'
  if (m.includes('claude')) return 'Claude'
  return model
}

// ===== 格式化工具 =====
export function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

export function formatTokensFull(n: number): string {
  return n.toLocaleString()
}

export function formatCost(usd: number): string {
  return '¥' + (usd * USD_TO_CNY).toFixed(2)
}

export function formatDuration(ms: number): string {
  if (ms >= 60000) return (ms / 60000).toFixed(1) + 'min'
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's'
  return ms + 'ms'
}

export function formatDateFull(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return '-'
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  } catch {
    return '-'
  }
}

/** CSV 字段转义：包含 `,` `"` `\n` 时用 `"` 包裹，内部 `"` 转义为 `""`。
 *  同时防御 CSV 公式注入：以 `=` `+` `-` `@` 开头的值前置单引号（OWASP CSV Injection 防护）。 */
export function escapeCsv(value: unknown): string {
  let s = String(value ?? '')
  // 防御 CSV 公式注入：以 = + - @ 开头的值前置单引号（OWASP CSV Injection 防护）
  if (/^[=+\-@]/.test(s)) {
    s = "'" + s
  }
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** 筛选日期范围 → { startDate, endDate } ISO 日期字符串（YYYY-MM-DD） */
export function getFilterRangeDates(range: FilterDateRange): { startDate: string; endDate: string } {
  const end = new Date()
  end.setHours(23, 59, 59, 0)
  const endDate = end.toISOString().split('T')[0]
  const days = FILTER_DAYS_MAP[range]
  const start = new Date(end)
  start.setDate(start.getDate() - days + 1)
  start.setHours(0, 0, 0, 0)
  return { startDate: start.toISOString().split('T')[0], endDate }
}

/** 时间戳格式化：YYYYMMDD-HHmm */
export function formatExportTimestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

/** 时间范围副标题（设计稿："本月累计 · 7 月 1-20 日"） */
export function getRangeLabel(range: TimeRange): string {
  const days = DAYS_MAP[range]
  const end = new Date()
  if (range === 'today') {
    return `今日 · ${end.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}`
  }
  const start = new Date(end)
  start.setDate(start.getDate() - days + 1)
  const fmt = (d: Date) => d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  const rangeLabel = range === '7d' ? '本周' : range === '14d' ? '近 14 天' : '本月'
  return `${rangeLabel}累计 · ${fmt(start)} - ${fmt(end)}`
}

/** KPI 第一个卡的 eyebrow 文案 */
export function getUsageEyebrow(range: TimeRange): string {
  if (range === 'today') return '今日用量'
  if (range === '7d') return '本周用量'
  if (range === '14d') return '近 14 天用量'
  return '本月用量'
}
