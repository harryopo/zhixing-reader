import { UserIntent } from './intent-classifier'
import { StrategyPlan } from './strategy-selector'
import type { RagSourceRef } from '../../src/shared/types'

/** 检索命中条目预览（用于前端「调取知识库」可视化展开） */
export interface RetrievalPreview {
  title?: string
  snippet?: string
  score?: number
}

/**
 * 上下文构建结果
 */
export interface ContextBuildResult {
  content: string
  priority: number
  metadata?: {
    source: string
    buildTime: number
    error?: string
    /** 检索到的条目数（可视化用） */
    itemCount?: number
    /** 检索方式：semantic(向量语义) / keyword(关键词) / relevance(相关度排序) / profile(画像) */
    method?: string
    /** 最高相关度（0-1，RAG 语义检索时有值） */
    topScore?: number
    /** 命中条目预览（标题/片段），供 UI 展开 */
    previews?: RetrievalPreview[]
    /**
     * 命中的**真实原文片段**（含 highlightId / bookId / 相关度）。
     *
     * 2026-09-16 新增：previews 只有 title/snippet/score，是给「调取知识库」
     * 面板看过程用的；而消息气泡的「引用来源」需要能定位回具体划线。
     * 此前这一层就已经把 highlightId / bookId / relevanceScore 丢掉了，
     * 导致 chat_messages.sources 永远是空的（实测 21 条消息 0 条有值）。
     */
    sources?: RagSourceRef[]
  }
}

/**
 * 构建上下文，包含构建所需的所有信息
 */
export interface BuildContext {
  sessionId: string
  bookId?: string
  userMessage: string
  conversationHistory: Array<{ role: string; content: string }>
  intent?: UserIntent
  strategy?: StrategyPlan
}

/**
 * 上下文构建器接口
 * 所有上下文构建器都必须实现此接口
 */
export interface ContextBuilder {
  /** 构建器名称 */
  name: string
  
  /** 优先级，数字越大优先级越高 */
  priority: number
  
  /**
   * 判断是否需要构建此上下文
   * @param context 构建上下文
   */
  shouldBuild(context: BuildContext): boolean
  
  /**
   * 构建上下文内容
   * @param context 构建上下文
   */
  build(context: BuildContext): Promise<ContextBuildResult> | ContextBuildResult
}
