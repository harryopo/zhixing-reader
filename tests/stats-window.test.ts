/**
 * 「近 N 天」这个窗口到底含几天（2026-10-17，与 daily_stats 那次同一个根的第二处）
 *
 * 统计页与用量页各写了一份"日期范围 → { startDate, endDate }"，两边都是：
 *   end.setHours(23,59,59) 后取 `toISOString()` 的日  ⇒ UTC+8 上恰好是本地那一天；
 *   start.setHours(0,0,0,0) 后再取 `toISOString()` 的日 ⇒ **本地零点 = 前一天 16:00 UTC**，于是起始日往前多一天。
 * 实测（TZ=Asia/Shanghai，本地 00:30 与 13:00 两个时刻同答案）：
 *   getStatsRangeDates('7d') ⇒ { startDate: '2026-10-10', endDate: '2026-10-17' } —— **闭区间 8 天**。
 * 而 `ReadingStatsView` 是对 `getRange` 交回的每一行求和、还把 `dailyRangeData.length` 当"天数"显示
 * ⇒ 界面说「近 7 天」，算的却是 8 天。
 *
 * 判据钉的是不变量本身（**闭区间恰含 N 天**）+ 跨年跨月的边界 + 两处接线，不是钉某天的具体数字。
 */
process.env.TZ = 'Asia/Shanghai'

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { windowEndingToday, shiftDayKey, localDayKey, localFileStamp } from '../src/shared/db-time'
import { recentDayKeys } from '../src/shared/reading-trend'

/** 闭区间含几天：两个 `YYYY-MM-DD` 之间（含两端）的日历日数 */
function spanDays(start: string, end: string): number {
  return (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1
}

describe('windowEndingToday：说 N 天就恰好 N 天', () => {
  const localAfternoon = new Date('2026-10-17T05:00:00Z') // 北京 10-17 13:00
  const localJustPastMidnight = new Date('2026-10-16T16:30:00Z') // 北京 10-17 00:30

  it.each([7, 14, 30, 90, 365])('近 %i 天：闭区间恰含 %i 天', (days) => {
    for (const now of [localAfternoon, localJustPastMidnight]) {
      const { startDate, endDate } = windowEndingToday(days, now)
      expect(spanDays(startDate, endDate), `days=${days} @ ${now.toISOString()}`).toBe(days)
      expect(endDate, '末日必须是本地那一天').toBe(localDayKey(now))
    }
  })

  it('凌晨与下午取到同一个窗口（旧写法靠 toISOString 会往前多一天）', () => {
    expect(windowEndingToday(7, localJustPastMidnight)).toEqual(windowEndingToday(7, localAfternoon))
    expect(windowEndingToday(7, localAfternoon).startDate, '旧实现这里是 10-10（多一天）').toBe('2026-10-11')
  })

  it('跨年、跨月各自数对（月长不同，靠"30 天"近似会歪）', () => {
    const jan3 = new Date('2026-01-02T16:30:00Z') // 北京 2026-01-03 00:30（实测核对过）
    const { startDate, endDate } = windowEndingToday(7, jan3)
    expect(endDate).toBe('2026-01-03')
    expect(startDate).toBe('2025-12-28')
    expect(spanDays(startDate, endDate)).toBe(7)

    // 2 月：2026 不是闰年，2-28 往前 7 天应到 2-22
    const feb28 = new Date('2026-02-27T16:00:00Z')
    expect(windowEndingToday(7, feb28)).toEqual({ startDate: '2026-02-22', endDate: '2026-02-28' })
  })

  it('days 不是正整数时不给"半个窗口"：一律按 1 天收口', () => {
    const now = localAfternoon
    for (const bad of [0, -3, 1.5, Number.NaN, undefined]) {
      const { startDate, endDate } = windowEndingToday(bad as number, now)
      expect(spanDays(startDate, endDate)).toBe(1)
    }
  })
})

describe('shiftDayKey：日历日键的加减（不碰时区，纯日期算术）', () => {
  it('加减跨月跨年都落在真实的那一日', () => {
    expect(shiftDayKey('2026-10-17', -6)).toBe('2026-10-11')
    expect(shiftDayKey('2026-01-03', -6)).toBe('2025-12-28')
    expect(shiftDayKey('2026-02-28', 1)).toBe('2026-03-01')
    expect(shiftDayKey('2024-02-28', 1)).toBe('2024-02-29') // 闰年
    expect(shiftDayKey('2026-12-31', 1)).toBe('2027-01-01')
  })

  it('0 天是同一个键；脏输入一律 null（不猜、不返回 Invalid Date）', () => {
    expect(shiftDayKey('2026-10-17', 0)).toBe('2026-10-17')
    expect(shiftDayKey('', 1)).toBeNull()
    expect(shiftDayKey('2026-13-45', 1)).toBeNull()
    expect(shiftDayKey('说不上来', 1)).toBeNull()
    expect(shiftDayKey('2026-10-17', Number.NaN)).toBeNull()
  })
})

describe('接线：那两份"自己算窗口"的代码不再各写一份', () => {
  const stats = readFileSync('src/renderer/src/pages/stats/constants.ts', 'utf8')
  const usage = readFileSync('src/renderer/src/pages/token-usage/format.ts', 'utf8')

  it('两份窗口都不再用 toISOString 取日', () => {
    for (const [name, src] of [['stats/constants', stats], ['token-usage/format', usage]] as const) {
      expect(src, `${name} 还在用 toISOString().split('T')[0] 取日子`).not.toMatch(/toISOString\(\)\.split\('T'\)/)
    }
  })

  it('两份都改走 windowEndingToday（一处口径，两处消费）', () => {
    expect(stats).toContain('windowEndingToday')
    expect(usage).toContain('windowEndingToday')
  })

  it('正向控制：这两个函数真的能读到（读空了上面两条就是空话）', () => {
    expect(stats.length, 'stats/constants.ts 没读到内容').toBeGreaterThan(500)
    expect(usage.length, 'token-usage/format.ts 没读到内容').toBeGreaterThan(500)
  })
})

/**
 * 全树横扫（2026-10-18 从"两个文件"扩到整棵树）
 *
 * 上一批只钉了当时改到的那两处，结果同类还留在四个地方没人看见：
 * `cards.countNewIntroducedToday`（今日新卡数按 UTC 日数）、`TokenUsage` 的图表横轴
 * （我改了 SQL 的归日口径却漏了横轴键，两边各算各的）、logger 的日志文件名、
 * 备份与复习 CSV 的文件名。三条集成测试也照旧写 UTC 的"今天"，过零点当场红。
 * 一条按文件清单写的规则迟早漏文件 —— 判据改成扫全树。
 */
const UTC_DAY_KEY = /toISOString\(\)\.split\('T'\)/

function walkSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name)
    if (e.isDirectory()) return e.name === 'node_modules' || e.name.startsWith('.') ? [] : walkSources(p)
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [p] : []
  })
}

/** 忽略注释行：`db-time.ts` 自己要在文档注释里写清"旧写法错在哪" */
function findUtcDayKeyLines(src: string): number[] {
  return src
    .split(/\r?\n/)
    .map((line, i) => [i + 1, line] as const)
    .filter(([, line]) => {
      const t = line.trim()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && UTC_DAY_KEY.test(line)
    })
    .map(([n]) => n)
}

describe('「哪一天」只许问一把尺：全树不许再用 toISOString 取日', () => {
  it('electron/ 与 src/ 的源码里一处都没有（注释里讲历史除外）', () => {
    const offenders = walkSources('electron')
      .concat(walkSources('src'))
      .flatMap((f) => findUtcDayKeyLines(readFileSync(f, 'utf8')).map((n) => `${f}:${n}`))
    expect(offenders, '这些地方还在自己算日子').toEqual([])
  })

  it('量具有牙 · 注入一行取 UTC 日的写法必须被报出来，注释行则放过', () => {
    const sample = [
      "const a = new Date().toISOString();",
      "const b = new Date().toISOString().split('T')[0];",
      "// 旧写法 toISOString().split('T')[0] 取的是 UTC 日",
    ].join('\n')
    expect(findUtcDayKeyLines(sample)).toEqual([2])
    expect(findUtcDayKeyLines(sample.replace(UTC_DAY_KEY, 'localDayKey'))).toEqual([])
  })

  it('量具有牙 · 横扫真的扫到了东西（不是空目录装样子）', () => {
    const files = walkSources('electron').concat(walkSources('src'))
    expect(files.length, '一个源码文件都没量到，说明遍历口径变了').toBeGreaterThan(100)
    expect(files.some((f) => f.includes('db-time'))).toBe(true)
  })
})

/**
 * 「哪一天」的第二种形状（2026-10-18）
 *
 * 上面那条横扫只认得 **UTC 那种写法**（`toISOString().split('T')`）。同一族的另一种形状 ——
 * 自己拿 `getFullYear/getMonth/getDate` 补零拼串 —— 量不到，于是又量到四处各写一份：
 * `fsrs-voice.toDateLabel`、`reading-trend.recentDayKeys` 的格子键、
 * `stats/constants.formatExportTimestamp` 与 `token-usage/format.formatExportTimestamp`（两个导出文件名）。
 * 四处今天与 `localDayKey` 同答案，所以界面看不出问题；一旦尺要改（加周键、改分隔符），
 * 这四路会**静默留在旧形状上** —— 与前两批"三份配色表""两张构建器表"同一类病。
 * 一条只认一种写法的规则迟早漏另一种 ⇒ 判据加第二条形状。
 */
const LOCAL_DATE_BUILD =
  /(?:getMonth\(\)\s*\+\s*1\)[^\n]*padStart|pad\([^)]*getMonth\(\)\s*\+\s*1\))/

function findLocalDateBuildLines(src: string): number[] {
  return src
    .split(/\r?\n/)
    .map((line, i) => [i + 1, line] as const)
    .filter(([, line]) => {
      const t = line.trim()
      return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*') && LOCAL_DATE_BUILD.test(line)
    })
    .map(([n]) => n)
}

describe('日期串的形状只许有一份实现：全树不许再自己补零拼', () => {
  it('除 `db-time.ts` 自己，electron/ 与 src/ 一处都没有（注释里讲历史除外）', () => {
    const offenders = walkSources('electron')
      .concat(walkSources('src'))
      .filter((f) => !f.includes('db-time'))
      .flatMap((f) => findLocalDateBuildLines(readFileSync(f, 'utf8')).map((n) => `${f}:${n}`))
    expect(offenders, '这些地方还在自己拼日期串').toEqual([])
  })

  it('量具自检：那把尺必须被这套模式认出来（认不出就等于判据恒真空）', () => {
    const ruler = readFileSync(join('src', 'shared', 'db-time.ts'), 'utf8')
    expect(
      findLocalDateBuildLines(ruler).length,
      '模式连 db-time.ts 自己都匹配不到 ⇒ 它已经不再描述"补零拼日期"这个形状',
    ).toBeGreaterThanOrEqual(2)
  })

  it('量具有牙 · 两种形状都得报，注释行放过', () => {
    const sample = [
      "  const m = String(d.getMonth() + 1).padStart(2, '0')",
      "  return `${y}${pad(d.getMonth() + 1)}${pad(d.getDate())}`",
      "  // 旧写法 String(d.getMonth() + 1).padStart(2, '0') 是自己拼的",
      '  const label = `${today.getMonth() + 1} 月`',
    ].join('\n')
    expect(findLocalDateBuildLines(sample)).toEqual([1, 2])
  })
})

describe('接线：文件名与热力格子中出的键来自同一份实现', () => {
  const 北京下午 = new Date('2026-10-18T05:07:09Z') // 北京 10-18 13:07
  const 北京凌晨 = new Date('2026-10-17T16:05:00Z') // 北京 10-18 00:05（UTC 还差一天）

  it('localFileStamp 说本地那一刻，不按 UTC 切（文件名与导出内容不能两个口径）', () => {
    expect(localFileStamp(北京下午)).toBe('20261018-1307')
    expect(localFileStamp(北京凌晨), '按 UTC 会写成 20261017-1605').toBe('20261018-0005')
    expect(localFileStamp(北京凌晨).slice(0, 8)).toBe(localDayKey(北京凌晨).replace(/-/g, ''))
  })

  it('recentDayKeys 的每一格 == localDayKey，末格就是"今天"', () => {
    const keys = recentDayKeys(北京下午, 5)
    expect(keys).toEqual(['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18'])
    expect(keys.at(-1)).toBe(localDayKey(北京下午))
    // 凌晨与下午同一天 ⇒ 整列格子不许漂移
    expect(recentDayKeys(北京凌晨, 5)).toEqual(keys)
  })

  it('两个导出页都不再自带时间戳实现（文件名由这一把尺决定）', () => {
    const stats = readFileSync('src/renderer/src/pages/stats/constants.ts', 'utf8')
    const usage = readFileSync('src/renderer/src/pages/token-usage/format.ts', 'utf8')
    const statsPage = readFileSync('src/renderer/src/pages/Stats.tsx', 'utf8')
    const usagePage = readFileSync('src/renderer/src/pages/TokenUsage.tsx', 'utf8')
    expect(stats).not.toContain('formatExportTimestamp')
    expect(usage).not.toContain('formatExportTimestamp')
    expect(statsPage).toContain('localFileStamp')
    expect(usagePage).toContain('localFileStamp')
  })
})
