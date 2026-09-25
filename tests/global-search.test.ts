// 全局搜索的判定（2026-09-25）
//
// 这里只管"能算错的那部分"：片段从哪儿截、通配符有没有转义、每类上限、链接拼给谁。
// 真库那半条路在 tests/global-search-channel.test.ts。

import { describe, it, expect } from 'vitest'
import {
  SEARCH_GROUPS,
  SNIPPET_RADIUS,
  buildHitLink,
  describeGroupCount,
  describeSearchOutcome,
  isSearchable,
  makeSnippet,
  seeAllLink,
  toLikePattern,
  type SearchGroupResult,
} from '../src/shared/global-search'

const LONG = '前面有一大段无关的话。'.repeat(6) + '复利是时间对决策的回报。' + '后面又是一大段。'.repeat(6)

describe('命中片段', () => {
  it('把命中那句挪到中间，而不是从段首截', () => {
    const s = makeSnippet(LONG, '复利')
    expect(s).toContain('复利是时间对决策的回报')
    // 命中前的字数不超过半径 —— 否则等于没给上下文
    expect(s.indexOf('复利')).toBeLessThanOrEqual(SNIPPET_RADIUS + 1)
    expect(s.startsWith('…')).toBe(true)
  })

  it('截了才加省略号，没截完就不加', () => {
    expect(makeSnippet('短句原样', '短句')).toBe('短句原样')
    expect(makeSnippet(LONG, '复利').endsWith('…')).toBe(true)
  })

  it('大小写不敏感（英文生词与文章常是大小写两种写法）', () => {
    expect(makeSnippet('Antifragile 是一本讲不确定性的书', 'antifragile')).toContain('Antifragile')
  })

  it('找不到命中词时给段首并标省略号，空文本给空串', () => {
    expect(makeSnippet(LONG, '不存在的词')).toMatch(/^前面有一大段/)
    expect(makeSnippet('   ', '词')).toBe('')
  })

  it('换行与连续空白压成一格（卡片正文多带 Markdown 换行）', () => {
    expect(makeSnippet('第一行\n\n   第二行 命中', '命中')).toBe('第一行 第二行 命中')
  })
})

describe('LIKE 匹配串', () => {
  it('普通词前后加通配符，首尾空白去掉', () => {
    expect(toLikePattern(' 认知 ')).toBe('%认知%')
  })

  it('通配符按字面匹配：搜 100% 不该命中所有行', () => {
    expect(toLikePattern('100%')).toBe('%100\\%%')
    expect(toLikePattern('a_b')).toBe('%a\\_b%')
    // 反斜杠自己也要转义，否则 "a\b" 会静默变成 "ab"
    expect(toLikePattern('a\\b')).toBe('%a\\\\b%')
  })

  it('空串也产生一个合法 pattern（发请求前由 isSearchable 拦）', () => {
    expect(toLikePattern('')).toBe('%%')
    expect(isSearchable('   ')).toBe(false)
    expect(isSearchable('词')).toBe(true)
  })
})

describe('分组与上限', () => {
  it('五类都在，且每类都有上限（搜索页不是翻页的地方）', () => {
    expect(SEARCH_GROUPS.map((g) => g.kind)).toEqual([
      'highlight',
      'card',
      'methodology',
      'article',
      'word',
    ])
    for (const g of SEARCH_GROUPS) expect(g.limit).toBeGreaterThan(0)
  })

  it('kind 唯一（重复一个就会在同一页里查两遍）', () => {
    expect(new Set(SEARCH_GROUPS.map((g) => g.kind)).size).toBe(SEARCH_GROUPS.length)
  })
})

describe('点回去的链接', () => {
  it('划线走精确到那一条的深链', () => {
    expect(buildHitLink({ kind: 'highlight', id: 'h1', bookId: 'b1', query: '复利' })).toBe(
      '/bookshelf/b1?tab=highlights&highlight=h1',
    )
  })

  it('划线没有书可归属时退到笔记页并按关键词过滤（不给一个 404 链接）', () => {
    expect(buildHitLink({ kind: 'highlight', id: 'h1', bookId: null, query: '复利' })).toBe(
      '/notes?q=%E5%A4%8D%E5%88%A9',
    )
  })

  it('文章直接打开那一篇，卡片与方法论带着关键词去它们自己的页，生词精确到那一个词', () => {
    expect(buildHitLink({ kind: 'article', id: 'a1', query: 'x' })).toBe('/daily-learning?article=a1')
    expect(buildHitLink({ kind: 'card', id: 'c1', query: '复利' })).toContain('/knowledge-cards?')
    expect(buildHitLink({ kind: 'methodology', id: 'm1', query: '复利' })).toContain('/methodologies?')
    expect(buildHitLink({ kind: 'word', id: 'v9', query: '复利' })).toBe('/vocabulary?item=v9')
  })

  it('关键词里的特殊字符被编码（含 # 与 & 的查询不能把链接切开）', () => {
    const link = buildHitLink({ kind: 'card', id: 'c1', query: 'a&b#c' })
    expect(new URLSearchParams(link.split('?')[1]).get('q')).toBe('a&b#c')
  })
})

describe('结果页那句话', () => {
  it('没输入时说该做什么', () => {
    expect(describeSearchOutcome('', 0, 0)).toContain('输入关键词')
  })

  it('零命中时如实说没找到，且把搜的词带上', () => {
    expect(describeSearchOutcome('复利', 0, 0)).toBe('没有找到包含「复利」的内容')
  })

  it('全部列出来时报数，不多说一句', () => {
    expect(describeSearchOutcome('复利', 7, 7)).toBe('找到 7 条与「复利」相关的内容')
  })

  it('被上限截断时要说清"列出的是其中几条"（只报列出数会让人以为就这些）', () => {
    expect(describeSearchOutcome('的', 21, 214)).toBe(
      '找到 214 条与「的」相关的内容，下面列出其中最相关的 21 条',
    )
  })

  it('关键词首尾空白不影响那句话', () => {
    expect(describeSearchOutcome('  复利  ', 3, 3)).toBe('找到 3 条与「复利」相关的内容')
  })
})

describe('每类的条数怎么写', () => {
  const group = (hits: number, matched: number): SearchGroupResult => ({
    kind: 'highlight',
    label: '划线',
    hits: Array.from({ length: hits }, (_, i) => ({
      kind: 'highlight' as const,
      id: `h${i}`,
      title: '书',
      meta: '',
      snippet: '',
      link: '/notes',
    })),
    matched,
  })

  it('没被截断时只报条数', () => {
    expect(describeGroupCount(group(3, 3))).toBe('3 条')
    expect(describeGroupCount(group(0, 0))).toBe('0 条')
  })

  it('被截断时报"共 N 条 · 列出 M 条"', () => {
    expect(describeGroupCount(group(8, 214))).toBe('共 214 条 · 列出 8 条')
  })
})

describe('看全部的出口', () => {
  it('那四页真能按关键词筛，才给出口', () => {
    expect(seeAllLink('highlight', '复利')).toBe('/notes?q=%E5%A4%8D%E5%88%A9')
    expect(seeAllLink('card', '复利')).toBe('/knowledge-cards?q=%E5%A4%8D%E5%88%A9')
    expect(seeAllLink('methodology', '复利')).toBe('/methodologies?q=%E5%A4%8D%E5%88%A9')
    expect(seeAllLink('word', '复利')).toBe('/vocabulary?q=%E5%A4%8D%E5%88%A9')
  })

  it('文章那一页没有关键词筛选（只有难度 / 已读 / 收藏），不给假按钮', () => {
    expect(seeAllLink('article', '复利')).toBeNull()
  })
})
