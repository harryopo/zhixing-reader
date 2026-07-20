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
 */

import * as echarts from 'echarts/core'

/** Tailwind 绿色主题（emerald + lime 辅色） */
export const tailwindTheme = {
  color: [
    '#10b981', // emerald-500（主色）
    '#34d399', // emerald-400
    '#6ee7b7', // emerald-300
    '#a7f3d0', // emerald-200
    '#059669', // emerald-600
    '#047857', // emerald-700
    '#84cc16', // lime-500
    '#22c55e', // green-500
    '#f59e0b', // amber-500（强调）
    '#f43f5e', // rose-500（警告）
    '#3b82f6', // blue-500（信息）
    '#a78bfa', // violet-400
  ],
  backgroundColor: 'transparent',
  textStyle: {
    fontFamily: 'inherit',
    color: '#1f2937', // gray-800
  },
  title: {
    textStyle: {
      color: '#1f2937',
      fontSize: 14,
      fontWeight: 600,
    },
    subtextStyle: {
      color: '#9ca3af',
      fontSize: 11,
    },
  },
  legend: {
    textStyle: {
      color: '#4b5563',
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
      color: '#fff',
      fontSize: 12,
    },
    extraCssText: 'box-shadow: 0 4px 12px rgba(0,0,0,0.15);',
  },
  grid: {
    containLabel: true,
    borderColor: '#f3f4f6',
  },
  categoryAxis: {
    axisLine: { lineStyle: { color: '#e5e7eb' } },
    axisTick: { lineStyle: { color: '#e5e7eb' } },
    axisLabel: { color: '#9ca3af', fontSize: 10 },
    splitLine: { show: false, lineStyle: { color: '#f3f4f6' } },
    splitArea: { show: false },
  },
  valueAxis: {
    axisLine: { show: false, lineStyle: { color: '#e5e7eb' } },
    axisTick: { show: false },
    axisLabel: { color: '#9ca3af', fontSize: 10 },
    splitLine: { lineStyle: { color: '#f3f4f6', type: 'dashed' } },
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
      borderColor: '#fff',
      borderWidth: 2,
    },
  },
  gauge: {
    axisLine: {
      lineStyle: {
        width: 12,
        color: [
          [0.6, '#a7f3d0'],
          [0.85, '#34d399'],
          [1, '#10b981'],
        ],
      },
    },
    progress: {
      show: true,
      width: 12,
    },
    axisTick: { show: false },
    splitLine: { length: 8, lineStyle: { width: 2, color: '#d1d5db' } },
    axisLabel: { color: '#9ca3af', fontSize: 10, distance: -30 },
    pointer: { show: false },
    anchor: { show: false },
    title: { show: false },
    detail: {
      valueAnimation: true,
      color: '#1f2937',
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
