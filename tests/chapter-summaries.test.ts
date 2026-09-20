// 知行读书 — 层级摘要的纯判定逻辑（src/shared/chapter-summaries.ts）
//
// 为什么单独钉这套逻辑：生成一次章节摘要要打几十次 AI，「哪些章节要重做」判错
// 就是白烧钱；而「AI 生成的概括」混进提示词时如果不标清楚，模型会当成原文引用给用户。
// 这两件事都必须有测试兜着，不能靠 Review 眼睛看。

import { describe, it, expect } from 'vitest'
import * as chapterSummaries from '../src/shared/chapter-summaries'
import {
  UNGROUPED_CHAPTER,
  MAX_CONTENTS_PER_CHAPTER,
  formatChapterContents,
  formatSummaryContext,
  groupHighlightsByChapter,
  planChapterSummaries,
} from '../src/shared/chapter-summaries'

const { findPendingSummaryBooks } = chapterSummaries

const h = (chapterTitle: string | null, content: string) => ({ chapterTitle, content })

describe('groupHighlightsByChapter —— 分章', () => {
  it('按章节名分组，章节名缺失的归到「未分章」而不是被丢掉', () => {
    const groups = groupHighlightsByChapter([h('第一章', 'a'), h(null, 'b'), h('第一章', 'c')])
    expect(groups).toHaveLength(2)
    expect(groups.find((g) => g.chapterTitle === '第一章')?.total).toBe(2)
    expect(groups.find((g) => g.chapterTitle === UNGROUPED_CHAPTER)?.total).toBe(1)
  })

  it('正文为空的划线跳过（补不出摘要），且不因此产生一个空组', () => {
    const groups = groupHighlightsByChapter([h('第一章', '   '), h(null, '')])
    expect(groups).toEqual([])
  })

  it('章节按自然序排，「第2章」在「第10章」前面，「未分章」永远垫底', () => {
    const groups = groupHighlightsByChapter([
      h('第10章 尾声', 'x'),
      h(UNGROUPED_CHAPTER, 'y'),
      h('第2章 开端', 'z'),
    ])
    expect(groups.map((g) => g.chapterTitle)).toEqual(['第2章 开端', '第10章 尾声', '未分章'])
  })

  it('total 记的是真实条数，contents 只留前 N 条 —— 新鲜度判定用前者', () => {
    const rows = Array.from({ length: MAX_CONTENTS_PER_CHAPTER + 7 }, (_, i) => h('第一章', `内容${i}`))
    const [group] = groupHighlightsByChapter(rows)
    expect(group.total).toBe(MAX_CONTENTS_PER_CHAPTER + 7)
    expect(group.contents).toHaveLength(MAX_CONTENTS_PER_CHAPTER)
  })

  it('超长单条划线截断，不撑爆提示词', () => {
    const [group] = groupHighlightsByChapter([h('第一章', '啊'.repeat(500))])
    expect(group.contents[0].length).toBeLessThan(500)
    expect(group.contents[0].endsWith('…')).toBe(true)
  })
})

describe('planChapterSummaries —— 哪些章节要重做', () => {
  const groups = groupHighlightsByChapter([h('第一章', 'a'), h('第一章', 'b'), h('第二章', 'c')])

  it('从没生成过的章节要生成，条数没变的章节复用', () => {
    const plan = planChapterSummaries(groups, [{ chapterTitle: '第一章', sourceCount: 2 }])
    expect(plan.toSkip).toEqual(['第一章'])
    expect(plan.toGenerate.map((g) => g.chapterTitle)).toEqual(['第二章'])
  })

  it('划线条数变了就重做 —— 多了要重做，删了也要重做', () => {
    expect(planChapterSummaries(groups, [{ chapterTitle: '第一章', sourceCount: 1 }]).toSkip).toEqual([])
    expect(planChapterSummaries(groups, [{ chapterTitle: '第一章', sourceCount: 3 }]).toSkip).toEqual([])
  })

  it('一条划线都没有时不产生任何工作量', () => {
    const plan = planChapterSummaries(groupHighlightsByChapter([]), [{ chapterTitle: '第一章', sourceCount: 2 }])
    expect(plan.toGenerate).toEqual([])
    expect(plan.toSkip).toEqual([])
  })
})

describe('formatChapterContents —— 送进提示词的章节正文', () => {
  it('被截断时如实告诉模型这是部分划线', () => {
    const [group] = groupHighlightsByChapter(
      Array.from({ length: MAX_CONTENTS_PER_CHAPTER + 5 }, (_, i) => h('第一章', `c${i}`)),
    )
    expect(formatChapterContents(group)).toContain(`该章共 ${MAX_CONTENTS_PER_CHAPTER + 5} 条划线`)
  })

  it('没截断时不多塞这句提示', () => {
    const [group] = groupHighlightsByChapter([h('第一章', '一条')])
    expect(formatChapterContents(group)).not.toContain('以上为前')
  })
})

describe('formatSummaryContext —— 注入提示词的摘要段', () => {
  it('标明这是 AI 依据划线的概括，不是原书正文', () => {
    const text = formatSummaryContext({ bookSummary: '整本书讲…', chapters: [{ chapterTitle: '第一章', summary: '本章讲…' }] })
    expect(text).toContain('AI 依据你的划线概括')
    expect(text).toContain('【全书】整本书讲…')
    expect(text).toContain('【第一章】本章讲…')
  })

  it('没有全书摘要时不留下空的【全书】行', () => {
    const text = formatSummaryContext({ bookSummary: '   ', chapters: [{ chapterTitle: '第一章', summary: 's' }] })
    expect(text).not.toContain('【全书】')
    expect(text).toContain('【第一章】')
  })

  it('两层都是空的就整段不注入', () => {
    expect(formatSummaryContext({ bookSummary: null, chapters: [] })).toBe('')
  })
})

// 通知面板的「N 本书的 AI 摘要待更新」用的就是这条判定。它和 planChapterSummaries
// 必须是同一个口径 —— 报出来却点不动、或者点了没东西可生成，都是骗人。
describe('findPendingSummaryBooks —— 哪些书欠摘要', () => {
  const c = (bookId: string, chapterTitle: string, count: number) => ({ bookId, chapterTitle, count })
  const s = (bookId: string, chapterTitle: string, sourceCount: number) => ({ bookId, chapterTitle, sourceCount })

  it('每章条数都没变 → 一本书都不报', () => {
    expect(
      findPendingSummaryBooks(
        [c('b1', '第一章', 5), c('b1', '第二章', 3)],
        [s('b1', '第一章', 5), s('b1', '第二章', 3)],
      ),
    ).toEqual([])
  })

  it('某章新增了划线 → 只报这一本，且待办章节数是 1', () => {
    expect(
      findPendingSummaryBooks(
        [c('b1', '第一章', 8), c('b1', '第二章', 3)],
        [s('b1', '第一章', 5), s('b1', '第二章', 3)],
      ),
    ).toEqual([{ bookId: 'b1', pendingChapters: 1 }])
  })

  it('从没生成过摘要的书 → 待办章节数等于它的章节数', () => {
    expect(findPendingSummaryBooks([c('b2', '第一章', 2), c('b2', '未分章', 1)], [])).toEqual([
      { bookId: 'b2', pendingChapters: 2 },
    ])
  })

  it('章节被删到没有划线 → 不报（补不出来，报了也点不动）', () => {
    expect(findPendingSummaryBooks([], [s('b1', '第三章', 4)])).toEqual([])
  })

  it('待办多的排前面，同数按 bookId 保证顺序稳定', () => {
    expect(
      findPendingSummaryBooks(
        [c('b9', '第一章', 9), c('b1', '第一章', 1), c('b1', '第二章', 1)],
        [],
      ),
    ).toEqual([
      { bookId: 'b1', pendingChapters: 2 },
      { bookId: 'b9', pendingChapters: 1 },
    ])
  })

  it('与 planChapterSummaries 同口径：同一份数据下报的章节数一致', () => {
    const groups = groupHighlightsByChapter([
      h('第一章', 'a'),
      h('第一章', 'b'),
      h('第二章', 'c'),
    ])
    // 第一章 1→2 变了；第二章 4→1 变了；第三章划线被删光，两边都不该算它
    const existing = [
      { chapterTitle: '第一章', sourceCount: 1 },
      { chapterTitle: '第二章', sourceCount: 4 },
      { chapterTitle: '第三章', sourceCount: 2 },
    ]
    expect(planChapterSummaries(groups, existing).toGenerate).toHaveLength(2)
    expect(
      findPendingSummaryBooks(
        groups.map((g) => ({ bookId: 'b1', chapterTitle: g.chapterTitle, count: g.total })),
        existing.map((e) => ({ bookId: 'b1', ...e })),
      ),
    ).toEqual([{ bookId: 'b1', pendingChapters: 2 }])
  })
})
