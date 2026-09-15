/**
 * 卡片掌握度 — 由 FSRS 记忆状态推导的可展示指标
 *
 * ## 为什么需要它
 * FSRS 为每张卡片维护 `stability`（记忆稳定性，单位：天）与 `difficulty`（记忆难度 1-10）。
 * 这两个数是"这张卡我现在记得多牢"的直接答案，但它们对用户不可读
 * （"稳定性 46.35" 对普通读者没有意义）。本模块把它们压缩成 0-100 的掌握度，
 * 语义与 `Methodologies` 页的方法论掌握度、`VocabularyPage` 的生词掌握度保持一致。
 *
 * ## ⚠️ 口径声明（勿过度解读）
 * 这是一个**应用层启发式指标**，不是 FSRS 论文定义的量，也不代表任何被测验证过的
 * 学习效果。它的取值只依赖 FSRS 自己算出的状态，不引入任何手写或伪造的数据。
 * 需要精确量时请直接看 `stability` / `difficulty` / `retention`。
 *
 * ## 公式
 * ```
 * strength   = S / (S + STABILITY_HALF)        稳定性饱和映射（S = 30 天 → 0.5）
 * practice   = reps / (reps + PRACTICE_HALF)   复习次数饱和（reps = 4 次 → 0.5）
 * dPenalty   = 1 - DIFFICULTY_WEIGHT * (D - 1) / 9
 * lPenalty   = 1 - LAPSE_WEIGHT * lapses / (lapses + LAPSE_HALF)
 * score      = round(100 * strength * practice * dPenalty * lPenalty)
 * ```
 * 三项相乘的含义：记忆要"又牢（S 大）、又练过（reps 多）、又不容易忘（D 小、lapses 少）"
 * 才算掌握。只靠单次评分堆出的大 S 不会直接给高分，这符合"间隔重复要靠次数累积"的常识。
 *
 * 纯函数、零依赖 —— electron 主进程与 renderer 都可直接引用。
 */

/** 稳定性饱和点（天）：S = 30 天时 strength = 0.5 */
export const STABILITY_HALF = 30
/** 复习次数饱和点：reps = 4 次时 practice = 0.5 */
export const PRACTICE_HALF = 4
/** 难度惩罚权重（D = 10 时最多扣 30%） */
export const DIFFICULTY_WEIGHT = 0.3
/** 遗忘惩罚权重（lapses 很多时最多扣 30%） */
export const LAPSE_WEIGHT = 0.3
/** 遗忘次数饱和点 */
export const LAPSE_HALF = 3

export type MasteryLevel = '入门' | '进阶' | '熟练' | '精通'

/** 掌握度等级阈值（与 Methodologies 页保持一致：80 / 60 / 30） */
export const MASTERY_THRESHOLDS = { expert: 80, skilled: 60, intermediate: 30 } as const

/** 计算掌握度所需的 FSRS 卡片字段 */
export interface MasteryInput {
  /** 记忆稳定性（天）。0 表示尚未形成记忆 */
  stability: number
  /** 记忆难度（1-10）。0 表示未知，按中位难度 5 处理 */
  difficulty: number
  /** 累计复习次数 */
  reps: number
  /** 累计遗忘次数 */
  lapses: number
}

export interface CardMastery {
  /** 0-100 整数掌握度 */
  score: number
  /** 等级标签 */
  level: MasteryLevel
  /** 稳定性饱和分量（0-1），用于解释分数来源 */
  strength: number
  /** 练习量饱和分量（0-1） */
  practice: number
}

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0
  return Math.min(Math.max(x, 0), 1)
}

function safeNum(x: unknown): number {
  const n = typeof x === 'number' ? x : Number(x)
  return Number.isFinite(n) ? n : 0
}

/** 掌握度 → 等级标签 */
export function getMasteryLevel(score: number): MasteryLevel {
  const pct = Math.min(Math.max(safeNum(score), 0), 100)
  if (pct >= MASTERY_THRESHOLDS.expert) return '精通'
  if (pct >= MASTERY_THRESHOLDS.skilled) return '熟练'
  if (pct >= MASTERY_THRESHOLDS.intermediate) return '进阶'
  return '入门'
}

/**
 * 由 FSRS 卡片状态推导掌握度。
 *
 * @example
 * getCardMastery({ stability: 0, difficulty: 0, reps: 0, lapses: 0 }).score      // 0   （新卡）
 * getCardMastery({ stability: 2.3, difficulty: 2.1, reps: 1, lapses: 0 }).score  // 1   （刚学一次）
 * getCardMastery({ stability: 159, difficulty: 2.1, reps: 5, lapses: 0 }).score  // 45  （进阶）
 */
export function getCardMastery(input: MasteryInput): CardMastery {
  const stability = Math.max(0, safeNum(input?.stability))
  const reps = Math.max(0, safeNum(input?.reps))
  const lapses = Math.max(0, safeNum(input?.lapses))
  // difficulty 为 0 视为未知（新卡尚未计算），用中位难度 5，避免白送惩罚/奖励
  const rawDifficulty = safeNum(input?.difficulty)
  const difficulty = rawDifficulty > 0 ? Math.min(Math.max(rawDifficulty, 1), 10) : 5

  if (stability <= 0 || reps <= 0) {
    return { score: 0, level: '入门', strength: 0, practice: 0 }
  }

  const strength = clamp01(stability / (stability + STABILITY_HALF))
  const practice = clamp01(reps / (reps + PRACTICE_HALF))
  const difficultyPenalty = 1 - DIFFICULTY_WEIGHT * ((difficulty - 1) / 9)
  const lapsePenalty = 1 - LAPSE_WEIGHT * (lapses / (lapses + LAPSE_HALF))

  const score = Math.round(100 * strength * practice * difficultyPenalty * lapsePenalty)
  const clamped = Math.min(Math.max(score, 0), 100)

  return { score: clamped, level: getMasteryLevel(clamped), strength, practice }
}
// ============================================================================
// 当前保持率（可提取性 R）
// ============================================================================

/**
 * FSRS-6.0 遗忘曲线常数。
 * 与 `electron/fsrs-engine.ts` 中的 `DEFAULT_PARAMETERS.decay / factor` 同源：
 * `decay = -w[20] = -0.1542`，`factor = 0.9^(1/decay) - 1`（保证 R(t = S) = 0.9）。
 */
export const FSRS6_DECAY = -0.1542
export const FSRS6_FACTOR = Math.pow(0.9, 1 / FSRS6_DECAY) - 1

/**
 * 由记忆稳定性与已过天数推导**当前保持率** R ∈ (0, 1]。
 *
 * 公式即 FSRS-6.0 的遗忘曲线：`R(t, S) = (1 + factor · t / S) ^ decay`。
 * 该函数由 `tests/fsrs-metrics.test.ts` 与 ts-fsrs 官方实现的
 * `fsrs().get_retrievability()` 做了逐点一致性校验，不是另写一套公式。
 *
 * @param stability 记忆稳定性（天），<= 0 时返回 0（尚未形成记忆）
 * @param elapsedDays 距上次复习的天数
 */
export function getRetrievability(stability: number, elapsedDays: number): number {
  const s = safeNum(stability)
  if (s <= 0) return 0
  // 已过天数缺失（NaN/Infinity）意味着"无从判断"，返回 0 而不是乐观的 1
  if (!Number.isFinite(Number(elapsedDays))) return 0
  const t = Math.max(0, Number(elapsedDays))
  const r = Math.pow(1 + (FSRS6_FACTOR * t) / s, FSRS6_DECAY)
  if (!Number.isFinite(r)) return 0
  return Math.min(Math.max(r, 0), 1)
}

/** 保持率的可读标签（用于卡片背面提示） */
export function getRetentionHint(retention: number): string {
  if (retention <= 0) return '尚未形成记忆'
  if (retention >= 0.9) return '记忆牢固'
  if (retention >= 0.8) return '记忆良好'
  if (retention >= 0.7) return '开始模糊'
  return '接近遗忘'
}
