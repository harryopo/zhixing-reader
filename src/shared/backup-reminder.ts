/**
 * 「多久没备份了」的判定 —— 纯函数，通知面板与设置页共用一张嘴。
 *
 * 数据只存在这台电脑上（没有云端账号），备份是唯一能把书、划线、复习进度、
 * AI 生成的东西带走的方式。所以这件事值得在通知里占一行：
 * 但从没备份过的新用户只有一行平实的说明，不做强提醒（不挂红点、不弹窗）。
 */

/** 超过这么多天没导出过备份，就算"该备份了" */
export const BACKUP_STALE_DAYS = 30

const DAY_MS = 86_400_000

export type BackupReminderKind = 'never' | 'stale' | 'fresh'

export interface BackupReminder {
  kind: BackupReminderKind
  /** 距上次备份的天数；从没备份过 / 时间读不出来时为 null */
  days: number | null
  /** `fresh` 时是 null —— 刚备份过没必要占面板的地方 */
  text: string | null
}

/** 设置里存的可能是空串或脏值，只接受"能解析且不在未来"的时间 */
function parseTime(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string' || raw.trim() === '') return null
  const at = new Date(raw).getTime()
  return Number.isFinite(at) ? at : null
}

export function describeBackupReminder(
  lastExportAt: string | null | undefined,
  now: Date = new Date(),
): BackupReminder {
  const at = parseTime(lastExportAt)
  if (at === null) {
    return { kind: 'never', days: null, text: '还没有导出过备份 · 数据只存在这台电脑上' }
  }
  const days = Math.floor((now.getTime() - at) / DAY_MS)
  // 时钟被改到过去（或系统时间跳了）：按"刚备份过"处理，不编一个负数天数
  if (days < BACKUP_STALE_DAYS) {
    return { kind: 'fresh', days: Math.max(days, 0), text: null }
  }
  const label = new Date(at).toLocaleDateString('zh-CN')
  return { kind: 'stale', days, text: `上次备份是 ${label} · 已经 ${days} 天` }
}
