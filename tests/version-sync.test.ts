// 版本字符串一致性守卫（2026-09-18）
//
// 背景：历史上版本号散落多处曾漂移（constants.APP_VERSION 停在 1.0.0、README 停在
// 1.1.0、SettingsAbout 的 sql.js 版本硬编码 1.12.0）。constants.ts 已删；
// 本测试钉住剩余需要人工同步的几处（2026-09-21 补 README 与关于页更新历史），防止同类问题复发。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { APP_META } from '../src/shared/external-links'

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }

describe('版本字符串一致性', () => {
  it('external-links APP_META.version 与 package.json 版本一致', () => {
    expect(APP_META.version).toBe(`v${pkg.version}`)
  })

  it('CHANGELOG 含当前版本条目', () => {
    const changelog = readFileSync('CHANGELOG.md', 'utf8')
    expect(changelog).toContain(`## [${pkg.version}]`)
  })

  // 2026-09-21 补：发版时手工同步的另外三处，漏一处就是界面/文档各说一个版本
  it('README 的横幅、徽标与安装包文件名跟着 package.json', () => {
    const readme = readFileSync('README.md', 'utf8')
    expect(readme).toContain(`**v${pkg.version}**`)
    expect(readme).toContain(`version-${pkg.version}-`)
    expect(readme).toContain(`zhixing-reader-Setup-${pkg.version}.exe`)
  })

  it('关于页更新历史的第一条就是当前版本', () => {
    const src = readFileSync('src/renderer/src/pages/settings/SettingsAbout.tsx', 'utf8')
    const newest = src.match(/const UPDATE_HISTORY[^=]*=\s*\[\s*\{\s*version:\s*'([^']+)'/)
    expect(newest?.[1]).toBe(APP_META.version)
  })

  // 2026-10-18 补：宣传页（landing/ → gh-pages）是第七处，它停在 v1.1.0 两个多月没人发现，
  // 因为发版批次从来没数过它。同一个漏抄，同一条闸。
  it('宣传页的版本号、下载链与安装包文件名跟着 package.json', () => {
    const landing = readFileSync('landing/index.html', 'utf8')
    expect(landing).toContain(
      `releases/download/v${pkg.version}/zhixing-reader-Setup-${pkg.version}.exe`,
    )
    const versions = new Set([...landing.matchAll(/\bv\d+\.\d+\.\d+\b/g)].map((m) => m[0]))
    expect(versions, `宣传页里出现了第二个版本号：${[...versions].join(' / ')}`).toEqual(
      new Set([`v${pkg.version}`]),
    )
    // 1.1.0 那批的文件名是大驼峰（ZhixingReader-Setup-1.1.0.exe），现在产物叫 zhixing-reader-Setup-*.exe
    expect(landing, '宣传页又用上旧的安装包文件名片段').not.toContain('ZhixingReader-Setup')
  })

  // 2026-10-25 补：FEATURES 的标题与 CLAUDE §8 的「当前版本」也各抄了一份版本号。
  // landing 停在 v1.1.0 两个多月没人发现，就是这类"没人管的抄件"的病 —— 现在它们归这条闸管。
  it('FEATURES 标题与 CLAUDE §8 的「当前版本」跟着 package.json', () => {
    const title = readFileSync('FEATURES.md', 'utf8').split(/\r?\n/)[0]
    expect(title, `FEATURES 标题里的版本不是 v${pkg.version}`).toContain(`v${pkg.version}`)
    const m = /\*\*当前版本\*\*：v(\d+\.\d+\.\d+)/.exec(readFileSync('CLAUDE.md', 'utf8'))
    expect(m, '读不到 CLAUDE §8 的「当前版本」那行（句式被改，规则会静默失效）').toBeTruthy()
    expect(m![1], 'CLAUDE §8 的当前版本与 package.json 不一致').toBe(pkg.version)
  })
})
