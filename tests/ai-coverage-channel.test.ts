import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'
import {
  booksDb,
  getDatabase,
  highlightsDb,
  knowledgeCardsDb,
  methodologiesDb,
  aiBatchesDb,
} from '../electron/database'

/**
 * AI 生成的两条通道（进度查询 + 分批续跑的提取入口）：注册**真实的** handler 再直接调。
 *
 * 为什么不停在数据库层：台账读得对、handler 没注册、或界面上那颗按钮压根没接上，
 * 是三种不同的坏法，前一种测试看得见，后两种只有把通道拉起来才看得见。
 */

// ipc/knowledge.ts 会连带加载 ai-service：这里给一个能记下入参的假实现，绝不打真实网络
const { mockExtract } = vi.hoisted(() => ({
  mockExtract: vi.fn(
    async (
      _highlights: Array<{ id?: string; content: string }>,
      _bookTitle: string,
    ): Promise<Array<Record<string, unknown>>> => [
      { name: '一个方法', sourceIndexes: [1], sourceHighlightIds: [] },
    ],
  ),
}))

vi.hoisted(() => {
  process.env.ZHIXING_TEST_PROFILE = 'user-data-ai-coverage'
})

vi.mock('../electron/ai-service', () => ({ extractMethodologies: mockExtract }))
vi.mock('../electron/ai-sdk-service', () => ({
  generateCardInterpretation: vi.fn(),
  generateCardApplication: vi.fn(),
  generateSkill: vi.fn(),
}))
vi.mock('../electron/weread-api', () => ({ fetchAllContent: vi.fn() }))

const { registerKnowledgeHandlers } = await import('../electron/ipc/knowledge')

type Handler = (...args: unknown[]) => unknown
type CoverageRow = { bookId: string; total: number; processed: number; remaining: number; status: string }

function realHandlers(): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  registerKnowledgeHandlers((channel, handler) => {
    handlers.set(channel, handler as Handler)
  })
  return handlers
}

function countOf(table: string, where: string): number {
  const rows = getDatabase().exec(`SELECT COUNT(*) FROM ${table} WHERE ${where}`)
  return rows.length > 0 ? Number(rows[0].values[0][0]) : -1
}

beforeEach(async () => {
  await setupTestDatabase()
  booksDb.create({ id: 'b1', title: '一本书' })
  highlightsDb.create({ id: 'h1', book_id: 'b1', content: '第一条划线' })
  highlightsDb.create({ id: 'h2', book_id: 'b1', content: '第二条划线' })
  highlightsDb.create({ id: 'h3', book_id: 'b1', content: '第三条划线' })
  mockExtract.mockClear()
})

afterEach(() => {
  teardownTestDatabase()
})

describe('两个 coverage 通道', () => {
  it('都注册在常量表说的名字上', () => {
    const keys = [...realHandlers().keys()]
    expect(keys).toContain(IPC_CHANNELS.METHODOLOGIES.COVERAGE)
    expect(keys).toContain(IPC_CHANNELS.KNOWLEDGE_CARDS.COVERAGE)
  })

  it('没生成过时：分母是这本书的划线条数，progress 全在"还剩"', () => {
    const rows = realHandlers().get(IPC_CHANNELS.METHODOLOGIES.COVERAGE)?.() as CoverageRow[]
    expect(rows).toEqual([{ bookId: 'b1', total: 3, processed: 0, remaining: 3, status: 'none' }])
  })

  it('台账记了两条且有成品：已处理 2 / 还剩 1，状态从 none 变 partial', () => {
    methodologiesDb.create({ id: 'm1', book_id: 'b1', name: '一条方法论' })
    aiBatchesDb.record('b1', 'methodologies', ['h1', 'h2'])
    const rows = realHandlers().get(IPC_CHANNELS.METHODOLOGIES.COVERAGE)?.() as CoverageRow[]
    expect(rows[0]).toMatchObject({ processed: 2, remaining: 1, status: 'partial' })
  })

  it('成品不在了则进度作废：台账记过三条，但一张卡都没有 ⇒ 已处理 0', () => {
    aiBatchesDb.record('b1', 'knowledgeCards', ['h1', 'h2', 'h3'])
    const rows = realHandlers().get(IPC_CHANNELS.KNOWLEDGE_CARDS.COVERAGE)?.() as CoverageRow[]
    expect(rows[0]).toMatchObject({ processed: 0, remaining: 3, status: 'none' })
  })

  it('两个功能各算各的：知识卡片的台账不会冒充方法论的进度', () => {
    knowledgeCardsDb.create({ id: 'k1', book_id: 'b1', type: 'concept', title: '概念', content: '正文' })
    aiBatchesDb.record('b1', 'knowledgeCards', ['h1', 'h2', 'h3'])
    aiBatchesDb.record('b1', 'methodologies', ['h1', 'h2', 'h3'])
    const cards = realHandlers().get(IPC_CHANNELS.KNOWLEDGE_CARDS.COVERAGE)?.() as CoverageRow[]
    const methods = realHandlers().get(IPC_CHANNELS.METHODOLOGIES.COVERAGE)?.() as CoverageRow[]
    expect(cards[0]).toMatchObject({ processed: 3, remaining: 0, status: 'full' })
    // 方法论一条都没有，它那三个台账同样不算数
    expect(methods[0]).toMatchObject({ processed: 0, remaining: 3, status: 'none' })
  })
})

describe('methodologies:extract 的分批续跑', () => {
  it('第一次点：全部划线喂进去，成功后记进台账', async () => {
    const handlers = realHandlers()
    const first = (await handlers.get(IPC_CHANNELS.METHODOLOGIES.EXTRACT)?.('b1', '一本书')) as {
      methodologies: unknown[]
      coverage: { covered: number; alreadyProcessed: number }
      nothingNew: boolean
    }

    expect(mockExtract).toHaveBeenCalledTimes(1)
    expect(mockExtract.mock.calls[0][0]).toHaveLength(3)
    expect(first.coverage).toMatchObject({ covered: 3, alreadyProcessed: 0 })
    expect(first.nothingNew).toBe(false)
    expect(aiBatchesDb.getProcessedIds('b1', 'methodologies').sort()).toEqual(['h1', 'h2', 'h3'])
  })

  it('第二次点：没有新东西可喂 ⇒ 一次 AI 都不调，也不会多出一条方法论', async () => {
    const handlers = realHandlers()
    await handlers.get(IPC_CHANNELS.METHODOLOGIES.EXTRACT)?.('b1', '一本书')
    mockExtract.mockClear()

    const second = (await handlers.get(IPC_CHANNELS.METHODOLOGIES.EXTRACT)?.('b1', '一本书')) as {
      methodologies: unknown[]
      nothingNew: boolean
    }

    expect(mockExtract).not.toHaveBeenCalled()
    expect(second.nothingNew).toBe(true)
    expect(second.methodologies).toEqual([])
    expect(countOf('methodologies', "book_id = 'b1'")).toBe(1)
  })

  it('只处理过一部分时，第二次喂的确实是没记过的那批', async () => {
    methodologiesDb.create({ id: 'm-old', book_id: 'b1', name: '上一条' })
    aiBatchesDb.record('b1', 'methodologies', ['h1'])
    const handlers = realHandlers()

    const result = (await handlers.get(IPC_CHANNELS.METHODOLOGIES.EXTRACT)?.('b1', '一本书')) as {
      coverage: { alreadyProcessed: number; covered: number; partial: boolean }
    }

    const fed = mockExtract.mock.calls[0][0] as Array<{ content: string }>
    expect(fed).toHaveLength(2)
    expect(fed.map((h) => h.content)).toEqual(['第二条划线', '第三条划线'])
    expect(result.coverage).toMatchObject({ alreadyProcessed: 1, covered: 2, partial: false })
  })

  it('replace=true：从头再来 —— 读都不读台账，并把台账归零', async () => {
    aiBatchesDb.record('b1', 'methodologies', ['h1', 'h2', 'h3'])
    const handlers = realHandlers()

    await handlers.get(IPC_CHANNELS.METHODOLOGIES.EXTRACT)?.('b1', '一本书', true)

    expect(mockExtract.mock.calls[0][0]).toHaveLength(3)
    // 台账里只剩这一次新记的那批
    expect(aiBatchesDb.getProcessedIds('b1', 'methodologies').sort()).toEqual(['h1', 'h2', 'h3'])
  })

  it('有成品但台账是空的（台账上线前生成的老方法论）：喂全部，不会被当成"没有新东西"', async () => {
    methodologiesDb.create({ id: 'm-old', book_id: 'b1', name: '老方法论' })

    const result = (await realHandlers().get(IPC_CHANNELS.METHODOLOGIES.EXTRACT)?.('b1', '一本书')) as {
      nothingNew: boolean
    }

    expect(mockExtract.mock.calls[0][0]).toHaveLength(3)
    expect(result.nothingNew).toBe(false)
  })

  it('成品清空过：进度报 0 且台账作废，否则那批划线永远补不回来', async () => {
    aiBatchesDb.record('b1', 'methodologies', ['h1', 'h2'])

    const rows = realHandlers().get(IPC_CHANNELS.METHODOLOGIES.COVERAGE)?.() as CoverageRow[]
    expect(rows[0]).toMatchObject({ processed: 0, remaining: 3, status: 'none' })

    await realHandlers().get(IPC_CHANNELS.METHODOLOGIES.EXTRACT)?.('b1', '一本书')
    expect(mockExtract.mock.calls[0][0]).toHaveLength(3)
  })
})
