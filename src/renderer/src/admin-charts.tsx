/**
 * 知行读书 — AdminDashboard 图表组件（基于 Apache ECharts 5.5.1）
 *
 * 按需引入策略：仅加载使用的图表类型与组件，最大化代码分割收益。
 * 原 Recharts 全量包 ~862KB → 切到 ECharts 后本 chunk < 500KB。
 *
 * 6 个图表：
 *  1. ProviderPieChart       — Provider Token 占比（环形图）
 *  2. ModelBarChart          — Model 用量 Top 10（水平柱图）
 *  3. FeatureBarChart        — Feature Token + 请求数（垂直柱图，双 Y 轴）
 *  4. RequestPieChart        — Feature 请求数占比（环形图）
 *  5. TokensGauge            — Token 用量综合（仪表盘）
 *  6. ProviderTokenBarChart  — Provider 输入/输出 Token（分组柱图）
 */

import * as echarts from 'echarts/core'
import { BarChart, GaugeChart, PieChart } from 'echarts/charts'
import {
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  TransformComponent,
} from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import ReactECharts from 'echarts-for-react'

import type { ProviderStats, FeatureStats } from '../../types/renderer'
import { registerTailwindTheme, tailwindTheme } from './echarts-theme-tailwind'

// === 按需注册 ECharts 模块（仅在 AdminDashboard 入口生效） ===
echarts.use([
  BarChart,
  GaugeChart,
  PieChart,
  DatasetComponent,
  GridComponent,
  LegendComponent,
  TitleComponent,
  TooltipComponent,
  TransformComponent,
  CanvasRenderer,
])
registerTailwindTheme()

// === 通用 ECharts 实例默认值（Canvas 高 DPI、动画克制） ===
const COMMON_SETTLE_OPTION = {
  textStyle: { fontFamily: 'inherit' },
  animation: true,
  animationDuration: 400,
  animationEasing: 'cubicOut' as const,
}

const PALETTE = tailwindTheme.color as string[]

/** 数字格式化：1.2k / 3.4M */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k'
  return String(n)
}

/** ECharts 容器尺寸（统一高度，保持视觉一致） */
const HEIGHT = 240
const TALL_HEIGHT = 280

// === 1. Provider Token 占比（环形图） ===
export function ProviderPieChart({ providers }: { providers: ProviderStats[] }) {
  if (providers.length === 0) {
    return <EmptyState height={HEIGHT} />
  }
  const data = providers.map(p => ({
    name: p.provider === 'unknown' ? '未指定' : p.provider,
    value: p.total_tokens,
  }))
  const option = {
    ...COMMON_SETTLE_OPTION,
    color: PALETTE,
    tooltip: {
      trigger: 'item' as const,
      formatter: (p: { name: string; value: number; percent: number }) =>
        `${p.name}<br/>${formatTokens(p.value)} (${p.percent.toFixed(1)}%)`,
    },
    legend: {
      bottom: 0,
      left: 'center',
      textStyle: { color: '#6b7280', fontSize: 11 },
    },
    series: [
      {
        type: 'pie' as const,
        radius: ['50%', '78%'],
        center: ['50%', '45%'],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
        label: {
          show: true,
          position: 'outside' as const,
          formatter: '{b}\n{d}%',
          fontSize: 10,
          color: '#4b5563',
        },
        labelLine: { show: true, length: 6, length2: 8 },
        data,
      },
    ],
  }
  return (
    <ChartFigure title="Provider 占比" subtitle="按 Token 用量" dataCount={data.length}>
      <ReactECharts option={option} style={{ height: HEIGHT }} theme="tailwind" opts={{ renderer: 'canvas' }} notMerge />
    </ChartFigure>
  )
}

// === 2. Model 用量 Top 10（水平柱图） ===
export function ModelBarChart({ providers }: { providers: ProviderStats[] }) {
  if (providers.length === 0) {
    return <EmptyState height={TALL_HEIGHT} />
  }
  const data = providers.slice(0, 10).map(p => ({
    name: p.model === 'unknown' ? '未指定' : p.model.length > 14 ? p.model.slice(0, 14) + '…' : p.model,
    value: p.total_tokens,
  }))
  const option = {
    ...COMMON_SETTLE_OPTION,
    grid: { left: 110, right: 30, top: 10, bottom: 20, containLabel: false },
    tooltip: {
      trigger: 'item' as const,
      formatter: (p: { name: string; value: number }) =>
        `${p.name}<br/>${formatTokens(p.value)}`,
    },
    xAxis: {
      type: 'value' as const,
      axisLabel: { color: '#9ca3af', fontSize: 10, formatter: formatTokens },
    },
    yAxis: {
      type: 'category' as const,
      data: data.map(d => d.name).reverse(),
      axisLabel: { color: '#9ca3af', fontSize: 10 },
    },
    series: [
      {
        type: 'bar' as const,
        data: data.map(d => d.value).reverse(),
        itemStyle: { color: '#10b981', borderRadius: [0, 4, 4, 0] },
        barMaxWidth: 18,
      },
    ],
  }
  return (
    <ChartFigure title="Model 用量 Top 10" subtitle="按 Token 用量" dataCount={data.length}>
      <ReactECharts option={option} style={{ height: TALL_HEIGHT }} theme="tailwind" opts={{ renderer: 'canvas' }} notMerge />
    </ChartFigure>
  )
}

// === 3. Feature Token + 请求数（垂直柱图，双 Y 轴） ===
export function FeatureBarChart({ features }: { features: FeatureStats[] }) {
  if (features.length === 0) {
    return <EmptyState height={TALL_HEIGHT} />
  }
  const data = features.map(f => ({ name: f.feature, tokens: f.total_tokens, requests: f.request_count }))
  const option = {
    ...COMMON_SETTLE_OPTION,
    grid: { left: 50, right: 50, top: 30, bottom: 60 },
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'shadow' as const },
      formatter: (params: Array<{ name: string; seriesName: string; value: number }>) => {
        const lines = params.map(p => `${p.seriesName}: ${p.seriesName === 'Token' ? formatTokens(p.value) : p.value}`)
        return `${params[0]?.name ?? ''}<br/>${lines.join('<br/>')}`
      },
    },
    legend: { top: 0, right: 0, textStyle: { fontSize: 11, color: '#6b7280' } },
    xAxis: {
      type: 'category' as const,
      data: data.map(d => d.name),
      axisLabel: { color: '#9ca3af', fontSize: 10, rotate: 15 },
    },
    yAxis: [
      {
        type: 'value' as const,
        axisLabel: { color: '#9ca3af', fontSize: 10, formatter: formatTokens },
        splitLine: { lineStyle: { color: '#f3f4f6', type: 'dashed' as const } },
      },
      {
        type: 'value' as const,
        axisLabel: { color: '#9ca3af', fontSize: 10 },
        splitLine: { show: false },
      },
    ],
    series: [
      {
        name: 'Token',
        type: 'bar' as const,
        yAxisIndex: 0,
        data: data.map(d => d.tokens),
        itemStyle: { color: '#10b981', borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 22,
      },
      {
        name: '请求数',
        type: 'bar' as const,
        yAxisIndex: 1,
        data: data.map(d => d.requests),
        itemStyle: { color: '#34d399', borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 22,
      },
    ],
  }
  return (
    <ChartFigure title="Feature 拆分" subtitle="各功能调用情况" dataCount={data.length}>
      <ReactECharts option={option} style={{ height: TALL_HEIGHT }} theme="tailwind" opts={{ renderer: 'canvas' }} notMerge />
    </ChartFigure>
  )
}

// === 4. Feature 请求数占比（环形图） ===
export function RequestPieChart({ features }: { features: FeatureStats[] }) {
  if (features.length === 0) {
    return <EmptyState height={HEIGHT} />
  }
  const data = features.map(f => ({ name: f.feature, value: f.request_count }))
  const option = {
    ...COMMON_SETTLE_OPTION,
    color: PALETTE,
    tooltip: {
      trigger: 'item' as const,
      formatter: (p: { name: string; value: number; percent: number }) =>
        `${p.name}<br/>${p.value} 次 (${p.percent.toFixed(1)}%)`,
    },
    legend: {
      bottom: 0,
      left: 'center',
      textStyle: { color: '#6b7280', fontSize: 11 },
    },
    series: [
      {
        type: 'pie' as const,
        radius: ['50%', '78%'],
        center: ['50%', '45%'],
        avoidLabelOverlap: true,
        itemStyle: { borderRadius: 4, borderColor: '#fff', borderWidth: 2 },
        label: {
          show: true,
          position: 'outside' as const,
          formatter: '{b}\n{d}%',
          fontSize: 10,
          color: '#4b5563',
        },
        labelLine: { show: true, length: 6, length2: 8 },
        data,
      },
    ],
  }
  return (
    <ChartFigure title="Feature 请求数占比" subtitle="按请求数" dataCount={data.length}>
      <ReactECharts option={option} style={{ height: HEIGHT }} theme="tailwind" opts={{ renderer: 'canvas' }} notMerge />
    </ChartFigure>
  )
}

// === 5. Token 用量综合（仪表盘） ===
// 显示已用 token 占"日常参考容量"（5M）的比例；纯展示性，不是真正的限流。
export function TokensGauge({ totalTokens }: { totalTokens: number }) {
  const cap = 5_000_000
  const pct = Math.min(100, (totalTokens / cap) * 100)
  const option = {
    ...COMMON_SETTLE_OPTION,
    series: [
      {
        type: 'gauge' as const,
        center: ['50%', '60%'],
        radius: '95%',
        startAngle: 200,
        endAngle: -20,
        min: 0,
        max: 100,
        progress: { show: true, width: 12, roundCap: true },
        axisLine: { lineStyle: { width: 12, color: [[1, '#e5e7eb']] } },
        pointer: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { show: false },
        anchor: { show: false },
        title: { show: false },
        detail: {
          valueAnimation: true,
          offsetCenter: [0, '5%'],
          formatter: () => formatTokens(totalTokens),
          color: '#1f2937',
          fontSize: 22,
          fontWeight: 700,
        },
        data: [{ value: pct }],
      },
    ],
  }
  return (
    <ChartFigure title="Token 用量综合" subtitle="相对参考容量 5M" dataCount={1}>
      <div>
        <ReactECharts option={option} style={{ height: HEIGHT - 40 }} theme="tailwind" opts={{ renderer: 'canvas' }} notMerge />
        <div className="text-center -mt-2 text-[11px] text-gray-400">相对参考容量 5M Token</div>
      </div>
    </ChartFigure>
  )
}

// === 6. Provider 输入/输出 Token（分组柱图） ===
export function ProviderTokenBarChart({ providers }: { providers: ProviderStats[] }) {
  if (providers.length === 0) {
    return <EmptyState height={TALL_HEIGHT} />
  }
  const data = providers.slice(0, 6).map(p => ({
    name: p.provider === 'unknown' ? '未指定' : p.provider,
    input: p.total_input_tokens,
    output: p.total_output_tokens,
  }))
  const option = {
    ...COMMON_SETTLE_OPTION,
    grid: { left: 50, right: 20, top: 30, bottom: 30 },
    tooltip: {
      trigger: 'axis' as const,
      axisPointer: { type: 'shadow' as const },
      formatter: (params: Array<{ name: string; seriesName: string; value: number }>) => {
        const lines = params.map(p => `${p.seriesName}: ${formatTokens(p.value)}`)
        return `${params[0]?.name ?? ''}<br/>${lines.join('<br/>')}`
      },
    },
    legend: { top: 0, right: 0, textStyle: { fontSize: 11, color: '#6b7280' } },
    xAxis: {
      type: 'category' as const,
      data: data.map(d => d.name),
      axisLabel: { color: '#9ca3af', fontSize: 10 },
    },
    yAxis: {
      type: 'value' as const,
      axisLabel: { color: '#9ca3af', fontSize: 10, formatter: formatTokens },
      splitLine: { lineStyle: { color: '#f3f4f6', type: 'dashed' as const } },
    },
    series: [
      {
        name: '输入 Token',
        type: 'bar' as const,
        stack: 'tokens',
        data: data.map(d => d.input),
        itemStyle: { color: '#6ee7b7' },
        barMaxWidth: 28,
      },
      {
        name: '输出 Token',
        type: 'bar' as const,
        stack: 'tokens',
        data: data.map(d => d.output),
        itemStyle: { color: '#10b981', borderRadius: [4, 4, 0, 0] },
        barMaxWidth: 28,
      },
    ],
  }
  return (
    <ChartFigure title="Provider 输入/输出 Token" subtitle="按 Provider 分组堆叠" dataCount={data.length}>
      <ReactECharts option={option} style={{ height: TALL_HEIGHT }} theme="tailwind" opts={{ renderer: 'canvas' }} notMerge />
    </ChartFigure>
  )
}

// === 空数据态 ===
function EmptyState({ height }: { height: number }) {
  return (
    <div
      className="flex items-center justify-center text-gray-300 text-sm"
      style={{ height }}
    >
      暂无数据
    </div>
  )
}

// === 图表无障碍包装（2026-07-20 P1-4 修复） ===
// EChartsReact 不会把 aria-* props 透传到内部 div，因此外层显式包裹带 role="img" 的容器。
// 屏幕阅读器读到 aria-label 时，能复述图表标题 + 数据规模。
function ChartFigure({
  title,
  subtitle,
  dataCount,
  children,
}: {
  title: string
  subtitle?: string
  dataCount: number
  children: React.ReactNode
}) {
  const label = subtitle ? `${title}：${subtitle}。共 ${dataCount} 项数据` : `${title}。共 ${dataCount} 项数据`
  return (
    <div role="img" aria-label={label}>
      {children}
    </div>
  )
}
