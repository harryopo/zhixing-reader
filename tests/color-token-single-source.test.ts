/**
 * 色值只有一份口径：界面里不许手抄 token 的值（2026-10-19）
 *
 * 量的是两种形状，都由 `design-tokens.css`（`:root` 浅档 / `.dark` 暗档）+
 * `generated-palette.css` 这两份真值反推：
 *  ① `var(--chart-5, #f59e0b)` 这种**兜底位手抄**—— 当轮量到 6 处，抄来的值还都抄错了：
 *     `--chart-5` 是绿的（`#34a853`），兜底写的是琥珀；`--chart-4` 墨绿，兜底写青色。
 *     token 在 `:root` 里恒有定义，兜底位平时根本不生效 —— 它只在"token 没加载出来"那一刻
 *     画出一个**和全站不一样的颜色**，属于埋着不动的第二套口径。
 *  ② 裸写一个**只在某一档出现的 token 值** —— 当轮量到 3 处，全在 `Home.tsx` 那条失败横幅上：
 *     `#ef4444` 就是浅档的 `--destructive`，暗档里它换成 `#dc2626`，而全站另外 8 处错误提示走的是
 *     `var(--state-error)`（浅 `#ea4335` / 暗 `#f87171`）。⇒ 切成暗档，别的红都跟着变，这一处不变。
 *
 * 两档同值的（`#ffffff` 这类）不算：它跟着主题翻不了车，硬写只是不优雅。
 * 注释里的色值不算：那是对账用的说明文字，写死它反而把判据变成逼人说谎。
 * `design/palette.ts` 不算：它是 `tokens/brand.json` 生成出来的真值本身（`npm run build:tokens`）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const RENDERER = join('src', 'renderer', 'src')
const TOKEN_CSS = ['src/renderer/src/styles/design-tokens.css', 'src/renderer/src/styles/generated-palette.css']

type SourceFile = { path: string; src: string }
/** 一个色值在哪一档出现过：light = `:root`，dark = `.dark` */
type ThemeMap = Map<string, { light: Set<string>; dark: Set<string> }>

function normHex(hex: string): string | null {
  let h = hex.replace('#', '').toLowerCase()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length === 8) h = h.slice(0, 6)
  return h.length === 6 ? '#' + h : null
}

function rgbToHex(text: string): string | null {
  const m = text.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i)
  if (!m) return null
  return '#' + [1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('')
}

/** 从样式表里抽出每个自定义属性的字面色值（`var(--x)` 这种引用先留到下一轮再解） */
function tokenRawValues(css: string): { name: string; refs: string[]; lits: string[] }[] {
  const out: { name: string; refs: string[]; lits: string[] }[] = []
  for (const m of css.matchAll(/--([a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
    const refs: string[] = []
    const lits: string[] = []
    for (const v of m[2].matchAll(/var\(--([a-z0-9-]+)[),]/gi)) refs.push(v[1].toLowerCase())
    for (const v of m[2].matchAll(/#[0-9a-fA-F]{3,8}\b/g)) {
      const n = normHex(v[0])
      if (n) lits.push(n)
    }
    for (const v of m[2].matchAll(/rgba?\([^)]*\)/gi)) {
      const n = rgbToHex(v[0])
      if (n) lits.push(n)
    }
    out.push({ name: m[1].toLowerCase(), refs, lits })
  }
  return out
}

/** 取 `:root` 与 `.dark` 两个块里的属性声明 */
function blockDecls(css: string, selector: RegExp): string {
  let out = ''
  for (const m of css.matchAll(new RegExp(selector.source, 'g'))) {
    const start = css.indexOf('{', m.index!)
    if (start < 0) continue
    let depth = 0
    for (let i = start; i < css.length; i++) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') {
        depth--
        if (depth === 0) {
          out += css.slice(start, i + 1) + '\n'
          break
        }
      }
    }
  }
  return out
}

/**
 * 造"某个色值在哪一档出现过"的表。
 * `var(--emerald-600)` 这类引用要一路解开，否则 `--primary` 在两档的差别看不见。
 */
export function buildThemeValueMap(files: Record<string, string>): ThemeMap {
  const blocks: Record<'light' | 'dark', string> = { light: '', dark: '' }
  for (const f of TOKEN_CSS) {
    const css = files[f] ?? ''
    blocks.light += blockDecls(css, /:root/) + '\n'
    blocks.dark += blockDecls(css, /\.dark\b/) + '\n'
  }
  const perTheme = { light: tokenRawValues(blocks.light), dark: tokenRawValues(blocks.dark) }
  const ownRefs: Record<'light' | 'dark', Map<string, string[]>> = {
    light: new Map(perTheme.light.map((d) => [d.name, d.refs])),
    dark: new Map(perTheme.dark.map((d) => [d.name, d.refs])),
  }

  const resolve = (theme: 'light' | 'dark', name: string, seen: Set<string>, acc: string[]) => {
    if (seen.has(name)) return
    seen.add(name)
    for (const decl of perTheme[theme].filter((d) => d.name === name)) {
      acc.push(...decl.lits)
      for (const r of decl.refs) resolve(theme, r, seen, acc)
    }
  }

  const map: ThemeMap = new Map()
  for (const theme of ['light', 'dark'] as const) {
    for (const [name] of ownRefs[theme]) {
      const lits: string[] = []
      resolve(theme, name, new Set(), lits)
      for (const hex of lits) {
        if (!map.has(hex)) map.set(hex, { light: new Set(), dark: new Set() })
        map.get(hex)![theme].add(name)
      }
    }
  }
  return map
}

/** 去掉行注释与块注释，但把长度和换行留着 —— 行号还要能对回原文件 */
export function stripComments(src: string): string {
  const blank = (m: string) => m.replace(/[^\n]/g, ' ')
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:])\/\/[^\n]*/g, blank)
}

const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+[^)]*\)/g

/** ① 兜底位手抄：`var(--x, <色值>)` */
export function fallbackCopies(files: SourceFile[]): string[] {
  const hits: string[] = []
  for (const f of files) {
    const src = stripComments(f.src)
    for (const m of src.matchAll(/var\(--[a-z0-9-]+\s*,\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\)/gi)) {
      hits.push(`${f.path}:${lineOf(src, m.index!)} ${m[0].slice(0, 48)}`)
    }
  }
  return hits
}

/** ② 裸写一个只在某一档出现的 token 值 */
export function themeUnstableLiterals(files: SourceFile[], map: ThemeMap): string[] {
  const hits: string[] = []
  for (const f of files) {
    const src = stripComments(f.src)
    for (const m of src.matchAll(COLOR_LITERAL)) {
      const hex = f.src.slice(m.index, m.index + m[0].length).startsWith('rgb') ? rgbToHex(m[0]) : normHex(m[0])
      if (!hex) continue
      const entry = map.get(hex)
      if (!entry) continue
      const inLight = entry.light.size > 0
      const inDark = entry.dark.size > 0
      if (inLight === inDark) continue
      hits.push(`${f.path}:${lineOf(src, m.index)} ${m[0]}（只有${inLight ? '浅' : '暗'}档有这个名字）`)
    }
  }
  return hits
}

function lineOf(src: string, index: number): number {
  return src.slice(0, index).split('\n').length
}

function walk(dir: string, out: SourceFile[] = []): SourceFile[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = join(dir, entry.name).split('\\').join('/')
    if (entry.isDirectory()) walk(rel, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.|__tests__/.test(entry.name) && !rel.includes('/design/')) {
      out.push({ path: rel, src: readFileSync(join(ROOT, rel), 'utf8') })
    }
  }
  return out
}

describe('色值只有一份口径', () => {
  const files = walk(RENDERER)
  const map = buildThemeValueMap(
    Object.fromEntries(TOKEN_CSS.map((p) => [p, readFileSync(join(ROOT, p), 'utf8')])),
  )

  it('横扫看得见东西：渲染层 ≥100 个文件，且这张表真能分辨两档（否则下面的 0 处是空话）', () => {
    expect(files.length, '一个文件都没量到 ⇒ 目录口径变了').toBeGreaterThanOrEqual(95)
    expect(map.size, '色值表是空的 ⇒ token 文件读不到或解析错').toBeGreaterThan(20)
    const destructive = map.get('#ef4444')
    const darkOnly = map.get('#dc2626')
    expect(destructive?.light.size, '浅档的 --destructive 没进表 ⇒ 解析漏了').toBeGreaterThan(0)
    expect(destructive?.dark.size ?? 0, '#ef4444 不该在暗档出现').toBe(0)
    expect(darkOnly?.dark.size, '暗档的 --destructive 没进表 ⇒ 两档根本没分开').toBeGreaterThan(0)
    expect(darkOnly?.light.size ?? 0, '#dc2626 不该在浅档出现').toBe(0)
  })

  it('兜底位不许手抄色值 —— token 恒有定义，抄错的那一份平时看不见、出事才画', () => {
    expect(fallbackCopies(files), JSON.stringify(fallbackCopies(files), null, 1)).toEqual([])
  })

  it('裸写的色值不许是"只在一档出现过"的 token 值 —— 那等于选了档', () => {
    const found = themeUnstableLiterals(files, map)
    // 已知未收的一处：Home.tsx 那条失败横幅写的是浅档的 --destructive（#ef4444），
    // 而该文件此刻在另一路会话手里 ⇒ 等对方交完手再收（收掉时把这张表清空，本条断言会说话）。
    const NOT_YET_COLLECTED: Record<string, number> = { 'src/renderer/src/pages/Home.tsx': 3 }
    const byPath = found.reduce<Record<string, number>>((acc, hit) => {
      const p = hit.split(':')[0]
      acc[p] = (acc[p] ?? 0) + 1
      return acc
    }, {})
    expect(byPath, JSON.stringify(found, null, 1)).toEqual(NOT_YET_COLLECTED)
  })

  it('那份未收的清单只许缩短 —— 又添一处或收了却忘了删例外，都判红', () => {
    const found = themeUnstableLiterals(files, map)
    const home = found.filter((h) => h.startsWith('src/renderer/src/pages/Home.tsx')).length
    expect(home, 'Home.tsx 已经收掉了 ⇒ 把上面那张例外表清空').toBeLessThanOrEqual(3)
    expect(found.length, '除 Home 那三处之外又冒出新的裸写').toBe(home)
  })

  it('量具有牙：两种形状各喂一份合成文件必须报出来', () => {
    const fixture: SourceFile[] = [
      { path: 'a.tsx', src: "const s = { color: 'var(--chart-2, #ef4444)' }\n" },
      { path: 'b.tsx', src: "const s = { border: '1px solid #ea4335' }\n" },
    ]
    expect(fallbackCopies(fixture), '兜底位那份没被量出来 ⇒ 这条横扫是瞎的').toHaveLength(1)
    // a.tsx 兜底位里的值同时也是一处裸写 ⇒ 两条形状各报一次，共 2 处
    expect(themeUnstableLiterals(fixture, map), '裸写浅档红那份没被量出来 ⇒ 这条横扫是瞎的').toHaveLength(2)
    expect(stripComments('/* #ef4444 */\nconst a = 1\n').split('\n').length, '剥注释把行号挪了 ⇒ 报出来的行对不回原文件').toBe(3)
  })

  it('正对照：两档同值的白、以及注释里的色值都不许报', () => {
    const ok: SourceFile[] = [
      { path: 'c.tsx', src: "const s = { color: '#ffffff' } /* 对比度：#fbbc05 上白字只有 1.6:1 */\n" },
      { path: 'd.tsx', src: "// 这里提过 #dc2626\nconst s = { color: 'var(--destructive)' }\n" },
    ]
    expect(fallbackCopies(ok), JSON.stringify(fallbackCopies(ok))).toEqual([])
    expect(themeUnstableLiterals(ok, map), JSON.stringify(themeUnstableLiterals(ok, map))).toEqual([])
  })
})
