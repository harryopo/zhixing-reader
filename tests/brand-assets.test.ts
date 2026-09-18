// 知行读书 — 品牌资产一致性测试
//
// 徽标「玉璧」只有一份几何真值（brand/*.svg），其余全是它的派生物。
// 这个文件钉两件事：① 几何在六处派生物里逐字相同；② 配色与尺寸下限不许被改坏。
// 平台图标（resources/icon.*）由 `npm run build:icons` 生成。
//
// 只做确定性检查：解析 SVG 源码 + 读 ICO/PNG 头部，不做任何像素目检。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

/** 300° 环：r=16、圆心 (24,24)，60° 开口朝右上 */
const RING = 'M32 10.14A16 16 0 1 0 40 24'
/** 缺口上的那一方「行」（不含标签名 —— favicon 里的 `<` 是 %3C） */
const STEP = 'x="35" y="13" width="6" height="6"'

const INK = '#0c3b2e'
const BRASS = '#b08d57'
const PAPER = '#f5f1e8'

const MARK = read('brand/mark.svg')
const MARK_REVERSE = read('brand/mark-reverse.svg')
const MARK_ICON = read('brand/mark-icon.svg')
const MARK_MONO = read('brand/mark-mono.svg')

describe('环只有一种画法', () => {
  // favicon 是塞进 HTML 属性的 URL 编码 SVG，只能用单引号 —— 归一化后再比
  const norm = (s: string) => s.replace(/'/g, '"')
  const derived: ReadonlyArray<readonly [string, string]> = [
    ['brand/mark.svg', MARK],
    ['brand/mark-reverse.svg', MARK_REVERSE],
    ['brand/mark-icon.svg', MARK_ICON],
    ['brand/mark-mono.svg', MARK_MONO],
    ['BrandMark.tsx', read('src/renderer/src/components/ui/BrandMark.tsx')],
    ['index.html favicon', norm(read('src/renderer/index.html'))],
  ]

  it('六处派生物共用同一条环路径与同一方坐标', () => {
    for (const [name, src] of derived) {
      expect(src, name).toContain(RING)
      expect(src, name).toContain(STEP)
    }
  })

  it('落地页用反白版（landing 的 --surface-0 是深底）', () => {
    expect(read('landing/logo.svg')).toBe(MARK_REVERSE)
  })

  it('环是 300°：large-arc=1 且 sweep=0（画成 60° 就变成一个小耳朵）', () => {
    expect(RING).toContain('A16 16 0 1 0')
  })
})

describe('几何自洽', () => {
  it('铜金方的中心落在环的角平分线上（缺口正中，不是随手放的）', () => {
    const cx = 35 + 6 / 2
    const cy = 13 + 6 / 2
    const dist = Math.hypot(cx - 24, cy - 24)
    expect(dist).toBeGreaterThan(15.5)
    expect(dist).toBeLessThan(16.5)
    // 开口区间是 -60°..0°，方应落在其角平分线 -30° 上
    expect(Math.round(Math.atan2(cy - 24, cx - 24) * (180 / Math.PI))).toBe(-30)
  })

  it('16px 下环宽仍有 2px（stroke 6/48×16），不许细到 6 以下', () => {
    for (const svg of [MARK, MARK_REVERSE, MARK_ICON, MARK_MONO]) {
      expect(svg).toMatch(/stroke-width="6"/)
    }
  })

  it('平涂：没有渐变、没有半透明', () => {
    for (const [name, svg] of [
      ['mark.svg', MARK],
      ['mark-reverse.svg', MARK_REVERSE],
      ['mark-icon.svg', MARK_ICON],
      ['mark-mono.svg', MARK_MONO],
    ] as const) {
      expect(svg, name).not.toMatch(/Gradient|opacity/)
    }
  })
})

describe('品牌色与交互色分开口径', () => {
  it('浅底墨绿、深底宣纸、铜金恒定', () => {
    expect(MARK).toContain(`stroke="${INK}"`)
    expect(MARK_REVERSE).toContain(`stroke="${PAPER}"`)
    for (const svg of [MARK, MARK_REVERSE, MARK_ICON]) {
      expect(svg).toContain(`fill="${BRASS}"`)
    }
  })

  it('应用图标带墨绿底板（桌面壁纸不可控，无底板的环在深色壁纸上会消失）', () => {
    expect(MARK_ICON).toContain(`rx="11" fill="${INK}"`)
    expect(MARK).not.toContain('<rect width="48" height="48"')
  })

  it('品牌三色进了 CSS token，且暗色档自动反白', () => {
    // 原始色值归 generated-palette.css（真值在 tokens/brand.json），语义映射留在 design-tokens.css
    const palette = read('src/renderer/src/styles/generated-palette.css')
    expect(palette).toContain(`--brand-ink: ${INK.toLowerCase()};`)
    expect(palette).toContain(`--brand-brass: ${BRASS.toLowerCase()};`)
    expect(palette).toContain(`--brand-paper: ${PAPER.toLowerCase()};`)
    const css = read('src/renderer/src/styles/design-tokens.css')
    expect(css).toContain('--brand-mark: var(--brand-ink);')
    expect(css).toContain('--brand-mark: var(--brand-paper);')
  })

  it('UI 交互色仍是 emerald-600，品牌墨不许顺手改掉全站主色', () => {
    const css = read('src/renderer/src/styles/design-tokens.css')
    const palette = read('src/renderer/src/styles/generated-palette.css')
    expect(css).toContain('--primary: var(--emerald-600);')
    expect(palette).toContain('--emerald-600: #059669;')
  })

  it('组件走 token，不写死色值', () => {
    const brandMark = read('src/renderer/src/components/ui/BrandMark.tsx')
    expect(brandMark).toContain('stroke="var(--brand-mark)"')
    expect(brandMark).toContain('fill="var(--brand-brass)"')
    expect(brandMark).not.toContain('#0c3b2e')
  })

  it('上一版台阶与 Google 蓝 favicon 都不许回来', () => {
    expect(MARK).not.toContain('V28h8')
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
    const offsets: number[] = []
    for (let i = 0; i < count; i++) {
      const entry = 6 + i * 16
      const size = ico.readUInt8(entry) || 256
      expect(size, 'ICO 目录项只有 1 字节存宽高，256 封顶').toBeLessThanOrEqual(256)
      offsets.push(ico.readUInt32LE(entry + 12))
    }
    expect(offsets.map((_, i) => ico.readUInt8(6 + i * 16) || 256)).toEqual([
      16, 20, 24, 32, 40, 48, 64, 96, 128, 256,
    ])
    for (const offset of offsets) {
      expect(ico.readUInt32BE(offset), '每个条目都应是 PNG').toBe(0x89504e47)
    }
  })

  it('侧栏与关于页用的是组件，不再是 CSS 手写的「知」字占位', () => {
    for (const p of ['src/renderer/src/components/layout/Sidebar.tsx', 'src/renderer/src/pages/settings/SettingsAbout.tsx']) {
      const src = read(p)
      expect(src, p).toContain('<BrandMark')
      expect(src, p).not.toMatch(/className="(brand-mark|app-logo)"/)
    }
  })
})
