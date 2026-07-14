"use strict";
const electron = require("electron");
const path = require("path");
const Database = require("better-sqlite3");
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
const logger = new Logger();
const DEFAULT_PARAMETERS = {
  requestRetention: 0.9,
  maximumInterval: 36500,
  w: [
    0.4,
    0.6,
    2.4,
    5.8,
    4.93,
    0.94,
    0.86,
    0.01,
    1.49,
    0.14,
    0.94,
    2.18,
    0.05,
    0.34,
    1.26,
    0.29,
    2.61
  ],
  decay: -0.5
};
function daysBetween(date1, date2) {
  const diffMs = Math.abs(date2.getTime() - date1.getTime());
  return Math.floor(diffMs / (1e3 * 60 * 60 * 24));
}
function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}
function constrainDifficulty(d) {
  return Math.min(Math.max(d, 0.1), 10);
}
function nextInterval(s, parameters) {
  const interval = s * (Math.pow(1 / parameters.requestRetention, 1 / parameters.decay) - 1);
  return Math.min(Math.max(Math.round(interval), 1), parameters.maximumInterval);
}
function nextDifficulty(d, r) {
  const dClone = d;
  switch (r) {
    case 1:
      return constrainDifficulty(dClone + 0.1);
    case 2:
      return constrainDifficulty(dClone + 0.2);
    case 3:
      return dClone;
    case 4:
      return constrainDifficulty(dClone - 0.1);
    default:
      return dClone;
  }
}
function nextStability(d, s, r, parameters) {
  const w = parameters.w;
  const decay = parameters.decay;
  if (s === 0) {
    return w[r - 1];
  }
  const dFactor = Math.exp(w[6] * (d - 1));
  const sFactor = Math.pow(s, decay);
  const rFactor = Math.exp(w[8] * (1 - r));
  const gFactor = 1 - Math.exp(w[9] * s);
  let stability = s * (1 + dFactor * sFactor * rFactor * gFactor);
  if (r === 2) {
    stability *= w[15];
  } else if (r === 4) {
    stability *= w[16];
  }
  return Math.max(stability, 0.1);
}
function cardFromDb(row) {
  return {
    id: row.id,
    highlightId: row.highlight_id,
    state: row.state,
    step: row.step,
    stability: row.stability,
    difficulty: row.difficulty,
    due: row.due,
    lastReview: row.last_review,
    elapsedDays: row.elapsed_days,
    scheduledDays: row.scheduled_days,
    reps: row.reps,
    lapses: row.lapses
  };
}
function cardToRow(card) {
  return {
    id: card.id,
    highlight_id: card.highlightId,
    state: card.state,
    step: card.step,
    stability: card.stability,
    difficulty: card.difficulty,
    due: card.due,
    last_review: card.lastReview,
    elapsed_days: card.elapsedDays,
    scheduled_days: card.scheduledDays,
    reps: card.reps,
    lapses: card.lapses
  };
}
function createCard(highlightId) {
  const now = /* @__PURE__ */ new Date();
  return {
    id: `card_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
    highlightId,
    state: 0,
    step: 0,
    stability: 0,
    difficulty: DEFAULT_PARAMETERS.w[2],
    due: now.toISOString(),
    lastReview: null,
    elapsedDays: 0,
    scheduledDays: 0,
    reps: 0,
    lapses: 0
  };
}
function reviewCard(card, rating, now = /* @__PURE__ */ new Date()) {
  const params = DEFAULT_PARAMETERS;
  const newCard = { ...card };
  const elapsedDays = card.lastReview ? daysBetween(new Date(card.lastReview), now) : 0;
  newCard.lastReview = now.toISOString();
  newCard.reps += 1;
  newCard.elapsedDays = elapsedDays;
  if (card.state === 0) {
    newCard.state = 1;
    newCard.step = 0;
    newCard.difficulty = params.w[2];
    newCard.stability = params.w[rating - 1];
  }
  if (card.state === 1 || card.state === 3) {
    if (rating === 1) {
      newCard.step = 0;
      newCard.lapses += 1;
      newCard.scheduledDays = 0;
      newCard.due = addDays(now, 0).toISOString();
    } else if (rating === 2) {
      newCard.scheduledDays = 0;
      newCard.due = addDays(now, 0).toISOString();
    } else if (rating === 3) {
      newCard.step += 1;
      if (newCard.step >= 2) {
        newCard.state = 2;
        const interval = nextInterval(newCard.stability, params);
        newCard.scheduledDays = interval;
        newCard.due = addDays(now, interval).toISOString();
      } else {
        newCard.scheduledDays = 0;
        newCard.due = addDays(now, 0).toISOString();
      }
    } else if (rating === 4) {
      newCard.state = 2;
      newCard.stability = nextStability(newCard.difficulty, newCard.stability, rating, params);
      const interval = nextInterval(newCard.stability, params);
      newCard.scheduledDays = interval;
      newCard.due = addDays(now, interval).toISOString();
    }
  }
  if (card.state === 2) {
    newCard.elapsedDays = elapsedDays;
    newCard.stability = nextStability(newCard.difficulty, card.stability, rating, params);
    newCard.difficulty = nextDifficulty(card.difficulty, rating);
    if (rating === 1) {
      newCard.lapses += 1;
      newCard.state = 3;
      newCard.step = 0;
      newCard.scheduledDays = 0;
      newCard.due = addDays(now, 0).toISOString();
    } else {
      const interval = nextInterval(newCard.stability, params);
      newCard.scheduledDays = interval;
      newCard.due = addDays(now, interval).toISOString();
    }
  }
  return newCard;
}
let db = null;
function getDatabasePath() {
  return path__namespace.join(electron.app.getPath("userData"), "zhixing.db");
}
function getDatabase() {
  if (!db) {
    const dbPath = getDatabasePath();
    db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    logger.info(`Database connected: ${dbPath}`);
  }
  return db;
}
function initDatabase() {
  const database = getDatabase();
  database.exec(`
    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      author TEXT,
      cover TEXT,
      isbn TEXT,
      publisher TEXT,
      publish_date TEXT,
      description TEXT,
      category TEXT,
      reading_progress REAL DEFAULT 0,
      total_chapter INTEGER DEFAULT 0,
      last_read_time TEXT,
      is_finished INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS highlights (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      chapter_title TEXT,
      content TEXT NOT NULL,
      note TEXT,
      style INTEGER DEFAULT 0,
      range_start TEXT,
      range_end TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS cards (
      id TEXT PRIMARY KEY,
      highlight_id TEXT NOT NULL,
      state INTEGER DEFAULT 0,
      step INTEGER DEFAULT 0,
      stability REAL DEFAULT 0,
      difficulty REAL DEFAULT 0,
      due TEXT NOT NULL,
      last_review TEXT,
      elapsed_days INTEGER DEFAULT 0,
      scheduled_days INTEGER DEFAULT 0,
      reps INTEGER DEFAULT 0,
      lapses INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (highlight_id) REFERENCES highlights(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      rating INTEGER NOT NULL,
      review_time TEXT DEFAULT (datetime('now')),
      elapsed_days INTEGER DEFAULT 0,
      scheduled_days INTEGER DEFAULT 0,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS book_summaries (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL UNIQUE,
      summary TEXT NOT NULL,
      key_points TEXT,
      generated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS daily_stats (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL UNIQUE,
      books_read INTEGER DEFAULT 0,
      highlights_added INTEGER DEFAULT 0,
      cards_reviewed INTEGER DEFAULT 0,
      reading_time INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_highlights_book_id ON highlights(book_id);
    CREATE INDEX IF NOT EXISTS idx_cards_highlight_id ON cards(highlight_id);
    CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due);
    CREATE INDEX IF NOT EXISTS idx_reviews_card_id ON reviews(card_id);
    CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);
  `);
  logger.info("Database initialized successfully");
}
function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    logger.info("Database closed");
  }
}
const booksDb = {
  getAll() {
    return getDatabase().prepare("SELECT * FROM books ORDER BY updated_at DESC").all();
  },
  getById(id) {
    return getDatabase().prepare("SELECT * FROM books WHERE id = ?").get(id);
  },
  create(book) {
    const stmt = getDatabase().prepare(`
      INSERT INTO books (id, title, author, cover, isbn, publisher, publish_date, description, category)
      VALUES (@id, @title, @author, @cover, @isbn, @publisher, @publish_date, @description, @category)
    `);
    return stmt.run(book);
  },
  update(id, book) {
    const fields = Object.keys(book).map((k) => `${k} = @${k}`).join(", ");
    const stmt = getDatabase().prepare(`UPDATE books SET ${fields}, updated_at = datetime('now') WHERE id = @id`);
    return stmt.run({ id, ...book });
  },
  delete(id) {
    return getDatabase().prepare("DELETE FROM books WHERE id = ?").run(id);
  },
  updateProgress(id, progress) {
    return getDatabase().prepare("UPDATE books SET reading_progress = ?, updated_at = datetime('now') WHERE id = ?").run(progress, id);
  },
  search(keyword) {
    return getDatabase().prepare("SELECT * FROM books WHERE title LIKE ? OR author LIKE ?").all(`%${keyword}%`, `%${keyword}%`);
  }
};
const highlightsDb = {
  getByBookId(bookId) {
    return getDatabase().prepare("SELECT * FROM highlights WHERE book_id = ? ORDER BY created_at DESC").all(bookId);
  },
  getById(id) {
    return getDatabase().prepare("SELECT * FROM highlights WHERE id = ?").get(id);
  },
  create(highlight) {
    const stmt = getDatabase().prepare(`
      INSERT INTO highlights (id, book_id, chapter_title, content, note, style, range_start, range_end)
      VALUES (@id, @book_id, @chapter_title, @content, @note, @style, @range_start, @range_end)
    `);
    return stmt.run(highlight);
  },
  update(id, highlight) {
    const fields = Object.keys(highlight).map((k) => `${k} = @${k}`).join(", ");
    const stmt = getDatabase().prepare(`UPDATE highlights SET ${fields}, updated_at = datetime('now') WHERE id = @id`);
    return stmt.run({ id, ...highlight });
  },
  delete(id) {
    return getDatabase().prepare("DELETE FROM highlights WHERE id = ?").run(id);
  },
  getAll() {
    return getDatabase().prepare(`
      SELECT h.*, b.title as book_title
      FROM highlights h
      JOIN books b ON h.book_id = b.id
      ORDER BY h.created_at DESC
    `).all();
  },
  search(keyword) {
    return getDatabase().prepare(`
      SELECT h.*, b.title as book_title
      FROM highlights h
      JOIN books b ON h.book_id = b.id
      WHERE h.content LIKE ? OR h.note LIKE ?
      ORDER BY h.created_at DESC
    `).all(`%${keyword}%`, `%${keyword}%`);
  }
};
const cardsDb = {
  getByHighlightId(highlightId) {
    return getDatabase().prepare("SELECT * FROM cards WHERE highlight_id = ?").get(highlightId);
  },
  getById(id) {
    const row = getDatabase().prepare("SELECT * FROM cards WHERE id = ?").get(id);
    return row ? cardFromDb(row) : null;
  },
  create(highlightId) {
    const card = createCard(highlightId);
    const row = cardToRow(card);
    const stmt = getDatabase().prepare(`
      INSERT INTO cards (id, highlight_id, state, step, stability, difficulty, due, last_review, elapsed_days, scheduled_days, reps, lapses)
      VALUES (@id, @highlight_id, @state, @step, @stability, @difficulty, @due, @last_review, @elapsed_days, @scheduled_days, @reps, @lapses)
    `);
    stmt.run(row);
    return card;
  },
  update(card) {
    const row = cardToRow(card);
    const stmt = getDatabase().prepare(`
      UPDATE cards SET state = @state, step = @step, stability = @stability, difficulty = @difficulty,
      due = @due, last_review = @last_review, elapsed_days = @elapsed_days, scheduled_days = @scheduled_days,
      reps = @reps, lapses = @lapses WHERE id = @id
    `);
    return stmt.run(row);
  },
  delete(id) {
    return getDatabase().prepare("DELETE FROM cards WHERE id = ?").run(id);
  },
  getDueCards(limit = 20) {
    const now = (/* @__PURE__ */ new Date()).toISOString();
    const rows = getDatabase().prepare("SELECT * FROM cards WHERE due <= ? ORDER BY due ASC LIMIT ?").all(now, limit);
    return rows.map(cardFromDb);
  },
  getByBookId(bookId) {
    const rows = getDatabase().prepare(`
      SELECT c.* FROM cards c
      JOIN highlights h ON c.highlight_id = h.id
      WHERE h.book_id = ?
    `).all(bookId);
    return rows.map(cardFromDb);
  },
  getReviewStats() {
    const total = getDatabase().prepare("SELECT COUNT(*) as count FROM cards").get();
    const due = getDatabase().prepare("SELECT COUNT(*) as count FROM cards WHERE due <= datetime('now')").get();
    const newCards = getDatabase().prepare("SELECT COUNT(*) as count FROM cards WHERE state = 0").get();
    const learning = getDatabase().prepare("SELECT COUNT(*) as count FROM cards WHERE state = 1 OR state = 3").get();
    const review = getDatabase().prepare("SELECT COUNT(*) as count FROM cards WHERE state = 2").get();
    return {
      total: total.count,
      due: due.count,
      new: newCards.count,
      learning: learning.count,
      review: review.count
    };
  }
};
const reviewsDb = {
  create(cardId, rating) {
    const card = cardsDb.getById(cardId);
    if (!card) throw new Error("Card not found");
    const newCard = reviewCard(card, rating);
    cardsDb.update(newCard);
    const reviewId = `review_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const stmt = getDatabase().prepare(`
      INSERT INTO reviews (id, card_id, rating, elapsed_days, scheduled_days)
      VALUES (?, ?, ?, ?, ?)
    `);
    stmt.run(reviewId, cardId, rating, newCard.elapsedDays, newCard.scheduledDays);
    return { reviewId, card: newCard };
  },
  getByCardId(cardId) {
    return getDatabase().prepare("SELECT * FROM reviews WHERE card_id = ? ORDER BY review_time DESC").all(cardId);
  },
  getRecent(limit = 50) {
    return getDatabase().prepare("SELECT * FROM reviews ORDER BY review_time DESC LIMIT ?").all(limit);
  }
};
const bookSummariesDb = {
  getByBookId(bookId) {
    return getDatabase().prepare("SELECT * FROM book_summaries WHERE book_id = ?").get(bookId);
  },
  create(bookId, summary, keyPoints) {
    const id = `summary_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const stmt = getDatabase().prepare(`
      INSERT OR REPLACE INTO book_summaries (id, book_id, summary, key_points)
      VALUES (?, ?, ?, ?)
    `);
    return stmt.run(id, bookId, summary, keyPoints);
  },
  delete(bookId) {
    return getDatabase().prepare("DELETE FROM book_summaries WHERE book_id = ?").run(bookId);
  }
};
const dailyStatsDb = {
  getToday() {
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    return getDatabase().prepare("SELECT * FROM daily_stats WHERE date = ?").get(today);
  },
  getRange(startDate, endDate) {
    return getDatabase().prepare("SELECT * FROM daily_stats WHERE date BETWEEN ? AND ? ORDER BY date ASC").all(startDate, endDate);
  },
  incrementBooksRead() {
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const stmt = getDatabase().prepare(`
      INSERT INTO daily_stats (id, date, books_read) VALUES (?, ?, 1)
      ON CONFLICT(date) DO UPDATE SET books_read = books_read + 1
    `);
    return stmt.run(`daily_${today}`, today);
  },
  incrementHighlightsAdded(count = 1) {
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const stmt = getDatabase().prepare(`
      INSERT INTO daily_stats (id, date, highlights_added) VALUES (?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET highlights_added = highlights_added + ?
    `);
    return stmt.run(`daily_${today}`, today, count, count);
  },
  incrementCardsReviewed(count = 1) {
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const stmt = getDatabase().prepare(`
      INSERT INTO daily_stats (id, date, cards_reviewed) VALUES (?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET cards_reviewed = cards_reviewed + ?
    `);
    return stmt.run(`daily_${today}`, today, count, count);
  },
  addReadingTime(seconds) {
    const today = (/* @__PURE__ */ new Date()).toISOString().split("T")[0];
    const stmt = getDatabase().prepare(`
      INSERT INTO daily_stats (id, date, reading_time) VALUES (?, ?, ?)
      ON CONFLICT(date) DO UPDATE SET reading_time = reading_time + ?
    `);
    return stmt.run(`daily_${today}`, today, seconds, seconds);
  }
};
const BASE_URL = "https://i.weread.qq.com";
let cookies = "";
function setCookies(cookieStr) {
  cookies = cookieStr;
}
function getCookies() {
  return cookies;
}
async function request(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`;
  const headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept": "application/json, text/plain, */*",
    "Cookie": getCookies(),
    ...options.headers
  };
  try {
    const response = await electron.net.fetch(url, {
      ...options,
      headers
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    logger.error(`API request failed: ${endpoint}`, error);
    throw error;
  }
}
async function getBookshelf() {
  try {
    const data = await request("/shelf/list");
    return (data.books || []).map((item) => ({
      bookId: item.bookId,
      title: item.book.title,
      author: item.book.author,
      cover: item.book.cover,
      isbn: item.book.isbn,
      publisher: item.book.publisher,
      publishTime: item.book.publishTime,
      intro: item.book.intro,
      category: item.book.category,
      finishReading: item.finishReading,
      progress: item.progress,
      totalChapter: item.book.totalChapter,
      lastReadTime: item.lastReadTime
    }));
  } catch (error) {
    logger.error("Failed to get bookshelf", error);
    throw error;
  }
}
async function fetchBookmarks(bookId) {
  try {
    const data = await request(`/book/bookmark/list?bookId=${bookId}&type=1`);
    return (data.updated || []).map((item) => ({
      bookmarkId: item.bookmarkId,
      bookId: item.bookId,
      chapterUid: item.chapterUid,
      chapterTitle: item.chapterTitle || "",
      markText: item.markText,
      style: item.style,
      range: item.range,
      createTime: item.createTime
    }));
  } catch (error) {
    logger.error(`Failed to fetch bookmarks for book ${bookId}`, error);
    throw error;
  }
}
async function fetchNotes(bookId) {
  try {
    const data = await request(`/review/list?bookId=${bookId}&listType=0&listMode=2&syncKey=0`);
    return (data.reviews || []).map((item) => ({
      reviewId: item.reviewId,
      bookId: item.bookId,
      chapterUid: item.chapterUid,
      chapterTitle: item.chapterTitle || "",
      abstract: item.abstract,
      content: item.content,
      range: item.range,
      createTime: item.createTime
    }));
  } catch (error) {
    logger.error(`Failed to fetch notes for book ${bookId}`, error);
    throw error;
  }
}
async function fetchChapters(bookId) {
  try {
    const data = await request(`/book/chapter/list?bookId=${bookId}`);
    return (data.updated || []).map((item) => ({
      chapterUid: item.chapterUid,
      title: item.title,
      level: item.level
    }));
  } catch (error) {
    logger.error(`Failed to fetch chapters for book ${bookId}`, error);
    throw error;
  }
}
async function fetchAllContent(bookId) {
  try {
    const [bookmarks, notes, chapters] = await Promise.all([
      fetchBookmarks(bookId),
      fetchNotes(bookId),
      fetchChapters(bookId)
    ]);
    return { bookmarks, notes, chapters };
  } catch (error) {
    logger.error(`Failed to fetch all content for book ${bookId}`, error);
    throw error;
  }
}
let config = null;
function setAIConfig(newConfig) {
  config = newConfig;
  logger.info(`AI service configured: provider=${newConfig.provider}, model=${newConfig.model}`);
}
async function callOpenAI(messages) {
  if (!config) throw new Error("AI service not configured");
  const baseUrl = config.baseUrl || "https://api.openai.com/v1";
  const model = config.model || "gpt-4o-mini";
  const response = await electron.net.fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 2e3
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
  }
  const data = await response.json();
  return {
    content: data.choices[0].message.content,
    usage: {
      promptTokens: data.usage.prompt_tokens,
      completionTokens: data.usage.completion_tokens
    }
  };
}
async function callAnthropic(messages) {
  if (!config) throw new Error("AI service not configured");
  const baseUrl = config.baseUrl || "https://api.anthropic.com/v1";
  const model = config.model || "claude-3-5-sonnet-20241022";
  const systemMessage = messages.find((m) => m.role === "system")?.content || "";
  const nonSystemMessages = messages.filter((m) => m.role !== "system");
  const response = await electron.net.fetch(`${baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      model,
      system: systemMessage,
      messages: nonSystemMessages.map((m) => ({
        role: m.role,
        content: m.content
      })),
      max_tokens: 2e3
    })
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error: ${response.status} - ${errorText}`);
  }
  const data = await response.json();
  return {
    content: data.content[0].text,
    usage: {
      promptTokens: data.usage.input_tokens,
      completionTokens: data.usage.output_tokens
    }
  };
}
async function callAI(messages) {
  if (!config) throw new Error("AI service not configured");
  switch (config.provider) {
    case "openai":
      return callOpenAI(messages);
    case "anthropic":
      return callAnthropic(messages);
    default:
      throw new Error(`Unsupported AI provider: ${config.provider}`);
  }
}
async function generateCards(highlights, bookTitle) {
  const highlightTexts = highlights.map(
    (h, i) => `[${i + 1}] ${h.content}${h.note ? `
笔记: ${h.note}` : ""}`
  ).join("\n\n");
  const messages = [
    {
      role: "system",
      content: `你是一个专业的学习助手，负责将阅读笔记转化为高质量的复习卡片。
要求：
1. 每张卡片有一个清晰的问题（front）和详细的答案（back）
2. 问题应该测试理解而非记忆
3. 答案应该包含关键概念和解释
4. 每张卡片附带相关标签
5. 返回JSON数组格式`
    },
    {
      role: "user",
      content: `请根据以下《${bookTitle}》的划线笔记生成复习卡片：

${highlightTexts}

请返回JSON数组，每个元素包含：front（问题）, back（答案）, tags（标签数组）`
    }
  ];
  try {
    const response = await callAI(messages);
    const jsonMatch = response.content.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("Failed to parse AI response as JSON");
    }
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    logger.error("Failed to generate cards", error);
    throw error;
  }
}
async function generateSummary(highlights, bookTitle) {
  const highlightTexts = highlights.map(
    (h) => `${h.chapterTitle ? `[${h.chapterTitle}] ` : ""}${h.content}`
  ).join("\n");
  const messages = [
    {
      role: "system",
      content: `你是一个专业的书籍摘要助手，负责生成结构化的书籍摘要。
要求：
1. 摘要应该简洁全面，约300-500字
2. 关键要点应该列出5-10个核心观点
3. 保持原书的核心思想和逻辑结构
4. 返回JSON格式`
    },
    {
      role: "user",
      content: `请根据以下《${bookTitle}》的划线内容生成摘要：

${highlightTexts}

请返回JSON对象，包含：summary（摘要文本）, keyPoints（关键要点字符串数组）`
    }
  ];
  try {
    const response = await callAI(messages);
    const jsonMatch = response.content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("Failed to parse AI response as JSON");
    }
    return JSON.parse(jsonMatch[0]);
  } catch (error) {
    logger.error("Failed to generate summary", error);
    throw error;
  }
}
async function chatWithContext(question, context) {
  const contextText = context.map(
    (c) => `${c.bookTitle ? `[${c.bookTitle}] ` : ""}${c.content}`
  ).join("\n\n");
  const messages = [
    {
      role: "system",
      content: `你是一个智能阅读助手，基于用户的阅读笔记回答问题。
回答要求：
1. 基于提供的笔记内容回答
2. 如果笔记中没有相关信息，坦诚告知
3. 引用相关笔记内容作为支持
4. 保持友好专业的语气`
    },
    {
      role: "user",
      content: `我的阅读笔记：
${contextText}

问题：${question}`
    }
  ];
  try {
    const response = await callAI(messages);
    return response.content;
  } catch (error) {
    logger.error("Failed to chat with context", error);
    throw error;
  }
}
async function explainHighlight(content, bookTitle, chapterTitle) {
  const messages = [
    {
      role: "system",
      content: "你是一个知识解读助手，帮助用户理解阅读中的重要内容。请用简洁清晰的语言解释这段内容的核心含义、重要性和可能的应用场景。"
    },
    {
      role: "user",
      content: `请解释以下内容（来自《${bookTitle}》${chapterTitle ? ` - ${chapterTitle}` : ""}）：

${content}`
    }
  ];
  try {
    const response = await callAI(messages);
    return response.content;
  } catch (error) {
    logger.error("Failed to explain highlight", error);
    throw error;
  }
}
const store = new Store();
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
function handle(channel, handler) {
  electron.ipcMain.handle(channel, async (_event, ...args) => {
    try {
      logger.debug(`IPC: ${channel}`, { args });
      const result = await handler(...args);
      return { success: true, data: result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`IPC Error: ${channel}`, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  });
}
function registerIpcHandlers() {
  handle(IPC_CHANNELS.BOOKS.GET_ALL, () => booksDb.getAll());
  handle(IPC_CHANNELS.BOOKS.GET_BY_ID, (id) => booksDb.getById(id));
  handle(IPC_CHANNELS.BOOKS.CREATE, (book) => booksDb.create(book));
  handle(IPC_CHANNELS.BOOKS.UPDATE, (id, book) => booksDb.update(id, book));
  handle(IPC_CHANNELS.BOOKS.DELETE, (id) => booksDb.delete(id));
  handle(IPC_CHANNELS.BOOKS.UPDATE_PROGRESS, (id, progress) => booksDb.updateProgress(id, progress));
  handle(IPC_CHANNELS.BOOKS.SEARCH, (keyword) => booksDb.search(keyword));
  handle(IPC_CHANNELS.HIGHLIGHTS.GET_BY_BOOK, (bookId) => highlightsDb.getByBookId(bookId));
  handle(IPC_CHANNELS.HIGHLIGHTS.GET_BY_ID, (id) => highlightsDb.getById(id));
  handle(IPC_CHANNELS.HIGHLIGHTS.CREATE, (highlight) => highlightsDb.create(highlight));
  handle(IPC_CHANNELS.HIGHLIGHTS.UPDATE, (id, highlight) => highlightsDb.update(id, highlight));
  handle(IPC_CHANNELS.HIGHLIGHTS.DELETE, (id) => highlightsDb.delete(id));
  handle(IPC_CHANNELS.HIGHLIGHTS.GET_ALL, () => highlightsDb.getAll());
  handle(IPC_CHANNELS.HIGHLIGHTS.SEARCH, (keyword) => highlightsDb.search(keyword));
  handle(IPC_CHANNELS.CARDS.GET_BY_HIGHLIGHT, (highlightId) => cardsDb.getByHighlightId(highlightId));
  handle(IPC_CHANNELS.CARDS.GET_BY_ID, (id) => cardsDb.getById(id));
  handle(IPC_CHANNELS.CARDS.CREATE, (highlightId) => cardsDb.create(highlightId));
  handle(IPC_CHANNELS.CARDS.UPDATE, (card) => cardsDb.update(card));
  handle(IPC_CHANNELS.CARDS.DELETE, (id) => cardsDb.delete(id));
  handle(IPC_CHANNELS.CARDS.GET_DUE, (limit) => cardsDb.getDueCards(limit));
  handle(IPC_CHANNELS.CARDS.GET_BY_BOOK, (bookId) => cardsDb.getByBookId(bookId));
  handle(IPC_CHANNELS.CARDS.GET_STATS, () => cardsDb.getReviewStats());
  handle(IPC_CHANNELS.REVIEWS.CREATE, (cardId, rating) => reviewsDb.create(cardId, rating));
  handle(IPC_CHANNELS.REVIEWS.GET_BY_CARD, (cardId) => reviewsDb.getByCardId(cardId));
  handle(IPC_CHANNELS.REVIEWS.GET_RECENT, (limit) => reviewsDb.getRecent(limit));
  handle(IPC_CHANNELS.SUMMARIES.GET_BY_BOOK, (bookId) => bookSummariesDb.getByBookId(bookId));
  handle(
    IPC_CHANNELS.SUMMARIES.CREATE,
    (bookId, summary, keyPoints) => bookSummariesDb.create(bookId, summary, keyPoints)
  );
  handle(IPC_CHANNELS.SUMMARIES.DELETE, (bookId) => bookSummariesDb.delete(bookId));
  handle(IPC_CHANNELS.DAILY_STATS.GET_TODAY, () => dailyStatsDb.getToday());
  handle(
    IPC_CHANNELS.DAILY_STATS.GET_RANGE,
    (startDate, endDate) => dailyStatsDb.getRange(startDate, endDate)
  );
  handle(IPC_CHANNELS.DAILY_STATS.INCREMENT_BOOKS, () => dailyStatsDb.incrementBooksRead());
  handle(
    IPC_CHANNELS.DAILY_STATS.INCREMENT_HIGHLIGHTS,
    (count) => dailyStatsDb.incrementHighlightsAdded(count)
  );
  handle(
    IPC_CHANNELS.DAILY_STATS.INCREMENT_CARDS,
    (count) => dailyStatsDb.incrementCardsReviewed(count)
  );
  handle(
    IPC_CHANNELS.DAILY_STATS.ADD_READING_TIME,
    (seconds) => dailyStatsDb.addReadingTime(seconds)
  );
  handle(IPC_CHANNELS.WEREAD.SET_COOKIES, (cookies2) => setCookies(cookies2));
  handle(IPC_CHANNELS.WEREAD.GET_BOOKSHELF, () => getBookshelf());
  handle(IPC_CHANNELS.WEREAD.FETCH_BOOKMARKS, (bookId) => fetchBookmarks(bookId));
  handle(IPC_CHANNELS.WEREAD.FETCH_NOTES, (bookId) => fetchNotes(bookId));
  handle(IPC_CHANNELS.WEREAD.FETCH_ALL_CONTENT, (bookId) => fetchAllContent(bookId));
  handle(IPC_CHANNELS.AI.SET_CONFIG, (config2) => setAIConfig(config2));
  handle(
    IPC_CHANNELS.AI.GENERATE_CARDS,
    (highlights, bookTitle) => generateCards(highlights, bookTitle)
  );
  handle(
    IPC_CHANNELS.AI.GENERATE_SUMMARY,
    (highlights, bookTitle) => generateSummary(highlights, bookTitle)
  );
  handle(
    IPC_CHANNELS.AI.CHAT,
    (question, context) => chatWithContext(question, context)
  );
  handle(
    IPC_CHANNELS.AI.EXPLAIN,
    (content, bookTitle, chapterTitle) => explainHighlight(content, bookTitle, chapterTitle)
  );
  handle(IPC_CHANNELS.SETTINGS.GET, (key) => store.get(key));
  handle(IPC_CHANNELS.SETTINGS.SET, (key, value) => store.set(key, value));
  handle(IPC_CHANNELS.SETTINGS.GET_ALL, () => store.store);
  logger.info("IPC handlers registered");
}
const isDev = !electron.app.isPackaged;
let mainWindow = null;
function createWindow() {
  const iconPath = path__namespace.join(__dirname, "../build/icon.png");
  let icon;
  try {
    icon = electron.nativeImage.createFromPath(iconPath);
  } catch {
    logger.warn("App icon not found, using default");
  }
  mainWindow = new electron.BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    icon,
    webPreferences: {
      preload: path__namespace.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    },
    show: false,
    titleBarStyle: "default"
  });
  if (isDev) {
    mainWindow.loadURL("http://localhost:5173");
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path__namespace.join(__dirname, "../dist/index.html"));
  }
  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
    logger.info("Main window shown");
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    electron.shell.openExternal(url);
    return { action: "deny" };
  });
}
function createMenu() {
  const template = [
    {
      label: "文件",
      submenu: [
        {
          label: "同步书架",
          accelerator: "CmdOrCtrl+S",
          click: () => {
            mainWindow?.webContents.send("menu:syncBookshelf");
          }
        },
        { type: "separator" },
        {
          label: "退出",
          accelerator: "CmdOrCtrl+Q",
          click: () => {
            electron.app.quit();
          }
        }
      ]
    },
    {
      label: "编辑",
      submenu: [
        { role: "undo", label: "撤销" },
        { role: "redo", label: "重做" },
        { type: "separator" },
        { role: "cut", label: "剪切" },
        { role: "copy", label: "复制" },
        { role: "paste", label: "粘贴" },
        { role: "selectAll", label: "全选" }
      ]
    },
    {
      label: "视图",
      submenu: [
        {
          label: "书架",
          accelerator: "CmdOrCtrl+1",
          click: () => {
            mainWindow?.webContents.send("navigate", "/bookshelf");
          }
        },
        {
          label: "复习",
          accelerator: "CmdOrCtrl+2",
          click: () => {
            mainWindow?.webContents.send("navigate", "/review");
          }
        },
        {
          label: "知识库",
          accelerator: "CmdOrCtrl+3",
          click: () => {
            mainWindow?.webContents.send("navigate", "/knowledge");
          }
        },
        { type: "separator" },
        { role: "reload", label: "刷新" },
        { role: "toggleDevTools", label: "开发者工具" },
        { type: "separator" },
        { role: "zoomIn", label: "放大" },
        { role: "zoomOut", label: "缩小" },
        { role: "resetZoom", label: "重置缩放" },
        { type: "separator" },
        { role: "togglefullscreen", label: "全屏" }
      ]
    },
    {
      label: "帮助",
      submenu: [
        {
          label: "关于",
          click: () => {
            mainWindow?.webContents.send("menu:about");
          }
        }
      ]
    }
  ];
  const menu = electron.Menu.buildFromTemplate(template);
  electron.Menu.setApplicationMenu(menu);
}
electron.app.whenReady().then(() => {
  logger.info("App starting...");
  try {
    initDatabase();
    registerIpcHandlers();
    createMenu();
    createWindow();
  } catch (error) {
    logger.error("Failed to initialize app", error);
    electron.app.quit();
  }
  electron.app.on("activate", () => {
    if (electron.BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});
electron.app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    electron.app.quit();
  }
});
electron.app.on("before-quit", () => {
  logger.info("App quitting...");
  closeDatabase();
  logger.close();
});
electron.app.on("certificate-error", (event, _webContents, _url, _error, _certificate, callback) => {
  if (isDev) {
    event.preventDefault();
    callback(true);
  } else {
    callback(false);
  }
});
