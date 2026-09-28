// knowledge-card-service 真库行为测试（2026-09-28，销覆盖率 DEBT 一笔）
//
// `electron/services/knowledge-card-service.ts` 实测 **69.34 / 81.81 / 76.92**。
// 既有那份 `knowledge-card-service.test.ts` 把 `electron/database` 整个 mock 掉了 ——
// 它证明的是"服务按 mock 的返回值算数"，证不了"库里到底有没有这一行"。
// 而这个服务最要紧的两块恰好都在写库：
//  1) **库里没划线时去微信读书把笔记搬回来** —— 2026-09-28 实测出它和另一条通路
//     同一个漏 `id` 的写法（sql.js 每条 INSERT 都抛错，被 try/catch 咽进日志，
//     界面最后收到的是「该书在微信读书中也没有笔记」），章节名也绕开了共用解析器；
//  2) **批次台账与卡片的落库顺序**（AI 成功才记台账、replace 要连台账一起归零）。
// 所以这份用**真库**，mock 只打在 weread-api / ai-service / logger / BrowserWindow 四份外圈。
//
// 定时器那两条：服务的清理定时器在**模块加载时**注册，所以要先把 setInterval 换掉、
// 把回调攒下来手动触发（fake timers 追不上 30 分钟的 TTL，只会墙钟超时、红得没法读）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BrowserWindow } from 'electron'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import {
  aiBatchesDb,
  booksDb,
  getDatabase,
  highlightsDb,
  knowledgeCardsDb,
} from '../electron/database'

const seams = vi.hoisted(() => ({
  profile: 'user-data-kcs-real-db',
  fetchAllContent: vi.fn(),
  distill: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  /** 服务构造期注册的清理定时器回调，攒下来手动触发 */
  ticks: [] as Array<() => void>,
}))

process.env.ZHIXING_TEST_PROFILE = seams.profile

vi.mock('../electron/weread-api', () => ({ fetchAllContent: seams.fetchAllContent }))
vi.mock('../electron/ai-service', () => ({ distillKnowledgeCards: seams.distill }))
vi.mock('../electron/logger', () => ({ logger: seams.logger }))

const realSetInterval = globalThis.setInterval
vi.stubGlobal('setInterval', (cb: () => void, ms: number) => {
  if (ms === 5 * 60 * 1000) seams.ticks.push(cb)
  return realSetInterval(() => undefined, ms)
})

const { knowledgeCardService } = await import('../electron/services/knowledge-card-service')

/** 库里那一行的原始 created_at（不经过映射器，形状要和库里对得上） */
function storedCreatedAt(id: string): string | null {
  const rows = getDatabase().exec('SELECT created_at FROM highlights WHERE id = ?', [id])
  return rows.length > 0 ? String(rows[0].values[0][0]) : null
}

/** sqlite `datetime('now')` 那一形状：第 10 位是空格，不带 T 也不带 Z */
const SQLITE_SHAPE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/

function utcOf(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 19).replace('T', ' ')
}

const WEREAD_CONTENT = {
  bookmarks: [
    { bookmarkId: 'w1', chapterUid: 5, chapterTitle: '', markText: '第一条摘句', createTime: 1_700_000_000 },
    { bookmarkId: 'w2', chapterUid: 6, chapterTitle: '', markText: '第二条摘句', createTime: 1_700_003_600 },
  ],
  notes: [
    { reviewId: 'r1', chapterUid: 5, chapterTitle: '', abstract: '被划的那一句', content: '我当时的想法', createTime: 1_700_007_200 },
  ],
  chapters: [{ chapterUid: 5, title: '第一章 关系的起点' }, { chapterUid: 6, title: '第二章 课题分离' }],
}

function oneCard() {
  return [
    {
      type: 'concept',
      title: '一个概念',
      content: '正文',
      interpretation: '解读',
      application: '应用',
      tags: ['tag'],
      sourceHighlightId: 1,
    },
  ]
}

beforeEach(async () => {
  await setupTestDatabase()
  booksDb.create({ id: 'b1', title: '一本书' })
  seams.fetchAllContent.mockReset()
  seams.fetchAllContent.mockResolvedValue(WEREAD_CONTENT)
  seams.distill.mockReset()
  seams.distill.mockResolvedValue(oneCard())
  seams.logger.info.mockClear()
  seams.logger.warn.mockClear()
  seams.logger.error.mockClear()
})

afterEach(() => {
  teardownTestDatabase()
  vi.useRealTimers()
})

describe('库里没划线时去微信读书搬回来（真库）', () => {
  it('搬回来的三条真的在库里，且每条都有 id', async () => {
    await knowledgeCardService.distillBook('b1', '一本书')

    const rows = highlightsDb.getByBookId('b1')
    expect(rows).toHaveLength(3)
    for (const row of rows) {
      expect(String(row.id)).toMatch(/^hl_/)
    }
  })

  it('章节名从 chapters 对照表来 —— 接口没给、自己也不去查就永远是空串', async () => {
    await knowledgeCardService.distillBook('b1', '一本书')

    const byContent = new Map(highlightsDb.getByBookId('b1').map((r) => [String(r.content), String(r.chapter_title)]))
    expect(byContent.get('第一条摘句')).toBe('第一章 关系的起点')
    expect(byContent.get('第二条摘句')).toBe('第二章 课题分离')
  })

  it('created_at 是微信读书里真实的划线时刻，不是导入那一刻', async () => {
    await knowledgeCardService.distillBook('b1', '一本书')

    const row = highlightsDb.getByBookId('b1').find((r) => r.content === '第一条摘句') as { id: string }
    expect(storedCreatedAt(String(row.id))).toBe(utcOf(1_700_000_000))
    // 旧写法把这列整个丢掉 ⇒ 落库吃的是 DEFAULT（=此刻），三个时间戳全挤在同一秒
    expect(storedCreatedAt(String(row.id))).not.toMatch(/^202[6-9]/)
  })

  it('三条不同时刻的行导入后仍是三个不同的 created_at —— 被压成"导入那一刻"就是这个缺陷的形状', async () => {
    await knowledgeCardService.distillBook('b1', '一本书')

    const stamps = highlightsDb.getByBookId('b1').map((r) => storedCreatedAt(String(r.id)))
    expect(new Set(stamps).size).toBe(3)
    expect(new Set(stamps.map((s) => String(s).slice(0, 10)))).toEqual(new Set(['2023-11-14', '2023-11-15']))
  })

  it('存进去的形状与库里其它行一致（第 10 位是空格，不是 ISO 的 T）', async () => {
    await knowledgeCardService.distillBook('b1', '一本书')

    for (const row of highlightsDb.getByBookId('b1')) {
      expect(storedCreatedAt(String(row.id))).toMatch(SQLITE_SHAPE)
    }
  })

  it('没有 createTime 那条不写 1970，改吃库里的 DEFAULT', async () => {
    seams.fetchAllContent.mockResolvedValue({
      bookmarks: [{ bookmarkId: 'w3', chapterUid: 5, markText: '没时间戳的一句' }],
      notes: [],
      chapters: WEREAD_CONTENT.chapters,
    })

    await knowledgeCardService.distillBook('b1', '一本书')

    const row = highlightsDb.getByBookId('b1')[0]
    const stored = storedCreatedAt(String(row.id)) as string
    expect(stored.startsWith('1970')).toBe(false)
    expect(stored).toMatch(SQLITE_SHAPE)
  })

  it('想法那条分两列：正文=被划的摘句、note=用户自己写的想法', async () => {
    await knowledgeCardService.distillBook('b1', '一本书')

    const note = highlightsDb.getByBookId('b1').find((r) => r.content === '被划的那一句') as {
      note: string | null;
      chapter_title: string;
    }
    expect(note.note).toBe('我当时的想法')
    expect(note.chapter_title).toBe('第一章 关系的起点')
  })

  it('同一句摘句在返回里出现两次时只插一条，报的数不虚报', async () => {
    seams.fetchAllContent.mockResolvedValue({
      bookmarks: [
        { bookmarkId: 'w1', chapterUid: 5, markText: '重复的一句', createTime: 1_700_000_000 },
        { bookmarkId: 'w2', chapterUid: 5, markText: '重复的一句', createTime: 1_700_000_600 },
        { bookmarkId: 'w3', chapterUid: 6, markText: '另一句', createTime: 1_700_001_200 },
      ],
      notes: [],
      chapters: WEREAD_CONTENT.chapters,
    })

    await knowledgeCardService.distillBook('b1', '一本书')

    expect(highlightsDb.getByBookId('b1')).toHaveLength(2)
    expect(seams.logger.info.mock.calls.map((c) => String(c[0]))).toContain(
      'Imported 2 highlights from WeRead for "一本书"',
    )
  })

  it('库里和微信读书都没有 ⇒ 说「也没有笔记」，不说「导入失败」', async () => {
    seams.fetchAllContent.mockResolvedValue({ bookmarks: [], notes: [], chapters: [] })

    await expect(knowledgeCardService.distillBook('b1', '一本书')).rejects.toThrow(
      '该书在微信读书中也没有笔记，无法蒸馏知识卡片',
    )
  })

  it('接口抛错 ⇒ 报的是「自动导入笔记失败: …」，两种失败不混', async () => {
    seams.fetchAllContent.mockRejectedValue(new Error('key 已失效'))

    await expect(knowledgeCardService.distillBook('b1', '一本书')).rejects.toThrow(
      '自动导入笔记失败: key 已失效',
    )
  })

  it('单条插入真抛错时只丢那一条，其余照常搬进来', async () => {
    const realCreate = highlightsDb.create.bind(highlightsDb)
    const spy = vi.spyOn(highlightsDb, 'create').mockImplementation((h: Record<string, unknown>) => {
      if (h.content === '第二条摘句') throw new Error('这一条被挡了')
      return realCreate(h)
    })
    try {
      await knowledgeCardService.distillBook('b1', '一本书')

      // 三条里挡掉一条：库里剩两条，日志说的也是两条
      expect(highlightsDb.getByBookId('b1')).toHaveLength(2)
      expect(seams.logger.info.mock.calls.map((c) => String(c[0]))).toContain(
        'Imported 2 highlights from WeRead for "一本书"',
      )
      expect(seams.logger.error).toHaveBeenCalledWith('导入划线失败:', expect.any(Error))
    } finally {
      spy.mockRestore()
    }
  })

  it('force=true 时不去搬：库里没划线就直接说没有笔记，一次接口都不发', async () => {
    await expect(
      knowledgeCardService.distillBook('b1', '一本书', { force: true }),
    ).rejects.toThrow('该书没有笔记，无法蒸馏')
    expect(seams.fetchAllContent).not.toHaveBeenCalled()
  })

  it('非 force 时先问接口，再决定有没有得蒸馏', async () => {
    await knowledgeCardService.distillBook('b1', '一本书')
    expect(seams.fetchAllContent).toHaveBeenCalledWith('b1')
  })
})

describe('卡片落库与批次台账', () => {
  it('AI 回来的卡片真进库、返回的每一张带 id、来源列存的是 ai-service 换算出的划线 id', async () => {
    // 索引 → 真实划线 id 的换算在 ai-service 里（那里另有测试），
    // 这一层要保证的是：喂给它的每条都带 id，拿回来的那个 id 原样落库。
    seams.distill.mockImplementation((fed: Array<{ id: string }>) => [
      { ...oneCard()[0], sourceHighlightId: fed[0].id },
    ])

    const result = await knowledgeCardService.distillBook('b1', '一本书')

    expect(result.cards).toHaveLength(1)
    expect(String(result.cards[0].id)).toMatch(/^kc_/)
    const saved = knowledgeCardsDb.getAll().find((c) => c.id === result.cards[0].id) as {
      source_highlight_id: string;
      title: string;
    }
    expect(saved.title).toBe('一个概念')
    expect(saved.source_highlight_id).toBe(String(seams.distill.mock.calls[0][0][0].id))
  })

  it('搬回来的每条划线都记进台账，下次点不会被重复喂一遍', async () => {
    await knowledgeCardService.distillBook('b1', '一本书')

    const ids = highlightsDb.getByBookId('b1').map((r) => String(r.id)).sort()
    expect(aiBatchesDb.getProcessedIds('b1', 'knowledgeCards').sort()).toEqual(ids)
  })

  it('整本都记过 ⇒ 一次 AI 都不调，界面收到「都已生成过」而不是「完成」', async () => {
    await knowledgeCardService.distillBook('b1', '一本书')
    seams.distill.mockClear()

    const second = await knowledgeCardService.distillBook('b1', '一本书')

    expect(seams.distill).not.toHaveBeenCalled()
    expect(second.nothingNew).toBe(true)
    expect(second.cards).toEqual([])
  })

  it('replace=true：旧卡片与台账一起清零，库里只剩这一批新的', async () => {
    const first = await knowledgeCardService.distillBook('b1', '一本书')
    seams.distill.mockResolvedValue([
      { type: 'quote', title: '换了一张', content: '新正文', tags: [] },
    ])

    const second = await knowledgeCardService.distillBook('b1', '一本书', { replace: true })

    const left = knowledgeCardsDb.getAll().filter((c) => c.book_id === 'b1')
    expect(left).toHaveLength(1)
    expect(String(left[0].title)).toBe('换了一张')
    expect(second.cards[0].id).not.toBe(first.cards[0].id)
  })

  it('有卡片但台账是空的（台账上线前生成的老卡片）：喂全部，不被当成「没有新东西」', async () => {
    await knowledgeCardService.distillBook('b1', '一本书')
    // 手工抹掉台账，模拟"卡片在、进度无从追溯"
    aiBatchesDb.clear('b1', 'knowledgeCards')
    seams.distill.mockClear()

    await knowledgeCardService.distillBook('b1', '一本书')

    expect(seams.distill.mock.calls[0][0]).toHaveLength(3)
  })

  it('只记过一部分时，第二次喂的确实是没记过的那批', async () => {
    await knowledgeCardService.distillBook('b1', '一本书')
    const all = highlightsDb.getByBookId('b1').map((r) => String(r.id))
    aiBatchesDb.clear('b1', 'knowledgeCards')
    // 库里按 created_at 倒序，"第一条"是哪一条不重要 —— 记一条、喂剩下两条
    aiBatchesDb.record('b1', 'knowledgeCards', [all[0]])
    seams.distill.mockClear()

    await knowledgeCardService.distillBook('b1', '一本书')

    const fed = seams.distill.mock.calls[0][0] as Array<{ id: string; content: string }>
    expect(fed).toHaveLength(2)
    expect(fed.map((h) => h.id)).not.toContain(all[0])
    expect(new Set(fed.map((h) => h.id))).toEqual(new Set(all.slice(1)))
  })

  it('AI 失败：卡片一张不落库、台账一个字不记，界面拿到的错误带原因', async () => {
    seams.distill.mockRejectedValue(new Error('上下文太长'))

    await expect(knowledgeCardService.distillBook('b1', '一本书')).rejects.toThrow('上下文太长')

    expect(knowledgeCardsDb.getAll().filter((c) => c.book_id === 'b1')).toHaveLength(0)
    expect(aiBatchesDb.getProcessedIds('b1', 'knowledgeCards')).toEqual([])
    expect(knowledgeCardService.isDistilling('b1')).toBe(false)
  })

  it('喂给 AI 的是映射后的驼峰字段，不是库里的下划线列名', async () => {
    await knowledgeCardService.distillBook('b1', '一本书')

    const fed = seams.distill.mock.calls[0][0] as Array<Record<string, unknown>>
    const first = fed.find((h) => h.content === '第一条摘句') as Record<string, unknown>
    expect(first).toMatchObject({ content: '第一条摘句', chapterTitle: '第一章 关系的起点' })
    expect('chapter_title' in first).toBe(false)
    // id 必须带上 —— 卡片的来源溯源靠它（没 id 就只能写死 null）
    expect(String(first.id)).toMatch(/^hl_/)
  })
})

describe('任务状态机与进度广播', () => {
  // 这几条要的是"任务挂在 distill 上不放"，所以先让库里有划线 ——
  // 否则 distillBook 会先 await 一次自动导入，那几个用例就得靠猜微任务轮次才能等到任务挂上。
  function seedLocalHighlights(): void {
    highlightsDb.create({ id: 'hl_seed_1', book_id: 'b1', content: '本地已有的一句' })
    highlightsDb.create({ id: 'hl_seed_2', book_id: 'b1', content: '本地都有的两句' })
  }

  /** 挂住的 distill：调用它就把 resolver 交出来，测试自己决定什么时候放行 */
  function hangingDistill(): (count?: number) => void {
    let release!: (v: ReturnType<typeof oneCard>) => void
    seams.distill.mockImplementation(() => new Promise<ReturnType<typeof oneCard>>((r) => { release = r }))
    return () => release(oneCard())
  }

  it('同一本书正在跑时第二次直接拒绝，且不发第二次 AI', async () => {
    seedLocalHighlights()
    const release = hangingDistill()

    const running = knowledgeCardService.distillBook('b1', '一本书')

    expect(knowledgeCardService.isDistilling('b1')).toBe(true)
    expect(knowledgeCardService.getActiveBookIds()).toEqual(['b1'])
    await expect(knowledgeCardService.distillBook('b1', '一本书')).rejects.toThrow('该书正在蒸馏中')
    expect(seams.distill).toHaveBeenCalledTimes(1)

    release()
    await running
    expect(knowledgeCardService.isDistilling('b1')).toBe(false)
  })

  it('cancelDistill：没在跑的书回 false；正在跑的回 true 并把中止信号传下去', async () => {
    expect(knowledgeCardService.cancelDistill('没有这本书')).toBe(false)

    seedLocalHighlights()
    const release = hangingDistill()
    const running = knowledgeCardService.distillBook('b1', '一本书')

    expect(knowledgeCardService.cancelDistill('b1')).toBe(true)
    const opts = seams.distill.mock.calls[0][2] as { signal: AbortSignal; batchSize: number }
    expect(opts.signal.aborted).toBe(true)
    expect(opts.batchSize).toBe(20)

    release()
    await running
  })

  it('进度只发给没销毁的窗口，销毁那个一次都不碰', async () => {
    const live = { isDestroyed: vi.fn(() => false), webContents: { send: vi.fn() } }
    const dead = { isDestroyed: vi.fn(() => true), webContents: { send: vi.fn() } }
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([
      live as unknown as BrowserWindow,
      dead as unknown as BrowserWindow,
    ])

    try {
      await knowledgeCardService.distillBook('b1', '一本书')
    } finally {
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
    }

    expect(live.webContents.send).toHaveBeenCalled()
    expect(dead.webContents.send).not.toHaveBeenCalled()
    const stages = live.webContents.send.mock.calls.map((c) => (c[1] as { stage: string }).stage)
    expect(stages).toEqual(['save', 'done'])
  })

  it('列举窗口抛错时只记一条日志，蒸馏照样完成、卡片照落', async () => {
    vi.mocked(BrowserWindow.getAllWindows).mockImplementation(() => {
      throw new Error('窗口列表取不到')
    })

    try {
      const result = await knowledgeCardService.distillBook('b1', '一本书')
      expect(result.cards).toHaveLength(1)
    } finally {
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
    }
    expect(seams.logger.error).toHaveBeenCalledWith(
      'Failed to emit distill progress',
      expect.any(Error),
    )
  })

  it('ai-service 报回来的中间进度被原样转成事件（阶段、当前、总数、那句话都不改）', async () => {
    seedLocalHighlights()
    const win = { isDestroyed: vi.fn(() => false), webContents: { send: vi.fn() } }
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([win as unknown as BrowserWindow])
    seams.distill.mockImplementation((_h, _t, opts) => {
      const o = opts as { onProgress?: (i: { stage: 'fetch' | 'batch' | 'parse'; current: number; total: number; message?: string }) => void }
      o.onProgress?.({ stage: 'batch', current: 2, total: 3, message: '正在处理第 2 批' })
      return Promise.resolve(oneCard())
    })

    try {
      await knowledgeCardService.distillBook('b1', '一本书')
    } finally {
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([])
    }

    const stages = win.webContents.send.mock.calls.map((c) => c[1] as Record<string, unknown>)
    expect(stages).toContainEqual({
      bookId: 'b1',
      bookTitle: '一本书',
      stage: 'batch',
      current: 2,
      total: 3,
      message: '正在处理第 2 批',
    })
  })

  it('shutdown：进行中的任务全部中止并从名单里清掉', async () => {
    seedLocalHighlights()
    const release = hangingDistill()
    const running = knowledgeCardService.distillBook('b1', '一本书')
    expect(knowledgeCardService.isDistilling('b1')).toBe(true)

    knowledgeCardService.shutdown()
    expect(knowledgeCardService.isDistilling('b1')).toBe(false)
    expect(knowledgeCardService.getActiveBookIds()).toEqual([])

    release()
    await running
  })

  it('超过 30 分钟的僵尸任务被清理器中止，并留一句警告', async () => {
    // 清理定时器在模块加载时就注册了，本文件把 setInterval 换成"攒回调"的版本，
    // 所以这里手动触发它，而不是推进 31 分钟的真实时钟（那样只会墙钟超时、红得没法读）。
    expect(seams.ticks.length).toBeGreaterThan(0)

    seedLocalHighlights()
    const release = hangingDistill()
    const running = knowledgeCardService.distillBook('b1', '一本书')

    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(Date.now() + 31 * 60 * 1000)
    for (const tick of seams.ticks) tick()

    expect(knowledgeCardService.isDistilling('b1')).toBe(false)
    expect(seams.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Cleaned up stale distill task for book b1'),
    )

    vi.useRealTimers()
    release()
    await running
  })
})
