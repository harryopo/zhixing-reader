/**
 * 遗忘播报 —— 把 FSRS 的数字翻译成一句中文
 *
 * ## 为什么需要它
 * 用户原话：「我很多也看不懂」。
 * 而界面上散布着「记忆稳定性 46.35 天」「当前保持率 87%」「难度 2.09」这类数字 ——
 * renderer 里这类文案有近 100 处。它们对开发者有意义，对读者只是噪音：
 * 一个非程序员看到 46.35 既不知道是好是坏，也不知道该做什么。
 *
 * 本模块把 FSRS 已经算好的状态翻译成一句话 + 一个动作，**全应用共用同一张嘴**，
 * 避免每个页面各自发明一套说法（此前「入门/进阶/熟练/精通」与
 * 「尚未形成记忆/记忆牢固/开始模糊」两套措辞并存）。
 *
 * ## 三条硬约束（写测试时逐条验）
 *
 * 1. **只说结论，不请用户评判算法。**
 *    如果说成「我猜你记得，对吗？」，用户就会从"回忆自己的记忆"切换到
 *    "评价算法猜得准不准"，四个评分按钮的信号立刻被污染 ——
 *    而那是 FSRS 唯一的真值输入。所以句式是**陈述 + 邀请**，不是提问。
 *
 * 2. **没有数据就闭嘴，绝不编。**
 *    新卡、从未复习过、elapsedDays 缺失 —— 都不许算出一个"遗忘日期"。
 *    v1.1.0 刚清理过一批假数据，不能在这里重演。
 *
 * 3. **不许用亲切的词撒谎。**
 *    12 天不能叫「这周」，18 天不能叫「下个月」。宁可说「大概还能记住 12 天」，
 *    也不要用模糊的词让用户查不出来。100 天以上才允许用「约 N 个月」，
 *    并且必须带「约」字。
 *
 * 纯函数、零依赖：electron 主进程与 renderer 共用。
 */

import { getRetrievability, getRetentionHint } from './fsrs-metrics'

/** 卡片在「遗忘播报」里的处境 */
export type VoiceBucket = 'new' | 'overdue' | 'today' | 'soon' | 'upcoming' | 'distant'

export interface ForgettingVoice {
  /** 陈述句：这张卡现在处于什么状态 */
  sentence: string
  /** 祈使句：建议的动作。不需要动作时为空串（界面据此隐藏按钮） */
  imperative: string
  /** 分档，供界面决定配色/图标 */
  bucket: VoiceBucket
  /** 距离排定的复习日还有几天（负数 = 已逾期） */
  daysUntilDue: number
  /** 排定复习日的具体日期（YYYY-MM-DD），无法确定时为空串 */
  dueLabel: string
  /** 当前保持率 0-1；无记忆时为 0 */
  retention: number
}

export interface ForgettingInput {
  /** 记忆稳定性（天），0 表示尚未形成记忆 */
  stability: number
  /** 距上次复习的天数 */
  elapsedDays: number
  /** 排定的下次复习时间（ISO 字符串） */
  due: string | null | undefined
  /** 累计复习次数，0 表示从未复习过 */
  reps?: number
  /** 累计遗忘次数 */
  lapses?: number
  /** 当前时间，测试用 */
  now?: Date
}

/** 只保留日期部分，避免时/分/秒造成"今天/明天"判断抖动 */
function startOfDay(d: Date): number {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c.getTime()
}

const MS_PER_DAY = 86400000

/** 日历天差（due - now），按本地日期零点计算 */
function calendarDaysBetween(from: Date, to: Date): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / MS_PER_DAY)
}

/** YYYY-MM-DD（本地日期，不用 toISOString 以免时区前移一天） */
function toDateLabel(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * 把"还有 N 天"说成人话。
 *
 * 诚实性规则：1-2 天用「明天/后天」；3-99 天一律给出**确切天数**；
 * 100 天以上才允许模糊，且必须带「约」。
 */
export function describeSpan(days: number): string {
  // ⚠️ 必须先挡掉 NaN：Math.max(0, NaN) 仍是 NaN，会让所有分支判断失效，
  // 一路掉到最后一个分支产出「约 NaN 年」这种直接给用户看的脏字符串。
  const raw = Math.round(Number(days))
  const n = Number.isFinite(raw) ? Math.max(0, raw) : 0
  if (n <= 0) return '今天'
  if (n === 1) return '明天'
  if (n === 2) return '后天'
  if (n < 100) return `${n} 天`
  if (n < 365) return `约 ${Math.round(n / 30)} 个月`
  const years = n / 365
  return `约 ${years.toFixed(1).replace(/\.0$/, '')} 年`
}

/**
 * 生成一张卡片的「遗忘播报」。
 *
 * @example
 * describeForgetting({ stability: 0, elapsedDays: 0, due: null, reps: 0 }).sentence
 * // '这段话你还没真正记住过'
 * describeForgetting({ stability: 46, elapsedDays: 0, due: <12天后>, reps: 4 }).sentence
 * // '大概还能记住 12 天'
 */
export function describeForgetting(input: ForgettingInput): ForgettingVoice {
  const now = input?.now ?? new Date()
  const stability = Number(input?.stability) || 0
  const reps = Math.max(0, Number(input?.reps) || 0)
  const elapsedDays = Number(input?.elapsedDays)
  const dueDate = input?.due ? new Date(input.due) : null
  const dueValid = dueDate !== null && !Number.isNaN(dueDate.getTime())

  // 约束 2：没有记忆状态就不编日期
  if (stability <= 0 || reps <= 0) {
    return {
      sentence: '这段话你还没真正记住过',
      imperative: '现在看一遍？',
      bucket: 'new',
      daysUntilDue: 0,
      dueLabel: '',
      retention: 0,
    }
  }

  const retention = getRetrievability(stability, Number.isFinite(elapsedDays) ? elapsedDays : 0)

  // 约束 2：排期缺失时只说保持率，不给日期
  if (!dueValid) {
    return {
      sentence: getRetentionHint(retention),
      imperative: retention < 0.8 ? '现在花 10 秒？' : '',
      bucket: retention < 0.8 ? 'today' : 'upcoming',
      daysUntilDue: 0,
      dueLabel: '',
      retention,
    }
  }

  const days = calendarDaysBetween(now, dueDate)
  const dueLabel = toDateLabel(dueDate)

  if (days < 0) {
    return {
      sentence: `已经拖了 ${-days} 天没复习`,
      imperative: '现在花 10 秒？',
      bucket: 'overdue',
      daysUntilDue: days,
      dueLabel,
      retention,
    }
  }

  if (days === 0) {
    return {
      sentence: '今天该过一遍了',
      imperative: '现在花 10 秒？',
      bucket: 'today',
      daysUntilDue: 0,
      dueLabel,
      retention,
    }
  }

  const bucket: VoiceBucket = days <= 6 ? 'soon' : days < 60 ? 'upcoming' : 'distant'
  return {
    // 约束 3：给确切天数，不用模糊词撒谎
    sentence: `大概还能记住 ${describeSpan(days)}`,
    // 约束 1：是邀请，不是"请评判我猜得对不对"
    imperative: days <= 6 ? '想提前过一遍也可以' : '',
    bucket,
    daysUntilDue: days,
    dueLabel,
    retention,
  }
}

/**
 * 评分之后的承诺句 —— 替代过去的「掌握度 32 → 41」。
 *
 * @example describeNextReview(<12天后>) // '好，我 12 天后再来问你'
 */
export function describeNextReview(due: string | null | undefined, now: Date = new Date()): string {
  if (!due) return '好，我稍后再来问你'
  const d = new Date(due)
  if (Number.isNaN(d.getTime())) return '好，我稍后再来问你'

  const days = calendarDaysBetween(now, d)
  if (days <= 0) return '好，今天再问你一次'
  if (days === 1) return '好，明天见'
  if (days === 2) return '好，后天见'
  return `好，我 ${describeSpan(days)}后再来问你`
}

/** 供界面选配色：把分档映射成一个语义色名（不直接写死颜色值） */
export function voiceTone(bucket: VoiceBucket): 'neutral' | 'urgent' | 'due' | 'calm' | 'good' {
  switch (bucket) {
    case 'overdue':
      return 'urgent'
    case 'today':
      return 'due'
    case 'new':
      return 'neutral'
    case 'soon':
      return 'due'
    default:
      return 'good'
  }
}
