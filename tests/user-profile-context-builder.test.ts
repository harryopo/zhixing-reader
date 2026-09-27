// 用户画像上下文构建器（2026-09-27）
//
// 起点是覆盖率清单里那条 **36.36 / 50 / 100**：`shouldBuild` 走过、`build` 的两层装配没走过。
// 这个构建器决定了「AI 回答时看不看得到你是谁」，界面上永远不报错，坏起来的表现是
// 提示词里静悄悄少了整块画像 —— 所以判据只能逐项对账它自己那几条决定。
//
// mock 只打在**这一层唯一的下游**（`user-profile-service`）与 logger 上：
// 服务自己读库的口径由 `tests/user-profile-service.test.ts`（mock 库）与
// `tests/user-profile-service-real-db.test.ts`（真库）两份负责，这里不重复一遍，
// 也正因为如此，本文件能把「服务交回什么形状」逐条喂准（含真实通路里很难造的失败）。
//
// 上一批 `tests/agent-builders.test.ts` 里那两条「shouldBuild 始终返回 false（当前禁用）」
// 挪到了这里：那两条其实是靠"共享测试画像目录里恰好没有 settings.json"才成立的，
// 读的是真设置文件而不是给定条件；档案页一填昵称就会变成假绿。判据要自己喂数据。

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import type { UserProfile, UserSelfProfile } from '../electron/services/user-profile-service'
import type { BuildContext } from '../electron/agent/context-builder'

const { seams, logger } = vi.hoisted(() => ({
  seams: {
    hasSelfOrBehaviorProfile: vi.fn<() => boolean>(() => false),
    getUserSelfProfile: vi.fn<() => UserSelfProfile | null>(() => null),
    hasUserProfile: vi.fn<() => boolean>(() => false),
    buildUserProfile: vi.fn<() => Promise<unknown>>(async () => ({})),
    generatePersonalizedPrompt: vi.fn<(profile: unknown) => string>(() => ''),
  },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../electron/services/user-profile-service', () => seams)
vi.mock('../electron/logger', () => ({ logger }))

import { UserProfileContextBuilder } from '../electron/agent/builders/user-profile-context-builder'

const ctx: BuildContext = {
  sessionId: 's1',
  userMessage: '最近在读什么',
  conversationHistory: [],
}

const SELF: UserSelfProfile = { nickname: '阿知', location: '杭州', bio: '在读认知科学' }

/** 只填一项的档案：这是界面上最常见的形状（头像旁边就一个昵称） */
const NICKNAME_ONLY: UserSelfProfile = { nickname: '阿知', location: '', bio: '' }

/** 构建器只读 cognitiveLevel.overallScore（打日志用），其余字段按服务的真实形状补齐 */
function profileFixture(overallScore: number): UserProfile {
  return {
    id: 'default_user',
    readingPreferences: {
      favoriteCategories: [],
      favoriteAuthors: [],
      readingFrequency: 'occasional',
      completionRate: 0,
    },
    cognitiveLevel: { overallScore, bloomDistribution: {}, conceptMastery: [], strengths: [], weaknesses: [] },
    learningStyle: {
      preferredExplanation: 'mixed',
      interactionPattern: 'passive',
      questionTypes: [],
      responsePreference: 'concise',
    },
    knowledgeGraph: { domains: [], connections: [], gaps: [] },
    conversationPatterns: { commonTopics: [], averageMessageLength: 0, totalConversations: 0 },
    createdAt: '2026-09-27T00:00:00.000Z',
    updatedAt: '2026-09-27T00:00:00.000Z',
  }
}

const builder = () => new UserProfileContextBuilder()
const build = async () => await builder().build(ctx)

beforeEach(() => {
  vi.clearAllMocks()
  seams.hasSelfOrBehaviorProfile.mockReturnValue(false)
  seams.getUserSelfProfile.mockReturnValue(null)
  seams.hasUserProfile.mockReturnValue(false)
  seams.buildUserProfile.mockResolvedValue(profileFixture(0))
  seams.generatePersonalizedPrompt.mockReturnValue('')
})

describe('shouldBuild：门由谁开', () => {
  it('服务说有两种画像之一就构建', () => {
    seams.hasSelfOrBehaviorProfile.mockReturnValue(true)
    expect(builder().shouldBuild(ctx)).toBe(true)
  })

  it('两层都没有就不构建', () => {
    seams.hasSelfOrBehaviorProfile.mockReturnValue(false)
    expect(builder().shouldBuild(ctx)).toBe(false)
  })

  it('开的是「自述或行为」那扇门，不是只看行为画像那扇（只填昵称的用户照样要画像）', () => {
    // 服务层真实语义：库里 0 本书、档案里填了昵称 → hasSelfOrBehaviorProfile true、hasUserProfile false。
    // 这一条防的是"顺手退回只看书/会话那扇旧门"——那样个人档案页填的资料就永远开不了门。
    seams.hasSelfOrBehaviorProfile.mockReturnValue(true)
    seams.hasUserProfile.mockReturnValue(false)
    expect(builder().shouldBuild(ctx)).toBe(true)
    expect(seams.hasUserProfile).not.toHaveBeenCalled()
  })

  it('开门不预支计算：shouldBuild 一次都不许画像', () => {
    seams.hasSelfOrBehaviorProfile.mockReturnValue(true)
    builder().shouldBuild(ctx)
    expect(seams.buildUserProfile).not.toHaveBeenCalled()
  })
})

describe('第 1 层：用户自述资料', () => {
  it('三项齐全时逐行摆出，并写明这是用户主动填的', async () => {
    seams.getUserSelfProfile.mockReturnValue(SELF)
    const { content } = await build()
    expect(content).toContain('### 用户自述资料')
    expect(content).toContain('- 昵称：阿知')
    expect(content).toContain('- 所在地：杭州')
    expect(content).toContain('- 自我介绍：在读认知科学')
    expect(content).toContain('主动填写')
  })

  it('只填昵称时不摆「所在地：」与「自我介绍：」两行空值', async () => {
    seams.getUserSelfProfile.mockReturnValue(NICKNAME_ONLY)
    const { content } = await build()
    expect(content).toContain('- 昵称：阿知')
    expect(content).not.toContain('所在地：')
    expect(content).not.toContain('自我介绍：')
  })

  it('服务交回一个三项全空的形状时，不注入一个光秃秃的标题', async () => {
    // 现在服务不会交回这种形状（全空时它回 null），但装配决定是这一层自己做的：
    // 空资料进提示词就是白花 token 还让 AI 以为用户什么都没写。
    seams.getUserSelfProfile.mockReturnValue({ nickname: '', location: '', bio: '' })
    const { content, metadata } = await build()
    expect(content).toBe('')
    expect(metadata?.itemCount).toBe(0)
  })

  it('档案文本原样进提示词：截断只有服务层那一份，这里不重复切一刀', async () => {
    const bio = '甲'.repeat(200)
    seams.getUserSelfProfile.mockReturnValue({ nickname: '', location: '', bio })
    const { content } = await build()
    expect(content).toContain(bio)
    expect(content.split('\n').find((l) => l.startsWith('- 自我介绍：'))).toBe(`- 自我介绍：${bio}`)
  })
})

describe('第 2 层：行为推导画像', () => {
  it('有画像数据时才去算，并把服务给的那段话摆在「行为画像（系统推导）」下面', async () => {
    seams.hasUserProfile.mockReturnValue(true)
    seams.buildUserProfile.mockResolvedValue(profileFixture(42))
    seams.generatePersonalizedPrompt.mockReturnValue('用户感兴趣的领域：心理学')
    const { content } = await build()
    expect(seams.buildUserProfile).toHaveBeenCalledTimes(1)
    expect(content).toContain('### 行为画像（系统推导）')
    expect(content).toContain('用户感兴趣的领域：心理学')
  })

  it('没到画像门槛时一次都不算（不白扫全库）', async () => {
    seams.hasUserProfile.mockReturnValue(false)
    await build()
    expect(seams.buildUserProfile).not.toHaveBeenCalled()
    expect(seams.generatePersonalizedPrompt).not.toHaveBeenCalled()
  })

  it('服务说这段没什么可说（空串）时不摆空的二级标题', async () => {
    seams.hasUserProfile.mockReturnValue(true)
    seams.generatePersonalizedPrompt.mockReturnValue('')
    const { content } = await build()
    expect(content).toBe('')
    expect(seams.buildUserProfile).toHaveBeenCalledTimes(1) // 算了，只是没什么可说
  })

  it('算出画像就记一条日志带上认知得分（界面之外唯一的可观测口径）', async () => {
    seams.hasUserProfile.mockReturnValue(true)
    seams.buildUserProfile.mockResolvedValue(profileFixture(73))
    seams.generatePersonalizedPrompt.mockReturnValue('用户整体认知水平：73/100')
    await build()
    expect(logger.info).toHaveBeenCalledWith('User profile loaded', { score: 73 })
  })

  it('传给提示词的就是算出来的那份画像，不是另取一份', async () => {
    const profile = profileFixture(11)
    seams.hasUserProfile.mockReturnValue(true)
    seams.buildUserProfile.mockResolvedValue(profile)
    await build()
    expect(seams.generatePersonalizedPrompt).toHaveBeenCalledWith(profile)
  })
})

describe('两层装配成一个上下文块', () => {
  it('只有一层时的完整文本：首尾各带一句说明，不带第二层的空壳', async () => {
    seams.getUserSelfProfile.mockReturnValue(NICKNAME_ONLY)
    const { content } = await build()
    expect(content).toBe(
      '\n\n## 用户画像\n### 用户自述资料\n- 昵称：阿知\n（来自用户在个人档案中主动填写，请自然参考其性格与背景调整表达方式，避免机械复述）\n\n基于用户画像调整回答风格和内容深度。'
    )
  })

  it('两层都在时：自述在前、行为在后，中间空一行', async () => {
    seams.getUserSelfProfile.mockReturnValue(SELF)
    seams.hasUserProfile.mockReturnValue(true)
    seams.generatePersonalizedPrompt.mockReturnValue('用户学习风格：喜欢多种方式结合')
    const { content } = await build()
    expect(content.indexOf('### 用户自述资料')).toBeLessThan(content.indexOf('### 行为画像（系统推导）'))
    expect(content).toContain('避免机械复述）\n\n### 行为画像（系统推导）')
    expect(content.match(/## 用户画像/g)).toHaveLength(1)
  })

  it('两层都空时交回空串，不摆一个「## 用户画像」的空标题', async () => {
    const { content } = await build()
    expect(content).toBe('')
    expect(content).not.toContain('用户画像')
  })

  it('itemCount 就是真的拼了几段（0 / 1 / 2 各一种形状）', async () => {
    expect((await build()).metadata?.itemCount).toBe(0)
    seams.getUserSelfProfile.mockReturnValue(NICKNAME_ONLY)
    expect((await build()).metadata?.itemCount).toBe(1)
    seams.hasUserProfile.mockReturnValue(true)
    seams.generatePersonalizedPrompt.mockReturnValue('用户已有 3 次对话')
    expect((await build()).metadata?.itemCount).toBe(2)
  })

  it('优先级与来源标识恒定：预算排序与「调取知识库」面板都靠它们认这段是谁', async () => {
    const { priority, metadata } = await build()
    expect(priority).toBe(40)
    expect(metadata?.source).toBe('user-profile-service')
    expect(metadata?.method).toBe('profile')
  })
})

describe('一层坏了不许把另一层一起抹掉', () => {
  it('行为画像算崩了，用户自己填的资料照样进提示词', async () => {
    seams.getUserSelfProfile.mockReturnValue(SELF)
    seams.hasUserProfile.mockReturnValue(true)
    seams.buildUserProfile.mockRejectedValue(new Error('profile boom'))
    const { content, metadata } = await build()
    expect(content).toContain('- 昵称：阿知')
    expect(metadata?.itemCount).toBe(1)
    expect(metadata?.error).toBe('profile boom')
    expect(logger.error).toHaveBeenCalledWith('Failed to build user profile context', expect.any(Error))
  })

  it('判门槛那一步就抛，也保住第 1 层', async () => {
    seams.getUserSelfProfile.mockReturnValue(NICKNAME_ONLY)
    seams.hasUserProfile.mockImplementation(() => {
      throw new Error('gate boom')
    })
    const { content, metadata } = await build()
    expect(content).toContain('- 昵称：阿知')
    expect(metadata?.error).toBe('gate boom')
  })

  it('拼文案那一步抛，同样保住第 1 层', async () => {
    seams.getUserSelfProfile.mockReturnValue(NICKNAME_ONLY)
    seams.hasUserProfile.mockReturnValue(true)
    seams.generatePersonalizedPrompt.mockImplementation(() => {
      throw new Error('prompt boom')
    })
    const { content, metadata } = await build()
    expect(content).toContain('- 昵称：阿知')
    expect(metadata?.error).toBe('prompt boom')
  })

  it('第 1 层自己就抛时无内容可留：空串 + 报出错误，不静默当「用户没填档案」', async () => {
    seams.getUserSelfProfile.mockImplementation(() => {
      throw new Error('settings boom')
    })
    const { content, metadata } = await build()
    expect(content).toBe('')
    expect(metadata?.itemCount).toBe(0)
    expect(metadata?.error).toBe('settings boom')
    expect(logger.error).toHaveBeenCalledTimes(1)
  })

  it('抛的不是 Error 也如实记下那句话（不许变成 undefined）', async () => {
    seams.buildUserProfile.mockRejectedValue('plain string boom')
    seams.getUserSelfProfile.mockReturnValue(NICKNAME_ONLY)
    seams.hasUserProfile.mockReturnValue(true)
    const { content, metadata } = await build()
    expect(content).toContain('- 昵称：阿知')
    expect(metadata?.error).toBe('plain string boom')
  })

  it('出过错时 buildTime 与其余元数据照样齐（面板读的是同一份形状）', async () => {
    seams.hasUserProfile.mockReturnValue(true)
    seams.buildUserProfile.mockRejectedValue(new Error('boom'))
    const { metadata } = await build()
    expect(typeof metadata?.buildTime).toBe('number')
    expect(metadata?.source).toBe('user-profile-service')
    expect(metadata?.method).toBe('profile')
  })
})

describe('接线：写出来得真的被注册', () => {
  const orchestrator = readFileSync(resolve(process.cwd(), 'electron/agent/orchestrator.ts'), 'utf8')

  it('编排器注册的是这个构建器（不是留在文件里没人调）', () => {
    expect(orchestrator).toContain('new UserProfileContextBuilder()')
  })

  it('名字就叫 userProfile（日志与「调取知识库」按它认这段）', () => {
    expect(builder().name).toBe('userProfile')
  })
})
