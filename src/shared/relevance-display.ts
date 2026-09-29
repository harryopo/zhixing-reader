/**
 * 检索相关度的显示口径（渲染层与面板共用一份）
 *
 * 为什么要单独一个模块：`src/shared/retrieval.ts` 交回的 `relevanceScore` 是 **BM25 原始分**，
 * 它没有上界 —— 实测六条小语料里顶部命中就是 5.47，开发库 934 条划线上门量到过 17.2。
 * 而界面上原先写的是 `Math.round(score * 100)` 再加一个 `%`，等于把"原始分"当"0-1 比率"用，
 * 结果那条引用会显示成「相关度 547%」/「1720%」。
 *
 * 只有一个诚实的百分比可说：**与本次最相关那条比**。第一条恒为 100%，弱命中的按比例降。
 * 拿不到可比的分数时回 `null` —— 让调用方什么都不显示，而不是编一个 0% 出来。
 */

/** 本次检索里最相关那条的分数（用于相对比较的分母） */
export function topRelevanceScore(scores: Array<number | undefined>): number | null {
  let top: number | null = null
  for (const s of scores) {
    if (typeof s !== 'number' || !Number.isFinite(s) || s <= 0) continue
    if (top === null || s > top) top = s
  }
  return top
}

/**
 * 某条命中相对最相关那条的百分比（1–100）；没有可比对象时回 null。
 *
 * 分母为 0 / 缺分时不猜 0%：那会让"这次检索其实只命中一条"看起来像"命中了一条但完全不相关"。
 */
export function relativeRelevancePercent(
  score: number | undefined,
  top: number | null
): number | null {
  if (top === null) return null
  if (typeof score !== 'number' || !Number.isFinite(score) || score <= 0) return null
  const ratio = Math.round((score / top) * 100)
  if (ratio <= 0) return 1 // 比最相关那条弱两个数量级也要有个数，别说成 0%
  return Math.min(100, ratio)
}
