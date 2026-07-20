/**
 * 知行读书 — ECharts 主题（与项目设计统一）
 *
 * 设计原则：
 * - 淡雅绿色系（Tailwind emerald-* 色阶）
 * - 暗色文本保留可读性（gray-800 / gray-500 / gray-400）
 * - 透明背景适配卡片容器
 * - 与 Stats 页 Recharts 风格保持视觉一致
 *
 * 加载位置：AdminDashboard.tsx 顶部（一次性注册）
 *
 * 2026-07-20 P1-2 重构：色值统一从 `design/colors.ts` 引用，避免硬编码分散。
 */

import * as echarts from 'echarts/core'
import {
  COLORS,
  ECHARTS_PALETTE,
  GAUGE_AXIS_COLOR,
  TEXT_ON_DARK,
  TEXT_ON_LIGHT,
} from './design/colors'

/** Tailwind 绿色主题（emerald + lime 辅色） */
export const tailwindTheme = {
  color: ECHARTS_PALETTE,
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily: 'inherit',
    color: TEXT_ON_LIGHT,
  },
  title: {
    textStyle: {
      color: TEXT_ON_LIGHT,
      fontSize: 14,
      fontWeight: 600,
    },
    subtextStyle: {
      color: COLORS.gray[400],
      fontSize: 11,
    },
  },
  legend: {
    textStyle: {
      color: COLORS.gray[600],
      fontSize: 11,
    },
    itemWidth: 10,
    itemHeight: 10,
  },
  tooltip: {
    backgroundColor: 'rgba(31,41,55,0.95)',
    borderWidth: 0,
    borderRadius: 8,
    textStyle: {
      color: TEXT_ON_DARK,
      fontSize: 12,
    },
    extraCssText: 'box-shadow: 0 4px 12px rgba(0,0,0,0.15);',
  },
  grid: {
    containLabel: true,
    borderColor: COLORS.gray[100],
  },
  categoryAxis: {
    axisLine: { lineStyle: { color: COLORS.gray[200] } },
    axisTick: { lineStyle: { color: COLORS.gray[200] } },
    axisLabel: { color: COLORS.gray[400], fontSize: 10 },
    splitLine: { show: false, lineStyle: { color: COLORS.gray[100] } },
    splitArea: { show: false },
  },
  valueAxis: {
    axisLine: { show: false, lineStyle: { color: COLORS.gray[200] } },
    axisTick: { show: false },
    axisLabel: { color: COLORS.gray[400], fontSize: 10 },
    splitLine: { lineStyle: { color: COLORS.gray[100], type: 'dashed' } },
    splitArea: { show: false },
  },
  line: {
    smooth: true,
    symbol: 'circle',
    symbolSize: 6,
    lineStyle: { width: 2 },
    itemStyle: { borderWidth: 2 },
  },
  bar: {
    itemStyle: {
      borderRadius: [4, 4, 0, 0],
    },
  },
  pie: {
    itemStyle: {
      borderRadius: 4,
      borderColor: COLORS.white,
      borderWidth: 2,
    },
  },
  gauge: {
    axisLine: {
      lineStyle: {
        width: 12,
        color: GAUGE_AXIS_COLOR as unknown as Array<[number, string]>,
      },
    },
    progress: {
      show: true,
      width: 12,
    },
    axisTick: { show: false },
    splitLine: { length: 8, lineStyle: { width: 2, color: COLORS.gray[300] } },
    axisLabel: { color: COLORS.gray[400], fontSize: 10, distance: -30 },
    pointer: { show: false },
    anchor: { show: false },
    title: { show: false },
    detail: {
      valueAnimation: true,
      color: TEXT_ON_LIGHT,
      fontSize: 22,
      fontWeight: 700,
    },
  },
}

/** 注册 Tailwind 主题（仅在 AdminDashboard 入口调用一次） */
let registered = false
export function registerTailwindTheme(): void {
  if (registered) return
  echarts.registerTheme('tailwind', tailwindTheme)
  registered = true
}
