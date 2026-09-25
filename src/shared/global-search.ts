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
  /**
   * 库里一共命中多少条 —— `hits` 只到 `limit`，所以必须另外报。
   *
   * 少了这个数，界面上写「划线 8 条」而库里可能命中 214 条，读者以为就这些了。
   */
  matched: number
}

export interface GlobalSearchResult {
  query: string
  /** 只含有命中的类；一类都没有就是空数组 */
  groups: SearchGroupResult[]
  /** 列出来的条数（各类受每类上限约束） */
  total: number
  /** 库里命中的条数（各类相加，可能远大于 total） */
  matchedTotal: number
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

/** 这一类该怎么写条数：库里命中多少、这里列出多少 */
export function describeGroupCount(group: SearchGroupResult): string {
  if (group.matched > group.hits.length) {
    return `共 ${group.matched} 条 · 列出 ${group.hits.length} 条`
  }
  return `${group.hits.length} 条`
}

/**
 * "看全部"的出口 —— **只有那一页真能按关键词筛的类才给**。
 *
 * 文章那一页没有关键词筛选（只有难度 / 已读 / 收藏），给它一个链接等于给一个
 * "点了什么也不会变"的按钮，所以宁可不给，条数那句话已经说清了。
 */
export function seeAllLink(kind: SearchKind, query: string): string | null {
  switch (kind) {
    case 'highlight':
      return `/notes?${qs(query)}`
    case 'card':
      return `/knowledge-cards?${qs(query)}`
    case 'methodology':
      return `/methodologies?${qs(query)}`
    case 'word':
      return `/vocabulary?${qs(query)}`
    case 'article':
      return null
  }
}

/**
 * 关键词拆词：空格分隔，每个词都要命中（与笔记页那台筛选器同一套口径）。
 *
 * 不这么做的话「复利 时间」会被当成一整串连续片段去找 —— 笔记页能出的结果，
 * 全局搜索反而说没有，同一份数据两种答法。
 */
export function splitQueryTerms(query: string): string[] {
  const seen = new Set<string>()
  for (const t of query.split(/\s+/)) {
    const term = t.trim()
    if (term) seen.add(term)
  }
  return [...seen]
}

/**
 * 按字面词数命中 —— 与 `splitByMatch` 用的是同一个匹配（结果页标黄的段数就是这里数的段数）。
 *
 * 为什么这里不用 `retrieval.ts` 那套 BM25：那台机器干的是"从整库里捞候选"，
 * 靠中文 2 字滑窗 + 噪声词过滤，而这里的候选已经由 LIKE 筛好了（每条都含每个词）。
 * 拿 bigram 给一条只含单字的关键词打分，会得到一排 0 分 —— 排名又退回时间顺序，
 * 而界面却说不出为什么。**筛使用哪个"命中"关系，排序就必须用同一个。**
 */
function countHits(text: string, term: string): number {
  let n = 0
  for (const part of splitByMatch(text, term)) if (part.hit) n++
  return n
}

/** 标题加权的取值与 `retrieval.ts` 的 TITLE_BOOST 同源：标题里有，说明这条就在讲它 */
const TITLE_BOOST = 3
/** 一个词出现多少次封顶：堆砌不该无限赢 */
const HIT_CAP = 5
/** 密度标尺：每这么多字算"一整篇"，长文里提一次不如短句里提一次 */
const LENGTH_UNIT = 120

/**
 * 这一条与关键词有多相关。
 *
 * 三件事：命中多少次（封顶）、标题里有没有（加权）、文本多长（密度）。
 * 每个关键词各自算一遍再相加，所以「复利 时间」会把两个词都提到的排在前面。
 */
export function relevanceScore(terms: string[], text: string, title: string): number {
  const body = text.toLowerCase()
  const head = title.toLowerCase()
  // 命中 0 次的词一项都不贡献 —— 不会把不含关键词的行顶到前面去
  const density = body.length > 0 ? 1 + (body.length - 1) / LENGTH_UNIT : 1
  let sum = 0
  for (const term of terms) {
    const t = term.toLowerCase()
    sum += Math.min(countHits(body, t), HIT_CAP) / density
    sum += TITLE_BOOST * Math.min(countHits(head, t), HIT_CAP)
  }
  return Number(sum.toFixed(4))
}

/** 结果页顶上一句话；一个都没命中时也要说清楚搜的是什么 */
export function describeSearchOutcome(query: string, listed: number, matchedTotal: number): string {
  const q = query.trim()
  if (!q) return '输入关键词，在你的划线、卡片、方法论、文章与生词里找'
  if (matchedTotal === 0) return `没有找到包含「${q}」的内容`
  if (matchedTotal > listed) {
    // 「最相关」现在说得住：每类命中的行都过了 relevanceScore，同分才按时间
    return `找到 ${matchedTotal} 条与「${q}」相关的内容，下面列出最相关的 ${listed} 条`
  }
  return `找到 ${matchedTotal} 条与「${q}」相关的内容`
}

/** 空搜索框不该发请求 */
export function isSearchable(query: string): boolean {
  return query.trim().length > 0
}
