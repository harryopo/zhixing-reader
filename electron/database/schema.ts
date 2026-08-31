/**
 * database/schema — 建表、初始化、幂等迁移与数据清理
 * 从原 database.ts（2400+ 行）拆分而来，逻辑保持不变。
 *
 * 注意：initializeSchema 是唯一的建表来源（2026-08-30 合并双轨 DDL），
 * initDatabase 加载库文件后调用它，再执行幂等迁移。
 */
import initSqlJs from 'sql.js';
import * as fs from 'fs';
import { logger } from '../logger';
import { rowsToObjects } from '../utils/db';
import { getDatabasePath, getDatabase, setDatabase, saveDatabase, runTransaction } from './connection';

export function initializeSchema(db: import('sql.js').Database): void {
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
      source TEXT DEFAULT 'weread',
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
      liked INTEGER DEFAULT 0,
      bookmarked INTEGER DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
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
      is_mastered INTEGER DEFAULT 0,
      review_count INTEGER DEFAULT 0,
      last_review_at TEXT,
      next_review_at TEXT,
      ef_factor REAL DEFAULT 2.5,
      interval_days INTEGER DEFAULT 0,
      repetition_count INTEGER DEFAULT 0,
      familiarity_level INTEGER DEFAULT 0,
      learning_stage INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_article_id) REFERENCES articles(id) ON DELETE SET NULL
    );
  `);

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
  db.run('CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);');
  db.run('CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);');
}

export async function initDatabase(): Promise<void> {
  const SQL = await initSqlJs();
  const dbPath = getDatabasePath();

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    setDatabase(new SQL.Database(fileBuffer));
  } else {
    setDatabase(new SQL.Database());
  }

  const db = getDatabase();

  // 建表与索引：单一来源，与测试/外部脚本共用同一份 schema 定义
  initializeSchema(db);

  // 数据库迁移：为 cards 表新增应用标签和掌握度字段
  migrateCardsTable();

  // 数据库迁移：为 books 表新增 source 字段（区分微信读书/本地导入）
  migrateBooksTable();

  // 数据库迁移：为 chat_messages 表新增 liked / bookmarked 字段（点赞/收藏）
  migrateChatMessagesTable();

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

// books 表迁移：添加 source 字段（区分微信读书/本地导入）
// 旧数据无该列时默认 'weread'，保证"在微信读书打开"按钮的兼容性
function migrateBooksTable(): void {
  try {
    const database = getDatabase();
    const cols = database.exec("PRAGMA table_info(books)");
    const colNames = rowsToObjects(cols).map((c: Record<string, unknown>) => c.name as string);

    if (!colNames.includes('source')) {
      database.run("ALTER TABLE books ADD COLUMN source TEXT DEFAULT 'weread'");
      logger.info('Migration: added source column to books table');
    }
  } catch (error) {
    logger.error('Migration failed for books table', { error: String(error) });
  }
}

// chat_messages 表迁移：添加 liked / bookmarked 字段（点赞/收藏功能）
// SQLite 无原生 BOOLEAN，用 INTEGER 0/1 表示（参考 skill: type affinity）
function migrateChatMessagesTable(): void {
  try {
    const database = getDatabase();
    const cols = database.exec("PRAGMA table_info(chat_messages)");
    const colNames = rowsToObjects(cols).map((c: Record<string, unknown>) => c.name as string);

    if (!colNames.includes('liked')) {
      database.run("ALTER TABLE chat_messages ADD COLUMN liked INTEGER DEFAULT 0");
      logger.info('Migration: added liked column to chat_messages table');
    }
    if (!colNames.includes('bookmarked')) {
      database.run("ALTER TABLE chat_messages ADD COLUMN bookmarked INTEGER DEFAULT 0");
      logger.info('Migration: added bookmarked column to chat_messages table');
    }
  } catch (error) {
    logger.error('Migration failed for chat_messages table', { error: String(error) });
  }
}

/**
 * 清空对话历史（conversations + chat_messages 表）
 * 保留表结构与 schema，仅删除数据。
 */
export function clearConversationsAndMessages(): void {
  runTransaction((database) => {
    database.run('DELETE FROM chat_messages');
    database.run('DELETE FROM conversations');
  });
  logger.info('Cleared all conversations and chat messages');
}

/**
 * 重置数据库：清空所有业务表数据，保留 schema。
 * 关闭外键检查避免级联约束干扰，清空后重新落盘。
 */
export function resetDatabase(): void {
  const database = getDatabase();
  // 关闭 FK 检查以避免删除顺序约束
  database.run('PRAGMA foreign_keys = OFF');
  try {
    const tables = [
      'chat_messages',
      'conversations',
      'reviews',
      'cards',
      'highlights',
      'book_summaries',
      'daily_stats',
      'token_usage',
      'methodologies',
      'knowledge_cards',
      'book_architecture',
      'articles',
      'vocabulary',
      'memories',
      'books',
    ];
    runTransaction((db) => {
      for (const table of tables) {
        db.run(`DELETE FROM ${table}`);
      }
    });
    logger.info('Database reset: all tables cleared');
  } finally {
    database.run('PRAGMA foreign_keys = ON');
  }
}
