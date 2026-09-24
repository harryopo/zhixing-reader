/**
 * `null` 是必须支持的输入：模板变量多数直接来自 sql.js 的行，
 * 而库里的可空列读出来就是 `null`（实现里本来就按"缺值"处理，签名之前却不含它）。
 */
export function renderTemplate(
  template: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    const value = vars[key]
    if (value === undefined || value === null || value === '') {
      return `{{${key}}}`
    }
    return String(value)
  })
}

export function extractVariables(template: string): string[] {
  const matches = template.matchAll(/\{\{(\w+)\}\}/g)
  const seen = new Set<string>()
  for (const m of matches) {
    seen.add(m[1])
  }
  return Array.from(seen)
}

export function highlightVariables(template: string): Array<{ text: string; isVariable: boolean; name?: string }> {
  const parts: Array<{ text: string; isVariable: boolean; name?: string }> = []
  const regex = /\{\{(\w+)\}\}/g
  let lastIndex = 0
  let match
  while ((match = regex.exec(template)) !== null) {
    if (match.index > lastIndex) {
      parts.push({ text: template.slice(lastIndex, match.index), isVariable: false })
    }
    parts.push({ text: match[0], isVariable: true, name: match[1] })
    lastIndex = regex.lastIndex
  }
  if (lastIndex < template.length) {
    parts.push({ text: template.slice(lastIndex), isVariable: false })
  }
  return parts
}
