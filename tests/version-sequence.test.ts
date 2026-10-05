// CHANGELOG 的版本序列守卫（2026-09-30）
//
// 起因：1.3.3 在 CHANGELOG 里是一个**孤儿段** —— 文件末尾有 `[1.3.3]:` 链接锚点、
// README 的更新历史表里也有 v1.3.3 那一行，但正文的版本小节序列是
// `1.3.4 → 1.3.2`，1.3.3 的那两条 Fixed 夹在 1.3.4 小节之后、`## [1.3.2]` 之前，
// **没有自己的标题**。渲染出来读者会以为那两条属于 1.3.4。
//
// 静默失配比报错更糟（本项目已在覆盖率清单上被「静默空匹配」咬过一次）：
// 所以这里不查"某几个版本号写没写"，而是查**整份文件里小节与锚点两个集合必须互等** ——
// 少一个标题（本次）、多一个没发布的锚点、或锚点删了标题还在，三种都判红。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')

const changelog = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8')

/** 正文的版本小节：`## [1.3.4] - 2026-09-23`（`[Unreleased]` 不算已发布） */
export function releasedSections(text: string): string[] {
  return [...text.matchAll(/^## \[(\d+\.\d+\.\d+)\] - \d{4}-\d{2}-\d{2}/gm)].map((m) => m[1])
}

/** 文件末尾「## 链接」那一段的锚点：`[1.3.4]: https://…` */
export function linkAnchors(text: string): string[] {
  const links = text.split(/^## 链接\s*$/m)[1] ?? ''
  return [...links.matchAll(/^\[(\d+\.\d+\.\d+)\]:/gm)].map((m) => m[1])
}

describe('CHANGELOG 的版本序列', () => {
  it('每个已发布版本都有一个自己的小节（1.3.3 曾是有锚点没标题的孤儿段）', () => {
    const sections = releasedSections(changelog)
    const anchors = linkAnchors(changelog)
    expect(anchors.length, '至少量到 5 个锚点（锚点段被改就量不到了）').toBeGreaterThan(4)
    // 锚点里有、正文里没小节的 = 本次那种孤儿段
    const orphans = anchors.filter((v) => !sections.includes(v))
    expect(orphans, '这些版本有链接锚点却没有自己的 `## [x.y.z] - 日期` 小节，内容会被并进相邻版本').toEqual([])
  })

  it('每个小节都有对应的链接锚点（不许出现发布链接缺失的版本）', () => {
    const missing = releasedSections(changelog).filter((v) => !linkAnchors(changelog).includes(v))
    expect(missing, '这些版本有小节但末尾没有链接定义').toEqual([])
  })

  it('小节与锚点逐个对得上（正向对照：两边集合完全相同）', () => {
    expect(new Set(releasedSections(changelog))).toEqual(new Set(linkAnchors(changelog)))
  })

  it('[Unreleased] 段存在且不为空（近期改动得有地方落）', () => {
    const unreleased = changelog.split(/^## \[Unreleased\]\s*$/m)[1]?.split(/^## \[/m)[0] ?? ''
    expect(unreleased.trim().length, '[Unreleased] 段是空的或标题被删了').toBeGreaterThan(0)
  })

  it('反证 · 抽掉一个小节标题必须判红（证明这条不是空转）', () => {
    // 把 1.3.2 的小节标题整行删掉（不是改内容），锚点还在、正文小节没了
    const text = changelog.replace(/^## \[1\.3\.2\] - 2026-09-21\s*$/m, '')
    expect(releasedSections(text), '1.3.2 的小节标题没被抽掉，替换没生效').not.toContain('1.3.2')
    const orphans = linkAnchors(text).filter((v) => !releasedSections(text).includes(v))
    expect(orphans, '去掉一个版本小节标题居然没被判出来，这条判据是空转的').toEqual(['1.3.2'])
  })

  it('反证 · 删掉一个链接锚点必须判红（锚点段被改动也要能发现）', () => {
    const text = changelog.replace(/^\[1\.3\.3\]: .*$/m, '')
    const missing = releasedSections(text).filter((v) => !linkAnchors(text).includes(v))
    expect(missing).toEqual(['1.3.3'])
  })
})
