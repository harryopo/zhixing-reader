// @vitest-environment happy-dom
/**
 * 同名函数各抄一份 —— 第三批（2026-10-18）
 *
 * 前两批收的是"清单抄件"（构建器表、图标表）与"日期串的形状"。这一批先用 AST 横扫函数体量出两类
 * **同名同体**的实现，再把它们各归一份：
 *
 * 1. `asNumber` / `asString`：`pages/settings/data-utils.ts` 导出一份，
 *    `pages/settings/SettingsAI.tsx` 又写了一份私有副本（逐字节同体）。
 *    这族的雷是 `Number('')` 等于 0 —— 本项目真被咬过（生词 `ef_factor` 的 2.5 被空串刷成 0），
 *    "空串与纯空白必须走 fallback"就是这条实现的全部意义；两份各自演化一次，就有一份会把它写丢。
 * 2. 「按 updatedAt 倒序、脏值怎么办」：`ReadingStatsView` 与 `YearlyBookTable` 各写一遍
 *    `x.updatedAt ? new Date(x.updatedAt).getTime() : 0`，前者筛选时又自己写 `isNaN`。
 *    裸串按本地时区解释、`isNaN` 只挡一种坏形状 ⇒ 交回 `db-time.dbTimeEpoch` 这一把尺。
 *
 * 判据钉的是**行为**（脏值/缺失/两种形状各怎么排、空串走不走 fallback），
 * 加一条"同名实现只许有一份"的全树横扫。横扫用**纯收集器**（喂进去的是文件清单，不写盘）：
 * 反证喂合成内容，绝不在测试里改仓库文件 —— 这个目录正被另一路会话编辑。
 */
process.env.TZ = 'Asia/Shanghai'

import { describe, it, expect, vi } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { dbTimeEpoch, localDayKey } from '../src/shared/db-time'
import {
  bookUpdatedAtEpoch,
  byUpdatedAtDesc,
  getStatsRangeDates,
  type BookStat,
} from '../src/renderer/src/pages/stats/constants'
import { asNumber, asString, formatSize, levelToRetention, formatDaysAgo, downloadBlob } from '../src/renderer/src/pages/settings/data-utils'

const ROOT = join(__dirname, '..')

function stat(over: Partial<BookStat>): BookStat {
  return {
    id: 'b1',
    title: '书',
    author: '',
    cover: '',
    category: '',
    progress: 100,
    highlightCount: 0,
    cardCount: 0,
    ...over,
  }
}

describe('asNumber / asString：一份实现，空串不许当 0', () => {
  it('空串与纯空白都走 fallback（Number("") 是 0，这条就是当年 ef_factor 被刷成 0 的入口）', () => {
    expect(asNumber('', 2.5)).toBe(2.5)
    expect(asNumber('   ', 2.5)).toBe(2.5)
    expect(asString('', '默认'), '空串不许算"有值"').toBe('默认')
    expect(asString('用户写的想法', '')).toBe('用户写的想法')
  })

  it('能读的才读：数字串、真 0、负数、小数都照原值；NaN / Infinity / 布尔 / 对象 / null / undefined 一律 fallback', () => {
    expect(asNumber('42', 0)).toBe(42)
    expect(asNumber('2.5', 0)).toBe(2.5)
    expect(asNumber('-7', 0)).toBe(-7)
    expect(asNumber(0, 99), '真 0 就是 0，不许被当成"没有值"').toBe(0)
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, {}, [], null, undefined, true]) {
      expect(asNumber(bad, 8), `坏值 ${String(bad)} 不许穿过闸门`).toBe(8)
    }
    // '1e400' 解出来是 Infinity —— 过 isNaN 却会设置项上限撑爆
    expect(asNumber('1e400', 8)).toBe(8)
    expect(asNumber('-1e400', 8)).toBe(8)
  })

  it('量具有牙 · 把"空串"那半个闸门拆掉，旧写法当场把 2.5 变成 0（证明上面第一条不是恒真）', () => {
    const 拆闸门 = (v: unknown, fallback: number): number => {
      if (typeof v === 'number' && !Number.isNaN(v)) return v
      if (typeof v === 'string') {
        const n = Number(v)
        if (!Number.isNaN(n)) return n
      }
      return fallback
    }
    expect(拆闸门('', 2.5)).toBe(0)
    expect(asNumber('', 2.5)).toBe(2.5)
  })
})

describe('dbTimeEpoch：那一列到底是哪一刻（两种形状都要认，脏值说"不知道"）', () => {
  it('库里两种形状各自解对，且同一答案', () => {
    // 形状①：'YYYY-MM-DD HH:MM:SS' 是 UTC 墙上时钟，串里不带时区标记
    const naive = dbTimeEpoch('2026-09-28 03:15:00')
    expect(naive).toBe(Date.parse('2026-09-28T03:15:00Z'))
    // 形状②：带 Z 的 ISO（safeDate 交回来的就是这一种）
    expect(dbTimeEpoch('2026-09-28T03:15:00.000Z')).toBe(Date.parse('2026-09-28T03:15:00Z'))
    expect(naive, '两种形状不同答案 ⇒ 同一列又变成两种读法').toBe(dbTimeEpoch('2026-09-28T03:15:00.000Z'))
  })

  it('缺失、空串、脏值、0 一律 null（不当 0 混进有效时间，也不猜 1970）', () => {
    for (const bad of [undefined, null, '', '   ', '说不上来', Number.NaN, {}, 0]) {
      expect(dbTimeEpoch(bad), `坏值 ${JSON.stringify(bad)} 应当是"不知道"`).toBeNull()
    }
  })
})

describe('年度书单：两处视图共用同一份读法与同一种排法', () => {
  it('新→旧排；缺失或读不出时刻的落到最后（旧写法拿 NaN 参与比较，谁前谁后由实现决定）', () => {
    const rows = [
      stat({ id: '脏', title: '脏', updatedAt: '说不上来' }),
      stat({ id: '旧', title: '旧', updatedAt: '2026-01-01T00:00:00.000Z' }),
      stat({ id: '缺', title: '缺', updatedAt: undefined }),
      stat({ id: '新', title: '新', updatedAt: '2026-08-01T00:00:00.000Z' }),
    ]
    expect([...rows].sort(byUpdatedAtDesc).map((s) => s.id)).toEqual(['新', '旧', '脏', '缺'])
  })

  it('空串与缺失同义：都算"没有最后更新"，不许排到中间', () => {
    const 空 = stat({ id: '空', title: '空', updatedAt: '' })
    const 有 = stat({ id: '有', title: '有', updatedAt: '2026-05-05T00:00:00.000Z' })
    expect([空, 有].sort(byUpdatedAtDesc).map((s) => s.id)).toEqual(['有', '空'])
    expect(bookUpdatedAtEpoch(空)).toBeNull()
    expect(bookUpdatedAtEpoch(有), '能解的那条不许也被当成不知道').toBe(Date.parse('2026-05-05T00:00:00.000Z'))
  })

  it('那一列是裸 UTC 串时也排得对（视图模型若绕过 safeDate，两种形状不许差 8 小时）', () => {
    const rows = [
      stat({ id: 'B', title: 'B', updatedAt: '2026-08-01 00:05:00' }),
      stat({ id: 'A', title: 'A', updatedAt: '2026-08-01 00:10:00' }),
    ]
    expect([...rows].sort(byUpdatedAtDesc).map((s) => s.id)).toEqual(['A', 'B'])
  })

  it('getStatsRangeDates：说 7 天就恰好含 7 个日历日，末日就是本地今天', () => {
    const { startDate, endDate } = getStatsRangeDates('7d')
    expect(endDate, '末日必须是本地那一天').toBe(localDayKey(new Date()))
    const span = (Date.parse(`${endDate}T00:00:00Z`) - Date.parse(`${startDate}T00:00:00Z`)) / 86400000 + 1
    expect(span, '闭区间天数就是档位那个数').toBe(7)
    expect(getStatsRangeDates('all').startDate <= localDayKey(new Date())).toBe(true)
  })

  it('接线核对：两个视图都不再自己 new Date(那一列)、也不再写 isNaN', () => {
    for (const f of ['ReadingStatsView.tsx', 'YearlyBookTable.tsx']) {
      const src = readFileSync(join(ROOT, 'src', 'renderer', 'src', 'pages', 'stats', f), 'utf8')
      // 裸串与 `.updatedAt` 直接进 new Date 都是旧写法；换算成 epoch 之后再 new Date 是允许的
      expect(src, `${f} 还在自己算那一列的时刻`).not.toMatch(/new Date\((?:[abs]\.updatedAt|iso)\)/)
      expect(src, `${f} 还在用 isNaN 挡脏值`).not.toMatch(/isNaN\(/)
      expect(src, `${f} 没接上共用那份`).toMatch(/byUpdatedAtDesc/)
    }
    expect(
      readFileSync(join(ROOT, 'src', 'renderer', 'src', 'pages', 'stats', 'YearlyBookTable.tsx'), 'utf8'),
      '那一格的日期也要问同一把尺（裸串会错一天）',
    ).toMatch(/dbTimeEpoch/)
  })
})

/**
 * 全树横扫：同一个名字的函数定义出现在两个以上文件 ⇒ 就是又一份抄件。
 *
 * 收集器是**纯函数**（喂文件清单，不读盘也不写盘）—— 反证喂合成内容，绝不在测试里改仓库文件：
 * 这个目录正被另一路会话编辑（本轮已经踩过一次，见 AGENTS §十 2026-10-18 那行）。
 */
type SourceFile = { path: string; src: string }

const DEFINITION = /^(?:export )?function (asNumber|asString)\b/

function collectDefinitions(files: SourceFile[]): Map<string, string[]> {
  const byName = new Map<string, string[]>()
  for (const file of files) {
    file.src.split(/\r?\n/).forEach((line) => {
      const t = line.trim()
      if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return
      const hit = DEFINITION.exec(t)
      if (!hit) return
      const list = byName.get(hit[1]) ?? []
      if (!list.includes(file.path)) list.push(file.path)
      byName.set(hit[1], list)
    })
  }
  return byName
}

function repoSources(): SourceFile[] {
  const out: SourceFile[] = []
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const p = join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name)) {
        out.push({ path: p.slice(ROOT.length + 1).split('\\').join('/'), src: readFileSync(p, 'utf8') })
      }
    }
  }
  walk(join(ROOT, 'src'))
  return out
}

describe('同名实现只许有一份（这条专门抓"第五份抄件"）', () => {
  const files = repoSources()
  const found = collectDefinitions(files)

  it('横扫看得见东西：src/ 真扫到了上百个文件（否则下面两条都是空话）', () => {
    expect(files.length, '一个源码文件都没量到 ⇒ 遍历口径变了').toBeGreaterThan(100)
  })

  it('asNumber 与 asString 各自只剩 data-utils 那一处定义', () => {
    const home = 'src/renderer/src/pages/settings/data-utils.ts'
    expect([...(found.get('asNumber') ?? [])], '有人又抄了一份数字闸门').toEqual([home])
    expect([...(found.get('asString') ?? [])], '有人又抄了一份字符串闸门').toEqual([home])
  })

  it('量具有牙 · 同一名字再多一份副本，这条横扫必须报出两个文件', () => {
    const planted: SourceFile[] = files.concat([
      { path: 'src/探针/抄件.ts', src: 'function asNumber(v: unknown, fallback: number) { return fallback }\n' },
    ])
    const again = collectDefinitions(planted)
    expect(again.get('asNumber')?.length, '副本被漏掉 ⇒ 这条横扫是瞎的').toBe(2)
    // 注释与测试文件里的同名文字不算定义
    const commented: SourceFile[] = files.concat([
      { path: 'src/探针/说明.ts', src: '// function asNumber(v, fallback) { }\n' },
    ])
    expect(collectDefinitions(commented).get('asNumber')?.length).toBe(1)
  })
})

/**
 * 这一批把 `data-utils.ts` 拉进了覆盖率清单（判据 import 它 ⇒ `tests/coverage-list.test.ts` 逼着对账）。
 * 既然进了清单，就别留一条"进来了但没人看"的空档：这里把它其余四个导出各钉一条行为。
 */
describe('data-utils 其余导出：进清单就得有判据', () => {
  it('formatSize：小于 0.1 MB 用 KB（向量索引那种"确实有但很小"的目录不许显示成 0.0 MB）', () => {
    expect(formatSize(2048)).toEqual({ value: '2.0', unit: 'KB' })
    expect(formatSize(1024 * 1024 * 3)).toEqual({ value: '3.0', unit: 'MB' })
    expect(formatSize(null), '量不出来要明说，不许画 0.0').toEqual({ value: '—', unit: '' })
    expect(formatSize(Number.NaN).value).toBe('—')
    expect(formatSize(Number.POSITIVE_INFINITY).value, 'Infinity 会画成 "Infinity MB"').toBe('—')
  })

  it('levelToRetention：1 档 0.70、10 档 0.95，越界夹住而不是算出 1.2', () => {
    expect(levelToRetention(1)).toBeCloseTo(0.7, 10)
    expect(levelToRetention(10)).toBeCloseTo(0.95, 10)
    expect(levelToRetention(0)).toBeCloseTo(0.7, 10)
    expect(levelToRetention(999)).toBeCloseTo(0.95, 10)
    expect(levelToRetention(-5), '负数不许把保持率压到 0 以下').toBeCloseTo(0.7, 10)
  })

  it('formatDaysAgo：还没有记录说"尚未导出"，未来时刻说"刚刚"，其余按整天数', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-10-18T08:00:00Z'))
      expect(formatDaysAgo('')).toBe('尚未导出')
      expect(formatDaysAgo('2026-10-20T00:00:00Z'), '未来的时间戳不许算成"很久以前"').toBe('刚刚')
      expect(formatDaysAgo('2026-10-18T07:00:00Z')).toBe('今天')
      expect(formatDaysAgo('2026-10-17T08:00:00Z')).toBe('1 天前')
      expect(formatDaysAgo('2026-10-11T08:00:00Z'), '整 7 天').toBe('7 天前')
      expect(formatDaysAgo('2026-10-11T09:00:00Z'), '6 天 23 小时按整天数往下取', ).toBe('6 天前')
      expect(formatDaysAgo('不是个时间'), '脏值不许画成「NaN 天前」').toBe('未知')
    } finally {
      vi.useRealTimers()
    }
  })

  it('downloadBlob：造一个 blob URL、点一下、摘掉锚点，再把 URL 释放', () => {
    vi.useFakeTimers()
    const created: string[] = []
    const revoked: string[] = []
    const createSpy = vi
      .spyOn(URL, 'createObjectURL')
      .mockImplementation(() => {
        const u = 'blob:test-1'
        created.push(u)
        return u
      })
    const revokeSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const clickSpy = vi.spyOn(HTMLElement.prototype, 'click').mockImplementation(() => {})
    try {
      downloadBlob('备份.json', '{}', 'application/json')
      expect(created).length(1)
      expect(clickSpy, '没点到就不算触发下载').toHaveBeenCalledTimes(1)
      expect(document.querySelector('a[download="备份.json"]'), '点完没摘掉，body 会越长越脏').toBeNull()
      vi.advanceTimersByTime(1)
      expect(revoked.length + revokeSpy.mock.calls.length, '不释放就是每次导出漏一个 blob URL').toBeGreaterThanOrEqual(1)
    } finally {
      clickSpy.mockRestore()
      revokeSpy.mockRestore()
      createSpy.mockRestore()
      vi.useRealTimers()
    }
  })
})
