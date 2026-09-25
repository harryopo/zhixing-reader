// 「多久没备份了」的判定（2026-09-25）
//
// 通知面板里那句关于备份的话只有一套规则：没备份过说一句、太久没备份说一句、
// 刚备份过一句都不说。规则收在 src/shared/backup-reminder.ts，这里钉住边界，
// 免得哪天变成常驻噪音（面板里那一行不该永远亮着）。

import { describe, it, expect } from 'vitest'
import {
  BACKUP_STALE_DAYS,
  describeBackupReminder,
} from '../src/shared/backup-reminder'

const NOW = new Date('2026-09-25T00:00:00Z')
const DAY_MS = 86_400_000
/** 相对今天往前 N 天的 ISO 串（设置里存的就是这个形状） */
const daysAgo = (n: number): string => new Date(NOW.getTime() - n * DAY_MS).toISOString()

describe('describeBackupReminder', () => {
  it('从没备份过：说一句实话，不编时间', () => {
    for (const raw of [null, undefined, '', '   ', 'not-a-date']) {
      const r = describeBackupReminder(raw, NOW)
      expect(r.kind, `输入 ${JSON.stringify(raw)} 应当算没备份过`).toBe('never')
      expect(r.days).toBeNull()
      expect(r.text).toContain('还没有导出过备份')
      expect(r.text).not.toContain('null')
      expect(r.text).not.toMatch(/^\s|\s$/)
    }
  })

  it('刚备份过：一个字都不说（面板不能永远亮着）', () => {
    for (const n of [0, 1, 7, BACKUP_STALE_DAYS - 1]) {
      const r = describeBackupReminder(daysAgo(n), NOW)
      expect(r.kind, `${n} 天前不该算久`).toBe('fresh')
      expect(r.text).toBeNull()
      expect(r.days).toBe(n)
    }
  })

  it('到点就说：正好 30 天起算「该备份了」，并带上日期与天数', () => {
    const r = describeBackupReminder(daysAgo(BACKUP_STALE_DAYS), NOW)
    expect(r.kind).toBe('stale')
    expect(r.days).toBe(BACKUP_STALE_DAYS)
    expect(r.text).toContain(`${BACKUP_STALE_DAYS} 天`)
    expect(r.text).toContain(new Date(daysAgo(BACKUP_STALE_DAYS)).toLocaleDateString('zh-CN'))
    // 给用户看的串里不该出现 ISO 时间戳
    expect(r.text).not.toContain('T')
    expect(r.text).not.toMatch(/\d{4}-\d{2}-\d{2}/)
  })

  it('时钟跳到了过去（或用户改过系统时间）：按刚备份过处理，不报负数天数', () => {
    const r = describeBackupReminder(daysAgo(-3), NOW)
    expect(r.kind).toBe('fresh')
    expect(r.days).toBe(0)
    expect(r.text).toBeNull()
  })

  it('反证：把阈值当 0 或把脏值当有效时间，判据就要响（防止规则空转）', () => {
    // 若哪天把 "at === null 就当刚备份过"，这一条会红
    expect(describeBackupReminder('', NOW).kind).not.toBe('fresh')
    // 若哪天把 NaN 当成 0 天前，这一条会红
    expect(describeBackupReminder('abc', NOW).kind).not.toBe('fresh')
    // 若哪天阈值失效（>=0 就报），昨天那条会被报出来
    expect(describeBackupReminder(daysAgo(1), NOW).text).toBeNull()
  })
})
