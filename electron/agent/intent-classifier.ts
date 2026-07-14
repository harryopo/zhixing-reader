import { logger } from '../logger'
import { getPromptTemplate } from '../services/prompt-storage'
import { parseIntentKeywords } from '../services/prompt-storage'

export type UserIntent = 'knowledge_query' | 'deep_discussion' | 'teaching_practice' | 'casual_chat'

const DEFAULT_INTENT_KEYWORDS: Record<UserIntent, string[]> = {
  knowledge_query: [
    '什么是', '是什么', '解释', '意思', '定义', '告诉我', '介绍',
    '简单说', '通俗', '入门', '基础', '概念', '原理', '为什么',
    '怎么回事', '如何理解', '指的是', '区别于', '有什么用',
  ],
  deep_discussion: [
    '深入', '深度', '详细', '核心', '论点', '比较', '对比', '区别',
    '联系', '关联', '具体说', '展开', '思考问题', '思考', '分析',
    '评价', '批判', '优缺点', '利弊', '更深', '本质', '根本原因',
    '背后的', '内在逻辑', '为什么说',
  ],
  teaching_practice: [
    '教我', '费曼', '讲解', '给我讲', '帮我学', '考考我', '测试',
    '评估', '提问我', '怎么用', '如何应用', '实践', '怎么做',
    '复习', '回顾', '帮我复习', '出题', '练习', '举例说明',
    '用例子', '演示', '模拟', '场景',
  ],
  casual_chat: [
    '你好', '嗨', '谢谢', '再见', '哈哈', '早上好', '晚上好',
    '辛苦了', '好的', '明白了',
  ],
}

export function getIntentKeywords(): Record<UserIntent, string[]> {
  try {
    const template = getPromptTemplate('agent.intentKeywords')
    if (template && template.trim()) {
      const parsed = parseIntentKeywords(template)
      if (parsed) {
        return parsed as Record<UserIntent, string[]>
      }
    }
  } catch (err) {
    logger.debug('Failed to parse intent keywords from registry, using default')
  }
  return DEFAULT_INTENT_KEYWORDS
}

const NEGATIVE_PATTERNS: Record<UserIntent, string[]> = {
  knowledge_query: ['怎么用', '如何应用', '实践', '怎么做'],
  deep_discussion: ['简单说', '通俗', '入门', '基础'],
  teaching_practice: ['你好', '谢谢', '再见'],
  casual_chat: ['什么是', '解释', '深入', '教我', '考考我'],
}

function hasQuestionPattern(message: string): boolean {
  return /[？?]/.test(message) || /^(怎么|如何|为什么|哪|谁|什么|几|多少|是否|能不能|可以)/.test(message)
}

function analyzeConversationContext(
  conversationHistory: Array<{ role: string; content: string }>
): { lastAssistantIntent: UserIntent | null; isFollowUp: boolean; isAffirmative: boolean } {
  if (conversationHistory.length === 0) {
    return { lastAssistantIntent: null, isFollowUp: false, isAffirmative: false }
  }

  const lastUserMsg = [...conversationHistory].reverse().find(m => m.role === 'user')
  const lastAssistantMsg = [...conversationHistory].reverse().find(m => m.role === 'assistant')

  let lastAssistantIntent: UserIntent | null = null
  if (lastAssistantMsg) {
    const content = lastAssistantMsg.content
    if (content.includes('你觉得') || content.includes('为什么') || content.includes('你怎么看')) {
      lastAssistantIntent = 'deep_discussion'
    } else if (content.includes('试试') || content.includes('请解释') || content.includes('用自己的话')) {
      lastAssistantIntent = 'teaching_practice'
    }
  }

  const isFollowUp = lastUserMsg
    ? /^(然后呢|接着|继续|还有吗|更多|进一步|展开说说|详细说|比如说)/.test(lastUserMsg.content)
    : false

  const isAffirmative = lastUserMsg
    ? /^(对|是的|没错|正确|嗯|好的|明白|懂了|理解了)/.test(lastUserMsg.content)
    : false

  return { lastAssistantIntent, isFollowUp, isAffirmative }
}

export async function classifyIntent(
  message: string,
  conversationHistory: Array<{ role: string; content: string }>
): Promise<UserIntent> {
  const INTENT_KEYWORDS = getIntentKeywords()
  const lowerMessage = message.toLowerCase()

  const casualMatch = INTENT_KEYWORDS.casual_chat.some(k => lowerMessage.includes(k))
  if (casualMatch && !hasQuestionPattern(message)) {
    const hasOtherIntent = INTENT_KEYWORDS.knowledge_query.concat(
      INTENT_KEYWORDS.deep_discussion, INTENT_KEYWORDS.teaching_practice
    ).some(k => lowerMessage.includes(k))
    if (!hasOtherIntent) {
      logger.debug('Intent classified', { intent: 'casual_chat', message })
      return 'casual_chat'
    }
  }

  const context = analyzeConversationContext(conversationHistory)

  if (context.isFollowUp) {
    logger.debug('Intent classified as follow-up deep_discussion', { message })
    return 'deep_discussion'
  }

  if (context.isAffirmative && hasQuestionPattern(message)) {
    logger.debug('Intent classified as teaching_practice (affirmative + question)', { message })
    return 'teaching_practice'
  }

  const scoredIntents: Array<{ intent: UserIntent; score: number }> = []

  for (const [intent, keywords] of Object.entries(INTENT_KEYWORDS)) {
    if (intent === 'casual_chat') continue

    let score = 0
    for (const keyword of keywords) {
      if (lowerMessage.includes(keyword)) {
        score += keyword.length
      }
    }

    const negatives = NEGATIVE_PATTERNS[intent as UserIntent] || []
    for (const neg of negatives) {
      if (lowerMessage.includes(neg)) {
        score -= neg.length
      }
    }

    if (intent === 'deep_discussion' && context.lastAssistantIntent === 'deep_discussion') {
      score += 2
    }

    if (intent === 'teaching_practice' && context.lastAssistantIntent === 'teaching_practice') {
      score += 2
    }

    scoredIntents.push({ intent: intent as UserIntent, score })
  }

  scoredIntents.sort((a, b) => b.score - a.score)

  if (scoredIntents[0] && scoredIntents[0].score > 0) {
    logger.debug('Intent classified', { intent: scoredIntents[0].intent, score: scoredIntents[0].score, message })
    return scoredIntents[0].intent
  }

  if (hasQuestionPattern(message)) {
    if (conversationHistory.length > 2) {
      logger.debug('Intent defaulted to deep_discussion (question in context)', { message })
      return 'deep_discussion'
    }
    logger.debug('Intent defaulted to knowledge_query (question)', { message })
    return 'knowledge_query'
  }

  logger.debug('Intent defaulted to knowledge_query', { message })
  return 'knowledge_query'
}
