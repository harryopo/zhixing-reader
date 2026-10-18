/**
 * 上下文构建器名单的三处口径对账（2026-10-18）
 *
 * 起因：09-24 那批给主管线注册了 article 与 vocabulary 两个构建器，但渲染层两张手抄表
 * 都没跟着改 —— 设置页的「上下文构建器」卡片仍写 5 类（注释还自称"与 orchestrator 注册
 * 顺序一致"），「调取知识库」面板的图标表也少两路，宣传页照着写「5 维上下文构建」。
 * 一处注册、三处漏抄，且单测一条不报。
 *
 * 判据形状沿用本项目既有做法：真值取 `orchestrator.ts` 的 registerBuilder 与各 builder
 * 自己的 priority，抄件（设置页表、图标表、宣传页数字）各配一个**纯收集器**返回问题清单，
 * 真件要求清单为空，再各造一次人为漏抄证明清单真的会长条目（否则等于没闸）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const BUILDERS_DIR = join(ROOT, 'electron', 'agent', 'builders')

interface RegisteredBuilder {
  /** builder 类自己的 `name` 字段 —— 运行时进 events、进面板的那串标识 */
  name: string
  priority: number
}

/** 主管线真正注册出来的构建器，按 context-manager 的排序（priority 降序） */
function registeredBuilders(): RegisteredBuilder[] {
  const orchestrator = readFileSync(join(ROOT, 'electron', 'agent', 'orchestrator.ts'), 'utf8')
  const classNames = [...orchestrator.matchAll(/registerBuilder\(new (\w+)\(\)\)/g)].map((m) => m[1])
  if (classNames.length < 4) {
    throw new Error(`一条 registerBuilder 都没量到（锚点句式被改，规则会静默失效）：${classNames.length}`)
  }
  const bodies = readdirSync(BUILDERS_DIR).map(
    (f) => [f, readFileSync(join(BUILDERS_DIR, f), 'utf8')] as const,
  )
  return classNames
    .map((className) => {
      const found = bodies.find(([, body]) => new RegExp(`class ${className}\\b`).test(body))
      if (!found) throw new Error(`orchestrator 注册了 ${className}，但 builders/ 里找不到实现`)
      const name = /name\s*=\s*'([^']+)'/.exec(found[1])?.[1]
      const priority = Number(/priority\s*=\s*(\d+)/.exec(found[1])?.[1])
      if (!name || !Number.isFinite(priority)) {
        throw new Error(`${className} 缺 name 或数字 priority（判据锚点已失效）`)
      }
      return { name, priority }
    })
    .sort((a, b) => b.priority - a.priority)
}

/** 设置页那张手抄表：no / name / 「优先级 N」 */
function settingsPageRows(): Array<{ no: number; name: string; label: number }> {
  const src = readFileSync(
    join(ROOT, 'src', 'renderer', 'src', 'pages', 'settings', 'SettingsAgent.tsx'),
    'utf8',
  )
  const block = /const DEFAULT_BUILDERS[^=]*=\s*\[([\s\S]*?)\n\]/.exec(src)?.[1] ?? ''
  const rows = [
    ...block.matchAll(/\{\s*no:\s*(\d+),\s*name:\s*'([^']+)',[\s\S]*?priority:\s*'优先级\s*(\d+)/g),
  ].map((m) => ({ no: Number(m[1]), name: m[2], label: Number(m[3]) }))
  if (rows.length < 4) {
    throw new Error(`设置页构建器表只量到 ${rows.length} 行（锚点句式被改）`)
  }
  return rows
}

/** 「调取知识库」面板的图标表键名 */
function retrievalPanelIconKeys(): string[] {
  const src = readFileSync(
    join(ROOT, 'src', 'renderer', 'src', 'components', 'chat', 'RetrievalPanel.tsx'),
    'utf8',
  )
  const block = /const SOURCE_ICONS[^=]*=\s*\{([\s\S]*?)\n\}/.exec(src)?.[1] ?? ''
  const keys = [...block.matchAll(/^\s*(\w+):/gm)].map((m) => m[1])
  if (keys.length < 4) {
    throw new Error(`面板图标表只量到 ${keys.length} 条（锚点句式被改）`)
  }
  return keys
}

/** 宣传页承诺的上下文维度数（hero 那条「N 维」与正文「N 维上下文」） */
function landingDimensionClaims(): number[] {
  const html = readFileSync(join(ROOT, 'landing', 'index.html'), 'utf8')
  const claims = [
    ...html.matchAll(/<div class="hero-stat-value">(\d+) 维<\/div>/g),
    ...html.matchAll(/(\d+) 维上下文/g),
  ].map((m) => Number(m[1]))
  if (claims.length < 2) {
    throw new Error(`宣传页维度数只量到 ${claims.length} 处（锚点句式被改）`)
  }
  return claims
}

// ===== 三个纯收集器：返回"抄件与真值不一致的地方"，空数组 == 对上了 =====

function settingsTableGaps(
  truth: RegisteredBuilder[],
  rows: Array<{ no: number; name: string; label: number }>,
): string[] {
  const gaps: string[] = []
  const names = truth.map((b) => b.name)
  for (const missing of names.filter((n) => !rows.some((r) => r.name === n))) {
    gaps.push(`设置页少列一路：${missing}`)
  }
  for (const extra of rows.filter((r) => !names.includes(r.name)).map((r) => r.name)) {
    gaps.push(`设置页多出一路（真管线里没有）：${extra}`)
  }
  truth.forEach((b, i) => {
    const row = rows.find((r) => r.name === b.name)
    if (!row) return
    if (row.no !== i + 1) gaps.push(`${b.name} 的序号写成 ${row.no}，注册顺序里它是第 ${i + 1}`)
    if (row.label !== i + 1) {
      gaps.push(`${b.name} 的界面优先级写成 ${row.label}，按 priority ${b.priority} 应是第 ${i + 1}`)
    }
  })
  return gaps
}

function iconTableGaps(truth: RegisteredBuilder[], keys: string[]): string[] {
  const gaps: string[] = []
  const names = truth.map((b) => b.name)
  for (const missing of names.filter((n) => !keys.includes(n))) {
    gaps.push(`调取面板没有 ${missing} 的图标（会退回通用放大镜）`)
  }
  for (const extra of keys.filter((k) => !names.includes(k))) {
    gaps.push(`调取面板图标表多了一个 ${extra}（真管线里没有这一路）`)
  }
  return gaps
}

function landingGaps(count: number, claims: number[]): string[] {
  const gaps: string[] = []
  for (const wrong of [...new Set(claims)].filter((c) => c !== count)) {
    gaps.push(`宣传页写 ${wrong} 维，真注册出来是 ${count} 路`)
  }
  return gaps
}

describe('上下文构建器：一处注册、三处抄件对账', () => {
  it('设置页表格的每一路都对得上注册表，序号与优先级按真顺序排', () => {
    expect(settingsTableGaps(registeredBuilders(), settingsPageRows())).toEqual([])
  })

  it('「调取知识库」面板给每一路都配了图标，且没有多余条目', () => {
    expect(iconTableGaps(registeredBuilders(), retrievalPanelIconKeys())).toEqual([])
  })

  it('宣传页说的维度数 == 真注册出来的路数，页面内部只有一个口径', () => {
    expect(landingGaps(registeredBuilders().length, landingDimensionClaims())).toEqual([])
  })

  it('量具有牙 · 三处各造一次人为漏抄，收集器都要报出那一路', () => {
    const truth = registeredBuilders()
    const dropped = truth[truth.length - 1]
    expect(settingsTableGaps(truth, settingsPageRows().filter((r) => r.name !== dropped.name))).toEqual(
      expect.arrayContaining([`设置页少列一路：${dropped.name}`]),
    )
    expect(iconTableGaps(truth, retrievalPanelIconKeys().filter((k) => k !== dropped.name))).toEqual([
      `调取面板没有 ${dropped.name} 的图标（会退回通用放大镜）`,
    ])
    expect(landingGaps(truth.length, [truth.length - 1, truth.length - 1])).toEqual([
      `宣传页写 ${truth.length - 1} 维，真注册出来是 ${truth.length} 路`,
    ])
  })

  it('量具有牙 · 名字全对但优先级被写乱，也要报', () => {
    const truth = registeredBuilders()
    const rows = settingsPageRows().map((r) => ({ ...r, label: 1 }))
    expect(settingsTableGaps(truth, rows).length).toBeGreaterThan(0)
    expect(settingsTableGaps(truth, rows)[0]).toContain('界面优先级写成 1')
  })

  it('真值本身可信：注册出来的每一路都有独立实现文件，且 priority 互不相同', () => {
    const truth = registeredBuilders()
    expect(new Set(truth.map((b) => b.name)).size).toBe(truth.length)
    expect(new Set(truth.map((b) => b.priority)).size).toBe(truth.length)
    expect(truth.every((b, i) => i === 0 || truth[i - 1].priority > b.priority)).toBe(true)
  })
})
