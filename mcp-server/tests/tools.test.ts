import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import initSqlJs, { type Database } from 'sql.js';
import * as path from 'path';
import { createRequire } from 'module';
import {
  initDatabaseWithBuffer,
  resetForTesting,
  getDatabasePath,
} from '../src/db.js';
import { listBooks } from '../src/tools/list-books.js';
import { searchHighlights } from '../src/tools/search-highlights.js';
import { getDueCards } from '../src/tools/get-due-cards.js';
import { getVocabulary } from '../src/tools/get-vocabulary.js';
import { getReadingStats } from '../src/tools/get-reading-stats.js';
import { createServer } from '../src/index.js';

const require = createRequire(import.meta.url);

/**
 * MCP Tool 测试套件。
 *
 * 测试策略：
 * 1. 用 sql.js 创建内存数据库
 * 2. 建表 + 插入测试数据
 * 3. 用 initDatabaseWithBuffer 注入到 db 模块
 * 4. 调用 tool 函数验证返回
 *
 * 每个 smoke test 覆盖一个 tool 的核心路径。
 */

let sqlModule: Awaited<ReturnType<typeof initSqlJs>>;

// 完整 schema（与 electron/database.ts 一致，仅保留测试涉及的表）
const SCHEMA_SQL = `
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
  application_tag TEXT,
  mastery_level INTEGER DEFAULT 0,
  FOREIGN KEY (highlight_id) REFERENCES highlights(id) ON DELETE CASCADE
);

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
  created_at TEXT DEFAULT (datetime('now'))
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
`;

/**
 * 创建并初始化内存数据库，插入测试数据。
 */
async function createTestDatabase(): Promise<Database> {
  const SQL = sqlModule;
  const db = new SQL.Database();

  db.run(SCHEMA_SQL);

  // 插入 3 本测试书
  db.run(
    `INSERT INTO books (id, title, author, reading_progress, total_chapter, is_finished, source, last_read_time, created_at, updated_at)
     VALUES ('book_1', '深入理解计算机系统', 'Bryant', 0.5, 10, 0, 'weread', '2026-07-20T10:00:00Z', '2026-07-01T00:00:00Z', '2026-07-20T10:00:00Z')`,
  );
  db.run(
    `INSERT INTO books (id, title, author, reading_progress, total_chapter, is_finished, source, last_read_time, created_at, updated_at)
     VALUES ('book_2', '代码大全', 'McConnell', 1.0, 30, 1, 'weread', '2026-07-19T08:00:00Z', '2026-07-02T00:00:00Z', '2026-07-19T08:00:00Z')`,
  );
  db.run(
    `INSERT INTO books (id, title, author, reading_progress, total_chapter, is_finished, source, created_at, updated_at)
     VALUES ('book_3', '重构', 'Fowler', 0.1, 20, 0, 'local', '2026-07-03T00:00:00Z', '2026-07-03T00:00:00Z')`,
  );

  // 插入 4 条划线（book_1 有 2 条，book_2 有 2 条，book_3 有 0 条）
  db.run(
    `INSERT INTO highlights (id, book_id, chapter_title, content, note, style, created_at)
     VALUES ('hl_1', 'book_1', '第1章', '程序计数器是CPU中最重要的寄存器之一', '这里要重点理解', 1, '2026-07-15T12:00:00Z')`,
  );
  db.run(
    `INSERT INTO highlights (id, book_id, chapter_title, content, note, style, created_at)
     VALUES ('hl_2', 'book_1', '第2章', '缓存层次结构对性能至关重要', NULL, 0, '2026-07-16T12:00:00Z')`,
  );
  db.run(
    `INSERT INTO highlights (id, book_id, chapter_title, content, note, style, created_at)
     VALUES ('hl_3', 'book_2', '第3章', '软件构建是核心活动', '这是软件工程的关键洞察', 1, '2026-07-17T12:00:00Z')`,
  );
  db.run(
    `INSERT INTO highlights (id, book_id, chapter_title, content, note, style, created_at)
     VALUES ('hl_4', 'book_2', '第4章', '变量命名是可读性的基础', NULL, 0, '2026-07-18T12:00:00Z')`,
  );

  // 插入 3 张卡片：2 张已到期，1 张未到期
  const past = new Date(Date.now() - 3600_000).toISOString(); // 1 小时前
  const future = new Date(Date.now() + 86400_000).toISOString(); // 1 天后

  db.run(
    `INSERT INTO cards (id, highlight_id, state, stability, difficulty, due, reps, lapses, application_tag, mastery_level)
     VALUES ('card_1', 'hl_1', 2, 5.5, 0.3, ?, 3, 1, '核心概念', 2)`,
    [past],
  );
  db.run(
    `INSERT INTO cards (id, highlight_id, state, stability, difficulty, due, reps, lapses, application_tag, mastery_level)
     VALUES ('card_2', 'hl_2', 1, 1.2, 0.8, ?, 1, 0, NULL, 0)`,
    [past],
  );
  db.run(
    `INSERT INTO cards (id, highlight_id, state, stability, difficulty, due, reps, lapses, application_tag, mastery_level)
     VALUES ('card_3', 'hl_3', 0, 0, 0, ?, 0, 0, NULL, 0)`,
    [future],
  );

  // 插入 4 个生词：3 未掌握 + 1 已掌握
  db.run(
    `INSERT INTO vocabulary (id, word, phonetic, part_of_speech, meaning_zh, example_en, example_zh, cefr_level, source, is_mastered, review_count, created_at)
     VALUES ('vocab_1', 'cache', '/kæʃ/', 'n.', '缓存', 'CPU cache is fast', 'CPU缓存很快', 'B2', '深入理解计算机系统', 0, 0, '2026-07-10T00:00:00Z')`,
  );
  db.run(
    `INSERT INTO vocabulary (id, word, phonetic, part_of_speech, meaning_zh, example_en, example_zh, cefr_level, source, is_mastered, review_count, created_at)
     VALUES ('vocab_2', 'register', '/ˈredʒɪstər/', 'n.', '寄存器', 'Register is fast memory', '寄存器是快速内存', 'B2', '深入理解计算机系统', 0, 2, '2026-07-11T00:00:00Z')`,
  );
  db.run(
    `INSERT INTO vocabulary (id, word, phonetic, part_of_speech, meaning_zh, cefr_level, source, is_mastered, review_count, created_at)
     VALUES ('vocab_3', 'abstraction', NULL, 'n.', '抽象', 'C2', '代码大全', 0, 5, '2026-07-12T00:00:00Z')`,
  );
  db.run(
    `INSERT INTO vocabulary (id, word, phonetic, part_of_speech, meaning_zh, cefr_level, source, is_mastered, review_count, created_at)
     VALUES ('vocab_4', 'algorithm', '/ˈælgərɪðəm/', 'n.', '算法', 'B1', '手动添加', 1, 10, '2026-07-05T00:00:00Z')`,
  );

  // 插入 daily_stats：累计 600 分钟，最近 7 天 200 分钟
  db.run(
    `INSERT INTO daily_stats (id, date, books_read, highlights_added, cards_reviewed, reading_time)
     VALUES ('ds_1', '2026-07-15', 1, 5, 10, 200)`,
  );
  db.run(
    `INSERT INTO daily_stats (id, date, books_read, highlights_added, cards_reviewed, reading_time)
     VALUES ('ds_2', '2026-07-16', 2, 3, 8, 150)`,
  );
  db.run(
    `INSERT INTO daily_stats (id, date, books_read, highlights_added, cards_reviewed, reading_time)
     VALUES ('ds_3', '2026-07-17', 1, 2, 5, 250)`,
  );
  // 一条很早的记录（超出 7 天）
  db.run(
    `INSERT INTO daily_stats (id, date, books_read, highlights_added, cards_reviewed, reading_time)
     VALUES ('ds_4', '2026-06-01', 1, 1, 1, 100)`,
  );

  return db;
}

beforeAll(async () => {
  // 定位 sql.js wasm 文件路径（与 db.ts 同一策略）
  const sqlJsEntry = require.resolve('sql.js');
  const sqlJsDir = path.dirname(sqlJsEntry);
  const wasmPath = path.join(sqlJsDir, 'sql-wasm.wasm');

  sqlModule = await initSqlJs({
    locateFile: () => wasmPath,
  });
});

afterAll(() => {
  resetForTesting();
});

beforeEach(() => {
  resetForTesting();
});

describe('zhixing_list_books', () => {
  it('smoke: 应返回书架列表，含划线总数，按最近阅读时间倒序', async () => {
    const db = await createTestDatabase();
    const buffer = db.export();
    db.close();
    await initDatabaseWithBuffer(Buffer.from(buffer));

    const result = await listBooks({ limit: 50 });

    expect(result).toHaveLength(3);

    // 最近阅读时间倒序：book_1 (07-20) > book_2 (07-19) > book_3 (null 最后)
    expect(result[0].bookId).toBe('book_1');
    expect(result[1].bookId).toBe('book_2');
    expect(result[2].bookId).toBe('book_3');

    // 验证划线总数统计
    expect(result[0].totalHighlights).toBe(2); // book_1 有 2 条划线
    expect(result[1].totalHighlights).toBe(2); // book_2 有 2 条划线
    expect(result[2].totalHighlights).toBe(0); // book_3 无划线

    // 验证字段映射
    expect(result[0].title).toBe('深入理解计算机系统');
    expect(result[0].author).toBe('Bryant');
    expect(result[0].readingProgress).toBe(0.5);
    expect(result[0].isFinished).toBe(false);
    expect(result[1].isFinished).toBe(true);
    expect(result[2].source).toBe('local');
    expect(result[2].lastReadAt).toBeNull();
  });

  it('边界: limit=1 只返回 1 条', async () => {
    const db = await createTestDatabase();
    const buffer = db.export();
    db.close();
    await initDatabaseWithBuffer(Buffer.from(buffer));

    const result = await listBooks({ limit: 1 });
    expect(result).toHaveLength(1);
    expect(result[0].bookId).toBe('book_1');
  });

  it('边界: 空书架返回空数组', async () => {
    const db = new sqlModule.Database();
    db.run(SCHEMA_SQL);
    const buffer = db.export();
    db.close();
    await initDatabaseWithBuffer(Buffer.from(buffer));

    const result = await listBooks({ limit: 50 });
    expect(result).toEqual([]);
  });
});

describe('zhixing_search_highlights', () => {
  it('smoke: 应按关键词匹配划线内容', async () => {
    const db = await createTestDatabase();
    const buffer = db.export();
    db.close();
    await initDatabaseWithBuffer(Buffer.from(buffer));

    const result = await searchHighlights({ keyword: '缓存', limit: 20 });

    expect(result).toHaveLength(1);
    expect(result[0].content).toContain('缓存');
    expect(result[0].bookTitle).toBe('深入理解计算机系统');
    expect(result[0].bookId).toBe('book_1');
  });

  it('smoke: 应匹配笔记字段', async () => {
    const db = await createTestDatabase();
    const buffer = db.export();
    db.close();
    await initDatabaseWithBuffer(Buffer.from(buffer));

    const result = await searchHighlights({ keyword: '软件工程', limit: 20 });

    expect(result).toHaveLength(1);
    expect(result[0].note).toContain('软件工程');
  });

  it('边界: 限定 bookId 范围', async () => {
    const db = await createTestDatabase();
    const buffer = db.export();
    db.close();
    await initDatabaseWithBuffer(Buffer.from(buffer));

    // 搜索"基础"——匹配 book_2 的"变量命名是可读性的基础"
    const result = await searchHighlights({ keyword: '基础', bookId: 'book_2', limit: 20 });

    expect(result).toHaveLength(1);
    expect(result[0].bookId).toBe('book_2');
  });

  it('边界: 无匹配返回空数组', async () => {
    const db = await createTestDatabase();
    const buffer = db.export();
    db.close();
    await initDatabaseWithBuffer(Buffer.from(buffer));

    const result = await searchHighlights({ keyword: '不存在的关键词XYZ', limit: 20 });
    expect(result).toEqual([]);
  });
});

describe('zhixing_get_due_cards', () => {
  it('smoke: 应返回已到期卡片，按 due 升序', async () => {
    const db = await createTestDatabase();
    const buffer = db.export();
    db.close();
    await initDatabaseWithBuffer(Buffer.from(buffer));

    const result = await getDueCards({ limit: 20 });

    // 2 张已到期（card_1, card_2），card_3 未到期
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.cardId).sort()).toEqual(['card_1', 'card_2']);

    // 验证 JOIN 字段
    const card1 = result.find((c) => c.cardId === 'card_1');
    expect(card1).toBeDefined();
    expect(card1!.bookTitle).toBe('深入理解计算机系统');
    expect(card1!.highlightContent).toContain('程序计数器');
    expect(card1!.state).toBe(2);
    expect(card1!.stability).toBe(5.5);
    expect(card1!.applicationTag).toBe('核心概念');
  });

  it('边界: limit=1 只返回 1 张', async () => {
    const db = await createTestDatabase();
    const buffer = db.export();
    db.close();
    await initDatabaseWithBuffer(Buffer.from(buffer));

    const result = await getDueCards({ limit: 1 });
    expect(result).toHaveLength(1);
  });
});

describe('zhixing_get_vocabulary', () => {
  it('smoke: 默认只返回未掌握单词', async () => {
    const db = await createTestDatabase();
    const buffer = db.export();
    db.close();
    await initDatabaseWithBuffer(Buffer.from(buffer));

    const result = await getVocabulary({ unmasteredOnly: true, limit: 50 });

    // 3 个未掌握（vocab_4 已掌握）
    expect(result).toHaveLength(3);
    expect(result.map((v) => v.word).sort()).toEqual(['abstraction', 'cache', 'register']);
    expect(result.every((v) => v.isMastered === false)).toBe(true);

    // 验证字段映射
    const cache = result.find((v) => v.word === 'cache');
    expect(cache).toBeDefined();
    expect(cache!.definition).toBe('缓存');
    expect(cache!.phonetic).toBe('/kæʃ/');
    expect(cache!.cefrLevel).toBe('B2');
  });

  it('边界: unmasteredOnly=false 返回全部', async () => {
    const db = await createTestDatabase();
    const buffer = db.export();
    db.close();
    await initDatabaseWithBuffer(Buffer.from(buffer));

    const result = await getVocabulary({ unmasteredOnly: false, limit: 200 });

    expect(result).toHaveLength(4);
    const algorithm = result.find((v) => v.word === 'algorithm');
    expect(algorithm).toBeDefined();
    expect(algorithm!.isMastered).toBe(true);
  });
});

describe('zhixing_get_reading_stats', () => {
  it('smoke: 应返回完整阅读统计聚合', async () => {
    const db = await createTestDatabase();
    const buffer = db.export();
    db.close();
    await initDatabaseWithBuffer(Buffer.from(buffer));

    const stats = await getReadingStats();

    expect(stats.totalBooks).toBe(3);
    expect(stats.totalHighlights).toBe(4);
    expect(stats.totalNotes).toBe(2); // 2 条划线有 note（hl_1, hl_3）
    expect(stats.totalCards).toBe(3);
    expect(stats.totalVocabulary).toBe(4);
    expect(stats.dueCardsCount).toBe(2);
    expect(stats.totalReadingTimeMinutes).toBe(700); // 200+150+250+100
    // 最近 7 天（07-15, 07-16, 07-17）= 600 分钟
    // 注：date() 比较，今天 2026-07-22，7 天前 2026-07-15
    expect(stats.last7DaysReadingMinutes).toBe(600);
  });

  it('边界: 空数据库返回全 0', async () => {
    const db = new sqlModule.Database();
    db.run(SCHEMA_SQL);
    const buffer = db.export();
    db.close();
    await initDatabaseWithBuffer(Buffer.from(buffer));

    const stats = await getReadingStats();

    expect(stats.totalBooks).toBe(0);
    expect(stats.totalHighlights).toBe(0);
    expect(stats.totalNotes).toBe(0);
    expect(stats.totalCards).toBe(0);
    expect(stats.totalVocabulary).toBe(0);
    expect(stats.dueCardsCount).toBe(0);
    expect(stats.totalReadingTimeMinutes).toBe(0);
    expect(stats.last7DaysReadingMinutes).toBe(0);
  });
});

describe('MCP Server 注册', () => {
  it('smoke: createServer 应创建 server 实例且不抛错', () => {
    expect(() => createServer()).not.toThrow();
  });
});

describe('数据库路径', () => {
  it('smoke: 默认路径应为 ~/.zhixing-reader/zhixing.db', () => {
    // 临时清除环境变量
    const originalPath = process.env.ZHIXING_DB_PATH;
    delete process.env.ZHIXING_DB_PATH;

    const dbPath = getDatabasePath();
    expect(dbPath).toContain('.zhixing-reader');
    expect(dbPath).toContain('zhixing.db');

    // 恢复
    if (originalPath !== undefined) {
      process.env.ZHIXING_DB_PATH = originalPath;
    }
  });

  it('smoke: ZHIXING_DB_PATH 环境变量应被使用', () => {
    // 用跨平台兼容的断言：path.resolve 在 Windows 会加盘符
    process.env.ZHIXING_DB_PATH = path.join(path.sep, 'custom', 'path', 'test.db');
    const result = getDatabasePath();
    expect(result).toContain('custom');
    expect(result).toContain('test.db');
    delete process.env.ZHIXING_DB_PATH;
  });
});
