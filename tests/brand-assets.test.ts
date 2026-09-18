// 知行读书 — 品牌资产一致性测试
//
// 目的：徽标只有一份几何真值（brand/*.svg），其余全部是它的派生物。
// 任何一处偷偷改了形状、颜色、或把旧稿（渐变书 / Google 蓝 favicon / 「知」字占位）
// 换回来，这里都会红。平台图标（resources/icon.*）由 `npm run build:icons` 生成。
//
// 只做确定性检查：解析 SVG 源码 + 读 ICO/PNG 头部，不做任何像素目检。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/** 标准稿：48 网格，底板内缩 2，台阶占 12..36 */
const STAIR_STANDARD = 'M12 36V28h8v-8h8v-8h8v24z'
/** 图标稿：满版底板，台阶放大到 8..40，保证 16px 下踏面仍有 3.3px */
const STAIR_ICON = 'M8 40V28h10V18h10V8h12v32z'
/** 品牌主色 = design-tokens.css 的 --primary = colors.ts 的 emerald[600] */
const BRAND_HEX = '#059669'

const MARK = read('brand/mark.svg')
const MARK_ICON = read('brand/mark-icon.svg')
const MARK_MONO = read('brand/mark-mono.svg')

describe('徽标几何只有一份真值', () => {
  it('标准稿的形状在 UI 组件与官网落地页里逐字一致', () => {
    expect(MARK).toContain(STAIR_STANDARD)
    expect(read('src/renderer/src/components/ui/BrandMark.tsx')).toContain(STAIR_STANDARD)
    expect(read('landing/logo.svg')).toBe(MARK)
  })

  it('图标稿的形状在 favicon 里逐字一致', () => {
    expect(MARK_ICON).toContain(STAIR_ICON)
    expect(read('src/renderer/index.html')).toContain(STAIR_ICON)
  })

  it('单色镂空稿复用同一组台阶坐标', () => {
    expect(MARK_MONO).toContain('V28h8v-8h8v-8h8v24z')
  })

  it('所有坐标都落在 48 整数网格上', () => {
    for (const svg of [MARK, MARK_ICON, MARK_MONO]) {
      for (const n of svg.match(/[VHhLl]\s*-?[\d.]+/g) ?? []) {
        expect(Number.parseFloat(n.slice(1))).toBe(Number.parseInt(n.slice(1), 10))
      }
    }
  })
})

describe('小尺寸可读性', () => {
  it('图标稿最窄的踏面 ≥10 单位（16px 下 ≥3.3px）', () => {
    const widths = [...STAIR_ICON.matchAll(/h([\d.]+)/g)].map((m) => Number.parseFloat(m[1]))
    expect(Math.min(...widths)).toBeGreaterThanOrEqual(10)
  })

  it('图标稿满版（不留内缩），标准稿留 2 单位内缩', () => {
    expect(MARK_ICON).toContain('<rect width="48" height="48"')
    expect(MARK).toContain('<rect x="2" y="2" width="44" height="44"')
  })
})

describe('平涂与品牌色单一口径', () => {
  it('三张稿子里都没有渐变或半透明（16px 下渐变不收益，只会糊）', () => {
    for (const [name, svg] of [
      ['mark.svg', MARK],
      ['mark-icon.svg', MARK_ICON],
      ['mark-mono.svg', MARK_MONO],
    ] as const) {
      expect(svg, name).not.toMatch(/Gradient|opacity|fill-rule="nonzero"/)
    }
  })

  it('徽标底板色 = CSS token --primary = colors.ts emerald[600]', () => {
    expect(MARK).toContain(`fill="${BRAND_HEX}"`)
    expect(MARK_ICON).toContain(`fill="${BRAND_HEX}"`)
    expect(read('src/renderer/src/styles/design-tokens.css')).toContain(`--primary: ${BRAND_HEX};`)
    expect(read('src/renderer/src/design/colors.ts')).toContain(`600: '${BRAND_HEX}'`)
  })

  it('UI 里的徽标钉死品牌色，不跟随主题的 --primary', () => {
    const brandMark = read('src/renderer/src/components/ui/BrandMark.tsx')
    expect(brandMark).toContain(`fill="${BRAND_HEX}"`)
    expect(brandMark).not.toContain('var(--primary)')
  })

  it('旧的 Google 蓝 favicon 不许回来', () => {
    expect(read('src/renderer/index.html')).not.toMatch(/4285f4/i)
  })
})

describe('平台图标产物', () => {
  const png = readFileSync(join(ROOT, 'resources/icon.png'))
  const ico = readFileSync(join(ROOT, 'resources/icon.ico'))

  it('icon.png 是 1024×1024（macOS 建议档位）', () => {
    expect(png.readUInt32BE(16)).toBe(1024)
    expect(png.readUInt32BE(20)).toBe(1024)
  })

  it('icon.ico 内嵌 16..256 十档，无重复、全部 PNG 压缩', () => {
    const count = ico.readUInt16LE(4)
    const sizes: number[] = []
    for (let i = 0; i < count; i++) {
      const entry = 6 + i * 16
      sizes.push(ico.readUInt8(entry) || 256)
      // ICO 目录项只有 1 字节存宽高，256 以上无法表示，不许出现
      expect(sizes[i], `${sizes[i]} 超出 ICO 上限`).toBeLessThanOrEqual(256)
      expect(ico.readUInt32LE(entry + 12), '每个条目都应是 PNG').not.toBe(0)
    }
    expect(sizes).toEqual([16, 20, 24, 32, 40, 48, 64, 96, 128, 256])
    expect(new Set(sizes).size).toBe(count)
    for (const offset of sizes.map((_, i) => ico.readUInt32LE(6 + i * 16 + 12))) {
      expect(ico.readUInt32BE(offset)).toBe(0x89504e47)
    }
  })

  it('侧栏与关于页用的是组件，不再是 CSS 手写的「知」字占位', () => {
    const sidebar = read('src/renderer/src/components/layout/Sidebar.tsx')
    const about = read('src/renderer/src/pages/settings/SettingsAbout.tsx')
    for (const file of [sidebar, about]) {
      expect(file).toContain('<BrandMark')
      expect(file).not.toMatch(/className="(brand-mark|app-logo)"/)
    }
  })
})
