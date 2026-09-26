// 数据库模块的每个导出方法都必须有人调用（2026-09-25）
//
// 为什么钉这一条：09-18 与 09-25 两次复扫都砍过"渲染层零调用的 IPC 通道"，
// 但通道背后的函数本体一直留在库里 —— 于是同样一批死码扫完通道还剩 32 个方法。
// 把"函数也得有消费者"变成判据，就不会再有第三次。
//
// 判据的边界（踩过的坑都在下面）：
//  - **别的 database 模块调用它也算生产调用**：`reviews.ts` 里的 `cardsDb.update(newCard)`
//    是真实调用点，只数 ipc / 渲染层会把它误判成死码。
//  - **点号两侧允许换行**：`cardsDb\n  .count()` 这种链式写法很常见。
//    但不能"把全部空白删掉再匹配" —— `return tokenUsageDb.count(` 会被粘成
//    `returntokenUsageDb.count(`，`\b` 词边界消失，在用的函数反被误判成零调用。
//  - **测试文件不算消费者**：这正是本批要治的形状 —— 为一个没人调的函数写一条测试，
//    得到的是一条永远绿的测试，不是一个人真的在用这条能力。
//  - 解构与别名会让静态匹配失效，所以单独钉一条"不许从 db 对象上解构方法"。

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = join(__dirname, '..')

function sources(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((name) => {
    const p = join(ROOT, dir, name)
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : sources(`${dir}/${name}`)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : []
  })
}

interface RepoModule {
  file: string
  alias: string
  methods: string[]
}

/** electron/database/*.ts 里形如 `export const cardsDb = { ... }` 的那批仓储对象 */
function repositoryModules(): RepoModule[] {
  return sources('electron/database')
    .map((file) => {
      const src = readFileSync(file, 'utf8')
      const alias = /export const (\w+Db) = \{/.exec(src)?.[1]
      if (!alias) return null
      const methods = [...src.matchAll(/^  (?:async )?([a-zA-Z_]\w*)\s*(?:<[^>]*>)?\s*\(/gm)].map((m) => m[1])
      return { file, alias, methods }
    })
    .filter((m): m is RepoModule => m !== null)
}

/** 除 `file` 之外的全部生产源码（含别的 database 模块；不含测试） */
function otherProduction(file: string): string[] {
  return [...sources('electron'), ...sources('src')].filter((f) => f !== file)
}

const callOf = (alias: string, method: string) =>
  new RegExp(`\\b${alias}\\s*\\.\\s*${method}\\s*\\(`)

/** 返回「没有任何生产调用方」的方法清单（module#method） */
function uncalledMethods(mods = repositoryModules()): string[] {
  const bad: string[] = []
  for (const { file, alias, methods } of mods) {
    const own = readFileSync(file, 'utf8')
    const others = otherProduction(file).map((f) => readFileSync(f, 'utf8'))
    for (const m of methods) {
      const internal = new RegExp(`this\\s*\\.\\s*${m}\\s*\\(`).test(own)
      const external = others.some((t) => callOf(alias, m).test(t))
      if (!internal && !external) bad.push(`${file.split(/[\\/]/).pop()}#${alias}.${m}`)
    }
  }
  return bad
}

describe('数据库模块的消费者', () => {
  it('扫描本身看得见东西（模块与方法都不是零条，否则这条守卫天天假绿）', () => {
    const mods = repositoryModules()
    expect(mods.length).toBeGreaterThanOrEqual(10)
    expect(mods.reduce((n, m) => n + m.methods.length, 0)).toBeGreaterThan(80)
  })

  it('每个导出的方法都有生产调用方（本模块 this. 或别的模块调用）', () => {
    expect(uncalledMethods()).toEqual([])
  })

  it('反证：判据不是空转（造一个没人调的方法必须报，两种调用形式都不许漏）', () => {
    const mods: RepoModule[] = [{ file: join(ROOT, 'electron/database/books.ts'), alias: 'booksDb', methods: ['getById', 'getOrphan'] }]
    expect(uncalledMethods(mods)).toEqual(['books.ts#booksDb.getOrphan'])
  })

  it('跨行链式调用算调用（把空白全删掉再匹配会把词边界吃掉，那是另一种错法）', () => {
    expect(callOf('booksDb', 'count').test('booksDb\n  .count()')).toBe(true)
    expect(callOf('booksDb', 'count').test('return booksDb.count()')).toBe(true)
    // 名字更长的同类方法不能被误判成"count 有人调"
    expect(callOf('booksDb', 'count').test('booksDb.countByBookId(x)')).toBe(false)
  })

  it('不许从仓储对象上解构方法（那样静态匹配就会漏掉真实调用点）', () => {
    const destructure = /\bconst\s*\{[^}]*\}\s*=\s*\w+Db\b/
    const hits = [...sources('electron'), ...sources('src')]
      .map((f) => ({ f, lines: readFileSync(f, 'utf8').split('\n').filter((l) => destructure.test(l)) }))
      .filter((x) => x.lines.length > 0)
    expect(hits.map((x) => `${x.f}:${x.lines[0].trim()}`)).toEqual([])
  })
})
