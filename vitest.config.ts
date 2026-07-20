/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'

// 知行读书 — Vitest 配置（v1.1，2026-07-20）
// 默认环境：node（FSRS 引擎、SQL 工具、IPC 通道等纯逻辑测试）
// React 组件测试：在测试文件首行加 `// @vitest-environment jsdom` 切换环境
//
// 覆盖率目标：lines/funcs/statements ≥ 85%，branches ≥ 80%
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'electron/**/*.test.ts', 'src/renderer/**/*.test.{ts,tsx}'],
    exclude: [
      'node_modules/**',
      'dist/**',
      'release/**',
      '**/*.integration.test.ts',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: [
        'electron/fsrs-engine.ts',
        'electron/utils/**/*.ts',
        'electron/services/error-classifier.ts',
      ],
      exclude: ['**/*.test.ts', '**/*.d.ts'],
      thresholds: {
        // R6: 新增代码覆盖率 ≥ 85%
        lines: 85,
        functions: 85,
        branches: 80,
        statements: 85,
      },
    },
    setupFiles: ['./tests/setup.ts'],
  },
})
