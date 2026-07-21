/**
 * TokenUsage — Token 用量页（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/token-usage.html
 *
 * 结构：
 *   - hero: 标题 + 副标题（时间范围）+ actions（时间 chips + 导出 + 清空）
 *   - 清空确认 banner（showClearConfirm 时显示）
 *   - 4 KPI 卡（用量 / 预估费用 / 会话数 / 平均消耗）
 *   - 双 panel: 模型分布 donut + 用量趋势柱状图
 *   - Layer 2.5: 用量趋势折线图（input/output 双线，复用 chartDailyStats 日历填充）
 *   - 用量明细 card：tab 切换（调用记录 / 模型统计 / 功能统计）
 *
 * 业务逻辑全部保留：
 *   - tokenUsage.* 全部 IPC 调用（getTotalStats / getRecent / getStatsByProvider /
 *     getStatsByFeature / getDailyStats / clearAll）
 *   - 时间范围筛选（today / 7d / 14d / 30d）
 *   - 数据聚合（summary / records / providerStats / featureStats / dailyStats）
 *   - 模型分组统计 + donut conic-gradient 渲染
 *   - 成本计算（cost_usd × 汇率）
 *   - 用量趋势柱状图（日常 / 高峰 双色）
 *   - 用量趋势折线图（input / output 双线，recharts + CHART_COLORS 常量）
 *   - tab 切换（logs / providers / features）
 *   - 清空记录确认 + 调用
 *   - toast 反馈
 */

import { useState, useEffect, useCallback, useMemo, CSSProperties } from 'react'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
import PageHero from '@/components/layout/PageHero'
import Card, { CardHead } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { Loading, Metric, Trend, EmptyState } from '@/components/ui/Feedback'
import { toast } from '../stores/toastStore'
import { formatTimeAgo } from '../utils/db-mapper'
import {
  TokenSummary,
  TokenRecord,
  ProviderStats,
  FeatureStats,
  DailyTokenStats,
} from '../../../types/renderer'

// ===== 类型 =====
type TimeRange = 'today' | '7d' | '14d' | '30d'
type TabKey = 'logs' | 'providers' | 'features'
type FilterDateRange = '7d' | '30d' | '90d' | 'all'

// ===== 常量 =====
const FEATURE_LABELS: Record<string, string> = {
  generateCards: '生成卡片',
  generateSummary: '生成摘要',
  chat: 'AI对话',
  explain: '解释内容',
}

const TIME_RANGES: { key: TimeRange; label: string }[] = [
  { key: 'today', label: '今日' },
  { key: '7d', label: '本周' },
  { key: '14d', label: '14天' },
  { key: '30d', label: '本月' },
]

const TABS: { key: TabKey; label: string }[] = [
  { key: 'logs', label: '调用记录' },
  { key: 'providers', label: '模型统计' },
  { key: 'features', label: '功能统计' },
]

const DAYS_MAP: Record<TimeRange, number> = { today: 1, '7d': 7, '14d': 14, '30d': 30 }

/** 筛选日期范围 → 天数（'all' 用 3650 天近似 10 年，足够覆盖全量数据） */
const FILTER_DAYS_MAP: Record<FilterDateRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: 3650,
}

// USD → CNY 汇率（用于预估费用展示，与设计稿 ¥18.60 / 1.24M tokens 量级一致）
const USD_TO_CNY = 7

/** Layer 2.5 折线图配色（input 蓝 / output 绿，与设计稿双色对比一致） */
const CHART_COLORS = {
  input: '#3b82f6', // 蓝色 - 输入 tokens
  output: '#10b981', // 绿色 - 输出 tokens
} as const

/** 模型 → 颜色 token（设计稿：GPT-4o chart-1, Claude chart-5, mini chart-3, 其他 chart-2） */
function getModelColor(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('gpt-4o') && !m.includes('mini')) return 'var(--chart-1)'
  if (m.includes('claude')) return 'var(--chart-5)'
  if (m.includes('mini')) return 'var(--chart-3)'
  return 'var(--chart-2)'
}

/** 模型 → 显示名（设计稿：GPT-4o / Claude 3.5 / GPT-4o-mini） */
function getModelDisplayName(model: string): string {
  const m = model.toLowerCase()
  if (m.includes('claude-3.5') || m.includes('claude3.5') || m.includes('claude-3-5')) return 'Claude 3.5'
  if (m.includes('mini')) return 'GPT-4o-mini'
  if (m.includes('gpt-4o')) return 'GPT-4o'
  if (m.includes('claude')) return 'Claude'
  return model
}

// ===== 格式化工具 =====
function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(2) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

function formatTokensFull(n: number): string {
  return n.toLocaleString()
}

function formatCost(usd: number): string {
  return '¥' + (usd * USD_TO_CNY).toFixed(2)
}

function formatDuration(ms: number): string {
  if (ms >= 60000) return (ms / 60000).toFixed(1) + 'min'
  if (ms >= 1000) return (ms / 1000).toFixed(1) + 's'
  return ms + 'ms'
}

function formatDateFull(dateStr: string): string {
  try {
    const d = new Date(dateStr)
    if (isNaN(d.getTime())) return '-'
    return d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  } catch {
    return '-'
  }
}

/** CSV 字段转义：包含 `,` `"` `\n` 时用 `"` 包裹，内部 `"` 转义为 `""`。
 *  同时防御 CSV 公式注入：以 `=` `+` `-` `@` 开头的值前置单引号（OWASP CSV Injection 防护）。 */
function escapeCsv(value: unknown): string {
  let s = String(value ?? '')
  // 防御 CSV 公式注入：以 = + - @ 开头的值前置单引号（OWASP CSV Injection 防护）
  if (/^[=+\-@]/.test(s)) {
    s = "'" + s
  }
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

/** 筛选日期范围 → { startDate, endDate } ISO 日期字符串（YYYY-MM-DD） */
function getFilterRangeDates(range: FilterDateRange): { startDate: string; endDate: string } {
  const end = new Date()
  end.setHours(23, 59, 59, 0)
  const endDate = end.toISOString().split('T')[0]
  const days = FILTER_DAYS_MAP[range]
  const start = new Date(end)
  start.setDate(start.getDate() - days + 1)
  start.setHours(0, 0, 0, 0)
  return { startDate: start.toISOString().split('T')[0], endDate }
}

/** 时间戳格式化：YYYYMMDD-HHmm */
function formatExportTimestamp(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
}

/** 时间范围副标题（设计稿："本月累计 · 7 月 1-20 日"） */
function getRangeLabel(range: TimeRange): string {
  const days = DAYS_MAP[range]
  const end = new Date()
  if (range === 'today') {
    return `今日 · ${end.toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}`
  }
  const start = new Date(end)
  start.setDate(start.getDate() - days + 1)
  const fmt = (d: Date) => d.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit' })
  const rangeLabel = range === '7d' ? '本周' : range === '14d' ? '近 14 天' : '本月'
  return `${rangeLabel}累计 · ${fmt(start)} - ${fmt(end)}`
}

/** KPI 第一个卡的 eyebrow 文案 */
function getUsageEyebrow(range: TimeRange): string {
  if (range === 'today') return '今日用量'
  if (range === '7d') return '本周用量'
  if (range === '14d') return '近 14 天用量'
  return '本月用量'
}

// ===== 主组件 =====
export default function TokenUsagePage() {
  const [summary, setSummary] = useState<TokenSummary | null>(null)
  const [records, setRecords] = useState<TokenRecord[]>([])
  const [providerStats, setProviderStats] = useState<ProviderStats[]>([])
  const [featureStats, setFeatureStats] = useState<FeatureStats[]>([])
  const [dailyStats, setDailyStats] = useState<DailyTokenStats[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabKey>('logs')
  const [timeRange, setTimeRange] = useState<TimeRange>('30d')
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [clearing, setClearing] = useState(false)

  // 筛选相关状态（用于"调用记录"tab 的二次筛选）
  const [filterProvider, setFilterProvider] = useState<string>('')
  const [filterFeature, setFilterFeature] = useState<string>('')
  const [filterDateRange, setFilterDateRange] = useState<FilterDateRange>('30d')
  const [showFilter, setShowFilter] = useState(false)
  const [exporting, setExporting] = useState(false)

  const loadAll = useCallback(async () => {
    if (!window.electronAPI?.tokenUsage) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const { startDate, endDate } = getFilterRangeDates(filterDateRange)
      const [s, r, p, f, d] = await Promise.all([
        window.electronAPI.tokenUsage.getTotalStats(),
        window.electronAPI.tokenUsage.getByDateRange(startDate, endDate),
        window.electronAPI.tokenUsage.getStatsByProvider(),
        window.electronAPI.tokenUsage.getStatsByFeature(),
        window.electronAPI.tokenUsage.getDailyStats(DAYS_MAP[timeRange]),
      ])
      setSummary(s)
      setRecords(r)
      setProviderStats(p)
      setFeatureStats(f)
      setDailyStats(d)
    } catch (error) {
      console.error('加载Token数据失败:', error)
      toast.error('加载 Token 数据失败')
    } finally {
      setLoading(false)
    }
  }, [timeRange, filterDateRange])

  useEffect(() => {
    loadAll()
  }, [loadAll])

  // 按时间范围填充日历（保留原 chartDailyStats 逻辑）
  const chartDailyStats = useMemo(() => {
    const days = DAYS_MAP[timeRange]
    const dates: DailyTokenStats[] = []
    const now = new Date()
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(now)
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().split('T')[0]
      const existing = dailyStats.find((s) => s.date === dateStr)
      dates.push(
        existing || {
          date: dateStr,
          request_count: 0,
          total_input_tokens: 0,
          total_output_tokens: 0,
          total_tokens: 0,
        },
      )
    }
    return dates
  }, [dailyStats, timeRange])

  // KPI 聚合：基于 chartDailyStats（token/request）+ records 过滤后累加 cost_usd
  const kpi = useMemo(() => {
    const totalTokens = chartDailyStats.reduce((s, d) => s + d.total_tokens, 0)
    const totalRequests = chartDailyStats.reduce((s, d) => s + d.request_count, 0)
    const days = DAYS_MAP[timeRange]
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - days + 1)
    cutoff.setHours(0, 0, 0, 0)
    const filteredRecords = records.filter((r) => new Date(r.created_at) >= cutoff)
    const totalCostUsd = filteredRecords.reduce((s, r) => s + (r.cost_usd || 0), 0)
    const avgTokens = totalRequests > 0 ? Math.round(totalTokens / totalRequests) : 0
    return { totalTokens, totalRequests, totalCostUsd, avgTokens }
  }, [chartDailyStats, records, timeRange])

  // 模型分布：聚合 providerStats，按显示名分组，取前 3 + 其他
  const modelDistribution = useMemo(() => {
    if (providerStats.length === 0) return [] as { name: string; tokens: number; color: string; pct: number }[]
    const grouped = new Map<string, { tokens: number; color: string }>()
    for (const s of providerStats) {
      const displayName = getModelDisplayName(s.model)
      const existing = grouped.get(displayName)
      if (existing) {
        existing.tokens += s.total_tokens
      } else {
        grouped.set(displayName, { tokens: s.total_tokens, color: getModelColor(s.model) })
      }
    }
    const total = Array.from(grouped.values()).reduce((s, x) => s + x.tokens, 0)
    const sorted = Array.from(grouped.entries())
      .map(([name, info]) => ({
        name,
        tokens: info.tokens,
        color: info.color,
        pct: total > 0 ? (info.tokens / total) * 100 : 0,
      }))
      .sort((a, b) => b.tokens - a.tokens)
    if (sorted.length > 4) {
      const top3 = sorted.slice(0, 3)
      const others = sorted.slice(3)
      const othersTokens = others.reduce((s, x) => s + x.tokens, 0)
      const othersPct = total > 0 ? (othersTokens / total) * 100 : 0
      return [...top3, { name: '其他', tokens: othersTokens, color: 'var(--chart-2)', pct: othersPct }]
    }
    return sorted
  }, [providerStats])

  // donut 的 conic-gradient 字符串（设计稿方案）
  const donutGradient = useMemo(() => {
    if (modelDistribution.length === 0) return 'var(--muted)'
    let cumPct = 0
    const stops: string[] = []
    for (const m of modelDistribution) {
      const start = cumPct
      const end = cumPct + m.pct
      stops.push(`${m.color} ${start.toFixed(2)}% ${end.toFixed(2)}%`)
      cumPct = end
    }
    return `conic-gradient(${stops.join(', ')})`
  }, [modelDistribution])

  // 趋势柱状图数据
  const trendBars = useMemo(() => {
    const max = Math.max(...chartDailyStats.map((d) => d.total_tokens), 1)
    const avg = chartDailyStats.reduce((s, d) => s + d.total_tokens, 0) / Math.max(chartDailyStats.length, 1)
    return chartDailyStats.map((d) => ({
      date: d.date,
      tokens: d.total_tokens,
      heightPct: max > 0 ? (d.total_tokens / max) * 100 : 0,
      isPeak: d.total_tokens > avg * 1.5 && d.total_tokens > 0,
    }))
  }, [chartDailyStats])

  // T9: 折线图数据（input/output 双线），复用 chartDailyStats 的 0 填充日历
  const chartLineData = useMemo(
    () =>
      chartDailyStats.map((d) => ({
        date: d.date,
        input: d.total_input_tokens,
        output: d.total_output_tokens,
      })),
    [chartDailyStats],
  )

  // 可选 provider 列表（从 providerStats 提取去重）
  const providerOptions = useMemo(() => {
    const set = new Set<string>()
    providerStats.forEach((p) => set.add(p.provider))
    return Array.from(set)
  }, [providerStats])

  // 可选 feature 列表（从 featureStats 提取去重）
  const featureOptions = useMemo(() => {
    const set = new Set<string>()
    featureStats.forEach((f) => set.add(f.feature))
    return Array.from(set)
  }, [featureStats])

  // 客户端二次筛选：按 provider + feature 过滤 records
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (filterProvider && r.provider !== filterProvider) return false
      if (filterFeature && r.feature !== filterFeature) return false
      return true
    })
  }, [records, filterProvider, filterFeature])

  const handleClearAll = async () => {
    setClearing(true)
    try {
      await window.electronAPI.tokenUsage.clearAll()
      setShowClearConfirm(false)
      toast.success('Token 记录已清空')
      await loadAll()
    } catch (error) {
      console.error('清空Token记录失败:', error)
      toast.error('清空失败')
    } finally {
      setClearing(false)
    }
  }

  const handleExport = async () => {
    if (filteredRecords.length === 0) {
      toast.info('暂无可导出的数据')
      return
    }
    setExporting(true)
    try {
      const data = filteredRecords
      const headers = [
        'provider',
        'model',
        'feature',
        'input_tokens',
        'output_tokens',
        'total_tokens',
        'cost_usd',
        'duration_ms',
        'created_at',
      ]
      const lines = [headers.join(',')]
      for (const r of data) {
        const row = [
          r.provider,
          r.model,
          r.feature,
          r.input_tokens,
          r.output_tokens,
          r.total_tokens,
          r.cost_usd || 0,
          r.duration_ms || 0,
          r.created_at,
        ].map(escapeCsv)
        lines.push(row.join(','))
      }
      // 加 UTF-8 BOM 防止 Excel 中文乱码
      const csv = '\ufeff' + lines.join('\n')
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `token-usage-${formatExportTimestamp()}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(`已导出 ${data.length} 条记录到 CSV`)
    } catch (error) {
      console.error('导出CSV失败:', error)
      toast.error('导出 CSV 失败')
    } finally {
      setExporting(false)
    }
  }

  const handleFilter = () => {
    setShowFilter((v) => !v)
  }

  const handleResetFilter = () => {
    setFilterProvider('')
    setFilterFeature('')
    setFilterDateRange('30d')
  }

  const hasData = (summary?.totalRequests ?? 0) > 0

  if (loading && !summary) {
    return <Loading hint="正在加载 Token 用量数据..." />
  }

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <PageHero
        title="Token 用量"
        subtitle={getRangeLabel(timeRange)}
        actions={
          <>
            <Chips items={TIME_RANGES} value={timeRange} onChange={setTimeRange} />
            <Button
              variant="secondary"
              onClick={handleExport}
              disabled={exporting}
              data-dom-id="cta-export"
            >
              <Icon name="external-link" size={16} /> {exporting ? '导出中...' : '导出明细'}
            </Button>
            {hasData && (
              <Button
                variant="ghost"
                onClick={() => setShowClearConfirm(true)}
                data-dom-id="cta-clear"
              >
                <Icon name="trash" size={16} /> 清空记录
              </Button>
            )}
          </>
        }
      >
        {/* ===== 清空确认 banner（保留原 showClearConfirm 业务逻辑） ===== */}
        {showClearConfirm && (
          <div
            style={{
              background: 'color-mix(in srgb, var(--state-error) 8%, transparent)',
              border: '1px solid color-mix(in srgb, var(--state-error) 30%, transparent)',
              borderRadius: 'calc(var(--radius) + 6px)',
              padding: 'calc(var(--spacing) * 4) calc(var(--spacing) * 5)',
              display: 'flex',
              alignItems: 'center',
              gap: 'calc(var(--spacing) * 3)',
              flexWrap: 'wrap',
            }}
          >
            <div
              style={{
                width: 36,
                height: 36,
                flexShrink: 0,
                borderRadius: '50%',
                background: 'color-mix(in srgb, var(--state-error) 14%, transparent)',
                color: 'var(--state-error)',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <Icon name="alert" size={18} />
            </div>
            <div style={{ flex: 1, minWidth: '200px' }}>
              <p
                style={{
                  margin: 0,
                  fontSize: '0.92rem',
                  fontWeight: 600,
                  color: 'var(--foreground)',
                }}
              >
                确认清空所有 Token 记录？
              </p>
              <p
                style={{
                  margin: '0.25rem 0 0',
                  fontSize: '0.78rem',
                  color: 'var(--muted-foreground)',
                }}
              >
                此操作不可恢复，将删除所有历史调用记录和统计数据。
              </p>
            </div>
            <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 2)' }}>
              <Button variant="ghost" onClick={() => setShowClearConfirm(false)}>
                取消
              </Button>
              <Button variant="danger" onClick={handleClearAll} disabled={clearing}>
                {clearing ? '清空中...' : '确认清空'}
              </Button>
            </div>
          </div>
        )}

        {/* ===== Layer 1: 4-up KPI cards（设计稿 1:1） ===== */}
        <div
          className="grid stats"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 'calc(var(--spacing) * 4)',
          }}
        >
          <Card interactive>
            <div style={eyebrowStyle}>{getUsageEyebrow(timeRange)}</div>
            <Metric value={formatTokens(kpi.totalTokens)} />
            <Trend kind="default">{formatTokensFull(kpi.totalTokens)} tokens</Trend>
          </Card>

          <Card interactive>
            <div style={eyebrowStyle}>预估费用</div>
            <Metric value={formatCost(kpi.totalCostUsd)} />
            <Trend kind="default">预算 ¥50</Trend>
          </Card>

          <Card interactive>
            <div style={eyebrowStyle}>会话数</div>
            <Metric value={kpi.totalRequests} />
            <Trend kind={kpi.totalRequests > 0 ? 'up' : 'default'}>
              {kpi.totalRequests > 0
                ? `↑ 日均 ${(kpi.totalRequests / DAYS_MAP[timeRange]).toFixed(1)} 次`
                : '暂无调用'}
            </Trend>
          </Card>

          <Card interactive>
            <div style={eyebrowStyle}>平均消耗</div>
            <Metric value={formatTokens(kpi.avgTokens)} />
            <Trend kind="default">tokens/会话</Trend>
          </Card>
        </div>

        {/* ===== Layer 2: donut + 趋势柱状图（设计稿 1:1） ===== */}
        <div
          className="grid panels"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 'calc(var(--spacing) * 4)',
          }}
        >
          {/* 模型分布 donut */}
          <Card>
            <CardHead
              eyebrow="模型分布"
              title="按 token 占比"
              action={<Badge>{modelDistribution.length} 个模型</Badge>}
            />
            {modelDistribution.length === 0 ? (
              <EmptyState
                icon={<Icon name="token" size={24} />}
                title="暂无模型数据"
                description="使用 AI 功能后将自动统计模型分布"
              />
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '140px 1fr',
                  gap: 'calc(var(--spacing) * 4)',
                  alignItems: 'center',
                  marginTop: 'calc(var(--spacing) * 4)',
                }}
              >
                <div
                  style={{
                    position: 'relative',
                    width: 140,
                    height: 140,
                    borderRadius: '50%',
                    background: donutGradient,
                  }}
                >
                  <div
                    style={{
                      position: 'absolute',
                      inset: 24,
                      borderRadius: '50%',
                      background: 'var(--card)',
                    }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      inset: 0,
                      display: 'grid',
                      placeItems: 'center',
                      zIndex: 1,
                      textAlign: 'center',
                    }}
                  >
                    <div>
                      <div
                        style={{
                          fontSize: '1.35rem',
                          fontWeight: 700,
                          fontFamily: 'var(--font-mono)',
                          lineHeight: 1,
                          color: 'var(--foreground)',
                        }}
                      >
                        {formatTokens(kpi.totalTokens)}
                      </div>
                      <div
                        style={{
                          fontSize: '0.72rem',
                          color: 'var(--muted-foreground)',
                          fontWeight: 400,
                          marginTop: '0.15rem',
                        }}
                      >
                        tokens
                      </div>
                    </div>
                  </div>
                </div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'calc(var(--spacing) * 2)',
                  }}
                >
                  {modelDistribution.map((m) => (
                    <div
                      key={m.name}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'calc(var(--spacing) * 2)',
                      }}
                    >
                      <span
                        style={{
                          display: 'inline-block',
                          width: '0.72rem',
                          height: '0.72rem',
                          borderRadius: '50%',
                          background: m.color,
                          flexShrink: 0,
                        }}
                      />
                      <span
                        style={{
                          flex: 1,
                          minWidth: 0,
                          fontSize: '0.88rem',
                          color: 'var(--foreground)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {m.name}
                      </span>
                      <span
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: '0.88rem',
                          fontWeight: 600,
                          color: 'var(--foreground)',
                        }}
                      >
                        {m.pct.toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </Card>

          {/* 用量趋势柱状图 */}
          <Card>
            <CardHead
              eyebrow="用量趋势"
              title={`近 ${DAYS_MAP[timeRange]} 日`}
              action={<Badge variant="ok">日视图</Badge>}
            />
            {kpi.totalTokens === 0 ? (
              <EmptyState
                icon={<Icon name="stats" size={24} />}
                title="暂无趋势数据"
                description="使用 AI 功能后将自动记录每日消耗"
              />
            ) : (
              <>
                <div
                  role="img"
                  aria-label={`近 ${DAYS_MAP[timeRange]} 日每日 token 消耗柱状图`}
                  style={{
                    height: 220,
                    display: 'flex',
                    alignItems: 'flex-end',
                    gap: 'calc(var(--spacing) * 1.5)',
                    marginTop: 'calc(var(--spacing) * 4)',
                  }}
                >
                  {trendBars.map((b, i) => (
                    <div
                      key={i}
                      style={{
                        flex: 1,
                        display: 'flex',
                        alignItems: 'flex-end',
                        justifyContent: 'center',
                        minWidth: 0,
                      }}
                      title={`${formatDateFull(b.date)}: ${formatTokensFull(b.tokens)} tokens`}
                    >
                      <div
                        style={{
                          width: '100%',
                          borderRadius: 999,
                          background: b.isPeak ? 'var(--chart-2)' : 'var(--chart-1)',
                          minHeight: b.tokens > 0 ? 6 : 0,
                          height: `${Math.max(b.heightPct, b.tokens > 0 ? 3 : 0)}%`,
                          transition: 'height 0.3s ease, background 0.2s ease',
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 'calc(var(--spacing) * 3)',
                    flexWrap: 'wrap',
                    marginTop: 'calc(var(--spacing) * 4)',
                  }}
                >
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      color: 'var(--muted-foreground)',
                      fontSize: '0.82rem',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        width: '0.72rem',
                        height: '0.72rem',
                        borderRadius: '50%',
                        background: 'var(--chart-1)',
                      }}
                    />
                    日常
                  </span>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.4rem',
                      color: 'var(--muted-foreground)',
                      fontSize: '0.82rem',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span
                      style={{
                        display: 'inline-block',
                        width: '0.72rem',
                        height: '0.72rem',
                        borderRadius: '50%',
                        background: 'var(--chart-2)',
                      }}
                    />
                    高峰
                  </span>
                </div>
              </>
            )}
          </Card>
        </div>

        {/* ===== Layer 2.5: 用量趋势折线图（T9 新增，input/output 双线） ===== */}
        <Card>
          <CardHead
            eyebrow="用量趋势折线"
            title={`Input / Output · 近 ${DAYS_MAP[timeRange]} 日`}
            action={<Badge variant="ok">折线图</Badge>}
          />
          {kpi.totalTokens === 0 ? (
            <EmptyState
              icon={<Icon name="stats" size={24} />}
              title="暂无趋势数据"
              description="使用 AI 功能后将自动记录每日消耗"
            />
          ) : (
            <div
              role="img"
              aria-label={`Token 用量趋势折线图,${chartLineData.length} 天数据,输入 ${chartLineData
                .reduce((s, d) => s + d.input, 0)
                .toLocaleString()} tokens,输出 ${chartLineData
                .reduce((s, d) => s + d.output, 0)
                .toLocaleString()} tokens`}
              style={{
                width: '100%',
                height: 320,
                marginTop: 'calc(var(--spacing) * 4)',
              }}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartLineData}
                  margin={{ top: 16, right: 24, left: 8, bottom: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis
                    dataKey="date"
                    tickFormatter={formatDateFull}
                    stroke="var(--muted-foreground)"
                    fontSize={12}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                  />
                  <YAxis
                    tickFormatter={formatTokens}
                    stroke="var(--muted-foreground)"
                    fontSize={12}
                    tickLine={false}
                    axisLine={{ stroke: 'var(--border)' }}
                    width={56}
                  />
                  <Tooltip
                    formatter={(value, name) => {
                      const v = Number(value) || 0
                      return [
                        formatTokensFull(v),
                        name === 'input' ? '输入 tokens' : '输出 tokens',
                      ]
                    }}
                    labelFormatter={(label) =>
                      `日期: ${formatDateFull(String(label))}`
                    }
                    contentStyle={{
                      background: 'var(--card)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      color: 'var(--foreground)',
                      fontSize: '0.85rem',
                      boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                    }}
                    labelStyle={{ color: 'var(--muted-foreground)', marginBottom: 4 }}
                  />
                  <Legend
                    formatter={(value) =>
                      value === 'input' ? '输入 tokens' : '输出 tokens'
                    }
                    iconType="line"
                    wrapperStyle={{ fontSize: '0.82rem', paddingTop: 8 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="input"
                    stroke={CHART_COLORS.input}
                    strokeWidth={2}
                    name="输入"
                    dot={{ r: 3, fill: CHART_COLORS.input }}
                    activeDot={{ r: 5 }}
                    isAnimationActive={false}
                  />
                  <Line
                    type="monotone"
                    dataKey="output"
                    stroke={CHART_COLORS.output}
                    strokeWidth={2}
                    name="输出"
                    dot={{ r: 3, fill: CHART_COLORS.output }}
                    activeDot={{ r: 5 }}
                    isAnimationActive={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        {/* ===== Layer 3: 用量明细 card + tab 切换（保留原 logs/providers/features 业务） ===== */}
        <Card>
          <CardHead
            eyebrow="用量明细"
            title={
              activeTab === 'logs'
                ? '最近会话'
                : activeTab === 'providers'
                  ? '模型统计'
                  : '功能统计'
            }
            action={
              <Button variant="ghost" onClick={handleFilter} data-dom-id="cta-filter">
                <Icon name="filter" size={16} /> {showFilter ? '收起筛选' : '筛选'}
              </Button>
            }
          />
          <Chips items={TABS} value={activeTab} onChange={setActiveTab} />

          {showFilter && (
            <div
              style={{
                display: 'flex',
                gap: 'calc(var(--spacing) * 3)',
                flexWrap: 'wrap',
                alignItems: 'center',
                padding: 'calc(var(--spacing) * 3)',
                background: 'var(--muted)',
                borderRadius: 'var(--radius)',
                marginTop: 'calc(var(--spacing) * 4)',
              }}
            >
              <div style={filterFieldStyle}>
                <label style={filterLabelStyle} htmlFor="filter-date-range">
                  日期范围
                </label>
                <select
                  id="filter-date-range"
                  value={filterDateRange}
                  onChange={(e) => setFilterDateRange(e.target.value as FilterDateRange)}
                  style={selectStyle}
                >
                  <option value="7d">近 7 天</option>
                  <option value="30d">近 30 天</option>
                  <option value="90d">近 90 天</option>
                  <option value="all">全部</option>
                </select>
              </div>
              <div style={filterFieldStyle}>
                <label style={filterLabelStyle} htmlFor="filter-provider">
                  模型供应商
                </label>
                <select
                  id="filter-provider"
                  value={filterProvider}
                  onChange={(e) => setFilterProvider(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">全部</option>
                  {providerOptions.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div style={filterFieldStyle}>
                <label style={filterLabelStyle} htmlFor="filter-feature">
                  功能
                </label>
                <select
                  id="filter-feature"
                  value={filterFeature}
                  onChange={(e) => setFilterFeature(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">全部</option>
                  {featureOptions.map((f) => (
                    <option key={f} value={f}>
                      {FEATURE_LABELS[f] || f}
                    </option>
                  ))}
                </select>
              </div>
              <Button variant="ghost" onClick={handleResetFilter} data-dom-id="cta-filter-reset">
                重置
              </Button>
              {filterProvider === '' && filterFeature === '' && filterDateRange === '30d' ? null : (
                <span style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>
                  匹配 {filteredRecords.length} 条
                </span>
              )}
            </div>
          )}

          <div style={{ marginTop: 'calc(var(--spacing) * 4)' }}>
            {activeTab === 'logs' && (
              <RequestLogTable records={filteredRecords} loading={loading} />
            )}
            {activeTab === 'providers' && (
              <ProviderStatsList stats={providerStats} loading={loading} />
            )}
            {activeTab === 'features' && (
              <FeatureStatsList stats={featureStats} loading={loading} />
            )}
          </div>
        </Card>
      </PageHero>
    </>
  )
}

// ===== 子组件：调用记录表格（设计稿 6 列：会话/模型/输入/输出/费用/时间） =====
function RequestLogTable({ records, loading }: { records: TokenRecord[]; loading: boolean }) {
  if (loading && records.length === 0) {
    return (
      <div
        style={{
          padding: 'calc(var(--spacing) * 8)',
          textAlign: 'center',
        }}
      >
        <span style={spinnerStyle} />
      </div>
    )
  }
  if (records.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="token" size={24} />}
        title="暂无调用记录"
        description="使用 AI 功能后将自动记录 Token 消耗"
      />
    )
  }
  return (
    <>
      {/* 表头 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.5fr 1fr 0.8fr 0.8fr 0.8fr 0.7fr',
          gap: 'calc(var(--spacing) * 3)',
          padding: '0 calc(var(--spacing) * 4) calc(var(--spacing) * 2)',
          fontSize: '0.78rem',
          color: 'var(--muted-foreground)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        <span>会话</span>
        <span>模型</span>
        <span>输入 tokens</span>
        <span>输出 tokens</span>
        <span>费用</span>
        <span>时间</span>
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'calc(var(--spacing) * 2)',
        }}
      >
        {records.map((record) => {
          const modelColor = getModelColor(record.model)
          return (
            <div
              key={record.id}
              tabIndex={0}
              role="button"
              style={{
                display: 'grid',
                gridTemplateColumns: '1.5fr 1fr 0.8fr 0.8fr 0.8fr 0.7fr',
                gap: 'calc(var(--spacing) * 3)',
                alignItems: 'center',
                background: 'var(--background)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                padding: 'calc(var(--spacing) * 3.5) calc(var(--spacing) * 4)',
                cursor: 'pointer',
                transition: 'border-color 0.2s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = 'var(--ring)'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = 'var(--border)'
              }}
            >
              <span
                style={{
                  minWidth: 0,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  fontSize: '0.88rem',
                  color: 'var(--foreground)',
                }}
              >
                {FEATURE_LABELS[record.feature] || record.feature}
              </span>
              <span>
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: '0.2rem 0.6rem',
                    borderRadius: 999,
                    background: modelColor,
                    color: 'var(--primary-foreground)',
                    fontSize: '0.72rem',
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {getModelDisplayName(record.model)}
                </span>
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.85rem',
                  whiteSpace: 'nowrap',
                  color: 'var(--foreground)',
                }}
              >
                {formatTokensFull(record.input_tokens)}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.85rem',
                  whiteSpace: 'nowrap',
                  color: 'var(--foreground)',
                }}
              >
                {formatTokensFull(record.output_tokens)}
              </span>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.85rem',
                  whiteSpace: 'nowrap',
                  color: 'var(--foreground)',
                }}
              >
                {formatCost(record.cost_usd || 0)}
              </span>
              <span
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--muted-foreground)',
                  whiteSpace: 'nowrap',
                }}
              >
                {formatTimeAgo(record.created_at)}
              </span>
            </div>
          )
        })}
      </div>
    </>
  )
}

// ===== 子组件：模型统计列表（保留原 ProviderStatsCard 业务） =====
function ProviderStatsList({ stats, loading }: { stats: ProviderStats[]; loading: boolean }) {
  if (loading && stats.length === 0) {
    return (
      <div style={{ padding: 'calc(var(--spacing) * 8)', textAlign: 'center' }}>
        <span style={spinnerStyle} />
      </div>
    )
  }
  if (stats.length === 0) {
    return <EmptyState icon={<Icon name="token" size={24} />} title="暂无统计数据" />
  }
  const maxTokens = Math.max(...stats.map((s) => s.total_tokens), 1)
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'calc(var(--spacing) * 3)',
      }}
    >
      {stats.map((s, i) => {
        const barPct = (s.total_tokens / maxTokens) * 100
        const color = getModelColor(s.model)
        return (
          <div
            key={`${s.provider}-${s.model}-${i}`}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 'calc(var(--spacing) * 4)',
              background: 'var(--background)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 'calc(var(--spacing) * 2)',
                gap: 'calc(var(--spacing) * 2)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'calc(var(--spacing) * 2)',
                  minWidth: 0,
                }}
              >
                <span style={providerBadgeStyle}>{s.provider}</span>
                <span
                  style={{
                    fontSize: '0.92rem',
                    fontWeight: 500,
                    color: 'var(--foreground)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {getModelDisplayName(s.model)}
                </span>
              </div>
              <span style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>
                {s.request_count} 次请求
              </span>
            </div>
            <div
              style={{
                position: 'relative',
                height: 8,
                borderRadius: 999,
                background: 'var(--muted)',
                overflow: 'hidden',
                marginBottom: 'calc(var(--spacing) * 2)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  background: color,
                  borderRadius: 999,
                  transition: 'width 0.5s ease',
                  width: `${Math.max(barPct, 1)}%`,
                }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.78rem',
                color: 'var(--muted-foreground)',
              }}
            >
              <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 4)' }}>
                <span>入 {formatTokens(s.total_input_tokens)}</span>
                <span>出 {formatTokens(s.total_output_tokens)}</span>
              </div>
              <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>
                {formatTokens(s.total_tokens)}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ===== 子组件：功能统计列表（保留原 FeatureStatsCard 业务） =====
function FeatureStatsList({ stats, loading }: { stats: FeatureStats[]; loading: boolean }) {
  if (loading && stats.length === 0) {
    return (
      <div style={{ padding: 'calc(var(--spacing) * 8)', textAlign: 'center' }}>
        <span style={spinnerStyle} />
      </div>
    )
  }
  if (stats.length === 0) {
    return <EmptyState icon={<Icon name="token" size={24} />} title="暂无统计数据" />
  }
  const featureColors: Record<string, string> = {
    chat: 'var(--chart-1)',
    generateCards: 'var(--chart-3)',
    generateSummary: 'var(--chart-5)',
    explain: 'var(--chart-4)',
  }
  const maxTokens = Math.max(...stats.map((s) => s.total_tokens), 1)
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 'calc(var(--spacing) * 3)',
      }}
    >
      {stats.map((s) => {
        const barPct = (s.total_tokens / maxTokens) * 100
        const color = featureColors[s.feature] || 'var(--primary)'
        return (
          <div
            key={s.feature}
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              padding: 'calc(var(--spacing) * 4)',
              background: 'var(--background)',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: 'calc(var(--spacing) * 3)',
                gap: 'calc(var(--spacing) * 2)',
              }}
            >
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0.2rem 0.6rem',
                  borderRadius: 999,
                  background: `color-mix(in srgb, ${color} 14%, transparent)`,
                  color: color,
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                {FEATURE_LABELS[s.feature] || s.feature}
              </span>
              <span style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>
                {s.request_count} 次
              </span>
            </div>
            <div
              style={{
                position: 'relative',
                height: 8,
                borderRadius: 999,
                background: 'var(--muted)',
                overflow: 'hidden',
                marginBottom: 'calc(var(--spacing) * 2)',
              }}
            >
              <div
                style={{
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  left: 0,
                  background: color,
                  borderRadius: 999,
                  transition: 'width 0.5s ease',
                  width: `${Math.max(barPct, 1)}%`,
                }}
              />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                fontSize: '0.78rem',
                color: 'var(--muted-foreground)',
                gap: 'calc(var(--spacing) * 2)',
              }}
            >
              <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 3)' }}>
                <span>入 {formatTokens(s.total_input_tokens)}</span>
                <span>出 {formatTokens(s.total_output_tokens)}</span>
              </div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'calc(var(--spacing) * 2)',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.25rem',
                  }}
                >
                  <Icon name="refresh" size={12} />
                  {s.avg_duration_ms > 0 ? formatDuration(Math.round(s.avg_duration_ms)) : '-'}
                </span>
                <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>
                  {formatTokens(s.total_tokens)}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ===== 子组件：Chip 组（与 KnowledgeCards 一致） =====
interface ChipsProps<T extends string> {
  items: { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
}

function Chips<T extends string>({ items, value, onChange }: ChipsProps<T>) {
  return (
    <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 2)', flexWrap: 'wrap' }}>
      {items.map((item) => {
        const active = item.key === value
        return (
          <button
            key={item.key}
            type="button"
            data-dom-id={`filter-${item.key}`}
            onClick={() => onChange(item.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 4)',
              border: '1px solid',
              borderColor: active ? 'var(--primary)' : 'var(--border)',
              background: active ? 'var(--primary)' : 'var(--card)',
              color: active ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              transition:
                'background 0.2s ease, color 0.2s ease, border-color 0.2s ease, transform 0.16s ease',
              fontSize: '0.85rem',
              fontWeight: active ? 600 : 500,
              whiteSpace: 'nowrap',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              if (!active) {
                e.currentTarget.style.background = 'var(--sidebar-accent)'
                e.currentTarget.style.color = 'var(--sidebar-accent-foreground)'
                e.currentTarget.style.borderColor = 'var(--sidebar-border)'
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                e.currentTarget.style.background = 'var(--card)'
                e.currentTarget.style.color = 'var(--muted-foreground)'
                e.currentTarget.style.borderColor = 'var(--border)'
              }
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.97)'
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

// ===== 共享样式 =====
const eyebrowStyle: CSSProperties = {
  color: 'var(--muted-foreground)',
  fontSize: '0.78rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}

const providerBadgeStyle: CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 500,
  textTransform: 'uppercase',
  background: 'var(--muted)',
  color: 'var(--foreground)',
  padding: '0.2rem 0.5rem',
  borderRadius: 'var(--radius)',
  whiteSpace: 'nowrap',
}

const filterFieldStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'calc(var(--spacing) * 2)',
}

const filterLabelStyle: CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--muted-foreground)',
  whiteSpace: 'nowrap',
}

const selectStyle: CSSProperties = {
  padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 3)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--card)',
  color: 'var(--foreground)',
  fontSize: '0.85rem',
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
  minWidth: 110,
}

const spinnerStyle: CSSProperties = {
  display: 'inline-block',
  width: 24,
  height: 24,
  borderRadius: '50%',
  border: '2px solid var(--border)',
  borderTopColor: 'var(--primary)',
  animation: 'spin 0.8s linear infinite',
}
