/**
 * Repository 模块导出
 * 提供统一的导入入口
 */

// 基础类
export { BaseRepository, type DatabaseAccessor } from './base-repository'

// 具体实现
export { SqlBookRepository } from './book-repository'
export { SqlHighlightRepository } from './highlight-repository'
export { SqlCardRepository } from './card-repository'
export { SqlConversationRepository, SqlChatMessageRepository } from './conversation-repository'
export { SqlMethodologyRepository } from './methodology-repository'
export { SqlKnowledgeCardRepository } from './knowledge-card-repository'
export { SqlMemoryRepository } from './memory-repository'

// 工厂类
export { 
  RepositoryFactory,
  initRepositoryFactory,
  getRepositoryFactory,
  getRepositories 
} from './repository-factory'

// 类型定义
export type {
  IBaseRepository,
  IBookRepository,
  IHighlightRepository,
  ICardRepository,
  IConversationRepository,
  IChatMessageRepository,
  IMethodologyRepository,
  IKnowledgeCardRepository,
  IMemoryRepository,
  IVocabularyRepository,
  IArticleRepository,
  IBookArchitectureRepository,
  IBookSummaryRepository,
  IDailyStatsRepository,
  ITokenUsageRepository,
  IRepositoryContainer,
} from '../types/repositories'
