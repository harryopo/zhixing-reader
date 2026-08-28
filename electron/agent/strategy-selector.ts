import { UserIntent } from './intent-classifier'
import { getPromptTemplate } from '../services/prompt-storage'

export type BloomLevel = 1 | 2 | 3 | 4 | 5 | 6

export interface StrategyPlan {
  teachingMode: 'direct_answer' | 'socratic' | 'feynman' | 'assessment'
  bloomLevel: BloomLevel
}

const INTENT_STRATEGY_MAP: Record<UserIntent, StrategyPlan> = {
  knowledge_query: {
    teachingMode: 'direct_answer',
    bloomLevel: 1,
  },
  deep_discussion: {
    teachingMode: 'socratic',
    bloomLevel: 3,
  },
  teaching_practice: {
    teachingMode: 'feynman',
    bloomLevel: 2,
  },
  casual_chat: {
    teachingMode: 'direct_answer',
    bloomLevel: 1,
  },
}

export function selectStrategy(intent: UserIntent): StrategyPlan {
  return { ...INTENT_STRATEGY_MAP[intent] }
}

/** 返回意图→策略映射的只读副本（供编排页展示真实配置） */
export function getIntentStrategyMap(): Record<UserIntent, StrategyPlan> {
  const copy = {} as Record<UserIntent, StrategyPlan>
  for (const [intent, plan] of Object.entries(INTENT_STRATEGY_MAP)) {
    copy[intent as UserIntent] = { ...plan }
  }
  return copy
}

export function strategyToPromptHint(strategy: StrategyPlan): string {
  switch (strategy.teachingMode) {
    case 'socratic':
      return getPromptTemplate('agent.strategy.socratic') || '\n使用苏格拉底式提问，通过连续追问引导用户自己发现答案，而非直接给出结论。'
    case 'feynman':
      return getPromptTemplate('agent.strategy.feynman') || '\n使用费曼学习法：先用简单语言解释概念，然后让用户尝试用自己的话复述和解释，发现理解缺口后补充讲解。'
    case 'assessment':
      return getPromptTemplate('agent.strategy.assessment') || '\n生成理解测试题，评估用户掌握程度，根据答题情况调整后续难度。'
    case 'direct_answer':
    default:
      return ''
  }
}