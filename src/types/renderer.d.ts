import { Book, Highlight, Card, Review, BookSummary, DailyStats, ReviewStats, ReadingDataResponse, RecommendationItem } from '../shared/types'

export interface TokenSummary {
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
}

export interface TokenRecord {
  id: string
  provider: string
  model: string
  feature: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cost_usd: number
  duration_ms: number
  created_at: string
}

export interface ElectronAPI {
  book: {
    getAll: () => Promise<Book[]>
    getById: (id: string) => Promise<Book>
    create: (book: Record<string, unknown>) => Promise<Book>
    update: (id: string, book: Record<string, unknown>) => Promise<Book>
    delete: (id: string) => Promise<void>
    updateProgress: (id: string, progress: number) => Promise<void>
    search: (keyword: string) => Promise<Book[]>
  }
  highlight: {
    getByBook: (bookId: string) => Promise<Highlight[]>
    getById: (id: string) => Promise<Highlight>
    create: (highlight: Record<string, unknown>) => Promise<Highlight>
    update: (id: string, highlight: Record<string, unknown>) => Promise<Highlight>
    delete: (id: string) => Promise<void>
    getAll: () => Promise<Highlight[]>
    search: (keyword: string) => Promise<Highlight[]>
    export: () => Promise<{ saved: boolean; count: number; path?: string }>
  }
  card: {
    getByHighlight: (highlightId: string) => Promise<Card[]>
    getById: (id: string) => Promise<Card>
    create: (highlightId: string) => Promise<Card>
    createBatch: (highlightIds: string[]) => Promise<Card[]>
    createForExisting: () => Promise<{ created: number; skipped: number }>
    update: (card: Record<string, unknown>) => Promise<Card>
    updateApplicationTag: (id: string, tag: string) => Promise<void>
    updateMasteryLevel: (id: string, level: number) => Promise<void>
    delete: (id: string) => Promise<void>
    getDue: (limit?: number) => Promise<Card[]>
    getByBook: (bookId: string) => Promise<Card[]>
    getStats: () => Promise<ReviewStats>
    review: (id: string, quality: number) => Promise<Review>
  }
  review: {
    getHistory: (cardId: string) => Promise<Review[]>
    getRecent: (limit?: number) => Promise<Review[]>
  }
  article: {
    getAll: (limit?: number) => Promise<Record<string, unknown>[]>
    getById: (id: string) => Promise<Record<string, unknown> | undefined>
    getUnread: (limit?: number) => Promise<Record<string, unknown>[]>
    getFavorites: (limit?: number) => Promise<Record<string, unknown>[]>
    create: (article: Record<string, unknown>) => Promise<boolean>
    markAsRead: (id: string) => Promise<void>
    toggleFavorite: (id: string) => Promise<boolean>
    delete: (id: string) => Promise<void>
    getStats: () => Promise<{ total: number; today: number }>
    fetchRss: () => Promise<Record<string, unknown>[]>
    translate: (id: string) => Promise<{ title_zh: string; summary_zh: string; content_zh: string }>
  }
  vocabulary: {
    getAll: (limit?: number) => Promise<Record<string, unknown>[]>
    getById: (id: string) => Promise<Record<string, unknown> | undefined>
    getByWord: (word: string) => Promise<Record<string, unknown> | undefined>
    getUnmastered: (limit?: number) => Promise<Record<string, unknown>[]>
    getDueForReview: (limit?: number) => Promise<Record<string, unknown>[]>
    create: (vocab: Record<string, unknown>) => Promise<Record<string, unknown> | null>
    createFromLookup: (word: string, source?: string) => Promise<Record<string, unknown> | null>
    markAsMastered: (id: string) => Promise<void>
    incrementReview: (id: string) => Promise<void>
    updateReviewData: (id: string, reviewData: Record<string, unknown>) => Promise<Record<string, unknown> | null>
    delete: (id: string) => Promise<void>
    getStats: () => Promise<{ total: number; mastered: number; dueToday: number }>
    search: (keyword: string) => Promise<Record<string, unknown>[]>
    export: (
      format: 'csv' | 'anki',
      items: Array<{
        word: string
        phonetic?: string
        part_of_speech?: string
        meaning_zh: string
        example_en?: string
        example_zh?: string
      }>,
    ) => Promise<{ saved: boolean; count: number; path?: string }>
  }
  dictionary: {
    lookup: (word: string) => Promise<Record<string, unknown> | null>
    lookupBatch: (words: string[]) => Promise<Record<string, Record<string, unknown> | null>>
    getSize: () => Promise<number>
  }
  summary: {
    getByBook: (bookId: string) => Promise<BookSummary>
    create: (bookId: string, summary: string, keyPoints?: string) => Promise<BookSummary>
    delete: (bookId: string) => Promise<void>
  }
  stats: {
    getToday: () => Promise<DailyStats>
    getRange: (startDate: string, endDate: string) => Promise<DailyStats[]>
    getWeekly: (startDate: string) => Promise<DailyStats[]>
  }
  weread: {
    setApiKey: (apiKey: string) => Promise<void>
    getBookshelf: () => Promise<unknown>
    fetchBookmarks: (bookId: string) => Promise<unknown>
    fetchNotes: (bookId: string) => Promise<unknown>
    fetchAllContent: (bookId: string) => Promise<unknown>
    fetchRecommendations: () => Promise<RecommendationItem[]>
    getUserProfile: () => Promise<{ success: boolean; profile?: { nickname: string; avatarUrl: string; vid?: string }; message: string }>
    test: (apiKey: string) => Promise<{ success: boolean; message: string; firstBookTitle?: string }>
  }
  readingData: {
    fetch: (mode: string, baseTime?: number) => Promise<ReadingDataResponse>
    fetchWeekly: (baseTime?: number) => Promise<ReadingDataResponse>
    fetchMonthly: (baseTime?: number) => Promise<ReadingDataResponse>
    fetchAnnually: (baseTime?: number) => Promise<ReadingDataResponse>
    fetchOverall: () => Promise<ReadingDataResponse>
  }
  ai: {
    setConfig: (config: Record<string, unknown>) => Promise<void>
    generateCards: (highlights: Array<{ content: string; note?: string }>, bookTitle: string) => Promise<Card[]>
    generateSummary: (highlights: Array<{ content: string; chapterTitle?: string }>, bookTitle: string) => Promise<BookSummary>
    chat: (question: string, context: Array<{ content: string; bookTitle?: string }>) => Promise<string>
    explain: (content: string, bookTitle: string, chapterTitle?: string) => Promise<string>
    streamChat: (messages: Array<{ role: string; content: string }>, enableReasoning?: boolean) => Promise<void>
    streamChatWithContext: (params: {
      sessionId: string
      bookId?: string
      userMessage: string
      conversationHistory: Array<{ role: string; content: string }>
      enableReasoning?: boolean
    }) => Promise<void>
    cancelStream?: () => Promise<{ aborted: boolean }>
    test: (config: Record<string, unknown>) => Promise<{ success: boolean; message: string }>
    onStreamChunk?: (callback: (chunk: string) => void) => (() => void)
    onStreamReasoningChunk?: (callback: (chunk: string) => void) => (() => void)
    onStreamError?: (callback: (error: string) => void) => (() => void)
    onStreamComplete?: (callback: (usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }) => void) => (() => void)
  }
  conversation: {
    getAll: () => Promise<Conversation[]>
    create: (title?: string, bookId?: string) => Promise<Conversation>
    getMessages: (id: string) => Promise<ChatMessage[]>
    addMessage: (conversationId: string, message: { role: string; content: string; intent?: string }) => Promise<string>
    delete: (id: string) => Promise<void>
  }
  chat: {
    toggleLike: (messageId: string, liked: boolean) => Promise<void>
    toggleBookmark: (messageId: string, bookmarked: boolean) => Promise<void>
  }
  settings: {
    get: (key: string) => Promise<unknown>
    set: (key: string, value: unknown) => Promise<void>
    getAll: () => Promise<Record<string, unknown>>
  }
  tokenUsage: {
    getRecent: (limit?: number) => Promise<TokenRecord[]>
    getByDateRange: (startDate: string, endDate: string) => Promise<TokenRecord[]>
    getStatsByProvider: () => Promise<ProviderStats[]>
    getStatsByFeature: () => Promise<FeatureStats[]>
    getDailyStats: (days?: number) => Promise<DailyTokenStats[]>
    getTotalStats: () => Promise<TokenSummary>
    clearAll: () => Promise<{ success: boolean }>
  }
  methodology: {
    getAll: () => Promise<unknown[]>
    getById: (id: string) => Promise<unknown>
    getByBook: (bookId: string) => Promise<unknown[]>
    create: (methodology: Record<string, unknown>) => Promise<unknown>
    update: (id: string, methodology: Record<string, unknown>) => Promise<unknown>
    delete: (id: string) => Promise<void>
    search: (keyword: string) => Promise<unknown[]>
    extract: (bookId: string, bookTitle: string) => Promise<unknown[]>
  }
  knowledgeCard: {
    getAll: () => Promise<unknown[]>
    getById: (id: string) => Promise<unknown>
    getByBook: (bookId: string) => Promise<unknown[]>
    getByType: (type: string) => Promise<unknown[]>
    create: (card: Record<string, unknown>) => Promise<unknown>
    update: (id: string, card: Record<string, unknown>) => Promise<unknown>
    delete: (id: string) => Promise<void>
    search: (keyword: string) => Promise<unknown[]>
    distill: (bookId: string, bookTitle: string) => Promise<unknown[]>
    cancelDistill: (bookId: string) => Promise<{ success: boolean }>
    isDistilling: (bookId: string) => Promise<boolean>
    generateInterpretation: (bookTitle: string, cardTitle: string, cardContent: string, cardType: string) => Promise<{ text: string }>
    generateApplication: (bookTitle: string, cardTitle: string, cardContent: string, cardType: string) => Promise<{ text: string }>
    onDistillProgress?: (callback: (progress: { bookId: string; current: number; total: number; stage: string }) => void) => (() => void)
  }
  bookArchitecture: {
    getByBook: (bookId: string) => Promise<unknown>
    create: (data: Record<string, unknown>) => Promise<unknown>
    update: (id: string, data: Record<string, unknown>) => Promise<unknown>
    delete: (id: string) => Promise<void>
    analyze: (bookId: string, bookTitle: string) => Promise<unknown>
  }
  skill: {
    generate: (methodologyIds: string[]) => Promise<unknown>
    exportBatch: (methodologyIds: string[]) => Promise<unknown>
  }
  system: {
    openExternal: (url: string) => Promise<{ opened: boolean }>
    forceSaveDatabase: () => Promise<void>
    clearCache: () => Promise<void>
    clearHistory: () => Promise<{ success: boolean }>
    resetDatabase: () => Promise<{ success: boolean }>
  }
  fsrs: {
    setParameters: (params: Record<string, unknown>) => Promise<void>
    resetParameters: () => Promise<void>
    getParameters: () => Promise<Record<string, unknown>>
    getForecast: (cards: Array<Record<string, unknown>>, days?: number) => Promise<Record<string, number>>
    getOptimalReviewOrder: (cards: Array<Record<string, unknown>>, limit?: number) => Promise<Card[]>
    previewReviewRatings: (card: Record<string, unknown>) => Promise<Array<{
      rating: number
      due: string
      scheduledDays: number
      state: number
      stability: number
      intervalLabel: string
    }>>
  }
  admin: {
    getStats: () => Promise<{
      stats: {
        totalConversations: number
        totalMessages: number
        totalTokens: number
        totalBooks: number
        totalHighlights: number
        totalCards: number
      }
      tokenTrend: Array<{ date: string; inputTokens: number; outputTokens: number; totalTokens: number }>
      recentSessions: Array<{ id: string; title: string; created_at: string; message_count: number; book_title?: string }>
    }>
    getAgentConfig: () => Promise<{ systemPrompt: string | null; intentKeywords: Record<string, string[]> | null }>
    saveAgentConfig: (key: string, value: unknown) => Promise<unknown>
    resetAgentConfig: (key: string) => Promise<unknown>
    getBooksWithCounts: () => Promise<Array<Record<string, unknown>>>
    getHighlightsByBook: (bookId: string) => Promise<Array<Record<string, unknown>>>
    getCardsByBook: (bookId: string) => Promise<Array<Record<string, unknown>>>
    getSessions: () => Promise<Array<Record<string, unknown>>>
    getSessionMessages: (sessionId: string) => Promise<Array<Record<string, unknown>>>
    getPrompts: () => Promise<PromptWithOverride[]>
    getPrompt: (id: string) => Promise<PromptWithOverride | undefined>
    savePrompt: (id: string, template: string) => Promise<{ success: boolean; error?: string }>
    resetPrompt: (id: string) => Promise<{ success: boolean; error?: string }>
    resetAllPrompts: () => Promise<{ success: boolean; count: number }>
    exportPrompts: () => Promise<string>
    importPrompts: (json: string) => Promise<{ success: boolean; imported: number; error?: string }>
    getDatabaseSchema: () => Promise<Array<{ name: string; sql: string }>>
    getTableData: (tableName: string, limit?: number, offset?: number) => Promise<{
      columns: string[]
      rows: Record<string, unknown>[]
      total: number
    }>
    createCustomPrompt: (name: string, content: string) => Promise<CustomPrompt>
    updateCustomPrompt: (id: string, name: string, content: string) => Promise<{ success: boolean; error?: string }>
    deleteCustomPrompt: (id: string) => Promise<{ success: boolean; error?: string }>
    getCustomPrompts: () => Promise<CustomPrompt[]>
  }
}

export interface PromptVariable {
  name: string
  description: string
  sample: string
}

export interface PromptWithOverride {
  id: string
  category: 'agent' | 'intent' | 'ai'
  feature: string
  role: 'system' | 'user'
  title: string
  description: string
  defaultTemplate: string
  variables: PromptVariable[]
  exampleVars: Record<string, string>
  currentTemplate: string
  isCustom: boolean
}

export interface CustomPrompt {
  id: string
  name: string
  content: string
  category: 'custom'
  createdAt: string
  updatedAt: string
}

export interface ProviderStats {
  provider: string
  model: string
  total_tokens: number
  total_input_tokens: number
  total_output_tokens: number
  request_count: number
  /** 后端聚合：累计耗时（毫秒）；TokenUsage 页面暂时不展示，但保证类型可访问 */
  total_duration_ms: number
  /** 后端聚合：累计费用（USD），可选字段 — 仅启用价格表时存在 */
  total_cost?: number
}

export interface FeatureStats {
  feature: string
  total_tokens: number
  total_input_tokens: number
  total_output_tokens: number
  request_count: number
  /** 后端聚合：累计耗时（毫秒） */
  total_duration_ms: number
  /** 后端聚合：平均耗时（毫秒）；TokenUsage 页面第 707 行消费 */
  avg_duration_ms: number
}

export interface DailyTokenStats {
  date: string
  total_tokens: number
  total_input_tokens: number
  total_output_tokens: number
  request_count: number
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
