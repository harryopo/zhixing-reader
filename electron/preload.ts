import { contextBridge, ipcRenderer, IpcRendererEvent } from 'electron';
import { IPC_CHANNELS } from '../src/shared/ipc-channels';

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

type StreamChunkHandler = (event: IpcRendererEvent, data: StreamChunkPayload) => void
type StreamCompleteHandler = (event: IpcRendererEvent, data: StreamCompletePayload) => void
type StreamErrorHandler = (event: IpcRendererEvent, data: StreamErrorPayload) => void
type DistillProgressHandler = (event: IpcRendererEvent, data: DistillProgressPayload) => void

const streamChunkHandlers = new Map<(chunk: string) => void, StreamChunkHandler>()
const streamCompleteHandlers = new Map<(usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }) => void, StreamCompleteHandler>()
const streamErrorHandlers = new Map<(error: string) => void, StreamErrorHandler>()
const streamReasoningChunkHandlers = new Map<(chunk: string) => void, StreamChunkHandler>()
const distillProgressHandlers = new Map<(progress: DistillProgressPayload) => void, DistillProgressHandler>()

const electronAPI = {
  book: {
    getAll: () => invoke(IPC_CHANNELS.BOOKS.GET_ALL),
    getById: (id: string) => invoke(IPC_CHANNELS.BOOKS.GET_BY_ID, id),
    create: (book: Record<string, unknown>) => invoke(IPC_CHANNELS.BOOKS.CREATE, book),
    update: (id: string, book: Record<string, unknown>) => invoke(IPC_CHANNELS.BOOKS.UPDATE, id, book),
    delete: (id: string) => invoke(IPC_CHANNELS.BOOKS.DELETE, id),
    updateProgress: (id: string, progress: number) => invoke(IPC_CHANNELS.BOOKS.UPDATE_PROGRESS, id, progress),
    search: (keyword: string) => invoke(IPC_CHANNELS.BOOKS.SEARCH, keyword),
  },

  highlight: {
    getByBook: (bookId: string) => invoke(IPC_CHANNELS.HIGHLIGHTS.GET_BY_BOOK, bookId),
    getById: (id: string) => invoke(IPC_CHANNELS.HIGHLIGHTS.GET_BY_ID, id),
    create: (highlight: Record<string, unknown>) => invoke(IPC_CHANNELS.HIGHLIGHTS.CREATE, highlight),
    update: (id: string, highlight: Record<string, unknown>) => invoke(IPC_CHANNELS.HIGHLIGHTS.UPDATE, id, highlight),
    delete: (id: string) => invoke(IPC_CHANNELS.HIGHLIGHTS.DELETE, id),
    getAll: () => invoke(IPC_CHANNELS.HIGHLIGHTS.GET_ALL),
    search: (keyword: string) => invoke(IPC_CHANNELS.HIGHLIGHTS.SEARCH, keyword),
  },

  card: {
    getByHighlight: (highlightId: string) => invoke(IPC_CHANNELS.CARDS.GET_BY_HIGHLIGHT, highlightId),
    getById: (id: string) => invoke(IPC_CHANNELS.CARDS.GET_BY_ID, id),
    create: (highlightId: string) => invoke(IPC_CHANNELS.CARDS.CREATE, highlightId),
    createBatch: (highlightIds: string[]) => invoke(IPC_CHANNELS.CARDS.CREATE_BATCH, highlightIds),
    createForExisting: () => invoke(IPC_CHANNELS.CARDS.CREATE_FOR_EXISTING),
    update: (card: Record<string, unknown>) => invoke(IPC_CHANNELS.CARDS.UPDATE, card),
    updateApplicationTag: (id: string, tag: string) => invoke(IPC_CHANNELS.CARDS.UPDATE_APPLICATION_TAG, id, tag),
    updateMasteryLevel: (id: string, level: number) => invoke(IPC_CHANNELS.CARDS.UPDATE_MASTERY_LEVEL, id, level),
    delete: (id: string) => invoke(IPC_CHANNELS.CARDS.DELETE, id),
    getDue: (limit?: number) => invoke(IPC_CHANNELS.CARDS.GET_DUE, limit),
    getByBook: (bookId: string) => invoke(IPC_CHANNELS.CARDS.GET_BY_BOOK, bookId),
    getStats: () => invoke(IPC_CHANNELS.CARDS.GET_STATS),
    review: (id: string, quality: number) => invoke(IPC_CHANNELS.REVIEWS.CREATE, id, quality),
  },

  review: {
    getHistory: (cardId: string) => invoke(IPC_CHANNELS.REVIEWS.GET_BY_CARD, cardId),
    getRecent: (limit?: number) => invoke(IPC_CHANNELS.REVIEWS.GET_RECENT, limit),
  },

  article: {
    getAll: (limit?: number) => invoke(IPC_CHANNELS.ARTICLES.GET_ALL, limit),
    getById: (id: string) => invoke(IPC_CHANNELS.ARTICLES.GET_BY_ID, id),
    getUnread: (limit?: number) => invoke(IPC_CHANNELS.ARTICLES.GET_UNREAD, limit),
    getFavorites: (limit?: number) => invoke(IPC_CHANNELS.ARTICLES.GET_FAVORITES, limit),
    create: (article: Record<string, unknown>) => invoke(IPC_CHANNELS.ARTICLES.CREATE, article),
    markAsRead: (id: string) => invoke(IPC_CHANNELS.ARTICLES.MARK_AS_READ, id),
    toggleFavorite: (id: string) => invoke(IPC_CHANNELS.ARTICLES.TOGGLE_FAVORITE, id),
    delete: (id: string) => invoke(IPC_CHANNELS.ARTICLES.DELETE, id),
    getStats: () => invoke(IPC_CHANNELS.ARTICLES.GET_STATS),
    fetchRss: () => invoke(IPC_CHANNELS.ARTICLES.FETCH_RSS),
    translate: (id: string) => invoke(IPC_CHANNELS.ARTICLES.TRANSLATE, id),
  },

  vocabulary: {
    getAll: (limit?: number) => invoke(IPC_CHANNELS.VOCABULARY.GET_ALL, limit),
    getById: (id: string) => invoke(IPC_CHANNELS.VOCABULARY.GET_BY_ID, id),
    getByWord: (word: string) => invoke(IPC_CHANNELS.VOCABULARY.GET_BY_WORD, word),
    getUnmastered: (limit?: number) => invoke(IPC_CHANNELS.VOCABULARY.GET_UNMASTERED, limit),
    getDueForReview: (limit?: number) => invoke(IPC_CHANNELS.VOCABULARY.GET_DUE_FOR_REVIEW, limit),
    create: (vocab: Record<string, unknown>) => invoke(IPC_CHANNELS.VOCABULARY.CREATE, vocab),
    createFromLookup: (word: string, source?: string) => invoke(IPC_CHANNELS.VOCABULARY.CREATE_FROM_LOOKUP, word, source),
    markAsMastered: (id: string) => invoke(IPC_CHANNELS.VOCABULARY.MARK_AS_MASTERED, id),
    incrementReview: (id: string) => invoke(IPC_CHANNELS.VOCABULARY.INCREMENT_REVIEW, id),
    updateReviewData: (id: string, reviewData: Record<string, unknown>) => invoke(IPC_CHANNELS.VOCABULARY.UPDATE_REVIEW_DATA, id, reviewData),
    delete: (id: string) => invoke(IPC_CHANNELS.VOCABULARY.DELETE, id),
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
    getSize: () => invoke(IPC_CHANNELS.DICTIONARY.GET_SIZE),
  },

  summary: {
    getByBook: (bookId: string) => invoke(IPC_CHANNELS.SUMMARIES.GET_BY_BOOK, bookId),
    create: (bookId: string, summary: string, keyPoints?: string) =>
      invoke(IPC_CHANNELS.SUMMARIES.CREATE, bookId, summary, keyPoints),
    delete: (bookId: string) => invoke(IPC_CHANNELS.SUMMARIES.DELETE, bookId),
  },

  stats: {
    getToday: () => invoke(IPC_CHANNELS.DAILY_STATS.GET_TODAY),
    getRange: (startDate: string, endDate: string) =>
      invoke(IPC_CHANNELS.DAILY_STATS.GET_RANGE, startDate, endDate),
    getWeekly: (startDate: string) => invoke(IPC_CHANNELS.DAILY_STATS.GET_RANGE, startDate, new Date().toISOString().split('T')[0]),
  },

  weread: {
    setApiKey: (apiKey: string) => invoke(IPC_CHANNELS.WEREAD.SET_API_KEY, apiKey),
    getBookshelf: () => invoke(IPC_CHANNELS.WEREAD.GET_BOOKSHELF),
    fetchBookmarks: (bookId: string) => invoke(IPC_CHANNELS.WEREAD.FETCH_BOOKMARKS, bookId),
    fetchNotes: (bookId: string) => invoke(IPC_CHANNELS.WEREAD.FETCH_NOTES, bookId),
    fetchAllContent: (bookId: string) => invoke(IPC_CHANNELS.WEREAD.FETCH_ALL_CONTENT, bookId),
    fetchRecommendations: () => invoke(IPC_CHANNELS.WEREAD.FETCH_RECOMMENDATIONS),
    test: (apiKey: string) => invoke<{ success: boolean; message: string; firstBookTitle?: string }>(IPC_CHANNELS.WEREAD.TEST, apiKey),
  },

  readingData: {
    fetch: (mode: string, baseTime?: number) => invoke(IPC_CHANNELS.READING_DATA.FETCH, mode, baseTime),
    fetchWeekly: (baseTime?: number) => invoke(IPC_CHANNELS.READING_DATA.FETCH_WEEKLY, baseTime),
    fetchMonthly: (baseTime?: number) => invoke(IPC_CHANNELS.READING_DATA.FETCH_MONTHLY, baseTime),
    fetchAnnually: (baseTime?: number) => invoke(IPC_CHANNELS.READING_DATA.FETCH_ANNUALLY, baseTime),
    fetchOverall: () => invoke(IPC_CHANNELS.READING_DATA.FETCH_OVERALL),
  },

  ai: {
    setConfig: (config: Record<string, unknown>) => invoke(IPC_CHANNELS.AI.SET_CONFIG, config),
    generateCards: (highlights: Array<{ content: string; note?: string }>, bookTitle: string) =>
      invoke(IPC_CHANNELS.AI.GENERATE_CARDS, highlights, bookTitle),
    generateSummary: (highlights: Array<{ content: string; chapterTitle?: string }>, bookTitle: string) =>
      invoke(IPC_CHANNELS.AI.GENERATE_SUMMARY, highlights, bookTitle),
    chat: (question: string, context: Array<{ content: string; bookTitle?: string }>) =>
      invoke(IPC_CHANNELS.AI.CHAT, question, context),
    explain: (content: string, bookTitle: string, chapterTitle?: string) =>
      invoke(IPC_CHANNELS.AI.EXPLAIN, content, bookTitle, chapterTitle),
    test: (config: Record<string, unknown>) => invoke(IPC_CHANNELS.AI.TEST, config),
    streamChat: (messages: Array<{role: string; content: string}>, enableReasoning?: boolean) => {
      return invoke(IPC_CHANNELS.AGENT.STREAM_CHAT, { messages, enableReasoning });
    },
    streamChatWithContext: (params: {
      sessionId: string
      bookId?: string
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
      const handler: StreamChunkHandler = (_event, data) => callback(data.chunk)
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
      const handler: StreamCompleteHandler = (_event, data) => callback(data.usage)
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
      const handler: StreamErrorHandler = (_event, data) => callback(data.error)
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
  },

  conversation: {
    create: (title?: string, bookId?: string) => invoke(IPC_CHANNELS.CONVERSATIONS.CREATE, title, bookId),
    getAll: () => invoke(IPC_CHANNELS.CONVERSATIONS.GET_ALL),
    getById: (id: string) => invoke(IPC_CHANNELS.CONVERSATIONS.GET_BY_ID, id),
    update: (id: string, data: Record<string, unknown>) => invoke(IPC_CHANNELS.CONVERSATIONS.UPDATE, id, data),
    delete: (id: string) => invoke(IPC_CHANNELS.CONVERSATIONS.DELETE, id),
    addMessage: (conversationId: string, message: Record<string, unknown>) => invoke(IPC_CHANNELS.CONVERSATIONS.ADD_MESSAGE, conversationId, message),
    getMessages: (conversationId: string) => invoke(IPC_CHANNELS.CONVERSATIONS.GET_MESSAGES, conversationId),
    search: (keyword: string) => invoke(IPC_CHANNELS.CONVERSATIONS.SEARCH, keyword),
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
    getRecent: (limit?: number) => invoke(IPC_CHANNELS.TOKEN_USAGE.GET_RECENT, limit),
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
    getByBook: (bookId: string) => invoke(IPC_CHANNELS.METHODOLOGIES.GET_BY_BOOK, bookId),
    create: (methodology: Record<string, unknown>) => invoke(IPC_CHANNELS.METHODOLOGIES.CREATE, methodology),
    update: (id: string, methodology: Record<string, unknown>) => invoke(IPC_CHANNELS.METHODOLOGIES.UPDATE, id, methodology),
    delete: (id: string) => invoke(IPC_CHANNELS.METHODOLOGIES.DELETE, id),
    search: (keyword: string) => invoke(IPC_CHANNELS.METHODOLOGIES.SEARCH, keyword),
    extract: (bookId: string, bookTitle: string) => invoke(IPC_CHANNELS.METHODOLOGIES.EXTRACT, bookId, bookTitle),
  },

  knowledgeCard: {
    getAll: () => invoke(IPC_CHANNELS.KNOWLEDGE_CARDS.GET_ALL),
    getById: (id: string) => invoke(IPC_CHANNELS.KNOWLEDGE_CARDS.GET_BY_ID, id),
    getByBook: (bookId: string) => invoke(IPC_CHANNELS.KNOWLEDGE_CARDS.GET_BY_BOOK, bookId),
    getByType: (type: string) => invoke(IPC_CHANNELS.KNOWLEDGE_CARDS.GET_BY_TYPE, type),
    create: (card: Record<string, unknown>) => invoke(IPC_CHANNELS.KNOWLEDGE_CARDS.CREATE, card),
    update: (id: string, card: Record<string, unknown>) => invoke(IPC_CHANNELS.KNOWLEDGE_CARDS.UPDATE, id, card),
    delete: (id: string) => invoke(IPC_CHANNELS.KNOWLEDGE_CARDS.DELETE, id),
    search: (keyword: string) => invoke(IPC_CHANNELS.KNOWLEDGE_CARDS.SEARCH, keyword),
    distill: (bookId: string, bookTitle: string) => invoke(IPC_CHANNELS.KNOWLEDGE_CARDS.DISTILL, bookId, bookTitle),
    cancelDistill: (bookId: string) => invoke(IPC_CHANNELS.KNOWLEDGE_CARDS.CANCEL_DISTILL, bookId),
    isDistilling: (bookId: string) => invoke(IPC_CHANNELS.KNOWLEDGE_CARDS.IS_DISTILLING, bookId),
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

  bookArchitecture: {
    getByBook: (bookId: string) => invoke(IPC_CHANNELS.BOOK_ARCHITECTURE.GET_BY_BOOK, bookId),
    create: (data: Record<string, unknown>) => invoke(IPC_CHANNELS.BOOK_ARCHITECTURE.CREATE, data),
    update: (id: string, data: Record<string, unknown>) => invoke(IPC_CHANNELS.BOOK_ARCHITECTURE.UPDATE, id, data),
    delete: (id: string) => invoke(IPC_CHANNELS.BOOK_ARCHITECTURE.DELETE, id),
    analyze: (bookId: string, bookTitle: string) => invoke(IPC_CHANNELS.BOOK_ARCHITECTURE.ANALYZE, bookId, bookTitle),
  },

  skill: {
    generate: (methodologyIds: string[]) => invoke(IPC_CHANNELS.SKILL.GENERATE, methodologyIds),
    exportBatch: (methodologyIds: string[]) => invoke(IPC_CHANNELS.SKILL.EXPORT_BATCH, methodologyIds),
  },

  system: {
    openExternal: (url: string) => invoke(IPC_CHANNELS.SYSTEM.OPEN_EXTERNAL, url),
    forceSaveDatabase: () => invoke(IPC_CHANNELS.SYSTEM.FORCE_SAVE_DATABASE),
    clearCache: () => invoke(IPC_CHANNELS.SYSTEM.CLEAR_CACHE),
    clearHistory: () => invoke(IPC_CHANNELS.SYSTEM.CLEAR_HISTORY),
    resetDatabase: () => invoke(IPC_CHANNELS.SYSTEM.RESET_DATABASE),
  },

  fsrs: {
    setParameters: (params: Record<string, unknown>) => invoke(IPC_CHANNELS.FSRS.SET_PARAMETERS, params),
    resetParameters: () => invoke(IPC_CHANNELS.FSRS.RESET_PARAMETERS),
    getParameters: () => invoke(IPC_CHANNELS.FSRS.GET_PARAMETERS),
    getForecast: (cards: Array<Record<string, unknown>>, days?: number) =>
      invoke(IPC_CHANNELS.FSRS.GET_FORECAST, cards, days),
    getOptimalReviewOrder: (cards: Array<Record<string, unknown>>, limit?: number) =>
      invoke(IPC_CHANNELS.FSRS.GET_OPTIMAL_REVIEW_ORDER, cards, limit),
    previewReviewRatings: (card: Record<string, unknown>) =>
      invoke(IPC_CHANNELS.FSRS.PREVIEW_REVIEW_RATINGS, card),
  },

  admin: {
    getStats: () => invoke(IPC_CHANNELS.ADMIN.GET_STATS),
    getAgentConfig: () => invoke(IPC_CHANNELS.ADMIN.GET_AGENT_CONFIG),
    saveAgentConfig: (key: string, value: unknown) => invoke(IPC_CHANNELS.ADMIN.SAVE_AGENT_CONFIG, key, value),
    resetAgentConfig: (key: string) => invoke(IPC_CHANNELS.ADMIN.RESET_AGENT_CONFIG, key),
    getBooksWithCounts: () => invoke(IPC_CHANNELS.ADMIN.GET_BOOKS_WITH_COUNTS),
    getHighlightsByBook: (bookId: string) => invoke(IPC_CHANNELS.ADMIN.GET_HIGHLIGHTS_BY_BOOK, bookId),
    getCardsByBook: (bookId: string) => invoke(IPC_CHANNELS.ADMIN.GET_CARDS_BY_BOOK, bookId),
    getSessions: () => invoke(IPC_CHANNELS.ADMIN.GET_SESSIONS),
    getSessionMessages: (sessionId: string) => invoke(IPC_CHANNELS.ADMIN.GET_SESSION_MESSAGES, sessionId),
    getPrompts: () => invoke(IPC_CHANNELS.ADMIN.GET_PROMPTS),
    getPrompt: (id: string) => invoke(IPC_CHANNELS.ADMIN.GET_PROMPT, id),
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
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ZhixingAPI = typeof electronAPI;
