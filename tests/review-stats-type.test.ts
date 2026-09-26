// ReviewStats 对账（2026-09-22 立，2026-09-26 改）
//
// 当初三处各自声明、一处说谎：
//  - src/shared/types.ts 的 ReviewStats 写的是 totalCards / masteredCards / learningCards /
//    newCards / averageEase / retentionRate —— 一个都不存在（averageEase、retentionRate 是 SM-2 时代的概念）；
//  - renderer.d.ts 把 card.getStats 标成 Promise<ReviewStats>，于是 profileStore 只能
//    `as unknown as Record<string, number>` 把类型绕过去；
//  - 更要命的是两份实现口径不一样：cardsDb 的 due 排除了从未学过的卡（2026-09-15 修的），
//    SqlCardRepository 的 due 还带着老写法，把新卡算成到期 —— 而用户画像服务用的正是这一份。
//
// 类型说谎的代价不是难看，是下一位（人或 AI）会照不存在的字段写界面、
// 或者以为两个 getReviewStats 是一回事。这里用真库跑一遍，逐条钉住。
// 09-26 那层仓储被整层拔掉（见本文件最后一节），"两份实现一致"这条对账因此改成
// 直接钉真实行为，另加一条"第二套数据访问层不许回来"。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { cardsDb, getDatabase } from '../electron/database'

function walkSources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : walkSources(p)
    return /\.(ts|tsx)$/.test(name) ? [p] : []
  })
}

/** 从 src/shared/types.ts 抠出某个 interface 的字段名 */
function interfaceFields(name: string): string[] {
  const src = readFileSync('src/shared/types.ts', 'utf8')
  const start = src.indexOf(`export interface ${name} {`)
  expect(start).toBeGreaterThan(-1)
  const body = src.slice(start, src.indexOf('\n}', start))
  return [...body.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1])
}

/** 直接塞卡进表：state 0 新卡 / 1 学习 / 2 复习，due 全部落在过去 */
function seedCards(): void {
  const db = getDatabase()
  db.run(`INSERT INTO books (id, title) VALUES ('b_rs', '对账用书')`)
  db.run(`INSERT INTO highlights (id, book_id, content) VALUES ('h_rs', 'b_rs', '对账用划线')`)
  // state=0 且已到期：只算 new，不许算 due
  db.run(
    `INSERT INTO cards (id, highlight_id, state, due) VALUES
     ('c_new_1','h_rs',0,datetime('now','-2 day')),
     ('c_new_2','h_rs',0,datetime('now','-1 day')),
     ('c_learn','h_rs',1,datetime('now','-1 day')),
     ('c_rev','h_rs',2,datetime('now','+3 day')),
     ('c_due','h_rs',2,datetime('now','-5 day'))`
  )
}

describe('ReviewStats 与实际返回对账', () => {
  beforeEach(async () => {
    await setupTestDatabase()
  })

  afterEach(() => {
    teardownTestDatabase()
  })

  it('真实返回就是这五个字段，一个不多一个不少', () => {
    seedCards()
    expect(Object.keys(cardsDb.getReviewStats()).sort()).toEqual([
      'due',
      'learning',
      'new',
      'review',
      'total',
    ])
  })

  it('shared 里的 ReviewStats 必须和真实返回一字不差', () => {
    seedCards()
    expect(interfaceFields('ReviewStats').sort()).toEqual(
      Object.keys(cardsDb.getReviewStats()).sort()
    )
  })

  it('due 只算已学过且到期的卡（新卡不许冒充「待办」）', () => {
    seedCards()
    // 5 张里 3 张已学过，其中到期 2 张（学习态 1 张 + 复习态 1 张），
    // 另外那 2 张 state=0 的新卡 due 也在过去 —— 它们只进 new，不许冒充「待办」
    expect(cardsDb.getReviewStats().due).toBe(2)
    expect(cardsDb.getReviewStats().new).toBe(2)
  })

  it('两个 SM-2 遗留字段不许再出现在类型三兄弟里', () => {
    // 只禁这两个：masteredCards 是档案页真实的派生统计（review 态卡数），
    // easeFactor 只剩注释里的历史说明 —— 一并禁会把「写过这件事」当成「还在用」。
    const files = [
      'src/shared/types.ts',
      'src/types/renderer.d.ts',
      'electron/types/entities.ts',
    ]
    for (const ghost of ['averageEase', 'retentionRate']) {
      for (const file of files) {
        expect(readFileSync(file, 'utf8')).not.toContain(ghost)
      }
    }
  })
})

describe('一份定义、一条读数路径', () => {
  /**
   * 2026-09-22 立这条时是"三处声明"（database + repositories + types/repositories），
   * 09-26 拔掉那层后剩两处：数据库实现与 preload 契约。判据不变 —— 谁都不许自己内联一份形状。
   */
  it('两处声明统一用 shared 的 ReviewStats，不各自内联形状', () => {
    const files = ['electron/database/cards.ts', 'src/types/renderer.d.ts']
    for (const file of files) {
      const src = readFileSync(file, 'utf8')
      expect(src).toContain('ReviewStats')
      expect(src).not.toContain('total: number; due: number; new: number')
    }
  })

  /**
   * 2026-09-22 那次抓到的是"同一个 `getReviewStats` 有两份实现且 due 口径不同"（档案页当时
   * 用的正是错的那份）。2026-09-26 把整层仓储拔掉，从此只有一条路 —— 这条判据钉住它别回来：
   * 主进程里不许再出现第二个数据访问层（`electron/repositories/` 与 `getRepositories()`）。
   */
  it('主进程不再的第二套数据访问层不许回来', () => {
    expect(existsSync(join(process.cwd(), 'electron/repositories'))).toBe(false)
    expect(existsSync(join(process.cwd(), 'electron/types/repositories.ts'))).toBe(false)
    const sources = [...walkSources('electron'), ...walkSources('src')].filter(
      (f) => !f.endsWith('.test.ts'),
    )
    const hits = sources.filter((f) => /getRepositories|from '.*\/repositories'/.test(readFileSync(f, 'utf8')))
    expect(hits.map((f) => f.split(/[\\/]/).pop())).toEqual([])
  })

  it('渲染层不再用 as unknown as 绕过这个类型', () => {
    const src = readFileSync('src/renderer/src/stores/profileStore.ts', 'utf8')
    expect(src).not.toContain('as unknown as Record<string, number>')
  })
})
