// typecheck 覆盖面守卫（2026-09-23，Issue #6）
//
// 根 tsconfig.json 的 include 以前只有 electron / src / scripts —— `npm run typecheck`
// 从来不读 tests/，于是测试文件里的类型错误与列名写错只有"真跑 vitest"才暴露。
// 这一条把 tests/ 钉进覆盖范围：谁把它从 include 里删掉，这里立刻判红。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const tsconfig = JSON.parse(readFileSync(join(ROOT, 'tsconfig.json'), 'utf8')) as {
  include?: string[]
  compilerOptions?: { strict?: boolean }
}
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  scripts?: Record<string, string>
}

describe('tests/ 必须在 typecheck 覆盖范围内', () => {
  it('include 里有 tests/**/*.ts（删掉就等于把 60 个测试文件放回无类型状态）', () => {
    expect(tsconfig.include ?? []).toContain('tests/**/*.ts')
  })

  it('反证：include 数组真的被读到了，不是空转', () => {
    // 生产四块 + tests 全在；少一条这条断言就红，说明上面那条不是在自说自话
    for (const entry of [
      'electron/**/*.ts',
      'src/**/*.ts',
      'src/**/*.tsx',
      'src/types/**/*.d.ts',
      'scripts/**/*.ts',
    ]) {
      expect(tsconfig.include ?? []).toContain(entry)
    }
    expect((tsconfig.include ?? []).length).toBe(6)
  })

  it('npm run typecheck 走的就是这份根配置（改 include 才会真的生效）', () => {
    expect(pkg.scripts?.typecheck).toBe('tsc --noEmit')
  })

  it('strict 不许被关掉（关掉之后 tests 进不进 include 都没意义）', () => {
    expect(tsconfig.compilerOptions?.strict).toBe(true)
  })
})
