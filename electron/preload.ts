import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IPC_CHANNELS } from '../src/shared/ipc-channels';
import type { ArchiveResult, RestoreResult, UndoableDeleteKind } from '../src/shared/types';
import type { BackupExport, BackupImportResult } from '../src/shared/backup';
import type { ReviewSourceKind } from '../src/shared/review-sources';

interface IPCResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  const response = await ipcRenderer.invoke(channel, ...args) as IPCResponse<T>;
  if (!response.success) {
    throw new Error(response.error || 'IPC call failed');
  }
  return response.data as T;
}

// ===== 流式监听器管理 =====
// 使用 Map<callback, handler> 隔离每个订阅者的 handler，避免 A/B 两个消费者
// 共享单例时出现"dispose A 误删 B"的交叉污染。
// 重复用相同 callback 注册时，会先 removeListener 旧 handler 再覆盖（幂等）。
// ⚠️ 契约：调用方必须持有返回的清理函数，并在组件卸载 / effect cleanup 中调用；
// 每次 render 新建箭头函数且不注销 = 监听器泄漏（现存调用点均已配对，新代码必须遵守）。
interface StreamChunkPayload { chunk: string }
interface StreamCompletePayload { usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number } }
interface StreamErrorPayload { error: string }
interface DistillProgressPayload {
  bookId: string
  bookTitle: string
  stage: 'fetch' | 'batch' | 'parse' | 'save' | 'done' | 'error'
  current: number
  total: number
  message?: string
  error?: string
}
interface RetrievalSourcePayload {
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
type RetrievalStatusPayload =
  | { stage: 'start' }
  | {
      stage: 'done'
      sources: RetrievalSourcePayload[]
      intent: string
      ragSources: Array<{
        highlightId: string
        bookId: string
        bookTitle: string
        chapterTitle?: string
        content?: string
        relevanceScore: number
      }>
    }

type StreamChunkHandler = (event: IpcRendererEvent, data: StreamChunkPayload) => void
type StreamCompleteHandler = (event: IpcRendererEvent, data: StreamCompletePayload) => void
type StreamErrorHandler = (event: IpcRendererEvent, data: StreamErrorPayload) => void
type DistillProgressHandler = (event: IpcRendererEvent, data: DistillProgressPayload) => void
type RetrievalStatusHandler = (event: IpcRendererEvent, data: RetrievalStatusPayload) => void

interface UpdateStatusPayload {
  stage: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  version?: string
  releaseNotes?: string
  percent?: number
  transferredMb?: number
  totalMb?: number
  message?: string
}
type UpdateStatusHandler = (event: IpcRendererEvent, data: UpdateStatusPayload) => void

const streamChunkHandlers = new Map<(chunk: string) => void, StreamChunkHandler>()
const streamCompleteHandlers = new Map<(usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }) => void, StreamCompleteHandler>()
const streamErrorHandlers = new Map<(error: string) => void, StreamErrorHandler>()
const streamReasoningChunkHandlers = new Map<(chunk: string) => void, StreamChunkHandler>()
const distillProgressHandlers = new Map<(progress: DistillProgressPayload) => void, DistillProgressHandler>()
const retrievalStatusHandlers = new Map<(status: RetrievalStatusPayload) => void, RetrievalStatusHandler>()
const updateStatusHandlers = new Map<(status: UpdateStatusPayload) => void, UpdateStatusHandler>()

const electronAPI = {
  book: {
    getAll: () => invoke(IPC_CHANNELS.BOOKS.GET_ALL),
    getById: (id: string) => invoke(IPC_CHANNELS.BOOKS.GET_BY_ID, id),
    create: (book: Record<string, unknown>) => invoke(IPC_CHANNELS.BOOKS.CREATE, book),
    update: (id: string, book: Record<string, unknown>) => invoke(IPC_CHANNELS.BOOKS.UPDATE, id, book),
    delete: (id: string) => invoke(IPC_CHANNELS.BOOKS.DELETE, id),
    search: (keyword: string) => invoke(IPC_CHANNELS.BOOKS.SEARCH, keyword),
  },

  highlight: {
    getByBook: (bookId: string) => invoke(IPC_CHANNELS.HIGHLIGHTS.GET_BY_BOOK, bookId),
    getById: (id: string) => invoke(IPC_CHANNELS.HIGHLIGHTS.GET_BY_ID, id),
    create: (highlight: Record<string, unknown>) => invoke(IPC_CHANNELS.HIGHLIGHTS.CREATE, highlight),
    backfillChapterTitles: (bookId?: string) => invoke(IPC_CHANNELS.HIGHLIGHTS.BACKFILL_CHAPTER_TITLES, bookId),
    update: (id: string, highlight: Record<string, unknown>) => invoke(IPC_CHANNELS.HIGHLIGHTS.UPDATE, id, highlight),
    getAll: () => invoke(IPC_CHANNELS.HIGHLIGHTS.GET_ALL),
    export: () => invoke(IPC_CHANNELS.HIGHLIGHTS.EXPORT),
  },

  card: {
    getDue: (limit?: number) => invoke(IPC_CHANNELS.CARDS.GET_DUE, limit),
    getDueWithContent: (limit?: number) => invoke(IPC_CHANNELS.CARDS.GET_DUE_WITH_CONTENT, limit),
    getByBook: (bookId: string) => invoke(IPC_CHANNELS.CARDS.GET_BY_BOOK, bookId),
    getStats: () => invoke(IPC_CHANNELS.CARDS.GET_STATS),
    getQueueStats: () => invoke(IPC_CHANNELS.CARDS.GET_QUEUE_STATS),
    /** 把一张知识卡片/方法论放进复习队列（已在队列里的原样返回，不新建第二张） */
    enroll: (kind: ReviewSourceKind, id: string) =>
      invoke<{ created: boolean; actionable: number }>(IPC_CHANNELS.CARDS.ENROLL, kind, id),
    /** 移出队列：只撤掉复习卡，卡片/方法论本身留着 */
    unenroll: (kind: ReviewSourceKind, id: string) =>
      invoke<{ removed: boolean }>(IPC_CHANNELS.CARDS.UNENROLL, kind, id),
    /** 这一类来源里已经入队的 id，界面用它标「已在复习队列」 */
    enrolledSources: (kind: ReviewSourceKind) =>
      invoke<{ ids: string[] }>(IPC_CHANNELS.CARDS.ENROLLED_SOURCES, kind),
    review: (id: string, quality: number) => invoke(IPC_CHANNELS.REVIEWS.CREATE, id, quality),
  },

  review: {
    getRecent: (limit?: number) => invoke(IPC_CHANNELS.REVIEWS.GET_RECENT, limit),
  },

  article: {
    getAll: (limit?: number) => invoke(IPC_CHANNELS.ARTICLES.GET_ALL, limit),
    getById: (id: string) => invoke(IPC_CHANNELS.ARTICLES.GET_BY_ID, id),
    markAsRead: (id: string) => invoke(IPC_CHANNELS.ARTICLES.MARK_AS_READ, id),
    toggleFavorite: (id: string) => invoke(IPC_CHANNELS.ARTICLES.TOGGLE_FAVORITE, id),
    fetchRss: () => invoke(IPC_CHANNELS.ARTICLES.FETCH_RSS),
    translate: (id: string) => invoke(IPC_CHANNELS.ARTICLES.TRANSLATE, id),
  },

  vocabulary: {
    getAll: (limit?: number) => invoke(IPC_CHANNELS.VOCABULARY.GET_ALL, limit),
    getUnmastered: (limit?: number) => invoke(IPC_CHANNELS.VOCABULARY.GET_UNMASTERED, limit),
    getDueForReview: (limit?: number) => invoke(IPC_CHANNELS.VOCABULARY.GET_DUE_FOR_REVIEW, limit),
    createFromLookup: (word: string, source?: string) => invoke(IPC_CHANNELS.VOCABULARY.CREATE_FROM_LOOKUP, word, source),
    markAsMastered: (id: string) => invoke(IPC_CHANNELS.VOCABULARY.MARK_AS_MASTERED, id),
    /** 加入复习队列：只把词排到待复习，不会记一次复习成绩 */
    scheduleForReview: (id: string) => invoke(IPC_CHANNELS.VOCABULARY.SCHEDULE_FOR_REVIEW, id),
    updateReviewData: (id: string, reviewData: Record<string, unknown>) => invoke(IPC_CHANNELS.VOCABULARY.UPDATE_REVIEW_DATA, id, reviewData),
    getStats: () => invoke(IPC_CHANNELS.VOCABULARY.GET_STATS),
    search: (keyword: string) => invoke(IPC_CHANNELS.VOCABULARY.SEARCH, keyword),
    export: (format: 'csv' | 'anki', items: Array<{
      word: string;
      phonetic?: string;
      part_of_speech?: string;
      meaning_zh: string;
      example_en?: string;
      example_zh?: string;
    }>) => invoke(IPC_CHANNELS.VOCABULARY.EXPORT, format, items),
  },

  dictionary: {
    lookup: (word: string) => invoke(IPC_CHANNELS.DICTIONARY.LOOKUP, word),
    lookupBatch: (words: string[]) => invoke(IPC_CHANNELS.DICTIONARY.LOOKUP_BATCH, words),
  },

  summary: {
    getByBook: (bookId: string) => invoke(IPC_CHANNELS.SUMMARIES.GET_BY_BOOK, bookId),
    /** 层级摘要 L1：每章一条（含该章基于多少条划线） */
    chapters: (bookId: string) => invoke(IPC_CHANNELS.SUMMARIES.GET_CHAPTERS, bookId),
    /** 生成/增量补齐层级摘要，返回 {generated, skipped, failed, bookSummary} */
    generate: (bookId: string) => invoke(IPC_CHANNELS.SUMMARIES.GENERATE, bookId),
    /** 哪些书的章节摘要欠更新（纯本地，不花 AI 钱） */
    pending: () => invoke(IPC_CHANNELS.SUMMARIES.FRESHNESS),
  },

  stats: {
    getToday: () => invoke(IPC_CHANNELS.DAILY_STATS.GET_TODAY),
    getRange: (startDate: string, endDate: string) =>
      invoke(IPC_CHANNELS.DAILY_STATS.GET_RANGE, startDate, endDate),
  },

  weread: {
    getBookshelf: () => invoke(IPC_CHANNELS.WEREAD.GET_BOOKSHELF),
    fetchAllContent: (bookId: string) => invoke(IPC_CHANNELS.WEREAD.FETCH_ALL_CONTENT, bookId),
    fetchRecommendations: () => invoke(IPC_CHANNELS.WEREAD.FETCH_RECOMMENDATIONS),
    getUserProfile: () => invoke<{ success: boolean; profile?: { nickname: string; avatarUrl: string; vid?: string }; message: string }>(IPC_CHANNELS.WEREAD.GET_USER_PROFILE),
    getBookProgress: (bookId: string) => invoke<number>(IPC_CHANNELS.WEREAD.GET_BOOK_PROGRESS, bookId),
    test: (apiKey: string) => invoke<{ success: boolean; message: string; firstBookTitle?: string }>(IPC_CHANNELS.WEREAD.TEST, apiKey),
  },

  readingData: {
    fetch: (mode: string, baseTime?: number) => invoke(IPC_CHANNELS.READING_DATA.FETCH, mode, baseTime),
  },

  agent: {
    getPipelineInfo: () => invoke(IPC_CHANNELS.AGENT.GET_PIPELINE_INFO) as Promise<{
      intentKeywords: Record<string, string[]>
      strategyMap: Record<string, { teachingMode: string; bloomLevel: number }>
    }>,
  },

  ai: {
    setConfig: (config: Record<string, unknown>) => invoke(IPC_CHANNELS.AI.SET_CONFIG, config),
    test: (config: Record<string, unknown>) => invoke(IPC_CHANNELS.AI.TEST, config),
    streamChatWithContext: (params: {
      sessionId: string
      bookId?: string
      methodologyId?: string
      userMessage: string
      conversationHistory: Array<{ role: string; content: string }>
      enableReasoning?: boolean
    }) => {
      return invoke(IPC_CHANNELS.AGENT.STREAM_CHAT_WITH_CONTEXT, params)
    },
    cancelStream: () => invoke(IPC_CHANNELS.AGENT.CANCEL_STREAM) as Promise<{ aborted: boolean }>,
    onStreamChunk: (callback: (chunk: string) => void) => {
      const existing = streamChunkHandlers.get(callback)
      if (existing) {
        ipcRenderer.removeListener(IPC_CHANNELS.STREAM.CHUNK, existing)
      }
      const handler: StreamChunkHandler = (_event, data) => {
        callback(data.chunk)
      }
      streamChunkHandlers.set(callback, handler)
      ipcRenderer.on(IPC_CHANNELS.STREAM.CHUNK, handler)
      return () => {
        const h = streamChunkHandlers.get(callback)
        if (h) {
          ipcRenderer.removeListener(IPC_CHANNELS.STREAM.CHUNK, h)
          streamChunkHandlers.delete(callback)
        }
      }
    },
    onStreamReasoningChunk: (callback: (chunk: string) => void) => {
      const existing = streamReasoningChunkHandlers.get(callback)
      if (existing) {
        ipcRenderer.removeListener(IPC_CHANNELS.STREAM.REASONING_CHUNK, existing)
      }
      const handler: StreamChunkHandler = (_event, data) => callback(data.chunk)
      streamReasoningChunkHandlers.set(callback, handler)
      ipcRenderer.on(IPC_CHANNELS.STREAM.REASONING_CHUNK, handler)
      return () => {
        const h = streamReasoningChunkHandlers.get(callback)
        if (h) {
          ipcRenderer.removeListener(IPC_CHANNELS.STREAM.REASONING_CHUNK, h)
          streamReasoningChunkHandlers.delete(callback)
        }
      }
    },
    onStreamComplete: (callback: (usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }) => void) => {
      const existing = streamCompleteHandlers.get(callback)
      if (existing) {
        ipcRenderer.removeListener(IPC_CHANNELS.STREAM.COMPLETE, existing)
      }
      const handler: StreamCompleteHandler = (_event, data) => {
        callback(data.usage)
      }
      streamCompleteHandlers.set(callback, handler)
      ipcRenderer.on(IPC_CHANNELS.STREAM.COMPLETE, handler)
      return () => {
        const h = streamCompleteHandlers.get(callback)
        if (h) {
          ipcRenderer.removeListener(IPC_CHANNELS.STREAM.COMPLETE, h)
          streamCompleteHandlers.delete(callback)
        }
      }
    },
    onStreamError: (callback: (error: string) => void) => {
      const existing = streamErrorHandlers.get(callback)
      if (existing) {
        ipcRenderer.removeListener(IPC_CHANNELS.STREAM.ERROR, existing)
      }
      const handler: StreamErrorHandler = (_event, data) => {
        callback(data.error)
      }
      streamErrorHandlers.set(callback, handler)
      ipcRenderer.on(IPC_CHANNELS.STREAM.ERROR, handler)
      return () => {
        const h = streamErrorHandlers.get(callback)
        if (h) {
          ipcRenderer.removeListener(IPC_CHANNELS.STREAM.ERROR, h)
          streamErrorHandlers.delete(callback)
        }
      }
    },
    // Agent 调取知识库过程事件（start 开始 / done 各路检索结果），供对话页可视化
    onRetrievalStatus: (callback: (status: RetrievalStatusPayload) => void) => {
      const existing = retrievalStatusHandlers.get(callback)
      if (existing) {
        ipcRenderer.removeListener(IPC_CHANNELS.AGENT.RETRIEVAL_STATUS, existing)
      }
      const handler: RetrievalStatusHandler = (_event, data) => callback(data)
      retrievalStatusHandlers.set(callback, handler)
      ipcRenderer.on(IPC_CHANNELS.AGENT.RETRIEVAL_STATUS, handler)
      return () => {
        const h = retrievalStatusHandlers.get(callback)
        if (h) {
          ipcRenderer.removeListener(IPC_CHANNELS.AGENT.RETRIEVAL_STATUS, h)
          retrievalStatusHandlers.delete(callback)
        }
      }
    },
  },

  conversation: {
    create: (title?: string, bookId?: string) => invoke(IPC_CHANNELS.CONVERSATIONS.CREATE, title, bookId),
    getAll: () => invoke(IPC_CHANNELS.CONVERSATIONS.GET_ALL),
    delete: (id: string) => invoke(IPC_CHANNELS.CONVERSATIONS.DELETE, id),
    addMessage: (conversationId: string, message: Record<string, unknown>) => invoke(IPC_CHANNELS.CONVERSATIONS.ADD_MESSAGE, conversationId, message),
    deleteMessage: (messageId: string) => invoke(IPC_CHANNELS.CONVERSATIONS.DELETE_MESSAGE, messageId),
    getMessages: (conversationId: string) => invoke(IPC_CHANNELS.CONVERSATIONS.GET_MESSAGES, conversationId),
    getBookmarked: (limit?: number) => invoke(IPC_CHANNELS.CONVERSATIONS.GET_BOOKMARKED, limit),
  },

  // 聊天消息点赞 / 收藏（仅 assistant 消息）
  chat: {
    toggleLike: (messageId: string, liked: boolean) => invoke(IPC_CHANNELS.CHAT.TOGGLE_LIKE, messageId, liked),
    toggleBookmark: (messageId: string, bookmarked: boolean) => invoke(IPC_CHANNELS.CHAT.TOGGLE_BOOKMARK, messageId, bookmarked),
  },

  settings: {
    get: (key: string) => invoke(IPC_CHANNELS.SETTINGS.GET, key),
    set: (key: string, value: unknown) => invoke(IPC_CHANNELS.SETTINGS.SET, key, value),
    getAll: () => invoke(IPC_CHANNELS.SETTINGS.GET_ALL),
  },

  tokenUsage: {
    getByDateRange: (startDate: string, endDate: string) => invoke(IPC_CHANNELS.TOKEN_USAGE.GET_BY_DATE_RANGE, startDate, endDate),
    getStatsByProvider: () => invoke(IPC_CHANNELS.TOKEN_USAGE.GET_STATS_BY_PROVIDER),
    getStatsByFeature: () => invoke(IPC_CHANNELS.TOKEN_USAGE.GET_STATS_BY_FEATURE),
    getDailyStats: (days?: number) => invoke(IPC_CHANNELS.TOKEN_USAGE.GET_DAILY_STATS, days),
    getTotalStats: () => invoke(IPC_CHANNELS.TOKEN_USAGE.GET_TOTAL_STATS),
    clearAll: () => invoke(IPC_CHANNELS.TOKEN_USAGE.CLEAR_ALL),
  },

  methodology: {
    getAll: () => invoke(IPC_CHANNELS.METHODOLOGIES.GET_ALL),
    getById: (id: string) => invoke(IPC_CHANNELS.METHODOLOGIES.GET_BY_ID, id),
    // replace=true 时主进程会先清空这本书的旧方法论（对应界面上的「重新提取」）
    extract: (bookId: string, bookTitle: string, replace?: boolean) =>
      invoke(IPC_CHANNELS.METHODOLOGIES.EXTRACT, bookId, bookTitle, replace),
    // 每本书的生成进度（已处理 / 共多少条划线），列表页一次取全
    coverage: () => invoke(IPC_CHANNELS.METHODOLOGIES.COVERAGE),
  },

  knowledgeCard: {
    getAll: () => invoke(IPC_CHANNELS.KNOWLEDGE_CARDS.GET_ALL),
    update: (id: string, card: Record<string, unknown>) => invoke(IPC_CHANNELS.KNOWLEDGE_CARDS.UPDATE, id, card),
    backfillSource: () => invoke(IPC_CHANNELS.KNOWLEDGE_CARDS.BACKFILL_SOURCE),
    // replace=true 时主进程会先清空这本书的旧卡片（对应界面上的「重新蒸馏」）
    distill: (bookId: string, bookTitle: string, replace?: boolean) =>
      invoke(IPC_CHANNELS.KNOWLEDGE_CARDS.DISTILL, bookId, bookTitle, replace),
    // 每本书的蒸馏进度（已处理 / 共多少条划线），蒸馏中心一次取全
    coverage: () => invoke(IPC_CHANNELS.KNOWLEDGE_CARDS.COVERAGE),
    cancelDistill: (bookId: string) => invoke(IPC_CHANNELS.KNOWLEDGE_CARDS.CANCEL_DISTILL, bookId),
    generateInterpretation: (bookTitle: string, cardTitle: string, cardContent: string, cardType: string) =>
      invoke(IPC_CHANNELS.KNOWLEDGE_CARDS.GENERATE_INTERPRETATION, bookTitle, cardTitle, cardContent, cardType),
    generateApplication: (bookTitle: string, cardTitle: string, cardContent: string, cardType: string) =>
      invoke(IPC_CHANNELS.KNOWLEDGE_CARDS.GENERATE_APPLICATION, bookTitle, cardTitle, cardContent, cardType),
    onDistillProgress: (callback: (progress: {
      bookId: string
      bookTitle: string
      stage: 'fetch' | 'batch' | 'parse' | 'save' | 'done' | 'error'
      current: number
      total: number
      message?: string
      error?: string
    }) => void) => {
      const existing = distillProgressHandlers.get(callback)
      if (existing) {
        ipcRenderer.removeListener(IPC_CHANNELS.KNOWLEDGE_CARDS.DISTILL_PROGRESS, existing)
      }
      const handler: DistillProgressHandler = (_event, data) => callback(data)
      distillProgressHandlers.set(callback, handler)
      ipcRenderer.on(IPC_CHANNELS.KNOWLEDGE_CARDS.DISTILL_PROGRESS, handler)
      return () => {
        const h = distillProgressHandlers.get(callback)
        if (h) {
          ipcRenderer.removeListener(IPC_CHANNELS.KNOWLEDGE_CARDS.DISTILL_PROGRESS, h)
          distillProgressHandlers.delete(callback)
        }
      }
    },
  },

  skill: {
    exportFile: (methodologyId: string, bookTitle: string) =>
      invoke(IPC_CHANNELS.SKILL.EXPORT_FILE, methodologyId, bookTitle),
  },

  system: {
    openExternal: (url: string) => invoke(IPC_CHANNELS.SYSTEM.OPEN_EXTERNAL, url),
    forceSaveDatabase: () => invoke(IPC_CHANNELS.SYSTEM.FORCE_SAVE_DATABASE),
    clearCache: () => invoke(IPC_CHANNELS.SYSTEM.CLEAR_CACHE),
    /** 真实存储用量（字节）；量不出来的项为 null */
    getStorageUsage: () => invoke(IPC_CHANNELS.SYSTEM.GET_STORAGE_USAGE),
    clearHistory: () => invoke(IPC_CHANNELS.SYSTEM.CLEAR_HISTORY),
    resetDatabase: () => invoke(IPC_CHANNELS.SYSTEM.RESET_DATABASE),
    /** 留现场再删：null = 那行本来不在（什么都没删，也就没有撤销） */
    archiveDelete: (kind: UndoableDeleteKind, id: string) =>
      invoke<ArchiveResult | null>(IPC_CHANNELS.SYSTEM.ARCHIVE_DELETE, kind, id),
    /** 按 token 把上一次删除的行原样插回去；ok=false 表示现场已失效 */
    restoreDelete: (token: string) =>
      invoke<RestoreResult>(IPC_CHANNELS.SYSTEM.RESTORE_DELETE, token),
    /** 备份：主进程按唯一那份表清单取全（渲染层只管把 payload 落成文件） */
    exportBackup: () => invoke<BackupExport>(IPC_CHANNELS.SYSTEM.EXPORT_BACKUP),
    /** 恢复：清空后按同一份清单换回，整批一个事务；失败则什么都没改 */
    importBackup: (payload: unknown) =>
      invoke<BackupImportResult>(IPC_CHANNELS.SYSTEM.IMPORT_BACKUP, payload),
  },

  update: {
    check: () => invoke(IPC_CHANNELS.UPDATE.CHECK),
    download: () => invoke(IPC_CHANNELS.UPDATE.DOWNLOAD),
    install: () => invoke(IPC_CHANNELS.UPDATE.INSTALL),
    getStatus: () => invoke(IPC_CHANNELS.UPDATE.GET_STATUS),
  },

  fsrs: {
    setParameters: (params: Record<string, unknown>) => invoke(IPC_CHANNELS.FSRS.SET_PARAMETERS, params),
    resetParameters: () => invoke(IPC_CHANNELS.FSRS.RESET_PARAMETERS),
    getParameters: () => invoke(IPC_CHANNELS.FSRS.GET_PARAMETERS),
    previewReviewRatings: (card: Record<string, unknown>) =>
      invoke(IPC_CHANNELS.FSRS.PREVIEW_REVIEW_RATINGS, card),
  },

  admin: {
    getStats: () => invoke(IPC_CHANNELS.ADMIN.GET_STATS),
    getAgentConfig: () => invoke(IPC_CHANNELS.ADMIN.GET_AGENT_CONFIG),
    getBooksWithCounts: () => invoke(IPC_CHANNELS.ADMIN.GET_BOOKS_WITH_COUNTS),
    getHighlightsByBook: (bookId: string) => invoke(IPC_CHANNELS.ADMIN.GET_HIGHLIGHTS_BY_BOOK, bookId),
    getCardsByBook: (bookId: string) => invoke(IPC_CHANNELS.ADMIN.GET_CARDS_BY_BOOK, bookId),
    getSessions: () => invoke(IPC_CHANNELS.ADMIN.GET_SESSIONS),
    getSessionMessages: (sessionId: string) => invoke(IPC_CHANNELS.ADMIN.GET_SESSION_MESSAGES, sessionId),
    getPrompts: () => invoke(IPC_CHANNELS.ADMIN.GET_PROMPTS),
    savePrompt: (id: string, template: string) => invoke(IPC_CHANNELS.ADMIN.SAVE_PROMPT, id, template),
    resetPrompt: (id: string) => invoke(IPC_CHANNELS.ADMIN.RESET_PROMPT, id),
    resetAllPrompts: () => invoke(IPC_CHANNELS.ADMIN.RESET_ALL_PROMPTS),
    exportPrompts: () => invoke(IPC_CHANNELS.ADMIN.EXPORT_PROMPTS),
    importPrompts: (json: string) => invoke(IPC_CHANNELS.ADMIN.IMPORT_PROMPTS, json),
    getDatabaseSchema: () => invoke(IPC_CHANNELS.ADMIN.GET_DATABASE_SCHEMA),
    getTableData: (tableName: string, limit?: number, offset?: number) =>
      invoke(IPC_CHANNELS.ADMIN.GET_TABLE_DATA, tableName, limit, offset),
    createCustomPrompt: (name: string, content: string) =>
      invoke(IPC_CHANNELS.ADMIN.CREATE_CUSTOM_PROMPT, name, content),
    updateCustomPrompt: (id: string, name: string, content: string) =>
      invoke(IPC_CHANNELS.ADMIN.UPDATE_CUSTOM_PROMPT, id, name, content),
    deleteCustomPrompt: (id: string) =>
      invoke(IPC_CHANNELS.ADMIN.DELETE_CUSTOM_PROMPT, id),
    getCustomPrompts: () => invoke(IPC_CHANNELS.ADMIN.GET_CUSTOM_PROMPTS),
  },

  // 主进程菜单导航事件（视图菜单 CmdOrCtrl+1/2/3 等触发，renderer 端跳转路由）
  onNavigate: (callback: (path: string) => void) => {
    const handler = (_event: IpcRendererEvent, path: string) => callback(path)
    ipcRenderer.on(IPC_CHANNELS.MENU.NAVIGATE, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.MENU.NAVIGATE, handler)
    }
  },

  // 文件菜单「同步书架」事件（CmdOrCtrl+S 触发，renderer 端执行真实同步）
  onSyncBookshelf: (callback: () => void) => {
    const handler = () => callback()
    ipcRenderer.on(IPC_CHANNELS.MENU.SYNC_BOOKSHELF, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.MENU.SYNC_BOOKSHELF, handler)
    }
  },

  // 微信读书后台自动同步结果事件（成功/失败），返回清理函数
  onWereadAutoSyncStatus: (callback: (status: {
    ok: boolean
    at: number
    error?: string
    total?: number
    newCount?: number
    updatedCount?: number
  }) => void) => {
    const handler = (_event: IpcRendererEvent, status: Parameters<typeof callback>[0]) => callback(status)
    ipcRenderer.on(IPC_CHANNELS.WEREAD.AUTO_SYNC_STATUS, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.WEREAD.AUTO_SYNC_STATUS, handler)
    }
  },

  // 数据库落盘失败事件（磁盘满/权限/被占用），返回清理函数
  onPersistError: (callback: (info: {
    message: string
    willRetry: boolean
    retryInMs: number
  }) => void) => {
    const handler = (_event: IpcRendererEvent, info: Parameters<typeof callback>[0]) => callback(info)
    ipcRenderer.on(IPC_CHANNELS.SYSTEM.PERSIST_ERROR, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.SYSTEM.PERSIST_ERROR, handler)
    }
  },

  // 自动更新状态事件（checking/available/downloading/downloaded/error 等），返回清理函数
  onUpdateStatus: (callback: (status: UpdateStatusPayload) => void) => {
    const handler: UpdateStatusHandler = (_event, status) => callback(status)
    // 幂等：同 callback 重复注册先清旧 handler
    const prev = updateStatusHandlers.get(callback)
    if (prev) ipcRenderer.removeListener(IPC_CHANNELS.UPDATE.STATUS, prev)
    updateStatusHandlers.set(callback, handler)
    ipcRenderer.on(IPC_CHANNELS.UPDATE.STATUS, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.UPDATE.STATUS, handler)
      updateStatusHandlers.delete(callback)
    }
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ZhixingAPI = typeof electronAPI;
