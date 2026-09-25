/**
 * 一次 AI 生成能喂进去多少条划线 —— 唯一真值。
 *
 * 上限存在的原因不是钱，是单次请求的上下文预算与超时（笔记越多，模型回得越慢，
 * 批量蒸馏在第 3 批之后失败率明显上升）。但上限本身不是用户可以猜的东西：
 * 一本书 312 条划线时，界面上必须写出「本次覆盖 60 / 312」，
 * 否则用户会以为那些卡片代表了整本书。
 */
export const AI_INPUT_LIMITS = {
  /** distillKnowledgeCards：知识卡片蒸馏 */
  knowledgeCards: 60,
  /** extractMethodologies：方法论提取（单次调用，不分批） */
  methodologies: 50,
} as const

export type AiCoverageTask = keyof typeof AI_INPUT_LIMITS

export interface CoveragePlan {
  task: AiCoverageTask
  /** 这本书一共有多少条划线 */
  total: number
  /** 本次真正喂给 AI 的条数 */
  covered: number
  /** 被上限挡在外面的条数 */
  skipped: number
  limit: number
  partial: boolean
}

export function planAiCoverage(task: AiCoverageTask, total: number): CoveragePlan {
  const limit = AI_INPUT_LIMITS[task]
  const covered = Math.min(total, limit)
  return { task, total, covered, skipped: total - covered, limit, partial: covered < total }
}

/** 按上限取本次要喂的划线；取到的数组与算出的计划出自同一次调用，不会各说一套 */
export function takeWithinLimit<T>(task: AiCoverageTask, items: T[]): { selected: T[]; plan: CoveragePlan } {
  const plan = planAiCoverage(task, items.length)
  return { selected: items.slice(0, plan.covered), plan }
}

/**
 * 界面上一句话的覆盖口径。完整覆盖时返回 null —— 整本书都处理过了不必强调。
 *
 * 措辞里刻意不写"前 / 后"：被取走的是调用方排序下的前 N 条，而划线在库里按
 * created_at DESC 排，所以那 N 条是"最近的"。这个限定词交给调用方自己决定要不要说。
 */
export function coverageNotice(plan: CoveragePlan, label: string): string | null {
  if (!plan.partial) return null
  return `本次只覆盖 ${plan.covered}/${plan.total} 条${label}，其余 ${plan.skipped} 条未处理`
}
