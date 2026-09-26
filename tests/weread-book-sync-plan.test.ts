// 微信读书书架同步计划 —— 一份判定，两条通路共用（2026-09-26）
//
// 背景：写本地 books 表的通路有两条（渲染层手动同步 / 主进程后台自动同步），
// 过去各写一份字段映射，漂开成两个真缺陷：后台那份按书名判重（同名两本互相覆盖），
// 且更新时把 progress 写进去 —— 而 /shelf/sync 根本不返回 progress，
// 于是一次自动同步就把按本查回来存库的真实进度抹成 0。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { planBookSync, lastReadTimeIso, type WereadBookLike } from '../src/shared/weread-book-sync'

const book = (over: Partial<WereadBookLike> = {}): WereadBookLike => ({
  bookId: 'bk_1',
  title: '被讨厌的勇气',
  author: '岸见一郎',
  cover: 'https://cdn/1.jpg',
  isbn: '9787111',
  publisher: '机械工业出版社',
  publishTime: '2013-10-01',
  intro: '阿德勒哲学',
  category: '心理学',
  finishReading: 0,
  progress: 0,
  totalChapter: 0,
  lastReadTime: 0,
  readUpdateTime: 0,
  ...over,
})

describe('planBookSync — 新建那一本', () => {
  it('库里没有这一本 ⇒ create，id 用微信读书的 bookId', () => {
    const plan = planBookSync(book({ progress: 0.4, totalChapter: 12 }), undefined)
    expect(plan.action).toBe('create')
    expect(plan.id).toBe('bk_1')
    expect(plan.fields).toMatchObject({
      id: 'bk_1',
      title: '被讨厌的勇气',
      author: '岸见一郎',
      description: '阿德勒哲学',
      category: '心理学',
      publish_date: '2013-10-01',
      reading_progress: 0.4,
      total_chapter: 12,
      is_finished: 0,
    })
  })

  it('库里那行没有可用 id ⇒ 仍按 create 走，不去 update 一个 undefined', () => {
    const plan = planBookSync(book(), {})
    expect(plan.action).toBe('create')
    expect(plan.id).toBe('bk_1')
  })

  it('库里那行 id 是空串 ⇒ 也算没有可用行，走 create 而不是 update("")', () => {
    const plan = planBookSync(book(), { id: '' })
    expect(plan.action).toBe('create')
    expect(plan.id).toBe('bk_1')
  })

  it('缺字段一律落成 null 而不是 undefined（INSERT 直接绑这些值）', () => {
    const plan = planBookSync(
      book({ author: undefined, cover: '', isbn: undefined, intro: '', category: undefined, publishTime: '' }),
      null,
    )
    expect(plan.fields.author).toBeNull()
    expect(plan.fields.cover).toBeNull()
    expect(plan.fields.isbn).toBeNull()
    expect(plan.fields.description).toBeNull()
    expect(plan.fields.category).toBeNull()
    expect(plan.fields.publish_date).toBeNull()
  })
})

describe('planBookSync — 更新已有那一本', () => {
  it('用库里那一行的 id 更新（本地 id 与微信读书 id 不同时也不新建重复行）', () => {
    const plan = planBookSync(book({ bookId: 'bk_1' }), { id: 'local-uuid-9', title: '被讨厌的勇气' })
    expect(plan.action).toBe('update')
    expect(plan.id).toBe('local-uuid-9')
  })

  it('更新字段里**没有**进度列 —— /shelf/sync 不返回它，写下去就是拿 0 抹掉真实进度', () => {
    const plan = planBookSync(book(), { id: 'bk_1' })
    expect(Object.keys(plan.fields)).not.toContain('reading_progress')
    // 正面证据：这条更新确实带了该带的列，不是空对象混过去
    expect(Object.keys(plan.fields).length).toBeGreaterThan(5)
    expect(plan.fields.author).toBe('岸见一郎')
  })

  it('读完的书按 finishReading 置 is_finished，读没读完由它说，不按进度猜', () => {
    const plan = planBookSync(book({ finishReading: 1 }), { id: 'bk_1' })
    expect(plan.fields.is_finished).toBe(1)
  })

  it('更新时缺字段也落成 null —— 与新建那支的兜底口径一致', () => {
    const plan = planBookSync(
      book({
        author: '',
        cover: undefined,
        isbn: '',
        publisher: undefined,
        publishTime: '',
        intro: '',
        category: '',
      }),
      { id: 'bk_1' },
    )
    expect(plan.action).toBe('update')
    for (const key of ['author', 'cover', 'isbn', 'publisher', 'publish_date', 'description', 'category']) {
      expect(plan.fields[key], `${key} 该落成 null`).toBeNull()
    }
  })
})

describe('lastReadTimeIso — 秒级 epoch → ISO 串', () => {
  it('readUpdateTime 优先于 lastReadTime', () => {
    expect(lastReadTimeIso(book({ lastReadTime: 100, readUpdateTime: 1_700_000_000 }))).toBe(
      new Date(1_700_000_000 * 1000).toISOString(),
    )
  })

  it('两个都没有 ⇒ null，不是 1970 那个日期', () => {
    expect(lastReadTimeIso(book())).toBeNull()
    // 界面上"上次读是 1970-01-01"就是这么来的：0 被 new Date(0*1000) 变成了合法日期
    expect(new Date(0).toISOString()).not.toBe(lastReadTimeIso(book()))
  })

  it('计划里带上了同一个换算结果（两条通路读到的 last_read_time 一定一致）', () => {
    const wb = book({ readUpdateTime: 1_600_000_000 })
    expect(planBookSync(wb, undefined).fields.last_read_time).toBe(lastReadTimeIso(wb))
    expect(planBookSync(wb, { id: 'bk_1' }).fields.last_read_time).toBe(lastReadTimeIso(wb))
  })
})

describe('同名两本（这条是按书名判重的直接后果）', () => {
  it('两本同名不同 bookId 的书各自得到自己的计划，第二本不会被判成"已有"', () => {
    const first = book({ bookId: 'bk_1', title: '活着', author: '余华' })
    const second = book({ bookId: 'bk_2', title: '活着', author: '史铁生' })
    // 库里只有第一本（按 id 查得到、按书名查会命中同一行）
    const plans = [first, second].map((wb, i) =>
      planBookSync(wb, i === 0 ? { id: 'bk_1', title: '活着', author: '余华' } : undefined),
    )
    expect(plans[0].action).toBe('update')
    expect(plans[0].id).toBe('bk_1')
    expect(plans[1].action).toBe('create')
    expect(plans[1].id).toBe('bk_2')
    expect(plans[1].fields.author).toBe('史铁生')
  })
})

describe('守卫：写 books 表的字段映射只许有一份', () => {
  const repoRoot = resolve(__dirname, '..')
  const managerSrc = readFileSync(resolve(repoRoot, 'electron/weread-sync-manager.ts'), 'utf8')
  const rendererSrc = readFileSync(
    resolve(repoRoot, 'src/renderer/src/utils/sync-bookshelf.ts'),
    'utf8',
  )

  it('两条通路都 import 这份计划', () => {
    for (const [name, src] of [['weread-sync-manager.ts', managerSrc], ['sync-bookshelf.ts', rendererSrc]] as const) {
      expect(src, `${name} 必须改用共享计划`).toMatch(/from\s+'[^']*shared\/weread-book-sync'/)
      expect(src, `${name} 必须真的调用 planBookSync`).toMatch(/planBookSync\(/)
    }
  })

  it('两条通路都不再自己拼进度列（拼一次就多一个能抹掉进度的地方）', () => {
    for (const [name, src] of [['weread-sync-manager.ts', managerSrc], ['sync-bookshelf.ts', rendererSrc]] as const) {
      expect(src, `${name} 里不该再出现进度列名`).not.toMatch(/reading_progress/)
    }
  })

  it('判据不是空转：把改动前那两段原文喂进去必须命中', () => {
    const oldManagerUpdate = `booksDb.update(match.id as string, {
        author: wb.author || null,
        reading_progress: wb.progress || 0,
        is_finished: wb.finishReading || 0,
      });`
    const oldManagerDedupe = `const existing = booksDb.search(wb.title);
       const exists = existing.some((b) => b.title === wb.title);`
    const oldRendererCreate = `await window.electronAPI.book.create({
        id: wb.bookId, reading_progress: wb.progress || 0, source: 'weread',
      })`

    expect(oldManagerUpdate).toMatch(/reading_progress/)
    expect(oldRendererCreate).toMatch(/reading_progress/)
    // 按书名判重那种写法：命中 title 比对，而共享计划只按 id 查
    expect(oldManagerDedupe).toMatch(/\.search\(\s*wb\.title\s*\)/)
    expect(managerSrc).not.toMatch(/\.search\(\s*wb\.title\s*\)/)
  })
})
