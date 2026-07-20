/**
 * 知行读书 — 主题色值单一来源（2026-07-20）
 *
 * 设计目标：所有图表/UI 硬编码 hex 色值都从这里引用，避免色板分散到多个文件。
 * 当前色值与 Tailwind v4 默认调色板完全对齐（emerald-500 = #10b981），未来若调整
 * Tailwind config 只需改本文件一处。
 *
 * 色阶语义（参考 Tailwind 默认调色板）：
 *   - emerald: 品牌主色（绿色系）
 *   - gray: 中性色（背景/文本/边框）
 *   - blue / violet / amber / rose / lime: 辅助强调色
 */
export const COLORS = {
  emerald: {
    50: '#ecfdf5',
    100: '#d1fae5',
    200: '#a7f3d0',
    300: '#6ee7b7',
    400: '#34d399',
    500: '#10b981',
    600: '#059669',
    700: '#047857',
  },
  gray: {
    100: '#f3f4f6',
    200: '#e5e7eb',
    300: '#d1d5db',
    400: '#9ca3af',
    500: '#6b7280',
    600: '#4b5563',
    700: '#374151',
    800: '#1f2937',
  },
  blue: {
    500: '#3b82f6',
  },
  violet: {
    400: '#a78bfa',
  },
  amber: {
    500: '#f59e0b',
  },
  rose: {
    500: '#f43f5e',
  },
  lime: {
    500: '#84cc16',
  },
  green: {
    500: '#22c55e',
  },
  white: '#ffffff',
} as const

/**
 * ECharts 系列调色板（环形图/柱图共用）— 顺序：主色 → 浅色 → 强调色 → 中性辅助
 * 来自 tailwindTheme.color 的等价物，但通过 COLORS 引用而非硬编码
 */
export const ECHARTS_PALETTE: readonly string[] = [
  COLORS.emerald[500], // 主色
  COLORS.emerald[400],
  COLORS.emerald[300],
  COLORS.emerald[200],
  COLORS.emerald[600],
  COLORS.emerald[700],
  COLORS.lime[500],
  COLORS.green[500],
  COLORS.amber[500], // 强调
  COLORS.rose[500], // 警告
  COLORS.blue[500], // 信息
  COLORS.violet[400],
] as const

/**
 * Tooltip / Detail 文本色（深色背景上用白色，浅色背景上用 gray-800）
 */
export const TEXT_ON_DARK = COLORS.white
export const TEXT_ON_LIGHT = COLORS.gray[800]

/** Gauge 进度条三段式（绿/浅绿/极浅绿） */
export const GAUGE_AXIS_COLOR: ReadonlyArray<readonly [number, string]> = [
  [0.6, COLORS.emerald[200]],
  [0.85, COLORS.emerald[400]],
  [1, COLORS.emerald[500]],
] as const
