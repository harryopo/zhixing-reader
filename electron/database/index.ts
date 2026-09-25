/**
 * database/index — 统一出口
 *
 * 原单文件 database.ts（2400+ 行）按领域拆分至本目录：
 *   connection.ts  连接生命周期 / 事务 / 测试注入
 *   schema.ts      建表 / 初始化 / 幂等迁移 / 数据清理
 *   books.ts / highlights.ts / cards.ts / reviews.ts / summaries.ts
 *   chapter-summaries.ts
 *   daily-stats.ts / token-usage.ts / conversations.ts
 *   articles.ts / vocabulary.ts / methodologies.ts
 *   knowledge-cards.ts / memories.ts
 *
 * 对外 API 与拆分前完全一致，所有 `from '<...>/database'` 导入无需改动。
 */

export {
  getDatabasePath,
  forceSaveDatabase,
  getDatabase,
  runTransaction,
  runBatch,
  closeDatabase,
  injectTestDatabase,
  getTestDatabase,
  resetTestDatabaseState,
} from './connection';

export {
  initializeSchema,
  /** 建表 + 幂等迁移的唯一入口；生产 initDatabase 与测试 fixture 共用 */
  applySchemaAndMigrations,
  initDatabase,
  clearConversationsAndMessages,
  resetDatabase,
} from './schema';

export { booksDb } from './books';
export { highlightsDb } from './highlights';
export { cardsDb } from './cards';
export { reviewsDb } from './reviews';
export { bookSummariesDb } from './summaries';
export { chapterSummariesDb } from './chapter-summaries';
export type { ChapterSummaryRow, ChapterSummaryInput } from './chapter-summaries';
export { dailyStatsDb } from './daily-stats';
export { tokenUsageDb } from './token-usage';
export { conversationDb } from './conversations';
export { articlesDb } from './articles';
export { vocabularyDb } from './vocabulary';
export { methodologiesDb } from './methodologies';
export { knowledgeCardsDb } from './knowledge-cards';
export { aiBatchesDb } from './ai-batches';
export { memoriesDb } from './memories';
