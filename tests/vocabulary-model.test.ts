/**
 * 生词本那套展示算法（src/renderer/src/pages/vocabulary/model.ts）
 *
 * 这个模块从 VocabularyPage 搬出来后一直没人判过 —— 2026-10-17 因为「哪一天」的
 * 判据 import 了它，覆盖率清单那条守卫当场把它报出来（"有测试却没进清单也没登记欠账"），
 * 于是顺带把整套算法钉住：边界、优先级、缺字段三样都各有一条。
 */
import { describe, it, expect } from 'vitest'
import {
  ReviewRating,
  FILTERS,
  getMasteryKind,
  masteryLabel,
  calcMasteryPct,
  masteryStatusColor,
  masteryStatusLabel,
  type MasteryKind,
} from '../src/renderer/src/pages/vocabulary/model'
import type { VocabularyRow } from '../src/renderer/src/utils/db-mapper'

function row(over: Partial<VocabularyRow> = {}): VocabularyRow {
  return {
    id: 'w1',
    word: 'ubiquitous',
    phonetic: '',
    part_of_speech: 'adj',
    meaning_zh: '无处不在的',
    example_en: '',
    example_zh: '',
    cefr_level: 'C2',
    source_article_id: '',
    source: 'import',
    is_mastered: false,
    review_count: 0,
    last_review_at: '',
    next_review_at: '',
    ef_factor: 2.5,
    interval_days: 0,
    repetition_count: 0,
    familiarity_level: 0,
    learning_stage: 0,
    stability: 0,
    difficulty: 0,
    lapses: 0,
    created_at: '2026-09-01 00:00:00',
    ...over,
  }
}

describe('ReviewRating：档位就是 ts-fsrs 的枚举值', () => {
  it('四档齐全且 HARD 可达（2026-09-15 那个静默映射不能再回来）', () => {
    expect([ReviewRating.AGAIN, ReviewRating.HARD, ReviewRating.GOOD, ReviewRating.EASY]).toEqual([1, 2, 3, 4])
  })
})

describe('筛选表：一个 key 一个说法，且 key 就是判定用的那一个', () => {
  it('四档顺序与标签固定，且没有"收藏"这种库里没有的假档位', () => {
    expect(FILTERS.map((f) => f.key)).toEqual(['all', 'due', 'mastered', 'unmastered'])
    expect(FILTERS.map((f) => f.label)).toEqual(['全部', '待复习', '已掌握', '未掌握'])
  })
})

describe('getMasteryKind / masteryLabel：状态只有一套说法', () => {
  it('用户显式标过"已掌握"优先，即使 FSRS 还没动过', () => {
    expect(getMasteryKind(row({ is_mastered: true, learning_stage: 0, review_count: 0 }))).toBe('mastered')
  })

  it('没复习过的是新增，复习过一次就不是新增', () => {
    expect(getMasteryKind(row({ learning_stage: 0, review_count: 0 }))).toBe('new')
    expect(getMasteryKind(row({ learning_stage: 0, review_count: 1 }))).toBe('pending')
    expect(getMasteryKind(row({ learning_stage: 2, review_count: 0 }))).toBe('pending')
  })

  it('缺字段（老库里的 NULL）按 0 处理，不当成"没见过"以外的第三种状态', () => {
    expect(getMasteryKind(row({ learning_stage: undefined as unknown as number, review_count: undefined as unknown as number }))).toBe('new')
  })

  it('三种 kind 各有一个中文说法，认不到的按"待复习"兜底（界面不许画 undefined）', () => {
    expect(masteryLabel('mastered')).toBe('已掌握')
    expect(masteryLabel('new')).toBe('新增')
    expect(masteryLabel('pending')).toBe('待复习')
    expect(masteryLabel('说不上来的' as MasteryKind)).toBe('待复习')
  })
})

describe('calcMasteryPct：由 FSRS 状态推，不再用复习次数冒充', () => {
  it('显式"已掌握"就是 100，压过算法分', () => {
    expect(calcMasteryPct(row({ is_mastered: true, stability: 0, difficulty: 0 }))).toBe(100)
  })

  it('记忆越稳分越高，且始终在 0-100 里', () => {
    const fresh = calcMasteryPct(row({ stability: 0.5, difficulty: 8, repetition_count: 1, lapses: 1 }))
    const solid = calcMasteryPct(row({ stability: 46, difficulty: 4, repetition_count: 4, lapses: 0 }))
    expect(solid).toBeGreaterThan(fresh)
    for (const pct of [fresh, solid]) {
      expect(Number.isFinite(pct)).toBe(true)
      expect(pct).toBeGreaterThanOrEqual(0)
      expect(pct).toBeLessThanOrEqual(100)
    }
  })

  it('FSRS 列全缺（迁移前那批行）不炸、也不给出 NaN 百分比', () => {
    const pct = calcMasteryPct(
      row({ stability: undefined as unknown as number, difficulty: undefined as unknown as number, repetition_count: undefined as unknown as number, review_count: undefined as unknown as number, lapses: undefined as unknown as number }),
    )
    expect(Number.isFinite(pct)).toBe(true)
    expect(pct).toBeGreaterThanOrEqual(0)
    expect(pct).toBeLessThanOrEqual(100)
  })
})

describe('掌握度的色与标签：同一个 80 / 40 分界', () => {
  it('边界值归到高档，边界外一档归下一档', () => {
    expect(masteryStatusColor(80)).toBe('var(--state-success)')
    expect(masteryStatusColor(79)).toBe('var(--state-warning)')
    expect(masteryStatusColor(40)).toBe('var(--state-warning)')
    expect(masteryStatusColor(39)).toBe('var(--state-error)')

    expect(masteryStatusLabel(80)).toBe('已掌握')
    expect(masteryStatusLabel(79)).toBe('学习中')
    expect(masteryStatusLabel(40)).toBe('学习中')
    expect(masteryStatusLabel(39)).toBe('入门')
  })

  it('色与标签不许各说一套（同一条 80 分位必须两边同时跳档）', () => {
    const pairs = [0, 10, 39, 40, 79, 80, 100].map((p) => [p, masteryStatusColor(p), masteryStatusLabel(p)] as const)
    const byColor = new Map<string, Set<string>>()
    for (const [, color, label] of pairs) {
      if (!byColor.has(color)) byColor.set(color, new Set())
      byColor.get(color)!.add(label)
    }
    for (const [color, labels] of byColor) {
      expect(labels.size, `${color} 对应了多种说法：${[...labels].join('/')}`).toBe(1)
    }
  })
})
