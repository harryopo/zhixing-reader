// 知行读书 — 遗忘播报（src/shared/fsrs-voice.ts）单元测试
//
// 这个模块的全部价值在于"这句话读起来像不像人话、准不准"，
// 所以测试的重点不是覆盖率，而是**把措辞钉死**，并逐条守住三条硬约束：
//   1. 只说结论，不请用户评判算法（否则污染 FSRS 唯一的真值输入）
//   2. 没有数据就闭嘴，绝不编日期（v1.1.0 刚清理过假数据）
//   3. 不许用亲切的词撒谎（12 天不能叫"这周"）

import { describe, it, expect } from 'vitest'
import {
  describeForgetting,
  describeNextReview,
  describeSpan,
  voiceTone,
} from '../src/shared/fsrs-voice'

/** 相对今天 n 天的 ISO 时间（n 为负表示过去） */
function daysFromNow(n: number, now = new Date('2026-09-15T10:00:00')): string {
  const d = new Date(now)
  d.setDate(d.getDate() + n)
  return d.toISOString()
}

const NOW = new Date('2026-09-15T10:00:00')

describe('describeSpan — 时间跨度的人话', () => {
  it('0/1/2 天用口语词', () => {
    expect(describeSpan(0)).toBe('今天')
    expect(describeSpan(1)).toBe('明天')
    expect(describeSpan(2)).toBe('后天')
  })

  it('3-99 天给出确切天数（不模糊化）', () => {
    expect(describeSpan(3)).toBe('3 天')
    expect(describeSpan(12)).toBe('12 天')
    expect(describeSpan(45)).toBe('45 天')
    expect(describeSpan(99)).toBe('99 天')
  })

  it('100 天以上才允许模糊，且必须带「约」', () => {
    expect(describeSpan(100)).toBe('约 3 个月')
    expect(describeSpan(180)).toBe('约 6 个月')
    expect(describeSpan(365)).toBe('约 1 年')
    expect(describeSpan(500)).toBe('约 1.4 年')
    expect(describeSpan(730)).toBe('约 2 年')
  })

  it('负数与非法输入不产生怪字符串', () => {
    expect(describeSpan(-5)).toBe('今天')
    expect(describeSpan(Number.NaN)).toBe('今天')
  })
})

describe('describeForgetting — 约束 2：没有数据就闭嘴', () => {
  it('从未复习过 → 明说"还没真正记住过"，不编日期', () => {
    const v = describeForgetting({ stability: 0, elapsedDays: 0, due: null, reps: 0, now: NOW })
    expect(v.sentence).toBe('这段话你还没真正记住过')
    expect(v.bucket).toBe('new')
    expect(v.dueLabel).toBe('')
    expect(v.retention).toBe(0)
  })

  it('有稳定性但 reps = 0（脏数据）同样按"没记住过"处理', () => {
    const v = describeForgetting({
      stability: 500, elapsedDays: 0, due: daysFromNow(30, NOW), reps: 0, now: NOW,
    })
    expect(v.bucket).toBe('new')
    expect(v.dueLabel).toBe('')
  })

  it('排期缺失时不编日期，只说保持率', () => {
    const v = describeForgetting({ stability: 30, elapsedDays: 40, due: null, reps: 3, now: NOW })
    expect(v.dueLabel).toBe('')
    expect(v.daysUntilDue).toBe(0)
    expect(v.sentence.length).toBeGreaterThan(0)
  })

  it('排期是非法字符串时也不编日期', () => {
    const v = describeForgetting({ stability: 30, elapsedDays: 5, due: 'not-a-date', reps: 3, now: NOW })
    expect(v.dueLabel).toBe('')
    expect(v.sentence).not.toContain('NaN')
  })

  it('任何情况下输出里都不出现 NaN / undefined / Invalid', () => {
    const cases = [
      { stability: Number.NaN, elapsedDays: Number.NaN, due: 'x' as string, reps: Number.NaN },
      { stability: -1, elapsedDays: -1, due: undefined, reps: -1 },
      { stability: 1e9, elapsedDays: 1e9, due: daysFromNow(1e5, NOW), reps: 999 },
    ]
    for (const c of cases) {
      const v = describeForgetting({ ...c, now: NOW })
      for (const s of [v.sentence, v.imperative, v.dueLabel]) {
        expect(s).not.toMatch(/NaN|undefined|Invalid|null/)
      }
    }
  })
})

describe('describeForgetting — 约束 3：不许用亲切的词撒谎', () => {
  it('12 天就说 12 天，不能叫「这周」', () => {
    const v = describeForgetting({
      stability: 20, elapsedDays: 0, due: daysFromNow(12, NOW), reps: 3, now: NOW,
    })
    expect(v.sentence).toContain('12 天')
    expect(v.sentence).not.toContain('周')
    expect(v.sentence).not.toContain('个月')
  })

  it('18 天就说 18 天，不能叫「下个月」', () => {
    const v = describeForgetting({
      stability: 20, elapsedDays: 0, due: daysFromNow(18, NOW), reps: 3, now: NOW,
    })
    expect(v.sentence).toContain('18 天')
    expect(v.sentence).not.toContain('个月')
  })

  it('1 / 2 天用「明天 / 后天」', () => {
    const one = describeForgetting({ stability: 2, elapsedDays: 0, due: daysFromNow(1, NOW), reps: 2, now: NOW })
    const two = describeForgetting({ stability: 3, elapsedDays: 0, due: daysFromNow(2, NOW), reps: 2, now: NOW })
    expect(one.sentence).toContain('明天')
    expect(two.sentence).toContain('后天')
  })
})

describe('describeForgetting — 约束 1：是邀请，不是请人评判算法', () => {
  it('陈述句不以问号结尾、不含"对吗/准不准"', () => {
    const buckets = [
      { stability: 0, elapsedDays: 0, due: null, reps: 0 },
      { stability: 2, elapsedDays: 40, due: daysFromNow(-20, NOW), reps: 2 },
      { stability: 5, elapsedDays: 5, due: daysFromNow(0, NOW), reps: 3 },
      { stability: 20, elapsedDays: 0, due: daysFromNow(12, NOW), reps: 4 },
      { stability: 300, elapsedDays: 0, due: daysFromNow(300, NOW), reps: 8 },
    ]
    for (const c of buckets) {
      const v = describeForgetting({ ...c, now: NOW })
      expect(v.sentence).not.toMatch(/[?？]/)
      expect(v.sentence).not.toMatch(/对吗|准不准|是不是/)
    }
  })
})

describe('describeForgetting — 分档与逾期', () => {
  const base = { stability: 5, elapsedDays: 3, reps: 3, now: NOW }

  it('逾期 → overdue，句子说出拖了几天', () => {
    const v = describeForgetting({ ...base, due: daysFromNow(-20, NOW) })
    expect(v.bucket).toBe('overdue')
    expect(v.sentence).toBe('已经拖了 20 天没复习')
    expect(v.daysUntilDue).toBe(-20)
  })

  it('今天到期 → today', () => {
    const v = describeForgetting({ ...base, due: daysFromNow(0, NOW) })
    expect(v.bucket).toBe('today')
    expect(v.sentence).toBe('今天该过一遍了')
  })

  it('1-6 天 → soon，且给出提前过一遍的选项', () => {
    const v = describeForgetting({ ...base, due: daysFromNow(3, NOW) })
    expect(v.bucket).toBe('soon')
    expect(v.imperative).toBe('想提前过一遍也可以')
  })

  it('7-59 天 → upcoming，不再催促（不给祈使句）', () => {
    const v = describeForgetting({ ...base, due: daysFromNow(20, NOW) })
    expect(v.bucket).toBe('upcoming')
    expect(v.imperative).toBe('')
  })

  it('60 天以上 → distant，同样不催促', () => {
    const v = describeForgetting({ ...base, due: daysFromNow(200, NOW) })
    expect(v.bucket).toBe('distant')
    expect(v.imperative).toBe('')
    expect(v.sentence).toContain('约')
  })

  it('同一天内时间不同不影响"今天/明天"的判断（按日历天算）', () => {
    const morning = new Date('2026-09-15T00:30:00')
    const evening = new Date('2026-09-15T23:30:00')
    const due = new Date('2026-09-16T12:00:00').toISOString()
    expect(describeForgetting({ ...base, due, now: morning }).daysUntilDue).toBe(1)
    expect(describeForgetting({ ...base, due, now: evening }).daysUntilDue).toBe(1)
  })

  it('dueLabel 是本地日期 YYYY-MM-DD', () => {
    const v = describeForgetting({ ...base, due: daysFromNow(12, NOW) })
    expect(v.dueLabel).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('describeNextReview — 替代「掌握度 X → Y」的承诺句', () => {
  it('各档位的说法', () => {
    expect(describeNextReview(daysFromNow(0, NOW), NOW)).toBe('好，今天再问你一次')
    expect(describeNextReview(daysFromNow(1, NOW), NOW)).toBe('好，明天见')
    expect(describeNextReview(daysFromNow(2, NOW), NOW)).toBe('好，后天见')
    expect(describeNextReview(daysFromNow(12, NOW), NOW)).toBe('好，我 12 天后再来问你')
  })

  it('缺失/非法排期时给一句兜底，不抛错', () => {
    expect(describeNextReview(null, NOW)).toBe('好，我稍后再来问你')
    expect(describeNextReview('oops', NOW)).toBe('好，我稍后再来问你')
  })

  it('过去的时间按"今天再问一次"处理', () => {
    expect(describeNextReview(daysFromNow(-3, NOW), NOW)).toBe('好，今天再问你一次')
  })
})

describe('voiceTone — 分档到语义色', () => {
  it('每个分档都有明确归属', () => {
    expect(voiceTone('overdue')).toBe('urgent')
    expect(voiceTone('today')).toBe('due')
    expect(voiceTone('soon')).toBe('due')
    expect(voiceTone('new')).toBe('neutral')
    expect(voiceTone('upcoming')).toBe('good')
    expect(voiceTone('distant')).toBe('good')
  })
})

describe('与 fsrs-metrics 的配合', () => {
  it('保持率取自共用的 getRetrievability，与遗忘曲线一致', () => {
    // S = 30，已过 30 天 → 保持率约 0.9（FSRS 的稳定性定义）
    const v = describeForgetting({ stability: 30, elapsedDays: 30, due: daysFromNow(1, NOW), reps: 4, now: NOW })
    expect(v.retention).toBeCloseTo(0.9, 6)
  })

  it('稳定性越大，同一时刻的保持率越高', () => {
    const a = describeForgetting({ stability: 10, elapsedDays: 20, due: daysFromNow(1, NOW), reps: 4, now: NOW })
    const b = describeForgetting({ stability: 100, elapsedDays: 20, due: daysFromNow(1, NOW), reps: 4, now: NOW })
    expect(b.retention).toBeGreaterThan(a.retention)
  })
})
