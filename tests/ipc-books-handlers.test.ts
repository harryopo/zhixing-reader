// ipc/books 的 handler 行为测试（2026-09-27，销覆盖率 DEBT 一笔）
//
// `electron/ipc/books.ts` 实测 **44.96 / 93.75 / 100**。既有那份 `review-enroll-channel.test.ts`
// 是真库跑入队三条通道，所以这个文件里**最容易出错的两块**一直没人碰：
//  1) `HIGHLIGHTS.CREATE` —— 渲染层可以发驼峰也可以发下划线，字段兜底写错就是"笔记存进去了
//     但章节名/区间丢了"；建卡失败还会被 catch 掉，只有这里能看出"划线条数没变少"；
//  2) `HIGHLIGHTS.EXPORT` —— 它真往磁盘写一份 Markdown（分组、排序、把换行转成硬换行、
//     书名映射），而界面上只有一句"导出完成"。分组与排序全在 handler 里，不在任何一层 db。
//
// 判据照旧：注册**真实的** registerBookHandlers，mock 只打在被测模块外面那圈缝上
// （database / settings-service / 章节回填 / 摘要服务 / logger / electron 的弹框）。
// 注意 `vi.mock` 的路径**相对本文件解析**，所以写 `../electron/...`。
// 导出那组不 mock fs —— 文件真写到 .test-tmp 下，再把它读回来对内容。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BrowserWindow, dialog } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'

/** 独占 profile：books.ts 连带加载 settings-service，它在模块期绑定 userData */
const PROFILE = 'user-data-ipc-books'
process.env.ZHIXING_TEST_PROFILE = PROFILE
const OUT_DIR = join(process.cwd(), '.test-tmp', PROFILE)

type Handler = (...args: unknown[]) => unknown

const seams = vi.hoisted(() => {
  const db = () => ({
    getAll: vi.fn(),
    getById: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    search: vi.fn(),
  })
  const cards = {
    getByHighlightId: vi.fn(),
    create: vi.fn(),
    getDueCards: vi.fn(),
    getDueCardsWithContent: vi.fn(),
    getDueQueueStats: vi.fn(),
    getByBookId: vi.fn(),
    getReviewStats: vi.fn(),
    enrollMany: vi.fn(),
    unenroll: vi.fn(),
    enrolledIds: vi.fn(),
  }
  return {
    books: { ...db(), getByBookId: vi.fn() },
    highlights: { ...db(), getByBookId: vi.fn() },
    cards,
    reviews: { create: vi.fn(), getRecent: vi.fn() },
    summaries: { getByBookId: vi.fn() },
    chapterSummaries: { getByBookId: vi.fn() },
    settings: { get: vi.fn() },
    backfill: { backfillChapterTitles: vi.fn() },
    summarySvc: { findPendingSummaries: vi.fn(), generateBookSummaries: vi.fn() },
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
})

vi.mock('../electron/database', () => ({
  booksDb: seams.books,
  highlightsDb: seams.highlights,
  cardsDb: seams.cards,
  reviewsDb: seams.reviews,
  bookSummariesDb: seams.summaries,
  chapterSummariesDb: seams.chapterSummaries,
}))
vi.mock('../electron/services/settings-service', () => ({ settingsService: seams.settings }))
vi.mock('../electron/services/chapter-title-backfill', () => seams.backfill)
vi.mock('../electron/services/chapter-summary-service', () => seams.summarySvc)
vi.mock('../electron/logger', () => ({ logger: seams.logger }))

let at: (name: string) => Handler

beforeEach(async () => {
  vi.clearAllMocks()
  fs.rmSync(OUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(OUT_DIR, { recursive: true })
  // 全局 electron stub 只给了 getAllWindows；导出那条路先问 getFocusedWindow
  Object.assign(BrowserWindow, { getFocusedWindow: vi.fn(() => null) })
  seams.settings.get.mockReturnValue(undefined)
  vi.resetModules()
  const { registerBookHandlers } = await import('../electron/ipc/books')
  const handlers = new Map<string, Handler>()
  registerBookHandlers((channel: string, handler: Handler) => handlers.set(channel, handler))
  at = (name: string): Handler => {
    const fn = handlers.get(name)
    if (!fn) throw new Error(`handler 未注册：${name}`)
    return fn
  }
})

afterEach(() => {
  fs.rmSync(OUT_DIR, { recursive: true, force: true })
})

describe('书籍 / 划线 / 卡片 / 复习 / 摘要的读取：原样透传，不加也不减', () => {
  /** 通道 → 库里那份被调的东西。透传类判据只有一份表，加通道时改这里 */
  const passthrough: Array<{
    channel: string
    spy: ReturnType<typeof vi.fn>
    args: unknown[]
    expected: unknown[]
  }> = [
    { channel: IPC_CHANNELS.BOOKS.GET_ALL, spy: seams.books.getAll, args: [], expected: [] },
    { channel: IPC_CHANNELS.BOOKS.GET_BY_ID, spy: seams.books.getById, args: ['b1'], expected: ['b1'] },
    { channel: IPC_CHANNELS.BOOKS.SEARCH, spy: seams.books.search, args: ['思维'], expected: ['思维'] },
    { channel: IPC_CHANNELS.HIGHLIGHTS.GET_BY_BOOK, spy: seams.highlights.getByBookId, args: ['b1'], expected: ['b1'] },
    { channel: IPC_CHANNELS.HIGHLIGHTS.GET_BY_ID, spy: seams.highlights.getById, args: ['hl1'], expected: ['hl1'] },
    { channel: IPC_CHANNELS.HIGHLIGHTS.GET_ALL, spy: seams.highlights.getAll, args: [], expected: [] },
    { channel: IPC_CHANNELS.CARDS.GET_BY_BOOK, spy: seams.cards.getByBookId, args: ['b1'], expected: ['b1'] },
    { channel: IPC_CHANNELS.CARDS.GET_STATS, spy: seams.cards.getReviewStats, args: [], expected: [] },
    { channel: IPC_CHANNELS.REVIEWS.GET_RECENT, spy: seams.reviews.getRecent, args: [20], expected: [20] },
    { channel: IPC_CHANNELS.REVIEWS.CREATE, spy: seams.reviews.create, args: ['c1', 3], expected: ['c1', 3] },
    { channel: IPC_CHANNELS.SUMMARIES.GET_BY_BOOK, spy: seams.summaries.getByBookId, args: ['b1'], expected: ['b1'] },
    { channel: IPC_CHANNELS.SUMMARIES.GET_CHAPTERS, spy: seams.chapterSummaries.getByBookId, args: ['b1'], expected: ['b1'] },
  ]

  it.each(passthrough.map((p) => [p.channel, p] as const))('%s 交回库那一层的结果、参数一字不改', (_channel, p) => {
    p.spy.mockReturnValue([{ id: 'x' }])
    expect(at(p.channel)(...p.args)).toEqual([{ id: 'x' }])
    expect(p.spy).toHaveBeenCalledWith(...p.expected)
  })

  it('写库三条（建书 / 改书 / 删书 / 改划线）把 id 与整包记录原样交给库', () => {
    seams.books.create.mockReturnValue(undefined)
    at(IPC_CHANNELS.BOOKS.CREATE)({ id: 'b9', title: '新加一本' })
    expect(seams.books.create).toHaveBeenCalledWith({ id: 'b9', title: '新加一本' })

    at(IPC_CHANNELS.BOOKS.UPDATE)('b9', { title: '改名' })
    expect(seams.books.update).toHaveBeenCalledWith('b9', { title: '改名' })

    at(IPC_CHANNELS.BOOKS.DELETE)('b9')
    expect(seams.books.delete).toHaveBeenCalledWith('b9')

    at(IPC_CHANNELS.HIGHLIGHTS.UPDATE)('hl1', { note: '补一条笔记' })
    expect(seams.highlights.update).toHaveBeenCalledWith('hl1', { note: '补一条笔记' })
  })

  it('一次性回填章节名：给了书就只补那一本，没给就补全库', async () => {
    const { backfillChapterTitles } = await import('../electron/services/chapter-title-backfill')
    at(IPC_CHANNELS.HIGHLIGHTS.BACKFILL_CHAPTER_TITLES)('b1')
    expect(backfillChapterTitles).toHaveBeenCalledWith('b1')
    at(IPC_CHANNELS.HIGHLIGHTS.BACKFILL_CHAPTER_TITLES)()
    expect(backfillChapterTitles).toHaveBeenLastCalledWith(undefined)
  })

  it('摘要生成 / 欠摘要清单两条都只转发一次，不自己算', async () => {
    const svc = await import('../electron/services/chapter-summary-service')
    vi.mocked(svc.generateBookSummaries).mockReturnValue({ ok: true } as never)
    expect(at(IPC_CHANNELS.SUMMARIES.GENERATE)('b1')).toEqual({ ok: true })
    expect(svc.generateBookSummaries).toHaveBeenCalledWith('b1')

    vi.mocked(svc.findPendingSummaries).mockReturnValue([{ bookId: 'b2', pending: 3 }] as never)
    expect(at(IPC_CHANNELS.SUMMARIES.FRESHNESS)()).toEqual([{ bookId: 'b2', pending: 3 }])
    expect(svc.findPendingSummaries).toHaveBeenCalledTimes(1)
  })
})

describe('每日新卡上限：这个数怎么从设置走到队列查询', () => {
  it('三条队列查询都带上设置里那一份（不是各查各的）', () => {
    seams.settings.get.mockReturnValue(7)
    seams.cards.getDueQueueStats.mockReturnValue({ actionable: 0 })
    at(IPC_CHANNELS.CARDS.GET_DUE)(50)
    at(IPC_CHANNELS.CARDS.GET_DUE_WITH_CONTENT)(50)
    at(IPC_CHANNELS.CARDS.GET_QUEUE_STATS)()
    expect(seams.cards.getDueCards).toHaveBeenCalledWith(50, 7)
    expect(seams.cards.getDueCardsWithContent).toHaveBeenCalledWith(50, 7)
    expect(seams.cards.getDueQueueStats).toHaveBeenCalledWith(7)
  })

  it('用户显式设成 0（暂停新卡）时不许被换成默认 15', () => {
    seams.settings.get.mockReturnValue(0)
    at(IPC_CHANNELS.CARDS.GET_QUEUE_STATS)()
    expect(seams.cards.getDueQueueStats).toHaveBeenCalledWith(0)
  })

  it('没设置过才用默认 15；读设置抛错也照样给默认（不能把整条查询弄失败）', () => {
    seams.settings.get.mockReturnValue(undefined)
    at(IPC_CHANNELS.CARDS.GET_QUEUE_STATS)()
    expect(seams.cards.getDueQueueStats).toHaveBeenLastCalledWith(15)

    seams.settings.get.mockImplementation(() => {
      throw new Error('settings.json 读不出来')
    })
    expect(() => at(IPC_CHANNELS.CARDS.GET_QUEUE_STATS)()).not.toThrow()
    expect(seams.cards.getDueQueueStats).toHaveBeenLastCalledWith(15)
  })
})

describe('新建划线：字段兜底 + 顺带建卡', () => {
  it('没给 id 时自己生成一个带 hl_ 前缀的，并且回传给库', () => {
    seams.highlights.create.mockReturnValue(true)
    seams.cards.getByHighlightId.mockReturnValue(undefined)
    at(IPC_CHANNELS.HIGHLIGHTS.CREATE)({ book_id: 'b1', content: '一句话' })
    const row = seams.highlights.create.mock.calls[0][0] as Record<string, unknown>
    expect(String(row.id)).toMatch(/^hl_\d+_/)
    expect(row.book_id).toBe('b1')
    expect(row.content).toBe('一句话')
  })

  it('给了 id 就用给的那个（撤销删除要靠它把原 id 塞回来）', () => {
    seams.highlights.create.mockReturnValue(true)
    seams.cards.getByHighlightId.mockReturnValue({ id: 'c1' })
    at(IPC_CHANNELS.HIGHLIGHTS.CREATE)({ id: 'hl_fixed', book_id: 'b1', content: 'x' })
    expect(seams.highlights.create.mock.calls[0][0]).toMatchObject({ id: 'hl_fixed' })
    // 已经有卡了就不许再建第二张
    expect(seams.cards.create).not.toHaveBeenCalled()
  })

  it('驼峰与下划线两种写法都收（渲染层发哪种都行）', () => {
    seams.highlights.create.mockReturnValue(true)
    seams.cards.getByHighlightId.mockReturnValue(undefined)
    at(IPC_CHANNELS.HIGHLIGHTS.CREATE)({
      id: 'hl2',
      bookId: 'b7',
      chapterTitle: '第二章',
      rangeStart: 3,
      rangeEnd: 9,
      content: 'x',
    })
    expect(seams.highlights.create.mock.calls[0][0]).toMatchObject({
      book_id: 'b7',
      chapter_title: '第二章',
      range_start: 3,
      range_end: 9,
    })
  })

  it('createdAt 两种写法都转给库层 —— 这一列以前在这里被整个丢掉', () => {
    seams.highlights.create.mockReturnValue(true)
    seams.cards.getByHighlightId.mockReturnValue(undefined)

    at(IPC_CHANNELS.HIGHLIGHTS.CREATE)({
      id: 'hl_t1',
      bookId: 'b7',
      content: 'x',
      createdAt: '2023-11-14T22:13:20.000Z',
    })
    expect(seams.highlights.create.mock.calls[0][0]).toMatchObject({
      created_at: '2023-11-14T22:13:20.000Z',
    })

    at(IPC_CHANNELS.HIGHLIGHTS.CREATE)({
      id: 'hl_t2',
      book_id: 'b7',
      content: 'y',
      created_at: '2023-11-14 22:13:20',
    })
    expect(seams.highlights.create.mock.calls[1][0]).toMatchObject({
      created_at: '2023-11-14 22:13:20',
    })
  })

  it('没给时间时传 null，让库吃自己的 DEFAULT（不是 undefined）', () => {
    seams.highlights.create.mockReturnValue(true)
    seams.cards.getByHighlightId.mockReturnValue(undefined)

    at(IPC_CHANNELS.HIGHLIGHTS.CREATE)({ id: 'hl_t3', book_id: 'b7', content: 'x' })

    expect(seams.highlights.create.mock.calls[0][0]).toMatchObject({ created_at: null })
  })

  it('note / style 缺省时落成 null 与 0，而不是 undefined（库里那两列不是可选的）', () => {
    seams.highlights.create.mockReturnValue(true)
    seams.cards.getByHighlightId.mockReturnValue(undefined)
    at(IPC_CHANNELS.HIGHLIGHTS.CREATE)({ id: 'hl3', book_id: 'b1', content: 'x' })
    const row = seams.highlights.create.mock.calls[0][0] as Record<string, unknown>
    expect(row.note).toBeNull()
    expect(row.style).toBe(0)
    expect(row.chapter_title).toBeNull()
    expect(row.range_start).toBeNull()
  })

  it('划线建成功才顺带建 FSRS 卡；库里已有那句的不建', () => {
    // 补上用户想法那种命中也不算"新起一行"：那句原文早就有它自己的复习卡，
    // 补进来的想法是一个新记忆点内容，不是一张新卡
    seams.highlights.create.mockReturnValue({ created: false, noteFilled: true, chapterFilled: false })
    at(IPC_CHANNELS.HIGHLIGHTS.CREATE)({ id: 'hl4', book_id: 'b1', content: 'x' })
    expect(seams.cards.getByHighlightId).not.toHaveBeenCalled()
    expect(seams.cards.create).not.toHaveBeenCalled()
  })

  it('什么都没补成时同样不建卡', () => {
    seams.highlights.create.mockReturnValue({ created: false, noteFilled: false, chapterFilled: false })
    at(IPC_CHANNELS.HIGHLIGHTS.CREATE)({ id: 'hl4b', book_id: 'b1', content: 'x' })
    expect(seams.cards.create).not.toHaveBeenCalled()
  })

  it('建卡失败只记一条错误日志，划线本身照样算成功', () => {
    seams.highlights.create.mockReturnValue({ created: true, noteFilled: false, chapterFilled: false })
    seams.cards.getByHighlightId.mockReturnValue(undefined)
    seams.cards.create.mockImplementation(() => {
      throw new Error('cards 表写入被锁')
    })
    expect(at(IPC_CHANNELS.HIGHLIGHTS.CREATE)({ id: 'hl5', book_id: 'b1', content: 'x' }))
      .toEqual({ created: true, noteFilled: false, chapterFilled: false })
    expect(seams.logger.error).toHaveBeenCalledWith(
      'Auto-create FSRS card failed',
      expect.objectContaining({ highlightId: 'hl5' }),
    )
  })
})

describe('导出笔记：分组、排序、转义，最后真落到那个文件', () => {
  const OUT = join(OUT_DIR, 'notes.md')

  function picks(path: string) {
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: path } as never)
  }

  it('库里一条笔记都没有 ⇒ 先说不，不弹保存框', async () => {
    seams.highlights.getAll.mockResolvedValue([])
    await expect(at(IPC_CHANNELS.HIGHLIGHTS.EXPORT)()).rejects.toThrow(/没有可导出的笔记/)
    expect(dialog.showSaveDialog).not.toHaveBeenCalled()
    expect(seams.books.getAll).not.toHaveBeenCalled()
  })

  it('用户在保存框点了取消 ⇒ 报没保存，文件一个都不许产生', async () => {
    seams.highlights.getAll.mockResolvedValue([{ id: 'h1', book_id: 'b1', content: 'x' }])
    seams.books.getAll.mockResolvedValue([{ id: 'b1', title: '一本书' }])
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: true } as never)
    expect(await at(IPC_CHANNELS.HIGHLIGHTS.EXPORT)()).toEqual({ saved: false, count: 0 })
    expect(fs.existsSync(OUT)).toBe(false)
  })

  it('正常导出：按书分组、书名对得上、书内按时间倒序、条数与结构都对', async () => {
    seams.highlights.getAll.mockResolvedValue([
      { id: 'h1', book_id: 'b1', chapter_title: '第一章', content: '早的一条', created_at: '2026-01-02T00:00:00Z' },
      { id: 'h2', book_id: 'b1', chapter_title: '第二章', content: '晚的一条', note: '我的想法', created_at: '2026-03-04T00:00:00Z' },
      { id: 'h3', book_id: 'b9', content: '这本书没在库里', created_at: '2026-02-02T00:00:00Z' },
    ])
    seams.books.getAll.mockResolvedValue([{ id: 'b1', title: '被讨厌的勇气' }])
    picks(OUT)

    const res = await at(IPC_CHANNELS.HIGHLIGHTS.EXPORT)()
    expect(res).toMatchObject({ saved: true, count: 3, path: OUT })

    const text = fs.readFileSync(OUT, 'utf8')
    expect(text.split('\n')[0]).toBe('# 知行读书 · 读书笔记导出')
    expect(text).toContain('共 3 条笔记')
    expect(text).toContain('## 《被讨厌的勇气》')
    // 库里查不到书的那条不是丢掉，而是落在《未知书籍》下面
    expect(text).toContain('## 《未知书籍》')
    // 时间倒序：同一本书里 3 月那条排在 1 月前面
    expect(text.indexOf('晚的一条')).toBeLessThan(text.indexOf('早的一条'))
    expect(text).toContain('**批注**：我的想法')
    // 没写批注的那条不许出现"批注"这个标签
    expect(text.split('### 第一章')[1].split('### ')[0]).not.toContain('**批注**')
    expect(seams.logger.info).toHaveBeenCalledWith('Highlights exported', expect.objectContaining({ count: 3 }))
  })

  it('正文里的换行转成 Markdown 硬换行（不转就会被并成一行）', async () => {
    seams.highlights.getAll.mockResolvedValue([
      { id: 'h1', book_id: 'b1', content: '上半句\n下半句', created_at: '2026-01-01T00:00:00Z' },
    ])
    seams.books.getAll.mockResolvedValue([{ id: 'b1', title: '一本书' }])
    picks(OUT)
    await at(IPC_CHANNELS.HIGHLIGHTS.EXPORT)()
    const text = fs.readFileSync(OUT, 'utf8')
    expect(text).toContain('> 上半句  \n下半句')
  })

  it('库里那串空格分隔的时间是 UTC：导出的文件里不许早 8 小时', async () => {
    // 真实库里绝大部分行就是这个形状（`datetime('now')` 与划线导入写回的 toSqliteDateTime）。
    // 按本地时区解释它会把每一行「**时间**」都印早一个时区差；这里拿"同一个瞬间的本地表示"对账，
    // 所以本机与 CI（UTC）上都是同一条判据。
    const utcWallClock = '2026-05-06 07:08:09'
    const trueInstant = new Date(`${utcWallClock.replace(' ', 'T')}Z`)
    seams.highlights.getAll.mockResolvedValue([
      { id: 'h1', book_id: 'b1', content: '一条按库里形状存的划线', created_at: utcWallClock },
      { id: 'h2', book_id: 'b1', content: '另一条', created_at: '2026-05-06T07:08:00.000Z' },
    ])
    seams.books.getAll.mockResolvedValue([{ id: 'b1', title: '一本书' }])
    picks(OUT)
    await at(IPC_CHANNELS.HIGHLIGHTS.EXPORT)()

    const text = fs.readFileSync(OUT, 'utf8')
    expect(text).toContain(`**时间**：${trueInstant.toLocaleString('zh-CN')}`)
    // 倒序也按真实时刻排：带 Z 的那条（07:08:00）比上面那条（07:08:09）早，排在后面
    expect(text.indexOf('一条按库里形状存的划线')).toBeLessThan(text.indexOf('另一条'))
  })

  it('章名缺失时是「未知章节」，时间是脏值时是「未知时间」，都不许写成 undefined', async () => {
    seams.highlights.getAll.mockResolvedValue([
      { id: 'h1', book_id: 'b1', content: '一句话', chapter_title: null, created_at: 'not-a-date' },
    ])
    seams.books.getAll.mockResolvedValue([{ id: 'b1', title: '一本书' }])
    picks(OUT)
    await at(IPC_CHANNELS.HIGHLIGHTS.EXPORT)()
    const text = fs.readFileSync(OUT, 'utf8')
    expect(text).toContain('### 未知章节')
    expect(text).toContain('**时间**：未知时间')
    expect(text).not.toContain('undefined')
  })

  it('书名为空串时按「未知书籍」处理（不是留一个空的二级标题）', async () => {
    seams.highlights.getAll.mockResolvedValue([
      { id: 'h1', book_id: 'b1', content: 'x', created_at: '2026-01-01T00:00:00Z' },
    ])
    seams.books.getAll.mockResolvedValue([{ id: 'b1', title: '' }])
    picks(OUT)
    await at(IPC_CHANNELS.HIGHLIGHTS.EXPORT)()
    expect(fs.readFileSync(OUT, 'utf8')).toContain('## 《未知书籍》')
  })

  it('一条划线都没有 book_id 时，全部归到同一组而不是各拆一组', async () => {
    seams.highlights.getAll.mockResolvedValue([
      { id: 'h1', content: '没挂书的笔记', created_at: '2026-01-01T00:00:00Z' },
      { id: 'h2', content: '另一条', created_at: '2026-01-03T00:00:00Z' },
    ])
    seams.books.getAll.mockResolvedValue([])
    picks(OUT)
    const res = await at(IPC_CHANNELS.HIGHLIGHTS.EXPORT)()
    expect(res).toMatchObject({ saved: true, count: 2 })
    const text = fs.readFileSync(OUT, 'utf8')
    // 只出现一个二级标题分组，两条都在它下面；组内仍是时间倒序
    expect(text.match(/^## /gm)).toHaveLength(1)
    expect(text.indexOf('另一条')).toBeLessThan(text.indexOf('没挂书的笔记'))
  })

  it('缺字段的那几条照样列出来：没正文给空引用块、没时间给「未知时间」、书没有 id 就归 unknown', async () => {
    seams.highlights.getAll.mockResolvedValue([
      { id: 'h1', book_id: 'b1' },
      { id: 'h2', book_id: 'b1', content: '有正文但没时间', note: '也没时间' },
    ])
    seams.books.getAll.mockResolvedValue([{ title: '没有 id 的一本书' }])
    picks(OUT)
    const res = await at(IPC_CHANNELS.HIGHLIGHTS.EXPORT)()
    expect(res).toMatchObject({ saved: true, count: 2 })
    const text = fs.readFileSync(OUT, 'utf8')
    // 书名照样在（那一行靠的是 bookMap 里 `|| '未知书籍'` 的兜底，不是把整组丢掉）
    expect(text).toContain('## 《未知书籍》')
    expect(text).toContain('> 有正文但没时间')
    expect(text).toContain('**时间**：未知时间')
    expect(text).not.toContain('undefined')
    expect(text.match(/\*\*时间\*\*：未知时间/g)).toHaveLength(2)
  })
})

describe('复习队列三条：白名单先过，再谈数据库', () => {
  it.each(['highlight', 'knowledge_card', 'methodology'])('%s 在名单里，转成 {kind,id} 交给库', (kind) => {
    seams.cards.enrollMany.mockReturnValue({ created: 2, skipped: 0 })
    seams.cards.getDueQueueStats.mockReturnValue({ actionable: 11 })
    expect(at(IPC_CHANNELS.CARDS.ENROLL)(kind, ['a', 'b'])).toEqual({
      created: 2,
      skipped: 0,
      actionable: 11,
    })
    expect(seams.cards.enrollMany).toHaveBeenCalledWith([
      { kind, id: 'a' },
      { kind, id: 'b' },
    ])
  })

  it.each(['book', 'HIGHLIGHT', '', 'null'])('类型「%s」不在名单里 ⇒ 抛错且一次都不碰库', (kind) => {
    expect(() => at(IPC_CHANNELS.CARDS.ENROLL)(kind, ['a'])).toThrow(/不支持放进复习队列的来源类型/)
    expect(seams.cards.enrollMany).not.toHaveBeenCalled()
  })

  it.each([[undefined], [null], ['a'], [['a', '']], [[1]], [[null]]])(
    'ids 不是"非空字符串数组"时整条拒掉（%s）',
    (ids) => {
      expect(() => at(IPC_CHANNELS.CARDS.ENROLL)('highlight', ids as never)).toThrow(/id 不合法/)
      expect(seams.cards.enrollMany).not.toHaveBeenCalled()
    },
  )

  it('移出：只认名单内的类型，返回 removed 布尔', () => {
    seams.cards.unenroll.mockReturnValue(true)
    expect(at(IPC_CHANNELS.CARDS.UNENROLL)('knowledge_card', 'k1')).toEqual({ removed: true })
    expect(seams.cards.unenroll).toHaveBeenCalledWith({ kind: 'knowledge_card', id: 'k1' })
    expect(() => at(IPC_CHANNELS.CARDS.UNENROLL)('nonsense', 'k1')).toThrow(/不支持/)
  })

  it('已入队名单：类型不认识时回空数组，不去查库也不抛', () => {
    seams.cards.enrolledIds.mockReturnValue(['k1'])
    expect(at(IPC_CHANNELS.CARDS.ENROLLED_SOURCES)('knowledge_card')).toEqual({ ids: ['k1'] })
    expect(at(IPC_CHANNELS.CARDS.ENROLLED_SOURCES)('book')).toEqual({ ids: [] })
    expect(seams.cards.enrolledIds).toHaveBeenCalledTimes(1)
  })
})
