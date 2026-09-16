// 知行读书 — 今日任务清单规则（src/shared/daily-tasks.ts）
//
// 用户原话：「这些真的能做吗，能做的放进去，不能做只是形式的删去」。
//
// 旧清单 8 项里 4 项是纯形式：标题里的数字是编的、勾是自己点的、
// 「总结反思今日」点一下就弹 toast 说已完成。这个文件就是防止它们回来。
//
// 这里守四件事：
//   1. **每个任务都必须有判定依据**（不许再出现没有数据支撑的任务）
//   2. 每个任务都必须有真实去处（action 必须能被页面兑现）
//   3. 完成与否只看数据，不看谁点了勾
//   4. 数量说实话（不虚报、不把「还有 12 个」说成今天的任务量）

import { describe, it, expect } from 'vitest'
import {
  buildDailyTasks,
  summarizeDailyTasks,
  firstUnfinishedTask,
  estimateReadingMinutes,
  DAILY_READING_TASKS,
  DAILY_VOCAB_GOAL,
  type DailyTaskInput,
} from '../src/shared/daily-tasks'

/** 默认输入：一切「空」的干净状态 */
function input(over: Partial<DailyTaskInput> = {}): DailyTaskInput {
  return {
    articles: [],
    queue: null,
    vocabulary: { total: 0, pending: 0, learnedToday: 0 },
    chattedToday: false,
    cardsReviewedToday: 0,
    ...over,
  }
}

const article = (id: string, isRead = false, words = 800) => ({
  id,
  titleEn: 'Article ' + id,
  isRead,
  wordCount: words,
})

describe('buildDailyTasks — 只排真实可兑现的事', () => {
  it('每个任务都有**真实判定依据**：不许出现"没人知道你做没做"的项', () => {
    const tasks = buildDailyTasks(
      input({
        articles: [article('a1'), article('a2'), article('a3', true)],
        queue: { reviewDue: 7, newAllowance: 15, actionable: 22 },
        vocabulary: { total: 12, pending: 12, learnedToday: 0 },
        chattedToday: false,
      }),
    )
    // 四项：2 篇阅读 + 复习 + 生词 + 对话
    expect(tasks.map((t) => t.tag)).toEqual(['read', 'read', 'review', 'vocab', 'chat'])
    // 旧清单里的「形式三兄弟」一个都不许回来
    const titles = tasks.map((t) => t.title).join('|')
    expect(titles).not.toContain('整理今日笔记')
    expect(titles).not.toContain('写卡片笔记')
    expect(titles).not.toContain('总结反思')
  })

  it('每个任务的 action 都必须能被页面兑现（不许有"点了弹个提示"的项）', () => {
    const tasks = buildDailyTasks(
      input({
        articles: [article('a1')],
        queue: { reviewDue: 0, newAllowance: 0, actionable: 0 },
        vocabulary: { total: 3, pending: 3, learnedToday: 0 },
        chattedToday: true,
      }),
    )
    const allowed = ['article', 'review', 'vocab', 'chat', 'fetch']
    for (const t of tasks) expect(allowed).toContain(t.action)
    // 阅读任务必须带得上文章下标，否则点了没反应
    const read = tasks.find((t) => t.action === 'article')
    expect(read?.articleIndex).toBe(0)
  })

  it('只排**没读过的**文章，最多 2 篇，且下标指回原数组', () => {
    const tasks = buildDailyTasks(
      input({ articles: [article('a1', true), article('a2'), article('a3'), article('a4')] }),
    )
    const reads = tasks.filter((t) => t.tag === 'read')
    expect(reads).toHaveLength(DAILY_READING_TASKS)
    expect(reads[0].articleIndex).toBe(1)
    expect(reads[1].articleIndex).toBe(2)
    expect(reads.some((t) => t.articleIndex === 0)).toBe(false)
  })

  it('文章全读完了 → 给出"获取新文章"，而不是留一个假的阅读任务', () => {
    const tasks = buildDailyTasks(input({ articles: [article('a1', true)] }))
    const read = tasks.find((t) => t.tag === 'read')
    expect(read?.action).toBe('fetch')
    expect(read?.done).toBe(false)
  })

  it('复习任务的数字来自**真实队列**，完成 = 今天该做的卡片清空', () => {
    const busy = buildDailyTasks(input({ queue: { reviewDue: 7, newAllowance: 15, actionable: 22 } }))
    const review = busy.find((t) => t.id === 'task-review')!
    expect(review.title).toBe('复习 7 张到期的卡片')
    expect(review.meta).toBe('到期 7 张 · 今日新卡额度 15 张')
    expect(review.done).toBe(false)

    const cleared = buildDailyTasks(
      input({ queue: { reviewDue: 0, newAllowance: 0, actionable: 0 }, cardsReviewedToday: 22 }),
    )
    const doneReview = cleared.find((t) => t.id === 'task-review')!
    expect(doneReview.done).toBe(true)
    expect(doneReview.meta).toBe('今天已复习 22 张')
  })

  it('只有新卡没有到期卡时，标题说"学新卡"而不是"复习 0 张"', () => {
    const tasks = buildDailyTasks(input({ queue: { reviewDue: 0, newAllowance: 15, actionable: 15 } }))
    expect(tasks.find((t) => t.id === 'task-review')!.title).toBe('学 15 张新卡')
  })

  it('队列还没加载出来（null）→ 这一项先不出现，宁可少一项也不编', () => {
    const tasks = buildDailyTasks(input({ queue: null }))
    expect(tasks.some((t) => t.id === 'task-review')).toBe(false)
  })

  it('生词：今天真的学够了才算完成 —— 「还有 12 个待掌握」不是今天的任务量', () => {
    const base = { total: 12, pending: 12 }
    const none = buildDailyTasks(input({ vocabulary: { ...base, learnedToday: 0 } }))
    expect(none.find((t) => t.id === 'task-vocab')!.done).toBe(false)
    expect(none.find((t) => t.id === 'task-vocab')!.title).toBe(`学 ${DAILY_VOCAB_GOAL} 个生词`)

    const some = buildDailyTasks(input({ vocabulary: { ...base, learnedToday: 2 } }))
    expect(some.find((t) => t.id === 'task-vocab')!.done).toBe(false)
    expect(some.find((t) => t.id === 'task-vocab')!.meta).toContain('今天已学 2 个')

    const enough = buildDailyTasks(input({ vocabulary: { ...base, learnedToday: DAILY_VOCAB_GOAL } }))
    expect(enough.find((t) => t.id === 'task-vocab')!.done).toBe(true)
  })

  it('生词本还没用过（总数 0）→ 不排生词任务，不制造"0 个待学"的假项', () => {
    const tasks = buildDailyTasks(input({ vocabulary: { total: 0, pending: 0, learnedToday: 0 } }))
    expect(tasks.some((t) => t.id === 'task-vocab')).toBe(false)
  })

  it('对话任务由 conversations.updated_at 判定，不用手点', () => {
    const no = buildDailyTasks(input({ chattedToday: false })).find((t) => t.id === 'task-chat')!
    expect(no.done).toBe(false)
    expect(no.meta).toBe('今天还没聊')

    const yes = buildDailyTasks(input({ chattedToday: true })).find((t) => t.id === 'task-chat')!
    expect(yes.done).toBe(true)
  })

  it('副标题里必须出现真实数字（阅读时长按词数估算，明确标「约」）', () => {
    const tasks = buildDailyTasks(input({ articles: [article('a1', false, 1000)] }))
    expect(tasks[0].meta).toBe('约 5 分钟 · 1000 词')
  })
})

describe('estimateReadingMinutes — 词数 → 分钟', () => {
  it('按 200 词/分钟估算，至少 1 分钟', () => {
    expect(estimateReadingMinutes(1000)).toBe(5)
    expect(estimateReadingMinutes(0)).toBe(1)
    expect(estimateReadingMinutes(-5)).toBe(1)
    expect(estimateReadingMinutes(Number.NaN)).toBe(1)
  })
})

describe('summarizeDailyTasks / firstUnfinishedTask', () => {
  const tasks = buildDailyTasks(
    input({
      articles: [article('a1')],
      queue: { reviewDue: 3, newAllowance: 0, actionable: 3 },
      chattedToday: true,
    }),
  )

  it('进度只数真实完成的任务', () => {
    const s = summarizeDailyTasks(tasks)
    expect(s.total).toBe(tasks.length)
    expect(s.completed).toBe(1) // 只有对话完成了
    expect(s.percent).toBe(Math.round((1 / tasks.length) * 100))
  })

  it('空清单不会算出 NaN%', () => {
    expect(summarizeDailyTasks([])).toEqual({ completed: 0, total: 0, percent: 0 })
  })

  it('「开始今日学习」跳到第一个没完成的', () => {
    expect(firstUnfinishedTask(tasks)?.id).toBe(tasks[0].id)
    expect(firstUnfinishedTask(tasks.filter((t) => t.done))).toBeUndefined()
  })
})
