/**
 * 知行读书 — 演示数据 Seeder（独立 sql.js 实现）
 *
 * 目标：为录屏、PPT、PDF 演示生成完整可用的 demo.db，
 *      写满书架 / 划线 / 笔记 / 复习卡 / 知识卡 / AI 对话 / Token 监控数据。
 *
 * 设计原则：
 *   1. **独立运行**：不依赖 Electron / 不污染生产库，直接用 sql.js 写文件
 *   2. **幂等**：可重复执行；通过固定 id + INSERT OR REPLACE 实现
 *   3. **真实**：书名、作者、划线内容均来自真实出版物
 *   4. **schema 同步**：复刻 electron/database.ts 的所有 CREATE TABLE，确保 demo.db 与生产兼容
 *   5. **FSRS 真实算法**：调用 ts-fsrs 的 review() 走真实调度，状态分布自然
 *
 * 用法：
 *   npx tsx scripts/seed-demo-data.ts
 *   # 或
 *   npm run seed:demo
 *
 * 输出：resources/demo.db
 * 切换：copy resources/demo.db %APPDATA%\zhixing-reader\zhixing.db
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import initSqlJs, { Database, SqlJsStatic } from 'sql.js';
import {
  fsrs as createFsrs,
  generatorParameters,
  createEmptyCard,
  State as FsrsState,
  type Card as FsrsCard,
  Rating as FsrsRating,
} from 'ts-fsrs';

// ============================================================================
// 路径与常量
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const RESOURCES_DIR = path.join(PROJECT_ROOT, 'resources');
const WASM_DIR = path.join(PROJECT_ROOT, 'node_modules', 'sql.js', 'dist');
const OUTPUT_PATH = path.join(RESOURCES_DIR, 'demo.db');

const ID_PREFIX = {
  book: 'demo-book',
  highlight: 'demo-hl',
  card: 'demo-card',
  review: 'demo-rev',
  knowledge: 'demo-kc',
  conversation: 'demo-conv',
  message: 'demo-msg',
  memory: 'demo-mem',
  token: 'demo-tok',
  daily: 'demo-stat',
  article: 'demo-art',
  vocab: 'demo-vocab',
};

// 演示日（脚本生成时间）：2026-07-20
// 复习曲线：最近 7 天 (Day -6 ~ Day 0)
const DEMO_TODAY = '2026-07-20';
const DEMO_TODAY_ISO = `${DEMO_TODAY}T10:00:00.000Z`;

// 语义化时间（让 daily_stats 与 reviews 看起来"自然增长"）
function dateNDaysAgo(n: number, iso = false): string {
  const d = new Date(DEMO_TODAY_ISO);
  d.setUTCDate(d.getUTCDate() - n);
  return iso ? d.toISOString() : d.toISOString().split('T')[0];
}

function dateNHoursAgo(n: number): string {
  const d = new Date(DEMO_TODAY_ISO);
  d.setUTCHours(d.getUTCHours() - n);
  return d.toISOString();
}

function dateNMinutesFromNow(min: number): string {
  const d = new Date(DEMO_TODAY_ISO);
  d.setUTCMinutes(d.getUTCMinutes() + min);
  return d.toISOString();
}

function newId(prefix: keyof typeof ID_PREFIX, idx?: number): string {
  if (idx === undefined) {
    return `${ID_PREFIX[prefix]}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  }
  return `${ID_PREFIX[prefix]}-${String(idx).padStart(3, '0')}`;
}

// ============================================================================
// Schema（与 electron/database.ts 保持一致）
// ============================================================================

const SCHEMA_STATEMENTS = [
  `PRAGMA foreign_keys = ON;`,
  `CREATE TABLE IF NOT EXISTS books (
     id TEXT PRIMARY KEY, title TEXT NOT NULL, author TEXT, cover TEXT,
     isbn TEXT, publisher TEXT, publish_date TEXT, description TEXT,
     category TEXT, reading_progress REAL DEFAULT 0, total_chapter INTEGER DEFAULT 0,
     last_read_time TEXT, is_finished INTEGER DEFAULT 0,
     created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now'))
   );`,
  `CREATE TABLE IF NOT EXISTS highlights (
     id TEXT PRIMARY KEY, book_id TEXT NOT NULL,
     chapter_title TEXT, content TEXT NOT NULL, note TEXT, style INTEGER DEFAULT 0,
     range_start TEXT, range_end TEXT,
     created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
     FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
   );`,
  `CREATE TABLE IF NOT EXISTS cards (
     id TEXT PRIMARY KEY, highlight_id TEXT NOT NULL,
     state INTEGER DEFAULT 0, step INTEGER DEFAULT 0,
     stability REAL DEFAULT 0, difficulty REAL DEFAULT 0,
     due TEXT NOT NULL, last_review TEXT,
     elapsed_days INTEGER DEFAULT 0, scheduled_days INTEGER DEFAULT 0,
     reps INTEGER DEFAULT 0, lapses INTEGER DEFAULT 0,
     application_tag TEXT, mastery_level INTEGER DEFAULT 0,
     created_at TEXT DEFAULT (datetime('now')),
     FOREIGN KEY (highlight_id) REFERENCES highlights(id) ON DELETE CASCADE
   );`,
  `CREATE TABLE IF NOT EXISTS reviews (
     id TEXT PRIMARY KEY, card_id TEXT NOT NULL, rating INTEGER NOT NULL,
     review_time TEXT DEFAULT (datetime('now')),
     elapsed_days INTEGER DEFAULT 0, scheduled_days INTEGER DEFAULT 0,
     FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE
   );`,
  `CREATE TABLE IF NOT EXISTS book_summaries (
     id TEXT PRIMARY KEY, book_id TEXT NOT NULL UNIQUE,
     summary TEXT NOT NULL, key_points TEXT,
     generated_at TEXT DEFAULT (datetime('now')),
     FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
   );`,
  `CREATE TABLE IF NOT EXISTS daily_stats (
     id TEXT PRIMARY KEY, date TEXT NOT NULL UNIQUE,
     books_read INTEGER DEFAULT 0, highlights_added INTEGER DEFAULT 0,
     cards_reviewed INTEGER DEFAULT 0, reading_time INTEGER DEFAULT 0,
     created_at TEXT DEFAULT (datetime('now'))
   );`,
  `CREATE TABLE IF NOT EXISTS token_usage (
     id TEXT PRIMARY KEY,
     provider TEXT NOT NULL, model TEXT NOT NULL, feature TEXT NOT NULL,
     input_tokens INTEGER DEFAULT 0, output_tokens INTEGER DEFAULT 0,
     total_tokens INTEGER DEFAULT 0, cost_usd REAL DEFAULT 0,
     duration_ms INTEGER DEFAULT 0,
     created_at TEXT DEFAULT (datetime('now'))
   );`,
  `CREATE TABLE IF NOT EXISTS conversations (
     id TEXT PRIMARY KEY, title TEXT NOT NULL DEFAULT '',
     book_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
     updated_at TEXT NOT NULL DEFAULT (datetime('now')),
     message_count INTEGER NOT NULL DEFAULT 0
   );`,
  `CREATE TABLE IF NOT EXISTS chat_messages (
     id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL,
     role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
     content TEXT NOT NULL, intent TEXT, tools_used TEXT,
     bloom_level INTEGER, mastery_assessment TEXT, sources TEXT,
     created_at TEXT NOT NULL DEFAULT (datetime('now')),
     FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
   );`,
  `CREATE TABLE IF NOT EXISTS user_profiles (
     key TEXT PRIMARY KEY, value TEXT NOT NULL,
     updated_at TEXT NOT NULL DEFAULT (datetime('now'))
   );`,
  `CREATE TABLE IF NOT EXISTS methodologies (
     id TEXT PRIMARY KEY, book_id TEXT NOT NULL, name TEXT NOT NULL, name_en TEXT,
     trigger_scenario TEXT, description TEXT, steps TEXT, output_format TEXT,
     examples TEXT, tags TEXT, source_highlight_ids TEXT,
     mastery_level INTEGER DEFAULT 0, practice_count INTEGER DEFAULT 0,
     created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
     FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
   );`,
  `CREATE TABLE IF NOT EXISTS knowledge_cards (
     id TEXT PRIMARY KEY, book_id TEXT NOT NULL,
     type TEXT NOT NULL CHECK(type IN ('concept', 'methodology', 'quote')),
     title TEXT NOT NULL, content TEXT NOT NULL,
     interpretation TEXT, application TEXT,
     related_card_ids TEXT, tags TEXT, source_highlight_id TEXT,
     review_count INTEGER DEFAULT 0, mastery_level INTEGER DEFAULT 0,
     created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
     FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
   );`,
  `CREATE TABLE IF NOT EXISTS book_architecture (
     id TEXT PRIMARY KEY, book_id TEXT NOT NULL UNIQUE,
     core_proposition TEXT, cognitive_framework TEXT,
     methodology_architecture TEXT, knowledge_hierarchy TEXT, target_audience TEXT,
     created_at TEXT DEFAULT (datetime('now')), updated_at TEXT DEFAULT (datetime('now')),
     FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
   );`,
  `CREATE TABLE IF NOT EXISTS articles (
     id TEXT PRIMARY KEY, title_en TEXT NOT NULL, title_zh TEXT,
     content_en TEXT NOT NULL, content_zh TEXT, summary_zh TEXT,
     source TEXT NOT NULL, source_url TEXT, source_website TEXT,
     category TEXT DEFAULT 'psychology', difficulty TEXT DEFAULT 'cet4',
     vocabulary_json TEXT, is_read INTEGER DEFAULT 0, is_favorite INTEGER DEFAULT 0,
     read_time INTEGER DEFAULT 0,
     created_at TEXT DEFAULT (datetime('now')), published_at TEXT
   );`,
  `CREATE TABLE IF NOT EXISTS vocabulary (
     id TEXT PRIMARY KEY, word TEXT NOT NULL UNIQUE,
     phonetic TEXT, part_of_speech TEXT, meaning_zh TEXT NOT NULL,
     example_en TEXT, example_zh TEXT, cefr_level TEXT,
     source_article_id TEXT, source TEXT DEFAULT '手动添加',
     is_mastered INTEGER DEFAULT 0, review_count INTEGER DEFAULT 0,
     last_review_at TEXT, next_review_at TEXT,
     ef_factor REAL DEFAULT 2.5, interval_days INTEGER DEFAULT 0,
     repetition_count INTEGER DEFAULT 0, familiarity_level INTEGER DEFAULT 0,
     learning_stage INTEGER DEFAULT 0,
     created_at TEXT DEFAULT (datetime('now')),
     FOREIGN KEY (source_article_id) REFERENCES articles(id) ON DELETE SET NULL
   );`,
  `CREATE TABLE IF NOT EXISTS memories (
     id TEXT PRIMARY KEY,
     type TEXT NOT NULL CHECK(type IN ('preference', 'insight', 'interaction', 'achievement')),
     category TEXT NOT NULL, content TEXT NOT NULL,
     importance REAL DEFAULT 0.5, context TEXT,
     access_count INTEGER DEFAULT 0,
     created_at TEXT DEFAULT (datetime('now')), last_accessed_at TEXT DEFAULT (datetime('now'))
   );`,
  `CREATE INDEX IF NOT EXISTS idx_highlights_book_id ON highlights(book_id);`,
  `CREATE INDEX IF NOT EXISTS idx_cards_highlight_id ON cards(highlight_id);`,
  `CREATE INDEX IF NOT EXISTS idx_cards_due ON cards(due);`,
  `CREATE INDEX IF NOT EXISTS idx_reviews_card_id ON reviews(card_id);`,
  `CREATE INDEX IF NOT EXISTS idx_daily_stats_date ON daily_stats(date);`,
  `CREATE INDEX IF NOT EXISTS idx_messages_conversation ON chat_messages(conversation_id);`,
  `CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);`,
  `CREATE INDEX IF NOT EXISTS idx_methodologies_book_id ON methodologies(book_id);`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_cards_book_id ON knowledge_cards(book_id);`,
  `CREATE INDEX IF NOT EXISTS idx_knowledge_cards_type ON knowledge_cards(type);`,
  `CREATE INDEX IF NOT EXISTS idx_book_architecture_book_id ON book_architecture(book_id);`,
  `CREATE INDEX IF NOT EXISTS idx_articles_source ON articles(source);`,
  `CREATE INDEX IF NOT EXISTS idx_articles_created ON articles(created_at);`,
  `CREATE INDEX IF NOT EXISTS idx_articles_difficulty ON articles(difficulty);`,
  `CREATE INDEX IF NOT EXISTS idx_vocabulary_word ON vocabulary(word);`,
  `CREATE INDEX IF NOT EXISTS idx_vocabulary_mastered ON vocabulary(is_mastered);`,
  `CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);`,
  `CREATE INDEX IF NOT EXISTS idx_memories_importance ON memories(importance DESC);`,
];

// ============================================================================
// FSRS 引擎实例（用于把卡片推算到不同状态）
// ============================================================================

const fsrs = createFsrs(
  generatorParameters({
    request_retention: 0.9,
    maximum_interval: 36500,
    enable_fuzz: false,
    learning_steps: ['1m', '10m', '10m'],
    relearning_steps: ['1m', '10m'],
  }),
);

// 把 FsrsCard 转换为可写库的对象
function fsrsCardToRow(card: FsrsCard, highlightId: string, cardId: string, nowIso: string) {
  return {
    id: cardId,
    highlight_id: highlightId,
    state: card.state as unknown as number,
    step: card.state === FsrsState.Review ? 2 : Math.max(0, card.learning_steps - 1),
    stability: card.stability,
    difficulty: card.difficulty,
    due: card.due.toISOString(),
    last_review: card.last_review ? card.last_review.toISOString() : null,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    reps: card.reps,
    lapses: card.lapses,
    created_at: nowIso,
  };
}

// 模拟"已掌握"卡片：连续 Good 复习若干次
function simulateMatureCard(highlightId: string, cardId: string, repeatCount: number, startTime: Date): FsrsCard {
  let card = createEmptyCard();
  card.due = startTime;

  for (let i = 0; i < repeatCount; i++) {
    const reviewTime = new Date(startTime);
    reviewTime.setUTCDate(reviewTime.getUTCDate() + i * 4);
    const result = fsrs.next(card, reviewTime, FsrsRating.Good);
    card = result.card;
  }

  return { ...card, last_review: startTime };
}

// ============================================================================
// 数据准备
// ============================================================================

interface BookSeed {
  id: string;
  title: string;
  author: string;
  category: string;
  description: string;
  cover: string;
  readingProgress: number;
  lastReadDaysAgo: number;
  isFinished: 0 | 1;
  highlights: HighlightSeed[];
  knowledgeCards?: KnowledgeCardSeed[];
  methodologies?: MethodologySeed[];
}

interface HighlightSeed {
  id: string;
  chapter: string;
  content: string;
  note: string;
  tag: string;
  /** 卡片最终态：New=0, Learning=1, Review=2, Relearning=3, Mastered=4 */
  cardState: 0 | 1 | 2 | 3 | 4;
  /** Mastered 状态：连续 Good 复习次数（稳定性用） */
  reviewCount?: number;
}

interface KnowledgeCardSeed {
  type: 'concept' | 'methodology' | 'quote';
  title: string;
  content: string;
  interpretation: string;
  application: string;
  tags: string[];
  masteryLevel: number;
}

interface MethodologySeed {
  name: string;
  nameEn: string;
  triggerScenario: string;
  description: string;
  steps: string[];
  outputFormat: string;
  examples: string;
  tags: string[];
  masteryLevel: number;
  practiceCount: number;
}

// ---------- 书籍数据（12 本真实书目）----------

const BOOKS: BookSeed[] = [
  {
    id: 'demo-book-001',
    title: '深度工作',
    author: 'Cal Newport',
    category: '方法论',
    description: '在分心的世界中获得专注的科学与哲学。卡尔·纽波特提出"深度工作"概念，证明在无干扰状态下进行的专业活动能创造新价值、提升技能。',
    cover: 'https://img1.doubanio.com/view/subject/l/public/s29406617.jpg',
    readingProgress: 0.68,
    lastReadDaysAgo: 0,
    isFinished: 0,
    highlights: [
      { id: 'demo-hl-001', chapter: '第 4 章 · 深度工作是有意义的', content: '深度工作（Deep Work）：在无干扰状态下专业活动，能创造新价值、提升技能，且难以复制。', note: '这是我整套时间管理的基石', tag: '核心概念', cardState: 2, reviewCount: 5 },
      { id: 'demo-hl-002', chapter: '第 4 章 · 深度工作是有意义的', content: '注意力残留（Attention Residue）：当你频繁在任务间切换，前一任务的注意力残片会让大脑始终处于"半激活"状态。', note: '解释了我为什么开一天会后更累', tag: '认知科学', cardState: 4, reviewCount: 7 },
      { id: 'demo-hl-003', chapter: '第 4 章 · 深度工作是有意义的', content: '肤浅工作（Shallow Work）：对认知要求不高、充满干扰，往往制造忙碌假象。', note: '警惕 IM + 邮件', tag: '核心概念', cardState: 2, reviewCount: 4 },
      { id: 'demo-hl-004', chapter: '第 4 章 · 深度工作是有意义的', content: '有意义的深度 vs 肤浅的深度：前者创造新价值并契合使命，后者只是战术忙碌逃避战略思考。', note: '年度复盘用得上', tag: '方法论', cardState: 3 },
      { id: 'demo-hl-005', chapter: '第 5 章 · 拥抱无聊', content: '用 4DX 法则衡量：只有同时满足「重要指标 + 领先指标 + 影响力 + 可问责」的任务，才算"有意义的深度"。', note: '4DX = Discipline + Focus + eXecution', tag: '方法论', cardState: 1 },
      { id: 'demo-hl-006', chapter: '第 6 章 · 远离社交媒体', content: '卡尔·纽波特建议：每天 4 小时深度工作时段，关闭所有通讯工具，使用网站拦截器。', note: '我的番茄钟策略', tag: '实践建议', cardState: 0 },
      { id: 'demo-hl-007', chapter: '第 7 章 · 排毒', content: '深度工作 ≠ 忙碌工作；它需要刻意练习（Deliberate Practice）的方法论支撑。', note: '联结到《刻意练习》', tag: '核心概念', cardState: 2, reviewCount: 6 },
      { id: 'demo-hl-008', chapter: '第 8 章 · 4 种深度工作哲学', content: '禁欲哲学（Monastic）、双峰哲学（Bimodal）、节奏哲学（Rhythmic）、记者哲学（Journalistic）——选一种与你生活契合的。', note: '我选节奏哲学：每天 4 小时', tag: '方法论', cardState: 4, reviewCount: 8 },
    ],
    knowledgeCards: [
      { type: 'concept', title: '深度工作', content: '在无干扰状态下专注进行的职业活动，能创造新价值、提升技能，且难以复制。', interpretation: 'Cal Newport 在 2016 年提出的概念，对应工业时代被肢解的"专业脑力"工作模式。', application: '每天安排 2-4 个 90 分钟的深度时段；关闭所有通讯工具；用网站拦截器强制隔离。', tags: ['方法论', '时间管理'], masteryLevel: 100 },
      { type: 'concept', title: '注意力残留', content: '当你频繁在任务间切换，前一任务的注意力残片会让大脑始终处于"半激活"状态。', interpretation: '加州大学 Sophie Leroy 提出的认知科学概念，是多任务处理的真实代价。', application: '同时回邮件+写代码+看 IM，每 3 分钟切换一次 → 实际有效产出 ↓40%。\n每天固定 2 个 90 分钟"深度时段"，无 IM、无邮件。', tags: ['认知科学', '方法论'], masteryLevel: 92 },
    ],
    methodologies: [
      {
        name: '4 种深度工作哲学',
        nameEn: 'Four Philosophies of Deep Work',
        triggerScenario: '当我想规划每周工作节奏时',
        description: 'Cal Newport 提出按"专注时间占比"由高到低排列的 4 种深度工作模式，按生活节奏灵活选型。',
        steps: ['禁欲哲学（Monastic）：完全屏蔽干扰', '双峰哲学（Bimodal）：每周/每天切两个深度阶段', '节奏哲学（Rhythmic）：固定每天 4 小时深度', '记者哲学（Journalistic）：任意空档切深度'],
        outputFormat: '选定 1 种哲学 → 制定时间表 → 严格执行 4 周 → 评估效果',
        examples: '工程师一般选节奏哲学；高管选记者哲学；学者选禁欲哲学。',
        tags: ['方法论', '时间管理'],
        masteryLevel: 85,
        practiceCount: 12,
      },
      {
        name: '4DX 法则',
        nameEn: '4 Disciplines of Execution',
        triggerScenario: '当我想判断一项任务是否值得深度投入时',
        description: '用 4 个维度过滤"有意义的深度"：重要指标 + 领先指标 + 影响力 + 可问责。',
        steps: ['重要指标（lagging measure）', '领先指标（leading measure）', '影响力（influence）', '可问责（accountability）'],
        outputFormat: '4 个维度同时满足 → "有意义的深度"\n任一不满足 → "肤浅的深度"',
        examples: '写代码+项目里程碑 = 4 维满足；回邮件+开周会 = 仅 2 维满足。',
        tags: ['方法论', '决策'],
        masteryLevel: 70,
        practiceCount: 6,
      },
    ],
  },
  {
    id: 'demo-book-002',
    title: '思考，快与慢',
    author: 'Daniel Kahneman',
    category: '心理学',
    description: '诺贝尔经济学奖得主卡尼曼介绍人类思维的两种模式：快思考（系统 1）和慢思考（系统 2），揭示我们如何决策、为何犯错。',
    cover: 'https://img2.doubanio.com/view/subject/l/public/s8834323.jpg',
    readingProgress: 0.45,
    lastReadDaysAgo: 2,
    isFinished: 0,
    highlights: [
      { id: 'demo-hl-009', chapter: '第 3 章 · 系统 1 和系统 2', content: '系统 1（快思考）：快速、自动、情感化、容易出错；系统 2（慢思考）：慢速、刻意、理性、懒惰。', note: '90% 的日常决策都走系统 1', tag: '核心概念', cardState: 4, reviewCount: 6 },
      { id: 'demo-hl-010', chapter: '第 5 章 · 认知松弛', content: '认知松弛（Cognitive Ease）：系统 1 处理熟悉/重复/清晰信息时的舒适状态，会让人轻易接受错误结论。', note: '警惕"越熟越信"', tag: '认知偏差', cardState: 2, reviewCount: 4 },
      { id: 'demo-hl-011', chapter: '第 10 章 · 锚定效应', content: '锚定效应（Anchoring）：人们做判断时过度依赖第一眼看到的数字（锚）。', note: '商品定价/薪资谈判必备', tag: '认知偏差', cardState: 2, reviewCount: 5 },
      { id: 'demo-hl-012', chapter: '第 14 章 · 损失厌恶', content: '损失厌恶（Loss Aversion）：损失 100 元的痛苦 ≈ 获得 150 元的快乐的 2 倍。', note: '行为经济学基石', tag: '核心概念', cardState: 4, reviewCount: 7 },
      { id: 'demo-hl-013', chapter: '第 16 章 · 规划谬误', content: '规划谬误（Planning Fallacy）：人们系统性地低估完成任务所需时间。', note: '软件开发永远的痛', tag: '认知偏差', cardState: 1 },
      { id: 'demo-hl-014', chapter: '第 23 章 · 禀赋效应', content: '禀赋效应（Endowment Effect）：人们对"自己拥有的"东西估值更高。', note: '二手房买卖时特别明显', tag: '认知偏差', cardState: 0 },
    ],
    knowledgeCards: [
      { type: 'concept', title: '系统 1 / 系统 2', content: '系统 1（快思考）：快速、自动、情感化；系统 2（慢思考）：慢速、刻意、理性。', interpretation: 'Kahneman 在本书中提出的双系统模型，源自认知心理学对人类决策的长期研究。', application: '重要决策前刻意启动系统 2：写下来、列证据、设定思考时间。\n日常琐事放心交给系统 1。', tags: ['认知科学', '决策'], masteryLevel: 88 },
    ],
  },
  {
    id: 'demo-book-003',
    title: '原子习惯',
    author: 'James Clear',
    category: '方法论',
    description: 'James Clear 提出"微小改变 + 复利效应 + 身份认同"的习惯养成框架，帮你建立好习惯、戒掉坏习惯。',
    cover: 'https://img1.doubanio.com/view/subject/l/public/s33485731.jpg',
    readingProgress: 0.92,
    lastReadDaysAgo: 1,
    isFinished: 0,
    highlights: [
      { id: 'demo-hl-015', chapter: '第 1 章 · 微小改变的复利', content: '复利是世界第八奇迹。理解它的人赚取它，不理解的人支付它。每天进步 1%，一年后会强大 37 倍。', note: '每天背 5 个单词，1 年就是 1825 个', tag: '核心概念', cardState: 4, reviewCount: 9 },
      { id: 'demo-hl-016', chapter: '第 3 章 · 身份认同', content: '决定你想要成为什么（身份）→ 相信这是可能的（信念）→ 重复小动作（习惯）。', note: '先立身份，再做习惯', tag: '核心概念', cardState: 4, reviewCount: 7 },
      { id: 'demo-hl-017', chapter: '第 5 章 · 4 法则', content: '4 法则：提示（Cue）→ 渴求（Craving）→ 反应（Response）→ 奖励（Reward）。任何习惯都可拆解。', note: '写代码习惯：关 Slack → 想写 → 敲键盘 → commit 成功', tag: '方法论', cardState: 2, reviewCount: 5 },
      { id: 'demo-hl-018', chapter: '第 6 章 · 习惯堆叠', content: '习惯堆叠（Habit Stacking）：把新习惯接在已有习惯之后：「做完 A 之后，我会做 B」。', note: '我刷完牙 → 做 5 个俯卧撑', tag: '方法论', cardState: 2, reviewCount: 4 },
      { id: 'demo-hl-019', chapter: '第 8 章 · 环境设计', content: '让好习惯显而易见、坏习惯视而不见：跑鞋放门口、健康食品放冰箱前层。', note: '想健身 → 把跑鞋放门口；想读书 → 睡前不刷手机', tag: '实践建议', cardState: 4, reviewCount: 8 },
      { id: 'demo-hl-020', chapter: '第 12 章 · 习惯契约', content: '习惯契约（Habit Contract）：与朋友约定违约时的承诺，把未来自己绑定到当下。', note: '我 + 队友：每周未跑步 → 罚款 100 元', tag: '实践建议', cardState: 0 },
      { id: 'demo-hl-021', chapter: '第 15 章 · 身份驱动 vs 结果驱动', content: '"我不是在戒烟，我是一个不抽烟的人"——身份比结果更持久。', note: '改写自我叙事', tag: '核心概念', cardState: 1 },
    ],
    knowledgeCards: [
      { type: 'methodology', title: '4 法则（提示-渴求-反应-奖励）', content: '任何习惯都可拆解为 4 步：提示（Cue）触发渴求（Craving），推动反应（Response），产生奖励（Reward）。', interpretation: 'James Clear 借鉴 B.J. Fogg 的行为模型，提出可操作的习惯设计框架。', application: '① 想健身 → 把跑鞋放门口（提示）\n② 想读书 → 睡前不刷手机（消除提示）\n③ 改习惯 → 拆开 4 步逐一优化', tags: ['方法论', '行为设计'], masteryLevel: 95 },
      { type: 'concept', title: '身份驱动 vs 结果驱动', content: '"我是一个不抽烟的人"比"我要戒烟"更持久，因为身份是底层操作系统。', interpretation: '真正的改变发生在你想成为什么样的人，而不是你想做什么。', application: '新年目标改为：我不吃外卖 + 我是 home chef。', tags: ['认知科学', '习惯'], masteryLevel: 80 },
    ],
    methodologies: [
      {
        name: '4 法则习惯设计',
        nameEn: 'The Four Laws of Behavior Change',
        triggerScenario: '当我想养一个新习惯时',
        description: '把习惯拆为 4 步：提示、渴求、反应、奖励，对应"让它显而易见 / 不可抗拒 / 简便易行 / 即时满足"4 个改写原则。',
        steps: ['第 1 法则：让它显而易见（提示）', '第 2 法则：让它有吸引力（渴求）', '第 3 法则：让它简便易行（反应）', '第 4 法则：让它令人愉悦（奖励）'],
        outputFormat: '目标习惯 → 4 法则设计表 → 21 天打卡记录',
        examples: '想养成读书习惯：床头放书 + 设闹钟 + 每次 5 分钟 + 读完发朋友圈。',
        tags: ['方法论', '行为设计'],
        masteryLevel: 92,
        practiceCount: 24,
      },
      {
        name: '习惯堆叠',
        nameEn: 'Habit Stacking',
        triggerScenario: '当我想把新习惯粘到已有习惯上时',
        description: '把新习惯接在已有习惯之后："做完 A 之后，我会做 B"，利用已有神经回路作为锚点。',
        steps: ['列出已有日常习惯', '选择新习惯', '用"做完 X 之后，我会做 Y"格式', '持续 21 天'],
        outputFormat: '习惯堆叠脚本：「[现有习惯] + [新习惯]」',
        examples: '我刷完牙后 → 做 5 个俯卧撑。\n我吃完午饭后 → 走 10 分钟。',
        tags: ['方法论', '行为设计'],
        masteryLevel: 88,
        practiceCount: 18,
      },
    ],
  },
  {
    id: 'demo-book-004',
    title: '学会提问',
    author: 'Neil Browne',
    category: '批判思维',
    description: '一本批判性思维入门书，教你识别论证结构、识别推理谬误、不被舆论裹挟。',
    cover: 'https://img1.doubanio.com/view/subject/l/public/s28355348.jpg',
    readingProgress: 1.0,
    lastReadDaysAgo: 7,
    isFinished: 1,
    highlights: [
      { id: 'demo-hl-022', chapter: '第 1 章 · 学会提问', content: '你无法通过读一本书就改变人生，但你可以改变看待世界的方式。', note: '开篇直击', tag: '金句', cardState: 4, reviewCount: 5 },
      { id: 'demo-hl-023', chapter: '第 3 章 · 论题与结论', content: '批判性思考的第一步：找出论题（what）和结论（so what）。', note: '两步法：先 what 后 so what', tag: '方法论', cardState: 2, reviewCount: 4 },
      { id: 'demo-hl-024', chapter: '第 5 章 · 论据', content: '证据三性：可证伪性、可信度、可获得性。不可证伪的论断 = 不可检验 = 无意义。', note: '波普尔的可证伪性', tag: '批判思维', cardState: 1 },
      { id: 'demo-hl-025', chapter: '第 7 章 · 推理谬误', content: '常见推理谬误：稻草人、滑坡、循环论证、诉诸权威、人身攻击。', note: '识别 ≠ 避免', tag: '批判思维', cardState: 0 },
      { id: 'demo-hl-026', chapter: '第 10 章 · 价值观假设', content: '价值观假设：论证背后未明说的偏好、信念、价值判断。', note: '"每个人都应该努力" 是价值观假设', tag: '方法论', cardState: 0 },
    ],
    knowledgeCards: [
      { type: 'concept', title: '可证伪性', content: '波普尔的科学划界标准：一个论断如果无法被证伪，就不属于科学。', interpretation: '批判性思维的基础——只接受"原则上可被反驳"的观点。', application: '判断"专家观点"时问：这能被反驳吗？怎么反驳？\n"上帝存在" 是不可证伪的；"明天会下雨" 是可证伪的。', tags: ['批判思维', '哲学'], masteryLevel: 75 },
    ],
  },
  {
    id: 'demo-book-005',
    title: '非暴力沟通',
    author: 'Marshall Rosenberg',
    category: '沟通',
    description: '马歇尔·卢森堡博士提出"非暴力沟通"四要素：观察、感受、需要、请求，化解人际冲突。',
    cover: 'https://img1.doubanio.com/view/subject/l/public/s29680918.jpg',
    readingProgress: 0.55,
    lastReadDaysAgo: 3,
    isFinished: 0,
    highlights: [
      { id: 'demo-hl-027', chapter: '第 3 章 · 观察 vs 评价', content: '你不是你以为的你，你是你选择成为的你。', note: '身份 vs 行为', tag: '金句', cardState: 4, reviewCount: 6 },
      { id: 'demo-hl-028', chapter: '第 4 章 · 体会和表达感受', content: '感受源于需要。批评往往暗含未被满足的需要。', note: '"你从不关心我" → "我感到孤独，因为我需要陪伴"', tag: '核心概念', cardState: 2, reviewCount: 4 },
      { id: 'demo-hl-029', chapter: '第 5 章 · 感受的根源', content: '非暴力沟通 4 要素：观察（O）+ 感受（F）+ 需要（N）+ 请求（R）。', note: 'OFNR 框架', tag: '方法论', cardState: 2, reviewCount: 5 },
      { id: 'demo-hl-030', chapter: '第 6 章 · 请求帮助', content: '把命令转化为请求：用"你愿意……吗？"代替"你应该……"。', note: '请求 vs 命令', tag: '方法论', cardState: 1 },
      { id: 'demo-hl-031', chapter: '第 7 章 · 用全身心倾听', content: '倾听他人需要：放下"应该"、"必须"、"对错"，先共情再回应。', note: '倾听三层次：1.听懂字面 2.听懂情绪 3.听懂需要', tag: '方法论', cardState: 0 },
    ],
    knowledgeCards: [
      { type: 'methodology', title: '非暴力沟通（OFNR）', content: '4 要素：观察（Observation）+ 感受（Feeling）+ 需要（Need）+ 请求（Request）。', interpretation: 'Rosenberg 借鉴卡尔·罗杰斯的人本主义心理治疗，形成的沟通框架。', application: '① 描述事实：本周我加班 3 次（O）\n② 表达感受：我感到疲惫（F）\n③ 说出需要：我需要更多休息时间（N）\n④ 提出请求：你能这周末不安排工作吗？（R）', tags: ['沟通', '方法论'], masteryLevel: 78 },
    ],
  },
  {
    id: 'demo-book-006',
    title: '影响力',
    author: 'Robert Cialdini',
    category: '心理学',
    description: '罗伯特·西奥迪尼揭示说服的 7 大心理学原理：互惠、承诺、社会认同、喜好、权威、稀缺、统一。',
    cover: 'https://img1.doubanio.com/view/subject/l/public/s28355270.jpg',
    readingProgress: 0.62,
    lastReadDaysAgo: 5,
    isFinished: 0,
    highlights: [
      { id: 'demo-hl-032', chapter: '第 1 章 · 影响力的武器', content: '固定反应模式（Fixed-action pattern）：触发特征 → 自动化行为，动物世界普遍存在。', note: '人类也是自动化的动物', tag: '核心概念', cardState: 2, reviewCount: 4 },
      { id: 'demo-hl-033', chapter: '第 2 章 · 互惠', content: '互惠原理：先给予再索取，对方会因亏欠感回报。', note: 'KFC 试吃、商场免费样品', tag: '核心概念', cardState: 1 },
      { id: 'demo-hl-034', chapter: '第 3 章 · 承诺与一致', content: '承诺与一致：一旦公开承诺，会努力保持一致。', note: '减肥时公开承诺更有效', tag: '核心概念', cardState: 0 },
      { id: 'demo-hl-035', chapter: '第 5 章 · 社会认同', content: '社会认同：在不确定时，参考多数人行为。"夜半三更的街边店"。', note: 'B 站弹幕 = 社会认同可视化', tag: '核心概念', cardState: 0 },
    ],
  },
  {
    id: 'demo-book-007',
    title: '刻意练习',
    author: 'Anders Ericsson',
    category: '学习科学',
    description: '安德斯·艾利克森提出"刻意练习"理论，揭示天才背后的科学方法论。',
    cover: 'https://img1.doubanio.com/view/subject/l/public/s29129081.jpg',
    readingProgress: 1.0,
    lastReadDaysAgo: 14,
    isFinished: 1,
    highlights: [
      { id: 'demo-hl-036', chapter: '第 2 章 · 有目的的练习', content: '刻意练习 ≠ 1 万小时定律。必须有目标、专注、反馈、走出舒适区。', note: '1 万小时是误导', tag: '核心概念', cardState: 4, reviewCount: 7 },
      { id: 'demo-hl-037', chapter: '第 4 章 · 心理表征', content: '心理表征（Mental Representation）：专家与新手的本质区别在于大脑的"工作记忆区"。', note: '棋手下盲棋的本质', tag: '核心概念', cardState: 2, reviewCount: 4 },
      { id: 'demo-hl-038', chapter: '第 5 章 · 黄金标准', content: '刻意练习 4 要素：明确目标、专注、即时反馈、走出舒适区。', note: '刻意练习 4 要素', tag: '方法论', cardState: 2, reviewCount: 5 },
    ],
    knowledgeCards: [
      { type: 'concept', title: '刻意练习', content: '有目的的练习：明确目标、专注、即时反馈、走出舒适区。', interpretation: 'Ericsson 在 1993 年提出，颠覆"天赋论"，强调方法论决定上限。', application: '练钢琴：不是反复弹，是挑难段 + 慢练 + 录音 + 复盘。\n学编程：不是堆项目量，是刷 LeetCode + 看答案 + 重做。', tags: ['方法论', '学习科学'], masteryLevel: 90 },
    ],
  },
  {
    id: 'demo-book-008',
    title: '心流',
    author: 'Mihaly Csikszentmihalyi',
    category: '心理学',
    description: '米哈里·契克森米哈赖提出"心流"最优体验理论，揭示人类幸福的真正源泉。',
    cover: 'https://img1.doubanio.com/view/subject/l/public/s28358832.jpg',
    readingProgress: 0.38,
    lastReadDaysAgo: 4,
    isFinished: 0,
    highlights: [
      { id: 'demo-hl-039', chapter: '第 4 章 · 快乐与心流', content: '心流（Flow）：完全沉浸、忘记时间、享受过程的体验。需要技能与挑战匹配。', note: '挑战 ≈ 技能 + 一点点', tag: '核心概念', cardState: 4, reviewCount: 6 },
      { id: 'demo-hl-040', chapter: '第 5 章 · 心流体验', content: '心流 7 要素：明确目标、即时反馈、技能-挑战平衡、行动-意识融合、控制感、自我意识消失、时间感扭曲。', note: '7 要素', tag: '核心概念', cardState: 2, reviewCount: 4 },
      { id: 'demo-hl-041', chapter: '第 7 章 · 工作中的心流', content: '"自成目的"（Autotelic）：把工作本身变成奖励，而不是完成任务的副产品。', note: '工作本身 = 奖励', tag: '核心概念', cardState: 0 },
    ],
    knowledgeCards: [
      { type: 'concept', title: '心流', content: '完全沉浸、忘记时间、享受过程的体验。需要技能与挑战刚好匹配。', interpretation: 'Csikszentmihalyi 提出，是积极心理学最核心概念之一。', application: '① 调整任务难度：太简单就升难度，太难就降难度\n② 屏蔽干扰：进心流前 23 分钟最易被打断\n③ 设立明确目标：每段工作有清晰交付物', tags: ['心理学', '方法论'], masteryLevel: 82 },
    ],
  },
  {
    id: 'demo-book-009',
    title: '原则',
    author: 'Ray Dalio',
    category: '个人管理',
    description: '桥水基金创始人瑞·达利欧分享自己的人生和工作原则：极度透明、创意择优、痛苦 + 反思 = 进步。',
    cover: 'https://img1.doubanio.com/view/subject/l/public/s29634741.jpg',
    readingProgress: 0.50,
    lastReadDaysAgo: 6,
    isFinished: 0,
    highlights: [
      { id: 'demo-hl-042', chapter: '第 1 章 · 生活的原则', content: '痛苦 + 反思 = 进步。', note: '桥水文化的根基', tag: '金句', cardState: 4, reviewCount: 7 },
      { id: 'demo-hl-043', chapter: '第 2 章 · 用原则应对现实', content: '不要让情绪影响决策。让原则像算法一样运行。', note: '原则 > 直觉', tag: '方法论', cardState: 2, reviewCount: 4 },
      { id: 'demo-hl-044', chapter: '第 3 章 · 极度透明', content: '极度透明 + 创意择优 = 最好的决策机制。', note: '桥水内部所有会议录音', tag: '方法论', cardState: 0 },
    ],
  },
  {
    id: 'demo-book-010',
    title: '人类简史',
    author: 'Yuval Harari',
    category: '历史',
    description: '尤瓦尔·赫拉利以宏大视角重述人类历史：认知革命、农业革命、科学革命。',
    cover: 'https://img1.doubanio.com/view/subject/l/public/s27814883.jpg',
    readingProgress: 0.30,
    lastReadDaysAgo: 10,
    isFinished: 0,
    highlights: [
      { id: 'demo-hl-045', chapter: '第 2 章 · 虚构的力量', content: '虚构故事（如宗教、国家、公司）是人类大规模协作的关键。', note: '公司 = 法律上的虚构', tag: '核心概念', cardState: 2, reviewCount: 3 },
      { id: 'demo-hl-046', chapter: '第 5 章 · 农业革命的骗局', content: '农业革命是"史上最大的骗局"：人类驯化小麦，小麦也驯化人类。', note: '反直觉', tag: '核心概念', cardState: 0 },
    ],
  },
  {
    id: 'demo-book-011',
    title: '纳瓦尔宝典',
    author: 'Naval Ravikant',
    category: '个人成长',
    description: '硅谷天使投资人纳瓦尔关于财富、幸福、人生的智慧集合。',
    cover: 'https://img1.doubanio.com/view/subject/l/public/s34016062.jpg',
    readingProgress: 0.70,
    lastReadDaysAgo: 1,
    isFinished: 0,
    highlights: [
      { id: 'demo-hl-047', chapter: '第 1 章 · 财富的本质', content: '不要问成功的人想要什么，问他们愿意放弃什么。', note: '财富 = 杠杆 + 专长 + 复利', tag: '金句', cardState: 4, reviewCount: 6 },
      { id: 'demo-hl-048', chapter: '第 2 章 · 杠杆', content: '3 种杠杆：资本、人力、代码（边际成本为 0 的复制品）。', note: '代码 = 最新杠杆', tag: '核心概念', cardState: 2, reviewCount: 4 },
      { id: 'demo-hl-049', chapter: '第 3 章 · 专长', content: '专长 = 无法被培训替代的技能。需要好奇心 + 努力 + 长期。', note: '专长是"读不出来的"', tag: '核心概念', cardState: 0 },
    ],
  },
  {
    id: 'demo-book-012',
    title: '被讨厌的勇气',
    author: '岸见一郎 / 古贺史健',
    category: '心理',
    description: '阿德勒心理学的通俗解读：课题分离、目的论、共同体感觉、自我接纳。',
    cover: 'https://img1.doubanio.com/view/subject/l/public/s28355798.jpg',
    readingProgress: 0.80,
    lastReadDaysAgo: 2,
    isFinished: 0,
    highlights: [
      { id: 'demo-hl-050', chapter: '第 2 章 · 我们的不幸是谁的错', content: '重要的不是被给予了什么，而是如何利用被给予的东西。', note: '阿德勒的目的论', tag: '核心概念', cardState: 2, reviewCount: 4 },
      { id: 'demo-hl-051', chapter: '第 3 章 · 自由就是被别人讨厌', content: '一切烦恼都来自人际关系。课题分离 = 解决人际关系的解药。', note: '课题分离', tag: '方法论', cardState: 4, reviewCount: 5 },
      { id: 'demo-hl-052', chapter: '第 5 章 · 认真的人生活在当下', content: '人生是一连串的刹那。不是通往某处的线，而是连续的"点"。', note: '活在当下', tag: '金句', cardState: 0 },
      { id: 'demo-hl-053', chapter: '第 6 章 · 勇气与幸福的因果', content: '重要的不是被给予了什么，而是如何利用被给予的东西。', note: '关注可控因素', tag: '金句', cardState: 1 },
      { id: 'demo-hl-054', chapter: '第 1 章 · 否定心理创伤', content: '阿德勒心理学否定"心理创伤"的存在，过去不能决定现在。', note: '目的论 vs 原因论', tag: '核心概念', cardState: 0 },
    ],
  },
];

// ---------- 补充 highlights：让总划线数 ≥ 60 ----------
// 每本 1-2 条 "附加" 划线，复用真实公开内容
const EXTRA_HIGHLIGHTS: HighlightSeed[] = [
  { id: 'demo-hl-055', chapter: '第 1 章 · 在新经济形势下取得成功', content: '"工匠精神"（Craftsman Mindset）：不为短期利益牺牲长期质量。', note: '《深度工作》核心精神', tag: '核心概念', cardState: 4, reviewCount: 4, _bookId: 'demo-book-001' } as HighlightSeed & { _bookId: string },
  { id: 'demo-hl-056', chapter: '第 2 章 · 深度工作为何有价值', content: '三大原因：① 罕见 ② 有意义 ③ 难复制。这是新经济下的核心竞争力。', note: '稀缺性 + 价值性 + 不可替代', tag: '核心概念', cardState: 2, reviewCount: 3, _bookId: 'demo-book-001' } as HighlightSeed & { _bookId: string },
  { id: 'demo-hl-057', chapter: '第 2 章 · 系统 1 的虚张声势', content: '系统 1 自信满满，编造故事填补空白（confabulation）。', note: '系统 1 的"过度自信"', tag: '认知偏差', cardState: 1, _bookId: 'demo-book-002' } as HighlightSeed & { _bookId: string },
  { id: 'demo-hl-058', chapter: '第 7 章 · 习惯叠加', content: '让改变"不可抗拒"：把想做的事绑定到已有渴求上（情境、时段、情绪）。', note: '原子习惯的扩展', tag: '方法论', cardState: 2, reviewCount: 2, _bookId: 'demo-book-003' } as HighlightSeed & { _bookId: string },
  { id: 'demo-hl-059', chapter: '第 11 章 · 行为转变四步', content: '行为转变的 4 步：暗示 → 惯常行为 → 奖赏。改变中间的惯常行为。', note: '4 步循环', tag: '方法论', cardState: 0, _bookId: 'demo-book-003' } as HighlightSeed & { _bookId: string },
  { id: 'demo-hl-060', chapter: '第 8 章 · 推理谬误', content: '避免"虚假两难"谬误：不要把复杂问题简化为"非黑即白"。', note: '识别论证陷阱', tag: '批判思维', cardState: 0, _bookId: 'demo-book-004' } as HighlightSeed & { _bookId: string },
  { id: 'demo-hl-061', chapter: '第 4 章 · 区分请求与命令', content: '真正的请求允许对方说"不"。命令伪装成请求，本质是操控。', note: 'NVC 关键区分', tag: '方法论', cardState: 0, _bookId: 'demo-book-005' } as HighlightSeed & { _bookId: string },
  { id: 'demo-hl-062', chapter: '第 4 章 · 喜好', content: '喜好原理：我们更易答应"我们喜欢或相似"的人的请求。', note: '销售/谈判常用', tag: '核心概念', cardState: 0, _bookId: 'demo-book-006' } as HighlightSeed & { _bookId: string },
  { id: 'demo-hl-063', chapter: '第 3 章 · 心理表征的重要性', content: '心理表征能预测表现、引导注意、组织理解、加快反应。', note: '专家的"内功"', tag: '核心概念', cardState: 0, _bookId: 'demo-book-007' } as HighlightSeed & { _bookId: string },
  { id: 'demo-hl-064', chapter: '第 6 章 · 心流的要素', content: '心流的产生条件：① 清晰目标 ② 即时反馈 ③ 技能-挑战平衡。', note: '心流入门', tag: '核心概念', cardState: 2, reviewCount: 3, _bookId: 'demo-book-008' } as HighlightSeed & { _bookId: string },
  { id: 'demo-hl-065', chapter: '第 2 章 · 五步流程', content: '达利欧 5 步流程：明确目标 → 识别问题 → 诊断根因 → 设计方案 → 强制执行。', note: '通用决策框架', tag: '方法论', cardState: 0, _bookId: 'demo-book-009' } as HighlightSeed & { _bookId: string },
  { id: 'demo-hl-066', chapter: '第 6 章 · 想象共同体', content: '"想象的共同体"（Imagined Communities）：民族、国家都是大规模虚构故事。', note: '历史的虚构建构', tag: '核心概念', cardState: 0, _bookId: 'demo-book-010' } as HighlightSeed & { _bookId: string },
  { id: 'demo-hl-067', chapter: '第 4 章 · 判断力', content: '判断力 > 勤奋。学会区分"应该"和"想要"是核心判断力。', note: '决策第一性', tag: '核心概念', cardState: 0, _bookId: 'demo-book-011' } as HighlightSeed & { _bookId: string },
  { id: 'demo-hl-068', chapter: '第 4 章 · 世界的常识', content: '幸福源于"贡献感"（contribution），而非被认可。', note: '共同体感觉', tag: '核心概念', cardState: 0, _bookId: 'demo-book-012' } as HighlightSeed & { _bookId: string },
];

// ---------- 知识卡片：补充"通用"卡片（5 概念 + 5 方法论 + 5 金句）----------

const GLOBAL_KNOWLEDGE_CARDS: Array<{
  bookId: string;
  type: 'concept' | 'methodology' | 'quote';
  title: string;
  content: string;
  interpretation: string;
  application: string;
  tags: string[];
  masteryLevel: number;
}> = [
  // 概念卡：5 张
  { bookId: 'demo-book-003', type: 'concept', title: '复利效应', content: '每天进步 1%，一年后强大 37 倍；每天退步 1%，一年后接近 0。', interpretation: '时间是复利的朋友，习惯是复利的载体。', application: '每天背 5 个单词，1 年 1825 个；每天 1 行代码，1 年 365 行。', tags: ['核心概念', '成长'], masteryLevel: 100 },
  { bookId: 'demo-book-007', type: 'concept', title: '元认知', content: '对自己认知过程的认知：能"看着自己在思考"的能力。', interpretation: 'Flavell 1979 年提出，是人类区别于动物的高阶能力。', application: '写日记 = 把潜意识显性化 = 提升元认知。\n冥想 = 观察自己的念头 = 提升元认知。', tags: ['认知科学', '方法论'], masteryLevel: 80 },
  { bookId: 'demo-book-008', type: 'concept', title: '延迟满足', content: '为更大长期奖励，放弃即时小满足。', interpretation: 'Stanford 棉花糖实验核心发现，与自我控制、目标设定强相关。', application: '写代码时先看文档再写 = 短期慢 + 长期快。\n减肥时先吃蔬菜 = 满足感 + 长期瘦。', tags: ['心理学', '方法论'], masteryLevel: 70 },
  // 方法论卡：5 张
  { bookId: 'demo-book-003', type: 'methodology', title: '番茄工作法', content: '25 分钟专注 + 5 分钟休息，循环 4 次后长休息 15-30 分钟。', interpretation: 'Francesco Cirillo 1987 年提出，工具是一只厨房番茄钟。', application: '① 选 1 个任务\n② 设 25 分钟倒计时\n③ 全程专注不被打断\n④ 响铃后休息 5 分钟\n⑤ 4 个循环后长休息', tags: ['方法论', '时间管理'], masteryLevel: 95 },
  { bookId: 'demo-book-003', type: 'methodology', title: 'GTD（Getting Things Done）', content: '5 步：捕获（Capture）→ 厘清（Clarify）→ 整理（Organize）→ 反思（Reflect）→ 执行（Engage）。', interpretation: 'David Allen 提出，强调把任务从大脑"卸载"到外部系统。', application: '① 收到任何事：先记到 inbox\n② 厘清：能 2 分钟做完就做，否则分类/委派/延后\n③ 每周回顾一次 inbox', tags: ['方法论', '时间管理'], masteryLevel: 75 },
  { bookId: 'demo-book-007', type: 'methodology', title: '费曼学习法', content: '4 步：选择概念 → 用大白话讲给小孩听 → 讲不通就回去重学 → 简化语言。', interpretation: '诺贝尔物理学家 Richard Feynman 提出，以"能讲明白"为终极检验。', application: '① 选一个你想学的概念\n② 假装你是老师，写下讲解\n③ 卡壳就回到原始材料重学\n④ 简化到你奶奶都能听懂', tags: ['方法论', '学习科学'], masteryLevel: 88 },
  { bookId: 'demo-book-004', type: 'methodology', title: '苏格拉底式提问', content: '5 类问题：澄清（"你的意思是？"）→ 探询假设（"你假设了什么？"）→ 探询理由（"为什么这样？"）→ 探询观点（"还有别的看法吗？"）→ 探询后果（"这会导致什么？"）', interpretation: '苏格拉底"产婆术"——不直接给答案，用问题引导对方自己发现。', application: '产品决策：\n① 澄清："这个指标具体怎么算？"\n② 假设："我们假设用户在乎什么？"\n③ 后果："如果错了会怎么样？"\n④ 替代："还有别的方案吗？"', tags: ['方法论', '批判思维'], masteryLevel: 72 },
  { bookId: 'demo-book-002', type: 'methodology', title: '10/10/10 法则', content: '决策前问自己：10 分钟后、10 个月后、10 年后，我会怎么看待这个决定？', interpretation: '把情绪化的时间感拉长，从"短期冲动"切换到"长期视角"。', application: '要不要加这个班？\n10 分钟后：累\n10 个月后：项目上线\n10 年后：\u0001重要项目经验', tags: ['方法论', '决策'], masteryLevel: 80 },
  // 金句卡：5 张
  { bookId: 'demo-book-001', type: 'quote', title: '"忙碌不是生产力，专注才是。"', content: '忙碌不是生产力，专注才是。', interpretation: 'Cal Newport 反复强调：拒绝肤浅忙碌是深度工作的前提。', application: '每天划定 2-4 个 90 分钟深度时段，屏蔽所有干扰。', tags: ['金句', '深度工作'], masteryLevel: 100 },
  { bookId: 'demo-book-005', type: 'quote', title: '"你不是你以为的你，你是你选择成为的你。"', content: '你不是你以为的你，你是你选择成为的你。', interpretation: 'Rosenberg 借萨特的存在主义，强调选择的自由。', application: '每天起床后问自己：今天我选择成为什么样的人？', tags: ['金句', '身份'], masteryLevel: 100 },
  { bookId: 'demo-book-011', type: 'quote', title: '"不要问成功的人想要什么，问他们愿意放弃什么。"', content: '不要问成功的人想要什么，问他们愿意放弃什么。', interpretation: 'Naval 的逆向思考——成功的本质是放弃，不是获得。', application: '想做独立开发者？问自己：愿意放弃大厂工资吗？愿意放弃稳定的项目排期吗？', tags: ['金句', '决策'], masteryLevel: 92 },
  { bookId: 'demo-book-004', type: 'quote', title: '"你无法通过读一本书就改变人生，但你可以改变看待世界的方式。"', content: '你无法通过读一本书就改变人生，但你可以改变看待世界的方式。', interpretation: 'Neil Browne 的开场白——批判性思维是认知升级的起点。', application: '把每本书当"思维镜片"，而非"行动指南"。', tags: ['金句', '阅读'], masteryLevel: 100 },
  { bookId: 'demo-book-003', type: 'quote', title: '"复利是世界第八奇迹。"', content: '复利是世界第八奇迹。复利效应适用于学习。', interpretation: '爱因斯坦的名言，James Clear 把它变成习惯养成的核心理论。', application: '每天 0.1% 进步 → 1 年 1.44 倍；5 年 6.2 倍。', tags: ['金句', '复利'], masteryLevel: 100 },
];

// ---------- Token 用量数据（让 TokenUsage 页面有内容）----------

interface TokenSeed {
  provider: 'DeepSeek' | 'OpenAI' | '火山引擎' | '通义千问';
  model: string;
  feature: 'ai_chat' | 'card_review_gen' | 'knowledge_card' | 'summarize' | 'embedding';
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  daysAgo: number;
  hourOfDay: number;
  durationMs: number;
}

const TOKEN_SEEDS: TokenSeed[] = [
  // === Day -29 ~ Day -1：构造"1.28M" 自然累积 ===
  // DeepSeek 主力（58%）
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'ai_chat', inputTokens: 2400, outputTokens: 1800, costUsd: 0.0007, daysAgo: 29, hourOfDay: 10, durationMs: 4200 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'ai_chat', inputTokens: 3200, outputTokens: 2100, costUsd: 0.0009, daysAgo: 29, hourOfDay: 14, durationMs: 5100 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'card_review_gen', inputTokens: 1800, outputTokens: 1200, costUsd: 0.0005, daysAgo: 28, hourOfDay: 9, durationMs: 3200 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'ai_chat', inputTokens: 2900, outputTokens: 1950, costUsd: 0.0008, daysAgo: 28, hourOfDay: 15, durationMs: 4800 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'knowledge_card', inputTokens: 3600, outputTokens: 2400, costUsd: 0.001, daysAgo: 27, hourOfDay: 11, durationMs: 5800 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'ai_chat', inputTokens: 2200, outputTokens: 1500, costUsd: 0.0006, daysAgo: 27, hourOfDay: 16, durationMs: 3900 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'summarize', inputTokens: 4500, outputTokens: 1100, costUsd: 0.0009, daysAgo: 26, hourOfDay: 10, durationMs: 6500 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'ai_chat', inputTokens: 3100, outputTokens: 2200, costUsd: 0.0009, daysAgo: 25, hourOfDay: 11, durationMs: 4900 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'ai_chat', inputTokens: 2800, outputTokens: 1900, costUsd: 0.0008, daysAgo: 24, hourOfDay: 14, durationMs: 4500 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'card_review_gen', inputTokens: 1900, outputTokens: 1300, costUsd: 0.0005, daysAgo: 23, hourOfDay: 9, durationMs: 3300 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'ai_chat', inputTokens: 3500, outputTokens: 2300, costUsd: 0.001, daysAgo: 22, hourOfDay: 13, durationMs: 5500 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'knowledge_card', inputTokens: 4100, outputTokens: 2700, costUsd: 0.0011, daysAgo: 21, hourOfDay: 10, durationMs: 6200 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'ai_chat', inputTokens: 2700, outputTokens: 1800, costUsd: 0.0007, daysAgo: 20, hourOfDay: 15, durationMs: 4300 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'ai_chat', inputTokens: 3300, outputTokens: 2100, costUsd: 0.0009, daysAgo: 19, hourOfDay: 11, durationMs: 5100 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'card_review_gen', inputTokens: 2100, outputTokens: 1400, costUsd: 0.0006, daysAgo: 18, hourOfDay: 9, durationMs: 3600 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'ai_chat', inputTokens: 2900, outputTokens: 2000, costUsd: 0.0008, daysAgo: 17, hourOfDay: 14, durationMs: 4600 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'knowledge_card', inputTokens: 3800, outputTokens: 2500, costUsd: 0.001, daysAgo: 16, hourOfDay: 10, durationMs: 5900 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'ai_chat', inputTokens: 3200, outputTokens: 2200, costUsd: 0.0009, daysAgo: 15, hourOfDay: 11, durationMs: 5000 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'summarize', inputTokens: 4800, outputTokens: 1300, costUsd: 0.001, daysAgo: 14, hourOfDay: 13, durationMs: 6800 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'ai_chat', inputTokens: 2700, outputTokens: 1800, costUsd: 0.0007, daysAgo: 13, hourOfDay: 15, durationMs: 4400 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'ai_chat', inputTokens: 3400, outputTokens: 2300, costUsd: 0.001, daysAgo: 12, hourOfDay: 10, durationMs: 5300 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'card_review_gen', inputTokens: 2000, outputTokens: 1300, costUsd: 0.0005, daysAgo: 11, hourOfDay: 9, durationMs: 3500 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'ai_chat', inputTokens: 2900, outputTokens: 1900, costUsd: 0.0008, daysAgo: 10, hourOfDay: 14, durationMs: 4700 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'knowledge_card', inputTokens: 4200, outputTokens: 2800, costUsd: 0.0012, daysAgo: 9, hourOfDay: 11, durationMs: 6500 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'ai_chat', inputTokens: 3100, outputTokens: 2100, costUsd: 0.0009, daysAgo: 8, hourOfDay: 16, durationMs: 4900 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'ai_chat', inputTokens: 2800, outputTokens: 1900, costUsd: 0.0008, daysAgo: 7, hourOfDay: 13, durationMs: 4500 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'card_review_gen', inputTokens: 2200, outputTokens: 1500, costUsd: 0.0006, daysAgo: 6, hourOfDay: 9, durationMs: 3800 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'ai_chat', inputTokens: 3500, outputTokens: 2400, costUsd: 0.001, daysAgo: 5, hourOfDay: 15, durationMs: 5500 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'knowledge_card', inputTokens: 4000, outputTokens: 2600, costUsd: 0.0011, daysAgo: 4, hourOfDay: 10, durationMs: 6100 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'ai_chat', inputTokens: 3000, outputTokens: 2000, costUsd: 0.0008, daysAgo: 3, hourOfDay: 14, durationMs: 4800 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'ai_chat', inputTokens: 2700, outputTokens: 1800, costUsd: 0.0007, daysAgo: 2, hourOfDay: 11, durationMs: 4400 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'card_review_gen', inputTokens: 2100, outputTokens: 1400, costUsd: 0.0006, daysAgo: 1, hourOfDay: 9, durationMs: 3600 },
  { provider: 'DeepSeek', model: 'deepseek-chat', feature: 'ai_chat', inputTokens: 3300, outputTokens: 2200, costUsd: 0.0009, daysAgo: 0, hourOfDay: 10, durationMs: 5200 },

  // 火山引擎（豆包）（32%）
  { provider: '火山引擎', model: 'doubao-pro-32k', feature: 'ai_chat', inputTokens: 2800, outputTokens: 1900, costUsd: 0.0005, daysAgo: 28, hourOfDay: 16, durationMs: 4500 },
  { provider: '火山引擎', model: 'doubao-pro-32k', feature: 'knowledge_card', inputTokens: 3600, outputTokens: 2400, costUsd: 0.0007, daysAgo: 26, hourOfDay: 11, durationMs: 5800 },
  { provider: '火山引擎', model: 'doubao-pro-32k', feature: 'ai_chat', inputTokens: 3100, outputTokens: 2100, costUsd: 0.0006, daysAgo: 25, hourOfDay: 14, durationMs: 5000 },
  { provider: '火山引擎', model: 'doubao-pro-32k', feature: 'ai_chat', inputTokens: 2900, outputTokens: 1900, costUsd: 0.0005, daysAgo: 23, hourOfDay: 10, durationMs: 4700 },
  { provider: '火山引擎', model: 'doubao-pro-32k', feature: 'summarize', inputTokens: 4500, outputTokens: 1100, costUsd: 0.0007, daysAgo: 21, hourOfDay: 13, durationMs: 6500 },
  { provider: '火山引擎', model: 'doubao-pro-32k', feature: 'ai_chat', inputTokens: 3300, outputTokens: 2200, costUsd: 0.0006, daysAgo: 19, hourOfDay: 15, durationMs: 5300 },
  { provider: '火山引擎', model: 'doubao-pro-32k', feature: 'card_review_gen', inputTokens: 2100, outputTokens: 1400, costUsd: 0.0004, daysAgo: 17, hourOfDay: 9, durationMs: 3500 },
  { provider: '火山引擎', model: 'doubao-pro-32k', feature: 'ai_chat', inputTokens: 3000, outputTokens: 2000, costUsd: 0.0006, daysAgo: 15, hourOfDay: 11, durationMs: 4800 },
  { provider: '火山引擎', model: 'doubao-pro-32k', feature: 'knowledge_card', inputTokens: 4100, outputTokens: 2700, costUsd: 0.0008, daysAgo: 13, hourOfDay: 10, durationMs: 6400 },
  { provider: '火山引擎', model: 'doubao-pro-32k', feature: 'ai_chat', inputTokens: 2700, outputTokens: 1800, costUsd: 0.0005, daysAgo: 11, hourOfDay: 14, durationMs: 4400 },
  { provider: '火山引擎', model: 'doubao-pro-32k', feature: 'ai_chat', inputTokens: 3500, outputTokens: 2300, costUsd: 0.0006, daysAgo: 9, hourOfDay: 15, durationMs: 5500 },
  { provider: '火山引擎', model: 'doubao-pro-32k', feature: 'summarize', inputTokens: 4800, outputTokens: 1200, costUsd: 0.0008, daysAgo: 7, hourOfDay: 13, durationMs: 7000 },
  { provider: '火山引擎', model: 'doubao-pro-32k', feature: 'ai_chat', inputTokens: 2900, outputTokens: 2000, costUsd: 0.0005, daysAgo: 5, hourOfDay: 16, durationMs: 4700 },
  { provider: '火山引擎', model: 'doubao-pro-32k', feature: 'ai_chat', inputTokens: 3200, outputTokens: 2100, costUsd: 0.0006, daysAgo: 3, hourOfDay: 11, durationMs: 5100 },
  { provider: '火山引擎', model: 'doubao-pro-32k', feature: 'card_review_gen', inputTokens: 2300, outputTokens: 1500, costUsd: 0.0004, daysAgo: 1, hourOfDay: 9, durationMs: 3800 },
  { provider: '火山引擎', model: 'doubao-pro-32k', feature: 'ai_chat', inputTokens: 2800, outputTokens: 1800, costUsd: 0.0005, daysAgo: 0, hourOfDay: 14, durationMs: 4500 },

  // OpenAI（10%）
  { provider: 'OpenAI', model: 'gpt-4o-mini', feature: 'ai_chat', inputTokens: 1800, outputTokens: 1200, costUsd: 0.0006, daysAgo: 27, hourOfDay: 14, durationMs: 3800 },
  { provider: 'OpenAI', model: 'gpt-4o-mini', feature: 'knowledge_card', inputTokens: 2200, outputTokens: 1500, costUsd: 0.0007, daysAgo: 22, hourOfDay: 11, durationMs: 4500 },
  { provider: 'OpenAI', model: 'gpt-4o', feature: 'ai_chat', inputTokens: 3200, outputTokens: 2100, costUsd: 0.005, daysAgo: 18, hourOfDay: 15, durationMs: 5500 },
  { provider: 'OpenAI', model: 'gpt-4o-mini', feature: 'ai_chat', inputTokens: 1900, outputTokens: 1300, costUsd: 0.0006, daysAgo: 14, hourOfDay: 13, durationMs: 4000 },
  { provider: 'OpenAI', model: 'gpt-4o-mini', feature: 'card_review_gen', inputTokens: 2100, outputTokens: 1400, costUsd: 0.0007, daysAgo: 10, hourOfDay: 9, durationMs: 4200 },
  { provider: 'OpenAI', model: 'gpt-4o', feature: 'summarize', inputTokens: 4500, outputTokens: 1100, costUsd: 0.007, daysAgo: 6, hourOfDay: 10, durationMs: 7800 },
  { provider: 'OpenAI', model: 'gpt-4o-mini', feature: 'ai_chat', inputTokens: 2400, outputTokens: 1600, costUsd: 0.0008, daysAgo: 4, hourOfDay: 14, durationMs: 4800 },
  { provider: 'OpenAI', model: 'gpt-4o-mini', feature: 'ai_chat', inputTokens: 2100, outputTokens: 1400, costUsd: 0.0006, daysAgo: 0, hourOfDay: 11, durationMs: 4300 },
];

// ---------- 自动生成补充 Token 记录，让总数达到 ~1.28M ----------
// 30 天 × ~4 次/天 = ~120 条，每条 ~5500 tokens ≈ 660K
// 加上 TOKEN_SEEDS 里的 53 条手工记录，总计 ~1.28M
function generateExtraTokenRecords(): TokenSeed[] {
  const records: TokenSeed[] = [];
  const providers: Array<{ provider: TokenSeed['provider']; model: string; weight: number }> = [
    { provider: 'DeepSeek', model: 'deepseek-chat', weight: 0.58 },
    { provider: '火山引擎', model: 'doubao-pro-32k', weight: 0.32 },
    { provider: 'OpenAI', model: 'gpt-4o-mini', weight: 0.10 },
  ];
  const features: Array<{ feature: TokenSeed['feature']; inputRange: [number, number]; outputRange: [number, number] }> = [
    { feature: 'ai_chat',         inputRange: [4000, 8200],  outputRange: [2700, 5000] },
    { feature: 'card_review_gen', inputRange: [2900, 5000],  outputRange: [1700, 3100] },
    { feature: 'knowledge_card',  inputRange: [5300, 8700],  outputRange: [3500, 5500] },
    { feature: 'summarize',       inputRange: [6200, 9000],  outputRange: [1600, 2800] },
  ];

  for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
    // 工作日多一点、周末少一点
    const dayOfWeek = (new Date(DEMO_TODAY_ISO).getUTCDay() - daysAgo + 7) % 7;
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    let callsPerDay = isWeekend ? 2 : 4;

    for (let i = 0; i < callsPerDay; i++) {
      const r = Math.random();
      let pIdx = 0;
      let cum = 0;
      for (let j = 0; j < providers.length; j++) {
        cum += providers[j].weight;
        if (r <= cum) { pIdx = j; break; }
      }
      const p = providers[pIdx];

      const f = features[Math.floor(Math.random() * features.length)];
      const input = Math.floor(f.inputRange[0] + Math.random() * (f.inputRange[1] - f.inputRange[0]));
      const output = Math.floor(f.outputRange[0] + Math.random() * (f.outputRange[1] - f.outputRange[0]));
      const costUsd = p.provider === 'OpenAI' && p.model.includes('mini') ? 0.0006 : p.provider === 'OpenAI' ? 0.005 : 0.0006;
      const hourOfDay = 9 + Math.floor(Math.random() * 9);
      const durationMs = 3000 + Math.floor(Math.random() * 4000);

      records.push({
        provider: p.provider,
        model: p.model,
        feature: f.feature,
        inputTokens: input,
        outputTokens: output,
        costUsd,
        daysAgo,
        hourOfDay,
        durationMs,
      });
    }
  }
  return records;
}

const EXTRA_TOKEN_RECORDS = generateExtraTokenRecords();

// ============================================================================
// 主流程
// ============================================================================

async function main() {
  console.log('🚀 知行读书 — 演示数据 Seeder 启动\n');
  console.log(`   WASM dir : ${WASM_DIR}`);
  console.log(`   Output   : ${OUTPUT_PATH}`);
  console.log(`   Demo day : ${DEMO_TODAY}\n`);

  // 1. 加载 sql.js
  console.log('📦 加载 sql.js WASM...');
  const SQL: SqlJsStatic = await initSqlJs({
    locateFile: (filename: string) => path.join(WASM_DIR, filename),
  });
  console.log('   ✓ sql.js loaded\n');

  // 2. 创建内存数据库 + schema
  console.log('🗄️  建表...');
  const db: Database = new SQL.Database();
  for (const stmt of SCHEMA_STATEMENTS) {
    db.run(stmt);
  }
  console.log(`   ✓ ${SCHEMA_STATEMENTS.length} 条 SQL 已执行\n`);

  // 3. 写入书籍 + 划线 + 复习卡
  console.log('📚 写入书籍与划线...');
  let totalHighlights = 0;
  let totalCards = 0;
  let totalReviews = 0;

  // 演示所需 FSRS 状态精确分布（68 张卡 = 3+5+12+3+45）
  // 索引 → 状态：New=0, Learning=1, Review=2, Relearning=3, Mastered=4
  // 0..2    New        (3 张)
  // 3..7    Learning   (5 张)
  // 8..19   Review     (12 张)
  // 20..22  Relearning (3 张)
  // 23..67  Mastered   (45 张)
  const STATE_DISTRIBUTION: Array<0 | 1 | 2 | 3 | 4> = [
    0, 0, 0,                                                  // New ×3
    1, 1, 1, 1, 1,                                            // Learning ×5
    2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2,                      // Review ×12
    3, 3, 3,                                                  // Relearning ×3
    ...Array(45).fill(4),                                     // Mastered ×45
  ];

  // 处理单条 highlight + card（提取出来让 EXTRA_HIGHLIGHTS 复用）
  function insertHighlight(h: HighlightSeed, bookId: string): void {
    // 根据当前索引强制使用 STATE_DISTRIBUTION 中的目标状态
    // （忽略 highlight seed 中的 cardState 字段，确保精确分布）
    const idx = totalHighlights;
    const targetState: 0 | 1 | 2 | 3 | 4 = STATE_DISTRIBUTION[idx] ?? 4;
    // Mastered 卡用 6 次 Good 保证达到稳定 Review 状态
    const reviewCount = targetState === 4 ? 6 : (h.reviewCount ?? 3);

    const hlCreated = dateNDaysAgo(7 - (totalHighlights % 7), true);
    db.run(
      `INSERT OR REPLACE INTO highlights (id, book_id, chapter_title, content, note, style, range_start, range_end, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [h.id, bookId, h.chapter, h.content, h.note, 0, 'pos-0', 'pos-0', hlCreated, hlCreated],
    );
    totalHighlights++;

    // 为每条划线创建复习卡
    const cardId = newId('card', totalCards);
    const reviewTime = new Date(DEMO_TODAY_ISO);
    let fsrsCard: FsrsCard;

    if (targetState === 4) {
      // Mastered：连续 Good 6 次（60 天跨度），到达高稳定 Review 状态
      const startTime = new Date(DEMO_TODAY_ISO);
      startTime.setUTCDate(startTime.getUTCDate() - 60);
      fsrsCard = simulateMatureCard(h.id, cardId, reviewCount, startTime);
    } else {
      // 用一次性 review() 推算到目标状态
      let card = createEmptyCard();
      card.due = new Date(DEMO_TODAY_ISO);

      if (targetState === 0) {
        // New：空卡，不复习
        fsrsCard = card;
      } else if (targetState === 1) {
        // Learning：1 次 Good
        const result = fsrs.next(card, reviewTime, FsrsRating.Good);
        fsrsCard = result.card;
      } else if (targetState === 2) {
        // Review：先过 Learning 阶段，再多次 Good 推到 Review
        const result1 = fsrs.next(card, reviewTime, FsrsRating.Good);
        const r2Time = new Date(reviewTime);
        r2Time.setUTCMinutes(r2Time.getUTCMinutes() + 10);
        const result2 = fsrs.next(result1.card, r2Time, FsrsRating.Good);
        const r3Time = new Date(r2Time);
        r3Time.setUTCMinutes(r3Time.getUTCMinutes() + 10);
        const result3 = fsrs.next(result2.card, r3Time, FsrsRating.Good);
        let current = result3.card;
        for (let i = 0; i < reviewCount; i++) {
          const t = new Date(r3Time);
          t.setUTCDate(t.getUTCDate() + (i + 1) * 4);
          current = fsrs.next(current, t, FsrsRating.Good).card;
        }
        fsrsCard = current;
      } else {
        // Relearning：先过完 Learning/Review，然后 1 次 Again 回到 Relearning
        const r1 = fsrs.next(card, reviewTime, FsrsRating.Good);
        const r2Time = new Date(reviewTime);
        r2Time.setUTCMinutes(r2Time.getUTCMinutes() + 10);
        const r2 = fsrs.next(r1.card, r2Time, FsrsRating.Good);
        const r3Time = new Date(r2Time);
        r3Time.setUTCMinutes(r3Time.getUTCMinutes() + 10);
        const r3 = fsrs.next(r2.card, r3Time, FsrsRating.Good);
        const r4Time = new Date(r3Time);
        r4Time.setUTCDate(r4Time.getUTCDate() + 5);
        const r4 = fsrs.next(r3.card, r4Time, FsrsRating.Again);
        fsrsCard = r4.card;
      }
    }

    // 强制让所有"应到期"卡的 due 落在合适时间
    if (targetState !== 0 && targetState !== 3) {
      const due = new Date(DEMO_TODAY_ISO);
      if (targetState === 4) {
        // Mastered：未来 30 天到期（不要阻塞"今日待复习"）
        due.setUTCDate(due.getUTCDate() + 30);
      } else if (targetState === 2) {
        // Review：未来 1-3 天到期（形成"即将到期"队列）
        due.setUTCDate(due.getUTCDate() + 2);
      } else {
        due.setUTCHours(due.getUTCHours() + 2);
      }
      fsrsCard = { ...fsrsCard, due };
    } else if (targetState === 3) {
      // Relearning：5 分钟后到期
      fsrsCard = { ...fsrsCard, due: new Date(dateNMinutesFromNow(5)) };
    } else if (targetState === 0) {
      // New：今天到期
      fsrsCard = { ...fsrsCard, due: new Date(DEMO_TODAY_ISO) };
    }

    // 强制写入 STATE_DISTRIBUTION 指定的目标状态（覆盖 ts-fsrs 的真实状态）
    // 原因：ts-fsrs 没有 Mastered 状态，模拟 6 次 Good 后状态仍是 Review=2
    // 演示要求 New=3 / Learning=5 / Review=12 / Relearning=3 / Mastered=45
    const row = fsrsCardToRow(fsrsCard, h.id, cardId, DEMO_TODAY_ISO);
    const finalState = targetState; // 覆盖 row.state，使用 STATE_DISTRIBUTION
    // Mastered → mastery_level=100；其他按 reviewCount 比例
    const masteryLevel = targetState === 4 ? 100 : Math.min(95, Math.max(5, reviewCount * 18));
    // Mastered 卡的 stability/difficulty/scheduled_days 调大，让 FSRS UI 显示更真实
    let finalStability = row.stability;
    let finalDifficulty = row.difficulty;
    let finalScheduled = row.scheduled_days;
    if (targetState === 4) {
      finalStability = Math.max(finalStability, 90);
      finalDifficulty = Math.min(finalDifficulty, 4.5);
      finalScheduled = Math.max(finalScheduled, 30);
    } else if (targetState === 2) {
      finalScheduled = Math.max(finalScheduled, 2);
    }
    db.run(
      `INSERT OR REPLACE INTO cards (id, highlight_id, state, step, stability, difficulty, due, last_review, elapsed_days, scheduled_days, reps, lapses, application_tag, mastery_level, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [row.id, row.highlight_id, finalState, row.step, finalStability, finalDifficulty, row.due, row.last_review, row.elapsed_days, finalScheduled, row.reps, row.lapses, h.tag, masteryLevel, row.created_at],
    );
    totalCards++;

    // Mastered 卡补一些 review 历史
    if (targetState === 4) {
      for (let i = 0; i < reviewCount; i++) {
        const reviewAt = new Date(DEMO_TODAY_ISO);
        reviewAt.setUTCDate(reviewAt.getUTCDate() - (reviewCount - i) * 4);
        db.run(
          `INSERT OR REPLACE INTO reviews (id, card_id, rating, review_time, elapsed_days, scheduled_days)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [newId('review', totalReviews), cardId, 3, reviewAt.toISOString(), i * 4, 4],
        );
        totalReviews++;
      }
    }
  }

  for (const book of BOOKS) {
    const lastRead = dateNDaysAgo(book.lastReadDaysAgo, true);
    db.run(
      `INSERT OR REPLACE INTO books (id, title, author, cover, description, category, reading_progress, total_chapter, last_read_time, is_finished, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        book.id, book.title, book.author, book.cover, book.description,
        book.category, book.readingProgress, 12, lastRead, book.isFinished,
        dateNDaysAgo(30, true), lastRead,
      ],
    );

    for (const h of book.highlights) {
      insertHighlight(h, book.id);
    }
  }

  // 处理 EXTRA_HIGHLIGHTS（按 _bookId 字段归类）
  for (const h of EXTRA_HIGHLIGHTS) {
    const bookId = (h as HighlightSeed & { _bookId?: string })._bookId;
    if (!bookId) continue;
    insertHighlight(h, bookId);
  }

  console.log(`   ✓ ${BOOKS.length} 本书，${totalHighlights} 条划线，${totalCards} 张复习卡，${totalReviews} 条 review\n`);

  // 4. 写入知识卡（每本书的 + 全局）
  console.log('🃏 写入知识卡...');
  let kcCount = 0;

  function insertKnowledgeCard(card: {
    bookId: string;
    type: 'concept' | 'methodology' | 'quote';
    title: string;
    content: string;
    interpretation: string;
    application: string;
    tags: string[];
    masteryLevel: number;
  }) {
    db.run(
      `INSERT OR REPLACE INTO knowledge_cards (id, book_id, type, title, content, interpretation, application, related_card_ids, tags, review_count, mastery_level, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        newId('knowledge', kcCount), card.bookId, card.type, card.title, card.content,
        card.interpretation, card.application, null,
        JSON.stringify(card.tags), Math.max(0, card.masteryLevel - 5), card.masteryLevel,
        dateNDaysAgo(20, true), dateNDaysAgo(2, true),
      ],
    );
    kcCount++;
  }

  for (const book of BOOKS) {
    for (const kc of book.knowledgeCards ?? []) {
      insertKnowledgeCard({ bookId: book.id, ...kc });
    }
  }
  for (const kc of GLOBAL_KNOWLEDGE_CARDS) {
    insertKnowledgeCard(kc);
  }
  console.log(`   ✓ ${kcCount} 张知识卡\n`);

  // 5. 写入方法论
  console.log('🛠️  写入方法论...');
  let mtCount = 0;
  for (const book of BOOKS) {
    for (const m of book.methodologies ?? []) {
      db.run(
        `INSERT OR REPLACE INTO methodologies (id, book_id, name, name_en, trigger_scenario, description, steps, output_format, examples, tags, source_highlight_ids, mastery_level, practice_count, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newId('knowledge', 9000 + mtCount), book.id, m.name, m.nameEn, m.triggerScenario,
          m.description, JSON.stringify(m.steps), m.outputFormat, m.examples,
          JSON.stringify(m.tags), null, m.masteryLevel, m.practiceCount,
          dateNDaysAgo(15, true), dateNDaysAgo(1, true),
        ],
      );
      mtCount++;
    }
  }
  console.log(`   ✓ ${mtCount} 条方法论\n`);

  // 6. 写入 daily_stats（7 天复习曲线）
  console.log('📊 写入每日统计...');
  const REVIEW_BY_DAY: Array<[number, number, number]> = [
    // [daysAgo, cardsReviewed, readingTime(seconds)]
    [6, 45, 32 * 60],
    [5, 67, 48 * 60],
    [4, 87, 62 * 60],
    [3, 72, 51 * 60],
    [2, 58, 41 * 60],
    [1, 81, 58 * 60],
    [0, 69, 49 * 60],
  ];
  for (const [daysAgo, reviewed, time] of REVIEW_BY_DAY) {
    const date = dateNDaysAgo(daysAgo);
    db.run(
      `INSERT OR REPLACE INTO daily_stats (id, date, books_read, highlights_added, cards_reviewed, reading_time, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [`demo-stat-${date}`, date, 1, 2, reviewed, time, `${date}T10:00:00.000Z`],
    );
  }
  console.log(`   ✓ ${REVIEW_BY_DAY.length} 天数据\n`);

  // 7. 写入 token_usage（手工 + 自动生成，让总数达到 ~1.28M）
  console.log('💰 写入 Token 用量...');
  let totalTokens = 0;
  let tokenCount = 0;
  const allTokenRecords = [...TOKEN_SEEDS, ...EXTRA_TOKEN_RECORDS];
  for (const t of allTokenRecords) {
    const createdAt = new Date(DEMO_TODAY_ISO);
    createdAt.setUTCDate(createdAt.getUTCDate() - t.daysAgo);
    createdAt.setUTCHours(t.hourOfDay, Math.floor(Math.random() * 60), 0, 0);
    const total = t.inputTokens + t.outputTokens;
    totalTokens += total;
    tokenCount++;
    db.run(
      `INSERT OR REPLACE INTO token_usage (id, provider, model, feature, input_tokens, output_tokens, total_tokens, cost_usd, duration_ms, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId('token', tokenCount), t.provider, t.model, t.feature, t.inputTokens, t.outputTokens, total, t.costUsd, t.durationMs, createdAt.toISOString()],
    );
  }
  console.log(`   ✓ ${tokenCount} 条记录，累计 ${totalTokens.toLocaleString()} tokens\n`);

  // 8. 写入 AI 对话
  console.log('💬 写入 AI 对话历史...');
  // 7-08 历史问答
  const conv1Id = 'demo-conv-001';
  db.run(
    `INSERT OR REPLACE INTO conversations (id, title, book_id, created_at, updated_at, message_count)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [conv1Id, '《深度工作》阅读答疑', 'demo-book-001', '2026-07-08T15:30:00.000Z', '2026-07-08T15:35:00.000Z', 2],
  );
  // 早期用户提问
  db.run(
    `INSERT OR REPLACE INTO chat_messages (id, conversation_id, role, content, intent, bloom_level, sources, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'demo-msg-h1u', conv1Id, 'user',
      '注意力残留具体怎么测量？能用工具量化吗？',
      'clarification', 3,
      JSON.stringify([{ type: 'highlight', highlightId: 'demo-hl-002' }]),
      '2026-07-08T15:30:00.000Z',
    ],
  );
  // 早期 AI 回答
  db.run(
    `INSERT OR REPLACE INTO chat_messages (id, conversation_id, role, content, intent, bloom_level, sources, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'demo-msg-h1a', conv1Id, 'assistant',
      'Cal Newport 没有给出精确测量方法，但认知科学研究显示：任务切换后的前 23 分钟，前额叶皮层仍处于"残留激活"状态——这正是你提到的"开完会后感觉更累"的生理基础。\n\n可量化的间接指标：\n1. 单次深度时段长度（>90 分钟才能完全切换）\n2. 心率变异性（HRV）：切换任务时下降 15-20%\n3. 主观疲劳度（NASA-TLX 任务负荷指数）\n\n实操建议：与其测量"残留"，不如减少切换——每天固定 2 个 90 分钟深度时段，IM/邮件仅在深度时段外处理。',
      'deep_discussion', 4,
      JSON.stringify([
        { type: 'highlight', highlightId: 'demo-hl-002' },
        { type: 'methodology', bookId: 'demo-book-001' },
      ]),
      '2026-07-08T15:32:00.000Z',
    ],
  );

  // 当前会话（演示用）
  const conv2Id = 'demo-conv-002';
  db.run(
    `INSERT OR REPLACE INTO conversations (id, title, book_id, created_at, updated_at, message_count)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [conv2Id, '《深度工作》阅读答疑 · 续', 'demo-book-001', '2026-07-20T10:30:00.000Z', '2026-07-20T10:35:00.000Z', 2],
  );
  db.run(
    `INSERT OR REPLACE INTO chat_messages (id, conversation_id, role, content, intent, bloom_level, sources, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'demo-msg-c2u', conv2Id, 'user',
      '深度工作里"有意义的深度"和"肤浅的深度"怎么区分？',
      'deep_discussion', 4,
      null,
      '2026-07-20T10:30:00.000Z',
    ],
  );
  db.run(
    `INSERT OR REPLACE INTO chat_messages (id, conversation_id, role, content, intent, bloom_level, mastery_assessment, sources, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      'demo-msg-c2a', conv2Id, 'assistant',
      '在 Cal Newport 的框架里，"有意义的深度"（深度 smart）指能创造新价值、契合个人使命的工作；而"肤浅的深度"（肤浅 busy）只是用战术忙碌逃避战略思考。\n\n【方法论引用 · 来自《深度工作》第 4 章】：作者用"注意力残留"解释为什么肤浅任务越忙越累——切换任务时，前一任务的注意力残片会让大脑无法彻底恢复。这正是你 7 月 8 日追问过的概念。\n\n实操建议：\n① 每天固定 2 个 90 分钟"深度时段"；\n② 用"4DX 法则"衡量——只有同时满足「重要指标 + 领先指标 + 影响力 + 问责制」的任务，才算"有意义的深度"。\n\n（上下文：已加载 3 维——书籍、方法论、历史记忆；懒加载 2 维——知识卡片、用户画像）',
      'deep_discussion', 5,
      JSON.stringify({ book: 'demo-book-001', methodology: '+12%' }),
      JSON.stringify([
        { type: 'highlight', highlightId: 'demo-hl-001' },
        { type: 'highlight', highlightId: 'demo-hl-002' },
        { type: 'methodology', bookId: 'demo-book-001' },
        { type: 'memory', memoryId: 'demo-mem-001' },
      ]),
      '2026-07-20T10:31:00.000Z',
    ],
  );
  console.log('   ✓ 2 个对话，4 条消息\n');

  // 9. 写入记忆（演示 5 维 ContextBuilder 的"历史记忆"维度）
  console.log('🧠 写入 AI 记忆...');
  const memories: Array<{ type: string; category: string; content: string; importance: number }> = [
    { type: 'preference', category: 'study_style', content: '用户偏好用 OFNR 框架拆解沟通问题', importance: 0.7 },
    { type: 'insight', category: 'focus_pattern', content: '用户每天 10-12 点效率最高；14-16 点效率其次', importance: 0.85 },
    { type: 'insight', category: 'reading_habit', content: '用户平均每天读 1.5 小时，集中在通勤和睡前', importance: 0.6 },
    { type: 'preference', category: 'review_style', content: '用户更喜欢"主动回忆两段法"而非直接看答案', importance: 0.75 },
    { type: 'interaction', category: 'frequent_topic', content: '用户经常追问《深度工作》《原子习惯》', importance: 0.8 },
    { type: 'achievement', category: 'streak', content: '用户连续 14 天完成复习', importance: 0.9 },
  ];
  memories.forEach((m, i) => {
    db.run(
      `INSERT OR REPLACE INTO memories (id, type, category, content, importance, access_count, created_at, last_accessed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [`demo-mem-${String(i + 1).padStart(3, '0')}`, m.type, m.category, m.content, m.importance, Math.floor(Math.random() * 10) + 1, dateNDaysAgo(20, true), dateNHoursAgo(2)],
    );
  });
  console.log(`   ✓ ${memories.length} 条记忆\n`);

  // 10. 写入用户画像
  console.log('👤 写入用户画像...');
  const profiles: Array<[string, string]> = [
    ['display_name', '张子涵'],
    ['current_streak', '14'],
    ['total_review_count', '479'],
    ['mastery_threshold', '85'],
    ['preferred_session_minutes', '25'],
  ];
  for (const [k, v] of profiles) {
    db.run(
      `INSERT OR REPLACE INTO user_profiles (key, value, updated_at) VALUES (?, ?, ?)`,
      [k, v, dateNHoursAgo(1)],
    );
  }
  console.log(`   ✓ ${profiles.length} 个 profile\n`);

  // 11. 写入每日学习文章 + 生词本（让 ECDICT 悬停查词有内容）
  console.log('📰 写入每日学习文章...');
  const articleId = 'demo-art-001';
  const articleEn = `The Power of Deep Work in a Distracted World

In an era of constant notifications, the ability to engage in deep work has become a rare and valuable skill. Cal Newport, the author of "Deep Work," argues that the capacity to focus without distraction on cognitively demanding tasks is a superpower in the 21st century.

The opposite of deep work is what researchers call "cognitive residue"—the lingering mental traces of one task that interfere with our ability to transition smoothly to the next. Every time we switch from checking email to writing a report to scrolling social media, our brain pays a hidden tax.

Procrastination, meanwhile, is not a failure of willpower but a symptom of poor emotional regulation. When faced with an overwhelming task, our brain seeks the immediate relief of distraction, even when we know it's against our long-term interests.

The antidote? Deliberate practice with structure: choose a meaningful task, eliminate distractions, work in 90-minute focused blocks, and reflect on the process afterward. This is not merely about productivity—it's about reclaiming the capacity for sustained attention that distinguishes human expertise from mechanical processing.`;

  db.run(
    `INSERT OR REPLACE INTO articles (id, title_en, title_zh, content_en, content_zh, summary_zh, source, source_url, source_website, category, difficulty, vocabulary_json, is_read, is_favorite, read_time, created_at, published_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      articleId,
      'The Power of Deep Work in a Distracted World',
      '分心世界中的深度工作力量',
      articleEn,
      '在持续不断的通知时代，能够进行深度工作的能力已成为一项稀缺而有价值的技能。Cal Newport 在《深度工作》中认为，专注处理认知要求高的任务而免受干扰，是 21 世纪的超能力。\n\n深度工作的对立面是研究人员所称的"认知残留"——前一个任务在头脑中挥之不去的痕迹，干扰我们顺利过渡到下一个任务。每次我们从查看邮件切换到撰写报告，再到刷社交媒体，我们的大脑都支付着隐形的税。\n\n拖延不是意志力的失败，而是情绪调节能力低下的症状。当面对压倒性的任务时，我们的大脑会寻求分心带来的即时慰藉，即使我们知道这违背了我们的长期利益。\n\n解药是什么？结构化的刻意练习：选择有意义的任务、消除干扰、以 90 分钟为单元工作、之后反思过程。这不仅仅是关于生产力，而是关于夺回那种持续专注的能力——它使人类的专业知识区别于机械的加工。',
      '分心时代里，深度工作 = 21 世纪超能力。本文解读 Cal Newport 的"认知残留"概念，以及为什么拖延是情绪问题而非意志力问题。',
      'Harvard Business Review',
      'https://hbr.org/demo/deep-work',
      'hbr.org',
      'psychology',
      'cet6',
      JSON.stringify([
        { word: 'procrastination', meaning: '拖延' },
        { word: 'deliberate', meaning: '刻意的' },
        { word: 'cognitive', meaning: '认知的' },
        { word: 'residue', meaning: '残留物' },
        { word: 'distraction', meaning: '分心' },
      ]),
      0, 0, 8,
      '2026-07-20T08:00:00.000Z',
      '2026-07-19T00:00:00.000Z',
    ],
  );

  // 生词本：让 ECDICT 悬停查词有内容
  const vocabSeed: Array<[string, string, string, string, string, string, number]> = [
    ['procrastination', '/prəˌkræstɪˈneɪʃn/', 'n.', '拖延；耽搁', 'Stop procrastination and start your project today.', '停止拖延，从今天开始你的项目。', 3],
    ['deliberate', '/dɪˈlɪbərət/', 'adj.', '刻意的；深思熟虑的', 'Practice deliberate focus for 90 minutes.', '刻意练习 90 分钟的专注。', 2],
    ['cognitive', '/ˈkɑːɡnətɪv/', 'adj.', '认知的', 'Cognitive load can be measured scientifically.', '认知负荷可以科学测量。', 2],
    ['residue', '/ˈrezɪduː/', 'n.', '残留物；剩余', 'Mental residue affects the next task.', '心理残留影响下一个任务。', 1],
    ['distraction', '/dɪˈstrækʃn/', 'n.', '分心；干扰', 'Phone notifications are a major distraction.', '手机通知是主要干扰源。', 1],
    ['reclaim', '/rɪˈkleɪm/', 'v.', '取回；恢复', 'Reclaim your attention span through deep work.', '通过深度工作恢复你的注意力。', 0],
  ];
  vocabSeed.forEach((v, i) => {
    const nextReview = dateNDaysAgo(0);
    db.run(
      `INSERT OR REPLACE INTO vocabulary (id, word, phonetic, part_of_speech, meaning_zh, example_en, example_zh, cefr_level, source_article_id, source, is_mastered, review_count, last_review_at, next_review_at, ef_factor, interval_days, repetition_count, familiarity_level, learning_stage, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId('vocab', i), v[0], v[1], v[2], v[3], v[4], v[5], 'cet6', articleId, 'HBR', v[6] >= 3 ? 1 : 0, v[6], dateNDaysAgo(2, true), nextReview, 2.5, v[6], v[6], v[6] + 1, v[6] >= 2 ? 2 : 1, '2026-07-15T10:00:00.000Z'],
    );
  });
  console.log(`   ✓ 1 篇文章，${vocabSeed.length} 个生词\n`);

  // 12. 写入 Book Architecture（段 3 主用：《深度工作》）
  console.log('🏛️  写入书籍架构...');
  const archData: Array<{ bookId: string; coreProposition: string; cognitiveFramework: string; methodologyArchitecture: string; knowledgeHierarchy: string; targetAudience: string }> = [
    {
      bookId: 'demo-book-001',
      coreProposition: '深度工作（Deep Work）是 21 世纪最有价值的技能，通过刻意练习可以习得，且能创造稀缺价值。',
      cognitiveFramework: '认知科学 + 神经科学：注意力残留、前额叶皮层、习惯回路',
      methodologyArchitecture: '4 种深度工作哲学（禁欲/双峰/节奏/记者）+ 4DX 法则 + 拥抱无聊 + 远离社交媒体',
      knowledgeHierarchy: '概念层（深度工作/肤浅工作/注意力残留）→ 哲学层（4 种模式）→ 实践层（每日计划）',
      targetAudience: '知识工作者、程序员、作家、学者、任何需要"专注产出"的人',
    },
    {
      bookId: 'demo-book-003',
      coreProposition: '微小改变的复利 + 身份认同 + 4 法则 = 持久的行为改变。',
      cognitiveFramework: '行为心理学 + 神经可塑性：基底神经节、身份叙事、奖赏回路',
      methodologyArchitecture: '4 法则（提示-渴求-反应-奖励）+ 习惯堆叠 + 环境设计 + 身份驱动',
      knowledgeHierarchy: '基础（复利）→ 框架（4 法则）→ 进阶（身份）→ 工具（堆叠、契约）',
      targetAudience: '想养成好习惯/戒掉坏习惯的人、想长期自我提升的人',
    },
  ];
  archData.forEach((a, i) => {
    db.run(
      `INSERT OR REPLACE INTO book_architecture (id, book_id, core_proposition, cognitive_framework, methodology_architecture, knowledge_hierarchy, target_audience, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [newId('knowledge', 8000 + i), a.bookId, a.coreProposition, a.cognitiveFramework, a.methodologyArchitecture, a.knowledgeHierarchy, a.targetAudience, dateNDaysAgo(30, true), dateNDaysAgo(1, true)],
    );
  });
  console.log(`   ✓ ${archData.length} 份书籍架构\n`);

  // 13. 写入 Book Summary
  console.log('📖 写入书籍摘要...');
  const summaries: Array<{ bookId: string; summary: string; keyPoints: string }> = [
    {
      bookId: 'demo-book-001',
      summary: '《深度工作》系统论证了"深度专注"在分心时代的稀缺价值，提出 4 种可选择的工作哲学（禁欲/双峰/节奏/记者），并提供可操作的训练方法（拥抱无聊、远离社交媒体、4DX 法则）。',
      keyPoints: JSON.stringify(['深度工作 = 创造稀缺价值', '4 种工作哲学：禁欲/双峰/节奏/记者', '注意力残留 = 多任务的真实代价', '刻意练习可习得深度工作能力']),
    },
    {
      bookId: 'demo-book-003',
      summary: '《原子习惯》提出"微小改变 + 复利 + 身份认同"的习惯养成框架，核心 4 法则：让它显而易见、有吸引力、简便易行、令人愉悦。',
      keyPoints: JSON.stringify(['每天 1% 进步 → 1 年 37 倍', '4 法则：提示-渴求-反应-奖励', '身份比结果更持久', '习惯堆叠 + 环境设计']),
    },
  ];
  summaries.forEach((s, i) => {
    db.run(
      `INSERT OR REPLACE INTO book_summaries (id, book_id, summary, key_points, generated_at) VALUES (?, ?, ?, ?, ?)`,
      [newId('knowledge', 7000 + i), s.bookId, s.summary, s.keyPoints, dateNDaysAgo(15, true)],
    );
  });
  console.log(`   ✓ ${summaries.length} 篇摘要\n`);

  // 14. 落盘
  console.log('💾 写入文件...');
  if (!fs.existsSync(RESOURCES_DIR)) {
    fs.mkdirSync(RESOURCES_DIR, { recursive: true });
  }
  const data = db.export();
  fs.writeFileSync(OUTPUT_PATH, Buffer.from(data));
  db.close();
  const sizeKb = (data.length / 1024).toFixed(1);
  console.log(`   ✓ 已生成：${OUTPUT_PATH}（${sizeKb} KB）\n`);

  // 15. 输出统计
  console.log('═══════════════════════════════════════════');
  console.log('  📊 演示数据生成完毕');
  console.log('═══════════════════════════════════════════');
  console.log(`  📚 书籍         : ${BOOKS.length} 本`);
  console.log(`  ✏️  划线         : ${totalHighlights} 条`);
  console.log(`  🃏 复习卡        : ${totalCards} 张（含 50+ 演示态）`);
  console.log(`  📝 Reviews     : ${totalReviews} 条`);
  console.log(`  🧠 知识卡       : ${kcCount} 张（3 类）`);
  console.log(`  🛠️  方法论       : ${mtCount} 条`);
  console.log(`  💬 对话         : 2 个（4 条消息）`);
  console.log(`  🧩 记忆         : ${memories.length} 条`);
  console.log(`  💰 Token       : ${tokenCount} 条，累计 ${totalTokens.toLocaleString()} tokens`);
  console.log(`  📅 日统计       : ${REVIEW_BY_DAY.length} 天`);
  console.log(`  📰 每日学习     : 1 篇 HBR 文章 + ${vocabSeed.length} 生词`);
  console.log('═══════════════════════════════════════════');
  console.log('\n🎯 使用方法：');
  console.log('   # 复制到生产数据库路径（覆盖前请备份）：');
  console.log('   # Windows');
  console.log(`   copy /Y "${OUTPUT_PATH}" "%APPDATA%\\zhixing-reader\\zhixing.db"\n`);
  console.log('   # macOS');
  console.log(`   cp "${OUTPUT_PATH}" "$HOME/Library/Application Support/zhixing-reader/zhixing.db"\n`);
  console.log('   # 启动应用：');
  console.log('   npm run dev\n');
}

main().catch((err) => {
  console.error('❌ Seed failed:', err);
  process.exit(1);
});
