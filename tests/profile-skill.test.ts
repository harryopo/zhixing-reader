/**
 * profile-skill —— 导出的画像包能不能被外部 agent 当成一个 Skill 读
 *
 * 检查器住在 `tests/__fixtures__/skill-spec.ts`（那是外部客户端的规则，不是我们的实现）。
 * 这个文件判两件事：我们生成的形状对（值加引号、正文一字不改），以及我们生成的那份
 * **真过得了规范检查** —— 后者才是"客户端静默不加载"这条静默失败的出口。
 */
import { describe, it, expect } from 'vitest'
import { SKILL_DIR_NAME, SKILL_FILE_NAME, README_FILE_NAME, SKILL_DESCRIPTION, buildSkillFile } from '../src/shared/profile-skill'
import { checkSkill, skillBody, NAME_MAX, DESCRIPTION_MAX, BODY_MAX_LINES } from './__fixtures__/skill-spec'

function skill(over: { name?: string; description?: string; body?: string } = {}) {
  return buildSkillFile({
    name: over.name ?? SKILL_DIR_NAME,
    description: over.description ?? SKILL_DESCRIPTION,
    body: over.body ?? '# 怎么用\n\n把 corpus 里的 jsonl 交给 AI。\n',
  })
}

describe('我们生成的那份', () => {
  it('过得了规范检查（name 与目录名同源，写歪就是客户端不加载）', () => {
    expect(checkSkill(skill(), SKILL_DIR_NAME)).toEqual([])
  })

  it('正文一字不改地排在收尾那行 `---` 之后', () => {
    expect(skillBody(skill({ body: '第一行\n第二行\n' }))).toBe('第一行\n第二行\n')
  })

  it('说明里有 ASCII 冒号时值被引起来 —— 不加引号 YAML 会把这一行解成键值错位', () => {
    const text = skill({ description: 'usage: read manifest first' })
    expect(text).toContain('description: "usage: read manifest first"')
    expect(checkSkill(text, SKILL_DIR_NAME)).toEqual([])
  })

  it('真实那份说明没超上限（判据核的是常量本身，不是抄一遍数）', () => {
    expect(SKILL_DESCRIPTION.length).toBeLessThanOrEqual(DESCRIPTION_MAX)
  })

  it('两个入口文件名与目录名各只有一份常量', () => {
    expect(SKILL_FILE_NAME).toBe('SKILL.md')
    expect(README_FILE_NAME).toBe('README.md')
    expect(SKILL_DIR_NAME).toBe('zhixing-reader-profile')
  })
})

describe('检查器自己有牙（负向判据配得上"该发生的确实发生"）', () => {
  it('上一批我手写的那份 markdown 没有 frontmatter ⇒ 判红', () => {
    expect(checkSkill('# 阅读画像导出 · 本次产物说明\n\n生成：2026-09-29\n', SKILL_DIR_NAME)).toEqual([
      '文件开头没有 frontmatter',
    ])
  })

  it('name 与目录名不等 ⇒ 单独报一句，带上两个名字便于排查', () => {
    expect(checkSkill(skill({ name: 'other-name' }), SKILL_DIR_NAME)).toEqual([
      'name（other-name）与目录名（zhixing-reader-profile）不等',
    ])
  })

  it(`name 两头：${NAME_MAX} 字符过、${NAME_MAX + 1} 字符报`, () => {
    const ok = SKILL_DIR_NAME.padEnd(NAME_MAX, '-')
    expect(checkSkill(skill({ name: ok }), ok)).toEqual([])
    const long = SKILL_DIR_NAME.padEnd(NAME_MAX + 1, '-')
    expect(checkSkill(skill({ name: long }), long)).toContain(`name 超过 ${NAME_MAX} 字符`)
  })

  it('name 的字符式样：大写 / 下划线 / 空格 / 连字符开头都不行', () => {
    for (const bad of ['Zhixing', 'zhixing_reader', 'zhixing reader', '-zhixing']) {
      expect(checkSkill(skill({ name: bad }), bad), bad).toContain('name 的字符式样不对')
    }
  })

  it(`description 两头：${DESCRIPTION_MAX} 字符过、再多一个报`, () => {
    const ok = skill({ description: 'x'.repeat(DESCRIPTION_MAX) })
    expect(checkSkill(ok, SKILL_DIR_NAME)).not.toContain(`description 超过 ${DESCRIPTION_MAX} 字符`)
    const long = skill({ description: 'x'.repeat(DESCRIPTION_MAX + 1) })
    expect(checkSkill(long, SKILL_DIR_NAME)).toContain(`description 超过 ${DESCRIPTION_MAX} 字符`)
  })

  it('缺 description ⇒ 报缺，不把空值当合规', () => {
    expect(checkSkill('---\nname: zhixing-reader-profile\n---\n正文\n', SKILL_DIR_NAME)).toContain('description 没写')
  })

  it(`正文 ${BODY_MAX_LINES - 1} 行过、${BODY_MAX_LINES} 行报（画像是短锚，不是把语料再抄一遍）`, () => {
    const line = '同一行\n'
    expect(checkSkill(skill({ body: line.repeat(BODY_MAX_LINES - 1) }), SKILL_DIR_NAME)).toEqual([])
    expect(checkSkill(skill({ body: line.repeat(BODY_MAX_LINES) }), SKILL_DIR_NAME)).toEqual([
      `正文 ${BODY_MAX_LINES} 行，上限是 ${BODY_MAX_LINES - 1} 行`,
    ])
  })

  it('正文末尾没有换行时也算对行数（不靠夹具恰好带换行）', () => {
    const body = '同一行\n'.repeat(BODY_MAX_LINES - 1).replace(/\n$/, '')
    expect(checkSkill(skill({ body }), SKILL_DIR_NAME)).toEqual([])
    const long = '同一行\n'.repeat(BODY_MAX_LINES).replace(/\n$/, '')
    expect(checkSkill(skill({ body: long }), SKILL_DIR_NAME)).toEqual([`正文 ${BODY_MAX_LINES} 行，上限是 ${BODY_MAX_LINES - 1} 行`])
  })
})
