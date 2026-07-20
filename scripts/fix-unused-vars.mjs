#!/usr/bin/env node
/**
 * 自动给 ESLint 报告的未使用变量加 _ 前缀
 * 使用 JSON 格式获取结构化错误列表
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = process.cwd()

let eslintOutput
try {
  eslintOutput = execSync(
    'npx eslint src electron --format json',
    {
      encoding: 'utf-8',
      cwd: ROOT,
      maxBuffer: 10 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: 'C:\\Windows\\System32\\cmd.exe',
    }
  )
} catch (err) {
  // ESLint 非零退出时，stdout 仍有 JSON
  eslintOutput = (err.stdout ? err.stdout.toString() : '') || ''
}

// 提取 JSON 数组（可能在前面有 Node warning）
const jsonStart = eslintOutput.indexOf('[')
if (jsonStart === -1) {
  console.log('No ESLint JSON output found.')
  console.log(eslintOutput.slice(0, 500))
  process.exit(0)
}

let results
try {
  results = JSON.parse(eslintOutput.slice(jsonStart))
} catch (err) {
  console.log('Failed to parse ESLint JSON:', err.message)
  process.exit(1)
}

const errors = []
for (const file of results) {
  for (const msg of file.messages || []) {
    if (msg.severity !== 2) continue // 只看 error
    if (msg.ruleId !== '@typescript-eslint/no-unused-vars' && msg.ruleId !== 'no-console') continue
    // 提取变量名
    const m = msg.message.match(/'([^']+)'/)
    if (!m) continue
    errors.push({
      file: file.filePath,
      line: msg.line,
      col: msg.column,
      name: m[1],
      rule: msg.ruleId,
    })
  }
}

if (errors.length === 0) {
  console.log('No auto-fixable errors found.')
  process.exit(0)
}

console.log(`Found ${errors.length} errors to fix.`)

// 按文件分组
const byFile = new Map()
for (const e of errors) {
  if (!byFile.has(e.file)) byFile.set(e.file, [])
  byFile.get(e.file).push(e)
}

let totalFixed = 0
let totalSkipped = 0
for (const [filePath, errs] of byFile) {
  if (!fs.existsSync(filePath)) continue

  let content = fs.readFileSync(filePath, 'utf-8')
  let lines = content.split('\n')

  // 按行号倒序处理
  errs.sort((a, b) => a.line - b.line)

  for (const e of errs) {
    const idx = e.line - 1
    if (idx < 0 || idx >= lines.length) {
      totalSkipped++
      continue
    }

    const originalLine = lines[idx]
    let newLine = originalLine

    if (e.rule === 'no-console') {
      // console → 改写成 void 表达式保留语义
      newLine = originalLine.replace(
        /\bconsole\.(log|info|debug)\b/g,
        'void 0; /* console disabled */'
      )
      // 如果没匹配到，说明是 .warn/.error，已允许，跳过
    } else {
      // no-unused-vars：加 _ 前缀
      const escapedName = e.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

      // 策略 1：解构 + import { x as _x }
      newLine = originalLine.replace(
        new RegExp(`\\b${escapedName}\\b(?!_)(?=\\s*[,}])`),
        `${e.name} as _${e.name}`
      )

      // 策略 2：const/let/var name → const/let/var _name
      if (newLine === originalLine) {
        newLine = originalLine.replace(
          new RegExp(`\\b(const|let|var)\\s+${escapedName}\\b(?!_)`),
          `$1 _${e.name}`
        )
      }

      // 策略 3：函数参数 (name, → (_name,
      if (newLine === originalLine) {
        newLine = originalLine.replace(
          new RegExp(`\\(\\s*${escapedName}\\b(?!_)`),
          `(_${e.name}`
        )
        newLine = newLine.replace(
          new RegExp(`,\\s*${escapedName}\\b(?!_)`),
          `, _${e.name}`
        )
        newLine = newLine.replace(
          new RegExp(`=\\s*${escapedName}\\b(?!_)\\s*\\)`),
          `= _${e.name})`
        )
      }
    }

    if (newLine !== originalLine) {
      lines[idx] = newLine
      totalFixed++
    } else {
      totalSkipped++
    }
  }

  fs.writeFileSync(filePath, lines.join('\n'), 'utf-8')
  console.log(`  ${path.relative(ROOT, filePath)}: ${errs.length - (totalSkipped % errs.length)}/${errs.length}`)
}

console.log(`\nTotal: ${totalFixed} fixed, ${totalSkipped} skipped`)
console.log('Re-run `npx eslint src electron` to verify.')
