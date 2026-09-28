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
  api.highlight.create.mockReset().mockResolvedValue(true)
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

  it('已存在且原本没章节名 ⇒ 补写章节名，不再建第二条', async () => {
    api.highlight.getByBook.mockResolvedValue([{ id: 'hl_old', content: '第一条', chapter_title: '' }])

    const r = await importWereadContentForBook('b1')

    expect(r).toMatchObject({ total: 3, created: 2, chapterFilled: 1, skipped: 0, failed: 0 })
    expect(api.highlight.update).toHaveBeenCalledWith('hl_old', { chapter_title: '第一章' })
  })

  it('已存在且本来就有章节名 ⇒ 一次写库都不发', async () => {
    api.highlight.getByBook.mockResolvedValue([{ id: 'hl_old', content: '第一条', chapter_title: '第一章' }])

    const r = await importWereadContentForBook('b1')

    expect(r).toMatchObject({ total: 3, created: 2, chapterFilled: 0, skipped: 1, failed: 0 })
    expect(api.highlight.update).not.toHaveBeenCalled()
  })

  it('库里有行但章节名是驼峰那一写法时也认（不重复补写）', async () => {
    api.highlight.getByBook.mockResolvedValue([{ id: 'hl_old', content: '第一条', chapterTitle: '第一章' }])

    const r = await importWereadContentForBook('b1')

    expect(r.chapterFilled).toBe(0)
    expect(api.highlight.update).not.toHaveBeenCalled()
  })

  it('一条写库失败只算那一条失败，其余照常导入', async () => {
    api.highlight.create.mockImplementation((row: Record<string, unknown>) => {
      if (row.content === '第二条') throw new Error('磁盘满了')
      return Promise.resolve(true)
    })

    const r = await importWereadContentForBook('b1')

    expect(r).toMatchObject({ total: 3, created: 2, failed: 1 })
  })

  it('create 回 false（库里判重挡下的）算 skipped，不算新建', async () => {
    api.highlight.create.mockResolvedValue(false)

    const r = await importWereadContentForBook('b1')

    expect(r).toMatchObject({ total: 3, created: 0, skipped: 3, failed: 0 })
  })

  it('四个计数相加就是扫到的总数（报出去的分母不能漏项）', async () => {
    api.highlight.getByBook.mockResolvedValue([{ id: 'hl_old', content: '第一条', chapter_title: '' }])
    api.highlight.create.mockImplementation((row: Record<string, unknown>) =>
      row.content === '第二条' ? Promise.resolve(false) : Promise.resolve(true),
    )

    const r = await importWereadContentForBook('b1')
    expect(r.created + r.chapterFilled + r.skipped + r.failed).toBe(r.total)
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
  it('一条都没扫到 ⇒ 「没有找到笔记」', () => {
    expect(describeImportResult({ total: 0, created: 0, chapterFilled: 0, skipped: 0, failed: 0 }))
      .toEqual({ kind: 'info', text: '没有找到笔记' })
  })

  it('全是已存在的 ⇒ 说「已是最新」，不假装新增', () => {
    expect(describeImportResult({ total: 3, created: 0, chapterFilled: 0, skipped: 3, failed: 0 }))
      .toEqual({ kind: 'info', text: '笔记已是最新，无需重复导入' })
  })

  it('新增、补全、失败同时出现时三项都写出来', () => {
    const said = describeImportResult({ total: 6, created: 3, chapterFilled: 1, skipped: 1, failed: 1 })
    expect(said.kind).toBe('success')
    expect(said.text).toContain('新增 3 条')
    expect(said.text).toContain('补全 1 条章节名')
    expect(said.text).toContain('1 条失败')
  })
})
