// 文档指针守卫（2026-09-24，Issue #7）
//
// AGENTS.md / CLAUDE.md 过去把读者指向过四个从来不存在的路径
// （`.claude/rules/*`、`.claude/ownership.yaml`、`.learnings/STANDARDS.md`、`.trae/specs/…`），
// 每次都"诚实标注 ⚠️未落地"，但接手的人还是会照着去找 —— 2026-09-11 挂到 2026-09-24。
// 这一批把指针全收掉：规范的正本要么在本仓库真实存在的那几份配置里，要么在文档自己的表格里。
//
// 这里钉两件事：
//   1) 正文（不含第十节变更记录 —— 那是 append-only 的历史，当时的路径名要照原样留着）
//      不许再出现那四个死路径；
//   2) 文档现在指向的配置/目录必须真实存在 —— 谁把 eslint.config.js 改名或把 .learnings/
//      从忽略清单里挪走，这条立刻判红。

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')

/** 第十节「变更记录」是 append-only 历史，里面的旧路径名是当时的事实，不参与扫描 */
function liveSections(file: string): string {
  const s = readFileSync(join(ROOT, file), 'utf8')
  const cut = s.indexOf('## 十、变更记录')
  return cut === -1 ? s : s.slice(0, cut)
}

const DEAD_PATHS = [
  '.claude/rules/',
  '.claude/ownership.yaml',
  '.learnings/STANDARDS.md',
  '.trae/',
]

describe('文档不许再把读者指向不存在的规范文件', () => {
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    it(`${file} 正文里不再出现四个死路径`, () => {
      const body = liveSections(file)
      for (const dead of DEAD_PATHS) {
        expect(body, `${file} 仍引用 ${dead}`).not.toContain(dead)
      }
    })
  }

  it('反证：扫描真的在看得到这些路径（喂一条旧文案必须命中）', () => {
    const oldText = '详见 `.claude/rules/code-style.md` 与 `.learnings/STANDARDS.md`'
    const hits = DEAD_PATHS.filter((d) => oldText.includes(d))
    expect(hits.length).toBe(2)
  })

  it('gitignore 边界说明与写权限 glob 里的 `.claude/` 是合法用法，没有被误伤', () => {
    // 判据本身不许过宽：`.claude/**`（infra-agent 的可写范围）与裸 `.claude/`
    // （说明它被 gitignore 排除）都不是"叫人来读的死指针"
    const body = liveSections('AGENTS.md')
    expect(body).toContain('.claude/**')
    expect(body).toContain('.claude/')
    for (const dead of DEAD_PATHS) {
      expect(body).not.toContain(dead)
    }
  })
})

describe('文档现在指向的位置必须真实存在', () => {
  // 这些是**入库文件**，CI 上也在 ⇒ 可以硬断存在。改名或删掉而不改文档，这里立刻红。
  const inRepo = [
    // AGENTS §六「每个领域由谁强制」与 §4.3 结尾那句"可执行真值"清单
    'eslint.config.js',
    'tsconfig.json',
    'vitest.config.ts',
    'commitlint.config.js',
    'package.json',
    '.github/workflows/ci.yml',
    'SECURITY.md',
    'CLAUDE.md',
    'AGENTS.md',
    '.husky',
  ]
  for (const p of inRepo) {
    it(`${p} 存在`, () => {
      expect(existsSync(join(ROOT, p)), `文档指向的 ${p} 不存在了`).toBe(true)
    })
  }

  // `.learnings/` 与 `.workbuddy/` 是**本机文件、不入库** —— 不能断它们存在
  // （CI 上 fresh clone 就没有），但可以断两件事：它们确实被 gitignore 排除，
  // 而且文档把它们说成"本地文件"，不是"仓库里翻得到的规范正本"。
  it('.learnings/ 与 .workbuddy/ 确实被 gitignore 排除', () => {
    const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8')
    expect(ignore).toMatch(/\.learnings\//)
    expect(ignore).toMatch(/\.workbuddy\//)
  })

  it('AGENTS.md 把这两个目录标注为本地文件', () => {
    const body = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')
    expect(body).toMatch(/\.learnings\/.+本地文件|本地文件[^\n]*\.learnings/)
    expect(body).toMatch(/\.workbuddy\/.+本地文件|本地文件[^\n]*\.workbuddy/)
    expect(liveSections('AGENTS.md')).toMatch(/都是本地文件、`.gitignore` 排除、不入库/)
  })

  it('反证：不存在的路径会被 existsSync 那组断言判红', () => {
    // 这条本身就是判据的自检 —— 当初那四个死路径就是没人这么查过才挂了三年
    expect(existsSync(join(ROOT, '.claude/rules/code-style.md'))).toBe(false)
    expect(existsSync(join(ROOT, '.trae/specs/dead-code-governance/spec.md'))).toBe(false)
  })
})
