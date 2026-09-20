/** CSV 单元格转义 —— 放 shared 是为了让「列清单 + 取数 + 转义」这条链能被测试直接打到 */

/** null / undefined 一律导出空串，不能变成字面量 "undefined" */
export function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}
