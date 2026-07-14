import initSqlJs, { Database } from 'sql.js';
import { app } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { logger } from './logger';
import { rowsToObjects } from './utils/db';
import { Card, cardFromDb, cardToRow, createCard, reviewCard, reviewVocabulary, Rating, CardState } from './fsrs-engine';

let db: Database | null = null;
let saveTimeout: NodeJS.Timeout | null = null;
let isDirty = false;
const SAVE_DELAY = 3000;

export function getDatabasePath(): string {
  return path.join(app.getPath('userData'), 'zhixing.db');
}

function markDirty(): void {
  isDirty = true;
  if (saveTimeout) return;
  saveTimeout = setTimeout(() => {
    persistToDisk();
    saveTimeout = null;
  }, SAVE_DELAY);
}

function persistToDisk(): void {
  if (!db || !isDirty) return;
  try {
    const data = db.export();
    fs.writeFileSync(getDatabasePath(), Buffer.from(data));
    isDirty = false;
    logger.debug('Database saved to disk');
  } catch (error) {
    logger.error('Failed to save database', { error: String(error) });
  }
}

function saveDatabase(): void {
  markDirty();
}

export function forceSaveDatabase(): void {
  if (saveTimeout) {
    clearTimeout(saveTimeout);
    saveTimeout = null;
  }
  persistToDisk();
}

export function getDatabase(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function runTransaction<T>(fn: (db: Database) => T): T {
  const database = getDatabase();
  database.run('BEGIN TRANSACTION');
  try {
    const result = fn(database);
    database.run('COMMIT');
    saveDatabase();
    return result;
  } catch (error) {
    database.run('ROLLBACK');
    throw error;
  }
}

export function runBatch(operations: Array<(db: Database) => void>): void {
  runTransaction((database) => {
    for (const op of operations) {
      op(database);
    }
  });
}

export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs();
  const dbPath = getDatabasePath();

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON;');

  db.run(`
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
  `);

  db.run(`
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
  `);

  db.run(`
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
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      card_id TEXT NOT NULL,
      rating INTEGER NOT NULL,
      review_time TEXT DEFAULT (datetime('now')),
      elapsed_days INTEGER DEFAULT 0,
      scheduled_days INTEGER DEFAULT 0,
      FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS book_summaries (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL UNIQUE,
      summary TEXT NOT NULL,
      key_points TEXT,
      generated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS daily_stats (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL UNIQUE,
      books_read INTEGER DEFAULT 0,
      highlights_added INTEGER DEFAULT 0,
      cards_reviewed INTEGER DEFAULT 0,
      reading_time INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      feature TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      book_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      message_count INTEGER NOT NULL DEFAULT 0
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      intent TEXT,
      tools_used TEXT,
      bloom_level INTEGER,
      mastery_assessment TEXT,
      sources TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS user_profiles (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS methodologies (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      name TEXT NOT NULL,
      name_en TEXT,
      trigger_scenario TEXT,
      description TEXT,
      steps TEXT,
      output_format TEXT,
      examples TEXT,
      tags TEXT,
      source_highlight_ids TEXT,
      mastery_level INTEGER DEFAULT 0,
      practice_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS knowledge_cards (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('concept', 'methodology', 'quote')),
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      interpretation TEXT,
      application TEXT,
      related_card_ids TEXT,
      tags TEXT,
      source_highlight_id TEXT,
      review_count INTEGER DEFAULT 0,
      mastery_level INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS book_architecture (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL UNIQUE,
      core_proposition TEXT,
      cognitive_framework TEXT,
      methodology_architecture TEXT,
      knowledge_hierarchy TEXT,
      target_audience TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );
  `);

  // 每日学习文章表
  db.run(`
    CREATE TABLE IF NOT EXISTS articles (
      id TEXT PRIMARY KEY,
      title_en TEXT NOT NULL,
      title_zh TEXT,
      content_en TEXT NOT NULL,
      content_zh TEXT,
      summary_zh TEXT,
      source TEXT NOT NULL,
      source_url TEXT,
      category TEXT DEFAULT 'psychology',
      difficulty TEXT DEFAULT 'cet4',
      vocabulary_json TEXT,
      is_read INTEGER DEFAULT 0,
      is_favorite INTEGER DEFAULT 0,
      read_time INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      published_at TEXT
    );
  `);

  // 生词本表（支持艾宾浩斯遗忘曲线算法）
  db.run(`
    CREATE TABLE IF NOT EXISTS vocabulary (
      id TEXT PRIMARY KEY,
      word TEXT NOT NULL UNIQUE,
      phonetic TEXT,
      part_of_speech TEXT,
      meaning_zh TEXT NOT NULL,
      example_en TEXT,
      example_zh TEXT,
      cefr_level TEXT,
      source_article_id TEXT,
      source TEXT DEFAULT '手动添加',
      -- 艾宾浩斯复习算法字段
      is_mastered INTEGER DEFAULT 0,
      review_count INTEGER DEFAULT 0,
      last_review_at TEXT,
      next_review_at TEXT,
      -- SM-2算法字段
      ef_factor REAL DEFAULT 2.5,
      interval_days INTEGER DEFAULT 0,
      repetition_count INTEGER DEFAULT 0,
      -- 学习状态
      familiarity_level INTEGER DEFAULT 0,
      -- 学习阶段: 0=新词, 1=学习中, 2=复习中
      learning_stage INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_article_id) REFERENCES articles(id) ON DELETE SET NULL
    );
  `);

  db.run('CREATE INDEX IF NOT EXISTS idx_highlights_book_id ON highlights(book_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_cards_highlight_id ON cards(highlight_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due);');
  db.run('CREATE INDEX IF NOT EXISTS idx_reviews_card_id ON reviews(card_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);');
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_conversation ON chat_messages(conversation_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);');
  db.run('CREATE INDEX IF NOT EXISTS idx_methodologies_book_id ON methodologies(book_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_knowledge_cards_book_id ON knowledge_cards(book_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_knowledge_cards_type ON knowledge_cards(type);');
  db.run('CREATE INDEX IF NOT EXISTS idx_book_architecture_book_id ON book_architecture(book_id);');
  db.run('CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source);');
  db.run('CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at);');
  db.run('CREATE INDEX IF NOT EXISTS idx_articles_difficulty ON articles(difficulty);');
  db.run('CREATE INDEX IF NOT EXISTS idx_vocabulary_word ON vocabulary(word);');
  db.run('CREATE INDEX IF NOT EXISTS idx_vocabulary_mastered ON vocabulary(is_mastered);');

  // 记忆表（AI对话记忆，持久化存储）
  db.run(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('preference', 'insight', 'interaction', 'achievement')),
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      context TEXT,
      access_count INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      last_accessed_at TEXT DEFAULT (datetime('now'))
    );
  `);
  db.run('CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);');
  db.run('CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);');

  // 数据库迁移：为 cards 表新增应用标签和掌握度字段
  migrateCardsTable();

  saveDatabase();
  logger.info(`Database connected: ${dbPath}`);
  logger.info('Database initialized successfully');
}

function migrateCardsTable(): void {
  try {
    const database = getDatabase();
    // 检查 application_tag 列是否存在
    const cols = database.exec("PRAGMA table_info(cards)");
    const colNames = rowsToObjects(cols).map((c: Record<string, unknown>) => c.name as string);

    if (!colNames.includes('application_tag')) {
      database.run("ALTER TABLE cards ADD COLUMN application_tag TEXT");
      logger.info('Migration: added application_tag to cards table');
    }
    if (!colNames.includes('mastery_level')) {
      database.run("ALTER TABLE cards ADD COLUMN mastery_level INTEGER DEFAULT 0");
      logger.info('Migration: added mastery_level to cards table');
    }
  } catch (error) {
    logger.error('Migration failed for cards table', { error: String(error) });
  }

  // vocabulary 表迁移：添加缺失的列
  try {
    const database = getDatabase();
    const vocabCols = database.exec("PRAGMA table_info(vocabulary)");
    const vocabColNames = rowsToObjects(vocabCols).map((c: Record<string, unknown>) => c.name as string);

    const migrations: [string, string][] = [
      ['source', 'ALTER TABLE vocabulary ADD COLUMN source TEXT DEFAULT \'手动添加\''],
      ['next_review_at', 'ALTER TABLE vocabulary ADD COLUMN next_review_at TEXT'],
      ['ef_factor', 'ALTER TABLE vocabulary ADD COLUMN ef_factor REAL DEFAULT 2.5'],
      ['interval_days', 'ALTER TABLE vocabulary ADD COLUMN interval_days INTEGER DEFAULT 0'],
      ['repetition_count', 'ALTER TABLE vocabulary ADD COLUMN repetition_count INTEGER DEFAULT 0'],
      ['familiarity_level', 'ALTER TABLE vocabulary ADD COLUMN familiarity_level INTEGER DEFAULT 0'],
      ['learning_stage', 'ALTER TABLE vocabulary ADD COLUMN learning_stage INTEGER DEFAULT 0'],
    ];

    for (const [colName, sql] of migrations) {
      if (!vocabColNames.includes(colName)) {
        database.run(sql);
        logger.info(`Migration: added ${colName} to vocabulary table`);
      }
    }
  } catch (error) {
    logger.error('Migration failed for vocabulary table', { error: String(error) });
  }

  // articles 表迁移：添加 source_website 列
  try {
    const database = getDatabase();
    const articleCols = database.exec("PRAGMA table_info(articles)");
    const articleColNames = rowsToObjects(articleCols).map((c: Record<string, unknown>) => c.name as string);

    if (!articleColNames.includes('source_website')) {
      database.run("ALTER TABLE articles ADD COLUMN source_website TEXT");
      logger.info('Migration: added source_website to articles table');
    }
  } catch (error) {
    logger.error('Migration failed for articles table', { error: String(error) });
  }
}

export function closeDatabase(): void {
  if (db) {
    forceSaveDatabase();
    db.close();
    db = null;
    logger.info('Database closed');
  }
}

export const booksDb = {
  getAll(): Record<string, unknown>[] {
    const result = getDatabase().exec('SELECT * FROM books ORDER BY last_read_time DESC NULLS LAST, updated_at DESC');
    return rowsToObjects(result);
  },

  getById(id: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec('SELECT * FROM books WHERE id = ?', [id]);
    const rows = rowsToObjects(result);
    return rows[0];
  },

  create(book: Record<string, unknown>): void {
    getDatabase().run(
      `INSERT INTO books (id, title, author, cover, isbn, publisher, publish_date, description, category, reading_progress, total_chapter, last_read_time, is_finished)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        book.id,
        book.title,
        book.author ?? null,
        book.cover ?? null,
        book.isbn ?? null,
        book.publisher ?? null,
        book.publish_date ?? null,
        book.description ?? null,
        book.category ?? null,
        book.reading_progress ?? book.progress ?? 0,
        book.total_chapter ?? book.totalChapter ?? 0,
        book.last_read_time ?? book.lastReadTime ?? null,
        book.is_finished ?? book.finishReading ?? 0,
      ]
    );
    saveDatabase();
  },

  createBatch(books: Array<Record<string, unknown>>): void {
    runTransaction((database) => {
      const stmt = database.prepare(
        `INSERT OR REPLACE INTO books (id, title, author, cover, isbn, publisher, publish_date, description, category, reading_progress, total_chapter, last_read_time, is_finished)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      
      for (const book of books) {
        stmt.run([
          book.id,
          book.title,
          book.author ?? null,
          book.cover ?? null,
          book.isbn ?? null,
          book.publisher ?? null,
          book.publish_date ?? null,
          book.description ?? null,
          book.category ?? null,
          book.reading_progress ?? book.progress ?? 0,
          book.total_chapter ?? book.totalChapter ?? 0,
          book.last_read_time ?? book.lastReadTime ?? null,
          book.is_finished ?? book.finishReading ?? 0,
        ]);
      }
      
      stmt.free();
    });
  },

  update(id: string, book: Record<string, unknown>): void {
    const updatableKeys = Object.keys(book).filter(k => k !== 'id');
    const setClauses = updatableKeys.map(k => `${k} = ?`).join(', ');
    const values = updatableKeys.map(k => book[k]);
    getDatabase().run(
      `UPDATE books SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    );
    saveDatabase();
  },

  delete(id: string): void {
    getDatabase().run('DELETE FROM books WHERE id = ?', [id]);
    saveDatabase();
  },

  deleteBatch(ids: string[]): void {
    runTransaction((database) => {
      const stmt = database.prepare('DELETE FROM books WHERE id = ?');
      for (const id of ids) {
        stmt.run([id]);
      }
      stmt.free();
    });
  },

  updateProgress(id: string, progress: number): void {
    getDatabase().run(
      "UPDATE books SET reading_progress = ?, updated_at = datetime('now') WHERE id = ?",
      [progress, id]
    );
    saveDatabase();
  },

  search(keyword: string): Record<string, unknown>[] {
    const pattern = `%${keyword}%`;
    const result = getDatabase().exec(
      'SELECT * FROM books WHERE title LIKE ? OR author LIKE ?',
      [pattern, pattern]
    );
    return rowsToObjects(result);
  },

  getByStatus(status: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM books WHERE status = ? ORDER BY updated_at DESC',
      [status]
    );
    return rowsToObjects(result);
  },

  getRecent(limit: number = 10): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM books ORDER BY last_read_time DESC LIMIT ?',
      [limit]
    );
    return rowsToObjects(result);
  },

  count(): number {
    const result = getDatabase().exec('SELECT COUNT(*) FROM books');
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },
};

export const highlightsDb = {
  getByBookId(bookId: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT h.*, b.title as book_title FROM highlights h JOIN books b ON h.book_id = b.id WHERE h.book_id = ? ORDER BY h.created_at DESC',
      [bookId]
    );
    return rowsToObjects(result);
  },

  getById(id: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec('SELECT * FROM highlights WHERE id = ?', [id]);
    const rows = rowsToObjects(result);
    return rows[0];
  },

  exists(bookId: string, content: string): boolean {
    const result = getDatabase().exec(
      'SELECT 1 FROM highlights WHERE book_id = ? AND content = ? LIMIT 1',
      [bookId, content]
    );
    return result.length > 0 && result[0].values.length > 0;
  },

  create(highlight: Record<string, unknown>): boolean {
    const bookId = highlight.book_id as string;
    const content = highlight.content as string;

    if (this.exists(bookId, content)) {
      return false;
    }

    getDatabase().run(
      `INSERT INTO highlights (id, book_id, chapter_title, content, note, style, range_start, range_end)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        highlight.id,
        bookId,
        highlight.chapter_title ?? null,
        content,
        highlight.note ?? null,
        highlight.style ?? 0,
        highlight.range_start ?? null,
        highlight.range_end ?? null,
      ]
    );
    saveDatabase();
    return true;
  },

  createBatch(highlights: Array<Record<string, unknown>>): number {
    let newCount = 0;
    const newHighlightIds: string[] = [];
    runTransaction((database) => {
      const bookIds = [...new Set(highlights.map(h => h.book_id as string))];
      const placeholders = bookIds.map(() => '?').join(', ');
      const existingRows = database.exec(
        `SELECT book_id, content FROM highlights WHERE book_id IN (${placeholders})`,
        bookIds
      );
      const existingSet = new Set<string>();
      if (existingRows.length > 0 && existingRows[0].values.length > 0) {
        for (const row of existingRows[0].values) {
          existingSet.add(`${row[0]}:${row[1]}`);
        }
      }

      const stmt = database.prepare(
        `INSERT INTO highlights (id, book_id, chapter_title, content, note, style, range_start, range_end)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      );
      
      for (const highlight of highlights) {
        const bookId = highlight.book_id as string;
        const content = highlight.content as string;

        if (existingSet.has(`${bookId}:${content}`)) {
          continue;
        }

        stmt.run([
          highlight.id,
          bookId,
          highlight.chapter_title ?? null,
          content,
          highlight.note ?? null,
          highlight.style ?? 0,
          highlight.range_start ?? null,
          highlight.range_end ?? null,
        ]);
        existingSet.add(`${bookId}:${content}`);
        newHighlightIds.push(highlight.id as string);
        newCount++;
      }
      
      stmt.free();
    });

    // 批量创建复习卡片
    if (newHighlightIds.length > 0) {
      try {
        cardsDb.createBatch(newHighlightIds);
      } catch (error) {
        logger.error('批量创建复习卡片失败', { error: String(error), count: newHighlightIds.length });
      }
    }

    return newCount;
  },

  update(id: string, highlight: Record<string, unknown>): void {
    const updatableKeys = Object.keys(highlight).filter(k => k !== 'id');
    const setClauses = updatableKeys.map(k => `${k} = ?`).join(', ');
    const values = updatableKeys.map(k => highlight[k]);
    getDatabase().run(
      `UPDATE highlights SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    );
    saveDatabase();
  },

  delete(id: string): void {
    getDatabase().run('DELETE FROM highlights WHERE id = ?', [id]);
    saveDatabase();
  },

  deleteBatch(ids: string[]): void {
    runTransaction((database) => {
      const stmt = database.prepare('DELETE FROM highlights WHERE id = ?');
      for (const id of ids) {
        stmt.run([id]);
      }
      stmt.free();
    });
  },

  deleteByBookId(bookId: string): void {
    getDatabase().run('DELETE FROM highlights WHERE book_id = ?', [bookId]);
    saveDatabase();
  },

  getAll(): Record<string, unknown>[] {
    const result = getDatabase().exec(`
      SELECT h.*, b.title as book_title
      FROM highlights h
      JOIN books b ON h.book_id = b.id
      ORDER BY h.created_at DESC
    `);
    return rowsToObjects(result);
  },

  search(keyword: string): Record<string, unknown>[] {
    const pattern = `%${keyword}%`;
    const result = getDatabase().exec(`
      SELECT h.*, b.title as book_title
      FROM highlights h
      JOIN books b ON h.book_id = b.id
      WHERE h.content LIKE ? OR h.note LIKE ?
      ORDER BY h.created_at DESC
    `, [pattern, pattern]);
    return rowsToObjects(result);
  },

  count(): number {
    const result = getDatabase().exec('SELECT COUNT(*) FROM highlights');
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },

  countByBookId(bookId: string): number {
    const result = getDatabase().exec(
      'SELECT COUNT(*) FROM highlights WHERE book_id = ?',
      [bookId]
    );
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },

  getRecent(limit: number = 20): Record<string, unknown>[] {
    const result = getDatabase().exec(`
      SELECT h.*, b.title as book_title
      FROM highlights h
      JOIN books b ON h.book_id = b.id
      ORDER BY h.created_at DESC
      LIMIT ?
    `, [limit]);
    return rowsToObjects(result);
  },
};

export const cardsDb = {
  getByHighlightId(highlightId: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec(
      'SELECT * FROM cards WHERE highlight_id = ?',
      [highlightId]
    );
    const rows = rowsToObjects(result);
    return rows[0];
  },

  getById(id: string): Card | null {
    const result = getDatabase().exec('SELECT * FROM cards WHERE id = ?', [id]);
    const rows = rowsToObjects(result);
    return rows[0] ? cardFromDb(rows[0]) : null;
  },

  create(highlightId: string): Card {
    const card = createCard(highlightId);
    const row = cardToRow(card);
    getDatabase().run(
      `INSERT INTO cards (id, highlight_id, state, step, stability, difficulty, due, last_review, elapsed_days, scheduled_days, reps, lapses)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        row.id,
        row.highlight_id,
        row.state,
        row.step,
        row.stability,
        row.difficulty,
        row.due,
        row.last_review,
        row.elapsed_days,
        row.scheduled_days,
        row.reps,
        row.lapses,
      ]
    );
    saveDatabase();
    return card;
  },

  createBatch(highlightIds: string[]): Card[] {
    const cards: Card[] = [];
    runTransaction((database) => {
      const stmt = database.prepare(
        `INSERT INTO cards (id, highlight_id, state, step, stability, difficulty, due, last_review, elapsed_days, scheduled_days, reps, lapses)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      
      for (const highlightId of highlightIds) {
        const card = createCard(highlightId);
        const row = cardToRow(card);
        stmt.run([
          row.id,
          row.highlight_id,
          row.state,
          row.step,
          row.stability,
          row.difficulty,
          row.due,
          row.last_review,
          row.elapsed_days,
          row.scheduled_days,
          row.reps,
          row.lapses,
        ]);
        cards.push(card);
      }
      
      stmt.free();
    });
    return cards;
  },

  update(card: Card): void {
    const row = cardToRow(card);
    getDatabase().run(
      `UPDATE cards SET state = ?, step = ?, stability = ?, difficulty = ?,
       due = ?, last_review = ?, elapsed_days = ?, scheduled_days = ?,
       reps = ?, lapses = ? WHERE id = ?`,
      [
        row.state,
        row.step,
        row.stability,
        row.difficulty,
        row.due,
        row.last_review,
        row.elapsed_days,
        row.scheduled_days,
        row.reps,
        row.lapses,
        row.id,
      ]
    );
    saveDatabase();
  },

  updateBatch(cards: Card[]): void {
    runTransaction((database) => {
      const stmt = database.prepare(
        `UPDATE cards SET state = ?, step = ?, stability = ?, difficulty = ?,
         due = ?, last_review = ?, elapsed_days = ?, scheduled_days = ?,
         reps = ?, lapses = ? WHERE id = ?`
      );
      
      for (const card of cards) {
        const row = cardToRow(card);
        stmt.run([
          row.state,
          row.step,
          row.stability,
          row.difficulty,
          row.due,
          row.last_review,
          row.elapsed_days,
          row.scheduled_days,
          row.reps,
          row.lapses,
          row.id,
        ]);
      }
      
      stmt.free();
    });
  },

  delete(id: string): void {
    getDatabase().run('DELETE FROM cards WHERE id = ?', [id]);
    saveDatabase();
  },

  deleteBatch(ids: string[]): void {
    runTransaction((database) => {
      const stmt = database.prepare('DELETE FROM cards WHERE id = ?');
      for (const id of ids) {
        stmt.run([id]);
      }
      stmt.free();
    });
  },

  deleteByHighlightId(highlightId: string): void {
    getDatabase().run('DELETE FROM cards WHERE highlight_id = ?', [highlightId]);
    saveDatabase();
  },

  createForExistingHighlights(): { created: number; skipped: number } {
    const result = getDatabase().exec(`
      SELECT h.id FROM highlights h
      LEFT JOIN cards c ON h.id = c.highlight_id
      WHERE c.id IS NULL
    `);
    const rows = rowsToObjects(result);
    const highlightIds = rows.map(r => r.id as string);

    if (highlightIds.length === 0) {
      return { created: 0, skipped: 0 };
    }

    const cards = this.createBatch(highlightIds);
    return { created: cards.length, skipped: rows.length - cards.length };
  },

  getDueCards(limit: number = 20): Card[] {
    const now = new Date().toISOString();
    const result = getDatabase().exec(
      'SELECT * FROM cards WHERE due <= ? ORDER BY due ASC LIMIT ?',
      [now, limit]
    );
    return rowsToObjects(result).map(cardFromDb);
  },

  getByBookId(bookId: string): Card[] {
    const result = getDatabase().exec(`
      SELECT c.* FROM cards c
      JOIN highlights h ON c.highlight_id = h.id
      WHERE h.book_id = ?
    `, [bookId]);
    return rowsToObjects(result).map(cardFromDb);
  },

  getReviewStats(): { total: number; due: number; new: number; learning: number; review: number } {
    const execScalar = (sql: string): number => {
      const result = getDatabase().exec(sql);
      return result.length > 0 ? (result[0].values[0][0] as number) : 0;
    };

    const total = execScalar('SELECT COUNT(*) FROM cards');
    const due = execScalar("SELECT COUNT(*) FROM cards WHERE due <= datetime('now')");
    const newCards = execScalar('SELECT COUNT(*) FROM cards WHERE state = 0');
    const learning = execScalar('SELECT COUNT(*) FROM cards WHERE state = 1 OR state = 3');
    const review = execScalar('SELECT COUNT(*) FROM cards WHERE state = 2');

    return { total, due, new: newCards, learning, review };
  },

  updateApplicationTag(id: string, tag: string): void {
    getDatabase().run(
      'UPDATE cards SET application_tag = ? WHERE id = ?',
      [tag, id]
    );
    saveDatabase();
  },

  updateMasteryLevel(id: string, level: number): void {
    getDatabase().run(
      'UPDATE cards SET mastery_level = ? WHERE id = ?',
      [level, id]
    );
    saveDatabase();
  },

  getByState(state: CardState, limit?: number): Card[] {
    let sql = 'SELECT * FROM cards WHERE state = ? ORDER BY due ASC';
    const params: unknown[] = [state];
    
    if (limit) {
      sql += ' LIMIT ?';
      params.push(limit);
    }
    
    const result = getDatabase().exec(sql, params);
    return rowsToObjects(result).map(cardFromDb);
  },

  getNewCards(limit: number = 20): Card[] {
    return this.getByState(CardState.New, limit);
  },

  getLearningCards(limit: number = 20): Card[] {
    const result = getDatabase().exec(
      'SELECT * FROM cards WHERE state = ? OR state = ? ORDER BY due ASC LIMIT ?',
      [CardState.Learning, CardState.Relearning, limit]
    );
    return rowsToObjects(result).map(cardFromDb);
  },

  count(): number {
    const result = getDatabase().exec('SELECT COUNT(*) FROM cards');
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },
};

// 每日学习文章数据库操作
export const articlesDb = {
  getAll(limit: number = 50): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM articles ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    return rowsToObjects(result);
  },

  getById(id: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec('SELECT * FROM articles WHERE id = ?', [id]);
    const rows = rowsToObjects(result);
    return rows.length > 0 ? rows[0] : undefined;
  },

  getUnread(limit: number = 10): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM articles WHERE is_read = 0 ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    return rowsToObjects(result);
  },

  getFavorites(limit: number = 50): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM articles WHERE is_favorite = 1 ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    return rowsToObjects(result);
  },

  create(article: {
    id: string;
    title_en: string;
    title_zh?: string;
    content_en: string;
    content_zh?: string;
    summary_zh?: string;
    source: string;
    source_url?: string;
    source_website?: string;
    category?: string;
    difficulty?: string;
    vocabulary_json?: string;
    published_at?: string;
  }): boolean {
    try {
      getDatabase().run(
        `INSERT INTO articles (id, title_en, title_zh, content_en, content_zh, summary_zh, source, source_url, source_website, category, difficulty, vocabulary_json, published_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          article.id,
          article.title_en,
          article.title_zh ?? null,
          article.content_en,
          article.content_zh ?? null,
          article.summary_zh ?? null,
          article.source,
          article.source_url ?? null,
          article.source_website ?? null,
          article.category ?? 'psychology',
          article.difficulty ?? 'cet4',
          article.vocabulary_json ?? null,
          article.published_at ?? null,
        ]
      );
      saveDatabase();
      return true;
    } catch (error) {
      logger.error('Failed to create article', { error: String(error) });
      return false;
    }
  },

  markAsRead(id: string): void {
    getDatabase().run('UPDATE articles SET is_read = 1 WHERE id = ?', [id]);
    saveDatabase();
  },

  toggleFavorite(id: string): boolean {
    const article = this.getById(id);
    if (!article) return false;
    const newStatus = article.is_favorite ? 0 : 1;
    getDatabase().run('UPDATE articles SET is_favorite = ? WHERE id = ?', [newStatus, id]);
    saveDatabase();
    return newStatus === 1;
  },

  delete(id: string): void {
    getDatabase().run('DELETE FROM articles WHERE id = ?', [id]);
    saveDatabase();
  },

  count(): number {
    const result = getDatabase().exec('SELECT COUNT(*) FROM articles');
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },

  getTodayCount(): number {
    const result = getDatabase().exec(
      "SELECT COUNT(*) FROM articles WHERE date(created_at) = date('now')"
    );
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },
};

// 生词本数据库操作（支持艾宾浩斯遗忘曲线算法）
export const vocabularyDb = {
  getAll(limit: number = 200): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM vocabulary ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    return rowsToObjects(result);
  },

  getById(id: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec('SELECT * FROM vocabulary WHERE id = ?', [id]);
    const rows = rowsToObjects(result);
    return rows.length > 0 ? rows[0] : undefined;
  },

  getByWord(word: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec('SELECT * FROM vocabulary WHERE word = ?', [word.toLowerCase()]);
    const rows = rowsToObjects(result);
    return rows.length > 0 ? rows[0] : undefined;
  },

  getUnmastered(limit: number = 50): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM vocabulary WHERE is_mastered = 0 ORDER BY review_count ASC, created_at DESC LIMIT ?',
      [limit]
    );
    return rowsToObjects(result);
  },

  // 获取今日需要复习的单词（基于艾宾浩斯算法）
  getDueForReview(limit: number = 50): Record<string, unknown>[] {
    const result = getDatabase().exec(
      `SELECT * FROM vocabulary 
       WHERE is_mastered = 0 
       AND (next_review_at IS NULL OR datetime(next_review_at) <= datetime('now'))
       ORDER BY next_review_at ASC, created_at DESC
       LIMIT ?`,
      [limit]
    );
    return rowsToObjects(result);
  },

  // 获取今日待复习数量
  getDueCount(): number {
    const result = getDatabase().exec(
      `SELECT COUNT(*) FROM vocabulary 
       WHERE is_mastered = 0 
       AND (next_review_at IS NULL OR datetime(next_review_at) <= datetime('now'))`
    );
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },

  create(vocab: {
    id?: string;
    word: string;
    phonetic?: string;
    part_of_speech?: string;
    meaning_zh: string;
    translation?: string;
    pos?: string;
    example_en?: string;
    example_zh?: string;
    cefr_level?: string;
    source_article_id?: string;
    source?: string;
  }): Record<string, unknown> | null {
    try {
      // 检查是否已存在
      const existing = this.getByWord(vocab.word);
      if (existing) return existing as Record<string, unknown>;

      const id = vocab.id || `vocab_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      const now = new Date().toISOString();

      getDatabase().run(
        `INSERT INTO vocabulary (id, word, phonetic, part_of_speech, meaning_zh, example_en, example_zh, cefr_level, source_article_id, source, next_review_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          vocab.word.toLowerCase(),
          vocab.phonetic ?? vocab.translation ?? null,
          vocab.part_of_speech ?? vocab.pos ?? null,
          vocab.meaning_zh || vocab.translation || '',
          vocab.example_en ?? null,
          vocab.example_zh ?? null,
          vocab.cefr_level ?? null,
          vocab.source_article_id ?? null,
          vocab.source ?? '手动添加',
          now, // 新单词立即可以复习
          now,
        ]
      );
      saveDatabase();
      return this.getById(id) || null;
    } catch (error) {
      logger.error('Failed to create vocabulary', { error: String(error) });
      return null;
    }
  },

  // 基于 FSRS 算法更新复习数据
  // quality: 1-4 评分（1=Again, 2=Hard, 3=Good, 4=Easy）
  updateReviewData(id: string, reviewData: {
    quality: number;
    efFactor?: number;
    intervalDays?: number;
    repetitionCount?: number;
    isMastered?: boolean;
  }): Record<string, unknown> | null {
    try {
      const vocab = this.getById(id);
      if (!vocab) return null;

      // Map quality 1-5 to Rating 1-4
      const ratingMap: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 3, 5: 4 };
      const fsrsRating = ratingMap[reviewData.quality] ?? 3;

      const result = reviewVocabulary(
        {
          efFactor: reviewData.efFactor ?? (vocab.ef_factor as number) ?? 2.5,
          intervalDays: reviewData.intervalDays ?? (vocab.interval_days as number) ?? 0,
          repetitionCount: reviewData.repetitionCount ?? (vocab.repetition_count as number) ?? 0,
          learningStage: (vocab.learning_stage as number) ?? 0,
          familiarityLevel: (vocab.familiarity_level as number) ?? 0,
        },
        fsrsRating
      );

      const isMastered = reviewData.isMastered ?? result.isMastered;

      getDatabase().run(
        `UPDATE vocabulary SET
          review_count = review_count + 1,
          last_review_at = datetime('now'),
          next_review_at = ?,
          ef_factor = ?,
          interval_days = ?,
          repetition_count = ?,
          is_mastered = ?,
          familiarity_level = ?,
          learning_stage = ?
         WHERE id = ?`,
        [
          result.nextReviewAt,
          result.efFactor,
          result.intervalDays,
          result.repetitionCount,
          isMastered ? 1 : 0,
          result.familiarityLevel,
          result.learningStage,
          id,
        ]
      );
      saveDatabase();
      return this.getById(id) || null;
    } catch (error) {
      logger.error('Failed to update review data', { error: String(error) });
      return null;
    }
  },

  markAsMastered(id: string): void {
    getDatabase().run('UPDATE vocabulary SET is_mastered = 1 WHERE id = ?', [id]);
    saveDatabase();
  },

  incrementReviewCount(id: string): void {
    getDatabase().run(
      "UPDATE vocabulary SET review_count = review_count + 1, last_review_at = datetime('now') WHERE id = ?",
      [id]
    );
    saveDatabase();
  },

  delete(id: string): void {
    getDatabase().run('DELETE FROM vocabulary WHERE id = ?', [id]);
    saveDatabase();
  },

  count(): number {
    const result = getDatabase().exec('SELECT COUNT(*) FROM vocabulary');
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },

  getMasteredCount(): number {
    const result = getDatabase().exec('SELECT COUNT(*) FROM vocabulary WHERE is_mastered = 1');
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },

  // 搜索单词
  search(keyword: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM vocabulary WHERE word LIKE ? OR meaning_zh LIKE ? ORDER BY created_at DESC',
      [`%${keyword}%`, `%${keyword}%`]
    );
    return rowsToObjects(result);
  },
};

export const reviewsDb = {
  create(cardId: string, rating: Rating): { reviewId: string; card: Card } {
    const card = cardsDb.getById(cardId);
    if (!card) throw new Error('Card not found');

    const newCard = reviewCard(card, rating);
    cardsDb.update(newCard);

    const reviewId = `review_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    getDatabase().run(
      `INSERT INTO reviews (id, card_id, rating, elapsed_days, scheduled_days)
       VALUES (?, ?, ?, ?, ?)`,
      [reviewId, cardId, rating, newCard.elapsedDays, newCard.scheduledDays]
    );
    saveDatabase();

    return { reviewId, card: newCard };
  },

  getByCardId(cardId: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM reviews WHERE card_id = ? ORDER BY review_time DESC',
      [cardId]
    );
    return rowsToObjects(result);
  },

  getRecent(limit: number = 50): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM reviews ORDER BY review_time DESC LIMIT ?',
      [limit]
    );
    return rowsToObjects(result);
  },
};

export const bookSummariesDb = {
  getByBookId(bookId: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec(
      'SELECT * FROM book_summaries WHERE book_id = ?',
      [bookId]
    );
    const rows = rowsToObjects(result);
    return rows[0];
  },

  create(bookId: string, summary: string, keyPoints?: string): void {
    const id = `summary_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    getDatabase().run(
      'INSERT OR REPLACE INTO book_summaries (id, book_id, summary, key_points) VALUES (?, ?, ?, ?)',
      [id, bookId, summary, keyPoints ?? null]
    );
    saveDatabase();
  },

  delete(bookId: string): void {
    getDatabase().run('DELETE FROM book_summaries WHERE book_id = ?', [bookId]);
    saveDatabase();
  },
};

export const dailyStatsDb = {
  getToday(): Record<string, unknown> | undefined {
    const today = new Date().toISOString().split('T')[0];
    const result = getDatabase().exec('SELECT * FROM daily_stats WHERE date = ?', [today]);
    const rows = rowsToObjects(result);
    return rows[0];
  },

  getRange(startDate: string, endDate: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM daily_stats WHERE date BETWEEN ? AND ? ORDER BY date ASC',
      [startDate, endDate]
    );
    return rowsToObjects(result);
  },

  incrementBooksRead(): void {
    const today = new Date().toISOString().split('T')[0];
    getDatabase().run(
      `INSERT INTO daily_stats (id, date, books_read) VALUES (?, ?, 1)
       ON CONFLICT(date) DO UPDATE SET books_read = books_read + 1`,
      [`daily_${today}`, today]
    );
    saveDatabase();
  },

  incrementHighlightsAdded(count: number = 1): void {
    const today = new Date().toISOString().split('T')[0];
    getDatabase().run(
      `INSERT INTO daily_stats (id, date, highlights_added) VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET highlights_added = highlights_added + ?`,
      [`daily_${today}`, today, count, count]
    );
    saveDatabase();
  },

  incrementCardsReviewed(count: number = 1): void {
    const today = new Date().toISOString().split('T')[0];
    getDatabase().run(
      `INSERT INTO daily_stats (id, date, cards_reviewed) VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET cards_reviewed = cards_reviewed + ?`,
      [`daily_${today}`, today, count, count]
    );
    saveDatabase();
  },

  addReadingTime(seconds: number): void {
    const today = new Date().toISOString().split('T')[0];
    getDatabase().run(
      `INSERT INTO daily_stats (id, date, reading_time) VALUES (?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET reading_time = reading_time + ?`,
      [`daily_${today}`, today, seconds, seconds]
    );
    saveDatabase();
  },
};

export const tokenUsageDb = {
  create(usage: {
    provider: string;
    model: string;
    feature: string;
    inputTokens: number;
    outputTokens: number;
    durationMs?: number;
  }): void {
    const id = `token_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const totalTokens = usage.inputTokens + usage.outputTokens;
    getDatabase().run(
      `INSERT INTO token_usage (id, provider, model, feature, input_tokens, output_tokens, total_tokens, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        usage.provider,
        usage.model,
        usage.feature,
        usage.inputTokens,
        usage.outputTokens,
        totalTokens,
        usage.durationMs || 0,
      ]
    );
    saveDatabase();
  },

  getByDateRange(startDate: string, endDate: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      `SELECT * FROM token_usage 
       WHERE date(created_at) BETWEEN ? AND ? 
       ORDER BY created_at DESC`,
      [startDate, endDate]
    );
    return rowsToObjects(result);
  },

  getRecent(limit: number = 100): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM token_usage ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    return rowsToObjects(result);
  },

  getStatsByProvider(): Record<string, unknown>[] {
    const result = getDatabase().exec(`
      SELECT 
        provider,
        model,
        COUNT(*) as request_count,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(total_tokens) as total_tokens,
        SUM(duration_ms) as total_duration_ms
      FROM token_usage
      GROUP BY provider, model
      ORDER BY total_tokens DESC
    `);
    return rowsToObjects(result);
  },

  getStatsByFeature(): Record<string, unknown>[] {
    const result = getDatabase().exec(`
      SELECT 
        feature,
        COUNT(*) as request_count,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(total_tokens) as total_tokens,
        SUM(duration_ms) as total_duration_ms,
        AVG(duration_ms) as avg_duration_ms
      FROM token_usage
      GROUP BY feature
      ORDER BY total_tokens DESC
    `);
    return rowsToObjects(result);
  },

  getDailyStats(days: number = 7): Record<string, unknown>[] {
    const result = getDatabase().exec(`
      SELECT 
        date(created_at) as date,
        COUNT(*) as request_count,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(total_tokens) as total_tokens
      FROM token_usage
      WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY date(created_at)
      ORDER BY date DESC
    `);
    return rowsToObjects(result);
  },

  getTotalStats(): {
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
  } {
    const execScalar = (sql: string): number => {
      const result = getDatabase().exec(sql);
      return result.length > 0 ? (result[0].values[0][0] as number) : 0;
    };

    return {
      totalRequests: execScalar('SELECT COUNT(*) FROM token_usage'),
      totalInputTokens: execScalar('SELECT COALESCE(SUM(input_tokens), 0) FROM token_usage'),
      totalOutputTokens: execScalar('SELECT COALESCE(SUM(output_tokens), 0) FROM token_usage'),
      totalTokens: execScalar('SELECT COALESCE(SUM(total_tokens), 0) FROM token_usage'),
    };
  },

  deleteOlderThan(days: number): void {
    getDatabase().run(
      `DELETE FROM token_usage WHERE created_at < datetime('now', '-${days} days')`
    );
    saveDatabase();
  },

  clearAll(): void {
    getDatabase().run('DELETE FROM token_usage');
    forceSaveDatabase();
    logger.info('All token usage records cleared');
  },
};

export const conversationDb = {
  create(title?: string, bookId?: string): Record<string, unknown> {
    const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const defaultTitle = title || '新对话';
    getDatabase().run(
      'INSERT INTO conversations (id, title, book_id) VALUES (?, ?, ?)',
      [id, defaultTitle, bookId ?? null]
    );
    saveDatabase();
    return { id, title: defaultTitle, book_id: bookId ?? null, message_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  },

  getAll(): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM conversations ORDER BY updated_at DESC'
    );
    return rowsToObjects(result);
  },

  getById(id: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec(
      'SELECT * FROM conversations WHERE id = ?', [id]
    );
    const rows = rowsToObjects(result);
    return rows[0];
  },

  update(id: string, data: Record<string, unknown>): void {
    const updatableKeys = Object.keys(data).filter(k => k !== 'id');
    const setClauses = updatableKeys.map(k => `${k} = ?`).join(', ');
    const values = updatableKeys.map(k => data[k]);
    getDatabase().run(
      `UPDATE conversations SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    );
    saveDatabase();
  },

  delete(id: string): void {
    getDatabase().run('DELETE FROM chat_messages WHERE conversation_id = ?', [id]);
    getDatabase().run('DELETE FROM conversations WHERE id = ?', [id]);
    saveDatabase();
  },

  addMessage(conversationId: string, message: Record<string, unknown>): void {
    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    getDatabase().run(
      `INSERT INTO chat_messages (id, conversation_id, role, content, intent, tools_used, bloom_level, mastery_assessment, sources)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        conversationId,
        message.role,
        message.content,
        message.intent ?? null,
        message.tools_used ? JSON.stringify(message.tools_used) : null,
        message.bloom_level ?? null,
        message.mastery_assessment ? JSON.stringify(message.mastery_assessment) : null,
        message.sources ? JSON.stringify(message.sources) : null,
      ]
    );
    getDatabase().run(
      "UPDATE conversations SET message_count = message_count + 1, updated_at = datetime('now') WHERE id = ?",
      [conversationId]
    );
    saveDatabase();
  },

  getMessages(conversationId: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversationId]
    );
    return rowsToObjects(result);
  },

  search(keyword: string): Record<string, unknown>[] {
    const pattern = `%${keyword}%`;
    const result = getDatabase().exec(
      `SELECT DISTINCT c.* FROM conversations c
       JOIN chat_messages m ON c.id = m.conversation_id
       WHERE c.title LIKE ? OR m.content LIKE ?
       ORDER BY c.updated_at DESC`,
      [pattern, pattern]
    );
    return rowsToObjects(result);
  },
};

export const methodologiesDb = {
  create(methodology: Record<string, unknown>): void {
    getDatabase().run(
      `INSERT INTO methodologies (id, book_id, name, name_en, trigger_scenario, description, steps, output_format, examples, tags, source_highlight_ids, mastery_level, practice_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        methodology.id,
        methodology.book_id ?? methodology.bookId,
        methodology.name,
        methodology.name_en ?? methodology.nameEn ?? null,
        methodology.trigger_scenario ?? methodology.triggerScenario ?? null,
        methodology.description ?? null,
        methodology.steps ? JSON.stringify(methodology.steps) : null,
        methodology.output_format ?? methodology.outputFormat ?? null,
        methodology.examples ?? null,
        methodology.tags ? JSON.stringify(methodology.tags) : null,
        methodology.source_highlight_ids ?? methodology.sourceHighlightIds ? JSON.stringify(methodology.source_highlight_ids ?? methodology.sourceHighlightIds) : null,
        methodology.mastery_level ?? methodology.masteryLevel ?? 0,
        methodology.practice_count ?? methodology.practiceCount ?? 0,
      ]
    );
    saveDatabase();
  },

  getById(id: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec('SELECT * FROM methodologies WHERE id = ?', [id]);
    const rows = rowsToObjects(result);
    return rows[0];
  },

  getByBookId(bookId: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM methodologies WHERE book_id = ? ORDER BY updated_at DESC',
      [bookId]
    );
    return rowsToObjects(result);
  },

  getAll(): Record<string, unknown>[] {
    const result = getDatabase().exec(
      `SELECT m.*, b.title as book_title FROM methodologies m
       JOIN books b ON m.book_id = b.id
       ORDER BY m.updated_at DESC`
    );
    return rowsToObjects(result);
  },

  update(id: string, methodology: Record<string, unknown>): void {
    const updatableKeys = Object.keys(methodology).filter(k => k !== 'id');
    const setClauses = updatableKeys.map(k => `${k} = ?`).join(', ');
    const values = updatableKeys.map(k => {
      const val = methodology[k];
      if (Array.isArray(val)) return JSON.stringify(val);
      return val;
    });
    getDatabase().run(
      `UPDATE methodologies SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    );
    saveDatabase();
  },

  delete(id: string): void {
    getDatabase().run('DELETE FROM methodologies WHERE id = ?', [id]);
    saveDatabase();
  },

  search(keyword: string): Record<string, unknown>[] {
    const pattern = `%${keyword}%`;
    const result = getDatabase().exec(
      `SELECT m.*, b.title as book_title FROM methodologies m
       JOIN books b ON m.book_id = b.id
       WHERE m.name LIKE ? OR m.description LIKE ? OR m.tags LIKE ?`,
      [pattern, pattern, pattern]
    );
    return rowsToObjects(result);
  },
};

export const knowledgeCardsDb = {
  create(card: Record<string, unknown>): void {
    getDatabase().run(
      `INSERT INTO knowledge_cards (id, book_id, type, title, content, interpretation, application, related_card_ids, tags, source_highlight_id, review_count, mastery_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        card.id,
        card.book_id ?? card.bookId,
        card.type,
        card.title,
        card.content,
        card.interpretation ?? null,
        card.application ?? null,
        card.related_card_ids ?? card.relatedCardIds ? JSON.stringify(card.related_card_ids ?? card.relatedCardIds) : null,
        card.tags ? JSON.stringify(card.tags) : null,
        card.source_highlight_id ?? card.sourceHighlightId ?? null,
        card.review_count ?? card.reviewCount ?? 0,
        card.mastery_level ?? card.masteryLevel ?? 0,
      ]
    );
    saveDatabase();
  },

  getById(id: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec('SELECT * FROM knowledge_cards WHERE id = ?', [id]);
    const rows = rowsToObjects(result);
    return rows[0];
  },

  getByBookId(bookId: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM knowledge_cards WHERE book_id = ? ORDER BY updated_at DESC',
      [bookId]
    );
    return rowsToObjects(result);
  },

  getByType(type: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM knowledge_cards WHERE type = ? ORDER BY updated_at DESC',
      [type]
    );
    return rowsToObjects(result);
  },

  getAll(): Record<string, unknown>[] {
    const result = getDatabase().exec(
      `SELECT k.*, b.title as book_title FROM knowledge_cards k
       JOIN books b ON k.book_id = b.id
       ORDER BY k.updated_at DESC`
    );
    return rowsToObjects(result);
  },

  update(id: string, card: Record<string, unknown>): void {
    const fieldMap: Record<string, string> = {
      bookId: 'book_id',
      relatedCardIds: 'related_card_ids',
      sourceHighlightId: 'source_highlight_id',
      reviewCount: 'review_count',
      masteryLevel: 'mastery_level',
    };
    const updatableKeys = Object.keys(card).filter(k => k !== 'id');
    const setClauses = updatableKeys.map(k => `${fieldMap[k] ?? k} = ?`).join(', ');
    const values = updatableKeys.map(k => {
      const val = card[k];
      if (Array.isArray(val)) return JSON.stringify(val);
      return val;
    });
    getDatabase().run(
      `UPDATE knowledge_cards SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    );
    saveDatabase();
  },

  delete(id: string): void {
    getDatabase().run('DELETE FROM knowledge_cards WHERE id = ?', [id]);
    saveDatabase();
  },

  search(keyword: string): Record<string, unknown>[] {
    const pattern = `%${keyword}%`;
    const result = getDatabase().exec(
      `SELECT k.*, b.title as book_title FROM knowledge_cards k
       JOIN books b ON k.book_id = b.id
       WHERE k.title LIKE ? OR k.content LIKE ? OR k.tags LIKE ?`,
      [pattern, pattern, pattern]
    );
    return rowsToObjects(result);
  },
};

export const bookArchitectureDb = {
  create(architecture: Record<string, unknown>): void {
    getDatabase().run(
      `INSERT INTO book_architecture (id, book_id, core_proposition, cognitive_framework, methodology_architecture, knowledge_hierarchy, target_audience)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        architecture.id,
        architecture.book_id ?? architecture.bookId,
        architecture.core_proposition ?? architecture.coreProposition ?? null,
        architecture.cognitive_framework ?? architecture.cognitiveFramework ? JSON.stringify(architecture.cognitive_framework ?? architecture.cognitiveFramework) : null,
        architecture.methodology_architecture ?? architecture.methodologyArchitecture ? JSON.stringify(architecture.methodology_architecture ?? architecture.methodologyArchitecture) : null,
        architecture.knowledge_hierarchy ?? architecture.knowledgeHierarchy ? JSON.stringify(architecture.knowledge_hierarchy ?? architecture.knowledgeHierarchy) : null,
        architecture.target_audience ?? architecture.targetAudience ?? null,
      ]
    );
    saveDatabase();
  },

  getById(id: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec('SELECT * FROM book_architecture WHERE id = ?', [id]);
    const rows = rowsToObjects(result);
    return rows[0];
  },

  getByBookId(bookId: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec(
      'SELECT * FROM book_architecture WHERE book_id = ?',
      [bookId]
    );
    const rows = rowsToObjects(result);
    return rows[0];
  },

  update(id: string, architecture: Record<string, unknown>): void {
    const updatableKeys = Object.keys(architecture).filter(k => k !== 'id');
    const setClauses = updatableKeys.map(k => `${k} = ?`).join(', ');
    const values = updatableKeys.map(k => {
      const val = architecture[k];
      if (typeof val === 'object' && val !== null) return JSON.stringify(val);
      return val;
    });
    getDatabase().run(
      `UPDATE book_architecture SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    );
    saveDatabase();
  },

  delete(id: string): void {
    getDatabase().run('DELETE FROM book_architecture WHERE id = ?', [id]);
    saveDatabase();
  },
};

export const memoriesDb = {
  create(memory: {
    type: string;
    category: string;
    content: string;
    importance?: number;
    context?: string;
  }): void {
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    getDatabase().run(
      `INSERT INTO memories (id, type, category, content, importance, context)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        memory.type,
        memory.category,
        memory.content,
        memory.importance ?? 0.5,
        memory.context ?? null,
      ]
    );
    saveDatabase();
  },

  getAll(): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM memories ORDER BY importance DESC, created_at DESC'
    );
    return rowsToObjects(result);
  },

  getRelevant(queryTerms: string[], limit: number = 10): Record<string, unknown>[] {
    if (queryTerms.length === 0) return [];
    const conditions = queryTerms.map(() => '(content LIKE ? OR category LIKE ?)').join(' OR ');
    const params: string[] = [];
    for (const term of queryTerms) {
      params.push(`%${term}%`, `%${term}%`);
    }
    params.push(String(limit));
    const result = getDatabase().exec(
      `SELECT * FROM memories WHERE ${conditions} ORDER BY importance DESC LIMIT ?`,
      params
    );
    return rowsToObjects(result);
  },

  incrementAccess(id: string): void {
    getDatabase().run(
      `UPDATE memories SET access_count = access_count + 1, last_accessed_at = datetime('now') WHERE id = ?`,
      [id]
    );
    saveDatabase();
  },

  getStats(): { total: number; byType: Record<string, number> } {
    const totalResult = getDatabase().exec('SELECT COUNT(*) FROM memories');
    const total = totalResult.length > 0 ? (totalResult[0].values[0][0] as number) : 0;

    const typeResult = getDatabase().exec('SELECT type, COUNT(*) as cnt FROM memories GROUP BY type');
    const byType: Record<string, number> = {};
    if (typeResult.length > 0) {
      for (const row of typeResult[0].values) {
        byType[row[0] as string] = row[1] as number;
      }
    }
    return { total, byType };
  },

  deleteOldestBeyond(maxCount: number): void {
    const count = getDatabase().exec('SELECT COUNT(*) FROM memories');
    const total = count.length > 0 ? (count[0].values[0][0] as number) : 0;
    if (total > maxCount) {
      getDatabase().run(
        `DELETE FROM memories WHERE id IN (
          SELECT id FROM memories ORDER BY importance ASC, last_accessed_at ASC LIMIT ?
        )`,
        [total - maxCount]
      );
      saveDatabase();
    }
  },

  clearAll(): void {
    getDatabase().run('DELETE FROM memories');
    forceSaveDatabase();
  },
};
