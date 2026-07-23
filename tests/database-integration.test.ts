import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import {
  booksDb,
  highlightsDb,
  cardsDb,
  reviewsDb,
  bookSummariesDb,
  dailyStatsDb,
  tokenUsageDb,
  conversationDb,
  methodologiesDb,
  knowledgeCardsDb,
  bookArchitectureDb,
  articlesDb,
  vocabularyDb,
  memoriesDb,
  runTransaction,
  resetDatabase,
  clearConversationsAndMessages,
  closeDatabase,
  initDatabase,
  getDatabase,
} from '../electron/database'

describe('database-integration — sql.js 集成测试', () => {
  beforeEach(async () => {
    await setupTestDatabase()
  })

  afterEach(() => {
    teardownTestDatabase()
  })

  describe('initDatabase / schema', () => {
    it('应创建 13 张业务表', async () => {
      const db = await setupTestDatabase()
      const tables = db.exec("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      const tableNames = tables[0]?.values.map(v => v[0] as string) ?? []
      expect(tableNames).toContain('books')
      expect(tableNames).toContain('highlights')
      expect(tableNames).toContain('cards')
      expect(tableNames).toContain('reviews')
      expect(tableNames).toContain('book_summaries')
      expect(tableNames).toContain('daily_stats')
      expect(tableNames).toContain('token_usage')
      expect(tableNames).toContain('conversations')
      expect(tableNames).toContain('chat_messages')
      expect(tableNames).toContain('methodologies')
      expect(tableNames).toContain('knowledge_cards')
      expect(tableNames).toContain('book_architecture')
      expect(tableNames).toContain('articles')
      expect(tableNames).toContain('vocabulary')
      expect(tableNames).toContain('memories')
    })

    it('应创建索引', async () => {
      const db = await setupTestDatabase()
      const indexes = db.exec("SELECT name FROM sqlite_master WHERE type='index' ORDER BY name")
      const indexNames = indexes[0]?.values.map(v => v[0] as string) ?? []
      expect(indexNames).toContain('idx_highlights_book_id')
      expect(indexNames).toContain('idx_cards_highlight_id')
      expect(indexNames).toContain('idx_cards_due')
      expect(indexNames).toContain('idx_reviews_card_id')
      expect(indexNames).toContain('idx_daily_stats_date')
      expect(indexNames).toContain('idx_messages_conversation')
      expect(indexNames).toContain('idx_conversations_updated')
      expect(indexNames).toContain('idx_methodologies_book_id')
      expect(indexNames).toContain('idx_knowledge_cards_book_id')
      expect(indexNames).toContain('idx_knowledge_cards_type')
      expect(indexNames).toContain('idx_book_architecture_book_id')
      expect(indexNames).toContain('idx_articles_source')
      expect(indexNames).toContain('idx_articles_created')
      expect(indexNames).toContain('idx_articles_difficulty')
      expect(indexNames).toContain('idx_vocabulary_word')
      expect(indexNames).toContain('idx_vocabulary_mastered')
      expect(indexNames).toContain('idx_memories_type')
      expect(indexNames).toContain('idx_memories_importance')
    })

    it('应开启外键约束', async () => {
      const db = await setupTestDatabase()
      const result = db.exec('PRAGMA foreign_keys')
      const fkEnabled = result[0]?.values[0]?.[0]
      expect(fkEnabled).toBe(1)
    })

    it('多次初始化不报错（幂等）', async () => {
      await expect(setupTestDatabase()).resolves.toBeDefined()
      await expect(setupTestDatabase()).resolves.toBeDefined()
    })
  })

  describe('booksDb CRUD', () => {
    it('应创建并查询单本书', async () => {
      const book = {
        id: 'book_1',
        title: 'Test Book',
        author: 'Author',
        cover: 'cover.jpg',
        isbn: '123',
        publisher: 'Pub',
        publish_date: '2024-01-01',
        description: 'Desc',
        category: 'Tech',
        reading_progress: 0.5,
        total_chapter: 10,
        last_read_time: '2024-01-01T00:00:00Z',
        is_finished: 0,
      }

      booksDb.create(book as any)
      const result = booksDb.getById('book_1')

      expect(result).toBeDefined()
      expect((result as any).title).toBe('Test Book')
      expect((result as any).author).toBe('Author')
    })

    it('应支持 createBatch 批量创建', async () => {
      const books = [
        { id: 'book_1', title: 'Book 1' },
        { id: 'book_2', title: 'Book 2' },
        { id: 'book_3', title: 'Book 3' },
      ]

      booksDb.createBatch(books as any)
      const all = booksDb.getAll()

      expect(all).toHaveLength(3)
    })

    it('应支持 update 和 delete', async () => {
      booksDb.create({ id: 'book_1', title: 'Original' } as any)
      booksDb.update('book_1', { title: 'Updated', author: 'New Author' } as any)

      const updated = booksDb.getById('book_1')
      expect((updated as any).title).toBe('Updated')
      expect((updated as any).author).toBe('New Author')

      booksDb.delete('book_1')
      const deleted = booksDb.getById('book_1')
      expect(deleted).toBeUndefined()
    })

    it('应支持 search 和 count', async () => {
      booksDb.createBatch([
        { id: 'book_1', title: 'React Guide' },
        { id: 'book_2', title: 'Vue Guide' },
        { id: 'book_3', title: 'Angular Guide' },
      ] as any)

      const searchResult = booksDb.search('React')
      expect(searchResult).toHaveLength(1)
      expect((searchResult[0] as any).title).toBe('React Guide')

      expect(booksDb.count()).toBe(3)
    })

    it('应支持 updateProgress', async () => {
      booksDb.create({ id: 'book_1', title: 'Book', reading_progress: 0 } as any)
      booksDb.updateProgress('book_1', 0.8)

      const updated = booksDb.getById('book_1')
      expect((updated as any).reading_progress).toBe(0.8)
    })
  })

  describe('highlightsDb CRUD', () => {
    it('应创建 highlight 并关联 book', async () => {
      booksDb.create({ id: 'book_1', title: 'Book' } as any)
      highlightsDb.create({
        id: 'hl_1',
        book_id: 'book_1',
        chapter_title: 'Chapter 1',
        content: 'Highlight content',
        note: 'Note',
        style: 0,
      } as any)

      const result = highlightsDb.getByBookId('book_1')
      expect(result).toHaveLength(1)
      expect((result[0] as any).content).toBe('Highlight content')
    })

    it('应检测重复 highlight（create 返回 false）', async () => {
      booksDb.create({ id: 'book_1', title: 'Book' } as any)
      const first = highlightsDb.create({
        id: 'hl_1',
        book_id: 'book_1',
        content: 'Same content',
      } as any)
      const second = highlightsDb.create({
        id: 'hl_2',
        book_id: 'book_1',
        content: 'Same content',
      } as any)

      expect(first).toBe(true)
      expect(second).toBe(false)
    })

    it('应支持 createBatch 去重', async () => {
      booksDb.create({ id: 'book_1', title: 'Book' } as any)
      const result = highlightsDb.createBatch([
        { id: 'hl_1', book_id: 'book_1', content: 'Content 1' },
        { id: 'hl_2', book_id: 'book_1', content: 'Content 2' },
        { id: 'hl_3', book_id: 'book_1', content: 'Content 1' },
      ] as any)

      expect(result).toBe(2)
    })

    it('应支持 deleteByBookId 级联删除', async () => {
      booksDb.create({ id: 'book_1', title: 'Book' } as any)
      highlightsDb.createBatch([
        { id: 'hl_1', book_id: 'book_1', content: 'C1' },
        { id: 'hl_2', book_id: 'book_1', content: 'C2' },
      ] as any)

      highlightsDb.deleteByBookId('book_1')
      const remaining = highlightsDb.getByBookId('book_1')
      expect(remaining).toHaveLength(0)
    })
  })

  describe('cardsDb CRUD', () => {
    it('应创建卡片并关联 highlight', async () => {
      booksDb.create({ id: 'book_1', title: 'Book' } as any)
      highlightsDb.create({ id: 'hl_1', book_id: 'book_1', content: 'HL' } as any)

      const card = cardsDb.create('hl_1')
      expect(card.highlightId).toBe('hl_1')
      expect(card.state).toBe(0)
    })

    it('应支持 createForExistingHighlights 批量创建', async () => {
      booksDb.create({ id: 'book_1', title: 'Book' } as any)
      // 用单个 create 而非 createBatch，因为 createBatch 会自动创建卡片
      highlightsDb.create({ id: 'hl_1', book_id: 'book_1', content: 'C1' } as any)
      highlightsDb.create({ id: 'hl_2', book_id: 'book_1', content: 'C2' } as any)

      const result = cardsDb.createForExistingHighlights()
      expect(result.created).toBe(2)
      expect(result.skipped).toBe(0)
    })

    it('应支持 getDueCards 查询', async () => {
      booksDb.create({ id: 'book_1', title: 'Book' } as any)
      highlightsDb.create({ id: 'hl_1', book_id: 'book_1', content: 'HL' } as any)
      const card = cardsDb.create('hl_1')

      const dueCards = cardsDb.getDueCards()
      expect(dueCards).toHaveLength(1)
      expect(dueCards[0].id).toBe(card.id)
    })

    it('应支持 updateApplicationTag 和 updateMasteryLevel', async () => {
      booksDb.create({ id: 'book_1', title: 'Book' } as any)
      highlightsDb.create({ id: 'hl_1', book_id: 'book_1', content: 'HL' } as any)
      const card = cardsDb.create('hl_1')

      cardsDb.updateApplicationTag(card.id, 'methodology')
      cardsDb.updateMasteryLevel(card.id, 3)

      // getById 经过 cardFromDb 映射只返回 Card 接口字段，
      // application_tag 和 mastery_level 需要直接从 DB 验证
      const result = getDatabase().exec('SELECT application_tag, mastery_level FROM cards WHERE id = ?', [card.id])
      const rows = result[0]?.values ?? []
      expect(rows[0][0]).toBe('methodology')
      expect(rows[0][1]).toBe(3)
    })

    it('应支持 deleteByHighlightId', async () => {
      booksDb.create({ id: 'book_1', title: 'Book' } as any)
      highlightsDb.create({ id: 'hl_1', book_id: 'book_1', content: 'HL' } as any)
      const card = cardsDb.create('hl_1')

      cardsDb.deleteByHighlightId('hl_1')
      const deleted = cardsDb.getById(card.id)
      expect(deleted).toBeNull()
    })
  })

  describe('reviewsDb CRUD', () => {
    it('应创建 review 并更新 daily_stats', async () => {
      booksDb.create({ id: 'book_1', title: 'Book' } as any)
      highlightsDb.create({ id: 'hl_1', book_id: 'book_1', content: 'HL' } as any)
      const card = cardsDb.create('hl_1')

      const { reviewId, card: updatedCard } = reviewsDb.create(card.id, 3)
      expect(reviewId).toContain('review_')

      const reviews = reviewsDb.getByCardId(card.id)
      expect(reviews).toHaveLength(1)

      const todayStats = dailyStatsDb.getToday()
      expect((todayStats as any).cards_reviewed).toBe(1)
    })
  })

  describe('bookSummariesDb CRUD', () => {
    it('应创建并查询摘要', async () => {
      booksDb.create({ id: 'book_1', title: 'Book' } as any)
      bookSummariesDb.create('book_1', 'Summary content', 'Key point 1, Key point 2')

      const summary = bookSummariesDb.getByBookId('book_1')
      expect(summary).toBeDefined()
      expect((summary as any).summary).toBe('Summary content')
    })

    it('应支持 delete', async () => {
      booksDb.create({ id: 'book_1', title: 'Book' } as any)
      bookSummariesDb.create('book_1', 'Summary')
      bookSummariesDb.delete('book_1')

      const summary = bookSummariesDb.getByBookId('book_1')
      expect(summary).toBeUndefined()
    })
  })

  describe('dailyStatsDb CRUD', () => {
    it('应支持 incrementBooksRead / incrementHighlightsAdded / incrementCardsReviewed / addReadingTime', async () => {
      dailyStatsDb.incrementBooksRead()
      dailyStatsDb.incrementHighlightsAdded(3)
      dailyStatsDb.incrementCardsReviewed(2)
      dailyStatsDb.addReadingTime(60)

      const today = dailyStatsDb.getToday()
      expect((today as any).books_read).toBe(1)
      expect((today as any).highlights_added).toBe(3)
      expect((today as any).cards_reviewed).toBe(2)
      expect((today as any).reading_time).toBe(60)
    })

    it('应支持 getRange 查询', async () => {
      dailyStatsDb.incrementBooksRead()
      const today = new Date().toISOString().split('T')[0]
      const range = dailyStatsDb.getRange(today, today)
      expect(range.length).toBeGreaterThanOrEqual(1)
    })
  })

  describe('tokenUsageDb CRUD', () => {
    it('应创建并查询 token 使用记录', async () => {
      tokenUsageDb.create({
        provider: 'openai',
        model: 'gpt-4o-mini',
        feature: 'chat',
        inputTokens: 100,
        outputTokens: 50,
        durationMs: 1000,
      })

      const recent = tokenUsageDb.getRecent(10)
      expect(recent).toHaveLength(1)
      expect((recent[0] as any).provider).toBe('openai')
      expect((recent[0] as any).total_tokens).toBe(150)
    })

    it('应支持 getStatsByProvider 统计', async () => {
      tokenUsageDb.create({
        provider: 'openai',
        model: 'gpt-4o-mini',
        feature: 'chat',
        inputTokens: 100,
        outputTokens: 50,
      })

      const stats = tokenUsageDb.getStatsByProvider()
      expect(stats).toHaveLength(1)
      expect((stats[0] as any).request_count).toBe(1)
    })
  })

  describe('conversationDb CRUD', () => {
    it('应创建对话并添加消息', async () => {
      const conversation = conversationDb.create('Test Conversation', 'book_1')
      expect(conversation.title).toBe('Test Conversation')

      const messageId = conversationDb.addMessage(conversation.id, {
        role: 'user',
        content: 'Hello',
      } as any)

      expect(messageId).toContain('msg_')

      const messages = conversationDb.getMessages(conversation.id)
      expect(messages).toHaveLength(1)
      expect((messages[0] as any).content).toBe('Hello')
    })

    it('应支持 search 和 delete', async () => {
      const conversation = conversationDb.create('Searchable')
      conversationDb.addMessage(conversation.id, { role: 'user', content: 'Unique search text' } as any)

      const results = conversationDb.search('Unique')
      expect(results).toHaveLength(1)

      conversationDb.delete(conversation.id)
      const deleted = conversationDb.getById(conversation.id)
      expect(deleted).toBeUndefined()
    })
  })

  describe('methodologiesDb CRUD', () => {
    it('应创建方法论并关联 book', async () => {
      booksDb.create({ id: 'book_1', title: 'Book' } as any)
      methodologiesDb.create({
        id: 'method_1',
        book_id: 'book_1',
        name: 'Test Method',
        description: 'Desc',
        steps: ['Step 1', 'Step 2'],
        tags: ['tag1'],
      } as any)

      const method = methodologiesDb.getById('method_1')
      expect(method).toBeDefined()
      expect((method as any).name).toBe('Test Method')
    })

    it('应支持 search', async () => {
      booksDb.create({ id: 'book_1', title: 'Book' } as any)
      methodologiesDb.create({
        id: 'method_1',
        book_id: 'book_1',
        name: 'Searchable Method',
        description: 'Description',
      } as any)

      const results = methodologiesDb.search('Searchable')
      expect(results).toHaveLength(1)
    })
  })

  describe('knowledgeCardsDb CRUD', () => {
    it('应创建知识卡片', async () => {
      booksDb.create({ id: 'book_1', title: 'Book' } as any)
      knowledgeCardsDb.create({
        id: 'card_1',
        book_id: 'book_1',
        type: 'concept',
        title: 'Concept Title',
        content: 'Content',
      } as any)

      const card = knowledgeCardsDb.getById('card_1')
      expect(card).toBeDefined()
      expect((card as any).title).toBe('Concept Title')
      expect((card as any).type).toBe('concept')
    })

    it('应支持 getByType 查询', async () => {
      booksDb.create({ id: 'book_1', title: 'Book' } as any)
      knowledgeCardsDb.create({ id: 'card_1', book_id: 'book_1', type: 'concept', title: 'C1', content: 'C' } as any)
      knowledgeCardsDb.create({ id: 'card_2', book_id: 'book_1', type: 'methodology', title: 'M1', content: 'M' } as any)

      const concepts = knowledgeCardsDb.getByType('concept')
      expect(concepts).toHaveLength(1)
      expect((concepts[0] as any).title).toBe('C1')
    })
  })

  describe('bookArchitectureDb CRUD', () => {
    it('应创建并查询架构', async () => {
      booksDb.create({ id: 'book_1', title: 'Book' } as any)
      bookArchitectureDb.create({
        id: 'arch_1',
        book_id: 'book_1',
        core_proposition: 'Core',
        cognitive_framework: { key: 'value' },
        methodology_architecture: ['m1', 'm2'],
        knowledge_hierarchy: ['k1', 'k2'],
        target_audience: 'Audience',
      } as any)

      const arch = bookArchitectureDb.getById('arch_1')
      expect(arch).toBeDefined()
      expect((arch as any).core_proposition).toBe('Core')
    })
  })

  describe('articlesDb CRUD', () => {
    it('应创建并查询文章', async () => {
      const created = articlesDb.create({
        id: 'article_1',
        title_en: 'English Title',
        content_en: 'English content',
        source: 'rss',
      })
      expect(created).toBe(true)

      const article = articlesDb.getById('article_1')
      expect(article).toBeDefined()
      expect((article as any).title_en).toBe('English Title')
    })

    it('应支持 markAsRead 和 toggleFavorite', async () => {
      const created = articlesDb.create({
        id: 'article_1',
        title_en: 'Article',
        content_en: 'Content',
        source: 'rss',
      })
      expect(created).toBe(true)

      articlesDb.markAsRead('article_1')
      let article = articlesDb.getById('article_1')
      expect((article as any).is_read).toBe(1)

      articlesDb.toggleFavorite('article_1')
      article = articlesDb.getById('article_1')
      expect((article as any).is_favorite).toBe(1)
    })
  })

  describe('vocabularyDb CRUD', () => {
    it('应创建生词并去重', async () => {
      const first = vocabularyDb.create({
        word: 'hello',
        meaning_zh: '你好',
      })

      expect(first).not.toBeNull()
      expect((first as any).word).toBe('hello')

      const second = vocabularyDb.create({
        word: 'hello',
        meaning_zh: '你好',
      })

      expect(second).not.toBeNull()
      expect((second as any).id).toBe((first as any).id)
    })

    it('应支持 updateReviewData', async () => {
      const vocab = vocabularyDb.create({
        word: 'world',
        meaning_zh: '世界',
      })

      const updated = vocabularyDb.updateReviewData((vocab as any).id, {
        quality: 4,
        isMastered: true,
      })

      expect(updated).not.toBeNull()
      expect((updated as any).is_mastered).toBe(1)
      expect((updated as any).review_count).toBe(1)
    })

    it('应支持 getDueForReview 查询', async () => {
      vocabularyDb.create({
        word: 'due_word',
        meaning_zh: '到期',
      })

      const due = vocabularyDb.getDueForReview()
      expect(due.some(v => (v as any).word === 'due_word')).toBe(true)
    })
  })

  describe('memoriesDb CRUD', () => {
    it('应创建并查询记忆', async () => {
      memoriesDb.create({
        type: 'insight',
        category: 'learning',
        content: 'Memory content',
        importance: 0.8,
      })

      const all = memoriesDb.getAll()
      expect(all).toHaveLength(1)
      expect((all[0] as any).content).toBe('Memory content')
    })

    it('应支持 incrementAccess 和 getStats', async () => {
      memoriesDb.create({
        type: 'preference',
        category: 'ui',
        content: 'Pref',
      })

      memoriesDb.incrementAccess((memoriesDb.getAll()[0] as any).id)
      const stats = memoriesDb.getStats()
      expect(stats.total).toBe(1)
      expect(stats.byType.preference).toBe(1)
    })

    it('应支持 deleteOldestBeyond 清理', async () => {
      for (let i = 0; i < 5; i++) {
        memoriesDb.create({
          type: 'interaction',
          category: 'chat',
          content: `Memory ${i}`,
          importance: 0.1,
        })
      }

      memoriesDb.deleteOldestBeyond(3)
      expect(memoriesDb.getAll()).toHaveLength(3)
    })
  })

  describe('Transaction 事务', () => {
    it('runTransaction 成功时应提交', async () => {
      runTransaction((db) => {
        db.run('INSERT INTO books (id, title) VALUES (?, ?)', ['tx_book', 'TX Book'])
      })

      const book = booksDb.getById('tx_book')
      expect(book).toBeDefined()
    })

    it('runTransaction 失败时应回滚', async () => {
      expect(() => {
        runTransaction((db) => {
          db.run('INSERT INTO books (id, title) VALUES (?, ?)', ['tx_book2', 'TX Book 2'])
          throw new Error('Rollback')
        })
      }).toThrow('Rollback')

      const book = booksDb.getById('tx_book2')
      expect(book).toBeUndefined()
    })
  })

  describe('resetDatabase 和 clearConversationsAndMessages', () => {
    it('resetDatabase 应清空所有业务表', async () => {
      booksDb.create({ id: 'reset_book', title: 'Reset Book' } as any)
      highlightsDb.create({ id: 'reset_hl', book_id: 'reset_book', content: 'HL' } as any)

      resetDatabase()

      expect(booksDb.getAll()).toHaveLength(0)
      expect(highlightsDb.getAll()).toHaveLength(0)
    })

    it('clearConversationsAndMessages 应只清空对话相关表', async () => {
      booksDb.create({ id: 'keep_book', title: 'Keep Book' } as any)
      const conversation = conversationDb.create('To Clear')
      conversationDb.addMessage(conversation.id, { role: 'user', content: 'Hi' } as any)

      clearConversationsAndMessages()

      expect(booksDb.getAll()).toHaveLength(1)
      expect(conversationDb.getAll()).toHaveLength(0)
    })
  })

  describe('CHECK 约束', () => {
    it('chat_messages.role 应受 CHECK 约束', async () => {
      const conversation = conversationDb.create('Constraint Test')
      expect(() => {
        conversationDb.addMessage(conversation.id, {
          id: 'msg_bad',
          role: 'invalid_role',
          content: 'Bad',
        } as any)
      }).toThrow()
    })

    it('knowledge_cards.type 应受 CHECK 约束', async () => {
      booksDb.create({ id: 'book_1', title: 'Book' } as any)
      expect(() => {
        knowledgeCardsDb.create({
          id: 'card_bad',
          book_id: 'book_1',
          type: 'invalid_type',
          title: 'Bad',
          content: 'Bad',
        } as any)
      }).toThrow()
    })

    it('memories.type 应受 CHECK 约束', async () => {
      expect(() => {
        memoriesDb.create({
          type: 'invalid_type',
          category: 'cat',
          content: 'Bad',
        })
      }).toThrow()
    })
  })

  describe('外键约束', () => {
    it('删除 book 应级联删除 highlights（ON DELETE CASCADE）', async () => {
      booksDb.create({ id: 'fk_book', title: 'FK Book' } as any)
      highlightsDb.create({ id: 'fk_hl', book_id: 'fk_book', content: 'HL' } as any)

      booksDb.delete('fk_book')

      const remainingHighlights = highlightsDb.getByBookId('fk_book')
      expect(remainingHighlights).toHaveLength(0)
    })

    it('删除 article 应将 vocabulary.source_article_id 置 NULL（ON DELETE SET NULL）', async () => {
      articlesDb.create({
        id: 'fk_article',
        title_en: 'Article',
        content_en: 'Content',
        source: 'rss',
      })

      vocabularyDb.create({
        word: 'foreign',
        meaning_zh: '外文',
        source_article_id: 'fk_article',
      })

      articlesDb.delete('fk_article')

      const vocab = vocabularyDb.getByWord('foreign')
      expect((vocab as any).source_article_id).toBeNull()
    })
  })
})
