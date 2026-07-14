export const IPC_CHANNELS = {
  BOOK: {
    GET_ALL: 'book:getAll',
    GET_BY_ID: 'book:getById',
    CREATE: 'book:create',
    UPDATE: 'book:update',
    DELETE: 'book:delete',
    SEARCH: 'book:search',
    IMPORT: 'book:import',
    EXPORT: 'book:export',
  },
  HIGHLIGHT: {
    GET_ALL: 'highlight:getAll',
    GET_BY_BOOK: 'highlight:getByBook',
    CREATE: 'highlight:create',
    UPDATE: 'highlight:update',
    DELETE: 'highlight:delete',
  },
  CARD: {
    GET_ALL: 'card:getAll',
    GET_BY_BOOK: 'card:getByBook',
    GET_DUE: 'card:getDue',
    CREATE: 'card:create',
    UPDATE: 'card:update',
    DELETE: 'card:delete',
    REVIEW: 'card:review',
  },
  REVIEW: {
    GET_HISTORY: 'review:getHistory',
    GET_STATS: 'review:getStats',
  },
  SUMMARY: {
    GET_BY_BOOK: 'summary:getByBook',
    CREATE: 'summary:create',
    UPDATE: 'summary:update',
  },
  STATS: {
    GET_DAILY: 'stats:getDaily',
    GET_WEEKLY: 'stats:getWeekly',
    GET_MONTHLY: 'stats:getMonthly',
  },
  PREFERENCES: {
    GET: 'preferences:get',
    UPDATE: 'preferences:update',
  },
  DIALOG: {
    OPEN_FILE: 'dialog:openFile',
    SAVE_FILE: 'dialog:saveFile',
  },
  WINDOW: {
    MINIMIZE: 'window:minimize',
    MAXIMIZE: 'window:maximize',
    CLOSE: 'window:close',
  },
} as const

export const DEFAULT_PREFERENCES = {
  theme: 'system' as const,
  fontSize: 16,
  fontFamily: 'system-ui',
  lineHeight: 1.6,
  readingGoal: 30,
  language: 'zh-CN' as const,
}

export const REVIEW_QUALITY = {
  AGAIN: 0,
  HARD: 1,
  GOOD: 2,
  EASY: 3,
} as const

export const DIFFICULTY_LEVELS = {
  EASY: 'easy',
  MEDIUM: 'medium',
  HARD: 'hard',
} as const

export const HIGHLIGHT_COLORS = [
  '#FFEB3B',
  '#FF9800',
  '#F44336',
  '#4CAF50',
  '#2196F3',
  '#9C27B0',
] as const

export const APP_NAME = '知行读书'
export const APP_VERSION = '1.0.0'

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100,
} as const
