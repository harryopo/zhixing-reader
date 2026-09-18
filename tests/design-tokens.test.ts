// 知行读书 — 调色板单一真值测试
//
// tokens/brand.json 是全部色值的出处；generated-palette.css 与 design/palette.ts
// 是它的两份产物，brand/*.svg 里的 hex 也必须与之一致。
// 这一文件存在的理由：改色只改 JSON，忘了跑脚本或直接在产物里手改，测试会红。

import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const TOKENS: Record<string, Record<string, { $value: string }>> = JSON.parse(
  read('tokens/brand.json')
).color

describe('tokens/brand.json 是唯一真值', () => {
  it('两份产物都是最新的（重新生成后逐字一致）', () => {
    expect(() =>
      execFileSync(process.execPath, ['scripts/build-tokens.mjs', '--check'], { cwd: ROOT, encoding: 'utf8' })
    ).not.toThrow()
  })

  it('design-tokens.css 里不再出现任何 emerald / brand 原始 hex', () => {
    const raw = new Set(
      ['emerald', 'brand'].flatMap((g) => Object.values(TOKENS[g]).map((v) => v.$value))
    )
    const css = read('src/renderer/src/styles/design-tokens.css')
    for (const hex of raw) {
      expect(css.toLowerCase(), `语义 token 应改为 var() 引用，出现了裸色值 ${hex}`).not.toContain(hex.toLowerCase())
    }
    // 例外：--brand-mark 是语义映射，值本身就是 var()
    expect(css).toContain('--brand-mark: var(--brand-ink);')
  })

  it('CSS 产物含 brand + emerald，TS 产物含全部色组', () => {
    const css = read('src/renderer/src/styles/generated-palette.css')
    const ts = read('src/renderer/src/design/palette.ts')
    for (const [key, node] of Object.entries(TOKENS.brand)) expect(css).toContain(`--brand-${key}: ${node.$value};`)
    for (const [shade, node] of Object.entries(TOKENS.emerald)) expect(css).toContain(`--emerald-${shade}: ${node.$value};`)
    for (const group of Object.keys(TOKENS)) expect(ts, group).toContain(`${group}:`)
    expect(ts).toContain(TOKENS.emerald['600'].$value)
  })

  it('两份产物彼此一致：同一个 shade 在 CSS 与 TS 里是同一个值', () => {
    const css = read('src/renderer/src/styles/generated-palette.css')
    const ts = read('src/renderer/src/design/palette.ts')
    for (const [shade, node] of Object.entries(TOKENS.emerald)) {
      expect(css).toContain(`--emerald-${shade}: ${node.$value};`)
      expect(ts).toContain(`${shade}: '${node.$value}'`)
    }
  })
})

describe('SVG 资产与图表代码不许夹带私货', () => {
  const brand = { ink: TOKENS.brand.ink.$value, brass: TOKENS.brand.brass.$value, paper: TOKENS.brand.paper.$value }

  it('brand/*.svg 用的就是 JSON 里的品牌三色', () => {
    expect(read('brand/mark.svg')).toContain(`stroke="${brand.ink}"`)
    expect(read('brand/mark-reverse.svg')).toContain(`stroke="${brand.paper}"`)
    expect(read('brand/mark-icon.svg')).toContain(`fill="${brand.ink}"`)
    for (const f of ['mark.svg', 'mark-reverse.svg', 'mark-icon.svg', 'logo-horizontal.svg']) {
      expect(read(`brand/${f}`), f).toContain(brand.brass)
    }
  })

  it('字标是转曲路径，不是 <text>（<text> 会吃本机字体，换机器就变样）', () => {
    const wordmark = read('brand/wordmark.svg')
    expect(wordmark).not.toContain('<text')
    expect(wordmark.match(/d="/g)).toHaveLength(1)
    expect(wordmark).toContain('fill="currentColor"')
  })

  it('图表代码引用 COLORS，不再写死 emerald hex', () => {
    expect(read('src/renderer/src/admin-charts.tsx')).toContain('COLORS.emerald[500]')
    expect(read('src/renderer/src/pages/token-usage/constants.ts')).toContain('COLORS.emerald[700]')
    for (const f of ['src/renderer/src/admin-charts.tsx', 'src/renderer/src/pages/token-usage/constants.ts']) {
      expect(read(f), f).not.toContain('#10b981')
    }
  })
})
