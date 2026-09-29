// 渲染层导入那条通道（src/renderer/src/utils/import-weread-content.ts）行为测试
//
// 2026-09-28：把"一行该带哪些字段"从三处收成一份（planHighlightRows）之后，
// 这里是第三条消费方。它自己还管三件事：判重后要不要补章节名、单条失败不带走整批、
// 以及最后那句给用户看的话。这三件事都在这个文件里，不在任何一层数据库里。
//
// mock 只打在渲染层与主进程之间唯一的缝上：window.electronAPI。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  importWereadContentForBook,
  describeImportResult,
  type ImportResult,
} from '../src/renderer/src/utils/import-weread-content'

const WEREAD = {
  bookmarks: [
    { bookmarkId: 'w1', chapterUid: 5, chapterTitle: '', markText: '第一条', createTime: 1_700_000_000 },
    { bookmarkId: 'w2', chapterUid: 6, chapterTitle: '', markText: '第二条', createTime: 1_700_003_600 },
  ],
  notes: [
    { reviewId: 'r1', chapterUid: 5, chapterTitle: '', abstract: '摘句', content: '我的想法', createTime: 1_700_007_200 },
  ],
  chapters: [{ chapterUid: 5, title: '第一章' }, { chapterUid: 6, title: '第二章' }],
}

const api = {
  weread: { fetchAllContent: vi.fn() },
  highlight: { getByBook: vi.fn(), create: vi.fn(), update: vi.fn() },
}

beforeEach(() => {
  vi.stubGlobal('window', { electronAPI: api })
  api.weread.fetchAllContent.mockReset().mockResolvedValue(WEREAD)
  api.highlight.getByBook.mockReset().mockResolvedValue([])
  api.highlight.create.mockReset().mockResolvedValue({ created: true, noteFilled: false, chapterFilled: false })
  api.highlight.update.mockReset().mockResolvedValue(true)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function sentRows(): Array<Record<string, unknown>> {
  return api.highlight.create.mock.calls.map((c) => c[0] as Record<string, unknown>)
}

describe('importWereadContentForBook', () => {
  it('三条都发出去，章节名来自对照表、时间是真实划线时刻', async () => {
    const r = await importWereadContentForBook('b1')

    expect(r.created).toBe(3)
    // 跨进程传的是 ISO；落成库里那个"空格形状"在 highlights.create 那一步
    // （由 tests/knowledge-card-service-real-db.test.ts 用真库钉住）
    expect(sentRows()[0]).toMatchObject({
      bookId: 'b1',
      content: '第一条',
      chapter_title: '第一章',
      created_at: '2023-11-14T22:13:20.000Z',
    })
  })

  it('想法那条把用户写的想法放在 note，正文放被划的摘句', async () => {
    await importWereadContentForBook('b1')
    const noteRow = sentRows().find((row) => row.content === '摘句')
    expect(noteRow?.note).toBe('我的想法')
  })

  it('不再塞库里没有对应列的字段（type / source / chapterUid 是假承诺）', async () => {
    await importWereadContentForBook('b1')
    for (const row of sentRows()) {
      for (const dead of ['type', 'source', 'chapterUid', 'chapter_uid']) {
        expect(row, `发出去的键里不该有 ${dead}`).not.toHaveProperty(dead)
      }
    }
  })

  // ↓ 2026-09-29：渲染层原来自己按 content 判了一遍重（与 highlightsDb.create
  // 里那条 (book_id, content) 是同一规则的第三份实现），而且只补章节名、从不补想法
  // ⇒ 库里已有那句时用户写的想法永远进不来。现在判重与补写只有数据库那一处，
  // 这一层负责把主进程交回的三种计数如实汇总。
  it('不再自己判重：每条都交给主进程，也不再为判重去取整本划线', async () => {
    const r = await importWereadContentForBook('b1')

    expect(api.highlight.create).toHaveBeenCalledTimes(3)
    expect(api.highlight.getByBook).not.toHaveBeenCalled()
    expect(r).toMatchObject({ total: 3, created: 3, merged: 0, skipped: 0, failed: 0 })
  })

  it('主进程交回的三个计数各自进各自的数（补上的想法不许被算成"跳过"）', async () => {
    api.highlight.create.mockImplementation((row: Record<string, unknown>) => {
      if (row.content === '第一条') return Promise.resolve({ created: false, noteFilled: true, chapterFilled: false })
      if (row.content === '第二条') return Promise.resolve({ created: false, noteFilled: false, chapterFilled: true })
      return Promise.resolve({ created: true, noteFilled: false, chapterFilled: false })
    })

    const r = await importWereadContentForBook('b1')

    expect(r).toMatchObject({ total: 3, created: 1, merged: 2, noteFilled: 1, chapterFilled: 1, skipped: 0, failed: 0 })
  })

  it('一行同时补上想法与章节名 ⇒ merged 只算一行，两个明细各算一次', async () => {
    api.highlight.create.mockImplementation((row: Record<string, unknown>) =>
      row.content === '第一条'
        ? Promise.resolve({ created: false, noteFilled: true, chapterFilled: true })
        : Promise.resolve({ created: true, noteFilled: false, chapterFilled: false }),
    )

    const r = await importWereadContentForBook('b1')

    expect(r).toMatchObject({ total: 3, created: 2, merged: 1, noteFilled: 1, chapterFilled: 1 })
  })

  it('三个计数都不亮才算跳过，且那句人话里不许出现「补全」', async () => {
    api.highlight.create.mockResolvedValue({ created: false, noteFilled: false, chapterFilled: false })

    const r = await importWereadContentForBook('b1')

    expect(r).toMatchObject({ total: 3, created: 0, merged: 0, skipped: 3, failed: 0 })
    expect(describeImportResult(r).text).not.toContain('补全')
  })

  it('一条写库失败只算那一条失败，其余照常导入', async () => {
    api.highlight.create.mockImplementation((row: Record<string, unknown>) => {
      if (row.content === '第二条') throw new Error('磁盘满了')
      return Promise.resolve({ created: true, noteFilled: false, chapterFilled: false })
    })

    const r = await importWereadContentForBook('b1')

    expect(r).toMatchObject({ total: 3, created: 2, failed: 1 })
  })

  it('四个桶相加就是扫到的总数（报出去的分母不能漏项）', async () => {
    api.highlight.create.mockImplementation((row: Record<string, unknown>) =>
      row.content === '第二条'
        ? Promise.resolve({ created: false, noteFilled: true, chapterFilled: false })
        : row.content === '摘句'
          ? Promise.resolve({ created: false, noteFilled: false, chapterFilled: false })
          : Promise.resolve({ created: true, noteFilled: false, chapterFilled: false }),
    )

    const r = await importWereadContentForBook('b1')
    expect(r.created + r.merged + r.skipped + r.failed).toBe(r.total)
  })

  it('接口一条都没回 ⇒ total 是 0，不发任何写库调用', async () => {
    api.weread.fetchAllContent.mockResolvedValue(null)

    const r = await importWereadContentForBook('b1')

    expect(r).toMatchObject({ total: 0, created: 0 })
    expect(api.highlight.create).not.toHaveBeenCalled()
  })

  it('暴露面没准备好时如实说「请重启应用」，不是静默什么都不做', async () => {
    vi.stubGlobal('window', { electronAPI: { weread: {} } })

    await expect(importWereadContentForBook('b1')).rejects.toThrow('API 未正确初始化，请重启应用')
  })
})

describe('describeImportResult（界面那句人话与计数字对得上）', () => {
  // 计数桶的默认形状：merged 是 created/skipped 之外的那一桶，
  // noteFilled / chapterFilled 是它内部的两个明细，所以默认全 0
  function counts(over: Partial<ImportResult>): ImportResult {
    return { total: 0, created: 0, merged: 0, noteFilled: 0, chapterFilled: 0, skipped: 0, failed: 0, ...over }
  }

  it('一条都没扫到 ⇒ 「没有找到笔记」', () => {
    expect(describeImportResult(counts({})))
      .toEqual({ kind: 'info', text: '没有找到笔记' })
  })

  it('全是已存在且什么都没补的 ⇒ 说「已是最新」，不假装新增', () => {
    expect(describeImportResult(counts({ total: 3, skipped: 3 })))
      .toEqual({ kind: 'info', text: '笔记已是最新，无需重复导入' })
  })

  it('新增、补全想法、补全章节名、失败同时出现时各写各的', () => {
    const said = describeImportResult(counts({
      total: 7, created: 3, merged: 3, noteFilled: 2, chapterFilled: 1, skipped: 1, failed: 0,
    }))
    expect(said.kind).toBe('success')
    expect(said.text).toContain('新增 3 条')
    expect(said.text).toContain('补全 2 条想法')
    expect(said.text).toContain('补全 1 条章节名')
  })

  it('补上的想法一句都不许多说：只有章节名时那句不许出现「想法」', () => {
    const said = describeImportResult(counts({ total: 1, merged: 1, chapterFilled: 1 }))
    expect(said.text).not.toContain('想法')
    expect(said.text).toContain('补全 1 条章节名')
  })
})
