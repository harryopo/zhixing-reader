import { logger } from '../../logger'
import { buildUserProfile, generatePersonalizedPrompt, hasUserProfile } from '../../services/user-profile-service'
import { ContextBuilder, BuildContext, ContextBuildResult } from '../context-builder'

/**
 * 用户画像上下文构建器
 * 基于用户的历史行为和学习数据，构建个性化的用户画像上下文
 */
export class UserProfileContextBuilder implements ContextBuilder {
  name = 'userProfile'
  priority = 40

  shouldBuild(_context: BuildContext): boolean {
    // 只有当用户画像存在时才构建
    return hasUserProfile()
  }

  async build(_context: BuildContext): Promise<ContextBuildResult> {
    const startTime = Date.now()

    try {
      const profile = await buildUserProfile()
      const personalizedPrompt = generatePersonalizedPrompt(profile)

      if (!personalizedPrompt) {
        return { content: '', priority: this.priority, metadata: { source: 'user-profile-service', buildTime: Date.now() - startTime } }
      }

      const content = `\n\n## 用户画像\n${personalizedPrompt}\n\n基于用户画像调整回答风格和内容深度。`

      logger.info('User profile loaded', { score: profile.cognitiveLevel.overallScore })

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
