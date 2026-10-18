/**
 * 库里那一列的时间到底是什么时刻 —— 全项目只有这一处判定。
 *
 * 两种形状都真实存在于库里：
 *  - `datetime('now')` 的默认值、以及划线导入写回的 `toSqliteDateTime`：
 *    'YYYY-MM-DD HH:MM:SS'，是 **UTC 的墙上时钟**，串里不带任何时区标记；
 *  - fsrs-engine 的 `due`、微信读书那条 `last_read_time`：带 `Z` 的 ISO。
 *
 * 而 `new Date('2026-09-28 03:15:00')` 按**本地时区**解释那一串 —— 在 UTC+8 上，
 * 刚划的一条线会被读成 8 小时前（实测偏差 8.0002 小时）。表现有三处，全在同一条
 * 因果上：笔记页那句「X 小时前」、导出的读书笔记里那行「**时间**」、以及划线列表
 * 与按天归集读到的时刻。所以渲染层与主进程共用这一把尺，不再各写一份 `new Date(...)`。
 *
 * 只做一件事：给没有偏移标记的「日期 空格 时间」补上 `Z`。带 `Z` 或带 `+08:00`
 * 的串照它自己声明的时区走；纯日期串（`2026-09-28`）JS 本来就按 UTC 解，不去动它。
 */
const NAIVE_SQLITE_DATE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})(?::(\d{2}))?$/

/** 解析不出来、没有值、或不是字符串/数字 ⇒ null（不猜 1970，也不返回 undefined） */
export function parseDbTime(val: unknown): Date | null {
  // 0 在这里算「没有值」：epoch 那一刻不可能是任何一条阅读记录的时刻
  if (!val) return null
  if (typeof val !== 'string' && typeof val !== 'number') return null

  if (typeof val === 'string') {
    const naive = NAIVE_SQLITE_DATE.exec(val.trim())
    if (naive) {
      const parsed = new Date(`${naive[1]}T${naive[2]}:${naive[3] ?? '00'}Z`)
      return Number.isNaN(parsed.getTime()) ? null : parsed
    }
  }

  const parsed = new Date(val)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** 交回带 `Z` 的 ISO；解不出来回空串（界面据此不显示，而不是显示 1970） */
export function dbTimeIso(val: unknown): string {
  const parsed = parseDbTime(val)
  return parsed ? parsed.toISOString() : ''
}

/**
 * 那一列到底是**哪一刻**（epoch 毫秒）；缺失或解不出来一律 `null`。
 *
 * 排序、按年筛选这类"把它变成一个可比的数"的活都问这里，不再各自 `new Date(x).getTime()` + `isNaN`：
 * 直接 `new Date(...)` 对没有时区标记的那一串会按本地时区解释（早 8 小时），而 `isNaN` 只挡得住
 * 一种坏形状。`null` 让调用方自己决定"不知道"怎么处理 —— 当成 0 混进有效时间里是一种说法，
 * 丢出这一列又是另一种说法，两处视图本来就各选了不同的做法，不该由一次重构替它们统一。
 */
export function dbTimeEpoch(val: unknown): number | null {
  return parseDbTime(val)?.getTime() ?? null
}

/**
 * 那一刻在**这台机器本地**属于哪一天（`YYYY-MM-DD`）。
 *
 * 2026-10-17 立的唯一口径。此前「哪一天」有两种算法各写各的：
 *  - 写入侧（`daily_stats` 的四个方法、微信读书 readTimes 的换算）用 `toISOString().split('T')[0]`
 *    = **UTC 日**；
 *  - 读取侧（`recentDayKeys`、`profile-stats.localDateStr`）用**本地日**，两边注释都写着
 *    「用 toISOString 会在 UTC+8 的凌晨把今天算成昨天」。
 *  同一列两种口径 ⇒ UTC+8 上每天 00:00–08:00 的活动记进昨天那一格。
 *
 * 不许在这里改成 `toISOString`：那一串是 UTC 日，与本函数的语义相反。
 */
export function localDayKey(d: Date): string {
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

/**
 * 导出文件的名字上那串时间 —— `YYYYMMDD-HHmm`，同样问这一把尺（本地时刻，不按 UTC 切）。
 *
 * 用量页与统计页原先各写了一份一模一样的实现（两处注释都只写「时间戳格式化」），
 * 精确到分钟这件事没人核对过：一边以后改成带秒，两个导出文件的命名就分家了。
 */
export function localFileStamp(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

/** 库里那一列的时刻属于本地哪一天；解不出来一律 null（不猜 1970，也不把脏值画成一个日期） */
export function dayKeyOfStoredTime(val: unknown): string | null {
  const parsed = parseDbTime(val)
  return parsed ? localDayKey(parsed) : null
}

/**
 * 那一时刻与 `dayKey`（必须是 `localDayKey` 算出来的本地日键）是不是同一天；解不出来 ⇒ false。
 *
 * 「今天做过没有」这类判定全应用只许走这一条。参数收**日键**而不是 `Date`：
 * 调用方本来就把"今天"存在一个变量里（并按它做依赖），收 Date 会让那个变量变成
 * 一条没人读、却挂着依赖数组的假依赖。
 * 脏值返回 false 是有意的 —— "读不出时间"不许被演成"今天已经完成了"，那种假完成界面上看不出来。
 */
export function isSameLocalDay(val: unknown, dayKey: string): boolean {
  return dayKeyOfStoredTime(val) === dayKey
}

const DAY_MS = 86400000

/**
 * 日历日键加减若干天（`'YYYY-MM-DD'` → 同形状），输入不是真实存在的日子 ⇒ null。
 *
 * 走 `Date.UTC` 再读回 UTC 字段：这样"加减天数"是纯日历算术，不受本机时区与
 * 夏令时影响（用本地 `setDate()` 做同样的事，在有夏令时的时区上会歪一天）。
 * 读回后还要与输入逐字段比对 —— `Date.UTC(2026, 12, 45)` 不报错而是滚成 2027-02-14，
 * 少了这一步，`'2026-13-45'`、`'2026-02-30'` 这种脏键会被演成"算对了"。
 */
export function shiftDayKey(dayKey: string, delta: number): string | null {
  if (typeof dayKey !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) return null
  if (!Number.isInteger(delta)) return null
  const y = Number(dayKey.slice(0, 4))
  const m = Number(dayKey.slice(5, 7))
  const d = Number(dayKey.slice(8, 10))
  const base = new Date(Date.UTC(y, m - 1, d))
  if (base.getUTCFullYear() !== y || base.getUTCMonth() !== m - 1 || base.getUTCDate() !== d) return null
  const moved = new Date(base.getTime() + delta * DAY_MS)
  const mm = String(moved.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(moved.getUTCDate()).padStart(2, '0')
  return `${moved.getUTCFullYear()}-${mm}-${dd}`
}

/**
 * 「近 N 天」的闭区间窗口（含今天，今天按本地日算）。
 *
 * 统计页与用量页原先各写一份，都用 `setHours(0,0,0,0)` + `toISOString()` 求起始日 ——
 * 本地零点在东八区是**前一天 16:00 UTC**，于是取出来的日子往前多一天：
 * 实测 `getStatsRangeDates('7d')` 交回 10-10…10-17，**闭区间 8 天**，
 * 而消费方对每一行求和、还把行数当"天数"显示 ⇒ 界面说近 7 天、算的是 8 天。
 * `days` 不是正整数时按 1 天收口（不给"半个窗口"，也不给 NaN 起止）。
 */
export function windowEndingToday(days: number, now: Date): { startDate: string; endDate: string } {
  const endDate = localDayKey(now)
  const n = Number.isInteger(days) && (days as number) > 0 ? days : 1
  return { startDate: shiftDayKey(endDate, -(n - 1)) ?? endDate, endDate }
}
