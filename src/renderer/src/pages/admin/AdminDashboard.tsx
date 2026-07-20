import { useState, useEffect, useCallback, useRef } from 'react'
import { ProviderStats, FeatureStats } from '../../../../types/renderer'
import {
  FeatureBarChart,
  ModelBarChart,
  ProviderPieChart,
  ProviderTokenBarChart,
  RequestPieChart,
  TokensGauge,
  formatTokens,
} from '@/admin-charts'

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

const ChartCard = ({
  title,
  subtitle,
  children,
  action,
}: {
  title: string
  subtitle?: string
  children: React.ReactNode
  action?: React.ReactNode
}) => (
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
      const [statsResult, providers, features] = await Promise.all([
        safeCall(() => window.electronAPI.admin.getStats(), {
          stats: {
            totalConversations: 0,
            totalMessages: 0,
            totalTokens: 0,
            totalBooks: 0,
            totalHighlights: 0,
            totalCards: 0,
          },
          tokenTrend: [],
          recentSessions: [],
        }),
        safeCall(() => window.electronAPI.tokenUsage.getStatsByProvider(), [] as ProviderStats[]),
        safeCall(() => window.electronAPI.tokenUsage.getStatsByFeature(), [] as FeatureStats[]),
      ])
      const statsObj = (statsResult as { stats?: DashboardData['stats'] })?.stats
      const stats: DashboardData['stats'] = statsObj ?? {
        totalConversations: 0,
        totalMessages: 0,
        totalTokens: 0,
        totalBooks: 0,
        totalHighlights: 0,
        totalCards: 0,
      }
      setData({
        stats,
        providers: Array.isArray(providers) ? providers : [],
        features: Array.isArray(features) ? features : [],
      })
      setLastUpdated(new Date())
    } catch (err) {
      const e = err as Error
      console.error('加载概览数据失败:', e)
      setError(e?.message || String(err))
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

      {/* 第 1 行：Provider 占比 + Token 综合 */}
      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="Provider 占比" subtitle="按 Token 用量">
          <ProviderPieChart providers={providers} />
        </ChartCard>
        <ChartCard title="Token 用量综合" subtitle="相对参考容量 5M">
          <TokensGauge totalTokens={stats.totalTokens} />
        </ChartCard>
      </div>

      {/* 第 2 行：Model Top10 + Feature 拆分 */}
      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="Model 用量 Top 10" subtitle="按 Token 用量">
          <ModelBarChart providers={providers} />
        </ChartCard>
        <ChartCard title="Feature 拆分" subtitle="各功能调用情况">
          <FeatureBarChart features={features} />
        </ChartCard>
      </div>

      {/* 第 3 行：请求数占比 + Provider 输入/输出 */}
      <div className="grid grid-cols-2 gap-4">
        <ChartCard title="Feature 请求数占比" subtitle="按请求数">
          <RequestPieChart features={features} />
        </ChartCard>
        <ChartCard title="Provider 输入/输出 Token" subtitle="按 Provider 分组堆叠">
          <ProviderTokenBarChart providers={providers} />
        </ChartCard>
      </div>
    </div>
  )
}
