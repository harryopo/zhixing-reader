import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts'
import { ProviderStats, FeatureStats, DailyTokenStats } from '../../../../types/renderer'

interface DashboardData {
  stats: {
    totalConversations: number
    totalMessages: number
    totalTokens: number
    totalBooks: number
    totalHighlights: number
    totalCards: number
  }
  providers: ProviderStats[]
  features: FeatureStats[]
}

const CHART_COLORS = {
  primary: '#6366F1',
  primaryFill: 'rgba(99, 102, 241, 0.15)',
  secondary: '#A78BFA',
  secondaryFill: 'rgba(167, 139, 250, 0.15)',
  accent: '#F59E0B',
  emerald: '#10B981',
  rose: '#F43F5E',
  blue: '#3B82F6',
  cyan: '#06B6D4',
  pink: '#EC4899',
  amber: '#F59E0B',
}

const PIE_COLORS = ['#6366F1', '#A78BFA', '#F59E0B', '#10B981', '#3B82F6', '#F43F5E', '#06B6D4', '#EC4899']

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

const StatCard = ({ label, value, color, icon }: { label: string; value: string | number; color: string; icon?: string }) => {
  const colorMap: Record<string, string> = {
    indigo: 'from-indigo-50 to-indigo-100/50 text-indigo-600 border-indigo-100',
    violet: 'from-violet-50 to-violet-100/50 text-violet-600 border-violet-100',
    amber: 'from-amber-50 to-amber-100/50 text-amber-600 border-amber-100',
    emerald: 'from-emerald-50 to-emerald-100/50 text-emerald-600 border-emerald-100',
    blue: 'from-blue-50 to-blue-100/50 text-blue-600 border-blue-100',
    rose: 'from-rose-50 to-rose-100/50 text-rose-600 border-rose-100',
  }
  return (
    <div className={`relative overflow-hidden p-4 rounded-xl border bg-gradient-to-br ${colorMap[color]}`}>
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <p className="text-[11px] font-medium opacity-70 mb-1">{label}</p>
          <p className="text-2xl font-bold tabular-nums">{value}</p>
        </div>
        {icon && <span className="text-2xl opacity-30">{icon}</span>}
      </div>
    </div>
  )
}

const ChartCard = ({ title, subtitle, children, action }: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }) => (
  <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
    <div className="flex items-start justify-between mb-3">
      <div>
        <h3 className="text-[13px] font-semibold text-gray-800">{title}</h3>
        {subtitle && <p className="text-[11px] text-gray-400 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
    {children}
  </div>
)

export default function AdminDashboard() {
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const loadData = useCallback(async (silent = false) => {
    try {
      if (!silent) setLoading(true)
      setError(null)
      const safeCall = async <T,>(fn: () => Promise<T>, fallback: T): Promise<T> => {
        try {
          return await fn()
        } catch (e) {
          console.warn('[AdminDashboard] call failed:', e)
          return fallback
        }
      }
      const [stats, providers, features] = await Promise.all([
        safeCall(() => window.electronAPI.admin.getStats(), { stats: { totalConversations: 0, totalMessages: 0, totalTokens: 0, totalBooks: 0, totalHighlights: 0, totalCards: 0 }, tokenTrend: [], recentSessions: [] }),
        safeCall(() => window.electronAPI.tokenUsage.getStatsByProvider(), [] as any[]),
        safeCall(() => window.electronAPI.tokenUsage.getStatsByFeature(), [] as any[]),
      ])
      setData({
        stats: (stats as any)?.stats ?? stats ?? { totalConversations: 0, totalMessages: 0, totalTokens: 0, totalBooks: 0, totalHighlights: 0, totalCards: 0 },
        providers: Array.isArray(providers) ? providers : [],
        features: Array.isArray(features) ? features : [],
      })
      setLastUpdated(new Date())
    } catch (err: any) {
      console.error('加载概览数据失败:', err)
      setError(String(err?.message || err))
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(() => loadData(true), 5000)
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [autoRefresh, loadData])

  if (loading && !data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="bg-rose-50 border border-rose-200 rounded-xl p-5 max-w-2xl mx-auto mt-10">
        <h3 className="text-sm font-semibold text-rose-700 mb-2">数据加载失败</h3>
        <p className="text-xs text-rose-600 mb-3 font-mono bg-white p-2 rounded border border-rose-100 break-all">{error}</p>
        <p className="text-xs text-gray-500 mb-3">请打开 DevTools (Ctrl+Shift+I) 查看 Console 中的详细日志，将错误信息告诉我。</p>
        <button
          onClick={() => loadData()}
          className="px-3 py-1.5 text-xs text-white bg-rose-600 rounded-lg hover:bg-rose-700"
        >
          重试
        </button>
      </div>
    )
  }

  if (!data) return null
  const { stats, providers, features } = data

  const cards = [
    { label: '总对话数', value: stats.totalConversations, color: 'indigo', icon: '💬' },
    { label: '总消息数', value: stats.totalMessages, color: 'violet', icon: '✉️' },
    { label: '总 Token', value: formatTokens(stats.totalTokens), color: 'amber', icon: '⚡' },
    { label: '总书籍数', value: stats.totalBooks, color: 'emerald', icon: '📚' },
    { label: '总笔记数', value: stats.totalHighlights, color: 'blue', icon: '✏️' },
    { label: '知识卡片', value: stats.totalCards, color: 'rose', icon: '🎴' },
  ]

  const providerPieData = providers.map((p: ProviderStats) => ({
    name: p.provider === 'unknown' ? '未指定' : p.provider,
    value: p.total_tokens,
  }))

  const modelBarData = providers.slice(0, 10).map((p: ProviderStats) => ({
    name: p.model === 'unknown' ? '未指定' : p.model.length > 12 ? p.model.slice(0, 12) + '...' : p.model,
    tokens: p.total_tokens,
    requests: p.request_count,
  }))

  const featureBarData = features.map((f: FeatureStats) => ({
    name: f.feature,
    tokens: f.total_tokens,
    requests: f.request_count,
  }))

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-gray-800">实时数据仪表盘</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {lastUpdated ? `最后更新：${lastUpdated.toLocaleTimeString('zh-CN')}` : '加载中...'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-2.5 py-1 text-[11px] rounded-lg border transition-colors ${
              autoRefresh
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-gray-50 text-gray-500 border-gray-200'
            }`}
          >
            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 ${autoRefresh ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`}></span>
            {autoRefresh ? '自动刷新' : '已暂停'}
          </button>
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="px-2.5 py-1 text-[11px] text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 disabled:opacity-50"
          >
            {refreshing ? '刷新中...' : '↻ 刷新'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {cards.map(card => (
          <StatCard key={card.label} {...card} />
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="Provider 占比" subtitle="按 Token 用量">
          {providerPieData.length > 0 ? (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie
                  data={providerPieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                  label={(props) => `${props.name ?? ''} ${(((props.percent as number) ?? 0) * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {providerPieData.map((_item: unknown, i: number) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'rgba(31,41,55,0.95)', border: 'none', borderRadius: 8, fontSize: 12, color: '#fff' }}
                  formatter={(v) => formatTokens(Number(v))}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[240px] flex items-center justify-center text-gray-300 text-sm">暂无数据</div>
          )}
        </ChartCard>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="Model 用量 Top 10" subtitle="按 Token 用量">
          {modelBarData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={modelBarData} layout="vertical" margin={{ top: 5, right: 30, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={formatTokens} />
                <YAxis dataKey="name" type="category" tick={{ fontSize: 10, fill: '#9CA3AF' }} width={100} />
                <Tooltip
                  contentStyle={{ background: 'rgba(31,41,55,0.95)', border: 'none', borderRadius: 8, fontSize: 12, color: '#fff' }}
                  formatter={(v) => formatTokens(Number(v))}
                />
                <Bar dataKey="tokens" fill={CHART_COLORS.primary} radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-gray-300 text-sm">暂无数据</div>
          )}
        </ChartCard>

        <ChartCard title="Feature 拆分" subtitle="各功能调用情况">
          {featureBarData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={featureBarData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F3F4F6" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9CA3AF' }} angle={-15} textAnchor="end" height={60} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickFormatter={formatTokens} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#9CA3AF' }} />
                <Tooltip
                  contentStyle={{ background: 'rgba(31,41,55,0.95)', border: 'none', borderRadius: 8, fontSize: 12, color: '#fff' }}
                  formatter={(v, name) => name === 'tokens' ? formatTokens(Number(v)) : v}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar yAxisId="left" dataKey="tokens" name="Token" fill={CHART_COLORS.primary} radius={[4, 4, 0, 0]} />
                <Bar yAxisId="right" dataKey="requests" name="请求数" fill={CHART_COLORS.emerald} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-gray-300 text-sm">暂无数据</div>
          )}
        </ChartCard>
      </div>
    </div>
  )
}
