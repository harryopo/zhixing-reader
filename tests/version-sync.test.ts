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
})
