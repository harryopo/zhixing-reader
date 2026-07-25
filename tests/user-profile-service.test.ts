// 知行读书 — user-profile-service 单元测试（2026-07-24，过夜 Task #12）
//
// 覆盖 hasUserProfile / buildUserProfile / generatePersonalizedPrompt。
// user-profile-service 是 agent 用户画像构建核心，0 单测。
// 用 mock repositories 隔离 DB。注意：buildUserProfile 有 5 分钟模块级缓存，
// 每个测试用 vi.resetModules() + 动态 import 拿到干净的缓存状态。

import { describe, it, expect, beforeEach, vi } from 'vitest'

// vi.hoisted 确保 mock 引用在 vi.mock 工厂内可用
const { mockBooks, mockConversations, mockHighlights, mockCards, mockGetRepos } = vi.hoisted(() => ({
  mockBooks: vi.fn(() => []),
  mockConversations: vi.fn(() => []),
  mockHighlights: vi.fn(() => []),
  mockCards: vi.fn(() => ({ total: 0, new: 0, review: 0, learning: 0 })),
  mockGetRepos: vi.fn(),
}))

vi.mock('../electron/repositories', () => ({
  getRepositories: mockGetRepos,
}))

vi.mock('../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// 默认 repositories stub
mockGetRepos.mockReturnValue({
  books: { findAll: mockBooks },
  conversations: { findAll: mockConversations },
  highlights: { findAll: mockHighlights },
  cards: { getReviewStats: mockCards },
})

import type { UserProfile } from '../electron/services/user-profile-service'

function makeProfile(overrides: Partial<UserProfile> = {}): UserProfile {
  return {
    id: 'default_user',
    readingPreferences: {
      favoriteCategories: [],
      favoriteAuthors: [],
      readingFrequency: 'occasional',
      completionRate: 0,
    },
    cognitiveLevel: {
      overallScore: 0,
      bloomDistribution: {},
      conceptMastery: [],
      strengths: [],
      weaknesses: [],
    },
    learningStyle: {
      preferredExplanation: 'mixed',
      interactionPattern: 'passive',
      questionTypes: [],
      responsePreference: 'concise',
    },
    knowledgeGraph: { domains: [], connections: [], gaps: [] },
    conversationPatterns: {
      commonTopics: [],
      averageMessageLength: 0,
      totalConversations: 0,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

// 动态 import 拿到干净模块状态（绕过缓存）
async function importFresh() {
  vi.resetModules()
  return await import('../electron/services/user-profile-service')
}

describe('user-profile-service — hasUserProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBooks.mockReturnValue([])
    mockConversations.mockReturnValue([])
  })

  it('无书无对话时返回 false', async () => {
    const { hasUserProfile } = await importFresh()
    expect(hasUserProfile()).toBe(false)
  })

  it('有 3 本书时返回 true', async () => {
    mockBooks.mockReturnValue([{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }] as never)
    const { hasUserProfile } = await importFresh()
    expect(hasUserProfile()).toBe(true)
  })

  it('不足 3 本书但 10 次对话时返回 true', async () => {
    mockBooks.mockReturnValue([{ id: 'b1' }] as never)
    mockConversations.mockReturnValue(Array.from({ length: 10 }, (_, i) => ({ id: `c${i}` })) as never)
    const { hasUserProfile } = await importFresh()
    expect(hasUserProfile()).toBe(true)
  })

  it('2 本书 9 次对话时返回 false（未达阈值）', async () => {
    mockBooks.mockReturnValue([{ id: 'b1' }, { id: 'b2' }] as never)
    mockConversations.mockReturnValue(Array.from({ length: 9 }, (_, i) => ({ id: `c${i}` })) as never)
    const { hasUserProfile } = await importFresh()
    expect(hasUserProfile()).toBe(false)
  })

  it('repositories 抛错时返回 false（降级）', async () => {
    mockGetRepos.mockImplementationOnce(() => {
      throw new Error('repos boom')
    })
    const { hasUserProfile } = await importFresh()
    expect(hasUserProfile()).toBe(false)
    // 恢复默认
    mockGetRepos.mockReturnValue({
      books: { findAll: mockBooks },
      conversations: { findAll: mockConversations },
      highlights: { findAll: mockHighlights },
      cards: { getReviewStats: mockCards },
    })
  })
})

describe('user-profile-service — buildUserProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockBooks.mockReturnValue([])
    mockConversations.mockReturnValue([])
    mockHighlights.mockReturnValue([])
    mockCards.mockReturnValue({ total: 0, new: 0, review: 0, learning: 0 })
  })

  it('空数据时仍返回有效 profile 结构', async () => {
    const { buildUserProfile } = await importFresh()
    const profile = await buildUserProfile()
    expect(profile.id).toBe('default_user')
    expect(profile.readingPreferences).toBeDefined()
    expect(profile.cognitiveLevel).toBeDefined()
    expect(profile.learningStyle).toBeDefined()
    expect(profile.knowledgeGraph).toBeDefined()
    expect(profile.conversationPatterns).toBeDefined()
  })

  it('阅读偏好：按分类/作者计数并取前5', async () => {
    mockBooks.mockReturnValue([
      { id: 'b1', category: '认知', author: 'A', readingProgress: 1 },
      { id: 'b2', category: '认知', author: 'A', readingProgress: 0 },
      { id: 'b3', category: '心理', author: 'B', readingProgress: 1 },
    ] as never)
    const { buildUserProfile } = await importFresh()
    const profile = await buildUserProfile()
    const cats = profile.readingPreferences.favoriteCategories
    expect(cats[0]).toEqual({ category: '认知', count: 2 })
    expect(cats[1]).toEqual({ category: '心理', count: 1 })
  })

  it('完成率 = 已读 / 总数', async () => {
    mockBooks.mockReturnValue([
      { id: 'b1', readingProgress: 1 },
      { id: 'b2', readingProgress: 1 },
      { id: 'b3', readingProgress: 0 },
    ] as never)
    const { buildUserProfile } = await importFresh()
    const profile = await buildUserProfile()
    expect(profile.readingPreferences.completionRate).toBeCloseTo(2 / 3)
  })

  it('认知水平：overallScore = 已掌握卡 / 总卡 * 100', async () => {
    mockCards.mockReturnValue({ total: 10, new: 4, review: 6, learning: 0 })
    const { buildUserProfile } = await importFresh()
    const profile = await buildUserProfile()
    expect(profile.cognitiveLevel.overallScore).toBe(60)
  })

  it('bloomDistribution 映射卡片状态', async () => {
    mockCards.mockReturnValue({ total: 10, new: 3, review: 4, learning: 3 })
    const { buildUserProfile } = await importFresh()
    const profile = await buildUserProfile()
    expect(profile.cognitiveLevel.bloomDistribution.remember).toBe(3)
    expect(profile.cognitiveLevel.bloomDistribution.understand).toBe(4)
    expect(profile.cognitiveLevel.bloomDistribution.apply).toBe(3)
  })

  it('缓存：5 分钟内重复调用返回同一对象', async () => {
    const { buildUserProfile } = await importFresh()
    const p1 = await buildUserProfile()
    const p2 = await buildUserProfile()
    expect(p2).toBe(p1)
  })

  it('repositories 抛错时 buildUserProfile 抛出（非降级）', async () => {
    mockGetRepos.mockImplementationOnce(() => {
      throw new Error('fatal')
    })
    const { buildUserProfile } = await importFresh()
    await expect(buildUserProfile()).rejects.toThrow('fatal')
    mockGetRepos.mockReturnValue({
      books: { findAll: mockBooks },
      conversations: { findAll: mockConversations },
      highlights: { findAll: mockHighlights },
      cards: { getReviewStats: mockCards },
    })
  })
})

describe('user-profile-service — generatePersonalizedPrompt', () => {
  // generatePersonalizedPrompt 是纯函数无缓存，用静态 import
  it('无维度数据时仍含学习风格行（学习风格总是输出）', async () => {
    const { generatePersonalizedPrompt } = await importFresh()
    const prompt = generatePersonalizedPrompt(makeProfile())
    expect(prompt).toContain('学习风格')
  })

  it('有 favoriteCategories 时输出感兴趣领域', async () => {
    const { generatePersonalizedPrompt } = await importFresh()
    const prompt = generatePersonalizedPrompt(
      makeProfile({
        readingPreferences: {
          favoriteCategories: [{ category: '认知科学', count: 5 }, { category: '心理', count: 3 }],
          favoriteAuthors: [],
          readingFrequency: 'daily',
          completionRate: 0.5,
        },
      }),
    )
    expect(prompt).toContain('认知科学')
    expect(prompt).toContain('感兴趣')
  })

  it('overallScore > 0 时输出认知水平', async () => {
    const { generatePersonalizedPrompt } = await importFresh()
    const prompt = generatePersonalizedPrompt(
      makeProfile({
        cognitiveLevel: { ...makeProfile().cognitiveLevel, overallScore: 75 },
      }),
    )
    expect(prompt).toContain('75')
    expect(prompt).toContain('认知水平')
  })

  it('有 strengths 时输出擅长领域', async () => {
    const { generatePersonalizedPrompt } = await importFresh()
    const prompt = generatePersonalizedPrompt(
      makeProfile({
        cognitiveLevel: { ...makeProfile().cognitiveLevel, strengths: ['元认知', '系统思维'] },
      }),
    )
    expect(prompt).toContain('元认知')
    expect(prompt).toContain('擅长')
  })

  it('有 weaknesses 时输出薄弱领域', async () => {
    const { generatePersonalizedPrompt } = await importFresh()
    const prompt = generatePersonalizedPrompt(
      makeProfile({
        cognitiveLevel: { ...makeProfile().cognitiveLevel, weaknesses: ['沉没成本'] },
      }),
    )
    expect(prompt).toContain('沉没成本')
    expect(prompt).toContain('薄弱')
  })

  it('多个维度同时存在时都拼接', async () => {
    const { generatePersonalizedPrompt } = await importFresh()
    const prompt = generatePersonalizedPrompt(
      makeProfile({
        readingPreferences: {
          favoriteCategories: [{ category: '认知', count: 1 }],
          favoriteAuthors: [],
          readingFrequency: 'daily',
          completionRate: 0,
        },
        cognitiveLevel: {
          ...makeProfile().cognitiveLevel,
          overallScore: 50,
          strengths: ['A'],
          weaknesses: ['B'],
        },
      }),
    )
    expect(prompt).toContain('感兴趣')
    expect(prompt).toContain('认知水平')
    expect(prompt).toContain('擅长')
    expect(prompt).toContain('薄弱')
  })
})
