// 文档数字守卫（2026-09-25）
//
// 起因：一批"文档口径同步"做完之后，README / AGENTS 里仍然留着五处与代码不符的数字
// （同一份 README 里表数既有 17 又有 16、preload 写 547 行实际 520、测试徽标写 83 文件
// 实际 84、database 领域文件写 15 实际 16）。根因是这些数字全靠手工誊写。
//
// 与版本号同一类问题，所以用同一套办法：**能由仓库算出来的，就别让人抄**。
// 本文件先算真值，再从文档正文里把承诺值抽出来对账。
//
// 2026-10-04：AGENTS §十 变更记录整节搬进 `docs/agent-history.md` 之后，这里那层
// 按「## 十、」排除历史段落的过滤失去了截断点（`indexOf` 恒为 -1，退化成全文扫描）。
// 已改成显式扫全文 —— 那份历史档是 append-only 的、里面的数是当年实测，
// 由 `tests/doc-pointers.test.ts` 的「变更历史只许待在历史档」那一组管它的边界。

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'fs'
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

/** 渲染层单文件行数（相对仓库根，含 pages/ 与 components/） */
function realSourceLineCounts(): Map<string, number> {
  const out = new Map<string, number>()
  for (const file of walkSources(join('src', 'renderer', 'src'))) {
    if (/\.test\.tsx?$/.test(file)) continue
    out.set(
      file,
      readFileSync(join(ROOT, file), 'utf8').split('\n').length - 1,
    )
  }
  return out
}

function walkSources(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walkSources(rel))
    else if (/\.tsx?$/.test(entry.name)) out.push(rel)
  }
  return out
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

const PAGES_DIR = join('src', 'renderer', 'src', 'pages')

/** 顶层页面文件数（子目录里的是拆出去的部件，不算路由入口） */
export function realPageCount(): number {
  return readdirSync(join(ROOT, PAGES_DIR)).filter((f) => f.endsWith('.tsx')).length
}

/** App.tsx 里声明的路由数 */
export function realRouteCount(): number {
  const app = readFileSync(join(ROOT, PAGES_DIR, '..', 'App.tsx'), 'utf8')
  return (app.match(/<Route path=/g) ?? []).length
}

/** README 第三节那张功能表实际列了几个模块 */
export function realModuleCount(): number {
  const readme = read('README.md')
  const section = readme.split(/^## 三、/m)[1]?.split(/^## /m)[0] ?? ''
  return (section.match(/^\| \d+ \|/gm) ?? []).length
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
    // 这条与上一条是**同一个数**：一处写在架构说明、一处写在目录树注释里。
    // 2026-09-30 发现目录树那行是 144 而架构那行是 148 —— 上面的规则只锚第六节，
    // 目录树不在任何规则里，于是它可以一直漂着（静默失配比报错更糟）。
    where: 'README 目录树 · 通道常量数',
    file: 'README.md',
    pattern: /跨进程共享（类型 \+ (\d+) 条 IPC 通道常量/,
    actual: realChannelCount,
  },
  {
    where: 'README 第三节 · 功能模块数',
    file: 'README.md',
    pattern: /## 三、(\d+) 大功能模块/,
    actual: realModuleCount,
  },
  {
    where: 'README 第八节 · 页面文件数',
    file: 'README.md',
    pattern: /pages\/\s+# (\d+) 个页面文件/,
    actual: realPageCount,
  },
  {
    where: 'README 第八节 · 路由数',
    file: 'README.md',
    pattern: /pages\/\s+# \d+ 个页面文件 \/ (\d+) 条路由/,
    actual: realRouteCount,
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
    // CONTRIBUTING 的目录树与 README/AGENTS 是同一份事实的第三处抄写。
    // 2026-09-30 发现它停在 12 / 16（真实 13 / 17）—— 前两处有守卫、这处没有，
    // 于是它可以一直漂着。同一件事三处各写一遍，迟早各漂一次。
    where: 'CONTRIBUTING 目录树 · ipc',
    file: 'CONTRIBUTING.md',
    pattern: /ipc\/\s+# IPC handlers（按领域 (\d+) 文件/,
    actual: () => realDomainFileCount(IPC_DIR, ['index.ts', 'types.ts']),
  },
  {
    where: 'CONTRIBUTING 目录树 · database',
    file: 'CONTRIBUTING.md',
    pattern: /database\/\s+# sql\.js DB（按领域 (\d+) 文件/,
    actual: () => realDomainFileCount(DB_DIR, ['index.ts', 'schema.ts', 'connection.ts']),
  },
  {
    where: 'AGENTS 第二节 · tests 目录',
    file: 'AGENTS.md',
    pattern: /tests\/\s+# Vitest 单元测试（(\d+) 文件/,
    actual: realTestFileCount,
  },
  // 2026-10-18 补：宣传页（landing/index.html → gh-pages）也是抄来的数，且抄的是
  // 一个没人再看的旧值（885 用例 / 16 模块停在 9 月 16 日那次）。同一个病用同一套药。
  {
    where: '宣传页 hero · 功能模块数',
    file: 'landing/index.html',
    pattern: /五大核心创新 · (\d+) 大功能模块/,
    actual: realModuleCount,
  },
  {
    where: '宣传页 hero · 测试文件数',
    file: 'landing/index.html',
    pattern: /测试用例 · (\d+) 文件/,
    actual: realTestFileCount,
  },
]

/**
 * 抽出所有对不上的地方，两处口径：
 *   1) 锚点句式被人改掉同样算不一致 —— 静默失配比报错更糟
 *      （本项目已在覆盖率清单上被"静默空匹配"咬过一次）；
 *   2) **全文扫**，历史记录也不豁免。这份文件原来有一层 `bodyOf()`，
 *      按 `## 十、` 把 AGENTS 第十节那 30 万字符的变更记录排除在外
 *      （那里的用例数是**当年**的实测，不该按今天的真值判红）。
 *      2026-10-04 第十节整节搬进 `docs/agent-history.md`，那个截断点不存在了 ——
 *      旧写法会退化成「返回全文」，**判定范围悄悄变大却不报错**，
 *      正是同一类坑。历史档那边由 `tests/doc-pointers.test.ts` 的
 *      `历史档的数不许回到入口文档` 一条管。
 */
export function collectMismatches(files: Record<string, string>): Claim[] {
  const out: Claim[] = []
  for (const rule of RULES) {
    const m = (files[rule.file] ?? '').match(rule.pattern)
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

/** README 的「N 用例 / M 文件」里那个 N（宣传页必须抄同一个数） */
function readmeCaseCount(md: string): string | undefined {
  return md.match(/([\d,]+) 用例 \/ \d+ 文件/)?.[1]
}

/** 宣传页 hero 那条「N 用例」 */
function landingCaseCount(html: string): string | undefined {
  return html.match(
    /<div class="hero-stat-value">([\d,]+)<\/div>\s*<div class="hero-stat-label">测试用例/,
  )?.[1]
}

/** 宣传页引用的本地资源（排除外链与页内锚点）—— 少一个文件就是线上一个 404 */
function landingLocalRefs(html: string): string[] {
  return [...html.matchAll(/(?:src|href)="([^"#]+)"/g)]
    .map((m) => m[1])
    .filter((u) => !/^(https?:|mailto:|data:)/.test(u))
}

describe('文档里的结构数字与仓库真值对账', () => {
  const docs = {
    'README.md': read('README.md'),
    'AGENTS.md': read('AGENTS.md'),
    'CONTRIBUTING.md': read('CONTRIBUTING.md'),
    'landing/index.html': read(join('landing', 'index.html')),
  }

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

  it('CI 真的跑 test:cov，CLAUDE.md 就不许再写「未接入 CI」（2026-09-30 修的就是这句）', () => {
    const ci = read('.github/workflows/ci.yml')
    expect(ci, 'CI 工作流里没找到 npm run test:cov —— 阈值在 CI 上又成了装饰').toContain(
      'npm run test:cov',
    )
    // 这类"状态陈述"没有数字可对账，只能钉住"不许出现反面说法"
    const claude = read('CLAUDE.md')
    expect(claude, 'CLAUDE.md 又说覆盖率阈值未接入 CI 了').not.toMatch(/覆盖率[^。\n]*未接入\s*CI/)
  })

  it('AGENTS §9.1.1 的「>1000 行文件」清单 == 仓库实况（这份清单漏过 BookDetail）', () => {
    const real = [...realSourceLineCounts().entries()]
      .filter(([, n]) => n > 1000)
      .map(([p, n]) => [p.split(/[\\/]/).slice(-1)[0], n] as const)
      .sort((a, b) => b[1] - a[1])

    expect(real.length, '量不到 >1000 行的文件，锚点或扫描范围变了').toBeGreaterThan(5)

    // 文档表： | `pages/X.tsx` | 1632 |
    const rows = [...docs['AGENTS.md'].matchAll(/^\|\s*`pages\/[^`]+`\s*\|\s*(\d+)\s*\|$/gm)]
    const claimed = rows.map((m) => {
      // 文档里写的是 pages/settings/SettingsAbout.tsx（带子目录），
      // 实况那侧取的是文件名 —— 两边必须都归一到 basename 才比得起来。
      const path = /`pages\/([^`]+)`/.exec(m[0])![1]
      return [path.split('/').slice(-1)[0], Number(m[1])] as const
    })

    expect(
      claimed.map((c) => c[0]).sort(),
      '清单里的文件集合与仓库实况不一致（漏了一个，或写了已拆小的文件）',
    ).toEqual(real.map((r) => r[0]).sort())

    for (const [name, lines] of claimed) {
      const actual = real.find((r) => r[0] === name)![1]
      expect(lines, `AGENTS §9.1.1 里 ${name} 的行数与仓库实况不符`).toBe(actual)
    }
  })

  it('反证 · 清单漏掉一个文件时必须判红（BookDetail 1084 行曾被漏记十一天）', () => {
    const without = docs['AGENTS.md'].replace(/^\|\s*`pages\/BookDetail\.tsx`.*\n/m, '')
    const real = [...realSourceLineCounts().entries()].filter(([, n]) => n > 1000).length
    const rows = [...without.matchAll(/^\|\s*`pages\/[^`]+`\s*\|\s*(\d+)\s*\|$/gm)]
    expect(rows.length, '删掉 BookDetail 那一行后清单与实况不等，说明这条判据没牙').toBeLessThan(real)
  })

  it('同一份 README 里「N 用例 / M 文件」的 M 只有一个口径，且等于真值', () => {
    const counts = [...docs['README.md'].matchAll(/([\d,]+) 用例 \/ (\d+) 文件/g)].map((m) =>
      Number(m[2]),
    )
    expect(counts.length, '至少量到 4 处（锚点被改就量不到了）').toBeGreaterThan(3)
    expect(new Set(counts).size, 'README 内部出现了两个不同的测试文件数').toBe(1)
    expect(counts[0]).toBe(realTestFileCount())
  })

  it('同一份 README 里「通道数」只有一个口径（2026-09-30：目录树写 144、架构写 148）', () => {
    // 上面两条规则各自锚一个句式，只保证那两处对；这一条保证**全文再没有第三个数**
    const claims = [...docs['README.md'].matchAll(/(\d+) 条(?: IPC)? ?通道/g)].map((m) => Number(m[1]))
    expect(claims.length, '至少量到 2 处（锚点被改就量不到了）').toBeGreaterThan(1)
    expect(new Set(claims), 'README 内部出现了两个不同的通道数').toEqual(new Set([realChannelCount()]))
  })

  it('README 不再承诺"某个文件有多少行"（行数和版本号一样，抄一次漂一次）', () => {
    expect(/（\d+ 行/.test(docs['README.md']), '文件级行数又回来了').toBe(false)
  })

  it('宣传页的用例数与 README 是同一个数', () => {
    const fromReadme = readmeCaseCount(docs['README.md'])
    const fromLanding = landingCaseCount(docs['landing/index.html'])
    expect(fromLanding, '宣传页那条用例数没量到（锚点句式被改，规则会静默失效）').toBeTruthy()
    expect(fromLanding).toBe(fromReadme)
  })

  it('反证 · 宣传页用例数抄回旧值时必须判红', () => {
    const drifted = docs['landing/index.html'].replace(
      /(<div class="hero-stat-value">)[\d,]+(<\/div>)/,
      '$1885$2',
    )
    expect(landingCaseCount(drifted)).not.toBe(readmeCaseCount(docs['README.md']))
    expect(landingCaseCount(drifted), '反证没造出漂移，说明这条判据没牙').toBeTruthy()
  })

  it('宣传页引用的本地资源都在 landing/ 里（缺一个就是线上 404）', () => {
    const refs = landingLocalRefs(docs['landing/index.html'])
    expect(refs.length, '一条本地资源都没量到（锚点句式被改）').toBeGreaterThan(3)
    const missing = refs.filter((u) => !existsSync(join(ROOT, 'landing', u)))
    expect(missing, '宣传页引用了 landing/ 里不存在的文件').toEqual([])
  })

  it('反证 · 引用一个不存在的截图时必须报出来', () => {
    const drifted = docs['landing/index.html'].replace(
      'src="logo.svg"',
      'src="screenshots/screenshot-does-not-exist.png"',
    )
    const missing = landingLocalRefs(drifted).filter((u) => !existsSync(join(ROOT, 'landing', u)))
    expect(missing).toContain('screenshots/screenshot-does-not-exist.png')
  })
})

// ===== FEATURES.md / ROADMAP.md：把"敢背书的那一句"钉在仓库上（2026-10-19） =====
// 起因：README 长期写着「与 Anki 数据互通，卡片可互相导入导出」，而全仓零 `.apkg` 读写；
// `ipc-channels.ts` 还留着一条"这两条通道 renderer 零引用"的注释，指向的两条其实天天在被调。
// 新文档只是把话说对，这一组是让它**说不回去**：路由、点名的判据文件、被证伪的说法，全部现算。
describe('能力清单文档与仓库真值对账', () => {
  const features = read('FEATURES.md')
  const roadmap = read('ROADMAP.md')

  function realRoutes(): string[] {
    const app = readFileSync(join(ROOT, 'src/renderer/src/App.tsx'), 'utf8')
    return [...app.matchAll(/path="([^"]+)"/g)].map((m) => m[1]).sort()
  }

  function claimedRoutes(): string[] {
    const line = /路由对照[^\n]*\n(.+)\n/.exec(features)
    expect(line, '读不到 FEATURES 的「路由对照」那一行（句式被改，规则会静默失效）').toBeTruthy()
    const paths = [...line![1].matchAll(/`([^`]+)`/g)].map((m) => m[1])
    expect(paths.length, '只量到一条路由 ⇒ 取数形状不对（别把整行的反引号项当成一条）').toBeGreaterThan(15)
    return paths.sort()
  }

  function rendererSource(): string {
    const walk = (dir: string, out: string[] = []): string[] => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, e.name)
        if (e.isDirectory()) walk(p, out)
        else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.|__tests__/.test(e.name)) out.push(p)
      }
      return out
    }
    return walk(join(ROOT, 'src/renderer/src')).map((p) => readFileSync(p, 'utf8')).join('\n')
  }

  it('FEATURES 的路由对照 == App.tsx 里真注册的路由（多一条少一条都算说错）', () => {
    expect(claimedRoutes().length, '一条路由都没量到').toBeGreaterThan(15)
    expect(claimedRoutes(), '文档列的路由与 App.tsx 不一致').toEqual(realRoutes())
  })

  it('反证 · 文档多写一条不存在的路由时必须判红', () => {
    const drifted = claimedRoutes().concat('/does-not-exist')
    expect(drifted, '反证没被量出来 ⇒ 这条对账是瞎的').not.toEqual(realRoutes())
  })

  it('FEATURES 点名的判据文件全都存在（不许给不存在的测试背书）', () => {
    const named = [...features.matchAll(/`([a-z0-9][a-z0-9-]*\.test\.tsx?)`/g)].map((m) => m[1])
    expect(named.length, '一条判据文件都没量到（引用句式被改，规则会静默失效）').toBeGreaterThan(40)
    const missing = [...new Set(named)].filter(
      (n) => !existsSync(join(ROOT, 'tests', n)) && !existsSync(join(ROOT, 'src/renderer/src/__tests__', n)),
    )
    expect(missing, '文档点名的判据文件不存在').toEqual([])
  })

  it('反证 · 编一个不存在的测试文件名时必须报出来，正对照 · 真存在的不许报', () => {
    const fake = features.replace('`fsrs-engine.test.ts`', '`fsrs-engine-does-not-exist.test.ts`')
    const names = [...fake.matchAll(/`([a-z0-9][a-z0-9-]*\.test\.tsx?)`/g)].map((m) => m[1])
    expect(names).toContain('fsrs-engine-does-not-exist.test.ts')
    expect(existsSync(join(ROOT, 'tests', 'fsrs-engine-does-not-exist.test.ts'))).toBe(false)
    expect(existsSync(join(ROOT, 'tests', 'fsrs-engine.test.ts'))).toBe(true)
  })

  it('被证伪的说法不许回到任何一份文档（Anki 数据互通、卡片互导）', () => {
    const banned = [/Anki\s*数据互通/, /卡片可互相导入导出/, /与\s*Anki\s*互通/]
    const hits: string[] = []
    for (const [name, body] of [
      ['README.md', read('README.md')],
      ['FEATURES.md', features],
      ['ROADMAP.md', roadmap],
    ] as const) {
      for (const re of banned) if (re.test(body)) hits.push(`${name} 命中 ${re}`)
    }
    expect(hits, JSON.stringify(hits)).toEqual([])
    // 正对照：改正后留下的那句"只有生词本导出 TSV"必须还在，否则说明是被整段删掉而不是改对
    expect(read('README.md')).toContain('只有生词本能导出')
    expect(features).toContain('Anki 认得的 TSV')
  })

  // 代码里还有两处注释在说同样的假话。这两个文件此刻在另一路会话手里，我不能替他们交工，
  // 所以按色值那一族的规矩做成**只许缩短的例外表**：注释还在 ⇒ ROADMAP 必须有对应登记（不许悄悄摘掉登记）；
  // 注释被收了 ⇒ 例外表必须同步删掉这一行，否则判红（防止"收了忘了登记"变成永久的假豁免）。
  const PENDING_CODE_COMMENTS: Array<{ file: string; re: RegExp }> = [
    { file: 'electron/fsrs-engine.ts', re: /Anki\s*数据互通/ },
    { file: 'src/shared/ipc-channels.ts', re: /renderer\s*中零引用/ },
  ]

  it('两处待发注释被例外表钉住：还在就要有登记，收了就必须销账', () => {
    const rows: string[] = []
    for (const p of PENDING_CODE_COMMENTS) {
      const stillFalse = p.re.test(readFileSync(join(ROOT, p.file), 'utf8'))
      const registered = roadmap.includes('`' + p.file + '`')
      if (stillFalse && !registered) rows.push(`${p.file} 假注释仍在，ROADMAP 档 1 却没有登记`)
      if (!stillFalse && registered) rows.push(`${p.file} 假注释已收，ROADMAP 的登记与本例外表要一起删`)
    }
    expect(rows, JSON.stringify(rows)).toEqual([])
    // 反证 · 登记被摘掉时必须判红（把 file 从 ROADMAP 文本里抹掉，就是"悄悄销账"那个形状）
    const unregistered = roadmap.replace('`electron/fsrs-engine.ts`', '某文件')
    expect(unregistered.includes('`electron/fsrs-engine.ts`')).toBe(false)
    // 正对照 · 例外表里不许藏着第三个文件（每张豁免都得有名字）
    expect(PENDING_CODE_COMMENTS.length).toBe(2)
  })

  // 通道这一族**不许用"界面源码里搜不到通道字符串"来判死** —— `cards:getDue` 就是这么被冤枉的：
  // 界面写的是 `window.electronAPI.card.getDue(50)`，通道名只出现在 preload 里。
  // 判据因此走两跳：preload 有没有接（载体）⇒ 接了的话界面有没有真引用那个转发名。
  type Channel = { literal: string; constPath: string; uiName: string | null; why: string }

  /** 纯判据，反证只喂字符串、绝不改仓库文件 */
  function isWired(ch: Channel, preloadSrc: string, rendererSrc: string): boolean {
    if (!preloadSrc.includes(`IPC_CHANNELS.${ch.constPath}`)) return false
    return ch.uiName !== null && rendererSrc.includes(ch.uiName)
  }

  const DEAD_CHANNELS: Channel[] = [
    {
      literal: 'books:search',
      constPath: 'BOOKS.SEARCH',
      uiName: 'electronAPI.book.search',
      why: 'preload 暴露成 book.search，渲染层一次没调（全局搜索走的是 search:global）',
    },
    { literal: 'dailyStats:incrementBooks', constPath: 'DAILY_STATS.INCREMENT_BOOKS', uiName: null, why: 'preload 根本没接 ⇒ 界面跨不过这条边界' },
    { literal: 'dailyStats:incrementHighlights', constPath: 'DAILY_STATS.INCREMENT_HIGHLIGHTS', uiName: null, why: 'preload 根本没接' },
    { literal: 'dailyStats:incrementCards', constPath: 'DAILY_STATS.INCREMENT_CARDS', uiName: null, why: 'preload 根本没接' },
    { literal: 'weread:fetchAllContentBatch', constPath: 'WEREAD.FETCH_ALL_CONTENT_BATCH', uiName: null, why: 'preload 根本没接' },
    { literal: 'menu:about', constPath: 'MENU.ABOUT', uiName: null, why: '主进程 send 了，preload 里没有对应的监听' },
  ]

  // 正对照：同一条尺必须把"天天在被调"的那条判成活的，否则上面那批"没接"是空转
  const LIVE_CONTROLS: Channel[] = [
    { literal: 'cards:getDue', constPath: 'CARDS.GET_DUE', uiName: 'electronAPI.card.getDue', why: '首页待复习' },
    { literal: 'cards:getDueWithContent', constPath: 'CARDS.GET_DUE_WITH_CONTENT', uiName: 'electronAPI.card.getDueWithContent', why: '复习页 / reviewStore' },
  ]

  it('文档说"零调用"的每条通道，各自的载体判据都还成立；接上了就要来改文档', () => {
    const preload = readFileSync(join(ROOT, 'electron/preload.ts'), 'utf8')
    const src = rendererSource()
    const wired = DEAD_CHANNELS.filter((d) => isWired(d, preload, src))
    expect(wired, `这些通道已被接上：${wired.map((d) => d.literal).join(', ')} —— FEATURES §三 与 ROADMAP 档 1 的"6 条"要同步改`).toEqual([])
    const claimed = Number(/渲染层真调用 \*\*(\d+)\*\* 条/.exec(features)![1])
    expect(realChannelCount() - claimed, '声明数与"真调用数"之差必须等于文档列的零调用条数').toBe(DEAD_CHANNELS.length)
  })

  it('正对照 · 同一把尺必须把 preload 转发的活通道判成活的（否则负向断言是永真）', () => {
    const preload = readFileSync(join(ROOT, 'electron/preload.ts'), 'utf8')
    const src = rendererSource()
    const missed = LIVE_CONTROLS.filter((c) => !isWired(c, preload, src))
    expect(missed, `这些通道确实在用却被判成死：${missed.map((c) => c.literal).join(', ')}`).toEqual([])
    // 顺带钉住"为什么旧写法会冤枉它们"：通道字符串本来就不进渲染层源码
    expect(src).not.toContain('cards:getDue')
  })

  it('反证 · 喂"preload 接了 + 界面也调了"的假文本，那条必须被这把尺认成活的', () => {
    const fakePreload = 'x: () => invoke(IPC_CHANNELS.DAILY_STATS.INCREMENT_BOOKS)'
    const ch = DEAD_CHANNELS[1]
    expect(isWired(ch, '', '')).toBe(false)
    expect(isWired(ch, fakePreload, '')).toBe(false) // 光接上、界面没点 ⇒ 仍算零调用
    expect(isWired(ch, fakePreload, 'electronAPI.dailyStats.incrementBooks()')).toBe(false) // uiName 是 null ⇒ 需先补 uiName
    const withName: Channel = { ...ch, uiName: 'electronAPI.dailyStats.incrementBooks' }
    expect(isWired(withName, fakePreload, 'window.electronAPI.dailyStats.incrementBooks()')).toBe(true)
  })
})
