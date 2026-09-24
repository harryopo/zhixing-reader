import { estimateTextTokens } from '../../src/shared/usage-tokens'
import { sdkStreamChat } from '../ai-sdk-service'
import { logger } from '../logger'
import { classifyIntent } from './intent-classifier'
import { selectStrategy, strategyToPromptHint, BloomLevel } from './strategy-selector'
import { getSystemPrompt } from './system-prompt'
import { methodologiesDb, conversationDb } from '../database'
import { summarizeHistoryIncremental } from './history-summarizer'
import { getOrCreateState, updateConceptMastery, adjustDifficulty, clearState as clearTrackerState } from './state-tracker'
import { extractMemoriesFromConversation } from '../services/memory-service'
import { getPromptTemplate } from '../services/prompt-storage'
import { ContextManager } from './context-manager'
import { BuildContext, ContextBuildResult } from './context-builder'
import type { RagSourceRef } from '../../src/shared/types'
import { MethodologyContextBuilder } from './builders/methodology-context-builder'
import { ArticleContextBuilder } from './builders/article-context-builder'
import { VocabularyContextBuilder } from './builders/vocabulary-context-builder'
import { KnowledgeCardContextBuilder } from './builders/knowledge-card-context-builder'
import { MemoryContextBuilder } from './builders/memory-context-builder'
import { UserProfileContextBuilder } from './builders/user-profile-context-builder'
import { BookContextBuilder } from './builders/book-context-builder'

type AgentContext = {
  sessionId: string
  bookId?: string
  /**
   * 本轮在练习哪一条方法论（由方法论详情页「注入 AI 对话」带进来）。
   * 练习计数只认这个字段 —— 以前是"AI 回答里出现了方法论名字就算练过一次"，
   * 那是模型的话在给用户记功，界面上的「练过 N 次」溯源不到任何用户动作。
   */
  methodologyId?: string
  conversationHistory: Array<{ role: string; content: string }>
}

// ============================================================================
// 检索可视化（RAG / 知识库调取过程事件化）
// 把 5 维上下文构建的各路检索结果实时推给前端，让「调取知识库」可见。
// ============================================================================

/** 单路知识库检索结果（供前端展示） */
export interface RetrievalSource {
  name: string
  label: string
  source: string
  used: boolean
  itemCount: number
  method?: string
  topScore?: number
  buildTime: number
  previews?: Array<{ title?: string; snippet?: string; score?: number }>
  /**
   * 这一路命中的**真实原文片段**（含 highlightId / bookId / 相关度）。
   * 与 previews 的区别：previews 是给人看过程的缩略，sources 是能定位回原文的数据。
   */
  sources?: RagSourceRef[]
  error?: string
}

/**
 * 检索状态事件：start(开始调取) / done(各路结果)
 *
 * 2026-09-16：`done` 增加 `intent`。
 * 此前意图分类的结果**只写进了日志**，从未发给渲染层，导致 chat_messages.intent
 * 这一列永远是空的（实测 21 条用户消息 0 条有标注）—— 而这是六步流水线的第一步，
 * 也是"这个 App 到底懂不懂我"最直接的证据。
 */
export type RetrievalStatus =
  | { stage: 'start' }
  | {
      stage: 'done'
      sources: RetrievalSource[]
      intent: string
      /** 本轮所有路命中的真实原文片段（扁平化），供消息气泡的「引用来源」使用 */
      ragSources: RagSourceRef[]
    }

const RETRIEVAL_LABELS: Record<string, string> = {
  book: '书籍笔记',
  knowledgeCard: '知识卡片',
  methodology: '方法论',
  memory: '相关记忆',
  userProfile: '用户画像',
}

function toRetrievalSource(r: { name: string; result: ContextBuildResult }): RetrievalSource {
  const m = r.result.metadata
  return {
    name: r.name,
    label: RETRIEVAL_LABELS[r.name] ?? r.name,
    source: m?.source ?? '',
    used: r.result.content.trim().length > 0,
    itemCount: m?.itemCount ?? 0,
    method: m?.method,
    topScore: m?.topScore,
    buildTime: m?.buildTime ?? 0,
    previews: m?.previews,
    sources: m?.sources,
    error: m?.error,
  }
}

/** 转发检索状态事件（抽出以降低 processMessageStream 圈复杂度） */
function emitRetrieval(
  options: { onRetrieval?: (status: RetrievalStatus) => void } | undefined,
  status: RetrievalStatus,
): void {
  options?.onRetrieval?.(status)
}

// 创建上下文管理器实例并注册所有构建器
const contextManager = new ContextManager()
contextManager.registerBuilder(new BookContextBuilder())
contextManager.registerBuilder(new MethodologyContextBuilder())
contextManager.registerBuilder(new ArticleContextBuilder())
contextManager.registerBuilder(new VocabularyContextBuilder())
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

// ============================================================================
// 滚动摘要（Token 优化 Step 3）—— 与 wire 视图协同
//
// wire 历史超阈值时，把最老轮次「增量折叠」进持久化摘要（conversations.history_summary），
// 摘要作为固定位置的 system 块注入。收益：① 原文历史被限制在最近若干轮 → 长会话
// 输入 token 不再线性膨胀；② 摘要持久化 → 跨重启保留早期上下文（wire 仅存内存，重启
// 后只能从渲染端最近几条重建）。折叠时前缀变化属一次性教学成本，与 wire 超限裁剪同源；
// 折叠之间 wire 追加式增长 → 前缀缓存持续命中。
// ============================================================================

const SUMMARY_TRIGGER_COUNT = 24   // wire 超过此条数触发折叠（约 12 轮）
const SUMMARY_KEEP_RECENT = 12     // 折叠后保留最近条数（约 6 轮原文）
const SUMMARY_TIMEOUT_MS = 20000   // 摘要调用超时保护（在响应前 await，防挂起阻塞对话）

const summaryCache = new Map<string, string>()

/**
 * 确保会话摘要最新：wire 历史超阈值时把最老轮次折叠进摘要并 trim。
 * 摘要失败/超时则保留 wire 不动（下轮再试），绝不「已 trim 但摘要缺失」丢上下文。
 * 在组装消息前 await 调用（同步折叠，避免与 appendWire 的竞态）。
 */
async function ensureSummaryFresh(sessionId: string): Promise<void> {
  // 摘要缓存缺失（首轮/重启后）时从 DB 恢复持久化摘要
  if (!summaryCache.has(sessionId)) {
    let persisted: string | null = null
    try {
      persisted = conversationDb.getHistorySummary(sessionId)
    } catch {
      persisted = null
    }
    summaryCache.set(sessionId, persisted ?? '')
  }

  const wire = wireHistoryCache.get(sessionId)
  if (!wire || wire.length <= SUMMARY_TRIGGER_COUNT) return

  const keepRecent = Math.min(SUMMARY_KEEP_RECENT, wire.length - 1)
  const toFold = wire.slice(0, wire.length - keepRecent)
  if (toFold.length === 0) return

  const existing = summaryCache.get(sessionId) ?? ''
  let updated: string
  try {
    updated = await summarizeHistoryIncremental(existing, toFold, AbortSignal.timeout(SUMMARY_TIMEOUT_MS))
  } catch (err) {
    logger.warn('History summary skipped', { error: String(err) })
    return
  }
  // 摘要失败/无变化：保留 wire 不动，下轮再试
  if (!updated || !updated.trim() || updated === existing) return

  summaryCache.set(sessionId, updated)
  try {
    conversationDb.setHistorySummary(sessionId, updated)
  } catch (err) {
    logger.warn('Failed to persist history summary', { error: String(err) })
  }
  // trim 已折叠进摘要的最老轮次
  wireHistoryCache.set(sessionId, wire.slice(wire.length - keepRecent))
  logger.info('History summary folded', {
    sessionId,
    foldedCount: toFold.length,
    wireBefore: wire.length,
    wireAfter: wire.length - keepRecent,
    summaryLength: updated.length,
  })
}

/**
 * 整串消息的 token 估算。
 *
 * 原来这里按「中文 1.5 token/字、英文 0.75」估，而 context-manager 按 0.5 估 ——
 * 两套互相矛盾，差 3 倍。统一走 src/shared/usage-tokens.ts 里按服务商真值校准的那一份。
 */
function estimateTokenCount(messages: Array<{ role: string; content: string }>): number {
  return messages.reduce((total, m) => total + estimateTextTokens(m.content), 0)
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

/**
 * 记一次方法论练习：只在本轮明确带着某条方法论（用户从详情页「注入 AI 对话」进来）时才算。
 *
 * 取代原先那套"在 AI 的回答文本里找方法论名字"的写法 —— 它在模型的输出里
 * 找命中就给用户 practice_count +1、mastery +5/+2。用户什么也没做，只要模型顺嘴提了一句
 * 「比如番茄工作法」，界面上就多出一次练习 —— 数字溯不到源头，是本项目明确不要的写法。
 */
export function recordMethodologyPractice(
  methodologyId: string,
  isCorrect: boolean,
): void {
  const row = methodologiesDb.getById(methodologyId) as
    | { id: string; name?: string; mastery_level?: number; practice_count?: number }
    | undefined
  if (!row) {
    // 方法论被删了还在旧会话里练：记不上，但要说清为什么记不上
    logger.info('Methodology practice skipped: methodology not found', { methodologyId })
    return
  }
  const currentMastery = Number(row.mastery_level || 0)
  const currentPractice = Number(row.practice_count || 0)
  const newMastery = Math.min(100, currentMastery + (isCorrect ? 5 : 2))
  methodologiesDb.update(methodologyId, {
    mastery_level: newMastery,
    practice_count: currentPractice + 1,
  })
  logger.info('Methodology practice recorded', {
    methodologyId,
    name: row.name,
    mastery: `${currentMastery} → ${newMastery}`,
    practice: currentPractice + 1,
  })
}

/** 会话状态清理（state-tracker.clearState 的包装，同时清理 wire 历史视图） */
export function clearState(sessionId: string): void {
  clearTrackerState(sessionId)
  clearWireHistory(sessionId)
  summaryCache.delete(sessionId)
}

export async function processMessageStream(
  context: AgentContext,
  userMessage: string,
  onChunk: (chunk: string) => void,
  onComplete: (usage?: { promptTokens: number; completionTokens: number; cachedTokens?: number }) => void,
  onError: (error: Error) => void,
  options?: { enableReasoning?: boolean; onReasoningChunk?: (chunk: string) => void; onRetrieval?: (status: RetrievalStatus) => void }
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

  // 检索可视化：开始调取知识库
  emitRetrieval(options, { stage: 'start' })
  const { combinedContext, results } = await contextManager.buildAll(buildContext)
  // 检索可视化：各路知识库检索结果（供前端「调取知识库」面板展示）
  const retrievalSources = results.map(toRetrievalSource)
  emitRetrieval(options, {
    stage: 'done',
    sources: retrievalSources,
    intent,
    // 扁平化所有路的真实片段，供「引用来源」落库（并去掉没有任何身份的脏数据）
    ragSources: retrievalSources
      .flatMap((s) => s.sources ?? [])
      .filter((s) => Boolean(s?.highlightId && s?.bookId)),
  })

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

  /*
    练习聚焦：从方法论详情页「注入 AI 对话」进来时，这一轮围着那一条方法论练。
    和策略提示、难度提示一样放进本轮 user 消息 —— system prompt 必须逐字节静态，
    前缀缓存才成立。
  */
  const practiced = context.methodologyId
    ? (methodologiesDb.getById(context.methodologyId) as { name?: string } | undefined)
    : undefined
  const practiceHint = practiced?.name
    ? `本轮在练习方法论「${practiced.name}」。请先让用户用自己的话讲清它的步骤与适用时机，再指出具体缺口；不要替用户总结。`
    : ''

  const hintBlock = [strategyHint, difficultyHint, masteryContext, practiceHint]
    .filter((s) => s && s.trim())
    .join('\n')

  const notesBlock = combinedContext.trim().length > 0
    ? `我的阅读笔记和相关资料：\n${combinedContext}`
    : '当前没有提供阅读笔记。请基于你已有的知识回答，并明确告知用户你没有笔记可引用，如果用户需要基于笔记的回答请选择书籍后再提问。'

  const userWire = [hintBlock, notesBlock, `问题：${userMessage}`].filter((s) => s && s.trim()).join('\n\n')

  // 6. 组装消息：[静态 system] + [滚动摘要 system（若有）] + [wire 历史原样重发] + [本轮 user]
  //    摘要与 wire 视图均字节稳定（仅折叠时变化）→ 共同保障服务商前缀缓存命中
  getWireHistory(context.sessionId, context.conversationHistory, userMessage)  // 确保 wire 缓存已填充（重启后首轮重建）
  await ensureSummaryFresh(context.sessionId)  // 超阈值则折叠最老轮次进摘要并 trim wire（同步，避免竞态）
  const wireHistory = wireHistoryCache.get(context.sessionId) ?? []
  const historySummary = (summaryCache.get(context.sessionId) ?? '').trim()
  const summaryBlock = historySummary
    ? `【更早对话的滚动摘要（原文已折叠，供参考，勿机械复述）】\n${historySummary}`
    : ''

  const messages = [
    { role: 'system' as const, content: systemPrompt },
    ...(summaryBlock ? [{ role: 'system' as const, content: summaryBlock }] : []),
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
    // 历史里存**用户原话**，不存展开后的那一轮：展开块含本轮检索到的笔记，
    // 一旦进历史就每轮重发（用户早已看过、且与后续问题无关的片段），
    // 白花输入 token。这也让会话内与重启重建两条路的历史口径一致。
    appendWire(context.sessionId, userMessage, fullResponse)
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

    // 练习计数只认"这一轮带着某条方法论进来练"这个用户动作
    if (context.methodologyId) {
      recordMethodologyPractice(context.methodologyId, isCorrect)
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
    intent,
  })
}
