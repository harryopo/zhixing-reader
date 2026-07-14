import { logger } from '../logger'
import { ContextBuilder, BuildContext, ContextBuildResult } from './context-builder'

// 上下文总量限制（token估算）
const MAX_CONTEXT_TOKENS = 4000
const CHARS_PER_TOKEN = 2 // 中文约2字符/token

/**
 * 上下文管理器
 * 负责协调所有上下文构建器的执行
 */
export class ContextManager {
  private builders: ContextBuilder[] = []

  /**
   * 注册上下文构建器
   * @param builder 上下文构建器
   */
  registerBuilder(builder: ContextBuilder): void {
    this.builders.push(builder)
    // 按优先级排序（高优先级在前）
    this.builders.sort((a, b) => b.priority - a.priority)
  }

  /**
   * 构建所有上下文
   * @param context 构建上下文
   * @returns 组合后的上下文字符串和每个构建器的结果
   */
  async buildAll(context: BuildContext): Promise<{
    combinedContext: string
    results: Array<{ name: string; result: ContextBuildResult }>
  }> {
    const results: Array<{ name: string; result: ContextBuildResult }> = []
    let totalTokens = 0
    let truncated = false

    for (const builder of this.builders) {
      if (!builder.shouldBuild(context)) {
        logger.debug(`Skipping context builder: ${builder.name}`)
        continue
      }

      const startTime = Date.now()
      try {
        logger.debug(`Building context: ${builder.name}`)
        const result = await builder.build(context)
        const buildTime = Date.now() - startTime
        
        // 估算当前builder的token数
        const builderTokens = Math.ceil(result.content.length / CHARS_PER_TOKEN)
        
        // 检查是否超出预算
        if (totalTokens + builderTokens > MAX_CONTEXT_TOKENS && !truncated) {
          // 允许最后一个builder部分截断
          const remainingTokens = MAX_CONTEXT_TOKENS - totalTokens
          const maxChars = remainingTokens * CHARS_PER_TOKEN
          if (maxChars > 0 && result.content.length > maxChars) {
            result.content = result.content.substring(0, maxChars) + '...(已截断)'
            truncated = true
            logger.warn(`Context truncated: ${builder.name}`, {
              originalLength: result.content.length,
              truncatedLength: maxChars,
              totalTokens: totalTokens + remainingTokens
            })
          }
        }
        
        results.push({ name: builder.name, result })
        totalTokens += Math.ceil(result.content.length / CHARS_PER_TOKEN)
        
        logger.debug(`Context built: ${builder.name}`, {
          length: result.content.length,
          tokens: Math.ceil(result.content.length / CHARS_PER_TOKEN),
          buildTime,
          hasError: !!result.metadata?.error
        })
        
        // 如果已截断，停止处理后续builder
        if (truncated) {
          logger.info(`Context budget reached, skipping remaining builders`)
          break
        }
      } catch (error) {
        const buildTime = Date.now() - startTime
        const errorMessage = error instanceof Error ? error.message : String(error)
        
        logger.error(`Failed to build context: ${builder.name}`, error)
        
        results.push({
          name: builder.name,
          result: {
            content: '',
            priority: builder.priority,
            metadata: {
              source: 'builder',
              buildTime,
              error: errorMessage
            }
          }
        })
      }
    }

    // 按优先级拼接上下文（已经在注册时排序）
    const combinedContext = results
      .filter(r => r.result.content.length > 0)
      .map(r => r.result.content)
      .join('\n')

    logger.info(`Context build completed`, {
      totalTokens,
      builderCount: results.length,
      truncated
    })

    return { combinedContext, results }
  }

  /**
   * 获取构建器统计信息
   */
  getBuilderStats(): Record<string, { success: number; failure: number; avgBuildTime: number }> {
    // TODO: 实现统计信息收集
    return {}
  }
}
