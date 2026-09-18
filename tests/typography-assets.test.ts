// 知行读书 — 字体资产合规与可用性测试
//
// 起因：桌面应用曾经从 fonts.googleapis.com 拉字体（离线打不开、国内常被墙），
// 而 --font-sans 里只有拉丁族名 DM Sans —— 它没有中文字形，
// 所以「知行读书」四个中文一直在吃 Windows 默认回退，字体气质完全不可控。
// 现在字体本地打包（OFL-1.1），许可文本随包分发。

import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const read = (p: string) => readFileSync(join(ROOT, p), 'utf8')

const FONTS = ['noto-sans-sc', 'dm-sans', 'jetbrains-mono'] as const

describe('不再依赖网络字体', () => {
  it('index.html 里没有 Google Fonts 链接', () => {
    const html = read('src/renderer/index.html')
    expect(html).not.toMatch(/fonts\.(googleapis|gstatic)\.com/)
  })

  it('三款字体都作为依赖声明并在入口引入', () => {
    const pkg = JSON.parse(read('package.json'))
    const entry = read('src/renderer/src/main.tsx')
    for (const f of FONTS) {
      expect(pkg.devDependencies, f).toHaveProperty(`@fontsource-variable/${f}`)
      expect(entry, f).toContain(`import '@fontsource-variable/${f}'`)
    }
  })
})

describe('字体栈真的覆盖中文', () => {
  const css = read('src/renderer/src/styles/design-tokens.css')
  const sans = css.match(/--font-sans:([^;]+);/)?.[1] ?? ''

  it('--font-sans 同时含拉丁族、中文族与系统兜底', () => {
    expect(sans).toContain('"DM Sans Variable"')
    expect(sans).toContain('"Noto Sans SC Variable"')
    expect(sans).toMatch(/Microsoft YaHei|PingFang/)
    expect(sans).toContain('ui-sans-serif')
  })

  it('拉丁族在前 —— 中文族排前面会让英文和数字换一套字形', () => {
    expect(sans.indexOf('"DM Sans Variable"')).toBeLessThan(sans.indexOf('"Noto Sans SC Variable"'))
  })

  it('等宽栈指向已打包的可变版', () => {
    expect(css).toMatch(/--font-mono:\s*"JetBrains Mono Variable"/)
  })

  it('已删掉的 --font-serif 死 token 不许回来', () => {
    expect(css).not.toContain('--font-serif')
  })
})

describe('OFL 义务', () => {
  it('三款字体的许可文本随应用分发（public 会被 Vite 原样拷进 dist）', () => {
    for (const f of FONTS) {
      const p = join(ROOT, 'src/renderer/public/licenses', `${f}.OFL.txt`)
      expect(existsSync(p), f).toBe(true)
      const text = readFileSync(p, 'utf8')
      expect(text, f).toContain('SIL Open Font License')
      expect(text, f).toMatch(/Copyright/)
    }
  })

  it('关于页的开源许可表列出了这三款字体', () => {
    const about = read('src/renderer/src/pages/settings/SettingsAbout.tsx')
    for (const name of ['Noto Sans SC', 'DM Sans', 'JetBrains Mono']) {
      expect(about, name).toContain(name)
    }
    expect(about.match(/type: 'OFL-1\.1'/g)).toHaveLength(3)
  })
})
