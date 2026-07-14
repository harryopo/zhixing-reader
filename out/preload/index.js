"use strict";
const electron = require("electron");
require("better-sqlite3");
const path = require("path");
const fs = require("fs");
const Store = require("electron-store");
function _interopNamespaceDefault(e) {
  const n = Object.create(null, { [Symbol.toStringTag]: { value: "Module" } });
  if (e) {
    for (const k in e) {
      if (k !== "default") {
        const d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: () => e[k]
        });
      }
    }
  }
  n.default = e;
  return Object.freeze(n);
}
const path__namespace = /* @__PURE__ */ _interopNamespaceDefault(path);
const fs__namespace = /* @__PURE__ */ _interopNamespaceDefault(fs);
class Logger {
  logPath;
  logLevel = 1;
  stream = null;
  constructor() {
    const logDir = path__namespace.join(electron.app.getPath("userData"), "logs");
    if (!fs__namespace.existsSync(logDir)) {
      fs__namespace.mkdirSync(logDir, { recursive: true });
    }
    const date = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    this.logPath = path__namespace.join(logDir, `${date}.log`);
    this.initStream();
  }
  initStream() {
    this.stream = fs__namespace.createWriteStream(this.logPath, { flags: "a" });
  }
  setLevel(level) {
    this.logLevel = level;
  }
  formatEntry(level, message, data) {
    return {
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      level,
      message,
      data
    };
  }
  write(level, levelName, message, data) {
    if (level < this.logLevel) return;
    const entry = this.formatEntry(levelName, message, data);
    const line = data ? `[${entry.timestamp}] [${entry.level}] ${entry.message} ${JSON.stringify(data)}
` : `[${entry.timestamp}] [${entry.level}] ${entry.message}
`;
    if (this.stream && !this.stream.destroyed) {
      this.stream.write(line);
    }
    const consoleMethod = level === 3 ? "error" : level === 2 ? "warn" : "log";
    console[consoleMethod](line.trim());
  }
  debug(message, data) {
    this.write(0, "DEBUG", message, data);
  }
  info(message, data) {
    this.write(1, "INFO", message, data);
  }
  warn(message, data) {
    this.write(2, "WARN", message, data);
  }
  error(message, data) {
    this.write(3, "ERROR", message, data);
  }
  close() {
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }
  }
}
new Logger();
new Store();
const IPC_CHANNELS = {
  BOOKS: {
    GET_ALL: "books:getAll",
    GET_BY_ID: "books:getById",
    CREATE: "books:create",
    UPDATE: "books:update",
    DELETE: "books:delete",
    UPDATE_PROGRESS: "books:updateProgress",
    SEARCH: "books:search"
  },
  HIGHLIGHTS: {
    GET_BY_BOOK: "highlights:getByBook",
    GET_BY_ID: "highlights:getById",
    CREATE: "highlights:create",
    UPDATE: "highlights:update",
    DELETE: "highlights:delete",
    GET_ALL: "highlights:getAll",
    SEARCH: "highlights:search"
  },
  CARDS: {
    GET_BY_HIGHLIGHT: "cards:getByHighlight",
    GET_BY_ID: "cards:getById",
    CREATE: "cards:create",
    UPDATE: "cards:update",
    DELETE: "cards:delete",
    GET_DUE: "cards:getDue",
    GET_BY_BOOK: "cards:getByBook",
    GET_STATS: "cards:getStats"
  },
  REVIEWS: {
    CREATE: "reviews:create",
    GET_BY_CARD: "reviews:getByCard",
    GET_RECENT: "reviews:getRecent"
  },
  SUMMARIES: {
    GET_BY_BOOK: "summaries:getByBook",
    CREATE: "summaries:create",
    DELETE: "summaries:delete"
  },
  DAILY_STATS: {
    GET_TODAY: "dailyStats:getToday",
    GET_RANGE: "dailyStats:getRange",
    INCREMENT_BOOKS: "dailyStats:incrementBooks",
    INCREMENT_HIGHLIGHTS: "dailyStats:incrementHighlights",
    INCREMENT_CARDS: "dailyStats:incrementCards",
    ADD_READING_TIME: "dailyStats:addReadingTime"
  },
  WEREAD: {
    SET_COOKIES: "weread:setCookies",
    GET_BOOKSHELF: "weread:getBookshelf",
    FETCH_BOOKMARKS: "weread:fetchBookmarks",
    FETCH_NOTES: "weread:fetchNotes",
    FETCH_ALL_CONTENT: "weread:fetchAllContent"
  },
  AI: {
    SET_CONFIG: "ai:setConfig",
    GENERATE_CARDS: "ai:generateCards",
    GENERATE_SUMMARY: "ai:generateSummary",
    CHAT: "ai:chat",
    EXPLAIN: "ai:explain"
  },
  SETTINGS: {
    GET: "settings:get",
    SET: "settings:set",
    GET_ALL: "settings:getAll"
  }
};
async function invoke(channel, ...args) {
  const response = await electron.ipcRenderer.invoke(channel, ...args);
  if (!response.success) {
    throw new Error(response.error || "IPC call failed");
  }
  return response.data;
}
const api = {
  books: {
    getAll: () => invoke(IPC_CHANNELS.BOOKS.GET_ALL),
    getById: (id) => invoke(IPC_CHANNELS.BOOKS.GET_BY_ID, id),
    create: (book) => invoke(IPC_CHANNELS.BOOKS.CREATE, book),
    update: (id, book) => invoke(IPC_CHANNELS.BOOKS.UPDATE, id, book),
    delete: (id) => invoke(IPC_CHANNELS.BOOKS.DELETE, id),
    updateProgress: (id, progress) => invoke(IPC_CHANNELS.BOOKS.UPDATE_PROGRESS, id, progress),
    search: (keyword) => invoke(IPC_CHANNELS.BOOKS.SEARCH, keyword)
  },
  highlights: {
    getByBook: (bookId) => invoke(IPC_CHANNELS.HIGHLIGHTS.GET_BY_BOOK, bookId),
    getById: (id) => invoke(IPC_CHANNELS.HIGHLIGHTS.GET_BY_ID, id),
    create: (highlight) => invoke(IPC_CHANNELS.HIGHLIGHTS.CREATE, highlight),
    update: (id, highlight) => invoke(IPC_CHANNELS.HIGHLIGHTS.UPDATE, id, highlight),
    delete: (id) => invoke(IPC_CHANNELS.HIGHLIGHTS.DELETE, id),
    getAll: () => invoke(IPC_CHANNELS.HIGHLIGHTS.GET_ALL),
    search: (keyword) => invoke(IPC_CHANNELS.HIGHLIGHTS.SEARCH, keyword)
  },
  cards: {
    getByHighlight: (highlightId) => invoke(IPC_CHANNELS.CARDS.GET_BY_HIGHLIGHT, highlightId),
    getById: (id) => invoke(IPC_CHANNELS.CARDS.GET_BY_ID, id),
    create: (highlightId) => invoke(IPC_CHANNELS.CARDS.CREATE, highlightId),
    update: (card) => invoke(IPC_CHANNELS.CARDS.UPDATE, card),
    delete: (id) => invoke(IPC_CHANNELS.CARDS.DELETE, id),
    getDue: (limit) => invoke(IPC_CHANNELS.CARDS.GET_DUE, limit),
    getByBook: (bookId) => invoke(IPC_CHANNELS.CARDS.GET_BY_BOOK, bookId),
    getStats: () => invoke(IPC_CHANNELS.CARDS.GET_STATS)
  },
  reviews: {
    create: (cardId, rating) => invoke(IPC_CHANNELS.REVIEWS.CREATE, cardId, rating),
    getByCard: (cardId) => invoke(IPC_CHANNELS.REVIEWS.GET_BY_CARD, cardId),
    getRecent: (limit) => invoke(IPC_CHANNELS.REVIEWS.GET_RECENT, limit)
  },
  summaries: {
    getByBook: (bookId) => invoke(IPC_CHANNELS.SUMMARIES.GET_BY_BOOK, bookId),
    create: (bookId, summary, keyPoints) => invoke(IPC_CHANNELS.SUMMARIES.CREATE, bookId, summary, keyPoints),
    delete: (bookId) => invoke(IPC_CHANNELS.SUMMARIES.DELETE, bookId)
  },
  dailyStats: {
    getToday: () => invoke(IPC_CHANNELS.DAILY_STATS.GET_TODAY),
    getRange: (startDate, endDate) => invoke(IPC_CHANNELS.DAILY_STATS.GET_RANGE, startDate, endDate),
    incrementBooks: () => invoke(IPC_CHANNELS.DAILY_STATS.INCREMENT_BOOKS),
    incrementHighlights: (count) => invoke(IPC_CHANNELS.DAILY_STATS.INCREMENT_HIGHLIGHTS, count),
    incrementCards: (count) => invoke(IPC_CHANNELS.DAILY_STATS.INCREMENT_CARDS, count),
    addReadingTime: (seconds) => invoke(IPC_CHANNELS.DAILY_STATS.ADD_READING_TIME, seconds)
  },
  weread: {
    setCookies: (cookies) => invoke(IPC_CHANNELS.WEREAD.SET_COOKIES, cookies),
    getBookshelf: () => invoke(IPC_CHANNELS.WEREAD.GET_BOOKSHELF),
    fetchBookmarks: (bookId) => invoke(IPC_CHANNELS.WEREAD.FETCH_BOOKMARKS, bookId),
    fetchNotes: (bookId) => invoke(IPC_CHANNELS.WEREAD.FETCH_NOTES, bookId),
    fetchAllContent: (bookId) => invoke(IPC_CHANNELS.WEREAD.FETCH_ALL_CONTENT, bookId)
  },
  ai: {
    setConfig: (config) => invoke(IPC_CHANNELS.AI.SET_CONFIG, config),
    generateCards: (highlights, bookTitle) => invoke(IPC_CHANNELS.AI.GENERATE_CARDS, highlights, bookTitle),
    generateSummary: (highlights, bookTitle) => invoke(IPC_CHANNELS.AI.GENERATE_SUMMARY, highlights, bookTitle),
    chat: (question, context) => invoke(IPC_CHANNELS.AI.CHAT, question, context),
    explain: (content, bookTitle, chapterTitle) => invoke(IPC_CHANNELS.AI.EXPLAIN, content, bookTitle, chapterTitle)
  },
  settings: {
    get: (key) => invoke(IPC_CHANNELS.SETTINGS.GET, key),
    set: (key, value) => invoke(IPC_CHANNELS.SETTINGS.SET, key, value),
    getAll: () => invoke(IPC_CHANNELS.SETTINGS.GET_ALL)
  }
};
electron.contextBridge.exposeInMainWorld("api", api);
