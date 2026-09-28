// 历史划线时间回填（electron/services/highlight-time-backfill.ts + 两条库内判据）
//
// 2026-09-28 实测：本机 934 条划线的 created_at 去重后只剩 9 个值（一秒里挤 329 条）——
// 那是导入的那一刻，不是划线的时刻。导入侧已修好（#117），但库里那 933 条不会自己变好。
// 这个文件钉的是回填那半边：靠什么对回去、对不上时怎么办、跑第二遍会不会重复动手。
//
// 数据库用**真库**：判据量的就是"库里那一行现在是什么时刻"。
// mock 只打在 weread-api（网络）与 settings-service（那本"哪本书试过了"的账）两份外圈。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { booksDb, getDatabase, highlightsDb } from '../electron/database'

const seams = vi.hoisted(() => ({
  fetchAllContent: vi.fn(),
  settings: new Map<string, unknown>(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../electron/weread-api', () => ({ fetchAllContent: seams.fetchAllContent }))
vi.mock('../electron/services/settings-service', () => ({
  settingsService: {
    get: (k: string) => seams.settings.get(k),
    set: (k: string, v: unknown) => {
      seams.settings.set(k, v)
    },
  },
}))
vi.mock('../electron/logger', () => ({ logger: seams.logger }))

const { backfillHighlightTimes } = await import('../electron/services/highlight-time-backfill')

const ATTEMPT_KEY = 'highlightTimeBackfillBookIds';

/** 库里那一行的原始 created_at（不经过任何映射） */
function storedTime(id: string): string {
  const rows = getDatabase().exec('SELECT created_at FROM highlights WHERE id = ?', [id])
  return String(rows[0].values[0][0])
}

/** 库里所有行的时间戳形状（与 datetime('now') 同一个形状，不能混进 ISO 的 T） */
function storedShapes(): string[] {
  const rows = getDatabase().exec('SELECT created_at FROM highlights')
  return rows.length > 0 ? rows[0].values.map((r) => String(r[0])) : []
}

function seedBook(id: string, title: string): void {
  booksDb.create({ id, title })
}

/** 三条都落在同一秒（就是历史导入的形状） */
function seedFlatRows(bookId: string, contents: string[]): void {
  for (const content of contents) {
    highlightsDb.create({ id: `hl_${content}`, book_id: bookId, content });
  }
  getDatabase().exec(
    `UPDATE highlights SET created_at = '2026-09-02 12:28:58' WHERE book_id = '${bookId}'`,
  );
}

const payload = (marks: Array<[string, number]>) => ({
  bookmarks: marks.map(([markText, createTime], i) => ({
    bookmarkId: `w${i}`,
    chapterUid: 1,
    chapterTitle: '',
    markText,
    createTime,
  })),
  notes: [],
  chapters: [{ chapterUid: 1, title: '第一章' }],
});

beforeEach(async () => {
  await setupTestDatabase()
  seams.fetchAllContent.mockReset()
  seams.settings.clear()
  seams.logger.info.mockClear()
  seams.logger.warn.mockClear()
})

afterEach(() => {
  teardownTestDatabase()
})

describe('缺口信号：getBookIdsWithFlatTimestamps', () => {
  it('同一本书里多条共用一个时间戳 ⇒ 这本书被列出来', () => {
    seedBook('b1', '一本')
    seedFlatRows('b1', ['第一句', '第二句', '第三句'])

    expect(highlightsDb.getBookIdsWithFlatTimestamps()).toEqual(['b1'])
  })

  it('时间戳各不相同 ⇒ 没有缺口，不列（这样每轮启动就零请求）', () => {
    seedBook('b1', '一本')
    seedFlatRows('b1', ['第一句', '第二句'])
    getDatabase().exec("UPDATE highlights SET created_at = '2023-11-14 22:13:20' WHERE content = '第二句'")

    expect(highlightsDb.getBookIdsWithFlatTimestamps()).toEqual([])
  })

  it('只有正文为空的行撞在一起 ⇒ 不算缺口（否则这几本书永远重拉、永远收敛不了）', () => {
    seedBook('b1', '一本')
    getDatabase().exec(
      `INSERT INTO highlights (id, book_id, content, created_at) VALUES
       ('e1','b1','','2026-09-02 12:28:58'),
       ('e2','b1','   ','2026-09-02 12:28:58')`,
    )

    expect(highlightsDb.getBookIdsWithFlatTimestamps()).toEqual([])
  })

  it('一本书里只有一条有正文的划线 ⇒ 谈不上撞车', () => {
    seedBook('b1', '一本')
    seedFlatRows('b1', ['唯一的一条'])

    expect(highlightsDb.getBookIdsWithFlatTimestamps()).toEqual([])
  })
})

describe('backfillHighlightTimes（真库）', () => {
  it('按划线原文对回真实时刻，写进去的形状与库里其它行一致', async () => {
    seedBook('b1', '一本')
    seedFlatRows('b1', ['第一句', '第二句'])
    seams.fetchAllContent.mockResolvedValue(
      payload([['第一句', 1_700_000_000], ['第二句', 1_700_086_400]]),
    )

    const r = await backfillHighlightTimes()

    expect(r.updated).toBe(2)
    expect(storedTime('hl_第一句')).toBe('2023-11-14 22:13:20')
    expect(storedTime('hl_第二句')).toBe('2023-11-15 22:13:20')
    for (const shape of storedShapes()) {
      expect(shape).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    }
  })

  it('跑第二遍零写入（已经是真实时刻了，不该再动）', async () => {
    seedBook('b1', '一本')
    seedFlatRows('b1', ['第一句', '第二句'])
    seams.fetchAllContent.mockResolvedValue(
      payload([['第一句', 1_700_000_000], ['第二句', 1_700_086_400]]),
    )

    await backfillHighlightTimes('b1')
    const again = await backfillHighlightTimes('b1')

    expect(again.updated).toBe(0)
    expect(again.books).toBe(0)
  })

  it('每本书记一次"试过了"：下一轮不再为它发请求，指定 bookId 才强制跑', async () => {
    seedBook('b1', '一本')
    seedFlatRows('b1', ['第一句', '第二句'])
    seams.fetchAllContent.mockResolvedValue(payload([['第一句', 0]]))

    await backfillHighlightTimes()
    expect(seams.fetchAllContent).toHaveBeenCalledTimes(1)

    const second = await backfillHighlightTimes()
    expect(second.books).toBe(0)
    expect(seams.fetchAllContent).toHaveBeenCalledTimes(1)

    await backfillHighlightTimes('b1')
    expect(seams.fetchAllContent).toHaveBeenCalledTimes(2)
  })

  it('同一句被划两次而时刻不同 ⇒ 那条不动，单独计入 ambiguous（不猜一个时间）', async () => {
    seedBook('b1', '一本')
    seedFlatRows('b1', ['重句', '别的句'])
    seams.fetchAllContent.mockResolvedValue(
      payload([['重句', 1_700_000_000], ['重句', 1_700_099_999], ['别的句', 1_700_200_000]]),
    )

    const r = await backfillHighlightTimes()

    expect(r.ambiguous).toBe(1)
    expect(r.updated).toBe(1)
    expect(storedTime('hl_重句')).toBe('2026-09-02 12:28:58')
    expect(storedTime('hl_别的句')).toBe('2023-11-17 05:46:40')
  })

  it('库里对不上微信读书的行只计数，库里原样不动', async () => {
    seedBook('b1', '一本')
    seedFlatRows('b1', ['第一句', '我改过正文的一条'])
    seams.fetchAllContent.mockResolvedValue(payload([['第一句', 1_700_000_000]]))

    const r = await backfillHighlightTimes()

    expect(r.unmatched).toBe(1)
    expect(r.updated).toBe(1)
    expect(storedTime('hl_我改过正文的一条')).toBe('2026-09-02 12:28:58')
  })

  it('一本书拉取失败不影响其余，整轮不抛错', async () => {
    seedBook('b1', '第一本')
    seedBook('b2', '第二本')
    seedFlatRows('b1', ['甲', '乙'])
    seedFlatRows('b2', ['第一句', '第二句'])
    seams.fetchAllContent.mockImplementation((id: string) => {
      if (id === 'b1') return Promise.reject(new Error('key 已失效'))
      return Promise.resolve(payload([['第一句', 1_700_000_000], ['第二句', 1_700_086_400]]))
    })

    const r = await backfillHighlightTimes()

    expect(r.failedBooks).toBe(1)
    expect(r.updated).toBe(2)
    expect(seams.logger.warn).toHaveBeenCalledWith(
      '划线时间回填失败（跳过该书）',
      { bookId: 'b1', error: 'Error: key 已失效' },
    )
  })

  it('没有缺口时一次请求都不发', async () => {
    seedBook('b1', '一本')
    seedFlatRows('b1', ['第一句'])

    const r = await backfillHighlightTimes()

    expect(r.books).toBe(0)
    expect(seams.fetchAllContent).not.toHaveBeenCalled()
  })

  it('标记里是坏数据也按"没试过"处理，不崩也不丢库里的行', async () => {
    seedBook('b1', '一本')
    seedFlatRows('b1', ['第一句', '第二句'])
    seams.fetchAllContent.mockResolvedValue(payload([['第一句', 1_700_000_000]]))

    for (const bad of ['不是 JSON', '[1,2]', '{"b1":"明天"}', 'null', '']) {
      seams.settings.set(ATTEMPT_KEY, bad)
      const r = await backfillHighlightTimes()
      expect(r.failedBooks).toBe(0)
    }
  })

  it('回填会推动检索索引重建（写计数器跟着变）', async () => {
    seedBook('b1', '一本')
    seedFlatRows('b1', ['第一句', '第二句'])
    seams.fetchAllContent.mockResolvedValue(payload([['第一句', 1_700_000_000]]))
    const before = highlightsDb.getRetrievalSignature()

    await backfillHighlightTimes()

    expect(highlightsDb.getRetrievalSignature()).not.toBe(before)
  })

  it('一条都没改动时不落"已尝试"标记之外的任何写', async () => {
    seedBook('b1', '一本')
    seedFlatRows('b1', ['第一句', '第二句'])
    seams.fetchAllContent.mockResolvedValue(payload([]))

    const r = await backfillHighlightTimes()

    expect({ updated: r.updated, books: r.books }).toEqual({ updated: 0, books: 0 })
    expect(r.unmatched).toBe(2)
    expect(storedTime('hl_第一句')).toBe('2026-09-02 12:28:58')
    // 但这本书确实被记下来了，否则下一轮还要白拉一次
    expect(String(seams.settings.get(ATTEMPT_KEY))).toContain('"b1"')
  })
})
