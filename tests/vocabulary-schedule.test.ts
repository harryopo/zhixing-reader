// tests/vocabulary-schedule.test.ts
//
// 「加入复习」这个按钮的语义回归测试。
//
// 修复前它调的是 updateReviewData(quality: Good)：review_count + 1、写 last_review_at、
// 按 Good 重排 next_review_at —— 等于**替用户提交了一次"我认识这个词"的评分**。
// 界面上的字是「加入复习」，行为却是"打分"，这是典型的名不副实。

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { vocabularyDb } from '../electron/database'

describe('scheduleForReview - 只排队，不记复习', () => {
  beforeEach(async () => { await setupTestDatabase() })
  afterEach(() => teardownTestDatabase())

  it('把 next_review_at 置为现在，但不增加复习次数、不写 last_review_at', () => {
    vocabularyDb.create({ id: 'v1', word: 'habit', meaning_zh: '习惯' } as never)
    const before = vocabularyDb.getById('v1') as Record<string, unknown>
    vocabularyDb.scheduleForReview('v1')
    const after = vocabularyDb.getById('v1') as Record<string, unknown>
    expect(Number(after.review_count ?? 0)).toBe(Number(before.review_count ?? 0))
    expect(after.last_review_at ?? null).toBeNull()
    expect(after.next_review_at).toBeTruthy()
  })

  it('排在队列最前面：刚排过的词会出现在待复习列表里', () => {
    vocabularyDb.create({
      id: 'v2',
      word: 'award',
      meaning_zh: '奖项',
      next_review_at: '2099-01-01T00:00:00.000Z',
    } as never)
    vocabularyDb.scheduleForReview('v2')
    const due = vocabularyDb.getDueForReview(50)
    expect(due.some((w) => w.id === 'v2')).toBe(true)
  })

  it('不改调度参数（stability / difficulty 原样）', () => {
    vocabularyDb.create({ id: 'v3', word: 'comedy', meaning_zh: '喜剧' } as never)
    const before = vocabularyDb.getById('v3') as Record<string, unknown>
    vocabularyDb.scheduleForReview('v3')
    const after = vocabularyDb.getById('v3') as Record<string, unknown>
    expect(after.stability).toBe(before.stability)
    expect(after.difficulty).toBe(before.difficulty)
  })
})
