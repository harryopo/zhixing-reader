/**
 * 每日学习量控制 —— 「新卡」与「复习卡」是两种东西
 *
 * ## 为什么需要它（2026-09-15 实测发现的问题）
 * `createCard()` 让每张新卡的 `due` 就是"现在"，而 `getDueCards()` 的查询是
 * `WHERE due <= now` —— 新卡和复习卡混在同一个队列里，且**没有任何每日上限**。
 *
 * 后果：微信读书同步把 934 条划线一次性变成 934 张"今天就到期"的卡片。
 * 用户每次打开复习页看到的是"931 张待复习"——一个永远做不完的清单，
 * 于是干脆不打开。这不是界面问题，是**入口没有节流**。
 *
 * ## 解决办法（间隔重复的通行做法）
 * 新卡**不直接进入待复习队列**，而是每天定量放出（Anki 的 "New cards/day"）：
 * - 复习卡（state ≠ 0）：到期就出现，这才是真正的间隔重复
 * - 新卡（state = 0）：每天最多放 `newCardsPerDay` 张，其余排队等明天
 *
 * 一张卡只要被评分过一次，state 就不再是 0，自动离开新卡池 ——
 * 所以"今天还剩多少新卡额度"不需要额外记状态，从复习记录就能算出来。
 *
 * 纯函数、零依赖：electron 主进程与 renderer 共用。
 */

/** 默认每日新卡上限。Anki 默认 20；本应用面向"划线即卡片"的大存量场景，取更保守的 15。 */
export const DEFAULT_NEW_CARDS_PER_DAY = 15

/** 允许的上限区间：0 = 暂停新卡（只复习旧卡），这个语义要有意保留 */
export const MIN_NEW_CARDS_PER_DAY = 0
export const MAX_NEW_CARDS_PER_DAY = 200

/**
 * 把任意输入（设置项、用户输入、undefined）规整成合法的每日新卡上限。
 *
 * ⚠️ `null` / `''` 必须视为"没配过"而不是 0：
 * `Number(null)` 和 `Number('')` 都等于 0，若直接放行，
 * 首次安装（设置项还不存在）会变成"每日 0 张新卡"——静默地把新卡全停了。
 */
export function normalizeNewCardsPerDay(value: unknown): number {
  if (value === null || value === undefined || value === '') return DEFAULT_NEW_CARDS_PER_DAY
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_NEW_CARDS_PER_DAY
  return Math.min(Math.max(Math.round(n), MIN_NEW_CARDS_PER_DAY), MAX_NEW_CARDS_PER_DAY)
}

export interface DailyQuotaInput {
  /** 每日新卡上限（设置项） */
  perDay: number
  /** 今天已经被评过分的新卡数（即首次复习发生在今天的卡片数） */
  introducedToday: number
  /** 新卡池里还剩多少张（state = 0 的总数） */
  available: number
}

export interface DailyQuota {
  /** 今天还能放出多少张新卡 */
  allowance: number
  /** 规整后的每日上限 */
  perDay: number
  /** 今天已引入的新卡数（不超过上限） */
  introducedToday: number
  /** 新卡池剩余总量 */
  available: number
}

/**
 * 计算今天还能放出多少张新卡。
 *
 * 恒有 `allowance <= available`：池子空了就不会凭空冒出额度。
 * `perDay = 0` 表示暂停新卡（只复习旧卡），此时 allowance 恒为 0。
 */
export function computeNewCardAllowance(input: DailyQuotaInput): DailyQuota {
  const perDay = normalizeNewCardsPerDay(input?.perDay)
  const available = Math.max(0, Math.floor(Number(input?.available) || 0))
  const introducedToday = Math.max(0, Math.floor(Number(input?.introducedToday) || 0))
  const remaining = Math.max(0, perDay - introducedToday)
  return {
    allowance: Math.min(remaining, available),
    perDay,
    introducedToday,
    available,
  }
}

/** 把非有限值归零（Math.max(0, NaN) 仍是 NaN，会漏进字符串拼接） */
function toCount(value: unknown): number {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** 把"今天要做什么"压成一句人话（界面用，避免堆数字） */
export function describeDailyQueue(reviewDue: number, newAllowance: number): string {
  const r = toCount(reviewDue)
  const n = toCount(newAllowance)
  if (r === 0 && n === 0) return '今天没有要复习的内容'
  const parts: string[] = []
  if (r > 0) parts.push(`复习 ${r} 张`)
  if (n > 0) parts.push(`新卡 ${n} 张`)
  return `今天：${parts.join(' · ')}`
}
