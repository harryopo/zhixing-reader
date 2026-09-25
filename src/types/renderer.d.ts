import { Book, Highlight, Card, ReviewRow, BookSummary, ChapterSummary, BookSummaryRunResult, PendingSummaryEntry, DailyStatsRow, ReviewStats, ReadingDataResponse, RecommendationItem, BookmarkedMessageRow, ArchiveResult, RestoreResult, UndoableDeleteKind } from '../shared/types'
import type { ChatMessageRow, ConversationRow } from '../renderer/src/utils/db-mapper'
import type { DueReviewCardView, ReviewCardFields, ReviewSourceKind } from '../shared/review-sources'
import type { BookCoverageView, CoveragePlan } from '../shared/ai-coverage'
import type { BackupExport, BackupImportResult } from '../shared/backup'

export interface TokenSummary {
  totalRequests: number
  totalInputTokens: number
  totalOutputTokens: number
  totalTokens: number
  /** 前缀缓存命中的输入 tokens（按缓存折扣价计费），用于命中率观测 */
  totalCachedTokens: number
}

/**
 * 到期复习卡片：FSRS 状态 + 正/背面文案。
 * 形状与主进程 `cardsDb.getDueCardsWithContent()` 的返回同源（都在 shared 里那一份），
 * 这里只起个界面上顺手的名字 —— 以前在两边各写一份字段清单，改一处就静默错位一次。
 */
export type DueReviewCard = DueReviewCardView

/**
 * card.review() 的返回值。
 *
 * ⚠️ 2026-09-15 修正：这里原先声明为 `Promise<Review>`（一条 reviews 记录），
 * 但主进程 `reviewsDb.create()` 实际返回 `{ reviewId, card }`，
 * 其中 card 是 FSRS 调度后的新卡片状态。因调用方一直丢弃返回值所以从未暴露。
 */
export interface ReviewedCard {
  id: string
  highlightId: string
  state: number
  step: number
  stability: number
  difficulty: number
  due: string
  lastReview: string | null
  elapsedDays: number
  scheduledDays: number
  reps: number
  lapses: number
}

export interface ReviewResult {
  reviewId: string
  card: ReviewedCard
}

export interface TokenRecord {
  id: string
  provider: string
  model: string
  feature: string
  input_tokens: number
  output_tokens: number
  total_tokens: number
  cached_tokens: number
  cost_usd: number
  duration_ms: number
  created_at: string
}

/** Agent 单路知识库检索结果（对话页「调取知识库」可视化） */
export interface RetrievalSourceView {
  name: string
  label: string
  source: string
  used: boolean
  itemCount: number
  method?: string
  topScore?: number
  buildTime: number
  previews?: Array<{ title?: string; snippet?: string; score?: number }>
  error?: string
}

/** Agent 检索状态事件：start 开始调取 / done 各路结果（含意图与真实引用片段） */
export type RetrievalStatusView =
  | { stage: 'start' }
  | {
      stage: 'done'
      sources: RetrievalSourceView[]
      intent: string
      /** 本轮命中的真实原文片段，用于消息气泡的「引用来源」 */
      ragSources: RagSourceRef[]
    }

/** 自动更新状态机（主进程推送） */
export interface UpdateStatusView {
  stage: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  releaseNotes?: string
  percent?: number
  transferredMb?: number
  totalMb?: number
  message?: string
}

export interface UpdateActionResult {
  /** false = 开发环境（未打包），自动更新不可用 */
  supported: boolean
  updateAvailable?: boolean
  version?: string
  error?: string
}

export interface ElectronAPI {
  /**
   * 书 / 划线 / 方法论 / 知识卡片的读取通道交回的是**数据库那一行**（列名是下划线），
   * 不是 `Book` / `Highlight` 这些驼峰领域类型 —— 那些是 `utils/db-mapper.ts` 映射**之后**
   * 的形状。写在这里就是为了让人在页面上直接读 `row.readingProgress` 时编译不过，
   * 而不是等到界面上摆出一个恒为 0 的数字才发现。
   */
  book: {
    getAll: () => Promise<Array<Record<string, unknown>>>
    getById: (id: string) => Promise<Record<string, unknown> | undefined>
    create: (book: Record<string, unknown>) => Promise<void>
    update: (id: string, book: Record<string, unknown>) => Promise<void>
    delete: (id: string) => Promise<void>
    search: (keyword: string) => Promise<Array<Record<string, unknown>>>
  }
  highlight: {
    getByBook: (bookId: string) => Promise<Array<Record<string, unknown>>>
    /** 一次性补全历史划线的章节名；不传 bookId 则处理所有缺章节名的书 */
    backfillChapterTitles: (bookId?: string) => Promise<{
      books: number
      scanned: number
      updated: number
      failedBooks: number
    }>
    getById: (id: string) => Promise<Record<string, unknown> | undefined>
    /** 主进程建好划线并顺带建它的复习卡片，返回的是"有没有落库" */
    create: (highlight: Record<string, unknown>) => Promise<boolean>
    update: (id: string, highlight: Record<string, unknown>) => Promise<void>
    getAll: () => Promise<Array<Record<string, unknown>>>
    search: (keyword: string) => Promise<Array<Record<string, unknown>>>
    export: () => Promise<{ saved: boolean; count: number; path?: string }>
  }
  card: {
    getById: (id: string) => Promise<Card>
    create: (highlightId: string) => Promise<Card>
    createForExisting: () => Promise<{ created: number; skipped: number }>
    update: (card: Record<string, unknown>) => Promise<Card>
    getDue: (limit?: number) => Promise<Card[]>
    getDueWithContent: (limit?: number) => Promise<DueReviewCard[]>
    getByBook: (bookId: string) => Promise<Card[]>
    getStats: () => Promise<ReviewStats>
    /** 今日队列构成：复习卡数量、新卡额度与新卡池余量 */
    getQueueStats: () => Promise<{
      reviewDue: number
      newAvailable: number
      newIntroducedToday: number
      newPerDay: number
      newAllowance: number
      actionable: number
    }>
    review: (id: string, quality: number) => Promise<ReviewResult>
    /** 放进复习队列（单条与批量同一条通道）；已在队列里的不新建第二张，actionable 是新的队列量 */
    enroll: (
      kind: ReviewSourceKind,
      ids: string[],
    ) => Promise<{ created: number; skipped: number; actionable: number }>
    /** 移出队列：只撤掉复习卡，卡片 / 方法论本身留着 */
    unenroll: (kind: ReviewSourceKind, id: string) => Promise<{ removed: boolean }>
    /** 这一类来源里已经入队的 id，界面用它标「已在复习队列」 */
    enrolledSources: (kind: ReviewSourceKind) => Promise<{ ids: string[] }>
  }
  review: {
    /** reviews 表的那一行；列名钉在 shared/types.ts 的 ReviewRow，导出列清单与它同源 */
    getRecent: (limit?: number) => Promise<ReviewRow[]>
  }
  agent: {
    getPipelineInfo: () => Promise<{
      intentKeywords: Record<string, string[]>
      strategyMap: Record<string, { teachingMode: string; bloomLevel: number }>
    }>
  }
  article: {
    getAll: (limit?: number) => Promise<Record<string, unknown>[]>
    getById: (id: string) => Promise<Record<string, unknown> | undefined>
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
    getUnmastered: (limit?: number) => Promise<Record<string, unknown>[]>
    getDueForReview: (limit?: number) => Promise<Record<string, unknown>[]>
    create: (vocab: Record<string, unknown>) => Promise<Record<string, unknown> | null>
    createFromLookup: (word: string, source?: string) => Promise<Record<string, unknown> | null>
    markAsMastered: (id: string) => Promise<void>
    /** 加入复习队列：只排队，不提交评分 */
    scheduleForReview: (id: string) => Promise<void>
    updateReviewData: (id: string, reviewData: Record<string, unknown>) => Promise<Record<string, unknown> | null>
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
  }
  summary: {
    getByBook: (bookId: string) => Promise<BookSummary | null>
    create: (bookId: string, summary: string, keyPoints?: string) => Promise<void>
    delete: (bookId: string) => Promise<void>
    /** 层级摘要 L1：每章一条，sourceCount = 该摘要基于多少条划线 */
    chapters: (bookId: string) => Promise<ChapterSummary[]>
    /** 生成/增量补齐 L1+L2；一次调用会打若干次 AI，界面必须防连点 */
    generate: (bookId: string) => Promise<BookSummaryRunResult>
    /** 哪些书的章节摘要欠更新（纯本地计算，不触发 AI） */
    pending: () => Promise<PendingSummaryEntry[]>
  }
  stats: {
    getToday: () => Promise<DailyStatsRow>
    getRange: (startDate: string, endDate: string) => Promise<DailyStatsRow[]>
  }
  weread: {
    getBookshelf: () => Promise<unknown>
    fetchAllContent: (bookId: string) => Promise<unknown>
    fetchRecommendations: () => Promise<RecommendationItem[]>
    getUserProfile: () => Promise<{ success: boolean; profile?: { nickname: string; avatarUrl: string; vid?: string }; message: string }>
    getBookProgress: (bookId: string) => Promise<number>
    test: (apiKey: string) => Promise<{ success: boolean; message: string; firstBookTitle?: string }>
  }
  readingData: {
    fetch: (mode: string, baseTime?: number) => Promise<ReadingDataResponse>
  }
  ai: {
    setConfig: (config: Record<string, unknown>) => Promise<void>
    streamChatWithContext: (params: {
      sessionId: string
      bookId?: string
      methodologyId?: string
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
    onRetrievalStatus?: (callback: (status: RetrievalStatusView) => void) => (() => void)
  }
  conversation: {
    /** 交出去的是**库里的原始行**（`SELECT *`，下划线列名）；界面统一过 mapConversations / mapChatMessages */
    getAll: () => Promise<ConversationRow[]>
    create: (title?: string, bookId?: string) => Promise<ConversationRow>
    getById: (id: string) => Promise<ConversationRow | null>
    update: (id: string, data: Record<string, unknown>) => Promise<void>
    getMessages: (id: string) => Promise<ChatMessageRow[]>
    addMessage: (
      conversationId: string,
      message: {
        role: string
        content: string
        intent?: string
        /** 引用来源：能定位回具体划线的原文片段 */
        sources?: RagSourceRef[]
      },
    ) => Promise<string>
    deleteMessage: (messageId: string) => Promise<void>
    delete: (id: string) => Promise<void>
    search: (keyword: string) => Promise<ConversationRow[]>
    /** 跨会话的收藏列表（最新在前）；行形状见 BookmarkedMessageRow 的注释 */
    getBookmarked: (limit?: number) => Promise<BookmarkedMessageRow[]>
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
    getAll: () => Promise<Array<Record<string, unknown>>>
    getById: (id: string) => Promise<Record<string, unknown> | undefined>
    getByBook: (bookId: string) => Promise<Array<Record<string, unknown>>>
    create: (methodology: Record<string, unknown>) => Promise<{ id: string }>
    update: (id: string, methodology: Record<string, unknown>) => Promise<void>
    search: (keyword: string) => Promise<Array<Record<string, unknown>>>
    /** replace=true 表示"重新提取"：主进程会先清空这本书的旧方法论（替换而不是追加） */
    extract: (bookId: string, bookTitle: string, replace?: boolean) => Promise<{ methodologies: unknown[]; coverage: CoveragePlan; nothingNew: boolean }>
    /** 每本书的生成进度（分母 = 划线条数，分子 = 批次台账已处理数） */
    coverage: () => Promise<Array<{ bookId: string } & BookCoverageView>>
  }
  knowledgeCard: {
    getAll: () => Promise<Array<Record<string, unknown>>>
    getById: (id: string) => Promise<Record<string, unknown> | undefined>
    getByBook: (bookId: string) => Promise<Array<Record<string, unknown>>>
    create: (card: Record<string, unknown>) => Promise<{ id: string }>
    update: (id: string, card: Record<string, unknown>) => Promise<void>
    search: (keyword: string) => Promise<Array<Record<string, unknown>>>
    /** 一次性找回历史卡片的来源划线；只按「内容精确相等」匹配，绝不猜测 */
    backfillSource: () => Promise<{ updated: number }>
    /** replace=true 表示"重新蒸馏"：主进程会先清空这本书的旧卡片（替换而不是追加） */
    distill: (bookId: string, bookTitle: string, replace?: boolean) => Promise<{ cards: unknown[]; coverage: CoveragePlan; nothingNew: boolean }>
    /** 每本书的蒸馏进度（分母 = 划线条数，分子 = 批次台账已处理数） */
    coverage: () => Promise<Array<{ bookId: string } & BookCoverageView>>
    cancelDistill: (bookId: string) => Promise<{ success: boolean }>
    generateInterpretation: (bookTitle: string, cardTitle: string, cardContent: string, cardType: string) => Promise<{ text: string }>
    generateApplication: (bookTitle: string, cardTitle: string, cardContent: string, cardType: string) => Promise<{ text: string }>
    onDistillProgress?: (callback: (progress: { bookId: string; current: number; total: number; stage: string }) => void) => (() => void)
  }
  skill: {
    generate: (methodologyId: string, bookTitle: string, author?: string) => Promise<unknown>
    exportFile: (methodologyId: string, bookTitle: string) => Promise<{ saved: boolean; path?: string }>
  }
  system: {
    openExternal: (url: string) => Promise<{ opened: boolean }>
    forceSaveDatabase: () => Promise<void>
    clearCache: () => Promise<void>
    /** 真实存储用量（字节）；量不出来的项为 null */
    getStorageUsage: () => Promise<{
      dbBytes: number | null
      vectorBytes: number | null
      logBytes: number | null
    }>
    clearHistory: () => Promise<{ success: boolean }>
    resetDatabase: () => Promise<{ success: boolean }>
    /** 留现场再删；null = 那一行本来就不在，什么都没删 */
    archiveDelete: (kind: UndoableDeleteKind, id: string) => Promise<ArchiveResult | null>
    /** 按 token 撤销一次删除；ok=false 表示现场已失效（撤销过一次 / 应用重启过） */
    restoreDelete: (token: string) => Promise<RestoreResult>
    /** 备份：表清单在主进程一处，渲染层只把 payload 落成文件 */
    exportBackup: () => Promise<BackupExport>
    /** 恢复：整批一个事务，失败则库里什么都没动 */
    importBackup: (payload: unknown) => Promise<BackupImportResult>
  }
  update: {
    /** 手动检查更新；supported=false 表示开发环境不可用 */
    check: () => Promise<UpdateActionResult>
    /** 下载已发现的更新 */
    download: () => Promise<UpdateActionResult>
    /** 退出并安装已下载的更新 */
    install: () => Promise<UpdateActionResult>
    /** 回读最后一次更新状态（STATUS 是单向推送，挂载晚于启动检查时用它补一次） */
    getStatus: () => Promise<{ supported: boolean; status: UpdateStatusView | null }>
  }
  fsrs: {
    setParameters: (params: Record<string, unknown>) => Promise<void>
    resetParameters: () => Promise<void>
    getParameters: () => Promise<Record<string, unknown>>
    /** 把队列里那张卡原样送回主进程预览四种评分的间隔（不落库）；形状见 shared/review-sources */
    previewReviewRatings: (card: ReviewCardFields) => Promise<Array<{
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
    getBooksWithCounts: () => Promise<Array<Record<string, unknown>>>
    getHighlightsByBook: (bookId: string) => Promise<Array<Record<string, unknown>>>
    getCardsByBook: (bookId: string) => Promise<Array<Record<string, unknown>>>
    getSessions: () => Promise<Array<Record<string, unknown>>>
    getSessionMessages: (sessionId: string) => Promise<Array<Record<string, unknown>>>
    getPrompts: () => Promise<PromptWithOverride[]>
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
  /** 主进程菜单导航事件（视图菜单 CmdOrCtrl+1/2/3），返回清理函数 */
  onNavigate: (callback: (path: string) => void) => () => void
  /** 文件菜单「同步书架」事件（CmdOrCtrl+S），返回清理函数 */
  onSyncBookshelf?: (callback: () => void) => () => void
  /** 微信读书后台自动同步结果事件，返回清理函数 */
  onWereadAutoSyncStatus?: (callback: (status: {
    ok: boolean
    at: number
    error?: string
    total?: number
    newCount?: number
    updatedCount?: number
  }) => void) => () => void
  /** 数据库落盘失败事件（磁盘满/权限/被占用），返回清理函数 */
  onPersistError?: (callback: (info: {
    message: string
    willRetry: boolean
    retryInMs: number
  }) => void) => () => void
  /** 自动更新状态事件，返回清理函数 */
  onUpdateStatus?: (callback: (status: UpdateStatusView) => void) => () => void
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
