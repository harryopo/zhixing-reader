/**
 * 各页那台筛选器的共同语义（2026-09-25）
 *
 * 全局搜索在 SQL 里做 LIKE，页面在本地对已加载的行做 includes —— 两套实现留着是有理由的
 * （页面不能为了一次输入再发一条 IPC，SQL 那边则要算总数与分页）。但**字段清单与分词规则
 * 只能有一份**，否则同一个关键词在搜索页说 12 条、点「看全部」过去筛出 9 条，
 * 而两边都不会报错。本仓库已经为划线咬过一次（832 / 916），这一批又量出三处。
 *
 * 判据在 tests/search-filter-parity.test.ts：对同一份数据比**结果集合**，
 * 不比两份清单（清单会各自改，集合不会说谎）。
 */

import { splitQueryTerms } from './global-search'

/** 空格分词、词与词 AND、任一字段含该词即算命中；空关键词不过滤 */
export function matchesAllTerms(
  query: string,
  fields: Array<string | undefined | null>,
): boolean {
  const terms = splitQueryTerms(query.toLowerCase())
  if (terms.length === 0) return true
  const haystack = fields.filter((f): f is string => Boolean(f)).join(' ').toLowerCase()
  return terms.every((term) => haystack.includes(term))
}

export interface HighlightSearchable {
  content: string
  note: string
  chapterTitle: string
  /** 书名不在划线的行里，由页面从已加载的书单里查出来传进来 */
  bookTitle: string
}

export interface CardSearchable {
  title: string
  content: string
  interpretation: string
  application: string
  bookTitle: string
}

export interface MethodologySearchable {
  name: string
  nameEn: string
  triggerScenario: string
  description: string
  outputFormat: string
  examples: string
  /** 步骤是 JSON 文本列，整串参与匹配即可 */
  steps: string
  bookTitle: string
}

/** 划线：正文 / 笔记 / 章名 / 书名 —— 与全局搜索那四个 LIKE 列同一批 */
export function highlightSearchFields(h: HighlightSearchable): string[] {
  return [h.content, h.note, h.chapterTitle, h.bookTitle]
}

/** 知识卡片：标题 / 正文 / 解读 / 应用 / 书名 */
export function cardSearchFields(c: CardSearchable): string[] {
  return [c.title, c.content, c.interpretation, c.application, c.bookTitle]
}

/** 方法论：名字 / 英文名 / 触发场景 / 说明 / 输出格式 / 示例 / 步骤 / 书名 */
export function methodologySearchFields(m: MethodologySearchable): string[] {
  return [
    m.name,
    m.nameEn,
    m.triggerScenario,
    m.description,
    m.outputFormat,
    m.examples,
    m.steps,
    m.bookTitle,
  ]
}
