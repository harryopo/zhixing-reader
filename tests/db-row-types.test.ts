// 行类型对账（2026-09-22）
//
// 背景：db-mapper 以前把所有行都返回 `Record<string, unknown>`，于是八个页面各自
// 另立一份 BookRow / HighlightRow / CardRow 再 `as unknown as` 硬转 —— 累计 63 处。
// 类型不报错，但也不兜底：谁写错列名、谁读一个库里没有的列，都要等到界面上
// 摆出一个永远为 0 的数字才看得见。这一层收口后，字段口径只有 `db-mapper.ts` 一处。
//
// 那次收口当场就抓出三个「类型说得出、库里没有」的读法：
//  - highlight.color：highlights 表没有颜色列，恒返回默认色值
//  - highlight.chapterId：没有 chapter_id / chapter_uid 列（章节只存名字）
//  - highlight.type：没有类型列 —— 结果「笔记」页签按不存在的列筛，永远 0 条
//  - card.updatedAt / card.review_count：cards 表没有这两列
// 现在这里双向钉住：库里有的才许声明（正向），声明了的必须真造得出来（反向）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { getDatabase } from '../electron/database'
import {
  mapBook,
  mapHighlight,
  mapCard,
  mapKnowledgeCard,
  mapMethodology,
  mapArticle,
  mapVocabulary,
  type BookRow,
  type HighlightRow,
  type CardRow,
  type KnowledgeCardRow,
  type MethodologyRow,
  type ArticleRow,
  type VocabularyRow,
} from '../src/renderer/src/utils/db-mapper'

const MAPPER_SRC = readFileSync('src/renderer/src/utils/db-mapper.ts', 'utf8')

const camel = (s: string): string => s.replace(/_+([a-z0-9])/g, (_, c: string) => c.toUpperCase())

/** interface 里声明的字段（含 TS 类型），跳过 `...` 与索引签名 */
function declaredFields(name: string): Array<{ field: string; tsType: string }> {
  const start = MAPPER_SRC.indexOf(`export interface ${name} {`)
  expect(start, `db-mapper.ts 里找不到 interface ${name}`).toBeGreaterThan(-1)
  const body = MAPPER_SRC.slice(start, MAPPER_SRC.indexOf('\n}', start))
  return [...body.matchAll(/^ {2}(\w+)(?:\?)?: ([\w[\]]+)$/gm)].map((m) => ({
    field: m[1],
    tsType: m[2],
  }))
}

/** mapper 函数体（顶层 `}` 之前的部分） */
function mapperBody(fn: string): string {
  const start = MAPPER_SRC.indexOf(`export function ${fn}(`)
  expect(start, `db-mapper.ts 里找不到 function ${fn}`).toBeGreaterThan(-1)
  return MAPPER_SRC.slice(start, MAPPER_SRC.indexOf('\n}', start))
}

const DATE_COLS = /(_at|_time|due|last_review|publish_date)$/
const JSON_COLS = new Set(['tags', 'steps', 'related_card_ids', 'source_highlight_ids'])
const NUM_COLS = new Set([
  'reading_progress',
  'is_finished',
  'total_chapter',
  'style',
  'state',
  'step',
  'stability',
  'difficulty',
  'elapsed_days',
  'scheduled_days',
  'reps',
  'lapses',
  'review_count',
  'mastery_level',
  'practice_count',
])

/** 库里是 INTEGER 0/1、界面上应当是 boolean 的列（踩过：数字 0 被 React 当文本画出来） */
const BOOL_COLS = new Set(['is_read', 'is_favorite', 'is_mastered'])

/** 给每一列一个「类型对得上」的假值：日期列要能被 safeDate 解析，数字列给数字 */
function valueFor(col: string): unknown {
  if (col === 'type') return 'concept'
  if (BOOL_COLS.has(col)) return 1
  if (DATE_COLS.test(col)) return '2026-09-01 08:00:00'
  if (JSON_COLS.has(col)) return '["甲","乙"]'
  if (NUM_COLS.has(col)) return 1
  return `v_${col}`
}

function columnsOf(table: string): string[] {
  const rows = getDatabase().exec(`PRAGMA table_info(${table})`)
  expect(rows.length, `${table} 表不存在`).toBeGreaterThan(0)
  const idx = rows[0].columns.indexOf('name')
  return rows[0].values.map((v) => v[idx] as string)
}

const kindOf = (tsType: string): string => {
  if (tsType.endsWith('[]')) return 'array'
  if (tsType === 'number') return 'number'
  if (tsType === 'boolean') return 'boolean'
  return 'string'
}

/**
 * 映射器读的列名对不对得上库里的真实列。两类问题都算：
 *  1) 字段没有任何真实来源（只读了一个库里不存在的列）—— 界面拿到的永远是默认值；
 *  2) 字段有真实来源，但还挂着一个库里没有的别名 —— 现在是死代码，下次改口径会走偏。
 * 允许的名字：真实列名、真实列名的驼峰形、字段自己的名字
 * （页面在落库前构造的对象用驼峰，如 mapBook 也接受 progress）。
 */
function phantomReads(body: string, allowed: Set<string>, derived: string[] = []): string[] {
  const offenders: string[] = []
  const skip = new Set(derived)
  for (const [, field, expr] of body.matchAll(/^ {4}(\w+): ([^\n]+),$/gm)) {
    if (skip.has(field)) continue
    const reads = (expr.match(/row\.(\w+)/g) ?? []).map((r) => r.slice('row.'.length))
    if (!reads.some((k) => allowed.has(k))) {
      offenders.push(`${field} 没有真实列来源（读了 ${reads.join('/')}）`)
      continue
    }
    for (const key of reads) {
      if (!allowed.has(key) && key !== field) offenders.push(`${field} <- row.${key} 不是列名`)
    }
  }
  return offenders
}

const CASES: Array<{
  label: string
  table: string
  aliases: string[]
  derived?: string[]
  /** 返回 object：新收的两张表（vocabulary / articles）故意不带索引签名，字段读错就编译不过 */
  mapper: (row: Record<string, unknown>) => object
  fn: string
}> = [
  {
    label: 'BookRow',
    table: 'books',
    // cards 的行由 `SELECT c.*, h.book_id AS book_id` 供书 id，PRAGMA 里没有这一列
    aliases: [],
    mapper: mapBook as (row: Record<string, unknown>) => BookRow,
    fn: 'mapBook',
  },
  {
    label: 'HighlightRow',
    table: 'highlights',
    aliases: [],
    // type 是推导列（库里没有类型列，见 mapHighlight 的注释），下面单独有用例钉它的推导
    derived: ['type'],
    mapper: mapHighlight as (row: Record<string, unknown>) => HighlightRow,
    fn: 'mapHighlight',
  },
  {
    label: 'CardRow',
    table: 'cards',
    aliases: ['book_id'],
    mapper: mapCard as (row: Record<string, unknown>) => CardRow,
    fn: 'mapCard',
  },
  {
    label: 'KnowledgeCardRow',
    table: 'knowledge_cards',
    aliases: [],
    mapper: mapKnowledgeCard as (row: Record<string, unknown>) => KnowledgeCardRow,
    fn: 'mapKnowledgeCard',
  },
  {
    label: 'MethodologyRow',
    table: 'methodologies',
    aliases: [],
    mapper: mapMethodology as (row: Record<string, unknown>) => MethodologyRow,
    fn: 'mapMethodology',
  },
  {
    // 2026-09-25（Issue #3）：这两张表以前**完全没有**映射层，页面各自 `as unknown as`
    // 硬转自己声明的行类型（生词三份、文章两份），列名对不对没人管
    label: 'VocabularyRow',
    table: 'vocabulary',
    aliases: [],
    mapper: mapVocabulary,
    fn: 'mapVocabulary',
  },
  {
    label: 'ArticleRow',
    table: 'articles',
    aliases: [],
    mapper: mapArticle,
    fn: 'mapArticle',
  },
]

describe('行类型 ↔ 数据库列 双向对账', () => {
  beforeEach(async () => {
    await setupTestDatabase()
  })

  afterEach(() => {
    teardownTestDatabase()
  })

  for (const c of CASES) {
    it(`${c.label}：只声明库里真有的列，且每个字段都造得出来`, () => {
      const cols = [...columnsOf(c.table), ...c.aliases]
      const row: Record<string, unknown> = {}
      for (const col of cols) row[col] = valueFor(col)

      const mapped = c.mapper(row) as Record<string, unknown>
      const declared = declaredFields(c.label)
      expect(declared.length, `${c.label} 一个字段都没声明`).toBeGreaterThan(0)

      for (const { field, tsType } of declared) {
        expect(mapped[field], `${c.label}.${field} 映射器没有写出`).not.toBeUndefined()
        expect(mapped[field], `${c.label}.${field} 应为 ${tsType}`).not.toBeNull()
        const kind = kindOf(tsType)
        if (kind === 'array') {
          expect(Array.isArray(mapped[field]), `${c.label}.${field} 应为数组`).toBe(true)
        } else {
          expect(typeof mapped[field], `${c.label}.${field} 应为 ${kind}`).toBe(kind)
        }
      }
    })

    it(`${c.label}：映射器不许读库里不存在的列`, () => {
      const cols = [...columnsOf(c.table), ...c.aliases]
      const allowed = new Set([...cols, ...cols.map(camel)])
      expect(
        phantomReads(mapperBody(c.fn), allowed, c.derived),
        `${c.label}：这些读法在 ${c.table} 表里没有对应列`
      ).toEqual([])
    })
  }

  it('扫描本身要能抓出问题（拿当初那三个假字段验一遍，防止规则空转）', () => {
    const allowed = new Set(['content', 'note', 'book_id', 'created_at', 'due'])
    expect(
      phantomReads(
        `
    content: safeStr(row.content),
    note: safeStr(row.note),
    color: safeStr(row.color, '#facc15'),
    chapterId: safeStr(row.chapter_uid ?? ''),
    createdAt: safeDate(row.created_at ?? row.createdAt),
    nextReviewAt: safeDate(row.due ?? row.next_review_at),
`,
        allowed
      )
    ).toEqual([
      'color 没有真实列来源（读了 color）',
      'chapterId 没有真实列来源（读了 chapter_uid）',
      'nextReviewAt <- row.next_review_at 不是列名',
    ])
  })

  it('「笔记」页签按 note 是否非空分类，不再读不存在的 type 列', () => {
    const base = { id: 'h1', book_id: 'b1', content: '原文' }
    expect(mapHighlight({ ...base, note: null }).type).toBe('highlight')
    expect(mapHighlight({ ...base, note: '' }).type).toBe('highlight')
    expect(mapHighlight({ ...base, note: '我的想法' }).type).toBe('note')
  })

  it('card 的复习次数只留一个名字（reps），不再 reps/reviewCount 两份口径', () => {
    const declared = declaredFields('CardRow').map((f) => f.field)
    expect(declared).toContain('reps')
    expect(declared).not.toContain('reviewCount')
    const mapped = mapCard({ id: 'c1', highlight_id: 'h1', reps: 3, due: '2026-09-01 08:00:00' })
    expect(mapped.reps).toBe(3)
  })

  it('0/1 列在边界处就是 boolean，不会再出现「渲染出一个 0」那种事', () => {
    expect(mapArticle({ id: 'a1', is_read: 0, is_favorite: 1 }).is_read).toBe(false)
    expect(mapArticle({ id: 'a1', is_read: 0, is_favorite: 1 }).is_favorite).toBe(true)
    expect(mapVocabulary({ id: 'w1', is_mastered: 0 }).is_mastered).toBe(false)
    expect(mapVocabulary({ id: 'w1', is_mastered: 1 }).is_mastered).toBe(true)
    // 缺列时给默认值而不是 undefined：页面 `if (a.is_read)` 不会因为字段没定义而静默走偏
    expect(mapArticle({}).is_read).toBe(false)
    expect(mapVocabulary({}).meaning_zh).toBe('')
  })

  it('生词的 ef_factor 缺列时回退 2.5（库里 DEFAULT 2.5，两份口径会算出不同的调度）', () => {
    expect(mapVocabulary({}).ef_factor).toBe(2.5)
    expect(mapVocabulary({ ef_factor: 3.1 }).ef_factor).toBe(3.1)
  })
})

describe('页面不再自己另立行类型', () => {
  /** 递归列出渲染层的 .ts/.tsx（跳过测试文件，它们本就要自己造行） */
  function sources(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) {
        return name === '__tests__' || name === 'node_modules' ? [] : sources(p)
      }
      return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : []
    })
  }

  const RENDERER = join(__dirname, '..', 'src', 'renderer', 'src')

  it('渲染层没有任何一处重新声明这些行类型', () => {
    const offenders = sources(RENDERER)
      .filter((f) => !f.endsWith('db-mapper.ts'))
      .filter((f) =>
        // Article / Vocabulary 这两份是 2026-09-25（Issue #3）收掉的：
        // 同一个 vocabulary 行此前有三份声明（页面各写各的，is_mastered 一份写 number 一份写 boolean）
        /interface (BookRow|HighlightRow|CardRow|KnowledgeCardRow|MethodologyRow|Article|ArticleRow|Vocabulary|VocabularyRow|VocabularyItem)\s*[{<]/.test(
          readFileSync(f, 'utf8'),
        ),
      )
    expect(offenders).toEqual([])
  })

  it('没有任何一处把 IPC 行硬转成页面自己的行类型', () => {
    const offenders = sources(RENDERER).filter((f) =>
      /as unknown as (BookRow|HighlightRow|CardRow|KnowledgeCardRow|MethodologyRow|Article|ArticleRow|Vocabulary|VocabularyRow|VocabularyItem)\[?\]?\b/.test(
        readFileSync(f, 'utf8'),
      ),
    )
    expect(offenders).toEqual([])
  })

  it('反证：扫描真的看得见这类写法（把收口前的原文喂进去必须命中）', () => {
    const before = [
      "export interface VocabularyItem {\n  id: string\n}",
      'setVocabulary(data as unknown as VocabularyItem[])',
      'setArticles(raw as unknown as Article[])',
    ]
    const decl = /interface (BookRow|HighlightRow|CardRow|KnowledgeCardRow|MethodologyRow|Article|ArticleRow|Vocabulary|VocabularyRow|VocabularyItem)\s*[{<]/
    const cast = /as unknown as (BookRow|HighlightRow|CardRow|KnowledgeCardRow|MethodologyRow|Article|ArticleRow|Vocabulary|VocabularyRow|VocabularyItem)\[?\]?\b/
    expect(decl.test(before[0])).toBe(true)
    expect(cast.test(before[1])).toBe(true)
    expect(cast.test(before[2])).toBe(true)
  })
})
