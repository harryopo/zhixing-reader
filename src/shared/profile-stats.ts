/**
 * 档案页数字的唯一算法。
 *
 * 存在的理由：这些数字原先散在 profileStore 与 Profile.tsx 里各算一遍，
 * 于是出现过「年度阅读 0h」配「日均 6min」（3252 秒被 Math.floor(秒/3600) 截成 0）、
 * 热力图读 `row.readingTime` 而线上传的是 `reading_time`（一格都不亮）这类自相矛盾。
 * 界面只许消费这里的返回值，不要就地再算一次。
 */

/** daily_stats 一行归一化后的样子（秒 / 条 / 张 / 本） */
export interface ActivityDay {
  date: string
  readingTime: number
  highlightsAdded: number
  cardsReviewed: number
  booksRead: number
}

function num(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * sql.js 的 rowsToObjects 交出来的是数据库列名（snake_case），
 * 历史数据与单测里也见过 camelCase，两种都接住，别默认只有一种。
 */
export function normalizeDailyStatRow(raw: Record<string, unknown>): ActivityDay | null {
  const date = typeof raw.date === 'string' ? raw.date.slice(0, 10) : ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null
  return {
    date,
    readingTime: num(raw.reading_time ?? raw.readingTime ?? raw.readingTimeSeconds),
    highlightsAdded: num(raw.highlights_added ?? raw.highlightsAdded ?? raw.highlightsCount),
    cardsReviewed: num(raw.cards_reviewed ?? raw.cardsReviewed ?? raw.reviewsCount),
    booksRead: num(raw.books_read ?? raw.booksRead),
  }
}

export function sumReadingSeconds(rows: ActivityDay[]): number {
  return rows.reduce((sum, r) => sum + r.readingTime, 0)
}

/** 当天有任一活动才算「有活动的一天」——有行不等于读了书 */
export function daysWithActivity(rows: ActivityDay[]): number {
  return rows.filter(
    (r) => r.readingTime > 0 || r.highlightsAdded > 0 || r.cardsReviewed > 0 || r.booksRead > 0
  ).length
}

/** 日均只在「有活动的天数」上取平均：把零活动日算进分母会把自己摊薄 */
export function averageMinutesPerActiveDay(rows: ActivityDay[]): number {
  const active = daysWithActivity(rows)
  if (active === 0) return 0
  return Math.round(sumReadingSeconds(rows) / active / 60)
}

/**
 * 本地日期串。
 * 用 toISOString().slice(0,10) 会在 UTC+8 的凌晨把「今天」算成昨天，
 * 连击判定因此每天早上一开应用就归零。
 */
export function localDateStr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

export function yearToDateWindow(today: Date): { start: string; end: string } {
  const end = localDateStr(today)
  return { start: `${end.slice(0, 4)}-01-01`, end }
}

/** 热力图铺 26 周 —— 界面和取数窗口都用这一个数，别各写一份 */
export const HEAT_WINDOW_WEEKS = 26

/**
 * 档案页一次 IPC 取数的窗口：既要喂「年度 KPI」，又要喂「26 周热力图」，
 * 所以起点取两者中更早的那个；年初时 1 月 1 日更早，不多取去年的数据。
 */
export function statsWindow(today: Date): { start: string; end: string } {
  const { start: yearStart, end } = yearToDateWindow(today)
  const heatStart = addDays(end, -(HEAT_WINDOW_WEEKS * 7 - 1))
  return { start: heatStart < yearStart ? heatStart : yearStart, end }
}

/** 按日期串闭区间过滤（'YYYY-MM-DD' 直接比大小就是比日期） */
export function inRange(rows: ActivityDay[], start: string, end: string): ActivityDay[] {
  return rows.filter((r) => r.date >= start && r.date <= end)
}

function dayMs(date: string): number {
  return Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)))
}

function addDays(date: string, delta: number): string {
  const d = new Date(dayMs(date) + delta * 86400000)
  return d.toISOString().slice(0, 10)
}

function isActive(row: ActivityDay): boolean {
  return row.readingTime > 0 || row.highlightsAdded > 0 || row.cardsReviewed > 0 || row.booksRead > 0
}

export function computeStreaks(
  rows: ActivityDay[],
  today: string
): { current: number; longest: number } {
  const activeDays = new Set(rows.filter(isActive).map((r) => r.date))

  // 今天还没开始读不算断签：从昨天往回数，一天过完仍无活动才归零
  let cursor = activeDays.has(today) ? today : addDays(today, -1)
  let current = 0
  while (activeDays.has(cursor)) {
    current++
    cursor = addDays(cursor, -1)
  }

  const sorted = [...activeDays].sort()
  let longest = 0
  let run = 0
  let prev: number | undefined
  for (const day of sorted) {
    const ms = dayMs(day)
    run = prev !== undefined && ms - prev === 86400000 ? run + 1 : 1
    longest = Math.max(longest, run)
    prev = ms
  }

  return { current, longest }
}

export type Trend = 'up' | 'down' | 'flat'

/** 最近一次有活动的日期；一次都没有就 null（界面据此说「还没有阅读记录」而不是编一个） */
export function lastActiveDate(rows: ActivityDay[]): string | null {
  let best: string | null = null
  for (const r of rows) {
    if (isActive(r) && (best === null || r.date > best)) best = r.date
  }
  return best
}

/** 近 7 天 vs 前 7 天的阅读秒数。相等或都没数据就是 flat —— 不许画永远向上的箭头 */
export function weekTrend(rows: ActivityDay[], today: string): Trend {
  const recentStart = addDays(today, -6)
  const priorStart = addDays(today, -13)
  let recent = 0
  let prior = 0
  for (const r of rows) {
    if (r.date >= recentStart && r.date <= today) recent += r.readingTime
    else if (r.date >= priorStart && r.date < recentStart) prior += r.readingTime
  }
  if (recent === prior) return 'flat'
  return recent > prior ? 'up' : 'down'
}

function levelForSeconds(seconds: number): number {
  if (seconds <= 0) return 0
  if (seconds < 1800) return 1 // < 30 分钟
  if (seconds < 3600) return 2 // < 60 分钟
  if (seconds < 7200) return 3 // < 120 分钟
  return 4
}

/**
 * 按周排列的热力格（长度 = weeks * 7，下标 0 = 窗口最早一天，最后一个 = today）。
 * 同一天多行时取最大值，不让后写的行把已点亮的高档格子冲淡。
 */
export function heatLevels(rows: ActivityDay[], today: string, weeks: number): number[] {
  const levels = Array(weeks * 7).fill(0)
  const start = addDays(today, -(weeks * 7 - 1))
  for (const r of rows) {
    if (r.date < start || r.date > today) continue
    const idx = Math.round((dayMs(r.date) - dayMs(start)) / 86400000)
    if (idx < 0 || idx >= levels.length) continue
    levels[idx] = Math.max(levels[idx], levelForSeconds(r.readingTime))
  }
  return levels
}

/** 复习卡片副行用的真实复习统计（不许拿阅读时长冒充） */
export interface ReviewSummary {
  times: number
  cardsCovered: number
  lastAt: string | null
}

export function summarizeReviews(rows: Record<string, unknown>[]): ReviewSummary {
  const cards = new Set<string>()
  let lastAt: string | null = null
  for (const r of rows) {
    const cardId = r.card_id ?? r.cardId
    if (typeof cardId === 'string' && cardId) cards.add(cardId)
    const at = r.review_time ?? r.reviewTime ?? r.created_at
    if (typeof at === 'string' && at > (lastAt ?? '')) lastAt = at
  }
  return { times: rows.length, cardsCovered: cards.size, lastAt }
}

/** 'YYYY-MM-DD HH:MM:SS' / ISO 串 → MM-DD，认不出来就 null（界面据此不显示日期） */
export function shortDate(value: string | null): string | null {
  if (!value) return null
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[2]}-${m[3]}` : null
}

/** 阅读时长的自适应人话：54 分钟就是 54 分钟，不写成 0 小时 */
export function formatReadingDuration(seconds: number): string {
  if (seconds <= 0) return '0 分钟'
  if (seconds < 60) return `${Math.floor(seconds)} 秒`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} 小时` : `${hours} 小时 ${rest} 分`
}
