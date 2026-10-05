// 文档指针守卫（2026-09-24，Issue #7）
//
// AGENTS.md / CLAUDE.md 过去把读者指向过四个从来不存在的路径
// （`.claude/rules/*`、`.claude/ownership.yaml`、`.learnings/STANDARDS.md`、`.trae/specs/…`），
// 每次都"诚实标注 ⚠️未落地"，但接手的人还是会照着去找 —— 2026-09-11 挂到 2026-09-24。
// 这一批把指针全收掉：规范的正本要么在本仓库真实存在的那几份配置里，要么在文档自己的表格里。
//
// 这里钉三件事：
//   1) AGENTS.md / CLAUDE.md 全文不许再出现那四个死路径
//      （2026-10-04 起这两份文档都不再按「## 十、」截断 —— 见文末那一组判据）；
//   2) 文档现在指向的配置/目录必须真实存在 —— 谁把 eslint.config.js 改名或把 .learnings/
//      从忽略清单里挪走，这条立刻判红；
//   3) 变更历史只许待在 `docs/agent-history.md`，入口文档不许再长回去。

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')

const DEAD_PATHS = [
  '.claude/rules/',
  '.claude/ownership.yaml',
  '.learnings/STANDARDS.md',
  '.trae/',
]

describe('文档不许再把读者指向不存在的规范文件', () => {
  for (const file of ['AGENTS.md', 'CLAUDE.md']) {
    it(`${file} 里不再出现四个死路径`, () => {
      const body = readFileSync(join(ROOT, file), 'utf8')
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
    const body = readFileSync(join(ROOT, 'AGENTS.md'), 'utf8')
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
    expect(body).toMatch(/都是本地文件、`.gitignore` 排除、不入库/)
  })

  it('反证：不存在的路径会被 existsSync 那组断言判红', () => {
    // 这条本身就是判据的自检 —— 当初那四个死路径就是没人这么查过才挂了三年
    expect(existsSync(join(ROOT, '.claude/rules/code-style.md'))).toBe(false)
    expect(existsSync(join(ROOT, '.trae/specs/dead-code-governance/spec.md'))).toBe(false)
  })
})

// ===== 入口文档不许再长回变更历史（2026-10-04） =====
//
// 病：AGENTS.md 曾涨到 446 KB、CLAUDE.md 122 KB，其中九成是「每批追加一次」的实测记录
// （§十 变更记录 173K 字符、头部「最近核验」单行 57K 字符、CLAUDE §8 的门禁基线 56 行）。
// 每次会话都要全量加载这两份，而变更历史对「下一个 Agent 做什么」没有约束力。
//
// 这一组钉的是**搬走之后不许回来**：历史正文只许待在 `docs/agent-history.md` 一处，
// 入口文档只许留指针。历史档是 append-only 的（里面的数是当年实测），
// 所以数字对账那边不扫它 —— 换句话说它正是本组两条规则存在的理由。
//
// ⚠️ 历史档是**本机文件、不入库**（`docs/` 被 gitignore），所以这一组里
// 凡是读历史档内容的断言都包在「它在的时候」里 —— CI 上 fresh clone 没有 `docs/`，
// 硬断存在会让流水线第一次推上去就红（本文件开头那条「`.learnings/` 不能断存在」
// 就是同一条规矩，这里自己也得守）。反过来，**入口文档那几条无条件断**：
// 它们是入库文件，CI 上一定在，断的就是"历史正文流回入口文档"这件事。

const HISTORY_DOC = join('docs', 'agent-history.md')

/** 入口文档单文件上限；超了就是历史正文又长回来了 */
const MAX_ENTRY_DOC_BYTES = 32 * 1024

describe('变更历史只许待在历史档，不许长回入口文档', () => {
  it('docs/ 确实被 gitignore 排除（历史档不入库是既定决策，不是遗漏）', () => {
    expect(readFileSync(join(ROOT, '.gitignore'), 'utf8')).toMatch(/^docs\/$/m)
  })

  it('历史档在本机时，它说清了自己是 append-only（当年的数不许拿今天真值去改）', () => {
    const path = join(ROOT, HISTORY_DOC)
    if (!existsSync(path)) return // CI 上没有它 —— 那是正常的，不是缺陷
    const history = readFileSync(path, 'utf8')
    expect(history).toMatch(/append-only/)
    expect(history).toMatch(/一个字都不许改|不许改写/)
  })

  it('AGENTS.md 与 CLAUDE.md 都留着指向历史档的指针', () => {
    for (const file of ['AGENTS.md', 'CLAUDE.md']) {
      const body = readFileSync(join(ROOT, file), 'utf8')
      expect(body, `${file} 没指向 ${HISTORY_DOC}`).toContain('docs/agent-history.md')
    }
  })

  it.each(['AGENTS.md', 'CLAUDE.md'])('%s 本身不许再超过 32 KB', (file) => {
    // 预算来自会话启动时的提示（AGENTS.md 一度 446 KB 对 32 KB 预算）。
    // 阈值不是随手取的：现在两份分别是 16 KB / 12 KB，32 KB 留了一倍余量，
    // 又足够小到能挡住"又开始逐批追加实测记录"这件事。
    const bytes = Buffer.byteLength(readFileSync(join(ROOT, file), 'utf8'), 'utf8')
    expect(
      bytes,
      `${file} 有 ${bytes} 字节，超过 ${MAX_ENTRY_DOC_BYTES} —— 历史正文又长回来了？写进 ${HISTORY_DOC}`,
    ).toBeLessThanOrEqual(MAX_ENTRY_DOC_BYTES)
  })

  it('反证 · 往 AGENTS.md 塞回 40 KB 历史正文会被上面那条判红', () => {
    // 负向断言必须配「该发生的确实发生了」：先把膨胀喂进去，确认判据真的会红
    const bloated = 'x'.repeat(40 * 1024)
    const bytes = Buffer.byteLength(readFileSync(join(ROOT, 'AGENTS.md'), 'utf8') + bloated, 'utf8')
    expect(bytes).toBeGreaterThan(MAX_ENTRY_DOC_BYTES)
  })

  it('两条文档守卫都不许再用「## 十」截断来规避扫描（那个截断点已经搬走了）', () => {
    // 死路径扫描与数字对账原来都有同一层过滤函数，作用是把变更历史段落排除在扫描外
    // —— 原形是「按某个二级标题做 indexOf，切掉它之后的内容」。
    // 第十节搬走之后那个 indexOf 恒为 -1 → 函数退化成「返回全文」→ **判定范围悄悄变大、
    // 没有任何东西报错**。两处都已改成显式扫全文，这里钉住：那层过滤不许被加回来，
    // 否则有人会以为历史段落仍在原处，实际已不在 —— 与其依赖它不如让扫描覆盖全文。
    //
    // 注意：这条判据不许把被禁的字面量写进注释或错误消息 —— 它扫的就是源码全文，
    // 注释里照抄一遍会把自己判红（本项目在别处已经栽过这一回，见 AGENTS §十）。
    const banned = new RegExp(`indexOf\\(\\s*['"]## ${'十'}、`)
    for (const file of ['doc-pointers.test.ts', 'doc-figures.test.ts']) {
      const src = readFileSync(join(ROOT, 'tests', file), 'utf8')
      expect(
        src,
        `${file} 里那层「按二级标题截断历史段落」的过滤还在 —— 截断点已随历史正文搬走，它会静默空转`,
      ).not.toMatch(banned)
    }
  })

  it('入口文档里不再有变更记录表格行（历史只许在历史档一处）', () => {
    for (const file of ['AGENTS.md', 'CLAUDE.md']) {
      const body = readFileSync(join(ROOT, file), 'utf8')
      // 原 §十 的形状：| 2026-09-30（某主题） | **正文摘要** —— …
      expect(
        body,
        `${file} 里又有变更记录表格行了 —— 那张表只该在 ${HISTORY_DOC} 里`,
      ).not.toMatch(/^\| 20\d\d-\d\d-\d\d（[^|]*）\s*\|\s*\*\*/m)
    }
  })
})
