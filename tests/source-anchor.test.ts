// @vitest-environment node
import { describe, it, expect } from 'vitest'
import {
  sourceHighlightLink,
  highlightAnchorDomId,
  readHighlightDeepLink,
  articleDeepLink,
  readArticleDeepLink,
} from '../src/shared/source-anchor'

/**
 * AI 引用来源 → 书籍详情原划线的深链约定。
 *
 * 拼链接（Chat）与读链接（BookDetail）两头都从这里出，
 * 任何一头自己改字符串，另一头就会"点了没反应"且没有任何报错。
 */
describe('引用来源深链约定', () => {
  it('链接带上页签与要定位的划线 id，书名里的特殊字符不会撑坏 URL', () => {
    const link = sourceHighlightLink({ bookId: 'b/1?x=2', highlightId: 'h-9' })
    expect(link).toContain('/bookshelf/')
    expect(link).toContain(encodeURIComponent('b/1?x=2'))
    const params = new URLSearchParams(link.split('?')[1])
    expect(params.get('tab')).toBe('highlights')
    expect(params.get('highlight')).toBe('h-9')
  })

  it('DOM 锚点 id 是划线 id 的固定前缀形式（两头必须一字不差）', () => {
    expect(highlightAnchorDomId('h-9')).toBe('highlight-h-9')
  })

  it('读深链：没有 highlight 参数时不编造一个要定位的划线', () => {
    const p = new URLSearchParams('tab=summary')
    expect(readHighlightDeepLink((k) => p.get(k))).toEqual({
      requestedTab: 'summary',
      anchorHighlightId: null,
    })
  })

  it('空串的高亮参数当作没给（避免定位到 id 为空的行）', () => {
    const p = new URLSearchParams('tab=highlights&highlight=')
    expect(readHighlightDeepLink((k) => p.get(k)).anchorHighlightId).toBeNull()
  })

  it('反证：把链接里的参数名或锚点前缀改掉，读回来就对不上', () => {
    const link = sourceHighlightLink({ bookId: 'b1', highlightId: 'h7' })
    const tampered = new URLSearchParams(link.split('?')[1].replace('highlight=', 'hl='))
    expect(readHighlightDeepLink((k) => tampered.get(k)).anchorHighlightId).toBeNull()
    expect(highlightAnchorDomId('h7')).not.toBe('hl-h7')
  })
})

/**
 * 生词抽屉的「回到文章」→ 每日学习。拼与读同样分处两个文件，
 * 所以对得上这件事只能靠测试钉，不靠两边照着写。
 */
describe('生词回文章的深链', () => {
  it('拼出来的链接带 article 参数，特殊字符不撑坏 URL', () => {
    const link = articleDeepLink('a/1?x=2')
    expect(link).toContain('/daily-learning?')
    const params = new URLSearchParams(link.split('?')[1])
    expect(params.get('article')).toBe('a/1?x=2')
  })

  it('读回来：给了就返回 id，没给或空串返回 null（不编一篇出来）', () => {
    const withId = new URLSearchParams('article=a9')
    expect(readArticleDeepLink((k) => withId.get(k))).toBe('a9')
    expect(readArticleDeepLink((k) => new URLSearchParams('').get(k))).toBeNull()
    expect(readArticleDeepLink((k) => new URLSearchParams('article=').get(k))).toBeNull()
  })

  it('反证：拼的一端与读的一端参数名不一致时立刻对不上', () => {
    const link = articleDeepLink('a9')
    const tampered = new URLSearchParams(link.split('?')[1].replace('article=', 'id='))
    expect(readArticleDeepLink((k) => tampered.get(k))).toBeNull()
  })
})
