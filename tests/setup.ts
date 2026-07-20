/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'

// 知行读书 — Vitest 配置（v1.0，2026-07-20）
// 目标：仅覆盖纯逻辑模块（FSRS 引擎、SQL 工具、AI 错误分类）
// 排除 Electron 主进程（需 node 集成环境）与 React 组件（需 jsdom + 大量 mock）

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'electron/**/*.test.ts'],
    exclude: [
      'node_modules/**',
      'dist/**',
      'release/**',
      '**/*.integration.test.ts', // 集成测试单独跑
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
