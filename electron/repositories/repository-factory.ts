/**
 * Repository 工厂
 * 管理 Repository 实例的创建和依赖注入
 */

import { Database } from 'sql.js'
import { IRepositoryContainer } from '../types/repositories'
import { SqlBookRepository } from './book-repository'
import { SqlHighlightRepository } from './highlight-repository'
import { SqlCardRepository } from './card-repository'
import { SqlConversationRepository, SqlChatMessageRepository } from './conversation-repository'
import { SqlMethodologyRepository } from './methodology-repository'
import { SqlKnowledgeCardRepository } from './knowledge-card-repository'
import { SqlMemoryRepository } from './memory-repository'
import { DatabaseAccessor } from './base-repository'

/**
 * Repository 工厂类
 * 使用单例模式管理 Repository 实例
 */
export class RepositoryFactory {
  private static instance: RepositoryFactory | null = null
  private container: IRepositoryContainer | null = null
  private getDb: DatabaseAccessor

  private constructor(getDb: DatabaseAccessor) {
    this.getDb = getDb
  }

  /**
   * 获取 RepositoryFactory 实例
   * @param getDb 数据库访问函数，首次调用时必须提供
   */
  static getInstance(getDb?: DatabaseAccessor): RepositoryFactory {
    if (!RepositoryFactory.instance) {
      if (!getDb) {
        throw new Error('Database accessor required for first initialization')
      }
      RepositoryFactory.instance = new RepositoryFactory(getDb)
    }
    return RepositoryFactory.instance
  }

  /**
   * 重置工厂实例（用于测试）
   */
  static resetInstance(): void {
    RepositoryFactory.instance = null
  }

  /**
   * 获取 Repository 容器
   */
  getContainer(): IRepositoryContainer {
    if (!this.container) {
      this.container = this.createContainer()
    }
    return this.container
  }

  /**
   * 创建 Repository 容器
   */
  private createContainer(): IRepositoryContainer {
    return {
      books: new SqlBookRepository(this.getDb),
      highlights: new SqlHighlightRepository(this.getDb),
      cards: new SqlCardRepository(this.getDb),
      conversations: new SqlConversationRepository(this.getDb),
      chatMessages: new SqlChatMessageRepository(this.getDb),
      methodologies: new SqlMethodologyRepository(this.getDb),
      knowledgeCards: new SqlKnowledgeCardRepository(this.getDb),
      memories: new SqlMemoryRepository(this.getDb),
      // 其他 Repository 可以在这里添加
      vocabulary: {} as any, // TODO: 实现
      articles: {} as any, // TODO: 实现
      bookArchitecture: {} as any, // TODO: 实现
      bookSummaries: {} as any, // TODO: 实现
      dailyStats: {} as any, // TODO: 实现
      tokenUsage: {} as any, // TODO: 实现
    }
  }

  /**
   * 获取书籍 Repository
   */
  getBookRepository(): SqlBookRepository {
    return this.getContainer().books as SqlBookRepository
  }

  /**
   * 获取高亮 Repository
   */
  getHighlightRepository(): SqlHighlightRepository {
    return this.getContainer().highlights as SqlHighlightRepository
  }

  /**
   * 获取卡片 Repository
   */
  getCardRepository(): SqlCardRepository {
    return this.getContainer().cards as SqlCardRepository
  }

  /**
   * 获取对话 Repository
   */
  getConversationRepository(): SqlConversationRepository {
    return this.getContainer().conversations as SqlConversationRepository
  }

  /**
   * 获取聊天消息 Repository
   */
  getChatMessageRepository(): SqlChatMessageRepository {
    return this.getContainer().chatMessages as SqlChatMessageRepository
  }

  /**
   * 获取方法论 Repository
   */
  getMethodologyRepository(): SqlMethodologyRepository {
    return this.getContainer().methodologies as SqlMethodologyRepository
  }

  /**
   * 获取知识卡片 Repository
   */
  getKnowledgeCardRepository(): SqlKnowledgeCardRepository {
    return this.getContainer().knowledgeCards as SqlKnowledgeCardRepository
  }

  /**
   * 获取记忆 Repository
   */
  getMemoryRepository(): SqlMemoryRepository {
    return this.getContainer().memories as SqlMemoryRepository
  }
}

/**
 * 便捷函数：获取默认的 Repository 工厂实例
 * 需要先在应用初始化时调用 initRepositoryFactory
 */
let defaultFactory: RepositoryFactory | null = null

/**
 * 初始化默认的 Repository 工厂
 */
export function initRepositoryFactory(getDb: DatabaseAccessor): RepositoryFactory {
  defaultFactory = RepositoryFactory.getInstance(getDb)
  return defaultFactory
}

/**
 * 获取默认的 Repository 工厂
 */
export function getRepositoryFactory(): RepositoryFactory {
  if (!defaultFactory) {
    throw new Error('RepositoryFactory not initialized. Call initRepositoryFactory() first.')
  }
  return defaultFactory
}

/**
 * 获取 Repository 容器的便捷函数
 */
export function getRepositories(): IRepositoryContainer {
  return getRepositoryFactory().getContainer()
}
