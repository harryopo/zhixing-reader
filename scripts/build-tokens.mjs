/**
 * 知行读书 — 调色板生成
 *
 * tokens/brand.json 是唯一真值；CSS 变量与 TS 常量都是产物，改色改 JSON 后跑
 * `npm run build:tokens`。tests/design-tokens.test.ts 会重新生成并逐字比对，
 * 所以忘了跑脚本会直接测试红。
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SRC = join(ROOT, 'tokens/brand.json')
const CSS_OUT = join(ROOT, 'src/renderer/src/styles/generated-palette.css')
const TS_OUT = join(ROOT, 'src/renderer/src/design/palette.ts')

/** 只有这两组进 CSS —— 其余色值仅图表用，别往全局塞死变量 */
const CSS_GROUPS = ['brand', 'emerald']

const flat = (node) => (node.$value ? node.$value : Object.fromEntries(Object.entries(node).map(([k, v]) => [k, v.$value])))

export function renderCss(colors) {
  const lines = []
  for (const group of CSS_GROUPS) {
    const value = flat(colors[group])
    if (typeof value === 'string') {
      lines.push(`  --${group}: ${value};`)
      continue
    }
    for (const [key, hex] of Object.entries(value)) lines.push(`  --${group}-${key}: ${hex};`)
  }
  return `/* 由 scripts/build-tokens.mjs 从 tokens/brand.json 生成，勿手改 */\n:root {\n${lines.join('\n')}\n}\n`
}

export function renderTs(colors) {
  const body = Object.entries(colors).map(([group, node]) => {
    const value = flat(node)
    if (typeof value === 'string') return `  ${group}: '${value}',`
    const entries = Object.entries(value)
      .map(([k, hex]) => `${k}: '${hex}'`)
      .join(', ')
    return `  ${group}: { ${entries} },`
  })
  return `/* 由 scripts/build-tokens.mjs 从 tokens/brand.json 生成，勿手改 */\nexport const PALETTE = {\n${body.join('\n')}\n} as const\n`
}

export function load() {
  return JSON.parse(readFileSync(SRC, 'utf8')).color
}

if (process.argv[1] && process.argv[1].endsWith('build-tokens.mjs')) {
  const colors = load()
  const targets = [
    [CSS_OUT, renderCss(colors)],
    [TS_OUT, renderTs(colors)],
  ]

  // --check：只比对不写盘，产物过期就退出 1（测试与 CI 用）
  if (process.argv.includes('--check')) {
    const stale = targets.filter(([file, text]) => readFileSync(file, 'utf8') !== text)
    if (stale.length) {
      console.error('产物已过期，请跑 npm run build:tokens：', stale.map(([f]) => f.split('/').pop()).join(', '))
      process.exit(1)
    }
    console.log('产物与 tokens/brand.json 一致')
    process.exit(0)
  }

  for (const [file, text] of targets) writeFileSync(file, text)
  console.log('tokens/brand.json → generated-palette.css + design/palette.ts')
}
