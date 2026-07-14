import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import {
  TokenSummary, TokenRecord, ProviderStats, FeatureStats, DailyTokenStats
} from '../../../types/renderer'

type TimeRange = 'today' | '7d' | '14d' | '30d'
type TabKey = 'logs' | 'providers' | 'features'

const FEATURE_LABELS: Record<string, string> = {
  generateCards: '生成卡片',
  generateSummary: '生成摘要',
  chat: 'AI对话',
  explain: '解释内容',
}

const CHART_COLORS = {
  input: '#1A73E8',
  inputFill: '#1A73E8',
  output: '#7C3AED',
  outputFill: '#7C3AED',
  grid: '#E5E7EB',
  axis: '#9CA3AF',
  tooltip: 'rgba(31,41,55,0.92)',
}

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

function formatTokensFull(n: number): string {
  return n.toLocaleString()
}

function formatDuration(ms: number): string {
  if (ms >= 60000) return (ms / 60000).toFixed(1) + 'min'
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's'
  return ms + 'ms'
}

function formatTimeAgo(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return '-'
    const now = new Date()
    const diffMin = Math.floor((now.getTime() - d.getTime()) / 60000)
    if (diffMin < 1) return '刚刚'
    if (diffMin < 60) return `${diffMin}分钟前`
    const diffHr = Math.floor(diffMin / 60)
    if (diffHr < 24) return `${diffHr}小时前`
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return '-' }
}

function formatDateFull(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return '-'
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  } catch { return '-' }
}

function formatDateShort(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return '-'
    return d.toLocaleDateString('zh-CN', { day: 'numeric' })
  } catch { return '-' }
}

function UsageHero({ summary, loading }: { summary: TokenSummary | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="rounded-xl border border-border/50 bg-white p-8 flex items-center justify-center min-h-[180px]">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
      </div>
    )
  }

  const totalTokens = summary?.totalTokens ?? 0
  const inputTokens = summary?.totalInputTokens ?? 0
  const outputTokens = summary?.totalOutputTokens ?? 0
  const requests = summary?.totalRequests ?? 0
  const inputPct = totalTokens > 0 ? Math.round((inputTokens / totalTokens) * 100) : 0
  const outputPct = totalTokens > 0 ? Math.round((outputTokens / totalTokens) * 100) : 0

  return (
    <div className="relative overflow-hidden rounded-xl border border-border/50 bg-gradient-to-br from-primary/5 via-white to-surface-secondary/50 shadow-sm">
      <div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-bl from-primary/5 to-transparent rounded-bl-full" />

      <div className="relative p-6 md:p-8">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <svg className="w-4 h-4 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <div>
              <span className="text-sm font-semibold text-gray-900">Token 总消耗</span>
              <p className="text-xs text-text-tertiary">AI 功能调用累计统计</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary/5">
              <svg className="w-3.5 h-3.5 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              <span className="text-xs font-medium text-primary">{requests.toLocaleString()} 次请求</span>
            </div>
          </div>
        </div>

        <div className="flex items-baseline gap-2 mb-3">
          <span className="text-5xl font-bold tracking-tight tabular-nums text-gray-900">
            {formatTokensFull(totalTokens)}
          </span>
          <span className="text-sm text-text-tertiary">tokens</span>
        </div>

        <div className="h-3 rounded-full bg-gray-100 overflow-hidden flex">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-l-full transition-all duration-700"
            style={{ width: `${inputPct}%` }}
          />
          <div
            className="h-full bg-gradient-to-r from-purple-500 to-purple-400 rounded-r-full transition-all duration-700"
            style={{ width: `${outputPct}%` }}
          />
        </div>

        <div className="flex items-center justify-between mt-2.5 text-xs">
          <div className="flex items-center gap-5">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-blue-500" />
              <span className="text-text-secondary">输入 {formatTokens(inputTokens)}</span>
              <span className="text-text-tertiary">({inputPct}%)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-purple-500" />
              <span className="text-text-secondary">输出 {formatTokens(outputTokens)}</span>
              <span className="text-text-tertiary">({outputPct}%)</span>
            </div>
          </div>
          <span className="text-text-tertiary">≈ {formatTokens(totalTokens)} tokens</span>
        </div>
      </div>
    </div>
  )
}

function TrendSummaryCards({ dailyStats, sorted }: { dailyStats: DailyTokenStats[]; sorted: DailyTokenStats[] }) {
  const nonZero = sorted.filter(d => d.total_tokens > 0)
  const peak = nonZero.length > 0 ? nonZero.reduce((a, b) => a.total_tokens > b.total_tokens ? a : b) : null
  const avgTokens = nonZero.length > 0 ? Math.round(nonZero.reduce((s, d) => s + d.total_tokens, 0) / nonZero.length) : 0
  const totalRange = sorted.reduce((s, d) => s + d.total_tokens, 0)

  const trend = nonZero.length >= 2
    ? (() => {
        const mid = Math.floor(nonZero.length / 2)
        const firstHalf = nonZero.slice(0, mid).reduce((s, d) => s + d.total_tokens, 0)
        const secondHalf = nonZero.slice(mid).reduce((s, d) => s + d.total_tokens, 0)
        if (firstHalf === 0) return secondHalf > 0 ? 100 : 0
        return Math.round(((secondHalf - firstHalf) / firstHalf) * 100)
      })()
    : 0

  return (
    <div className="grid grid-cols-3 gap-3">
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3.5 shadow-sm">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-2">
          <svg className="w-3.5 h-3.5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
          </svg>
          峰值日消耗
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-gray-900 tabular-nums">
            {peak ? formatTokens(peak.total_tokens) : '-'}
          </span>
          {peak && (
            <span className="text-xs text-gray-400 font-medium">{formatDateFull(peak.date)}</span>
          )}
        </div>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3.5 shadow-sm">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-2">
          <svg className="w-3.5 h-3.5 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          日均消耗
        </div>
        <div className="flex items-baseline gap-2">
          <span className="text-xl font-bold text-gray-900 tabular-nums">{formatTokens(avgTokens)}</span>
          <span className="text-xs text-gray-400 font-medium">{formatTokensFull(totalRange)} 总计</span>
        </div>
      </div>
      <div className="rounded-lg border border-gray-200 bg-white px-4 py-3.5 shadow-sm">
        <div className="flex items-center gap-1.5 text-xs text-gray-500 mb-2">
          <svg className="w-3.5 h-3.5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          近期趋势
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`text-xl font-bold tabular-nums ${trend > 0 ? 'text-red-500' : trend < 0 ? 'text-green-600' : 'text-gray-900'}`}>
            {trend > 0 ? `↑${trend}%` : trend < 0 ? `↓${Math.abs(trend)}%` : '持平'}
          </span>
        </div>
      </div>
    </div>
  )
}

function DailyTrendChart({ dailyStats, loading }: { dailyStats: DailyTokenStats[]; loading: boolean }) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  if (loading) {
    return (
      <div className="rounded-xl border border-border/50 bg-white p-6 flex items-center justify-center min-h-[300px]">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (dailyStats.length === 0) {
    return (
      <div className="rounded-xl border border-border/50 bg-white p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4">Token 消耗趋势</h3>
        <div className="flex items-center justify-center py-14 text-text-tertiary">
          <div className="text-center">
            <svg className="w-12 h-12 mx-auto mb-3 opacity-30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            <p className="text-sm">暂无趋势数据</p>
          </div>
        </div>
      </div>
    )
  }

  const sorted = [...dailyStats].sort((a, b) => a.date.localeCompare(b.date))
  const maxTokens = Math.max(...sorted.map(d => d.total_tokens), 1)

  const padding = { top: 12, right: 12, bottom: 28, left: 48 }
  const width = 720
  const height = 260
  const chartW = width - padding.left - padding.right
  const chartH = height - padding.top - padding.bottom

  const ySteps = 4
  const yStepVal = Math.ceil(maxTokens / ySteps / 100) * 100 || maxTokens / ySteps
  const yMax = yStepVal * ySteps
  const yLabels = Array.from({ length: ySteps + 1 }, (_, i) => Math.round(i * yStepVal))

  const step = chartW / Math.max(sorted.length - 1, 1)

  const getX = (i: number) => padding.left + step * i
  const getY = (val: number) => padding.top + chartH - (val / yMax) * chartH

  const buildSmoothPath = (pts: [number, number][], closeBottom: boolean): string => {
    if (pts.length < 2) return ''
    let path = `M ${pts[0][0]} ${pts[0][1]}`
    for (let i = 0; i < pts.length - 1; i++) {
      const [x0, y0] = pts[i]
      const [x1, y1] = pts[i + 1]
      const cp = (x1 - x0) * 0.4
      path += ` C ${x0 + cp} ${y0}, ${x1 - cp} ${y1}, ${x1} ${y1}`
    }
    if (closeBottom) {
      const last = pts[pts.length - 1]
      const first = pts[0]
      path += ` L ${last[0]} ${padding.top + chartH} L ${first[0]} ${padding.top + chartH} Z`
    }
    return path
  }

  const inputData: [number, number][] = sorted.map((d, i) => [
    getX(i),
    getY(Math.max(d.total_input_tokens, 0.5)),
  ])
  const totalLine: [number, number][] = sorted.map((d, i) => [
    getX(i),
    getY(d.total_tokens),
  ])

  const stackedTop: [number, number][] = sorted.map((d, i) => {
    const total = Math.max(d.total_input_tokens + d.total_output_tokens, 1)
    return [getX(i), getY(total)]
  })

  const inputAreaPath = buildSmoothPath(inputData, true)
  const outputAreaPath = buildSmoothPath(stackedTop, true)
  const totalLinePath = buildSmoothPath(totalLine, false)

  const showLabels = sorted.length <= 14

  const getTooltipStyle = (): React.CSSProperties | null => {
    if (hoveredIdx === null || !svgRef.current) return null
    const svgRect = svgRef.current.getBoundingClientRect()
    const viewX = getX(hoveredIdx)
    const scale = svgRect.width / width
    const left = viewX * scale
    const isRightSide = hoveredIdx > sorted.length / 2
    return {
      position: 'absolute',
      top: '0.25rem',
      left: `${left}px`,
      transform: isRightSide ? 'translateX(-100%)' : 'translateX(0)',
      pointerEvents: 'none',
      zIndex: 10,
    }
  }

  const hovered = hoveredIdx !== null ? sorted[hoveredIdx] : null
  const inputPct = hovered && hovered.total_tokens > 0
    ? Math.round((hovered.total_input_tokens / hovered.total_tokens) * 100)
    : 0
  const outputPct = hovered && hovered.total_tokens > 0
    ? 100 - inputPct
    : 0

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
              </svg>
            </div>
            <h3 className="text-sm font-semibold text-gray-900">Token 消耗趋势</h3>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-blue-500" />
              <span className="text-text-tertiary">输入</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-sm bg-purple-500" />
              <span className="text-text-tertiary">输出</span>
            </div>
            <div className="flex items-center gap-1.5">
              <svg width="16" height="4" viewBox="0 0 16 4">
                <line x1="0" y1="2" x2="16" y2="2" stroke="#374151" strokeWidth="2" strokeDasharray="3 2" />
              </svg>
              <span className="text-text-tertiary">总消耗</span>
            </div>
          </div>
        </div>

        <TrendSummaryCards dailyStats={dailyStats} sorted={sorted} />
      </div>

      <div className="relative px-6 pb-5 pt-2 bg-gray-50/50 border-t border-gray-100" onMouseLeave={() => setHoveredIdx(null)}>
        <div className="relative">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              <linearGradient id="inputAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.input} stopOpacity="0.28" />
                <stop offset="100%" stopColor={CHART_COLORS.input} stopOpacity="0.04" />
              </linearGradient>
              <linearGradient id="outputAreaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={CHART_COLORS.output} stopOpacity="0.24" />
                <stop offset="100%" stopColor={CHART_COLORS.output} stopOpacity="0.03" />
              </linearGradient>
            </defs>

            {yLabels.map((val) => (
              <g key={val}>
                <line
                  x1={padding.left}
                  y1={getY(val)}
                  x2={width - padding.right}
                  y2={getY(val)}
                  stroke={CHART_COLORS.grid}
                  strokeDasharray="3 3"
                  strokeWidth="0.5"
                />
                <text
                  x={padding.left - 8}
                  y={getY(val)}
                  textAnchor="end"
                  alignmentBaseline="middle"
                  fill={CHART_COLORS.axis}
                  fontSize="10"
                  fontFamily="system-ui, sans-serif"
                >
                  {formatTokens(val)}
                </text>
              </g>
            ))}

            <path d={inputAreaPath} fill="url(#inputAreaGrad)" />
            <path d={outputAreaPath} fill="url(#outputAreaGrad)" />

            <path
              d={totalLinePath}
              fill="none"
              stroke="#374151"
              strokeWidth="1.5"
              strokeDasharray="4 2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {hoveredIdx !== null && (
              <line
                x1={getX(hoveredIdx)}
                y1={padding.top}
                x2={getX(hoveredIdx)}
                y2={padding.top + chartH}
                stroke="#D1D5DB"
                strokeWidth="1"
                strokeDasharray="3 3"
              />
            )}

            {sorted.map((d, i) => (
              <circle
                key={`dot-${i}`}
                cx={getX(i)}
                cy={getY(d.total_tokens)}
                r={hoveredIdx === i ? 4 : 2}
                fill={hoveredIdx === i ? '#374151' : '#374151'}
                fillOpacity={hoveredIdx === null ? 0.3 : hoveredIdx === i ? 1 : 0.15}
                stroke="#fff"
                strokeWidth="1"
                className="transition-all duration-150"
              />
            ))}

            <rect
              x={padding.left}
              y={padding.top}
              width={chartW}
              height={chartH}
              fill="transparent"
              onMouseMove={(e) => {
                const svg = e.currentTarget.closest('svg')
                if (!svg) return
                const rect = svg.getBoundingClientRect()
                const scaleX = width / rect.width
                const mx = (e.clientX - rect.left) * scaleX
                const idx = Math.round((mx - padding.left) / step)
                const clamped = Math.max(0, Math.min(sorted.length - 1, idx))
                setHoveredIdx(clamped)
              }}
              style={{ cursor: 'crosshair' }}
            />

            {showLabels && sorted.map((d, i) => {
              const labelEvery = sorted.length <= 7 ? 1 : sorted.length <= 14 ? 2 : 3
              if (i % labelEvery !== 0 && i !== sorted.length - 1) return null
              return (
                <text
                  key={`lbl-${i}`}
                  x={getX(i)}
                  y={height - 4}
                  textAnchor="middle"
                  fill={CHART_COLORS.axis}
                  fontSize="10"
                  fontFamily="system-ui, sans-serif"
                >
                  {sorted.length <= 7 ? formatDateFull(d.date) : formatDateShort(d.date)}
                </text>
              )
            })}
          </svg>

          {hovered && getTooltipStyle() && (
            <div style={getTooltipStyle()!}>
              <div className={`bg-gray-900/95 backdrop-blur-sm rounded-lg px-3 py-2.5 shadow-lg border border-white/10 min-w-[140px] ${
                hoveredIdx! > sorted.length / 2 ? 'mr-2' : 'ml-2'
              }`}>
                <div className="text-[11px] text-gray-400 mb-1.5 font-medium">
                  {formatDateFull(hovered.date)}
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-blue-400" />
                    <span className="text-[11px] text-blue-300 tabular-nums">
                      {formatTokens(hovered.total_input_tokens)}
                    </span>
                  </div>
                  <span className="text-[10px] text-gray-500">{inputPct}%</span>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <div className="flex items-center gap-1.5">
                    <div className="w-2 h-2 rounded-full bg-purple-400" />
                    <span className="text-[11px] text-purple-300 tabular-nums">
                      {formatTokens(hovered.total_output_tokens)}
                    </span>
                  </div>
                  <span className="text-[10px] text-gray-500">{outputPct}%</span>
                </div>
                <div className="mt-1.5 pt-1.5 border-t border-white/10 flex items-center justify-between">
                  <span className="text-[10px] text-gray-500">合计</span>
                  <span className="text-[13px] text-white font-bold tabular-nums">
                    {formatTokens(hovered.total_tokens)}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function RequestLogTable({ records, loading }: { records: TokenRecord[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="text-center py-16 text-text-tertiary">
        <div className="text-4xl mb-3">⚡</div>
        <p className="text-sm font-medium">暂无调用记录</p>
        <p className="text-xs mt-1">使用AI功能后将自动记录Token消耗</p>
      </div>
    )
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border/50">
      <table className="w-full">
        <thead>
          <tr className="border-b border-border/50 bg-surface-secondary">
            <th className="text-left py-3 px-4 text-xs font-medium text-text-tertiary uppercase tracking-wider">功能</th>
            <th className="text-left py-3 px-4 text-xs font-medium text-text-tertiary uppercase tracking-wider">模型</th>
            <th className="text-right py-3 px-4 text-xs font-medium text-text-tertiary uppercase tracking-wider">输入</th>
            <th className="text-right py-3 px-4 text-xs font-medium text-text-tertiary uppercase tracking-wider">输出</th>
            <th className="text-right py-3 px-4 text-xs font-medium text-text-tertiary uppercase tracking-wider">合计</th>
            <th className="text-right py-3 px-4 text-xs font-medium text-text-tertiary uppercase tracking-wider">耗时</th>
            <th className="text-right py-3 px-4 text-xs font-medium text-text-tertiary uppercase tracking-wider">时间</th>
          </tr>
        </thead>
        <tbody>
          {records.map((record) => (
            <tr key={record.id} className="border-b border-border/30 hover:bg-surface-secondary/50 transition-colors">
              <td className="py-3 px-4">
                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                  record.feature === 'chat' ? 'bg-blue-100 text-blue-700'
                    : record.feature === 'generateCards' ? 'bg-amber-100 text-amber-700'
                    : record.feature === 'generateSummary' ? 'bg-green-100 text-green-700'
                    : 'bg-purple-100 text-purple-700'
                }`}>
                  {FEATURE_LABELS[record.feature] || record.feature}
                </span>
              </td>
              <td className="py-3 px-4">
                <span className="text-sm text-gray-600">{record.model}</span>
              </td>
              <td className="py-3 px-4 text-right text-sm font-medium text-blue-600 tabular-nums">
                {formatTokens(record.input_tokens)}
              </td>
              <td className="py-3 px-4 text-right text-sm font-medium text-purple-600 tabular-nums">
                {formatTokens(record.output_tokens)}
              </td>
              <td className="py-3 px-4 text-right text-sm font-semibold text-gray-900 tabular-nums">
                {formatTokens(record.total_tokens)}
              </td>
              <td className="py-3 px-4 text-right text-sm text-text-tertiary tabular-nums">
                {record.duration_ms > 0 ? formatDuration(record.duration_ms) : '-'}
              </td>
              <td className="py-3 px-4 text-right text-xs text-text-tertiary whitespace-nowrap">
                {formatTimeAgo(record.created_at)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function ProviderStatsCard({ stats, loading }: { stats: ProviderStats[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (stats.length === 0) {
    return (
      <div className="text-center py-16 text-text-tertiary">
        <p className="text-sm">暂无统计数据</p>
      </div>
    )
  }

  const maxTokens = Math.max(...stats.map(s => s.total_tokens), 1)

  return (
    <div className="space-y-3">
      {stats.map((s, i) => {
        const barPct = (s.total_tokens / maxTokens) * 100
        return (
          <div key={`${s.provider}-${s.model}-${i}`} className="rounded-lg border border-border/50 bg-white p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-tertiary uppercase bg-surface-secondary px-2 py-0.5 rounded">
                  {s.provider}
                </span>
                <span className="text-sm font-medium text-gray-700">{s.model}</span>
              </div>
              <span className="text-xs text-text-tertiary">{s.request_count} 次请求</span>
            </div>
            <div className="relative h-2 rounded-full bg-gray-100 overflow-hidden mb-2">
              <div
                className="absolute inset-y-0 left-0 bg-gradient-to-r from-primary/70 to-primary rounded-full transition-all duration-500"
                style={{ width: `${Math.max(barPct, 1)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-text-tertiary">
              <div className="flex items-center gap-4">
                <span>入 {formatTokens(s.total_input_tokens)}</span>
                <span>出 {formatTokens(s.total_output_tokens)}</span>
              </div>
              <span className="font-semibold text-gray-700">{formatTokens(s.total_tokens)}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

function FeatureStatsCard({ stats, loading }: { stats: FeatureStats[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (stats.length === 0) {
    return (
      <div className="text-center py-16 text-text-tertiary">
        <p className="text-sm">暂无统计数据</p>
      </div>
    )
  }

  const featureColors: Record<string, string> = {
    chat: 'bg-blue-500',
    generateCards: 'bg-amber-500',
    generateSummary: 'bg-green-500',
    explain: 'bg-purple-500',
  }

  const maxTokens = Math.max(...stats.map(s => s.total_tokens), 1)

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {stats.map((s) => {
        const barPct = (s.total_tokens / maxTokens) * 100
        const barColor = featureColors[s.feature] || 'bg-primary'
        return (
          <div key={s.feature} className="rounded-lg border border-border/50 bg-white p-4">
            <div className="flex items-center justify-between mb-3">
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
                s.feature === 'chat' ? 'bg-blue-100 text-blue-700'
                  : s.feature === 'generateCards' ? 'bg-amber-100 text-amber-700'
                  : s.feature === 'generateSummary' ? 'bg-green-100 text-green-700'
                  : 'bg-purple-100 text-purple-700'
              }`}>
                {FEATURE_LABELS[s.feature] || s.feature}
              </span>
              <span className="text-xs text-text-tertiary">{s.request_count} 次</span>
            </div>
            <div className="relative h-2 rounded-full bg-gray-100 overflow-hidden mb-2">
              <div
                className={`absolute inset-y-0 left-0 ${barColor} rounded-full transition-all duration-500`}
                style={{ width: `${Math.max(barPct, 1)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-text-tertiary">
              <div className="flex items-center gap-3">
                <span>入 {formatTokens(s.total_input_tokens)}</span>
                <span>出 {formatTokens(s.total_output_tokens)}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-text-tertiary/60">
                  <svg className="w-3 h-3 inline mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {s.avg_duration_ms > 0 ? formatDuration(Math.round(s.avg_duration_ms)) : '-'}
                </span>
                <span className="font-semibold text-gray-700">{formatTokens(s.total_tokens)}</span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

export default function TokenUsagePage() {
  const [summary, setSummary] = useState<TokenSummary | null>(null)
  const [records, setRecords] = useState<TokenRecord[]>([])
  const [providerStats, setProviderStats] = useState<ProviderStats[]>([])
  const [featureStats, setFeatureStats] = useState<FeatureStats[]>([])
  const [dailyStats, setDailyStats] = useState<DailyTokenStats[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabKey>('logs')
  const [timeRange, setTimeRange] = useState<TimeRange>('7d')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)

  const daysMap: Record<TimeRange, number> = { today: 1, '7d': 7, '14d': 14, '30d': 30 }

  const loadAll = useCallback(async () => {
    if (!window.electronAPI?.tokenUsage) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const [s, r, p, f, d] = await Promise.all([
        window.electronAPI.tokenUsage.getTotalStats(),
        window.electronAPI.tokenUsage.getRecent(100),
        window.electronAPI.tokenUsage.getStatsByProvider(),
        window.electronAPI.tokenUsage.getStatsByFeature(),
        window.electronAPI.tokenUsage.getDailyStats(daysMap[timeRange]),
      ])
      setSummary(s)
      setRecords(r)
      setProviderStats(p)
      setFeatureStats(f)
      setDailyStats(d)
    } catch (error) {
      console.error('加载Token数据失败:', error)
    } finally {
      setLoading(false)
    }
  }, [timeRange])

  useEffect(() => { loadAll() }, [loadAll])

  const chartDailyStats = useMemo(() => {
    const days = daysMap[timeRange]
    const dates: DailyTokenStats[] = []
    const now = new Date()
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      const existing = dailyStats.find(s => s.date === dateStr)
      dates.push(existing || {
        date: dateStr,
        request_count: 0,
        total_input_tokens: 0,
        total_output_tokens: 0,
        total_tokens: 0,
      })
    }
    return dates
  }, [dailyStats, timeRange])

  const handleClearAll = async () => {
    setClearing(true)
    try {
      await window.electronAPI.tokenUsage.clearAll()
      setShowClearConfirm(false)
      await loadAll()
    } catch (error) {
      console.error('清空Token记录失败:', error)
    } finally {
      setClearing(false)
    }
  }

  const hasData = (summary?.totalRequests ?? 0) > 0

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Token 用量</h1>
          <p className="text-text-secondary mt-1">AI 功能调用消耗统计与趋势分析</p>
        </div>

        <div className="flex items-center gap-3">
          {hasData && (
            <button
              onClick={() => setShowClearConfirm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 border border-red-200 hover:border-red-300 transition-all"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              清空记录
            </button>
          )}

          <div className="flex items-center gap-1 bg-surface-secondary rounded-lg p-1">
            {(Object.keys(daysMap) as TimeRange[]).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-3 py-1.5 rounded-md text-sm font-medium transition-all ${
                  timeRange === range
                    ? 'bg-white text-primary shadow-sm border border-border/50'
                    : 'text-text-tertiary hover:text-text-secondary'
                }`}
              >
                {range === 'today' ? '今日' : range}
              </button>
            ))}
          </div>
        </div>
      </div>

      {showClearConfirm && (
        <div className="rounded-xl border border-red-200 bg-red-50/80 p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-red-100 flex items-center justify-center">
              <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-medium text-red-900">确认清空所有 Token 记录？</p>
              <p className="text-xs text-red-600 mt-0.5">此操作不可恢复，将删除所有历史调用记录和统计数据。</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowClearConfirm(false)}
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-white/80 border border-transparent hover:border-gray-200 transition-all"
            >
              取消
            </button>
            <button
              onClick={handleClearAll}
              disabled={clearing}
              className="px-3 py-1.5 rounded-lg text-sm font-medium text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
            >
              {clearing ? '清空中...' : '确认清空'}
            </button>
          </div>
        </div>
      )}

      <UsageHero summary={summary} loading={loading} />

      <DailyTrendChart dailyStats={chartDailyStats} loading={loading} />

      <div className="space-y-4">
        <div className="flex items-center gap-1 bg-surface-secondary rounded-lg p-1 w-fit">
          {([
            { key: 'logs' as TabKey, label: '调用记录', icon: '📋' },
            { key: 'providers' as TabKey, label: '模型统计', icon: '🤖' },
            { key: 'features' as TabKey, label: '功能统计', icon: '📊' },
          ]).map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-all ${
                activeTab === tab.key
                  ? 'bg-white text-primary shadow-sm border border-border/50'
                  : 'text-text-tertiary hover:text-text-secondary'
              }`}
            >
              <span className="text-xs">{tab.icon}</span>
              {tab.label}
            </button>
          ))}
        </div>

        <div>
          {activeTab === 'logs' && <RequestLogTable records={records} loading={loading} />}
          {activeTab === 'providers' && <ProviderStatsCard stats={providerStats} loading={loading} />}
          {activeTab === 'features' && <FeatureStatsCard stats={featureStats} loading={loading} />}
        </div>
      </div>

      <div className="text-center text-xs text-text-tertiary pt-4 pb-2">
        数据实时刷新 · 每 30 秒自动更新
      </div>
    </div>
  )
}