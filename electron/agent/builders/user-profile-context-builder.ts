import { logger } from '../../logger'
import {
  buildUserProfile,
  generatePersonalizedPrompt,
  getUserSelfProfile,
  hasSelfOrBehaviorProfile,
  hasUserProfile,
} from '../../services/user-profile-service'
import { ContextBuilder, BuildContext, ContextBuildResult } from '../context-builder'

/**
 * 用户画像上下文构建器
 *
 * 两层数据源：
 *   1. 用户自述资料（个人档案页主动填写的昵称/所在地/简介）——用户主动信号，优先注入。
 *      空白资料不注入（垃圾上下文防护），单字段截断 200 字。
 *   2. 行为推导画像（阅读偏好/认知水平/学习风格，≥3 本书或 ≥10 次对话才启用）。
 *
 * 任一层数据存在即构建；两层数据拼接为「用户画像」上下文注入系统提示。
 */
export class UserProfileContextBuilder implements ContextBuilder {
  name = 'userProfile'
  priority = 40

  shouldBuild(_context: BuildContext): boolean {
    return hasSelfOrBehaviorProfile()
  }

  async build(_context: BuildContext): Promise<ContextBuildResult> {
    const startTime = Date.now()

    try {
      const sections: string[] = []

      // ---- 第 1 层：用户自述资料 ----
      const selfProfile = getUserSelfProfile()
      if (selfProfile) {
        const parts: string[] = []
        if (selfProfile.nickname) parts.push(`- 昵称：${selfProfile.nickname}`)
        if (selfProfile.location) parts.push(`- 所在地：${selfProfile.location}`)
        if (selfProfile.bio) parts.push(`- 自我介绍：${selfProfile.bio}`)
        if (parts.length > 0) {
          sections.push(
            `### 用户自述资料\n${parts.join('\n')}\n（来自用户在个人档案中主动填写，请自然参考其性格与背景调整表达方式，避免机械复述）`
          )
        }
      }

      // ---- 第 2 层：行为推导画像 ----
      if (hasUserProfile()) {
        const profile = await buildUserProfile()
        const personalizedPrompt = generatePersonalizedPrompt(profile)
        if (personalizedPrompt) {
          sections.push(`### 行为画像（系统推导）\n${personalizedPrompt}`)
          logger.info('User profile loaded', { score: profile.cognitiveLevel.overallScore })
        }
      }

      if (sections.length === 0) {
        return { content: '', priority: this.priority, metadata: { source: 'user-profile-service', buildTime: Date.now() - startTime } }
      }

      const content = `\n\n## 用户画像\n${sections.join('\n\n')}\n\n基于用户画像调整回答风格和内容深度。`

      return {
        content,
        priority: this.priority,
        metadata: { source: 'user-profile-service', buildTime: Date.now() - startTime }
      }
    } catch (error) {
      logger.error('Failed to build user profile context', error)
      return {
        content: '',
        priority: this.priority,
        metadata: {
          source: 'user-profile-service',
          buildTime: Date.now() - startTime,
          error: error instanceof Error ? error.message : String(error)
        }
      }
    }
  }
}
