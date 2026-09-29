// 覆盖率清单对账（2026-09-26）
//
// Issue #9 把覆盖率阈值接成了真门禁，留下一笔欠账：一批源文件"有测试 import、却没进
// `vitest.config.ts` 的 coverage.include"。当时的说法是"重逻辑，列进去会拉低聚合"，
// 但**没人量过到底多少、低到什么程度** —— 一笔没有数字的欠账，下一位只会当它不存在。
//
// 这批把话量成数：33 个候选全部接进清单跑一遍（数字见下），三个维度都过阈值的进了清单，
// 过不了的逐条登记在 DEBT 里。本文件守三件事：
//  1. 清单里每条都必须匹配到真实文件 —— 上一批抓到过 `electron/database.ts` 这种
//     "文件早拆走了、清单还白写着"的静默空匹配，vitest 对不匹配的 glob 不报错。
//  2. 被测试 import、既没进清单又没登记欠账的文件 ⇒ 判红（欠账不许悄悄长大，也不许被忘掉）。
//  3. 欠账条目不许空转 —— 已补进清单的文件必须从 DEBT 删掉；声称"只有类型/常量"的文件
//     必须真的没有可执行实现（否则就是在给分母耍赖）。

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'fs'
import { dirname, join, relative, resolve } from 'path'

const ROOT = process.cwd()

/**
 * 欠账登记：文件 → 2026-09-26 实测的 lines / branches / funcs（不是估计，是量出来的）。
 *
 * 2026-09-29 这张表清零（登记时 22 条，逐批按"先读代码找真缺陷再补判据"还完）。
 * 空表不等于这条守卫失去意义：它的牙齿在"被测试 import、既没进清单又没登记欠账 ⇒ 判红"
 * 那条上（与表长不相关），下面配了一条反证把它咬得起来的样子钉住。
 * 以后再登记欠账，必须带实测三线，不许写"看起来还行"。
 */
const DEBT: Record<string, string> = {}

/** 结构性排除：coverage.exclude 规则本就不统计的文件（不是欠账，也不该统计） */
const EXCLUDED_BY_RULE: Record<string, string> = {
  'electron/database/index.ts': '只做 re-export 的 barrel；coverage.exclude 里的 **/index.ts 本就不统计转发文件，真实现在 database/*.ts 各自计量',
}

/** 不该进清单的文件与理由（不是欠账，是判据上就不该统计） */
const NOT_LISTED: Record<string, string> = {
  'src/shared/types.ts': '只有 interface / type 声明，没有分支可盖',
  'src/shared/ipc-channels.ts': '只有通道名常量',
  'src/shared/external-links.ts': '只有链接与版本常量（扫描用例已断它没有 export function）',
  'electron/agent/context-builder.ts': '只有 ContextBuilder 等接口声明（实测 0 条可执行语句）',
}

function configText(): string {
  return readFileSync('vitest.config.ts', 'utf8')
}

/** 抠出 coverage.include 的字符串条目（coverage 块里唯一的一个 include 数组） */
function coverageInclude(): string[] {
  const text = configText()
  const cov = text.slice(text.indexOf('coverage: {'))
  const start = cov.indexOf('include: [')
  expect(start, 'vitest.config.ts 里找不到 coverage.include').toBeGreaterThan(-1)
  const body = cov.slice(start, cov.indexOf('],', start))
  return body
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith("'"))
    .map((line) => line.slice(1, line.indexOf("'", 1)))
    .filter((s) => !s.startsWith('tests/'))
}

/** 支持清单里唯一的 glob 形态：`目录/*.ts`；其余按精确路径（这里用字符串切，不用正则） */
function matches(entry: string, file: string): boolean {
  const suffix = '/*.ts'
  if (entry.endsWith(suffix)) {
    const dir = entry.slice(0, entry.length - suffix.length)
    if (!file.startsWith(`${dir}/`)) return false
    const rest = file.slice(dir.length + 1)
    // glob 只匹配一层，且不统计 index.ts（与 vitest 的 exclude 规则一致）
    return !rest.includes('/') && rest.endsWith('.ts') && !rest.endsWith('index.ts')
  }
  return entry === file
}

function inIncludeList(file: string): boolean {
  return coverageInclude().some((entry) => matches(entry, file))
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      if (e.name !== 'node_modules' && !e.name.startsWith('.')) walk(p, out)
      continue
    }
    out.push(relative(ROOT, p).replace(/\\/g, '/'))
  }
  return out
}

const TEST_FILES = [
  ...walk('tests').filter((f) => f.endsWith('.test.ts')),
  ...walk('src').filter((f) => /\.test\.(ts|tsx)$/.test(f)),
]

const IMPORT_RE =
  /from\s+['"]((?:\.\.?\/)[^'"]+)['"]|import\(\s*['"]((?:\.\.?\/)[^'"]+)['"]\s*\)|require\(\s*['"]((?:\.\.?\/)[^'"]+)['"]\s*\)/g

/** 测试文件 import 到的真实源文件（相对仓库根、正斜杠） */
function importedSources(): Set<string> {
  const found = new Set<string>()
  for (const tf of TEST_FILES) {
    for (const m of readFileSync(join(ROOT, tf), 'utf8').matchAll(IMPORT_RE)) {
      const spec = m[1] || m[2] || m[3]
      if (!spec) continue
      const base = resolve(dirname(join(ROOT, tf)), spec)
      for (const ext of ['', '.ts', '.tsx', '/index.ts']) {
        const cand = relative(ROOT, base + ext).replace(/\\/g, '/')
        if (!existsSync(join(ROOT, cand))) continue
        if (statSync(join(ROOT, cand)).isDirectory()) continue
        if (/\.(test\.ts|test\.tsx|d\.ts)$/.test(cand)) continue
        if (cand.startsWith('tests/')) continue // 测试脚手架自己不算被测源文件
        found.add(cand)
        break
      }
    }
  }
  return found
}

describe('覆盖率清单与仓库对账', () => {
  it('coverage.include 每条都必须匹配到真实文件（静默空匹配就是白写）', () => {
    const entries = coverageInclude()
    const sourceFiles = new Set([...walk('electron'), ...walk('src')])
    const dead = entries.filter((e) => {
      if (e.includes('*')) return ![...sourceFiles].some((f) => matches(e, f))
      return !sourceFiles.has(e)
    })
    expect(dead, `清单里有不存在的路径：${dead.join(', ')}`).toEqual([])
  })

  it('清单确实覆盖了那批有测试的文件（条目数掉下来说明清单在被悄悄删）', () => {
    // 2026-09-26 实测：源文件条目 53 条，展开 glob 后 70 个文件
    const entries = coverageInclude()
    expect(entries.length).toBeGreaterThanOrEqual(50)
    const files = [...walk('electron'), ...walk('src')]
    const expanded = entries.flatMap((e) =>
      e.includes('*') ? files.filter((f) => matches(e, f)) : [e]
    )
    expect(new Set(expanded).size).toBeGreaterThanOrEqual(65)
  })

  it('被测试 import、既没进清单也没登记欠账的文件 ⇒ 判红', () => {
    const unlisted = [...importedSources()].filter(
      (f) =>
        !inIncludeList(f) && !(f in DEBT) && !(f in NOT_LISTED) && !(f in EXCLUDED_BY_RULE)
    )
    expect(
      unlisted.sort(),
      `这些文件有测试却没进覆盖率清单，也没登记欠账：${unlisted.join(', ')}`
    ).toEqual([])
  })

  it('欠账条目不许空转：登记了的文件必须真的还没进清单', () => {
    const idle = Object.keys(DEBT).filter((f) => inIncludeList(f))
    expect(
      idle,
      `这些文件已进覆盖率清单，必须从 DEBT 里删掉（补了测试就顺手销账）：${idle.join(', ')}`
    ).toEqual([])
  })

  it('欠账、不列与被排除的文件都必须真实存在（路径写错 = 这条判据已经哑了）', () => {
    for (const f of [
      ...Object.keys(DEBT),
      ...Object.keys(NOT_LISTED),
      ...Object.keys(EXCLUDED_BY_RULE),
    ]) {
      expect(existsSync(join(ROOT, f)), `登记的文件不存在：${f}`).toBe(true)
    }
  })

  it('「只有类型/常量所以不列」必须是真的：这些文件里不许有可执行实现', () => {
    for (const [file, reason] of Object.entries(NOT_LISTED)) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      const impl = [...src.matchAll(/^export\s+(?:async\s+)?(?:function|class|const\s+\w+\s*(?::[^=]+)?=)/gm)]
        .map((m) => m[0])
        .filter((line) => /function|class|=>/.test(line))
      // 允许 `export const X = { ... }` 这类常量对象；判红的是函数、类与箭头函数实现
      expect(
        impl,
        `${file} 声称"${reason}"，但里面有可执行实现：${impl.join(' | ')} —— 它该进清单或欠账表`
      ).toEqual([])
    }
  })

  it('判据自己得看得见东西（路径写错时上面几条会全部空转）', () => {
    // 实测下限跟着仓库规模走：清单条目数与"被测试 import 的源文件数"掉下来说明扫描瞎了。
    // 2026-09-29：欠账表已清零（登记时 22 条，逐批还完），所以下面不再断"表至少有几条"——
    // 一条 `≥0` 的断言是永远绿的空话，这张表的牙齿改由下面那条反证钉住。
    expect(TEST_FILES.length).toBeGreaterThanOrEqual(85)
    expect(importedSources().size).toBeGreaterThanOrEqual(75)
    expect(DEBT, '欠账表已清零；再往里塞条目必须带 2026-09-26 那种实测三线').toEqual({})
  })

  it('反证：一张表挡不住时"有测试却没进清单也没登记欠账"必须报出来（表空了这条也得有牙）', () => {
    // `electron/database/index.ts` 真实存在、被测试 import、且**不在**清单里，
    // 它今天靠 EXCLUDED_BY_RULE 免掉。把那张免罪表摘掉再跑同一个过滤式，
    // 它必须立刻被报出来 —— 否则就说明过滤器本身瞎了，而不是账真还完了。
    const file = 'electron/database/index.ts'
    expect(importedSources().has(file), '前提：这个文件确实被测试 import 到').toBe(true)
    expect(inIncludeList(file), '前提：这个文件确实不在清单里').toBe(false)
    expect(file in EXCLUDED_BY_RULE, '前提：它确实是被 EXCLUDED_BY_RULE 免掉的').toBe(true)

    const unlisted = [...importedSources()].filter(
      (f) => !inIncludeList(f) && !(f in DEBT) && !(f in NOT_LISTED),
    )
    expect(unlisted, '摘掉 EXCLUDED_BY_RULE 后必须把这个文件报出来').toContain(file)
  })

  it('反证：把已进清单的文件留在欠账里必须判红（欠账不许空转）', () => {
    // 与上面那条判据同一个式子，只是把一张"确实已在清单里"的文件塞进欠账表：
    // 必须当场报出来，否则"补了测试就顺手销账"这条规矩没人守。
    const already = coverageInclude().filter((e) => !e.includes('*'))
    expect(already.length, '前提：清单里有精确路径条目可拿来做反证').toBeGreaterThan(0)
    const probe = already[0]
    expect(inIncludeList(probe), '前提：挑出来的这条确实在清单里').toBe(true)
    const idle = Object.keys({ ...DEBT, [probe]: '反证用' }).filter((f) => inIncludeList(f))
    expect(idle, '已进清单的文件留在欠账里必须被报出来').toContain(probe)
  })
})
