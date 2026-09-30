/**
 * 测试夹具：Agent Skills 那份目录规范的**检查器**
 *
 * 为什么住在 tests/ 而不是 src/shared/：被检查的东西（`SKILL.md`）是我们自己生成的，
 * 从 handler 的输入进不了"不合规"那一支 —— 把校验器塞进生产代码就是留一条没人能走到的分支
 * （本项目清掉过一整批 `?? 0` 那种死兜底，同一个道理）。所以规范写在测试这一侧：
 * **它是外部客户端的规则，不是我们实现的一部分**，两个测试文件共用这一份，不各写一遍。
 *
 * 规则出处（方案书 §第 4 批 / Agent Skills 目录规范）：
 * `name` ≤64、`^[a-z0-9][a-z0-9-]*$`、且必须等于所在目录名；`description` ≤1024；正文 <500 行。
 */

export const NAME_MAX = 64
export const DESCRIPTION_MAX = 1024
/** 正文到达这个行数即不合规（规范是「<500 行」） */
export const BODY_MAX_LINES = 500

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/

/** frontmatter 里那两行的值：带引号就按 JSON 那一套解，不带就原样 */
function readValue(raw: string): string {
  const value = raw.trim()
  if (value.startsWith('"')) {
    try {
      return JSON.parse(value) as string
    } catch {
      return ''
    }
  }
  return value
}

function parseFrontmatter(text: string): Record<string, string> | null {
  if (!text.startsWith('---\n')) return null
  const frontEnd = text.indexOf('\n---', 3)
  if (frontEnd < 0) return null
  const fields: Record<string, string> = {}
  for (const line of text.slice(4, frontEnd).split('\n')) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    fields[line.slice(0, colon).trim()] = readValue(line.slice(colon + 1))
  }
  return fields
}

function countBodyLines(text: string, frontEnd: number): number {
  const after = text.slice(frontEnd + 1)
  const body = after.slice(after.indexOf('\n') + 1)
  const lines = body.split('\n')
  return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length
}

/** 交回一句句人话；空数组就是合规 */
export function checkSkill(text: string, dirName: string): string[] {
  const fields = parseFrontmatter(text)
  if (!fields) return ['文件开头没有 frontmatter']
  const problems: string[] = []
  const name = fields.name ?? ''
  const description = fields.description ?? ''
  if (!name) problems.push('name 没写')
  if (!description) problems.push('description 没写')
  if (name.length > NAME_MAX) problems.push(`name 超过 ${NAME_MAX} 字符`)
  if (name && !NAME_PATTERN.test(name)) problems.push('name 的字符式样不对')
  if (name && name !== dirName) problems.push(`name（${name}）与目录名（${dirName}）不等`)
  if (description.length > DESCRIPTION_MAX) problems.push(`description 超过 ${DESCRIPTION_MAX} 字符`)
  const lines = countBodyLines(text, text.indexOf('\n---', 3))
  if (lines >= BODY_MAX_LINES) problems.push(`正文 ${lines} 行，上限是 ${BODY_MAX_LINES - 1} 行`)
  return problems
}

/** frontmatter + 正文的期望形状：正文必须一字不改地排在收尾那行 `---` 之后 */
export function skillBody(text: string): string {
  const after = text.slice(text.indexOf('\n---', 3) + 1)
  return after.slice(after.indexOf('\n') + 1)
}
