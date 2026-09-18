// 版本字符串一致性守卫（2026-09-18）
//
// 背景：历史上版本号散落多处曾漂移（constants.APP_VERSION 停在 1.0.0、README 停在
// 1.1.0、SettingsAbout 的 sql.js 版本硬编码 1.12.0）。constants.ts 已删；
// 本测试钉住剩余需要人工同步的两个点，防止同类问题复发。

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
})
