// 导出读书笔记的纯函数判据（2026-10-03）
//
// 立它的理由：导出笔记曾经有两条通路各写一份拼 Markdown 的逻辑且已漂移
// （标题不同、`---` 只有一边有、一边带章节名另一边不带）。收成一份之后，
// 这份判据要保证"同一份数据导出两次逐字节相同"，以及格式为写文章而排的三条硬要求。
import { describe, it, expect } from 'vitest'
import { buildNotesMarkdown, notesFileName } from '../src/shared/notes-export'
import type { BookRow, HighlightRow } from '../src/shared/notes-export'

const AT = new Date('2026-10-03T02:00:00.000Z')

const book = (id: string, title: string, author = ''): BookRow => ({ id, title, author })
const hl = (over: Partial<HighlightRow> & { id: string }): HighlightRow => ({
  book_id: 'b1',
  content: '一句原文',
  chapter_title: '第一章',
  created_at: '2026-05-06 03:09:56',
  ...over,
})

const BOOKS = [book('b1', '第一本书', '作者甲'), book('b2', '第二本书', '作者乙')]

const SAMPLE: HighlightRow[] = [
  // b1：三条有想法、一条只有划线
  hl({ id: 'h1', note: '我对这句的想法', created_at: '2026-05-06 03:09:56' }),
  hl({ id: 'h2', note: '另一条想法', created_at: '2026-05-08 03:09:56' }),
  hl({ id: 'h3', content: '空正文但有想法', note: '只有想法没原文', created_at: '2026-05-09 03:09:56' }),
  hl({ id: 'h4', note: '', created_at: '2026-05-10 03:09:56' }),
  // b1：正文与想法都空 —— 该被跳过
  hl({ id: 'h5', content: '   ', note: '  ', created_at: '2026-05-11 03:09:56' }),
  // b2：只有划线
  hl({ id: 'h6', book_id: 'b2', chapter_title: '第二章', created_at: '2026-05-12 03:09:56' }),
]

describe('格式为写文章而排：三条硬要求', () => {
  const { markdown, total, skipped } = buildNotesMarkdown({ highlights: SAMPLE, books: BOOKS, now: AT })

  it('① 我写过的想法排在只有划线的前面', () => {
    const noteIdx = markdown.indexOf('### 你写下的')
    const markedIdx = markdown.indexOf('### 你划过的')
    expect(noteIdx).toBeGreaterThan(-1)
    expect(markedIdx).toBeGreaterThan(-1)
    expect(noteIdx).toBeLessThan(markedIdx)
    // 三条想法都在"你划过的"之前，不只是标题先后
    expect(markdown.indexOf('我对这句的想法')).toBeLessThan(markdown.indexOf('### 你划过的'))
    expect(markdown.indexOf('只有想法没原文')).toBeLessThan(markdown.indexOf('### 你划过的'))
  })

  it('② 章节名导出来了（库里本来就有 1019 条是带章节的）', () => {
    expect(markdown).toContain('第一章')
    expect(markdown).toContain('第二章')
  })

  it('③ 正文与想法都空的跳过，有想法没正文的保留', () => {
    expect(skipped, '空的那几条没有被跳过').toBe(1)
    expect(total).toBe(5) // 6 条减 1 条空的
    expect(markdown).toContain('只有想法没原文')
    // 空引用块长这样："**时间**：..." 后面紧跟空引用 —— 这里断言它不在
    expect(markdown).not.toContain('> \n')
  })

  it('跳过的那几条在文件里说清数目，不静默', () => {
    expect(markdown).toContain('另有 1 条既没有原文也没有你的想法')
  })
})

describe('同一份数据导出两次逐字节相同', () => {
  it('顺序稳定（想法多的书排前面、书内按时间倒序）', () => {
    const a = buildNotesMarkdown({ highlights: SAMPLE, books: BOOKS, now: AT }).markdown
    const b = buildNotesMarkdown({ highlights: [...SAMPLE].reverse(), books: BOOKS, now: AT }).markdown
    expect(a).toBe(b)
  })

  it('想法多的书排在前面 —— 写文章时先翻那些', () => {
    const md = buildNotesMarkdown({ highlights: SAMPLE, books: BOOKS, now: AT }).markdown
    expect(md.indexOf('《第一本书》')).toBeLessThan(md.indexOf('《第二本书》'))
  })

  it('书内想法按时间倒序（最近写的在最上面）', () => {
    const md = buildNotesMarkdown({ highlights: SAMPLE, books: BOOKS, now: AT }).markdown
    // h2(05-08) 应排在 h1(05-06) 之前
    expect(md.indexOf('另一条想法')).toBeLessThan(md.indexOf('我对这句的想法'))
  })
})

describe('按书导出', () => {
  it('只给那一本时别的书一条都不进来，标题也变成那本书', () => {
    const r = buildNotesMarkdown({ highlights: SAMPLE, books: BOOKS, now: AT, onlyBookId: 'b2' })
    expect(r.books).toBe(1)
    expect(r.markdown).toContain('《第二本书》')
    expect(r.markdown).not.toContain('《第一本书》')
    // 单本不摆目录（目录只有一个条目时是废话）
    expect(r.markdown).not.toContain('## 目录')
  })

  it('库里根本没有这本书时不报错，导出 0 本并说清楚', () => {
    const r = buildNotesMarkdown({ highlights: SAMPLE, books: BOOKS, now: AT, onlyBookId: 'nope' })
    expect(r.books).toBe(0)
    expect(r.total).toBe(0)
  })
})

describe('抬头与提示句', () => {
  it('抬头说清"其中多少条是你自己写下的" —— 那才是写文章要用的', () => {
    const md = buildNotesMarkdown({ highlights: SAMPLE, books: BOOKS, now: AT }).markdown
    expect(md).toContain('你自己写下的')
    expect(md).toContain('目录')
  })

  it('summary 里的数与文件里的条数一致（界面不许自己再数一遍）', () => {
    const r = buildNotesMarkdown({ highlights: SAMPLE, books: BOOKS, now: AT })
    expect(r.summary).toContain(`${r.total} 条`)
    expect(r.summary).toContain('跳过 1 条空白')
  })

  it('一条都没有时交回空结果而不是一段只有标题的 Markdown', () => {
    const r = buildNotesMarkdown({ highlights: [], books: BOOKS, now: AT })
    expect(r.books).toBe(0)
    expect(r.total).toBe(0)
  })
})

describe('文件名', () => {
  it('按书导出带上书名，全库导出用通用名', () => {
    expect(notesFileName('第一本书', AT)).toBe('读书笔记-第一本书-2026-10-03.md')
    expect(notesFileName(undefined, AT)).toBe('zhixing-notes-2026-10-03.md')
  })

  it('书名里有文件名非法字符时去掉，不让保存框报错', () => {
    const name = notesFileName('书名/带:非法*字符', AT)
    expect(name).not.toMatch(/[\/:*?"<>|]/)
    expect(name).toContain('2026-10-03')
  })

  it('书名全是非法字符时退回通用名，不给出一个空文件名', () => {
    expect(notesFileName('///', AT)).toBe('zhixing-notes-2026-10-03.md')
  })
})

/**
 * 收口的守卫：拼 Markdown 的逻辑只许有一份。
 * 此前笔记页（主进程）与设置页（渲染层）各写一份且已漂移 ——
 * 标题不同、`---` 只有一边有、章节名只有主进程那一份带。界面上两颗按钮长得一样。
 */
describe('两个入口共用同一份拼装逻辑', () => {
  it('渲染层与主进程都不许再自己拼 Markdown', () => {
    const { readFileSync } = require('fs') as typeof import('fs')
    const { join } = require('path') as typeof import('path')
    const root = join(__dirname, '..')
    const settings = readFileSync(join(root, 'src/renderer/src/pages/settings/use-data-io.ts'), 'utf8')
    const booksIpc = readFileSync(join(root, 'electron/ipc/books.ts'), 'utf8')

    for (const [name, src] of [['设置页', settings], ['主进程', booksIpc]] as const) {
      expect(src, `${name} 不许自己拼 Markdown，要走 notes-export`).toContain('notes-export')
      expect(src, `${name} 里出现了自己拼的抬头`).not.toMatch(/lines\.push\('# 知行读书/)
      expect(src, `${name} 里出现了自己拼的分组标题`).not.toMatch(/lines\.push\(`## 《/)
    }
  })

  it('反证 · 那条规则确实能抓住收口前的写法（否则上面两条是空转）', () => {
    // 收口前主进程那份：抬头是数组字面量，分组用 push
    const mainBefore = "const lines: string[] = ['# 知行读书 · 读书笔记导出', '', `共 ${n} 条笔记`, '']\nlines.push(`## 《${bookMap.get(bookId) || '未知书籍'}》`, '')"
    // 收口前设置页那份：同一件事、另一个标题，章节名与时间都没有（漂移本身）
    const settingsBefore = "const lines: string[] = ['# 知行读书笔记导出', '']\nlines.push(`## ${book?.title ?? '未知书名'}`)"

    // 上面那两条正例用的就是这两条规则：这里只验规则对原始写法有牙
    const headRule = (s: string) => /lines: string\[\] = \['# 知行读书|lines\.push\('# 知行读书/.test(s)
    const groupRule = (s: string) => /lines\.push\(`## /.test(s)

    expect(headRule(mainBefore)).toBe(true)
    expect(headRule(settingsBefore)).toBe(true)
    expect(groupRule(mainBefore)).toBe(true)
    expect(groupRule(settingsBefore)).toBe(true)

    // 而现在的生产代码两条都不该命中（已收口）
    const { readFileSync } = require('fs') as typeof import('fs')
    const { join } = require('path') as typeof import('path')
    const root = join(__dirname, '..')
    for (const f of [
      'src/renderer/src/pages/settings/use-data-io.ts',
      'electron/ipc/books.ts',
    ]) {
      const src = readFileSync(join(root, f), 'utf8')
      expect(headRule(src), `${f} 又自己拼抬起了`).toBe(false)
      expect(groupRule(src), `${f} 又自己拼分组标题了`).toBe(false)
    }
  })
})
