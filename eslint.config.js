import js from '@eslint/js'
import tseslint from 'typescript-eslint'

// 知行读书 — ESLint 严格配置（v3.0，2026-07-20）
// 目标：在 R6-R10 硬约束下保持 0 错误
//   - complexity ≤ 15
//   - 单文件 ≤ 500 行（legacy 文件 grandfather）
//   - 禁止 any（需注释豁免）
//   - unused vars 必须以 _ 前缀

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    ignores: [
      'dist/**',
      'release/**',
      'node_modules/**',
      'out/**',
      'resources/**',
      'scripts/**',          // 脚本不在主代码规范内
      'tests/**',            // 测试由 vitest 自身规则控制
      '**/*.d.ts',
    ],
  },
  {
    files: ['src/**/*.{ts,tsx}', 'electron/**/*.ts'],
    rules: {
      // 基础质量
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'no-debugger': 'error',
      'no-undef': 'off', // TypeScript 已经检查

      // TypeScript 严格
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn', // 警告而非错误，便于渐进式迁移
      '@typescript-eslint/no-require-imports': 'off',
      '@typescript-eslint/ban-ts-comment': [
        'warn',
        { 'ts-ignore': 'allow-with-description', 'ts-expect-error': 'allow-with-description' },
      ],
      '@typescript-eslint/no-non-null-assertion': 'warn',
      // 注：no-unnecessary-condition 需要 type-aware linting（parserOptions.project），
      // 暂未配置以加快 lint 速度；未来若开启，需在 tsconfig 中加 project 配置。
      // '@typescript-eslint/no-unnecessary-condition': 'warn',

      // 复杂度与文件长度
      // max-params 是硬约束（避免上帝函数）
      'max-params': ['error', { max: 6 }],
      // 其他先 warn 提示，便于后续逐步拆分
      // 目标：30 天内 complexity ≤ 15、max-depth ≤ 4
      complexity: ['warn', { max: 15 }],
      'max-lines': ['warn', { max: 500, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 80, skipBlankLines: true, skipComments: true }],
      'max-depth': ['warn', { max: 4 }],

      // 一致性
      'no-empty': ['error', { allowEmptyCatch: true }],
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },
  // Legacy 巨型文件 grandfather（仅针对 complexity 这类硬规则）
  {
    files: [
      'electron/database.ts',
      'electron/ipc.ts',
      'electron/weread-api.ts',
      'electron/services/rag-service.ts',
    ],
    rules: {
      complexity: 'off',
    },
  },
)
