import initSqlJs, { Database } from 'sql.js'
import { injectTestDatabase, resetTestDatabaseState } from '../../electron/database'

export async function createTestDatabase(): Promise<Database> {
  const SQL = await initSqlJs()
  return new SQL.Database()
}

export function runSchema(db: Database): void {
  db.run('PRAGMA foreign_keys = ON;')

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
  `)

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
  `)

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
      application_tag TEXT,
      mastery_level INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (highlight_id) REFERENCES highlights(id) ON DELETE CASCADE
    );
  `)

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
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS book_summaries (
      id TEXT PRIMARY KEY,
      book_id TEXT NOT NULL UNIQUE,
      summary TEXT NOT NULL,
      key_points TEXT,
      generated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );
  `)

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
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS token_usage (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      model TEXT NOT NULL,
      feature TEXT NOT NULL,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      cached_tokens INTEGER DEFAULT 0,
      cost_usd REAL DEFAULT 0,
      duration_ms INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    );
  `)

  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '',
      book_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      message_count INTEGER NOT NULL DEFAULT 0
    );
  `)

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
  `)

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
  `)

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
  `)

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
  `)

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
      source_website TEXT,
      category TEXT DEFAULT 'psychology',
      difficulty TEXT DEFAULT 'cet4',
      vocabulary_json TEXT,
      is_read INTEGER DEFAULT 0,
      is_favorite INTEGER DEFAULT 0,
      read_time INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      published_at TEXT
    );
  `)

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
  `)

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
  `)

  db.run('CREATE INDEX IF NOT EXISTS idx_highlights_book_id ON highlights(book_id);')
  db.run('CREATE INDEX IF NOT EXISTS idx_cards_highlight_id ON cards(highlight_id);')
  db.run('CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due);')
  db.run('CREATE INDEX IF NOT EXISTS idx_reviews_card_id ON reviews(card_id);')
  db.run('CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);')
  db.run('CREATE INDEX IF NOT EXISTS idx_messages_conversation ON chat_messages(conversation_id);')
  db.run('CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);')
  db.run('CREATE INDEX IF NOT EXISTS idx_methodologies_book_id ON methodologies(book_id);')
  db.run('CREATE INDEX IF NOT EXISTS idx_knowledge_cards_book_id ON knowledge_cards(book_id);')
  db.run('CREATE INDEX IF NOT EXISTS idx_knowledge_cards_type ON knowledge_cards(type);')
  db.run('CREATE INDEX IF NOT EXISTS idx_book_architecture_book_id ON book_architecture(book_id);')
  db.run('CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source);')
  db.run('CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at);')
  db.run('CREATE INDEX IF NOT EXISTS idx_articles_difficulty ON articles(difficulty);')
  db.run('CREATE INDEX IF NOT EXISTS idx_vocabulary_word ON vocabulary(word);')
  db.run('CREATE INDEX IF NOT EXISTS idx_vocabulary_mastered ON vocabulary(is_mastered);')
  db.run('CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);')
  db.run('CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);')
}

export async function setupTestDatabase(): Promise<Database> {
  const testDb = await createTestDatabase()
  runSchema(testDb)
  injectTestDatabase(testDb)
  return testDb
}

export function teardownTestDatabase(): void {
  resetTestDatabaseState()
}
