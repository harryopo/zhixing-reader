// SQL 里拼列名的四条通路收口（2026-09-25）
//
// 值一直是走 `?` 占位符的，问题在列名：四个 `update(id, record)` 都把**调用方给的对象键名**
// 原样拼进 `SET x = ?`，而这四个 record 来自渲染层（BOOKS/HIGHLIGHTS/METHODOLOGIES/
// KNOWLEDGE_CARDS 四条 UPDATE 通道整包下发）。键名里带逗号等符号就能改写整条 SET 子句。
// 判据只有一条：拼进 SQL 的列名必须真是那张表里的列 —— 用 PRAGMA table_info 判，
// 不另写一份列清单（本项目被"两份清单各自漂移"咬过多次）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import {
  booksDb,
  highlightsDb,
  knowledgeCardsDb,
  methodologiesDb,
  getDatabase,
} from '../electron/database'
import { assertRealColumns } from '../electron/database/updatable-columns'

function seedWorld(): void {
  booksDb.create({ id: 'b1', title: '第一本书', author: '甲' })
  highlightsDb.create({ id: 'h1', book_id: 'b1', content: '第一条划线', note: '原笔记' })
  knowledgeCardsDb.create({
    id: 'k1',
    book_id: 'b1',
    type: 'concept',
    title: '一个概念',
    content: '正文',
    interpretation: '原解读',
  })
  methodologiesDb.create({ id: 'm1', book_id: 'b1', name: '一个方法', description: '原说明' })
}

function readTable(table: string, id: string): Record<string, unknown> {
  const rows = getDatabase().exec(`SELECT * FROM ${table} WHERE id = ?`, [id] as never[])
  expect(rows.length, `${table} 里找不到 ${id}`).toBe(1)
  const cols = rows[0].columns
  const vals = rows[0].values[0]
  return Object.fromEntries(cols.map((c, i) => [c, vals[i]]))
}

/** 四个被收口的 update 构造器：键名来自调用方，必须逐表判 */
const UPDATES: Array<{
  label: string
  table: string
  id: string
  okColumn: string
  okValue: unknown
  update: (id: string, record: Record<string, unknown>) => void
}> = [
  {
    label: 'books',
    table: 'books',
    id: 'b1',
    okColumn: 'author',
    okValue: '乙',
    update: (id, record) => booksDb.update(id, record),
  },
  {
    label: 'highlights',
    table: 'highlights',
    id: 'h1',
    okColumn: 'content',
    okValue: '改过的划线',
    update: (id, record) => highlightsDb.update(id, record),
  },
  {
    label: 'knowledge_cards',
    table: 'knowledge_cards',
    id: 'k1',
    okColumn: 'interpretation',
    okValue: '改过的解读',
    update: (id, record) => knowledgeCardsDb.update(id, record),
  },
  {
    label: 'methodologies',
    table: 'methodologies',
    id: 'm1',
    okColumn: 'description',
    okValue: '改过的说明',
    update: (id, record) => methodologiesDb.update(id, record),
  },
]

describe('拼进 SQL 的列名必须真是那张表的列', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    seedWorld()
  })

  afterEach(() => {
    teardownTestDatabase()
  })

  for (const c of UPDATES) {
    it(`${c.label}：合法列照常写入`, () => {
      c.update(c.id, { [c.okColumn]: c.okValue })
      expect(readTable(c.table, c.id)[c.okColumn]).toBe(c.okValue)
    })

    it(`${c.label}：键名里带 SQL 片段直接拒绝，且不写任何东西`, () => {
      // 原样拼进 SET 就成了 `SET content = 1, note = ?` —— 值走占位符挡不住这个
      expect(() =>
        c.update(c.id, { [`${c.okColumn} = 1, ${c.okColumn}`]: '改写' })
      ).toThrow()
      expect(readTable(c.table, c.id)[c.okColumn]).not.toBe('改写')
    })

    it(`${c.label}：库里没有的列名拒绝，混在里面的合法列也不写（整条不发）`, () => {
      const before = readTable(c.table, c.id)[c.okColumn]
      expect(() => c.update(c.id, { [c.okColumn]: '半条都别写', zz_no_such_column: 1 })).toThrow()
      expect(readTable(c.table, c.id)[c.okColumn]).toBe(before)
    })
  }

  it('knowledge_cards 的驼峰名仍然映射到真实列（收口不许把老映射弄断）', () => {
    knowledgeCardsDb.update('k1', { reviewCount: 3 })
    expect(readTable('knowledge_cards', 'k1').review_count).toBe(3)
  })

  it('id 仍然被排除在 SET 之外（它是 WHERE 条件，改主键等于换一行）', () => {
    highlightsDb.update('h1', { id: 'h2', content: '改名又改主键' })
    expect(readTable('highlights', 'h1').id).toBe('h1')
  })

  describe('assertRealColumns 本身', () => {
    it('放过真实列，拒绝非列名', () => {
      expect(assertRealColumns('highlights', ['content', 'note'])).toEqual(['content', 'note'])
      expect(() => assertRealColumns('highlights', ['color'])).toThrow(/color/)
    })

    it('表名不存在时判红，而不是静默放行（拼错表名等于没有守卫）', () => {
      expect(() => assertRealColumns('no_such_table', ['anything'])).toThrow()
    })

    it('空键清单什么都不做（不查库、不抛错）', () => {
      expect(assertRealColumns('highlights', [])).toEqual([])
    })
  })

  describe('源码扫描：不许再出现没判过的列名拼接', () => {
    /**
     * 两种写法：
     *  - `` `${k} = ?` `` —— 把变量当列名拼进 SET
     *  - `` (${cols.join(', ')}) `` —— 把变量列表当列名清单拼进 INSERT
     * 值占位符 `(${placeholders})` 不在其列（那是 `?` 的个数，不是标识符）。
     */
    const INTERPOLATES_IDENTIFIER = /\$\{[^{}]*\} = \?|\(\$\{[A-Za-z_][\w.]*\.join\(', '\)\)/

    /**
     * 允许不接守卫的两类（理由写在这儿，别只留文件名）：
     *  - 键名来自本文件的模块级常量清单
     *  - 键名由子类的 mapToRow 逐字段赋值，不接受调用方的键
     */
    const EXEMPT: Record<string, string> = {
      'cards.ts': 'CARD_UPDATABLE_COLUMNS 常量清单',
      'conversations.ts': 'UPDATABLE_COLUMNS 常量清单',
      'deleted-archive.ts': '自带 assertSafeIdentifier，且列名来自库里读出的行',
      'base-repository.ts': '键名来自子类的 mapToRow，逐字段赋值',
    }

    function sources(dir: string): string[] {
      return readdirSync(dir).flatMap((name) => {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : sources(p)
        return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [p] : []
      })
    }

    /** 返回这段源码里「把变量当列名拼进 SQL」的模板片段 */
    function interpolated(src: string): string[] {
      return [...src.matchAll(/`([^`]*)`/g)]
        .map((m) => m[1])
        .filter((body) => INTERPOLATES_IDENTIFIER.test(body))
        .map((body) => body.slice(0, 60))
    }

    const ROOT = join(__dirname, '..', 'electron')

    it('electron 下每个拼接列名的文件都过了守卫（或在带理由的豁免清单里）', () => {
      const bad = sources(ROOT).filter((f) => {
        const base = f.split(/[\\/]/).pop() as string
        if (EXEMPT[base]) return false
        const src = readFileSync(f, 'utf8')
        return interpolated(src).length > 0 && !/assertRealColumns/.test(src)
      })
      expect(bad.map((f) => f.replace(/\\/g, '/'))).toEqual([])
    })

    it('扫描本身要能抓出问题（拿收口前的写法验一遍，防止规则空转）', () => {
      const before = `
  update(id: string, data: Record<string, unknown>): void {
    const keys = Object.keys(data).filter(k => k !== 'id');
    const setClauses = keys.map(k => \`\${k} = ?\`).join(', ');
    getDatabase().run(\`UPDATE books SET \${setClauses} WHERE id = ?\`, [...keys.map(k => data[k]), id]);
  },
`
      expect(interpolated(before)).toEqual(['${k} = ?'])
      // 带驼峰映射的写法同样要抓到（knowledge-cards 原来就是这一种）
      expect(interpolated('  const s = keys.map(k => \`${fieldMap[k] ?? k} = ?\`);')).toEqual([
        '${fieldMap[k] ?? k} = ?',
      ])
      // 同一段接上守卫之后，扫描就闭嘴了（判据是"有没有过一遍列名校验"，不是"有没有拼接"）
      const after = `import { assertRealColumns } from './updatable-columns'\n${before}`
      expect(interpolated(after).length).toBe(1)
      expect(/assertRealColumns/.test(after)).toBe(true)
    })

    it('值占位符不算拼接标识符（否则这条守卫天天误报）', () => {
      const placeholders = `
    getDatabase().run('DELETE FROM books WHERE id IN (' + ids.map(() => '?').join(',') + ')', ids);
    getDatabase().run(\`SELECT * FROM books WHERE id = ?\`, [id]);
`
      expect(interpolated(placeholders)).toEqual([])
    })
  })
})
