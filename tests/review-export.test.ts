// 知行读书 — 复习记录 CSV 导出（src/shared/review-export.ts）
//
// 背景：设置页「导出复习数据」曾经固定读 r.cardId / r.quality / r.easeFactor /
// r.interval / r.reviewedAt —— 那是 SM-2 时代的假字段名。sql.js 返回的就是数据库
// 列名（card_id / rating / elapsed_days / scheduled_days / review_time），不做驼峰转换，
// 所以导出的 CSV 六列里只有第一列有值，其余常年空白，而界面上没有任何异常。
//
// 这一份测试钉的是「列清单 == reviews 表的真实列」这条对账关系，
// 而不是某个具体字符串 —— 以后加列或改名，测试会直接指出漂移在哪一侧。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { booksDb, highlightsDb, cardsDb, reviewsDb } from '../electron/database'
import { REVIEW_CSV_COLUMNS, buildReviewCsv } from '../src/shared/review-export'
import { csvEscape } from '../src/shared/csv'
import { Rating } from '../electron/fsrs-engine'

describe('REVIEW_CSV_COLUMNS — 与 reviews 表逐列对账', () => {
  let db: Awaited<ReturnType<typeof setupTestDatabase>>

  beforeEach(async () => {
    db = await setupTestDatabase()
  })

  afterEach(() => {
    teardownTestDatabase()
  })

  function columnsOf(table: string): string[] {
    const rows = db.exec(`PRAGMA table_info(${table})`)[0].values
    return rows.map((r) => r[1] as string)
  }

  it('每一列的 key 都是 reviews 表的真实列', () => {
    const real = columnsOf('reviews')
    const missing = REVIEW_CSV_COLUMNS.filter((c) => !real.includes(c.key)).map((c) => c.key)
    expect(missing).toEqual([])
  })

  it('reviews 表的真实列一个都不许漏（漏了就是又少导出一列）', () => {
    expect([...columnsOf('reviews')].sort()).toEqual(
      REVIEW_CSV_COLUMNS.map((c) => c.key).sort()
    )
  })

  it('SM-2 时代的假字段名不许回来', () => {
    const keys = REVIEW_CSV_COLUMNS.map((c) => c.key)
    for (const dead of ['cardId', 'quality', 'easeFactor', 'interval', 'reviewedAt']) {
      expect(keys).not.toContain(dead)
    }
  })
})

describe('buildReviewCsv — 真实写入的一条记录，六列都得有值', () => {
  beforeEach(async () => {
    await setupTestDatabase()
  })

  afterEach(() => {
    teardownTestDatabase()
  })

  it('从 reviewsDb.create 到 CSV 全链路不丢列', () => {
    booksDb.create({ id: 'b1', title: '书一' } as never)
    highlightsDb.create({ id: 'h1', book_id: 'b1', content: '划线一' } as never)
    const card = cardsDb.create('h1')
    reviewsDb.create(card.id, Rating.Good)

    const rows = reviewsDb.getRecent(10) as unknown as Array<Record<string, unknown>>
    expect(rows).toHaveLength(1)

    const [headerLine, dataLine] = buildReviewCsv(rows).split('\n')
    const header = headerLine.split(',')
    const cells = dataLine.split(',')

    expect(header).toHaveLength(REVIEW_CSV_COLUMNS.length)
    expect(cells).toHaveLength(header.length)
    // 原 bug 的复现点：这里一旦有人再去读不存在的字段，对应格子就是空串
    cells.forEach((cell, i) => {
      expect(cell, `第 ${i} 列「${header[i]}」导出为空`).not.toBe('')
    })
  })

  it('空数组只剩表头', () => {
    expect(buildReviewCsv([])).toBe(REVIEW_CSV_COLUMNS.map((c) => c.header).join(','))
  })
})

describe('csvEscape', () => {
  it('逗号、引号、换行都要包起来', () => {
    expect(csvEscape('a,b')).toBe('"a,b"')
    expect(csvEscape('他说"好"')).toBe('"他说""好"""')
    expect(csvEscape('两\n行')).toBe('"两\n行"')
  })

  it('null / undefined 导出空串而不是 "undefined"', () => {
    expect(csvEscape(null)).toBe('')
    expect(csvEscape(undefined)).toBe('')
    expect(csvEscape(0)).toBe('0')
  })
})
