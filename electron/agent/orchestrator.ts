import { streamChat } from '../ai-service'
import { logger } from '../logger'
import { classifyIntent } from './intent-classifier'
import { selectStrategy, strategyToPromptHint, BloomLevel } from './strategy-selector'
import { getSystemPrompt } from './system-prompt'
import { methodologiesDb } from '../database'
import { getOrCreateState, updateConceptMastery, adjustDifficulty, clearState } from './state-tracker'
import { extractMemoriesFromConversation } from '../services/memory-service'
import { getPromptTemplate } from '../services/prompt-storage'
import { ContextManager } from './context-manager'
import { BuildContext } from './context-builder'
import { MethodologyContextBuilder } from './builders/methodology-context-builder'
import { KnowledgeCardContextBuilder } from './builders/knowledge-card-context-builder'
import { MemoryContextBuilder } from './builders/memory-context-builder'
import { UserProfileContextBuilder } from './builders/user-profile-context-builder'
import { BookContextBuilder } from './builders/book-context-builder'

type AgentContext = {
  sessionId: string
  bookId?: string
  conversationHistory: Array<{ role: string; content: string }>
}

// 创建上下文管理器实例并注册所有构建器
const contextManager = new ContextManager()
contextManager.registerBuilder(new BookContextBuilder())
contextManager.registerBuilder(new MethodologyContextBuilder())
contextManager.registerBuilder(new KnowledgeCardContextBuilder())
contextManager.registerBuilder(new MemoryContextBuilder())
contextManager.registerBuilder(new UserProfileContextBuilder())

function estimateTokenCount(messages: Array<{ role: string; content: string }>): number {
  let total = 0
  for (const m of messages) {
    // 中文约 1.5 token/字，英文约 0.75 token/字
    // 简单估算：中文字符数 * 1.5 + 英文字符数 * 0.75
    const chineseChars = (m.content.match(/[\u4e00-\u9fa3]/g) || []).length
    const otherChars = m.content.length - chineseChars
    total += Math.ceil(chineseChars * 1.5 + otherChars * 0.75)
  }
  return total
}

function extractConceptFromMessage(message: string): string {
  // 更精确的概念提取模式
  const patterns = [
    /什么是(.+?)[？?]/,
    /(.+?)是什么/,
    /解释(.+?)[？?]/,
    /(.+?)的意思/,
    /教我(.+?)[？?]/,
    /怎么理解(.+?)[？?]/,
    /(.+?)怎么用/,
    /如何理解(.+?)[？?]/,
    /请解释(.+?)[？?]/,
  ]

  for (const p of patterns) {
    const match = message.match(p)
    if (match?.[1]) {
      const concept = match[1].trim()
      // 过滤掉过短或过长的概念
      if (concept.length >= 2 && concept.length <= 30) {
        return concept
      }
    }
  }

  // 如果没有匹配到模式，提取消息中的关键词
  // 移除常见的疑问词和助词
  const cleaned = message
    .replace(/[？?。，、！!]/g, '')
    .replace(/^(请问|想问|问问|帮我看看|告诉我)/, '')
    .replace(/(吗|呢|吧|啊|呀|嘛)/g, '')
    .trim()

  // 提取前15-20个字符作为概念
  return cleaned.substring(0, Math.min(20, cleaned.length)).trim()
}

function assessResponseQuality(userMessage: string, assistantResponse: string): boolean {
  const questionSignals = ['不懂', '不明白', '还是不懂', '没理解', '错了', '不对', '不是这样', '再解释']
  const lowerUser = userMessage.toLowerCase()
  for (const sig of questionSignals) {
    if (lowerUser.includes(sig)) return false
  }
  const understandingSignals = ['明白了', '懂了', '理解了', '原来如此', '谢谢', '对', '是的', '没错']
  for (const sig of understandingSignals) {
    if (lowerUser.includes(sig)) return true
  }
  return assistantResponse.length > 50
}

function buildDifficultyHint(action: { action: string; reason: string }): string {
  try {
    const idMap: Record<string, string> = {
      increase_bloom: 'agent.difficultyHint.increase',
      decrease_bloom: 'agent.difficultyHint.decrease',
      mark_mastered: 'agent.difficultyHint.mastered',
    }
    const promptId = idMap[action.action]
    if (!promptId) return ''
    return getPromptTemplate(promptId)
  } catch {
    return ''
  }
}

function updateMethodologyMastery(bookId: string, response: string, isCorrect: boolean): void {
  try {
    const methodologies = methodologiesDb.getByBookId(bookId) as Array<{
      id: string
      name: string
      name_en?: string
      mastery_level?: number
      practice_count?: number
    }>

    // 使用更精确的匹配方式，避免误匹配
    for (const m of methodologies) {
      // 使用词边界匹配，而非简单的 includes
      const namePattern = new RegExp(`\\b${escapeRegExp(m.name)}\\b`, 'i')
      const nameEnPattern = m.name_en ? new RegExp(`\\b${escapeRegExp(m.name_en)}\\b`, 'i') : null

      const nameInResponse = namePattern.test(response) ||
        (nameEnPattern && nameEnPattern.test(response))

      if (nameInResponse) {
        const currentMastery = Number(m.mastery_level || 0)
        const currentPractice = Number(m.practice_count || 0)
        const newMastery = Math.min(100, currentMastery + (isCorrect ? 5 : 2))
        methodologiesDb.update(m.id, {
          mastery_level: newMastery,
          practice_count: currentPractice + 1,
        })
        logger.info('Methodology mastery updated', {
          name: m.name,
          mastery: `${currentMastery} → ${newMastery}`,
        })
      }
    }
  } catch (err) {
    logger.error('Failed to update methodology mastery', err)
  }
}

// 辅助函数：转义正则表达式特殊字符
function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export async function processMessageStream(
  context: AgentContext,
  userMessage: string,
  onChunk: (chunk: string) => void,
  onComplete: (usage?: { promptTokens: number; completionTokens: number }) => void,
  onError: (error: Error) => void,
  options?: { enableReasoning?: boolean; onReasoningChunk?: (chunk: string) => void }
): Promise<void> {
  // 1. 意图分类和策略选择
  const intent = await classifyIntent(userMessage, context.conversationHistory)
  let strategy = selectStrategy(intent)

  // 2. 难度调整
  const sessionState = getOrCreateState(context.sessionId)
  const difficultyAdjustment = adjustDifficulty(context.sessionId)

  if (difficultyAdjustment.action === 'increase_bloom') {
    const newBloomLevel = Math.min(6, sessionState.currentBloomLevel + 1) as BloomLevel
    strategy = { ...strategy, bloomLevel: newBloomLevel }
    if (newBloomLevel >= 4) strategy = { ...strategy, teachingMode: 'socratic' }
  } else if (difficultyAdjustment.action === 'decrease_bloom') {
    const newBloomLevel = Math.max(1, sessionState.currentBloomLevel - 1) as BloomLevel
    strategy = { ...strategy, bloomLevel: newBloomLevel }
    if (newBloomLevel <= 2) strategy = { ...strategy, teachingMode: 'direct_answer' }
  }

  logger.info('Agent streaming', {
    intent,
    teachingMode: strategy.teachingMode,
    bloomLevel: strategy.bloomLevel,
    difficultyAction: difficultyAdjustment.action,
    historyLength: context.conversationHistory.length,
  })

  // 3. 构建所有上下文
  const buildContext: BuildContext = {
    sessionId: context.sessionId,
    bookId: context.bookId,
    userMessage,
    conversationHistory: context.conversationHistory,
    intent,
    strategy,
  }

  const { combinedContext, results } = await contextManager.buildAll(buildContext)

  logger.info('Context build completed', {
    builders: results.map(r => r.name),
    totalLength: combinedContext.length,
  })

  // 4. 构建系统提示
  const strategyHint = strategyToPromptHint(strategy)
  const difficultyHint = buildDifficultyHint(difficultyAdjustment)
  const masteredConcepts = Array.from(sessionState.conceptStates.entries())
    .filter(([, state]) => state.masteryLevel >= 3)
    .map(([name]) => name)

  const masteryContext = masteredConcepts.length > 0
    ? `\n用户已掌握的概念：${masteredConcepts.join('、')}。可以在此基础上深入或关联。`
    : ''

  // system prompt 只包含人设、策略、难度、掌握概念，不包含 combinedContext
  const systemPromptWithStrategy = getSystemPrompt() + strategyHint + difficultyHint + masteryContext

  // 5. 构建消息
  // 检查是否有任何上下文内容
  const hasContext = combinedContext.trim().length > 0
  const messages = [
    { role: 'system' as const, content: systemPromptWithStrategy },
    ...(context.conversationHistory.slice(-8).map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }))),
    {
      role: 'user' as const,
      content: hasContext
        ? `我的阅读笔记和相关资料：\n${combinedContext}\n\n问题：${userMessage}`
        : `问题：${userMessage}\n\n当前没有提供阅读笔记。请基于你已有的知识回答，并明确告知用户你没有笔记可引用，如果用户需要基于笔记的回答请选择书籍后再提问。`
    },
  ]

  // 6. 发送消息和处理响应
  const estimatedTokens = estimateTokenCount(messages)
  logger.info('Token estimate', { estimatedInputTokens: estimatedTokens })

  let fullResponse = ''
  const originalOnChunk = onChunk
  const wrappedOnChunk = (chunk: string) => {
    fullResponse += chunk
    originalOnChunk(chunk)
  }

  const originalOnComplete = onComplete
  const wrappedOnComplete = (usage?: { promptTokens: number; completionTokens: number }) => {
    const concept = extractConceptFromMessage(userMessage)
    const isCorrect = assessResponseQuality(userMessage, fullResponse)
    updateConceptMastery(context.sessionId, concept, isCorrect)

    logger.info('Concept mastery updated', {
      concept,
      isCorrect,
      sessionId: context.sessionId,
    })

    if (context.bookId) {
      updateMethodologyMastery(context.bookId, fullResponse, isCorrect)
    }

    try {
      extractMemoriesFromConversation(userMessage, fullResponse)
      logger.debug('Extracted memories from conversation')
    } catch (err) {
      logger.error('Failed to extract memories', err)
    }

    originalOnComplete(usage)
  }

  await streamChat(messages, wrappedOnChunk, wrappedOnComplete, onError, {
    enableReasoning: options?.enableReasoning,
    onReasoningChunk: options?.onReasoningChunk,
  })
}

export { clearState }
