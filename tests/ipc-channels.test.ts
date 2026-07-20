// 知行读书 — IPC channel 硬编码字符串 sanity test
// 目的：防止 P0-4 类漏改（主进程 send 用硬编码、渲染进程 listen 用常量）
// 在任何业务代码中重新出现。所有 IPC channel 字符串必须从 src/shared/ipc-channels.ts
// 的 IPC_CHANNELS.* 常量引用，禁止直接写字面量。
//
// 行为：
//   - 扫描 electron/ 与 src/ 下所有 .ts/.tsx 文件
//   - 排除 src/shared/ipc-channels.ts（这是定义源，允许出现字面量）
//   - 排除 tests/（本测试自身）、node_modules、dist、release、.git、.claude、.github
//   - 任何匹配 FORBIDDEN_CHANNELS 的硬编码字符串直接 fail

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'fs'
import { join, extname, relative } from 'path'

// 这些字符串是高频使用的 IPC channel 名，必须通过 IPC_CHANNELS.* 引用
// 新增 channel 时同步追加到本表
const FORBIDDEN_CHANNELS: ReadonlyArray<string> = [
  'ai:streamChunk',
  'ai:streamComplete',
  'ai:streamError',
  'knowledgeCard:distillProgress',
  'system:forceSaveDatabase',
  'fsrs:setParameters',
  'fsrs:getForecast',
  // 额外防御：单复数不一致、tokenUsage、weread、admin、fsrs 等高频 channel
  'tokenUsage:getRecent',
  'tokenUsage:getByDateRange',
  'tokenUsage:getStatsByProvider',
  'tokenUsage:getStatsByFeature',
  'tokenUsage:getDailyStats',
  'tokenUsage:getTotalStats',
  'tokenUsage:clearAll',
  'weread:setApiKey',
  'weread:getBookshelf',
  'weread:fetchBookmarks',
  'weread:fetchNotes',
  'weread:fetchAllContent',
  'weread:fetchAllContentBatch',
  'weread:test',
  'admin:getStats',
  'fsrs:getParameters',
  'fsrs:resetParameters',
  'fsrs:getOptimalReviewOrder',
  'agent:chat',
  'agent:streamChat',
  'agent:streamChatWithContext',
]

const SCAN_EXTENSIONS = new Set(['.ts', '.tsx'])
const EXCLUDED_DIR_NAMES = new Set([
  'node_modules',
  'dist',
  'release',
  '.git',
  '.claude',
  '.github',
  '.learnings',
  'docs',
  'resources',
  'scripts',
  'tests', // 本测试目录自身
])
// 相对路径包含此片段的文件允许出现字面量
const ALLOWLIST_SUBSTRINGS: ReadonlyArray<string> = [
  'src/shared/ipc-channels.ts', // IPC channel 常量定义源
  // 当前文件所在目录（防止 sanitizer 误伤）
]

interface ScanTarget {
  root: string
  // 相对项目根的子目录列表
  roots: ReadonlyArray<string>
}

function walkTsFiles(rootDir: string, accumulated: string[] = []): string[] {
  if (!existsSync(rootDir)) return accumulated
  for (const entry of readdirSync(rootDir)) {
    const fullPath = join(rootDir, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry)) continue
      walkTsFiles(fullPath, accumulated)
    } else if (SCAN_EXTENSIONS.has(extname(entry))) {
      accumulated.push(fullPath)
    }
  }
  return accumulated
}

function isAllowlisted(fileAbs: string, projectRoot: string): boolean {
  const rel = relative(projectRoot, fileAbs).replace(/\\/g, '/')
  return ALLOWLIST_SUBSTRINGS.some((needle) => rel === needle || rel.endsWith(needle))
}

function findViolations(fileAbs: string, projectRoot: string): Array<{ channel: string; line: number; text: string }> {
  const violations: Array<{ channel: string; line: number; text: string }> = []
  const content = readFileSync(fileAbs, 'utf8')
  const lines = content.split(/\r?\n/)
  lines.forEach((line, idx) => {
    for (const channel of FORBIDDEN_CHANNELS) {
      // 严格匹配单引号包裹的字面量，避免误伤注释中的字面量字符串片段
      if (line.includes(`'${channel}'`)) {
        violations.push({ channel, line: idx + 1, text: line.trim() })
      }
    }
  })
  return violations
}

describe('IPC channel constants hygiene', () => {
  it('should not use hardcoded IPC channel strings outside src/shared/ipc-channels.ts', () => {
    // vitest.config.ts 位于项目根；__dirname 即项目根
    const projectRoot = join(__dirname, '..')
    const targets: ScanTarget['roots'] = ['electron', 'src']
    const files: string[] = []
    for (const rel of targets) {
      files.push(...walkTsFiles(join(projectRoot, rel)))
    }

    const allViolations: Array<{ file: string; channel: string; line: number; text: string }> = []
    for (const file of files) {
      if (isAllowlisted(file, projectRoot)) continue
      const v = findViolations(file, projectRoot)
      for (const item of v) {
        allViolations.push({
          file: relative(projectRoot, file).replace(/\\/g, '/'),
          channel: item.channel,
          line: item.line,
          text: item.text,
        })
      }
    }

    if (allViolations.length > 0) {
      const report = allViolations
        .map((v) => `  ${v.file}:${v.line} → '${v.channel}'\n      ${v.text}`)
        .join('\n')
      throw new Error(
        `Found hardcoded IPC channel strings (must use IPC_CHANNELS.* constants):\n${report}\n\n` +
          `修复方法：\n` +
          `  1. 在文件顶部 import { IPC_CHANNELS } from '../../src/shared/ipc-channels'\n` +
          `  2. 把硬编码字符串替换为 IPC_CHANNELS.XXX.YYY 形式\n` +
          `  3. 如果这是新 channel，先在 src/shared/ipc-channels.ts 中定义常量`,
      )
    }

    // 兜底断言，便于 vitest 报告
    expect(allViolations).toEqual([])
  })

  it('FORBIDDEN_CHANNELS should not be empty (defensive)', () => {
    // 防止后续维护者意外清空列表
    expect(FORBIDDEN_CHANNELS.length).toBeGreaterThan(0)
  })
})
