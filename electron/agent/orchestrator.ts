import { sdkStreamChat } from '../ai-sdk-service'
import { logger } from '../logger'
import { classifyIntent } from './intent-classifier'
import { selectStrategy, strategyToPromptHint, BloomLevel } from './strategy-selector'
import { getSystemPrompt } from './system-prompt'
import { methodologiesDb } from '../database'
import { getOrCreateState, updateConceptMastery, adjustDifficulty, clearState as clearTrackerState } from './state-tracker'
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

// ============================================================================
// 会话级 wire 历史视图 —— 服务商前缀缓存命中的关键
//
// DeepSeek/豆包等对「请求前缀逐字节一致」的部分按缓存价计费（DeepSeek 命中价
// 约为全价的 0.8%-2%，豆包 20%）。要做到跨轮命中：
//   1. system prompt 必须逐字节稳定（策略/难度/掌握概念等每轮变化的内容
//      移到本轮 user 消息开头，不再拼进 system）；
//   2. 历史消息必须原样重发上一轮实际发送的字节（而非从 DB 重建的原始消息
//      ——上轮实际发送的 user 是「教学提示+阅读资料+问题」的包装版）；
//   3. 历史只增不减：滑动窗口裁剪头部会让整个前缀失效，因此用较大的
//      条数上限代替激进截断，超限时整段放弃缓存（教学成本一次性）。
// wire 视图仅存内存（会话重启后首轮 miss 重建，属一次性教学成本）。
// ============================================================================

type WireMsg = { role: 'user' | 'assistant'; content: string }

const WIRE_HISTORY_LIMIT = 40
const WIRE_SESSION_LIMIT = 100

const wireHistoryCache = new Map<string, WireMsg[]>()

/** 获取会话 wire 视图；缺失时用渲染端传入的原始历史重建（重启后首轮，接受一次缓存 miss） */
function getWireHistory(
  sessionId: string,
  fallbackHistory: Array<{ role: string; content: string }>,
  currentUserMessage: string,
): WireMsg[] {
  const cached = wireHistoryCache.get(sessionId)
  if (cached) return [...cached]

  // 重建：排除渲染端已追加在末尾的本轮 user 消息（其 content 与 userMessage 相同）
  const withoutCurrent = [...fallbackHistory]
  const lastIdx = withoutCurrent.length - 1
  if (
    lastIdx >= 0 &&
    withoutCurrent[lastIdx].role === 'user' &&
    withoutCurrent[lastIdx].content === currentUserMessage
  ) {
    withoutCurrent.pop()
  }

  const wire = withoutCurrent
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content && m.content.trim().length > 0)
    .slice(-WIRE_HISTORY_LIMIT)
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  wireHistoryCache.set(sessionId, wire)
  return [...wire]
}

/** 追加本轮实际发送的 user 与 assistant 响应到 wire 视图（保持跨轮逐字节一致） */
function appendWire(sessionId: string, userWire: string, assistantResponse: string): void {
  const wire = wireHistoryCache.get(sessionId) ?? []
  wire.push({ role: 'user', content: userWire })
  if (assistantResponse && assistantResponse.trim().length > 0) {
    wire.push({ role: 'assistant', content: assistantResponse })
  }
  // 超限：从最老处成对裁剪（前缀失效一次性教学成本，之后重新累积）
  while (wire.length > WIRE_HISTORY_LIMIT) {
    wire.shift()
  }
  wireHistoryCache.set(sessionId, wire)
}

/** 清理会话 wire 视图（会话删除/重置时调用，防内存泄漏） */
function clearWireHistory(sessionId: string): void {
  wireHistoryCache.delete(sessionId)
}

/** 全量清理：会话数超上限时 FIFO 淘汰，防内存无限增长 */
function enforceWireCacheLimit(): void {
  while (wireHistoryCache.size > WIRE_SESSION_LIMIT) {
    const oldest = wireHistoryCache.keys().next().value
    if (oldest === undefined) break
    wireHistoryCache.delete(oldest)
  }
}

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

    // 修复：\b 对中文名无效（\b 是字母数字与非字母数字边界），导致中文方法论名
    // 几乎永远匹配不上、掌握度从不更新。中文无词边界概念，改用：
    //   - 英文名：\b 词边界（精确，防 FeynmanMethod 误匹配）
    //   - 中文名：includes 子串匹配 + 最小长度 2 保护（中文方法论名通常 ≥2 字，
    //     作为完整短语出现即视为命中，子串误匹配风险可接受）
    const MIN_CN_NAME_LEN = 2
    for (const m of methodologies) {
      const isAsciiName = m.name.split('').every((c) => c.charCodeAt(0) <= 127)
      const namePattern = isAsciiName
        ? new RegExp(`\\b${escapeRegExp(m.name)}\\b`, 'i')
        : null
      const nameEnPattern = m.name_en ? new RegExp(`\\b${escapeRegExp(m.name_en)}\\b`, 'i') : null

      const cnNameHit = !isAsciiName && m.name.length >= MIN_CN_NAME_LEN && response.includes(m.name)
      const nameInResponse =
        (namePattern ? namePattern.test(response) : false) ||
        cnNameHit ||
        (nameEnPattern ? nameEnPattern.test(response) : false)

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

/** 会话状态清理（state-tracker.clearState 的包装，同时清理 wire 历史视图） */
export function clearState(sessionId: string): void {
  clearTrackerState(sessionId)
  clearWireHistory(sessionId)
}

export async function processMessageStream(
  context: AgentContext,
  userMessage: string,
  onChunk: (chunk: string) => void,
  onComplete: (usage?: { promptTokens: number; completionTokens: number; cachedTokens?: number }) => void,
  onError: (error: Error) => void,
  options?: { enableReasoning?: boolean; onReasoningChunk?: (chunk: string) => void }
): Promise<void> {
  logger.info('processMessageStream started', {
    sessionId: context.sessionId,
    bookId: context.bookId,
    userMessageLength: userMessage?.length,
    historyLength: context.conversationHistory?.length,
  })
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

  // 4. system prompt 保持逐字节静态（前缀缓存的前提）：
  //    策略提示 / 难度提示 / 掌握概念这些每轮变化的内容全部移到本轮 user 消息。
  const systemPrompt = getSystemPrompt()

  // 5. 组装本轮 user 消息（wire 版本：该字节串将作为「本轮实际发送内容」进入 wire 视图）
  const strategyHint = strategyToPromptHint(strategy)
  const difficultyHint = buildDifficultyHint(difficultyAdjustment)
  const masteredConcepts = Array.from(sessionState.conceptStates.entries())
    .filter(([, state]) => state.masteryLevel >= 3)
    .map(([name]) => name)

  const masteryContext = masteredConcepts.length > 0
    ? `用户已掌握的概念：${masteredConcepts.join('、')}。可以在此基础上深入或关联。`
    : ''

  const hintBlock = [strategyHint, difficultyHint, masteryContext].filter((s) => s && s.trim()).join('\n')

  const notesBlock = combinedContext.trim().length > 0
    ? `我的阅读笔记和相关资料：\n${combinedContext}`
    : '当前没有提供阅读笔记。请基于你已有的知识回答，并明确告知用户你没有笔记可引用，如果用户需要基于笔记的回答请选择书籍后再提问。'

  const userWire = [hintBlock, notesBlock, `问题：${userMessage}`].filter((s) => s && s.trim()).join('\n\n')

  // 6. 组装消息：[静态 system] + [wire 历史原样重发] + [本轮 user]
  //    历史 wire 视图保证与上一轮实际发送的字节一致 → 服务商前缀缓存命中
  const wireHistory = getWireHistory(context.sessionId, context.conversationHistory, userMessage)

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...wireHistory,
    { role: 'user' as const, content: userWire },
  ]

  // 7. 发送消息和处理响应
  const estimatedTokens = estimateTokenCount(messages)
  logger.info('Token estimate', { estimatedInputTokens: estimatedTokens })
  logger.info('Sending messages to LLM', {
    messageCount: messages.length,
    wireLength: wireHistory.length,
    roles: messages.map(m => m.role),
  })

  let fullResponse = ''
  const originalOnChunk = onChunk
  const wrappedOnChunk = (chunk: string) => {
    logger.info('LLM chunk forwarded', { chunkLength: chunk?.length, preview: chunk?.slice(0, 80) })
    fullResponse += chunk
    originalOnChunk(chunk)
  }

  const originalOnComplete = onComplete
  const wrappedOnComplete = (usage?: { promptTokens: number; completionTokens: number; cachedTokens?: number }) => {
    // wire 视图记录本轮实际发送的 user 与 assistant 响应（下一轮原样重发 → 前缀缓存命中）
    appendWire(context.sessionId, userWire, fullResponse)
    enforceWireCacheLimit()

    const concept = extractConceptFromMessage(userMessage)
    const isCorrect = assessResponseQuality(userMessage, fullResponse)
    updateConceptMastery(context.sessionId, concept, isCorrect)

    logger.info('Concept mastery updated', {
      concept,
      isCorrect,
      sessionId: context.sessionId,
      cachedTokens: usage?.cachedTokens ?? 0,
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

    logger.info('LLM response complete', { fullResponseLength: fullResponse.length, usage })
    originalOnComplete(usage)
  }

  await sdkStreamChat(messages, wrappedOnChunk, wrappedOnComplete, onError, {
    enableReasoning: options?.enableReasoning,
    onReasoningChunk: options?.onReasoningChunk,
  })
}
