/**
 * 小标题（.eyebrow）归一守卫（2026-10-18）
 *
 * 来历：同一句大写小字此前在渲染层被手写 65 次、17 种变体（字号 0.7 / 0.72 / 0.74 / 0.75 / 0.78rem 各有），
 * 而元素上同时挂着一个**从未在任何 CSS 里定义过**的 `className="eyebrow"` —— 类名是从设计稿搬来的，样式没搬。
 * 中间一步曾把这九档收进 `design/eyebrow.ts`（值逐字不变），最终归一是：**排版归 CSS 类一处，
 * 字号走字阶 `--font-size-xs`；留白与加粗留在该处**（去掉加粗才是明显看得见的变化，不在这一笔顺手做）。
 *
 * 量具：AST 扫 style 位置的内联样式对象（含 CSSProperties 常量），
 * 比的是**规范化后的属性集合** —— 键顺序换了也是同一档，按文本比会漏。
 *
 * ⚠️ 这条判据上一轮差点是空的：正本当时用 `const MUTED = '…'` 存值，AST 交回标识符，
 * 与页面手抄的那份永远不相等 ⇒ "没有页面重抄"会永远绿。所以这里既有反证（必须报）也有正对照（不许误伤）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import ts from 'typescript'

const ROOT = join(__dirname, '..')
const RENDERER = join(ROOT, 'src', 'renderer', 'src')
const CSS = 'src/renderer/src/styles/index.css'

type SourceFile = { path: string; src: string }

function walk(dir: string, out: SourceFile[] = []): SourceFile[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) walk(abs, out)
    else if (/\.(tsx|ts)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push({ path: abs.slice(ROOT.length + 1).split('\\').join('/'), src: readFileSync(abs, 'utf8') })
    }
  }
  return out
}

/** 一个内联样式对象的属性表；含展开或计算键就交回 null（那种写法不在这一族的判定范围） */
function propsOf(literal: ts.ObjectLiteralExpression, sf: ts.SourceFile): Map<string, string> | null {
  const out = new Map<string, string>()
  for (const p of literal.properties) {
    if (!ts.isPropertyAssignment(p) || ts.isComputedPropertyName(p.name)) return null
    const key = p.name.getText(sf).replace(/^['"]|['"]$/g, '')
    const value = p.initializer.getText(sf).replace(/\s+/g, ' ').trim().replace(/^['"]|['"]$/g, '')
    out.set(key, value)
  }
  return out
}

/**
 * 这一族 = 用来排版的（大写 + 弱化色），且**没有**徽章类属性（背景/圆角/边框）。
 * 交回"还在用内联样式写小标题"的位置清单。
 */
function inlineEyebrowSites(files: SourceFile[]): string[] {
  const hits: string[] = []
  for (const f of files) {
    const sf = ts.createSourceFile(f.path, f.src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
    function visit(node: ts.Node) {
      if (ts.isObjectLiteralExpression(node)) {
        const parent = node.parent
        const gparent = parent && parent.parent
        const inStyleAttr =
          ts.isJsxExpression(parent) && !!gparent && ts.isJsxAttribute(gparent) && gparent.name.getText(sf) === 'style'
        const inCssConst = ts.isVariableDeclaration(parent)
        if (inStyleAttr || inCssConst) {
          const props = propsOf(node, sf)
          if (props) {
            const isEyebrow =
              props.get('textTransform') === 'uppercase' && props.get('color') === 'var(--muted-foreground)'
            const hasBadgeChrome = ['background', 'backgroundColor', 'borderRadius', 'border', 'padding'].some((k) =>
              props.has(k),
            )
            if (isEyebrow && !(inCssConst && hasBadgeChrome)) {
              const line = f.src.slice(0, node.getStart(sf)).split('\n').length
              hits.push(`${f.path}:${line}`)
            }
          }
        }
      }
      ts.forEachChild(node, visit)
    }
    visit(sf)
  }
  return hits
}

describe('小标题只由 .eyebrow 这一个类负责排版', () => {
  const files = walk(RENDERER)
  const css = readFileSync(join(ROOT, CSS), 'utf8')
  const rule = /\.eyebrow\s*\{([^}]*)\}/.exec(css)

  it('横扫看得见东西：整个渲染层 ≥100 个文件被扫到', () => {
    expect(files.length, '一个文件都没量到 ⇒ 目录口径变了').toBeGreaterThanOrEqual(100)
  })

  it('`.eyebrow` 在 CSS 里真的存在，且字号走字阶而不是又一个手写 rem', () => {
    expect(rule, `${CSS} 里找不到 .eyebrow —— 那个类名当年就是从设计稿搬来却没搬样式`).toBeTruthy()
    const body = rule![1]
    expect(body).toMatch(/font-size:\s*var\(--font-size-xs\)/)
    expect(body).toMatch(/text-transform:\s*uppercase/)
    expect(body).toMatch(/color:\s*var\(--muted-foreground\)/)
    expect(body).toMatch(/letter-spacing:\s*0\.08em/)
    expect(/font-size:\s*[\d.]+rem/.test(body), '.eyebrow 又自己写死了一个字号').toBe(false)
  })

  it('类不是摆设：真的有很多元素挂着它', () => {
    const users = files.filter((f) => /className="[^"]*\beyebrow\b/.test(f.src)).length
    expect(users, '挂着 .eyebrow 的文件数少于预期 ⇒ 归一被回退了').toBeGreaterThanOrEqual(15)
  })

  it('style 位置上不许再出现"排版用的小标题"内联样式', () => {
    expect(inlineEyebrowSites(files), '又有人把小标题写回内联样式了').toEqual([])
  })

  it('量具有牙 · 那种内联写法必须报，徽章那种不许报', () => {
    const reTyped: SourceFile = {
      path: 'src/renderer/src/pages/合成页.tsx',
      src: "export function A() {\n  return <div style={{ letterSpacing: '0.08em', fontSize: '0.78rem', color: 'var(--muted-foreground)', textTransform: 'uppercase' }} />\n}\n",
    }
    expect(inlineEyebrowSites(files.concat([reTyped])), '键顺序换了也必须认出来').toEqual([
      'src/renderer/src/pages/合成页.tsx:2',
    ])
    // 正对照：徽章带背景与圆角，不是小标题这一族
    const badge: SourceFile = {
      path: 'src/renderer/src/pages/合成徽章.tsx',
      src: "const chip: CSSProperties = {\n  fontSize: '0.72rem',\n  textTransform: 'uppercase',\n  background: 'var(--muted)',\n  color: 'var(--foreground)',\n  borderRadius: 'var(--radius)',\n}\n",
    }
    expect(inlineEyebrowSites(files.concat([badge])), '徽章不该被判成小标题').toEqual([])
  })

  it('归一之后不留后门：那份中间步骤的常量表不许回来', () => {
    expect(files.some((f) => f.src.includes('@/design/eyebrow')), '又有人把小标题做回 JS 常量表').toBe(false)
    expect(files.some((f) => /const (EYEBROW|eyebrowStyle|eyebrow\d)\b/.test(f.src)), '页面里又开了一份小标题常量').toBe(
      false,
    )
  })
})

/**
 * 同一族的下半件：类名挂出去得对得上。
 * 本批把内联样式换成 `.eyebrow` 时，合并写法没检查那一格**本来就挂着** `className="eyebrow"`
 * （那个类此前只是个没样式的空壳），于是造出 15 处 `className="eyebrow eyebrow"` ——
 * 浏览器不在乎，但"合并前先看有没有"这件事不该靠人记住。
 */
function duplicatedClassTokens(src: string): string[] {
  const bad: string[] = []
  src.split('\n').forEach((line, i) => {
    const m = /className="([^"]*)"/.exec(line)
    if (!m) return
    const tokens = m[1].trim().split(/\s+/)
    const dup = tokens.filter((t, j) => tokens.indexOf(t) !== j)
    if (dup.length) bad.push(`第 ${i + 1} 行 "${m[1]}" 重复 ${[...new Set(dup)].join(',')}`)
  })
  return bad
}

describe('className 不许自我重复', () => {
  const files = walk(RENDERER)

  it('渲染层没有一行把同一个类名挂两次', () => {
    const bad = files.flatMap((f) => duplicatedClassTokens(f.src).map((d) => `${f.path} ${d}`))
    expect(bad, '有元素把同一个类名挂了两遍').toEqual([])
  })

  it('量具有牙 · 重复要报、两个不同类名不许报', () => {
    expect(
      duplicatedClassTokens('return <div className="eyebrow eyebrow" />'),
      '合成一处重复必须报',
    ).toHaveLength(1)
    expect(duplicatedClassTokens('return <div className="eyebrow mt-2" />'), '两个不同类名不该报').toEqual([])
  })
})
