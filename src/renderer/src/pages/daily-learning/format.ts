/** 每日学习页的纯格式化函数（从 DailyLearning.tsx 原样搬出，逻辑未改） */
import type { Article } from './constants'

export function formatRelativeTime(dateStr: string | undefined): string {
  if (!dateStr) return ''
  const diff = new Date(dateStr).getTime() - Date.now()
  if (diff <= 0) return '现在'
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}分钟后`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时后`
  return `${Math.floor(hours / 24)}天后`
}

/**
 * 数据库的 0/1 → 真正的 boolean。
 *
 * **这里踩过一次坑**：sql.js 从 SQLite 读出来的 `is_read` 是**数字** 0/1，
 * 而类型上写的是 `boolean`（类型在撒谎）。于是任务行里的
 * `{task.done && <Icon/>}` 在未读时求值为数字 `0`，
 * 而 React 会把数字 0 当文本渲染出来 —— 任务标题前面就凭空多出一个「0」。
 *
 * 修法是在**边界处**把类型掰正（而不是在每个渲染点去防它）：
 * 数据进来就变成真 boolean，后面所有 `&&`、`if` 都恢复成正常的布尔语义。
 */
export function normalizeArticle(raw: Record<string, unknown>): Article {
  return {
    ...(raw as unknown as Article),
    is_read: Number(raw.is_read) === 1,
    is_favorite: Number(raw.is_favorite) === 1,
  }
}

