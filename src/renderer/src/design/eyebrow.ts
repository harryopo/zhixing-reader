/**
 * 小标题（eyebrow）样式 — 渲染层里那句"总览 / 阅读统计 / 设置分类"上方的大写小字
 *
 * 这里放的是**今天真实在用的九档**，不是设计出来的档位表：同一句小标题在 2026-10-18 之前
 * 被逐处手抄了 65 次、17 种写法，其中 57 次落在这九档上。收进来一个目的：
 * 以后要改字号或字距，改这九行，而不是去 15 个页面里逐处找。
 *
 * ⚠️ 已知欠账（归不归由维护者定，因为归了会改外观）：
 * `src/renderer/src/styles/design-tokens.css` 里有 `--font-size-xs: 0.75rem` 这样的字阶，
 * 而这九档用的是 0.7 / 0.72 / 0.74 / 0.75 / 0.78rem —— 除了 `eyebrow075`，没有一档踩在字阶上。
 * 把它们换成 `var(--font-size-*)` 会让多数小标题的字号发生变化，那是设计决定，不是这里的默认动作。
 */
import type { CSSProperties } from 'react'

/** 主力那一档：25 处（统计页、书架详情、档案页、每日学习、卡片与生词的页内小标题） */
export const eyebrow078: CSSProperties = {
  color: 'var(--muted-foreground)',
  fontSize: '0.78rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}

/** `eyebrow078` 加一条下内边距 —— 设置页那排分区标签的六份都这么写 */
export const eyebrow078Padded: CSSProperties = {
  ...eyebrow078,
  padding: '0 calc(var(--spacing) * 3) calc(var(--spacing) * 2)',
}

/** 设置页「智能体编排」那一段的小标题 */
export const eyebrow074Medium: CSSProperties = {
  color: 'var(--muted-foreground)',
  fontSize: '0.74rem',
  fontWeight: 500,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}

/** 方法论详情面板与生词抽屉：比 078 小一号、加粗 */
export const eyebrow072Bold: CSSProperties = {
  color: 'var(--muted-foreground)',
  fontSize: '0.72rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}

/** `eyebrow072Bold` 再带一条下外边距（方法论页的区块标题） */
export const eyebrow072BoldMarginBottom: CSSProperties = {
  ...eyebrow072Bold,
  marginBottom: '0.4rem',
}

/** 与方法论同一页里的另一种：0.72rem 但不加粗（每日学习页两处） */
export const eyebrow072: CSSProperties = {
  color: 'var(--muted-foreground)',
  fontSize: '0.72rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}

/** 唯一踩在字阶 `--font-size-xs`（0.75rem）上的那档 */
export const eyebrow075: CSSProperties = {
  color: 'var(--muted-foreground)',
  fontSize: '0.75rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}

/** 更小的两处标签：0.7rem、字距收紧到 0.04em */
export const eyebrow070Wide: CSSProperties = {
  color: 'var(--muted-foreground)',
  fontSize: '0.7rem',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
}

/** 生词页与生词抽屉的表头：0.7rem、加粗、字距 0.06em */
export const eyebrow070Bold: CSSProperties = {
  color: 'var(--muted-foreground)',
  fontSize: '0.7rem',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
}
