/**
 * 「小标题」样式的单源守卫（2026-10-18）
 *
 * 量具是 AST 扫**内联样式对象**（JSX 的 `style={{…}}` 与 `CSSProperties` 常量初始化），
 * 规范化成"属性名 → 属性值"的集合再比 —— 因为同一档写法会换键顺序：
 * `{ color, fontSize, textTransform, letterSpacing }` 与 `{ fontSize, color, letterSpacing, textTransform }`
 * 是同一个样式，按文本比会漏（这正是前一批"函数体同体"那把尺的样式版）。
 *
 * 上岗当轮量到的事实：渲染层 65 处手写大写小标题、17 种变体，其中 57 处只重复在 9 档上。
 * 那 9 档现在各自只有一份定义，住在 `src/renderer/src/design/eyebrow.ts`。
 * 外观一字未动 —— 收的是抄件，不是设计。
 *
 * ⚠️ 这条判据**不保证**那 9 档该存在：它们里有 5 档字号（0.7 / 0.72 / 0.74 / 0.75 / 0.78rem）
 * 都不踩 `--font-size-*` 字阶。归归字阶会改外观，那是维护者的设计决定，登记在 PROGRESS。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import ts from 'typescript'

const ROOT = join(__dirname, '..')
const RENDERER = join(ROOT, 'src', 'renderer', 'src')
const HOME = 'src/renderer/src/design/eyebrow.ts'

type SourceFile = { path: string; src: string }

function walk(dir: string, out: SourceFile[] = []): SourceFile[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) walk(abs, out)
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) {
      out.push({ path: abs.slice(ROOT.length + 1).split('\\').join('/'), src: readFileSync(abs, 'utf8') })
    }
  }
  return out
}

/** 一个对象字面量的规范化属性集合；含展开/计算键返回 null（宁可少认，不可认错） */
function propSet(literal: ts.ObjectLiteralExpression, sf: ts.SourceFile): string | null {
  const parts: string[] = []
  for (const p of literal.properties) {
    if (!ts.isPropertyAssignment(p)) return null
    if (ts.isComputedPropertyName(p.name)) return null
    const key = p.name.getText(sf).replace(/^['"]|['"]$/g, '')
    const value = p.initializer.getText(sf).replace(/\s+/g, ' ').trim().replace(/^['"]|['"]$/g, '')
    parts.push(`${key}: ${value}`)
  }
  return parts.sort().join(';')
}

/** 收集"内联样式对象"：JSX 的 style={{…}} 与 CSSProperties 常量的初始化 */
function collectStyleLiterals(path: string, src: string): string[] {
  const sf = ts.createSourceFile(path, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
  const found: string[] = []
  function visit(node: ts.Node) {
    if (ts.isObjectLiteralExpression(node)) {
      const parent = node.parent
      const isStyle = ts.isJsxExpression(parent) && parent.parent && ts.isJsxAttribute(parent.parent) && parent.parent.name.getText(sf) === 'style'
      const isCssConst = ts.isVariableDeclaration(parent)
      if (isStyle || isCssConst) {
        const set = propSet(node, sf)
        if (set && set.includes('textTransform: uppercase')) found.push(set)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/** 交回"把已命名档位又手抄了一遍"的文件清单（正本自己那份不算） */
function namedVariantCopies(files: SourceFile[], named: string[]): string[] {
  const namedSet = new Set(named)
  const hits: string[] = []
  for (const f of files) {
    if (f.path === HOME) continue
    for (const set of collectStyleLiterals(f.path, f.src)) {
      if (namedSet.has(set)) hits.push(`${f.path} ⇒ ${set}`)
    }
  }
  return hits
}

/** 那一份真值里的档位（从源码 AST 现取，不写死在这里，免得判据与真值各自漂移） */
function namedVariants(): { name: string; set: string | null }[] {
  const src = readFileSync(join(ROOT, HOME), 'utf8')
  const sf = ts.createSourceFile(HOME, src, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
  const out: { name: string; set: string | null }[] = []
  const byName = new Map<string, string>()
  for (const stmt of sf.statements) {
    if (!ts.isVariableStatement(stmt)) continue
    for (const decl of stmt.declarationList.declarations) {
      const name = decl.name.getText(sf)
      const init = decl.initializer
      if (!init || !ts.isObjectLiteralExpression(init)) continue
      const parts: string[] = []
      let ok = true
      for (const p of init.properties) {
        if (ts.isSpreadAssignment(p)) {
          // {...eyebrow078, padding} 派生的那一档，把被展开的那档并进来一起当"已命名"
          const base = byName.get(p.expression.getText(sf))
          if (!base) {
            ok = false
            break
          }
          parts.push(...base.split(';'))
          continue
        }
        if (!ts.isPropertyAssignment(p) || ts.isComputedPropertyName(p.name)) {
          ok = false
          break
        }
        const key = p.name.getText(sf).replace(/^['"]|['"]$/g, '')
        const value = p.initializer.getText(sf).replace(/\s+/g, ' ').trim().replace(/^['"]|['"]$/g, '')
        parts.push(`${key}: ${value}`)
      }
      const set = ok ? [...new Set(parts)].sort().join(';') : null
      if (set) byName.set(name, set)
      out.push({ name, set })
    }
  }
  return out
}

describe('小标题样式的九档各只有一份定义', () => {
  const files = walk(RENDERER)
  const variants = namedVariants()
  const sets = variants.map((v) => v.set).filter((s): s is string => s !== null)

  it('横扫看得见东西：渲染层 ≥100 个文件，且真值那份自己就被认出来（否则下面的断言是空话）', () => {
    expect(files.length, '一个文件都没量到 ⇒ 目录口径变了').toBeGreaterThanOrEqual(100)
    // 展开写法（{...eyebrow078, padding}）拿不到 textTransform，所以这里只要求认出多数
    expect(variants.length, '真值里的字面量档数少于预期 ⇒ 量具或文件形状变了').toBeGreaterThanOrEqual(7)
    expect(sets.some((s) => s.includes('fontSize: 0.78rem')), '0.78rem 那一档必须被量具认出来').toBe(true)
    // 派生档（{...base, padding}）并进来一起算已命名 —— 否则页面重抄那一份完整写法就抓不到
    expect(sets.some((s) => s.includes('padding: 0 calc')), '带 padding 的派生档没被并进来 ⇒ 展开写法算漏了').toBe(true)
  })

  it('除了正本，没有任何页面再手抄这九档', () => {
    expect(namedVariantCopies(files, sets), '又出现了一份手抄的小标题样式').toEqual([])
  })

  it('正本内部不许自己抄自己（两档长得一样就该并成一档）', () => {
    const dup = sets.filter((s, i) => sets.indexOf(s) !== i)
    expect(dup, `真值里有重复档位：${dup.join(' | ')}`).toEqual([])
  })

  it('量具有牙 · 手抄必须报、换个值不许报', () => {
    const copy: SourceFile = {
      path: 'src/renderer/src/pages/合成页.tsx',
      src:
        "export function X() {\n  return <div style={{ letterSpacing: '0.08em', fontSize: '0.78rem', color: 'var(--muted-foreground)', textTransform: 'uppercase' }} />\n}\n",
    }
    expect(namedVariantCopies(files.concat([copy]), sets).length, '键顺序换了也算同一档 ⇒ 必须报').toBe(
      namedVariantCopies(files, sets).length + 1,
    )
    // 反面对照：换了字号就不是那一档，别把判据写成"任何大写样式都红"
    const novel: SourceFile = {
      path: 'src/renderer/src/pages/合成新档.tsx',
      src: "export function Y() {\n  return <div style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)', textTransform: 'uppercase' }} />\n}\n",
    }
    expect(namedVariantCopies(files.concat([novel]), sets), '新档位不该被当抄件').toEqual([])
  })

  it('含展开的写法不当抄件（`{...eyebrow078, padding}` 是派生，不是重抄）', () => {
    const derived: SourceFile = {
      path: 'src/renderer/src/pages/合成派生.tsx',
      src: "const a: CSSProperties = { ...eyebrow078, padding: '0 4px' }\n",
    }
    expect(collectStyleLiterals(derived.path, derived.src), '派生写法不该被收进来').toEqual([])
  })
})
