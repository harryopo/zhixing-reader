/**
 * 全局搜索的单一约定（2026-09-25）
 *
 * 顶栏那个搜索框过去只把关键词带去书架页搜书名，可读者想找的往往是
 * "我哪本书里划过这句话""那张讲复利的卡片叫什么"。这里把跨五类内容的搜索收成一份：
 * 类名、每类上限、命中片段怎么截、点回去的链接怎么拼 ——
 * 主进程、结果页、以及那三个被链接到的页面都从这里取，改名字测试立刻红。
 *
 * 全程本地计算：LIKE 命中就是命中，不调 AI、不建索引、不联网。
 */

import { articleDeepLink, sourceHighlightLink } from './source-anchor'

export type SearchKind = 'highlight' | 'card' | 'methodology' | 'article' | 'word'

export interface SearchGroupSpec {
  kind: SearchKind
  /** 界面分组标题，也是"这一类搜的是什么"的说明 */
  label: string
  /** 每类最多列几条：搜索页是看一眼的地方，不是翻页的地方 */
  limit: number
}

export const SEARCH_GROUPS: readonly SearchGroupSpec[] = [
  { kind: 'highlight', label: '划线', limit: 8 },
  { kind: 'card', label: '知识卡片', limit: 6 },
  { kind: 'methodology', label: '方法论', limit: 6 },
  { kind: 'article', label: '文章', limit: 6 },
  { kind: 'word', label: '生词', limit: 6 },
]

export interface SearchHit {
  kind: SearchKind
  id: string
  /** 这一条的主标题：书名、卡片名、方法论名、单词本身 */
  title: string
  /** 标题后面那行小字：哪本书、哪一章、难度、词性；没有就空串 */
  meta: string
  /** 命中处居中的片段 */
  snippet: string
  /** 点回去的路由（结果页与各页都从这里拿，两处口径会漂） */
  link: string
}

export interface SearchGroupResult {
  kind: SearchKind
  label: string
  hits: SearchHit[]
}

export interface GlobalSearchResult {
  query: string
  /** 只含有命中的类；一类都没有就是空数组 */
  groups: SearchGroupResult[]
  /** 列出来的条数（受每类上限约束，不是库里的总命中数） */
  total: number
}

/** 片段里命中词前后各留多少字 */
export const SNIPPET_RADIUS = 44

/**
 * 把命中处挪到片段中间，两端各留一截，截了才加省略号。
 *
 * "整段开头 + 省略号"在长段落里等于没给上下文 —— 读者要找的那句还在几百字之外。
 */
export function makeSnippet(text: string, query: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return ''
  const needle = query.trim()
  const at = needle ? flat.toLowerCase().indexOf(needle.toLowerCase()) : -1
  if (at === -1) {
    return flat.length <= SNIPPET_RADIUS * 2 ? flat : `${flat.slice(0, SNIPPET_RADIUS * 2)}…`
  }
  const from = Math.max(0, at - SNIPPET_RADIUS)
  const to = Math.min(flat.length, at + needle.length + SNIPPET_RADIUS)
  return `${from > 0 ? '…' : ''}${flat.slice(from, to)}${to < flat.length ? '…' : ''}`
}

export interface SnippetPart {
  text: string
  hit: boolean
}

/**
 * 片段里哪一段是命中词 —— 结果页拿它包 <mark>。
 *
 * "命中处居中"由主进程做，"把命中词标出来"是界面的事，但两者都得按同一套
 * 不区分大小写的匹配来找，所以判定留在这一个模块里。
 */
export function splitByMatch(text: string, query: string): SnippetPart[] {
  const needle = query.trim()
  if (!needle || !text) return [{ text, hit: false }]
  const parts: SnippetPart[] = []
  const lower = text.toLowerCase()
  const lowerNeedle = needle.toLowerCase()
  let at = 0
  for (;;) {
    const hit = lower.indexOf(lowerNeedle, at)
    if (hit === -1) {
      parts.push({ text: text.slice(at), hit: false })
      break
    }
    if (hit > at) parts.push({ text: text.slice(at, hit), hit: false })
    parts.push({ text: text.slice(hit, hit + needle.length), hit: true })
    at = hit + needle.length
  }
  return parts
}

/**
 * 关键词 → LIKE 的匹配串。
 *
 * `%` 与 `_` 是 LIKE 的通配符，转义掉才按字面匹配（值本来就走 `?` 占位符，这里只管通配符）。
 * `ESCAPE '\'` 由写 SQL 的那一侧带上，两边少一个都不算数。
 */
export function toLikePattern(query: string): string {
  return `%${query.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%`
}

/**
 * 按类拼"点回去"的链接。
 *
 * 划线与生词能精确到那一条（前者有 source-anchor，后者那一页本来就能按 id 选词）；
 * 卡片与方法论那两页没有"按 id 打开"的入口，就带着同一个关键词过去，
 * 让页面自己的搜索框把命中项筛到眼前 —— 比跳过去让人翻整页强。
 */
export function buildHitLink(hit: {
  kind: SearchKind
  id: string
  query: string
  bookId?: string | null
}): string {
  const { kind, id, query, bookId } = hit
  switch (kind) {
    case 'highlight':
      return bookId ? sourceHighlightLink({ bookId, highlightId: id }) : `/notes?${qs(query)}`
    case 'article':
      return articleDeepLink(id)
    case 'card':
      return `/knowledge-cards?${qs(query)}`
    case 'methodology':
      return `/methodologies?${qs(query)}`
    case 'word':
      return `/vocabulary?item=${encodeURIComponent(id)}`
  }
}

function qs(query: string): string {
  return new URLSearchParams({ q: query }).toString()
}

/** 结果页顶上一句话；一个都没命中时也要说清楚搜的是什么 */
export function describeSearchOutcome(query: string, total: number): string {
  if (!query.trim()) return '输入关键词，在你的划线、卡片、方法论、文章与生词里找'
  if (total === 0) return `没有找到包含「${query.trim()}」的内容`
  return `找到 ${total} 条与「${query.trim()}」相关的内容`
}

/** 空搜索框不该发请求 */
export function isSearchable(query: string): boolean {
  return query.trim().length > 0
}
