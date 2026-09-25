/** 每日学习页的纯格式化函数（从 DailyLearning.tsx 原样搬出，逻辑未改） */

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
