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
  relevanceScore,
  seeAllLink,
  splitQueryTerms,
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

  it('文章直接打开那一篇，卡片与方法论带着关键词过去并点名那一条，生词精确到那一个词', () => {
    expect(buildHitLink({ kind: 'article', id: 'a1', query: 'x' })).toBe('/daily-learning?article=a1')
    expect(buildHitLink({ kind: 'card', id: 'c1', query: '复利' })).toBe(
      '/knowledge-cards?q=%E5%A4%8D%E5%88%A9&item=c1',
    )
    expect(buildHitLink({ kind: 'methodology', id: 'm1', query: '复利' })).toBe(
      '/methodologies?q=%E5%A4%8D%E5%88%A9&item=m1',
    )
    expect(buildHitLink({ kind: 'word', id: 'v9', query: '复利' })).toBe('/vocabulary?item=v9')
  })

  it('「看全部」只带关键词 —— 它是去看这一批，不是去看某一条', () => {
    expect(seeAllLink('card', '复利')).toBe('/knowledge-cards?q=%E5%A4%8D%E5%88%A9')
    expect(seeAllLink('methodology', '复利')).toBe('/methodologies?q=%E5%A4%8D%E5%88%A9')
  })

  it('关键词里的特殊字符被编码（含 # 与 & 的查询不能把链接切开）', () => {
    const link = buildHitLink({ kind: 'card', id: 'c1', query: 'a&b#c' })
    expect(new URLSearchParams(link.split('?')[1]).get('q')).toBe('a&b#c')
  })
})

describe('拆词', () => {
  it('按空格分词，去重，保顺序', () => {
    expect(splitQueryTerms(' 复利  时间 复利 ')).toEqual(['复利', '时间'])
  })

  it('全是空白时一个词都没有（不发查询）', () => {
    expect(splitQueryTerms('   \t \n')).toEqual([])
    expect(isSearchable('   \t ')).toBe(false)
  })

  it('英文词按空格分，不会因为大小写被当成两个词去重失败', () => {
    expect(splitQueryTerms('Alpha alpha')).toEqual(['Alpha', 'alpha'])
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

  it('被上限截断时说"列出最相关的"，并给出条数', () => {
    expect(describeSearchOutcome('的', 21, 214)).toBe(
      '找到 214 条与「的」相关的内容，下面列出最相关的 21 条',
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

describe('相关度打分', () => {
  it('命中次数多的更靠前', () => {
    expect(relevanceScore(['复利'], '复利、复利、还是复利', '')).toBeGreaterThan(
      relevanceScore(['复利'], '这里只提了一次复利', ''),
    )
  })

  it('标题里就有这个词的更靠前（标题在讲什么，比正文顺带提一句强）', () => {
    expect(relevanceScore(['复利'], '一段无关紧要的正文，末尾提到复利', '复利思维')).toBeGreaterThan(
      relevanceScore(['复利'], '一段无关紧要的正文，末尾提到复利', ''),
    )
  })

  it('同样一次命中，短的那条更相关（长文里提一次不说明它在讲这个）', () => {
    expect(relevanceScore(['复利'], '复利是回报的延迟兑现', '')).toBeGreaterThan(
      relevanceScore(['复利'], `复利。${'中间一大段别的话。'.repeat(20)}`, ''),
    )
  })

  it('堆砌有封顶：同样长的文本里，同一个词出现 20 次不比出现 6 次更相关', () => {
    // 凑成等长，免得长度归一化混进来（那条另有专门的用例）
    const padded = (n: number) => '复利'.repeat(n) + '·'.repeat(40 - n * 2)
    expect(relevanceScore(['复利'], padded(6), '')).toBe(relevanceScore(['复利'], padded(20), ''))
  })

  it('英文大小写不敏感（同一篇文档换个写法不该换个名次）', () => {
    expect(relevanceScore(['compound'], 'Compound and compound', '')).toBe(
      relevanceScore(['compound'], 'compound and Compound', ''),
    )
  })

  it('多个词各自计分：两个词都命中的，胜过只把一个词堆得多的', () => {
    const both = relevanceScore(['复利', '时间'], '复利与时间的关系', '复利、时间')
    const skewed = relevanceScore(['复利', '时间'], '复利复利复利复利复利复利，时间', '')
    expect(both).toBeGreaterThan(skewed)
  })

  it('只要 LIKE 命中了就一定有正分 —— 「列出最相关的」这句话不能对着 0 分说', () => {
    // 单字关键词是这套打分的边界：bigram 检索在那儿会全 0，这里按字面词数命中
    expect(relevanceScore(['的'], '这句话里有的一个字', '')).toBeGreaterThan(0)
    expect(relevanceScore(['复利'], '完全没有那个词的一段话', '')).toBe(0)
    expect(relevanceScore([], '任何文本', '任何标题')).toBe(0)
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
