// 文档数字守卫（2026-09-25）
//
// 起因：一批"文档口径同步"做完之后，README / AGENTS 里仍然留着五处与代码不符的数字
// （同一份 README 里表数既有 17 又有 16、preload 写 547 行实际 520、测试徽标写 83 文件
// 实际 84、database 领域文件写 15 实际 16）。根因是这些数字全靠手工誊写。
//
// 与版本号同一类问题，所以用同一套办法：**能由仓库算出来的，就别让人抄**。
// 本文件先算真值，再从文档正文里把承诺值抽出来对账。
//
// 只扫正文：AGENTS 第十节（§十 变更记录）那些行是 append-only 的历史，
// 当年那个数是当年实测的，不许改、也不许拿今天的真值判它红。

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'
import { BACKUP_TABLES, EXCLUDED_TABLES } from '../src/shared/backup'
import { getDatabase } from '../electron/database'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'

const ROOT = join(__dirname, '..')

/**
 * 徽标里的中文与空格是 URL 编码的（`tests-1279%20%E7%94%A8%E4%BE%8B...`），
 * 不解码就读不到那一处的数字。只解码 shields.io 那一段 —— 整份文件 decodeURIComponent
 * 会因为正文里出现的裸 `%`（百分比、`50%`）直接抛 URI malformed。
 */
function read(p: string): string {
  return readFileSync(join(ROOT, p), 'utf8').replace(
    /https:\/\/img\.shields\.io\/badge\/[^\s)]+/g,
    (url) => {
      try {
        return decodeURIComponent(url)
      } catch {
        return url
      }
    },
  )
}

// ===== 真值：全部由仓库自己算 =====

/**
 * 库里真正建出来的表，读 `sqlite_master`。
 * 不数源码里的 `CREATE TABLE` —— `cards` 是迁移里 DROP + RENAME 出来的，
 * 源码正则数不到它（本测试第一版就少数了一张）。
 */
export function realTableNames(): string[] {
  const rows = getDatabase().exec(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  )
  return (rows[0]?.values ?? []).map((r) => String((r as unknown[])[0]))
}

function realTableCount(): number {
  return realTableNames().length
}

/** 声明表里去重后的通道字面量 */
export function realChannelCount(): number {
  const values = new Set<string>()
  for (const group of Object.values(IPC_CHANNELS as unknown as Record<string, unknown>)) {
    for (const v of Object.values(group as Record<string, string>)) values.add(v)
  }
  return values.size
}

/** 某个目录下的 .ts 文件数（可排除指定文件名） */
export function realDomainFileCount(dir: string, exclude: string[] = []): number {
  return readdirSync(join(ROOT, dir)).filter((f) => f.endsWith('.ts') && !exclude.includes(f)).length
}

function walkTests(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkTests(rel))
    else if (/\.test\.tsx?$/.test(entry.name)) out.push(rel)
  }
  return out
}

/** vitest 会收集到的测试文件数：`tests/` 与渲染层就近的 `__tests__/` 都算 */
export function realTestFileCount(): number {
  return walkTests('tests').length + walkTests(join('src', 'renderer')).length
}

/**
 * `electron/` + `src/` 下源码的总行数（.ts / .tsx，不含 .d.ts）。
 * 文档里那句"约 N 万行"就是按这个口径算的 —— 行数每次改代码都漂，所以对外只承诺到万分位。
 */
export function realSourceLineCount(): number {
  const skip = new Set(['node_modules', 'dist', 'release', 'installer', 'installer-test', 'coverage'])
  let lines = 0
  const walk = (dir: string): void => {
    for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!skip.has(entry.name) && !entry.name.startsWith('.')) walk(join(dir, entry.name))
        continue
      }
      if (!/\.(ts|tsx)$/.test(entry.name) || entry.name.endsWith('.d.ts')) continue
      lines += readFileSync(join(ROOT, dir, entry.name), 'utf8').split('\n').length - 1
    }
  }
  walk('electron')
  walk('src')
  return lines
}

// ===== 承诺值：从文档正文里抽 =====

export interface Claim {
  where: string
  claimed: number
  actual: number
}

interface Rule {
  where: string
  file: string
  /** 捕获组 1 必须是承诺的那个数字 */
  pattern: RegExp
  actual: () => number
  /** 允许的误差（对外只承诺"约 N 万行"这种量级的条目才用） */
  tolerance?: number
  /** 文档写的是量级词（"5.7 万"），真值是个位数 —— 乘回去再比 */
  multiplier?: number
}

const IPC_DIR = join('electron', 'ipc')
const DB_DIR = join('electron', 'database')

export const RULES: Rule[] = [
  {
    where: 'README 概览表 · 代码规模',
    file: 'README.md',
    pattern: /约 ([\d.]+) 万行 TypeScript/,
    actual: realSourceLineCount,
    multiplier: 10000,
    tolerance: 1500,
  },
  {
    where: 'README 概览表 · 存储（表数）',
    file: 'README.md',
    pattern: /sql\.js \(SQLite WASM\) · (\d+) 张表/,
    actual: realTableCount,
  },
  {
    where: 'README 第六节 · 五层架构（表数）',
    file: 'README.md',
    pattern: /Data（sql\.js (\d+) 张表/,
    actual: realTableCount,
  },
  {
    where: 'README 第六节 · 五层架构的通道数',
    file: 'README.md',
    pattern: /共 \*\*(\d+) 条通道\*\*/,
    actual: realChannelCount,
  },
  {
    where: 'README 第八节 · ipc 目录',
    file: 'README.md',
    pattern: /ipc\/\s+# IPC handlers（按领域 (\d+) 文件/,
    actual: () => realDomainFileCount(IPC_DIR, ['index.ts', 'types.ts']),
  },
  {
    where: 'README 第八节 · database 目录',
    file: 'README.md',
    pattern: /database\/\s+# sql\.js DB（按领域 (\d+) 文件/,
    actual: () => realDomainFileCount(DB_DIR, ['index.ts', 'schema.ts', 'connection.ts']),
  },
  {
    where: 'AGENTS 第二节 · ipc 目录',
    file: 'AGENTS.md',
    pattern: /ipc\/\s+# IPC handlers（按领域 (\d+) 文件/,
    actual: () => realDomainFileCount(IPC_DIR, ['index.ts', 'types.ts']),
  },
  {
    where: 'AGENTS 第二节 · database 目录',
    file: 'AGENTS.md',
    pattern: /database\/\s+# sql\.js DB（按领域 (\d+) 文件/,
    actual: () => realDomainFileCount(DB_DIR, ['index.ts', 'schema.ts', 'connection.ts']),
  },
  {
    where: 'AGENTS 第二节 · tests 目录',
    file: 'AGENTS.md',
    pattern: /tests\/\s+# Vitest 单元测试（(\d+) 文件/,
    actual: realTestFileCount,
  },
]

/** 第十节之前才算正文（之后的历史记录不许改） */
function bodyOf(text: string): string {
  const cut = text.indexOf('## 十、')
  return cut === -1 ? text : text.slice(0, cut)
}

/**
 * 抽出所有对不上的地方。锚点句式被人改掉同样算不一致 ——
 * 静默失配比报错更糟（本项目已在覆盖率清单上被"静默空匹配"咬过一次）。
 */
export function collectMismatches(files: Record<string, string>): Claim[] {
  const out: Claim[] = []
  for (const rule of RULES) {
    const m = bodyOf(files[rule.file] ?? '').match(rule.pattern)
    const actual = rule.actual()
    if (!m) {
      out.push({ where: `${rule.where}（锚点句式没找到）`, claimed: -1, actual })
      continue
    }
    const claimed = Number(m[1]) * (rule.multiplier ?? 1)
    if (Math.abs(claimed - actual) > (rule.tolerance ?? 0)) {
      out.push({ where: rule.where, claimed, actual })
    }
  }
  return out
}

describe('文档里的结构数字与仓库真值对账', () => {
  const docs = { 'README.md': read('README.md'), 'AGENTS.md': read('AGENTS.md') }

  // 表数读的是真实建出来的库（生产的 applySchemaAndMigrations），不是源码里的字符串
  beforeAll(async () => {
    await setupTestDatabase()
  })
  afterAll(() => {
    teardownTestDatabase()
  })

  it('README 与 AGENTS 的表数 / 通道数 / 目录文件数都不是抄错的', () => {
    expect(collectMismatches(docs), '文档数字与仓库实算不一致').toEqual([])
  })

  it('反证 · 表数被抄成 16 时必须两处都判红', () => {
    const drifted = { ...docs, 'README.md': docs['README.md'].replace(/(\d+) 张表/g, '16 张表') }
    const found = collectMismatches(drifted).filter((c) => c.where.includes('（表数）'))
    expect(found.map((c) => c.where)).toEqual([
      'README 概览表 · 存储（表数）',
      'README 第六节 · 五层架构（表数）',
    ])
    for (const c of found) expect(c.claimed).toBe(16)
  })

  it('反证 · 锚点句式被改掉时也判红（否则规则会静默失效）', () => {
    const readmeRules = RULES.filter((r) => r.file === 'README.md').length
    const found = collectMismatches({ ...docs, 'README.md': '' })
    expect(found.filter((c) => c.where.startsWith('README'))).toHaveLength(readmeRules)
  })

  it('备份清单加排除清单 == schema 的表数（两份口径不许各自漂移）', () => {
    expect(BACKUP_TABLES.length + Object.keys(EXCLUDED_TABLES).length).toBe(realTableCount())
  })

  it('同一份 README 里「N 用例 / M 文件」的 M 只有一个口径，且等于真值', () => {
    const counts = [...docs['README.md'].matchAll(/([\d,]+) 用例 \/ (\d+) 文件/g)].map((m) =>
      Number(m[2]),
    )
    expect(counts.length, '至少量到 4 处（锚点被改就量不到了）').toBeGreaterThan(3)
    expect(new Set(counts).size, 'README 内部出现了两个不同的测试文件数').toBe(1)
    expect(counts[0]).toBe(realTestFileCount())
  })

  it('README 不再承诺"某个文件有多少行"（行数和版本号一样，抄一次漂一次）', () => {
    expect(/（\d+ 行/.test(docs['README.md']), '文件级行数又回来了').toBe(false)
  })
})
