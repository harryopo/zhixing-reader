import { logger } from '../logger'
import { getRepositories } from '../repositories'
import { settingsService } from './settings-service'

export interface UserProfile {
  id: string
  readingPreferences: ReadingPreferences
  cognitiveLevel: CognitiveLevel
  learningStyle: LearningStyle
  knowledgeGraph: KnowledgeGraph
  conversationPatterns: ConversationPattern
  createdAt: string
  updatedAt: string
}

export interface ReadingPreferences {
  favoriteCategories: Array<{ category: string; count: number }>
  favoriteAuthors: Array<{ author: string; count: number }>
  readingFrequency: 'daily' | 'weekly' | 'occasional'
  completionRate: number
}

export interface CognitiveLevel {
  overallScore: number
  bloomDistribution: Record<string, number>
  conceptMastery: Array<{ concept: string; level: number }>
  strengths: string[]
  weaknesses: string[]
}

export interface LearningStyle {
  preferredExplanation: 'analogy' | 'example' | 'theory' | 'mixed'
  interactionPattern: 'active' | 'passive'
  questionTypes: string[]
  responsePreference: 'concise' | 'detailed'
}

export interface KnowledgeGraph {
  domains: Array<{ domain: string; mastery: number }>
  connections: Array<{ from: string; to: string; strength: number }>
  gaps: string[]
}

export interface ConversationPattern {
  commonTopics: Array<{ topic: string; frequency: number }>
  averageMessageLength: number
  totalConversations: number
}

let cachedProfile: UserProfile | null = null
let cacheTimestamp = 0
const CACHE_TTL = 5 * 60 * 1000

/**
 * 判断是否存在有意义的用户画像数据
 * 只有当用户有足够的阅读数据时才构建画像上下文
 */
export function hasUserProfile(): boolean {
  try {
    const repos = getRepositories()
    const books = repos.books.findAll()
    const conversations = repos.conversations.findAll()
    // 至少有3本书或10次对话才认为有有意义的用户画像
    return books.length >= 3 || conversations.length >= 10
  } catch {
    return false
  }
}

// ============================================================================
// 用户自述资料（个人档案页编辑，存 settings）—— 用户主动填写的高质量信号
// ============================================================================

export interface UserSelfProfile {
  nickname: string
  location: string
  bio: string
}

/** 字段长度上限：防止超长简介变成垃圾上下文挤占 token 预算 */
const SELF_PROFILE_FIELD_MAX = 200

/**
 * 读取用户在个人档案中主动填写的资料。
 * 全部为空（或纯空白）时返回 null——空白资料不注入，避免垃圾上下文。
 */
export function getUserSelfProfile(): UserSelfProfile | null {
  try {
    const nickname = String(settingsService.get('userNickname') ?? '').trim()
    const location = String(settingsService.get('userLocation') ?? '').trim()
    const bio = String(settingsService.get('userBio') ?? '').trim()
    if (!nickname && !location && !bio) return null
    return {
      nickname: nickname.slice(0, SELF_PROFILE_FIELD_MAX),
      location: location.slice(0, SELF_PROFILE_FIELD_MAX),
      bio: bio.slice(0, SELF_PROFILE_FIELD_MAX),
    }
  } catch {
    return null
  }
}

/** 自述资料或行为画像任一存在，即可构建用户画像上下文 */
export function hasSelfOrBehaviorProfile(): boolean {
  if (getUserSelfProfile() !== null) return true
  return hasUserProfile()
}

export async function buildUserProfile(): Promise<UserProfile> {
  const now = Date.now()
  if (cachedProfile && now - cacheTimestamp < CACHE_TTL) {
    return cachedProfile
  }

  try {
    const readingPreferences = analyzeReadingPreferences()
    const cognitiveLevel = analyzeCognitiveLevel()
    const learningStyle = analyzeLearningStyle()
    const knowledgeGraph = buildKnowledgeGraph()
    const conversationPatterns = analyzeConversationPatterns()

    const profile: UserProfile = {
      id: 'default_user',
      readingPreferences,
      cognitiveLevel,
      learningStyle,
      knowledgeGraph,
      conversationPatterns,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }

    cachedProfile = profile
    cacheTimestamp = now
    return profile
  } catch (error) {
    logger.error('Failed to build user profile', error)
    throw error
  }
}

function analyzeReadingPreferences(): ReadingPreferences {
  const repos = getRepositories()
  const books = repos.books.findAll()

  const categoryMap = new Map<string, number>()
  const authorMap = new Map<string, number>()

  for (const book of books) {
    const category = book.category || '未分类'
    const author = book.author || '未知作者'
    categoryMap.set(category, (categoryMap.get(category) || 0) + 1)
    authorMap.set(author, (authorMap.get(author) || 0) + 1)
  }

  const favoriteCategories = Array.from(categoryMap.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  const favoriteAuthors = Array.from(authorMap.entries())
    .map(([author, count]) => ({ author, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5)

  const finishedBooks = books.filter(b => b.readingProgress >= 1).length
  const completionRate = books.length > 0 ? finishedBooks / books.length : 0

  const recentBooks = books.filter(b => {
    const lastRead = b.lastReadTime ? new Date(b.lastReadTime) : null
    if (!lastRead || isNaN(lastRead.getTime())) return false
    const daysSince = (Date.now() - lastRead.getTime()) / (1000 * 60 * 60 * 24)
    return daysSince <= 7
  })

  const readingFrequency = recentBooks.length >= 3 ? 'daily' :
    recentBooks.length >= 1 ? 'weekly' : 'occasional'

  return { favoriteCategories, favoriteAuthors, readingFrequency, completionRate }
}

function analyzeCognitiveLevel(): CognitiveLevel {
  const repos = getRepositories()
  const highlights = repos.highlights.findAll()
  const cards = repos.cards.getReviewStats()

  const conceptMap = new Map<string, { total: number; mastered: number }>()

  for (const highlight of highlights) {
    const content = highlight.content || ''
    const concepts = extractConcepts(content)
    for (const concept of concepts) {
      const existing = conceptMap.get(concept) || { total: 0, mastered: 0 }
      existing.total++
      conceptMap.set(concept, existing)
    }
  }

  const conceptMastery = Array.from(conceptMap.entries())
    .map(([concept, stats]) => ({
      concept,
      level: stats.total > 0 ? Math.min(100, Math.round((stats.mastered / stats.total) * 100)) : 0,
    }))
    .sort((a, b) => b.level - a.level)

  const totalCards = cards.total
  const masteredCards = cards.review
  const overallScore = totalCards > 0 ? Math.round((masteredCards / totalCards) * 100) : 0

  const strengths = conceptMastery.filter(c => c.level >= 70).map(c => c.concept).slice(0, 5)
  const weaknesses = conceptMastery.filter(c => c.level < 30).map(c => c.concept).slice(0, 5)

  const bloomDistribution: Record<string, number> = {
    remember: cards.new,
    understand: cards.review,
    apply: cards.learning,
    analyze: 0,
    evaluate: 0,
    create: 0,
  }

  return { overallScore, bloomDistribution, conceptMastery, strengths, weaknesses }
}

function analyzeLearningStyle(): LearningStyle {
  try {
    const repos = getRepositories()
    const conversations = repos.conversations.findAll()
    if (conversations.length === 0) {
      return {
        preferredExplanation: 'mixed',
        interactionPattern: 'active',
        questionTypes: [],
        responsePreference: 'detailed',
      }
    }

    let totalMessageLength = 0
    let messageCount = 0
    const questionTypeCounts: Record<string, number> = {
      knowledge_query: 0,
      deep_discussion: 0,
      teaching_practice: 0,
      casual_chat: 0,
    }

    for (const conv of conversations.slice(0, 10)) {
      const messages = repos.chatMessages.findByConversationId(conv.id)
      for (const msg of messages) {
        if (msg.role === 'user') {
          totalMessageLength += (msg.content || '').length
          messageCount++

          const content = (msg.content || '').toLowerCase()
          if (/什么|解释|定义|意思/.test(content)) questionTypeCounts.knowledge_query++
          else if (/深入|详细|分析|对比|评价/.test(content)) questionTypeCounts.deep_discussion++
          else if (/教我|考考|练习|怎么做|实践/.test(content)) questionTypeCounts.teaching_practice++
          else if (/你好|谢谢|好的/.test(content)) questionTypeCounts.casual_chat++
        }
      }
    }

    const avgLength = messageCount > 0 ? Math.round(totalMessageLength / messageCount) : 100
    const topQuestionType = Object.entries(questionTypeCounts)
      .sort((a, b) => b[1] - a[1])
      .filter(([k]) => k !== 'casual_chat')
      .map(([k]) => k)

    return {
      preferredExplanation: 'mixed',
      interactionPattern: avgLength > 50 ? 'active' : 'passive',
      questionTypes: topQuestionType.slice(0, 3),
      responsePreference: avgLength > 80 ? 'detailed' : 'concise',
    }
  } catch {
    return {
      preferredExplanation: 'mixed',
      interactionPattern: 'active',
      questionTypes: [],
      responsePreference: 'detailed',
    }
  }
}

function buildKnowledgeGraph(): KnowledgeGraph {
  const repos = getRepositories()
  const books = repos.books.findAll()

  const domainMap = new Map<string, { count: number; mastery: number }>()

  for (const book of books) {
    const category = book.category || '未分类'
    const progress = book.readingProgress || 0
    const existing = domainMap.get(category) || { count: 0, mastery: 0 }
    existing.count++
    existing.mastery = Math.max(existing.mastery, progress * 100)
    domainMap.set(category, existing)
  }

  const domains = Array.from(domainMap.entries())
    .map(([domain, stats]) => ({
      domain,
      mastery: Math.round(stats.mastery / stats.count),
    }))
    .sort((a, b) => b.mastery - a.mastery)

  const gaps = domains.filter(d => d.mastery < 30).map(d => d.domain)

  return { domains, connections: [], gaps }
}

function analyzeConversationPatterns(): ConversationPattern {
  try {
    const repos = getRepositories()
    const conversations = repos.conversations.findAll()
    let totalMessageLength = 0
    let totalMessages = 0

    for (const conv of conversations.slice(0, 20)) {
      const messages = repos.chatMessages.findByConversationId(conv.id)
      for (const msg of messages) {
        if (msg.role === 'user') {
          totalMessageLength += (msg.content || '').length
          totalMessages++
        }
      }
    }

    return {
      commonTopics: [],
      averageMessageLength: totalMessages > 0 ? Math.round(totalMessageLength / totalMessages) : 100,
      totalConversations: conversations.length,
    }
  } catch {
    return { commonTopics: [], averageMessageLength: 100, totalConversations: 0 }
  }
}

function extractConcepts(text: string): string[] {
  const concepts: string[] = []

  const quotedMatches = text.match(/[""「」]([^""「」]+)[""「」]/g)
  if (quotedMatches) {
    concepts.push(...quotedMatches.map(m => m.slice(1, -1)))
  }

  const patterns = [
    /(?:什么是|指的是|称为|叫做|概念是)\s*(.{2,10})/,
    /(.{2,10})\s*(?:是|指的是|意味着)/,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match && match[1]) {
      concepts.push(match[1].trim())
    }
  }

  return [...new Set(concepts)].slice(0, 5)
}

export function generatePersonalizedPrompt(profile: UserProfile): string {
  const parts: string[] = []

  if (profile.readingPreferences.favoriteCategories.length > 0) {
    parts.push(`用户感兴趣的领域：${profile.readingPreferences.favoriteCategories.map(c => c.category).join('、')}`)
  }

  if (profile.cognitiveLevel.overallScore > 0) {
    parts.push(`用户整体认知水平：${profile.cognitiveLevel.overallScore}/100`)
  }

  if (profile.cognitiveLevel.strengths.length > 0) {
    parts.push(`用户擅长领域：${profile.cognitiveLevel.strengths.join('、')}`)
  }

  if (profile.cognitiveLevel.weaknesses.length > 0) {
    parts.push(`用户薄弱领域：${profile.cognitiveLevel.weaknesses.join('、')}`)
  }

  const styleMap = {
    analogy: '喜欢用类比解释',
    example: '喜欢用例子说明',
    theory: '喜欢理论讲解',
    mixed: '喜欢多种方式结合',
  }
  parts.push(`用户学习风格：${styleMap[profile.learningStyle.preferredExplanation]}`)

  if (profile.conversationPatterns.totalConversations > 0) {
    parts.push(`用户已有${profile.conversationPatterns.totalConversations}次对话`)
  }

  return parts.join('\n')
}
