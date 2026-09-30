/**
 * profile-skill — 导出的画像包要能被外部 agent 客户端当成一个 Skill 目录读
 *
 * ## 为什么管这套格式
 * 语料包不是给人看一眼就丢的中间文件：它要交给别人的 AI 去读。Agent Skills 这套形状
 * 是目前最多客户端（Claude / Cursor / Codex / Gemini CLI 等）都认的入口 —— 前提是
 * **`name` 与所在目录名一字不差**。这一条写歪了不会报错，只是那个客户端静默不加载，
 * 用户那边表现为「我给了它文件夹，它说没读到东西」。
 *
 * ## 这一份只管生成
 * 规则（`name` ≤64 且 `^[a-z0-9][a-z0-9-]*$` 且等于目录名、`description` ≤1024、正文 <500 行）
 * 的**检查器住在 `tests/__fixtures__/skill-spec.ts`**，不在这里：要被检查的文件是我们自己
 * 生成的，从任何输入都走不进"不合规"那一支 —— 把校验器塞进生产代码就是留一条没人能走到的分支
 * （本项目删掉过一整批这种死兜底）。规范是外部客户端定的，所以它属于判据那一侧。
 *
 * 纯函数：不碰 fs。
 */

/** 目录名 = frontmatter 的 name，两处同一个常量，不给第二次写歪的机会 */
export const SKILL_DIR_NAME = 'zhixing-reader-profile'
export const SKILL_FILE_NAME = 'SKILL.md'
export const README_FILE_NAME = 'README.md'

/**
 * 这一份是干什么的 —— 客户端列出来的就是这句，所以要让它一眼看懂"读完该交回什么"。
 * 上限 1024 字符由判据核（`checkSkill`）。
 */
export const SKILL_DESCRIPTION =
  '知行读书导出的阅读画像语料包：三层证据（我说的 / 我挑的 / 我选的）加一份 manifest。' +
  '读它的是外部 AI —— 读完请写回一份 statements.json 结论清单（形状见 README.md），交回应用逐条核验。' +
  '应用内不调用任何模型。'

/**
 * frontmatter + 正文，一次拼好。
 *
 * 值走 JSON 引号：`description` 里有 `: ` 时不加引号会被 YAML 解成键值错位
 * （客户端报的可能是"没有 name"，而 name 明明在 —— 这类"文档形状自己咬人"最难查）。
 */
export function buildSkillFile(input: { name: string; description: string; body: string }): string {
  return `---\nname: ${input.name}\ndescription: ${JSON.stringify(input.description)}\n---\n${input.body}`
}
