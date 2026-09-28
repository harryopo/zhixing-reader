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
