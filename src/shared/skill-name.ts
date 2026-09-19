/**
 * Skill 英文名行的纯计算 —— 与 AI 调用解耦，才能被单测逐条钉住。
 *
 * 提示词模板里 `{{nameEn}}` 顶在「触发场景:」前面，所以这一行要么自带行尾换行、
 * 要么整行消失。直接塞裸名字会把下一行顶成 `Pomodoro触发场景: ...`。
 */

/** 中文 slug 化后为空（`\w` 只认 ASCII）—— 与其留一个空标签，不如不写这一行 */
export function formatSkillNameEnLine(name: string, nameEn?: string): string {
  const en = (nameEn ?? '').trim() || slugify(name)
  return en ? `英文名称: ${en}\n` : ''
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
}
