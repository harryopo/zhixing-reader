// @vitest-environment happy-dom
//
// reviewStore 单元测试
//
// 覆盖 2026-09-15 新增的"掌握度反馈"链路：card.review() 现在会返回调度后的新卡片，
// store 必须捕获它并算出评分前后的掌握度变化，同时累计本轮真实统计。
// 这条链路此前完全没有测试 —— 原实现直接把返回值丢掉了。

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useReviewStore, type RatingPreview } from '../src/renderer/src/stores/reviewStore'
import type { DueReviewCard } from '../src/types/renderer'
import { getCardMastery } from '../src/shared/fsrs-metrics'

/** 构造一张到期卡片（字段就是队列返回的形状，写错字段名会被类型拦下） */
function dueCard(over: Partial<DueReviewCard> = {}): DueReviewCard {
  return {
    id: 'card_1',
    highlightId: 'hl_1',
    knowledgeCardId: null,
    methodologyId: null,
    sourceKind: 'highlight',
    sourceId: 'hl_1',
    label: '划线',
    front: '这是一条划线原文',
    back: null,
    detail: null,
    sourceLine: '《测试书》 · 第一章',
    state: 2,
    step: 2,
    stability: 46.35,
    difficulty: 2.09,
    due: '2026-09-15T00:00:00.000Z',
    lastReview: '2026-07-20T00:00:00.000Z',
    elapsedDays: 44,
    scheduledDays: 44,
    reps: 4,
    lapses: 0,
    bookId: 'book_1',
    bookTitle: '测试书',
    ...over,
  }
}

/** 安装一个可写的 electronAPI stub（setup.ts 的 Proxy 只能读，无法注入返回值） */
function installApi(overrides: {
  dueCards?: DueReviewCard[]
  reviewResult?: unknown
  reviewError?: Error
}) {
  const review = vi.fn(async () => {
    if (overrides.reviewError) throw overrides.reviewError
    return overrides.reviewResult
  })
  const getDueWithContent = vi.fn(async () => overrides.dueCards ?? [])
  Object.defineProperty(window, 'electronAPI', {
    value: {
      card: { getDueWithContent, review },
      fsrs: { previewReviewRatings: vi.fn(async () => []) },
    },
    writable: true,
    configurable: true,
  })
  return { review, getDueWithContent }
}

const INITIAL = {
  dueCards: [] as DueReviewCard[],
  currentIndex: 0,
  showAnswer: false,
  completed: 0,
  loading: false,
  error: null as string | null,
  previews: [] as RatingPreview[],
  lastMasteryDelta: null,
  roundStats: {
    reviewed: 0,
    stabilityBeforeSum: 0,
    stabilityAfterSum: 0,
    improved: 0,
    declined: 0,
    unchanged: 0,
    furthestDue: null as string | null,
  },
}

describe('reviewStore — 掌握度反馈链路', () => {
  beforeEach(() => {
    useReviewStore.setState({ ...INITIAL })
  })

  it('fetchDueCards 拉取到期卡片并重置本轮统计', async () => {
    installApi({ dueCards: [dueCard()] })
    useReviewStore.setState({ roundStats: { ...INITIAL.roundStats, reviewed: 9 } })
    await useReviewStore.getState().fetchDueCards()
    const s = useReviewStore.getState()
    expect(s.dueCards).toHaveLength(1)
    expect(s.roundStats.reviewed).toBe(0)
    expect(s.lastMasteryDelta).toBeNull()
    expect(s.error).toBeNull()
  })

  it('rateCard 捕获 card.review() 的返回值并算出掌握度增量', async () => {
    const before = dueCard({ stability: 46.35, difficulty: 2.09, reps: 4, lapses: 0 })
    const after = dueCard({ stability: 159.46, difficulty: 2.08, reps: 5, lapses: 0 })
    const expectedBefore = getCardMastery({ stability: 46.35, difficulty: 2.09, reps: 4, lapses: 0 })
    const expectedAfter = getCardMastery({ stability: 159.46, difficulty: 2.08, reps: 5, lapses: 0 })
    const api = installApi({ dueCards: [before], reviewResult: { reviewId: 'rev_1', card: after } })
    useReviewStore.setState({ dueCards: [before] as never, currentIndex: 0 })
    await useReviewStore.getState().rateCard(3)
    const s = useReviewStore.getState()
    expect(api.review).toHaveBeenCalledWith('card_1', 3)
    expect(s.lastMasteryDelta).not.toBeNull()
    expect(s.lastMasteryDelta?.before).toBe(expectedBefore.score)
    expect(s.lastMasteryDelta?.after).toBe(expectedAfter.score)
    expect(s.lastMasteryDelta?.after).toBeGreaterThan(s.lastMasteryDelta?.before ?? 0)
    expect(s.roundStats.reviewed).toBe(1)
    expect(s.roundStats.improved).toBe(1)
    expect(s.roundStats.declined).toBe(0)
    // 稳定性前后累计必须来自真实返回值，而不是估算
    expect(s.roundStats.stabilityBeforeSum).toBeCloseTo(46.35, 5)
    expect(s.roundStats.stabilityAfterSum).toBeCloseTo(159.46, 5)
    expect(s.completed).toBe(1)
    // 承诺句需要知道"下次什么时候再来问"
    expect(s.lastMasteryDelta?.nextReviewAt).toBe(after.due)
    expect(s.roundStats.furthestDue).toBe(after.due)
  })

  it('遗忘（Again）后掌握度下降计入 declined', async () => {
    const before = dueCard({ stability: 159.46, difficulty: 2.08, reps: 5, lapses: 0 })
    const after = dueCard({ stability: 12.3, difficulty: 2.1, reps: 3, lapses: 1 })
    installApi({ dueCards: [before], reviewResult: { reviewId: 'rev_2', card: after } })
    useReviewStore.setState({ dueCards: [before] as never, currentIndex: 0 })
    await useReviewStore.getState().rateCard(1)
    const s = useReviewStore.getState()
    expect(s.lastMasteryDelta?.after).toBeLessThan(s.lastMasteryDelta?.before ?? 0)
    expect(s.roundStats.declined).toBe(1)
    expect(s.roundStats.improved).toBe(0)
  })

  it('连续评分累计本轮统计，最后一张后索引停在原位', async () => {
    const c1 = dueCard({ id: 'card_1', stability: 10, reps: 3 })
    const c2 = dueCard({ id: 'card_2', stability: 20, reps: 4 })
    const api = installApi({ dueCards: [c1, c2] })
    const due1 = '2026-10-01T00:00:00.000Z'
    const due2 = '2026-12-25T00:00:00.000Z'
    api.review
      .mockResolvedValueOnce({ reviewId: 'r1', card: dueCard({ stability: 30, reps: 4, due: due1 }) })
      .mockResolvedValueOnce({ reviewId: 'r2', card: dueCard({ stability: 60, reps: 5, due: due2 }) })
    useReviewStore.setState({ dueCards: [c1, c2] as never })
    await useReviewStore.getState().rateCard(3)
    expect(useReviewStore.getState().currentIndex).toBe(1)
    await useReviewStore.getState().rateCard(3)
    const s = useReviewStore.getState()
    expect(s.completed).toBe(2)
    expect(s.roundStats.reviewed).toBe(2)
    expect(s.roundStats.stabilityBeforeSum).toBeCloseTo(30, 5)
    expect(s.roundStats.stabilityAfterSum).toBeCloseTo(90, 5)
    expect(s.currentIndex).toBe(1)
    // furthestDue 取两张里更晚的那个（完成态「最远的一张能记到」用它）
    expect(s.roundStats.furthestDue).toBe(due2)
  })

  it('评分失败时记录错误且不推进进度', async () => {
    const c1 = dueCard()
    installApi({ dueCards: [c1], reviewError: new Error('IPC call failed') })
    useReviewStore.setState({ dueCards: [c1] as never })
    await useReviewStore.getState().rateCard(3)
    const s = useReviewStore.getState()
    expect(s.error).toBe('IPC call failed')
    expect(s.completed).toBe(0)
    expect(s.roundStats.reviewed).toBe(0)
  })

  it('主进程返回空 card 时不抛错（防御 IPC 异常返回）', async () => {
    const c1 = dueCard()
    installApi({ dueCards: [c1], reviewResult: { reviewId: 'r', card: undefined } })
    useReviewStore.setState({ dueCards: [c1] as never })
    await useReviewStore.getState().rateCard(3)
    const s = useReviewStore.getState()
    expect(s.error).toBeNull()
    expect(s.lastMasteryDelta?.after).toBe(0)
    expect(s.completed).toBe(1)
  })
})
