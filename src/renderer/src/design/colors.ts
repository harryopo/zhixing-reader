/**
 * 知行读书 — 色值出口
 *
 * 真值在 tokens/brand.json，`npm run build:tokens` 生成 ./palette.ts。
 * 本文件保留既有调用方熟悉的出口名，并放派生序列（图表调色板、仪表轴渐变）。
 * 改色请改 JSON，别在这里加第四份 hex。
 */
import { PALETTE } from './palette'

export const COLORS = PALETTE

/**
 * ECharts 系列调色板（环形图/柱图共用）— 顺序：主色 → 浅色 → 强调色 → 中性辅助
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

/** Tooltip / Detail 文本色（深色背景上用白色，浅色背景上用 gray-800） */
export const TEXT_ON_DARK = COLORS.white
export const TEXT_ON_LIGHT = COLORS.gray[800]

/** Gauge 进度条三段式（绿/浅绿/极浅绿） */
export const GAUGE_AXIS_COLOR: ReadonlyArray<readonly [number, string]> = [
  [0.6, COLORS.emerald[200]],
  [0.85, COLORS.emerald[400]],
  [1, COLORS.emerald[500]],
] as const
