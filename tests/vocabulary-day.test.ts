/**
 * 生词这一路的「哪一天」（2026-10-17）
 *
 * 同一把尺的两处漏点：
 *  ① 每日学习页说「今天」：副标题打的是**本地日**（`10 月 17 日`），
 *     而"今天已学的生词"用 `toISOString().split('T')[0]`（**UTC 日**）去比 `last_review_at`
 *     截出来的 10 位 —— 两句里只有一句是真的。
 *  ② 生词抽屉那句「X 天没碰」：`new Date('2026-10-16 02:00:00')` 把库里那种
 *     "日期 空格 时间"的**UTC 串按本地时区解释**（`src/shared/db-time.ts` 整份文件就是为这件事存在的），
 *     北京 10:00 复习的词，晚上 9 点看会被说成"已经 1 天没碰"。
 *
 * TZ 钉东八区：不钉的话 UTC runner 上两种算法恰好一致，判据当场失去牙齿。
 */
process.env.TZ = 'Asia/Shanghai'

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { formatDateOnly, daysSinceStoredTime } from '../src/renderer/src/pages/vocabulary/model'
import { isSameLocalDay, localDayKey } from '../src/shared/db-time'

describe('formatDateOnly：打的是那一天，不是"UTC 的某一天"', () => {
  it('库里那种 UTC 空格串按真实时刻换本地日', () => {
    // '2026-09-05 16:00:00' = UTC 墙上时钟 = 北京 09-06 零点
    expect(formatDateOnly('2026-09-05 16:00:00')).toBe('2026-09-06')
    // 带 Z 的 ISO（ts-fsrs 那一路）照它自己声明的时区走
    expect(formatDateOnly('2026-09-05T15:59:59.000Z')).toBe('2026-09-05')
  })

  it('没有值、脏值一律画成 -（不显示 1970，也不显示 NaN）', () => {
    expect(formatDateOnly(undefined)).toBe('-')
    expect(formatDateOnly('')).toBe('-')
    expect(formatDateOnly('这不是日期')).toBe('-')
  })
})

describe('isSameLocalDay：今天学过的就算今天（全应用只这一条）', () => {
  it('北京 10-17 00:30 复习的词，在 10-17 这天算"今天已学"', () => {
    // last_review_at 由 datetime('now') 写 = UTC 墙上时钟
    const today = localDayKey(new Date('2026-10-16T16:35:00Z')) // = '2026-10-17'
    expect(isSameLocalDay('2026-10-16 16:30:00', today)).toBe(true)
    // 同一时刻换到 10-16 那一天就必须说 false（边界另一侧也钉住，防止判据反着写）
    expect(isSameLocalDay('2026-10-16 16:30:00', '2026-10-16')).toBe(false)
  })

  it('已经映射成 ISO 带 Z 的列（对话 updated_at 那一路）同样认得', () => {
    expect(isSameLocalDay('2026-10-16T16:35:00.000Z', '2026-10-17')).toBe(true)
    expect(isSameLocalDay('2026-10-16T15:00:00.000Z', '2026-10-17')).toBe(false)
  })

  it('解不出来的值不算"今天学过"（脏值不许被演成已完成）', () => {
    expect(isSameLocalDay(undefined, '2026-10-17')).toBe(false)
    expect(isSameLocalDay('', '2026-10-17')).toBe(false)
    expect(isSameLocalDay('乱码', '2026-10-17')).toBe(false)
    expect(isSameLocalDay(0, '2026-10-17')).toBe(false)
  })
})

describe('daysSinceStoredTime：那句"几天没碰"要数对', () => {
  it('北京 10-17 10:00 复习、10-18 09:00 打开应用 ⇒ 还不满一天，说 0', () => {
    // 库里那一串是 UTC 墙上时钟：'2026-10-16 02:00:00' = 北京 10-16 10:00
    // now = '2026-10-17T01:00:00Z' = 北京 10-17 09:00 —— 差 23 小时
    expect(daysSinceStoredTime('2026-10-16 02:00:00', new Date('2026-10-17T01:00:00Z'))).toBe(0)
  })

  it('真过了一天以上就说 1 天（47 小时 → 1，不是 0 也不是 2）', () => {
    // '2026-10-15 02:00:00'(UTC) 到 '2026-10-17T01:00:00Z' 差 47 小时
    expect(daysSinceStoredTime('2026-10-15 02:00:00', new Date('2026-10-17T01:00:00Z'))).toBe(1)
  })

  it('没有值就是"不知道"：说 0 天，不抛也不给 NaN', () => {
    expect(daysSinceStoredTime(undefined, new Date())).toBe(0)
    expect(daysSinceStoredTime('乱码', new Date())).toBe(0)
  })
})

describe('接线：那两个页面必须用这一把尺（各自绕过就等于没有）', () => {
  const drawer = readFileSync('src/renderer/src/pages/vocabulary/VocabularyDrawer.tsx', 'utf8')
  const daily = readFileSync('src/renderer/src/pages/DailyLearning.tsx', 'utf8')

  it('生词抽屉不再裸解 last_review_at', () => {
    expect(drawer, '抽屉仍在用 new Date(item.last_review_at) 自己解释那一串').not.toMatch(
      /new Date\(item\.last_review_at\)/,
    )
    expect(drawer).toContain('daysSinceStoredTime')
  })

  it('每日学习页不再用 UTC 日当"今天"', () => {
    expect(daily, '页面仍用 toISOString 取"今天"').not.toMatch(
      /const todayStr = new Date\(\)\.toISOString\(\)\.split\('T'\)\[0\]/,
    )
    expect(daily, '页面还在自己截 10 位比日子').not.toMatch(/\.slice\(0, 10\) === todayStr/)
    expect(daily).toContain('isSameLocalDay')
  })

  it('正向控制：这把尺真的能区分两个键（不然上面两条是空话）', () => {
    const now = new Date('2026-10-16T16:35:00Z')
    expect(localDayKey(now)).toBe('2026-10-17')
    expect(now.toISOString().split('T')[0]).toBe('2026-10-16')
  })
})
