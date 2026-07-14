import { UserIntent } from './intent-classifier'
import { StrategyPlan } from './strategy-selector'

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
