// 「搜索命中的那一条，点过去真的在」—— 两套筛法的集合必须相等（2026-09-25）
//
// 全局搜索用 SQL 的 LIKE，各页那台筛选器用 JS 的 includes。字段清单各写一份，
// 就一定会漂 —— 这不是推测：本仓库已经为划线咬过一次（搜索 832 条 / 笔记页 916 条），
// 这一批又量出三处（方法论那页不搜 steps、卡片那页搜 application 与书名而 SQL 不搜、
// 生词本那条 SQL 既不转义 %/_ 也不按空格分词）。
//
// 所以判据不比对两份清单（清单会各自改），而是**对同一份数据比结果集合**：
// 同一个关键词，全局搜索报的 matched 条数与列出的 id，必须与那一页自己的筛法完全一致。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import {
  articlesDb,
  booksDb,
  highlightsDb,
  knowledgeCardsDb,
  methodologiesDb,
  vocabularyDb,
} from '../electron/database'
import { globalSearch } from '../electron/services/global-search'
import {
  cardSearchFields,
  highlightSearchFields,
  matchesAllTerms,
  methodologySearchFields,
} from '../src/shared/page-filter'

/** 把某类的行喂给"那一页自己的筛法"，返回命中的 id 集合 */
function pageFilter(
  rows: Array<Record<string, unknown>>,
  fields: (row: Record<string, unknown>) => Array<string | undefined | null>,
  query: string,
): Set<string> {
  return new Set(
    rows.filter((row) => matchesAllTerms(query, fields(row))).map((row) => String(row.id)),
  )
}

/** 全局搜索那一组的命中：条数与 id 集合都算 */
function searchGroup(query: string, kind: string) {
  const r = globalSearch(query)
  const g = r.groups.find((x) => x.kind === kind)
  return { matched: g?.matched ?? 0, ids: new Set((g?.hits ?? []).map((h) => h.id)) }
}

const str = (row: Record<string, unknown>, key: string) =>
  row[key] === null || row[key] === undefined ? '' : String(row[key])

beforeEach(async () => {
  await setupTestDatabase()
  booksDb.create({ id: 'b1', title: '思考，快与慢' })
  booksDb.create({ id: 'b2', title: '穷查理宝典' })
  // 关键词用 ASCII 生造词：中文句子（"正文里没有锚点"）本身就把词包含住了，
  // 那样造出来的"不该命中"的行其实一直命中，测试会假绿。
  // 每类都种一条"只有那一页会搜到的字段里才有关键词"的行 —— 两边清单不齐就立刻分开
  highlightsDb.create({
    id: 'h1',
    book_id: 'b1',
    content: '与正文无关的一句话',
    note: '',
    chapter_title: '第二章',
  })
  highlightsDb.create({ id: 'h2', book_id: 'b2', content: 'ZQXW 在这里', note: '' })
  knowledgeCardsDb.create({
    id: 'k1',
    book_id: 'b1',
    type: 'concept',
    title: '一个概念',
    content: '正文没有',
    interpretation: '解读也没有',
    application: 'ZQXW 只在应用场景里',
  })
  knowledgeCardsDb.create({
    id: 'k2',
    book_id: 'b1',
    type: 'quote',
    title: '另一张卡',
    content: 'ZQXW 也在正文里',
  })
  knowledgeCardsDb.create({
    id: 'k3',
    book_id: 'b2',
    type: 'concept',
    title: '书名才算的那张',
    content: '哪都没有',
  })
  methodologiesDb.create({
    id: 'm1',
    book_id: 'b1',
    name: '一个方法',
    description: '说明里没有',
    steps: JSON.stringify(['第一步：先找 ZQXW']),
  })
  methodologiesDb.create({
    id: 'm2',
    book_id: 'b2',
    name: '另一个方法',
    description: '说明',
    steps: JSON.stringify(['步骤']),
    trigger_scenario: 'ZQXW 的触发场景',
  })
  articlesDb.create({ id: 'a1', title_en: 'ZQXW in english title', content_en: 'Body', source: 'rss' })
  vocabularyDb.create({ id: 'v1', word: 'ZQXW', meaning_zh: 'ZQXW 与 XHYZ 同现的一条' })
  vocabularyDb.create({ id: 'v2', word: 'example', meaning_zh: '只含 XHYZ 的另一个词' })
})

afterEach(() => {
  teardownTestDatabase()
})

describe('划线：SQL 与笔记页那台筛选器同一个答案', () => {
  const bookTitles: Record<string, string> = { b1: '思考，快与慢', b2: '穷查理宝典' }

  it('单字与整词都一样：条数与 id 集合完全相等', () => {
    const rows = highlightsDb.getAll()
    const fields = (row: Record<string, unknown>) =>
      highlightSearchFields({
        content: str(row, 'content'),
        note: str(row, 'note'),
        chapterTitle: str(row, 'chapter_title'),
        bookTitle: bookTitles[str(row, 'book_id')] ?? '',
      })
    for (const q of ['ZQXW', '第二', 'ZQXW 穷查理']) {
      const g = searchGroup(q, 'highlight')
      const page = pageFilter(rows, fields, q)
      expect(g.matched, `「${q}」搜索报的条数与页面筛出的条数不一样`).toBe(page.size)
      for (const id of g.ids) expect(page.has(id), `${id} 在搜索结果里，页面却筛不到`).toBe(true)
    }
  })
})

describe('知识卡片：application 与书名两边都算', () => {
  const bookTitles: Record<string, string> = { b1: '思考，快与慢', b2: '穷查理宝典' }

  it('只有应用场景含关键词的那张卡，搜索与页面都必须给出来', () => {
    const rows = knowledgeCardsDb.getAll()
    const fields = (row: Record<string, unknown>) =>
      cardSearchFields({
        title: str(row, 'title'),
        content: str(row, 'content'),
        interpretation: str(row, 'interpretation'),
        application: str(row, 'application'),
        bookTitle: bookTitles[str(row, 'book_id')] ?? '',
      })
    const g = searchGroup('ZQXW', 'card')
    const page = pageFilter(rows, fields, 'ZQXW')
    expect(g.matched).toBe(page.size)
    expect(page.has('k1')).toBe(true)
    expect(g.ids.has('k1')).toBe(true)
  })

  it('书名命中两边同算（搜「穷查理」应找得到那本书里的内容）', () => {
    const rows = knowledgeCardsDb.getAll()
    const fields = (row: Record<string, unknown>) =>
      cardSearchFields({
        title: str(row, 'title'),
        content: str(row, 'content'),
        interpretation: str(row, 'interpretation'),
        application: str(row, 'application'),
        bookTitle: bookTitles[str(row, 'book_id')] ?? '',
      })
    expect(searchGroup('穷查理', 'card').matched).toBe(pageFilter(rows, fields, '穷查理').size)
  })
})

describe('方法论：steps 与触发场景两边都算', () => {
  const bookTitles: Record<string, string> = { b1: '思考，快与慢', b2: '穷查理宝典' }

  it('只有步骤含关键词的那条，搜索与页面都必须给出来', () => {
    const rows = methodologiesDb.getAll()
    const fields = (row: Record<string, unknown>) =>
      methodologySearchFields({
        name: str(row, 'name'),
        nameEn: str(row, 'name_en'),
        triggerScenario: str(row, 'trigger_scenario'),
        description: str(row, 'description'),
        outputFormat: str(row, 'output_format'),
        examples: str(row, 'examples'),
        steps: str(row, 'steps'),
        bookTitle: bookTitles[str(row, 'book_id')] ?? '',
      })
    const g = searchGroup('ZQXW', 'methodology')
    const page = pageFilter(rows, fields, 'ZQXW')
    expect(g.matched).toBe(page.size)
    expect(page.has('m1')).toBe(true)
    expect(g.ids.has('m1')).toBe(true)
  })
})

describe('生词本：那条 SQL 与全局搜索同一个语义', () => {
  it('多关键词按空格分词做 AND（两个词同现的那条才算，只含一个词的不算）', () => {
    const byPage = vocabularyDb.search('ZQXW XHYZ').map((r) => String(r.id))
    const bySearch = globalSearch('ZQXW XHYZ').groups.find((g) => g.kind === 'word')?.hits ?? []
    expect(byPage.sort()).toEqual(bySearch.map((h) => h.id).sort())
    expect(byPage).toEqual(['v1'])
  })

  it('% 按字面匹配，不会命中所有行（全局搜索转义，那条 SQL 也必须转义）', () => {
    expect(vocabularyDb.search('%')).toEqual([])
  })
})
