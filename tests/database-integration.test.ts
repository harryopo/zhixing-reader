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

    it('cards 表保留 application_tag / mastery_level 列（历史兼容，不再由此写入）', async () => {
      // 2026-09-15：cardsDb.updateApplicationTag / updateMasteryLevel 已随其不可达的
      // IPC 通道一并移除。掌握度改为由 FSRS 状态实时推导（src/shared/fsrs-metrics.ts），
      // 不再落库，避免冗余状态与实际调度不一致。此处只断言列仍然存在，
      // 保证老库升级后 `SELECT *` 的列序与 Repository 映射不被打断。
      booksDb.create({ id: 'book_1', title: 'Book' } as any)
      highlightsDb.create({ id: 'hl_1', book_id: 'book_1', content: 'HL' } as any)
      const card = cardsDb.create('hl_1')

      const cols = getDatabase().exec('PRAGMA table_info(cards)')
      const colNames = (cols[0]?.values ?? []).map((v) => v[1] as string)
      expect(colNames).toContain('application_tag')
      expect(colNames).toContain('mastery_level')

      const result = getDatabase().exec('SELECT application_tag, mastery_level FROM cards WHERE id = ?', [card.id])
      expect(result[0]?.values[0]).toEqual([null, 0])
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

  // ==========================================================================
  // 每日学习量控制（2026-09-15 新增）
  // 回归：934 条划线一次性导入后全部"立即到期"，复习页显示 900+ 张待复习，
  //       用户面对永远做不完的清单直接放弃。新卡必须按天限量放行。
  // ==========================================================================
  describe('cardsDb 每日新卡上限', () => {
    /** books.id 有 UNIQUE 约束，同一测试里会被调用多次，这里做成幂等 */
    const ensureBook = () => {
      if (!booksDb.getById('book_1')) booksDb.create({ id: 'book_1', title: 'Book' } as any)
    }

    /** 造 n 张新卡（state = 0，从未学过） */
    const makeNewCards = (n: number, prefix = 'lim') => {
      ensureBook()
      const ids: string[] = []
      for (let i = 0; i < n; i++) {
        const hid = `hl_${prefix}_${i}`
        highlightsDb.create({ id: hid, book_id: 'book_1', content: `HL ${i}` } as any)
        ids.push(cardsDb.create(hid).id)
      }
      return ids
    }

    it('新卡不会一次性全部涌入到期队列（回归：曾返回全部）', async () => {
      makeNewCards(100)
      const queue = cardsDb.getDueCards(200, 15)
      expect(queue).toHaveLength(15)
      // 旧实现是 WHERE due <= now，100 张新卡会全部返回
      expect(queue.length).toBeLessThan(100)
      expect(queue.every((c) => c.state === 0)).toBe(true)
    })

    it('每日上限为 0 时完全不放新卡', async () => {
      makeNewCards(20, 'zero')
      expect(cardsDb.getDueCards(100, 0)).toHaveLength(0)
    })

    it('今天学过一部分后，剩余额度相应减少', async () => {
      const ids = makeNewCards(30, 'quota')
      // 先按 15 张的额度学掉 5 张
      const first = cardsDb.getDueCards(100, 15)
      expect(first).toHaveLength(15)
      for (const c of first.slice(0, 5)) reviewsDb.create(c.id, 3)

      // 这些卡已不是新卡，所以它们离开新卡池；剩余额度 = 15 - 5 = 10
      const second = cardsDb.getDueCards(100, 15)
      const newOnes = second.filter((c) => c.state === 0)
      expect(newOnes).toHaveLength(10)
    })

    it('额度耗尽后不再放新卡（同一天内重复打开也一样）', async () => {
      const ids = makeNewCards(40, 'exhaust')
      const batch = cardsDb.getDueCards(100, 15)
      for (const c of batch) reviewsDb.create(c.id, 3)
      const again = cardsDb.getDueCards(100, 15)
      expect(again.filter((c) => c.state === 0)).toHaveLength(0)
      expect(ids.length).toBe(40)
    })

    it('新卡额度为 0 时，只放复习卡、完全挡住新卡', async () => {
      ensureBook()
      // 造 3 张"已学过且已过期"的复习卡。
      // 注意不能只靠 reviewsDb.create：Again 之后卡片处于 Learning，
      // 到期时间是 1 分钟后，此刻并不算 due（这是 ts-fsrs 的正确行为）。
      const reviewIds: string[] = []
      for (let i = 0; i < 3; i++) {
        const hid = `hl_rev_${i}`
        // content 必须各不相同：highlightsDb.create 会按 (book_id, content) 去重
        highlightsDb.create({ id: hid, book_id: 'book_1', content: `复习卡内容 ${i}` } as any)
        const card = cardsDb.create(hid)
        reviewsDb.create(card.id, 3)
        const reviewed = cardsDb.getById(card.id)
        cardsDb.update({
          ...reviewed,
          state: 2,
          due: new Date(Date.now() - 86400000).toISOString(),
          lastReview: new Date(Date.now() - 2 * 86400000).toISOString(),
        })
        reviewIds.push(card.id)
      }
      makeNewCards(50, 'prio')

      const queue = cardsDb.getDueCards(100, 0)
      // 复习卡照常出现（新卡额度拦不住它们）
      expect(queue.filter((c) => c.state !== 0)).toHaveLength(3)
      // 新卡被完全挡住
      expect(queue.filter((c) => c.state === 0)).toHaveLength(0)

      // 额度恢复后新卡才出现，且排在复习卡之后。
      // 注意是 12 而不是 15：上面给 3 张卡做了"今天的首次评分"，
      // 它们已经占用了当天的 3 个新卡名额（这正是每日上限该有的语义）。
      const stats = cardsDb.getDueQueueStats(15)
      expect(stats.newIntroducedToday).toBe(3)
      expect(stats.newAllowance).toBe(12)

      const withNew = cardsDb.getDueCards(100, 15)
      expect(withNew.filter((c) => c.state === 0)).toHaveLength(12)
      expect(withNew.slice(0, 3).every((c) => c.state !== 0)).toBe(true)
    })

    it('getDueQueueStats 正确拆分复习卡与新卡', async () => {
      ensureBook()
      const hid = 'hl_stats'
      highlightsDb.create({ id: hid, book_id: 'book_1', content: '统计用的复习卡' } as any)
      const card = cardsDb.create(hid)
      reviewsDb.create(card.id, 1)

      makeNewCards(50, 'stats')
      const stats = cardsDb.getDueQueueStats(15)

      expect(stats.newPerDay).toBe(15)
      expect(stats.newAvailable).toBeGreaterThanOrEqual(50)
      expect(stats.newIntroducedToday).toBeGreaterThanOrEqual(1)
      expect(stats.newAllowance).toBeLessThanOrEqual(15)
      // actionable 才是界面上该出现的数字，远端总数不再冒充"待办"
      expect(stats.actionable).toBe(stats.reviewDue + stats.newAllowance)
      expect(stats.actionable).toBeLessThan(stats.newAvailable + stats.reviewDue)
    })

    it('getReviewStats 的 due 不再把从未学过的卡片算成"到期"', async () => {
      makeNewCards(60, 'revstats')
      const s = cardsDb.getReviewStats()
      // 60 张全是新卡，复习卡为 0 → due 必须是 0
      expect(s.due).toBe(0)
      expect(s.new).toBeGreaterThanOrEqual(60)
      expect(s.total).toBeGreaterThanOrEqual(60)
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
    it('应支持 incrementBooksRead / incrementHighlightsAdded / incrementCardsReviewed', async () => {
      dailyStatsDb.incrementBooksRead()
      dailyStatsDb.incrementHighlightsAdded(3)
      dailyStatsDb.incrementCardsReviewed(2)

      const today = dailyStatsDb.getToday()
      expect((today as any).books_read).toBe(1)
      expect((today as any).highlights_added).toBe(3)
      expect((today as any).cards_reviewed).toBe(2)
    })

    // ========================================================================
    // 阅读时长（2026-09-16 语义修正）
    // 真值来源是微信读书的阅读统计；本地 daily_stats.reading_time 是它的缓存。
    // 原 addReadingTime（累加）已移除 —— 同一列有两个语义相反的写入方迟早算错。
    // ========================================================================
    it('upsertReadingTime 覆盖写入指定日期，而不是累加', async () => {
      dailyStatsDb.upsertReadingTime('2026-09-05', 167)
      dailyStatsDb.upsertReadingTime('2026-09-05', 300)
      const rows = dailyStatsDb.getRange('2026-09-05', '2026-09-05')
      expect((rows[0] as any).reading_time).toBe(300)
    })

    it('upsertReadingTime 能写入今天（getToday 读得到）', async () => {
      const today = new Date().toISOString().split('T')[0]
      dailyStatsDb.upsertReadingTime(today, 1459)
      expect((dailyStatsDb.getToday() as any).reading_time).toBe(1459)
    })

    it('upsertReadingTime 与其它计数并存，互不覆盖', async () => {
      const today = new Date().toISOString().split('T')[0]
      dailyStatsDb.incrementCardsReviewed(4)
      dailyStatsDb.upsertReadingTime(today, 600)
      const t = dailyStatsDb.getToday() as any
      expect(t.cards_reviewed).toBe(4)
      expect(t.reading_time).toBe(600)
    })

    it('日期格式非法时整条忽略（不写脏数据）', async () => {
      dailyStatsDb.upsertReadingTime('not-a-date', 100)
      dailyStatsDb.upsertReadingTime('', 100)
      expect(dailyStatsDb.getRange('0000-01-01', '9999-12-31')).toHaveLength(0)
    })

    it('秒数非法时按 0 写入 —— 微信读书本来就会返回某天 0 秒', async () => {
      // 实测 /readdata/detail 的 readTimes 里确实存在值为 0 的日期（那天没读）。
      // 所以「写入 0」是正确行为，表示"这天没读"，而不是脏数据。
      dailyStatsDb.upsertReadingTime('2026-09-06', Number.NaN)
      const rows = dailyStatsDb.getRange('2026-09-06', '2026-09-06')
      expect(rows).toHaveLength(1)
      expect((rows[0] as any).reading_time).toBe(0)
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

  // ==========================================================================
  // 知识卡片来源回填（2026-09-16 新增）
  // 背景：蒸馏时 source_highlight_id 写死 null，实测 90 张卡片来源全空。
  //       入口已修，但历史数据要回填 —— 且**只允许精确匹配，绝不猜测**。
  // ==========================================================================
  describe('knowledgeCardsDb.backfillSourceHighlights', () => {
    const seed = (opts: {
      bookId: string
      highlightContent: string
      cardContent: string
      cardId: string
      existingSource?: string | null
    }) => {
      if (!booksDb.getById(opts.bookId)) {
        booksDb.create({ id: opts.bookId, title: 'Book' } as any)
      }
      highlightsDb.create({
        id: `hl_${opts.cardId}`,
        book_id: opts.bookId,
        content: opts.highlightContent,
      } as any)
      knowledgeCardsDb.create({
        id: opts.cardId,
        book_id: opts.bookId,
        type: 'quote',
        title: 'T',
        content: opts.cardContent,
        source_highlight_id: opts.existingSource ?? null,
      } as any)
    }

    it('卡片正文与划线原文完全一致 → 建立关联', async () => {
      seed({ bookId: 'b1', highlightContent: '原文一句话', cardContent: '原文一句话', cardId: 'kc1' })
      const updated = knowledgeCardsDb.backfillSourceHighlights()
      expect(updated).toBe(1)
      expect((knowledgeCardsDb.getById('kc1') as any).source_highlight_id).toBe('hl_kc1')
    })

    it('正文有差异（哪怕一个标点）→ **不关联**，宁可空着', async () => {
      seed({ bookId: 'b1', highlightContent: '原文一句话', cardContent: '原文一句话。', cardId: 'kc2' })
      seed({ bookId: 'b1', highlightContent: '另一条原文', cardContent: 'AI 改写过的内容', cardId: 'kc3' })
      const updated = knowledgeCardsDb.backfillSourceHighlights()
      expect(updated).toBe(0)
      expect((knowledgeCardsDb.getById('kc2') as any).source_highlight_id).toBeNull()
      expect((knowledgeCardsDb.getById('kc3') as any).source_highlight_id).toBeNull()
    })

    it('已有来源的卡片不被覆盖', async () => {
      seed({
        bookId: 'b1',
        highlightContent: '原文',
        cardContent: '原文',
        cardId: 'kc4',
        existingSource: 'hl_manual',
      })
      const updated = knowledgeCardsDb.backfillSourceHighlights()
      expect(updated).toBe(0)
      expect((knowledgeCardsDb.getById('kc4') as any).source_highlight_id).toBe('hl_manual')
    })

    it('不能跨书匹配（只在同一本书内找）', async () => {
      booksDb.create({ id: 'b1', title: 'B1' } as any)
      booksDb.create({ id: 'b2', title: 'B2' } as any)
      highlightsDb.create({ id: 'hl_x', book_id: 'b1', content: '共同的一句话' } as any)
      knowledgeCardsDb.create({
        id: 'kc5', book_id: 'b2', type: 'quote', title: 'T', content: '共同的一句话',
      } as any)
      const updated = knowledgeCardsDb.backfillSourceHighlights()
      expect(updated).toBe(0)
      expect((knowledgeCardsDb.getById('kc5') as any).source_highlight_id).toBeNull()
    })

    it('幂等：重复执行第二次不再变化', async () => {
      seed({ bookId: 'b1', highlightContent: '原文', cardContent: '原文', cardId: 'kc6' })
      expect(knowledgeCardsDb.backfillSourceHighlights()).toBe(1)
      expect(knowledgeCardsDb.backfillSourceHighlights()).toBe(0)
    })

    it('一次可以补多张', async () => {
      seed({ bookId: 'b1', highlightContent: 'A', cardContent: 'A', cardId: 'kc7' })
      seed({ bookId: 'b1', highlightContent: 'B', cardContent: 'B', cardId: 'kc8' })
      expect(knowledgeCardsDb.backfillSourceHighlights()).toBe(2)
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

  // ==========================================================================
  // 生词本复习全链路（2026-09-15 新增）
  // 覆盖 DB → fsrs-engine → DB 的往返：这是上一轮修复词汇间隔 bug 时唯一没被覆盖的一层
  // ==========================================================================
  describe('vocabularyDb 复习全链路（FSRS-6.0 落库往返）', () => {
    /** 建一个生词 */
    const newWord = (word: string) => vocabularyDb.create({ word, meaning_zh: '释义' }) as any

    it('一次复习后 stability / difficulty / lapses 必须落库', async () => {
      const w = newWord('persist')
      expect(w.stability ?? 0).toBe(0)

      const updated = vocabularyDb.updateReviewData(w.id, { quality: 3 }) as any
      expect(updated).not.toBeNull()
      expect(updated.stability).toBeGreaterThan(0)
      expect(updated.difficulty).toBeGreaterThan(0)
      expect(updated.lapses ?? 0).toBe(0)
      expect(updated.interval_days).toBeGreaterThanOrEqual(1)
      expect(updated.next_review_at).toBeTruthy()
    })

    it('连续 Good 复习的间隔必须增长（回归：曾恒为 1 天）', async () => {
      const w = newWord('spacing')
      const intervals: number[] = []
      for (let i = 0; i < 5; i++) {
        const updated = vocabularyDb.updateReviewData(w.id, { quality: 3 }) as any
        intervals.push(updated.interval_days)
      }
      // 旧实现：_nextIntervalVocabulary 符号写反 → 结果被 clamp 到 1，五次全是 1
      expect(intervals.every((d) => d >= 1)).toBe(true)
      expect(intervals[intervals.length - 1]).toBeGreaterThan(intervals[0])
      expect(intervals[intervals.length - 1]).toBeGreaterThan(10)
    })

    it('稳定性跨次复习持续累积（不是每次重算）', async () => {
      const w = newWord('cumulative')
      const a = vocabularyDb.updateReviewData(w.id, { quality: 3 }) as any
      const b = vocabularyDb.updateReviewData(w.id, { quality: 3 }) as any
      const c = vocabularyDb.updateReviewData(w.id, { quality: 3 }) as any
      expect(b.stability).toBeGreaterThan(a.stability)
      expect(c.stability).toBeGreaterThan(b.stability)
    })

    it('四个评分档位都能被记录，Hard(2) 再也不会退化成 Good', async () => {
      // 回归：旧 ratingMap {1:1,2:2,3:3,4:3,5:4} 配合界面的 1/3/4/5 标度，
      // 使界面的「困难」(3) 被静默记成 Good(3)，Hard 档完全不可达。
      const again = vocabularyDb.updateReviewData(newWord('r_again').id, { quality: 1 }) as any
      const hard = vocabularyDb.updateReviewData(newWord('r_hard').id, { quality: 2 }) as any
      const good = vocabularyDb.updateReviewData(newWord('r_good').id, { quality: 3 }) as any
      const easy = vocabularyDb.updateReviewData(newWord('r_easy').id, { quality: 4 }) as any

      // 全部被接受，没有一条静默回退
      for (const r of [again, hard, good, easy]) {
        expect(r.review_count).toBe(1)
        expect(r.stability).toBeGreaterThan(0)
      }
      // 关键回归：Hard 必须真正走 Hard 分支 —— 它的难度应高于 Good，
      // 且稳定性不高于 Good。旧实现下「困难」被映射成 Good，这三者会完全相等。
      expect(hard.difficulty).toBeGreaterThan(good.difficulty)
      expect(hard.stability).toBeLessThanOrEqual(good.stability)
      // Easy 应当得到不低于 Good 的稳定性
      expect(easy.stability).toBeGreaterThanOrEqual(good.stability)
      // Again 应当比三者都更弱
      expect(again.stability).toBeLessThan(good.stability)
      // 注：新词首次 Again 不计 lapses —— 尚未形成记忆就谈不上"遗忘"（FSRS/Anki 口径），
      // 遗忘计数只在复习阶段生效，见下方「一次遗忘会把稳定性打回去」用例。
    })

    it('越界的 quality（如旧的 5）回退到 Good，不再被当作 Easy', async () => {
      // 旧映射把 5 映射成 Easy(4)；新契约只接受 1-4，越界值明确回退并记日志
      const w5 = vocabularyDb.updateReviewData(newWord('r_five').id, { quality: 5 }) as any
      const w3 = vocabularyDb.updateReviewData(newWord('r_three').id, { quality: 3 }) as any
      expect(w5.stability).toBeCloseTo(w3.stability, 6)
    })

    it('复习不再自动把词标为已掌握，词仍留在待复习队列的调度里', async () => {
      const w = newWord('stays')
      for (let i = 0; i < 6; i++) {
        vocabularyDb.updateReviewData(w.id, { quality: 3 })
      }
      const after = vocabularyDb.getById(w.id) as any
      // 旧行为：rep >= 5 时自动 is_mastered = 1 → 被 getDueForReview 永久排除
      expect(after.is_mastered).toBe(0)
      expect(after.next_review_at).toBeTruthy()
    })

    it('用户显式标记已掌握仍然生效，并使其退出待复习队列', async () => {
      const w = newWord('manual')
      vocabularyDb.updateReviewData(w.id, { quality: 4, isMastered: true })
      const after = vocabularyDb.getById(w.id) as any
      expect(after.is_mastered).toBe(1)

      const all = vocabularyDb.getAll(200) as any[]
      const marked = all.find((v) => v.id === w.id)
      expect(marked.is_mastered).toBe(1)
    })

    it('一次遗忘会把稳定性打回去（Again 真正生效）', async () => {
      const w = newWord('lapse')
      for (let i = 0; i < 3; i++) vocabularyDb.updateReviewData(w.id, { quality: 3 })
      const before = vocabularyDb.getById(w.id) as any
      const after = vocabularyDb.updateReviewData(w.id, { quality: 1 }) as any
      expect(after.lapses).toBe(1)
      expect(after.stability).toBeLessThan(before.stability)
      expect(after.learning_stage).toBe(1)
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
