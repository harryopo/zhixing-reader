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

// ===== 流式监听器单例管理 =====
// 避免每次 onStreamChunk/Complete/Error 被调用时累积新监听器
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

let streamChunkHandler: ((event: IpcRendererEvent, data: StreamChunkPayload) => void) | null = null;
let streamCompleteHandler: ((event: IpcRendererEvent, data: StreamCompletePayload) => void) | null = null;
let streamErrorHandler: ((event: IpcRendererEvent, data: StreamErrorPayload) => void) | null = null;
let distillProgressHandler: ((event: IpcRendererEvent, data: DistillProgressPayload) => void) | null = null;

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
    test: (apiKey: string) => invoke(IPC_CHANNELS.WEREAD.TEST, apiKey),
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
    streamChat: (messages: Array<{role: string; content: string}>) => {
      return invoke(IPC_CHANNELS.AGENT.STREAM_CHAT, { messages });
    },
    streamChatWithContext: (params: {
      sessionId: string
      bookId?: string
      userMessage: string
      conversationHistory: Array<{ role: string; content: string }>
    }) => {
      return invoke(IPC_CHANNELS.AGENT.STREAM_CHAT_WITH_CONTEXT, params)
    },
    onStreamChunk: (callback: (chunk: string) => void) => {
      if (streamChunkHandler) {
        ipcRenderer.removeListener(IPC_CHANNELS.STREAM.CHUNK, streamChunkHandler);
      }
      streamChunkHandler = (_event, data) => callback(data.chunk);
      ipcRenderer.on(IPC_CHANNELS.STREAM.CHUNK, streamChunkHandler);
      return () => {
        if (streamChunkHandler) {
          ipcRenderer.removeListener(IPC_CHANNELS.STREAM.CHUNK, streamChunkHandler);
          streamChunkHandler = null;
        }
      };
    },
    onStreamComplete: (callback: (usage?: { promptTokens?: number; completionTokens?: number; totalTokens?: number }) => void) => {
      if (streamCompleteHandler) {
        ipcRenderer.removeListener(IPC_CHANNELS.STREAM.COMPLETE, streamCompleteHandler);
      }
      streamCompleteHandler = (_event, data) => callback(data.usage);
      ipcRenderer.on(IPC_CHANNELS.STREAM.COMPLETE, streamCompleteHandler);
      return () => {
        if (streamCompleteHandler) {
          ipcRenderer.removeListener(IPC_CHANNELS.STREAM.COMPLETE, streamCompleteHandler);
          streamCompleteHandler = null;
        }
      };
    },
    onStreamError: (callback: (error: string) => void) => {
      if (streamErrorHandler) {
        ipcRenderer.removeListener(IPC_CHANNELS.STREAM.ERROR, streamErrorHandler);
      }
      streamErrorHandler = (_event, data) => callback(data.error);
      ipcRenderer.on(IPC_CHANNELS.STREAM.ERROR, streamErrorHandler);
      return () => {
        if (streamErrorHandler) {
          ipcRenderer.removeListener(IPC_CHANNELS.STREAM.ERROR, streamErrorHandler);
          streamErrorHandler = null;
        }
      };
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
      if (distillProgressHandler) {
        ipcRenderer.removeListener(IPC_CHANNELS.KNOWLEDGE_CARDS.DISTILL_PROGRESS, distillProgressHandler);
      }
      distillProgressHandler = (_event, data) => callback(data);
      ipcRenderer.on(IPC_CHANNELS.KNOWLEDGE_CARDS.DISTILL_PROGRESS, distillProgressHandler);
      return () => {
        if (distillProgressHandler) {
          ipcRenderer.removeListener(IPC_CHANNELS.KNOWLEDGE_CARDS.DISTILL_PROGRESS, distillProgressHandler);
          distillProgressHandler = null;
        }
      };
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
  },
};

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

export type ZhixingAPI = typeof electronAPI;
