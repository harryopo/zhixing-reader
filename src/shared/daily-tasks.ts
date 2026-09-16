/**
 * 每日学习 —— 今日任务清单（纯逻辑，无 React / 无 IPC）
 *
 * ## 为什么单独抽出来
 * 2026-09-16，用户看着「每日学习」说了一句：
 * **「这些真的能做吗，能做的放进去，不能做只是形式的删去」**。
 *
 * 当时清单上有 8 项，其中 4 项是纯形式：
 *   - 整理今日笔记
 *   - AI 对话：探讨今日阅读内容
 *   - 写卡片笔记 2 张
 *   - 总结反思今日（点一下就弹 toast 说"已完成"）
 * 它们的共同点是**没人知道你做没做**：标题里的数字是编的，勾是自己点的。
 * 于是进度环变成一个自欺欺人的数字 —— 而这正是这个项目一直在治的病。
 *
 * ## 唯一准入标准
 * **每个任务都必须有"系统自己知道做没做"的判定依据**：
 *
 * | 任务 | 判定依据（真数据） |
 * |------|--------------------|
 * | 阅读 | `articles.is_read`（阅读器里点「标记已读」） |
 * | 复习 | 卡片队列 `actionable` 归零（复习页真实消耗，与首页同源） |
 * | 生词 | `vocabulary.last_review_at` / `is_mastered` |
 * | 对话 | `conversations.updated_at`（今天真的聊过） |
 *
 * 抽成纯函数的第二个原因：**这条规矩要能被测试钉住**。
 * 见 `tests/daily-tasks.test.ts` —— 那里有一条测试专门守着"不许再出现没有判定依据的任务"。
 */

/** 任务标签（决定右侧色块） */
export type DailyTaskTag = 'read' | 'review' | 'vocab' | 'chat'

/** 点这一行会发生什么 —— 每个任务都必须有真实去处 */
export type DailyTaskAction = 'article' | 'review' | 'vocab' | 'chat' | 'fetch'

export interface DailyTask {
  id: string
  title: string
  /** 副标题必须是**真实数据**（真实数量 / 真实状态） */
  meta: string
  category: string
  tag: DailyTaskTag
  /** 由真实数据算出，不是用户手点的勾 */
  done: boolean
  action: DailyTaskAction
  /** 仅阅读任务：指向 articles 数组的下标 */
  articleIndex?: number
}

export interface DailyTaskArticle {
  id: string
  titleEn: string
  isRead: boolean
  /** 正文词数（用于估算阅读时长） */
  wordCount: number
}

export interface DailyTaskQueue {
  reviewDue: number
  newAllowance: number
  actionable: number
}

export interface DailyTaskInput {
  articles: DailyTaskArticle[]
  /** 卡片队列；未加载出来时传 null，这一项就先不出现（宁可少一项，也不编） */
  queue: DailyTaskQueue | null
  vocabulary: {
    /** 生词本总数（0 表示还没用过这个功能，不排任务） */
    total: number
    /** 尚未掌握的词数 */
    pending: number
    /** 今天真的复习过的词数（last_review_at 是今天） */
    learnedToday: number
  }
  chattedToday: boolean
  /** 今日已复习卡片数（daily_stats.cards_reviewed），用于已完成态的说明 */
  cardsReviewedToday: number
}

/** 每天最多排几篇阅读（排太多等于没排） */
export const DAILY_READING_TASKS = 2
/** 每天学几个生词的目标 */
export const DAILY_VOCAB_GOAL = 5
/** 英文阅读速度（词/分钟），仅用于「约 X 分钟」的估算 */
const WORDS_PER_MINUTE = 200

/** 截断长标题 */
export function truncateTitle(text: string, max = 24): string {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '…' : text
}

/** 按词数估算阅读时长（至少 1 分钟，且明确标成「约」） */
export function estimateReadingMinutes(wordCount: number): number {
  const words = Number.isFinite(wordCount) && wordCount > 0 ? wordCount : 0
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE))
}

/**
 * 生成今日任务清单。
 *
 * 顺序即建议顺序：先读、再复习、再学词、最后和 AI 聊。
 */
export function buildDailyTasks(input: DailyTaskInput): DailyTask[] {
  const { articles, queue, vocabulary, chattedToday, cardsReviewedToday } = input
  const list: DailyTask[] = []

  // ① 阅读：只排**没读过的**文章。已读的不该出现在今天的清单里。
  const unread = articles.filter((a) => !a.isRead).slice(0, DAILY_READING_TASKS)
  for (const article of unread) {
    list.push({
      id: `task-read-${article.id}`,
      title: `阅读《${truncateTitle(article.titleEn)}》`,
      meta: `约 ${estimateReadingMinutes(article.wordCount)} 分钟 · ${article.wordCount} 词`,
      category: '阅读',
      tag: 'read',
      done: false,
      action: 'article',
      articleIndex: articles.findIndex((a) => a.id === article.id),
    })
  }
  if (unread.length === 0) {
    list.push({
      id: 'task-fetch',
      title: '获取新的英文文章',
      meta: articles.length > 0 ? '现有文章都读完了' : '还没有文章',
      category: '阅读',
      tag: 'read',
      done: false,
      action: 'fetch',
    })
  }

  // ② 复习：真实的卡片队列（到期复习卡 + 今天还剩多少新卡额度）
  if (queue) {
    const cleared = queue.actionable === 0
    list.push({
      id: 'task-review',
      title: cleared
        ? '今天的卡片已清空'
        : queue.reviewDue > 0
          ? `复习 ${queue.reviewDue} 张到期的卡片`
          : `学 ${queue.newAllowance} 张新卡`,
      meta: cleared
        ? `今天已复习 ${cardsReviewedToday} 张`
        : `到期 ${queue.reviewDue} 张 · 今日新卡额度 ${queue.newAllowance} 张`,
      category: '复习',
      tag: 'review',
      done: cleared,
      action: 'review',
    })
  }

  // ③ 生词：以「今天真的复习过几个」判定 ——
  //    而不是把「还有 12 个待掌握」当成一个永远做不完的清单（那是 931 张卡片的老毛病）
  if (vocabulary.total > 0) {
    const goal = Math.min(DAILY_VOCAB_GOAL, vocabulary.pending)
    list.push({
      id: 'task-vocab',
      title: vocabulary.pending === 0 ? '生词都掌握了' : `学 ${goal} 个生词`,
      meta: `今天已学 ${vocabulary.learnedToday} 个 · 还有 ${vocabulary.pending} 个待掌握`,
      category: '生词',
      tag: 'vocab',
      done: vocabulary.pending === 0 || vocabulary.learnedToday >= DAILY_VOCAB_GOAL,
      action: 'vocab',
    })
  }

  // ④ AI 对话：今天有没有真的聊过
  list.push({
    id: 'task-chat',
    title: chattedToday ? '今天已经和 AI 聊过了' : '和 AI 聊一聊今天读的内容',
    meta: chattedToday ? '对话已开始' : '今天还没聊',
    category: '对话',
    tag: 'chat',
    done: chattedToday,
    action: 'chat',
  })

  return list
}

/** 进度统计（进度环用） */
export function summarizeDailyTasks(tasks: DailyTask[]): { completed: number; total: number; percent: number } {
  const total = tasks.length
  const completed = tasks.filter((t) => t.done).length
  return { completed, total, percent: total > 0 ? Math.round((completed / total) * 100) : 0 }
}

/** 第一个没完成的任务（「开始今日学习」按钮用） */
export function firstUnfinishedTask(tasks: DailyTask[]): DailyTask | undefined {
  return tasks.find((t) => !t.done)
}
