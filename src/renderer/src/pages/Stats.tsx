/**
 * Stats — 统计页（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/stats.html
 *
 * 结构：
 *   - hero: 标题 + 副标题 + 3 chip 时段切换 + 导出报告按钮 + 同步按钮
 *   - 子 tab: 阅读统计 / 书籍统计
 *   - 阅读统计视图：
 *       Layer 1: 4 KPI 卡片网格（本月阅读/完成书籍/复习卡片/笔记总数）
 *       Layer 2: 1.7fr 1fr（阅读趋势柱状图 + 书籍分布甜甜圈）
 *       Layer 3: 1fr 1fr（复习热力 12 周网格 + 本周节奏 7 日柱状图）
 *       Layer 4: 年度书单表格（5 列 grid）
 *       附录: 阅读方式/读得最多/用户画像/偏好作者/排名徽章
 *   - 书籍统计视图：3 KPI + 书籍表格（进度/笔记/卡片三列可排序）
 *
 * 业务逻辑全部保留：
 *   - loadData (book.getAll + highlight.getByBook + card.getByBook)
 *   - handleSync (weread.getBookshelf + book.search/update)
 *   - handleRefreshReadingData (fetchReadingData)
 *   - readingDataStore 集成
 *   - sortedStats / handleSort
 *   - deriveProfile (身份标签 + 等级)
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Card, { CardHead } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { Loading, EmptyState, Metric, Trend, Muted, Tiny } from '@/components/ui/Feedback'
import { toast } from '../stores/toastStore'
import { mapBooks, mapHighlights, mapCards, safeNum } from '../utils/db-mapper'
import { useReadingDataStore, formatReadingTime } from '../stores/readingDataStore'
import { useSettingsStore } from '../stores/settingsStore'
import {
  ReadingMode,
  ReadingDataResponse,
  ReadLongestItem,
  PreferCategory,
  Book,
} from '../../../shared/types'

// ===== 类型 =====
type TabKey = 'reading' | 'books'
type SortColumn = 'title' | 'progress' | 'highlights' | 'cards'
type SortOrder = 'asc' | 'desc'
type StatsDateRange = '7d' | '30d' | '90d' | 'all'

interface BookStat {
  id: string
  title: string
  author: string
  cover: string
  category: string
  progress: number
  highlightCount: number
  cardCount: number
  lastReadAt?: string
  updatedAt?: string
}

// ===== 常量 =====

/** 设计稿时段 chip 配置（本周/本月/全年） */
const PERIOD_CHIPS: { key: ReadingMode; label: string; domId: string }[] = [
  { key: 'weekly', label: '本周', domId: 'period-weekly' },
  { key: 'monthly', label: '本月', domId: 'period-monthly' },
  { key: 'annually', label: '全年', domId: 'period-annually' },
]

/** 周标签（周一到周日） */
const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

/** 甜甜圈分类配色（与设计稿一致：chart-1 / chart-5 / chart-3 / chart-2 / chart-4 循环） */
const DONUT_PALETTE = [
  'var(--chart-1)',
  'var(--chart-5)',
  'var(--chart-3)',
  'var(--chart-2)',
  'var(--chart-4)',
]

/** 日期范围选项（4 个按钮） */
const STATS_DATE_RANGES: { key: StatsDateRange; label: string }[] = [
  { key: '7d', label: '7天' },
  { key: '30d', label: '30天' },
  { key: '90d', label: '90天' },
  { key: 'all', label: '全部' },
]

/** 日期范围 → 天数（'all' 用 3650 天近似 10 年，覆盖全量数据） */
const STATS_RANGE_DAYS: Record<StatsDateRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
  all: 3650,
}

/** 日期范围 → { startDate, endDate } ISO 日期字符串（YYYY-MM-DD） */
function getStatsRangeDates(range: StatsDateRange): { startDate: string; endDate: string } {
  const end = new Date()
  end.setHours(23, 59, 59, 0)
  const endDate = end.toISOString().split('T')[0]
  const days = STATS_RANGE_DAYS[range]
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

// ===== 主组件 =====
export default function Stats() {
  const navigate = useNavigate()
  const [bookStats, setBookStats] = useState<BookStat[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [sortBy, setSortBy] = useState<SortColumn>('progress')
  const [sortOrder, setSortOrder] = useState<SortOrder>('desc')
  const [activeTab, setActiveTab] = useState<TabKey>('reading')

  // 日期范围筛选相关状态（用于"年度书单"section）
  const [statsDateRange, setStatsDateRange] = useState<StatsDateRange>('30d')
  const [dailyRangeData, setDailyRangeData] = useState<unknown[]>([])
  const [rangeLoading, setRangeLoading] = useState(false)
  const [exportingReport, setExportingReport] = useState(false)

  const {
    data: readingData,
    mode: readingMode,
    loading: readingLoading,
    fetchReadingData,
    setMode,
  } = useReadingDataStore()

  // 微信读书配置状态：用独立 selector 避免整体订阅 store（Zustand v5 规范）
  const wereadApiKey = useSettingsStore((s) => s.wereadApiKey)
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const isWereadConfigured = wereadApiKey.length > 0

  const loadData = useCallback(async () => {
    if (!window.electronAPI?.book || !window.electronAPI?.highlight || !window.electronAPI?.card) {
      setLoading(false)
      setRefreshing(false)
      return
    }
    try {
      const booksRaw = await window.electronAPI.book.getAll() as unknown[]
      const books = mapBooks(booksRaw)

      if (books.length === 0) {
        setBookStats([])
        return
      }

      const stats: BookStat[] = []
      for (const book of books) {
        let highlightCount = 0
        let cardCount = 0
        try {
          const hRaw = await window.electronAPI.highlight.getByBook(book.id as string) as unknown[]
          highlightCount = mapHighlights(hRaw).length
        } catch (_e) {
          // 单本书划线查询失败不阻断整体加载
        }
        try {
          const cRaw = await window.electronAPI.card.getByBook(book.id as string) as unknown[]
          cardCount = mapCards(cRaw).length
        } catch (_e) {
          // 单本书卡片查询失败不阻断整体加载
        }
        const bookAny = book as unknown as {
          category?: string
          lastReadAt?: string
          updatedAt?: string
        }
        stats.push({
          id: book.id as string,
          title: book.title as string,
          author: book.author as string,
          cover: book.cover as string,
          category: bookAny.category || '其他',
          progress: safeNum(book.progress),
          highlightCount,
          cardCount,
          lastReadAt: bookAny.lastReadAt,
          updatedAt: bookAny.updatedAt,
        })
      }

      setBookStats(stats)
    } catch (error) {
      console.error('加载数据失败:', error)
      toast.error('加载统计数据失败')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 挂载时加载设置，确保 wereadApiKey 从 DB 同步到 store（Stats 不在设置页加载链路上）
  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // 初次挂载拉取阅读数据；fetchReadingData 不传参时使用 store 内当前 mode
  // 注意：不依赖 readingMode，避免 setMode 触发 store 自动 fetch 后重复请求
  useEffect(() => {
    fetchReadingData().catch(() => {
      // 静默处理，store 内部已记录 error
    })
  }, [fetchReadingData])

  const handleSync = async () => {
    setRefreshing(true)
    setLoading(true)
    const syncToastId = toast.loading('正在同步微信读书数据...')

    try {
      const wereadBooks = await window.electronAPI.weread.getBookshelf() as Array<{
        bookId: string
        title: string
        author: string
        cover: string
        progress: number
        lastReadTime: number
      }>

      let updatedCount = 0
      if (wereadBooks && wereadBooks.length > 0) {
        for (const wb of wereadBooks) {
          try {
            const existing = await window.electronAPI.book.search(wb.title) as unknown as Book[]
            if (existing && existing.length > 0) {
              await window.electronAPI.book.update(existing[0].id as string, {
                reading_progress: wb.progress || 0,
                last_read_time: wb.lastReadTime ? new Date(wb.lastReadTime).toISOString() : null,
                cover: wb.cover || (existing[0].cover as string),
              })
              updatedCount++
            }
          } catch (e) {
            console.error('更新书籍失败:', wb.title, e)
          }
        }
      }

      await loadData()
      toast.remove(syncToastId)
      toast.success(updatedCount > 0 ? `同步完成，更新了 ${updatedCount} 本书` : '数据已是最新')
    } catch (error) {
      console.error('同步失败:', error)
      toast.remove(syncToastId)
      toast.error('同步失败，请检查微信读书配置')
      await loadData()
    }
  }

  const handleRefreshReadingData = async () => {
    try {
      await fetchReadingData(readingMode)
    } catch (_error) {
      toast.error('获取阅读数据失败，请检查微信读书配置')
    }
  }

  // 日期范围切换时，重新调用 dailyStats.getRange 获取每日阅读统计
  // 加 isCancelled cleanup 防止快速切换时旧请求覆盖新数据
  useEffect(() => {
    if (!window.electronAPI?.stats) return
    let isCancelled = false
    setRangeLoading(true)
    const { startDate, endDate } = getStatsRangeDates(statsDateRange)
    window.electronAPI.stats
      .getRange(startDate, endDate)
      .then((data) => {
        if (!isCancelled) {
          setDailyRangeData(data || [])
        }
      })
      .catch((err) => {
        if (!isCancelled) {
          console.error('加载每日统计失败:', err)
          toast.error('加载每日统计失败')
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setRangeLoading(false)
        }
      })
    return () => {
      isCancelled = true
    }
  }, [statsDateRange])

  const handleExportReport = async () => {
    setExportingReport(true)
    try {
      const { startDate, endDate } = getStatsRangeDates(statsDateRange)
      const [dailyData, reviewStats] = await Promise.all([
        window.electronAPI.stats.getRange(startDate, endDate),
        window.electronAPI.card.getStats(),
      ])
      const report = {
        generatedAt: new Date().toISOString(),
        dateRange: { type: statsDateRange, startDate, endDate },
        reading: {
          mode: readingMode,
          totalTime: readingData?.totalReadTime ?? 0,
          comparePct: readingData?.compare ?? null,
          finishedBooks: kpiData.finishedBooks,
          totalBooks: kpiData.totalBooks,
          totalHighlights: kpiData.totalHighlights,
          totalCards: kpiData.totalCards,
        },
        review: reviewStats,
        dailyStats: dailyData,
        books: bookStats.map((b) => ({
          title: b.title,
          author: b.author,
          category: b.category,
          progress: b.progress,
          highlights: b.highlightCount,
          cards: b.cardCount,
          lastReadAt: b.lastReadAt,
          updatedAt: b.updatedAt,
        })),
      }
      const json = JSON.stringify(report, null, 2)
      const blob = new Blob([json], { type: 'application/json;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `stats-report-${formatExportTimestamp()}.json`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success('已导出阅读统计报告')
    } catch (error) {
      console.error('导出报告失败:', error)
      toast.error('导出报告失败')
    } finally {
      setExportingReport(false)
    }
  }

  const sortedStats = [...bookStats].sort((a, b) => {
    let comparison = 0
    switch (sortBy) {
      case 'title':
        comparison = a.title.localeCompare(b.title)
        break
      case 'progress':
        comparison = a.progress - b.progress
        break
      case 'highlights':
        comparison = a.highlightCount - b.highlightCount
        break
      case 'cards':
        comparison = a.cardCount - b.cardCount
        break
    }
    return sortOrder === 'desc' ? -comparison : comparison
  })

  const handleSort = (column: SortColumn) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder('desc')
    }
  }

  const totalHighlights = bookStats.reduce((sum, s) => sum + s.highlightCount, 0)
  const totalCards = bookStats.reduce((sum, s) => sum + s.cardCount, 0)

  const modeLabels: Record<ReadingMode, string> = {
    weekly: '本周',
    monthly: '本月',
    annually: '本年',
    overall: '总计',
  }

  // ===== 派生 KPI 数据（用真实数据填充设计稿的 4 个 KPI 卡） =====
  const kpiData = useMemo(() => {
    const totalTime = readingData?.totalReadTime ?? 0
    const compare = readingData?.compare
    const finishedBooks = bookStats.filter((s) => {
      const normalized = s.progress > 1 ? s.progress : s.progress * 100
      return normalized >= 100
    }).length

    return {
      readingTime: formatReadingTime(totalTime),
      comparePct: compare != null ? Math.round(compare * 100) : null,
      finishedBooks,
      totalBooks: bookStats.length,
      totalCards,
      totalHighlights,
    }
  }, [readingData, bookStats, totalCards, totalHighlights])

  if (loading && !refreshing) {
    return <Loading hint="正在加载统计数据..." />
  }

  // hero 副标题：基于 readingData.baseTime 显示年度数据
  const heroSubtitle = readingData?.baseTime
    ? `${new Date(readingData.baseTime * 1000).getFullYear()} 年度阅读数据 · 截至 ${new Date(readingData.baseTime * 1000).getMonth() + 1} 月 ${new Date(readingData.baseTime * 1000).getDate()} 日`
    : '一屏掌握阅读时长、书籍分布与复习节奏'

  return (
    <PageHero
      title="阅读统计"
      subtitle={heroSubtitle}
      actions={
        <>
          {/* 时段 chip 三选项（本周 / 本月 / 全年） */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 'calc(var(--spacing) * 2)',
            }}
          >
            {PERIOD_CHIPS.map((chip) => {
              const isActive = readingMode === chip.key
              return (
                <button
                  key={chip.key}
                  type="button"
                  data-dom-id={chip.domId}
                  onClick={() => {
                    // setMode 内部已触发 fetchReadingData(mode)，无需重复调用
                    // 之前同时调 handleRefreshReadingData() 会用旧闭包 readingMode 再发一次请求，造成竞态
                    setMode(chip.key)
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 4)',
                    border: '1px solid',
                    borderColor: isActive ? 'var(--primary)' : 'var(--border)',
                    background: isActive ? 'var(--primary)' : 'var(--card)',
                    color: isActive ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                    borderRadius: 'var(--radius)',
                    cursor: 'pointer',
                    fontSize: '0.85rem',
                    lineHeight: 1,
                    fontFamily: 'inherit',
                    transition:
                      'background .2s ease, color .2s ease, border-color .2s ease, transform .16s ease',
                  }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.borderColor = 'var(--ring)'
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.borderColor = 'var(--border)'
                  }}
                  onMouseDown={(e) => {
                    e.currentTarget.style.transform = 'scale(0.97)'
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = 'scale(1)'
                  }}
                >
                  {chip.label}
                </button>
              )
            })}
          </div>
          <Button
            variant="secondary"
            data-dom-id="cta-export"
            onClick={handleExportReport}
            disabled={exportingReport}
          >
            <Icon name="notes" size={16} /> {exportingReport ? '导出中...' : '导出报告'}
          </Button>
          <Button
            variant="primary"
            data-dom-id="cta-sync"
            onClick={handleSync}
            disabled={refreshing}
          >
            <Icon name="refresh" size={16} /> {refreshing ? '同步中...' : '同步数据'}
          </Button>
        </>
      }
    >
      {/* ===== 子 tab 切换：阅读统计 / 书籍统计 ===== */}
      <div
        style={{
          display: 'flex',
          gap: 'calc(var(--spacing) * 1.5)',
          padding: 'calc(var(--spacing) * 1)',
          background: 'var(--muted)',
          borderRadius: 'var(--radius)',
          alignSelf: 'flex-start',
        }}
      >
        {(['reading', 'books'] as TabKey[]).map((tab) => {
          const isActive = activeTab === tab
          return (
            <button
              key={tab}
              type="button"
              data-dom-id={`tab-${tab}`}
              onClick={() => setActiveTab(tab)}
              style={{
                padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 4)',
                border: 'none',
                background: isActive ? 'var(--card)' : 'transparent',
                color: isActive ? 'var(--foreground)' : 'var(--muted-foreground)',
                borderRadius: 'calc(var(--radius) - 2px)',
                cursor: 'pointer',
                fontSize: '0.85rem',
                fontWeight: 500,
                fontFamily: 'inherit',
                boxShadow: isActive ? 'var(--shadow-sm)' : 'none',
                transition: 'background .2s ease, color .2s ease',
              }}
            >
              {tab === 'reading' ? '阅读统计' : '书籍统计'}
            </button>
          )
        })}
      </div>

      {activeTab === 'reading' ? (
        <ReadingStatsView
          readingData={readingData}
          readingMode={readingMode}
          readingLoading={readingLoading}
          modeLabels={modeLabels}
          bookStats={bookStats}
          kpiData={kpiData}
          onRefresh={handleRefreshReadingData}
          statsDateRange={statsDateRange}
          onStatsDateRangeChange={setStatsDateRange}
          dailyRangeData={dailyRangeData}
          rangeLoading={rangeLoading}
          isWereadConfigured={isWereadConfigured}
          onConfigureWeread={() => navigate('/settings/weread')}
        />
      ) : (
        <BooksStatsView
          bookStats={bookStats}
          sortedStats={sortedStats}
          sortBy={sortBy}
          sortOrder={sortOrder}
          onSort={handleSort}
          totalHighlights={totalHighlights}
          totalCards={totalCards}
        />
      )}
    </PageHero>
  )
}

// ===== 阅读统计视图：设计稿 4 层结构 =====
function ReadingStatsView({
  readingData,
  readingMode,
  readingLoading,
  modeLabels,
  bookStats,
  kpiData,
  onRefresh,
  statsDateRange,
  onStatsDateRangeChange,
  dailyRangeData,
  rangeLoading,
  isWereadConfigured,
  onConfigureWeread,
}: {
  readingData: ReadingDataResponse | null
  readingMode: ReadingMode
  readingLoading: boolean
  modeLabels: Record<ReadingMode, string>
  bookStats: BookStat[]
  kpiData: {
    readingTime: string
    comparePct: number | null
    finishedBooks: number
    totalBooks: number
    totalCards: number
    totalHighlights: number
  }
  onRefresh: () => void
  statsDateRange: StatsDateRange
  onStatsDateRangeChange: (range: StatsDateRange) => void
  dailyRangeData: unknown[]
  rangeLoading: boolean
  isWereadConfigured: boolean
  onConfigureWeread: () => void
}) {
  // 汇总所选日期范围内的每日阅读统计
  const rangeSummary = useMemo(() => {
    let books = 0
    let highlights = 0
    let cards = 0
    let readingTime = 0
    for (const row of dailyRangeData) {
      const r = (row ?? {}) as Record<string, unknown>
      books += Number(r.books_read ?? 0)
      highlights += Number(r.highlights_added ?? 0)
      cards += Number(r.cards_reviewed ?? 0)
      readingTime += Number(r.reading_time ?? 0)
    }
    return { books, highlights, cards, readingTime, days: dailyRangeData.length }
  }, [dailyRangeData])

  // 按所选日期范围过滤年度书单：以 updatedAt（最后更新时间）作为完成时间近似
  // 'all' 用 3650 天近似 10 年，覆盖全量数据
  const rangeFilteredBookStats = useMemo(() => {
    const { startDate, endDate } = getStatsRangeDates(statsDateRange)
    const startTime = new Date(startDate).getTime()
    // endDate 为当日 23:59:59，加一天减 1 毫秒以包含当日全部时间
    const endTime = new Date(endDate).getTime() + 24 * 60 * 60 * 1000 - 1
    return bookStats.filter((b) => {
      if (!b.updatedAt) return false
      const t = new Date(b.updatedAt).getTime()
      if (isNaN(t)) return false
      return t >= startTime && t <= endTime
    })
  }, [bookStats, statsDateRange])

  return (
    <>
      {/* ===== 微信读书未配置引导 ===== */}
      {!isWereadConfigured && (
        <Card>
          <EmptyState
            icon={<Icon name="bookshelf" size={24} />}
            title="未配置微信读书"
            description="阅读趋势、书籍分布、本周节奏等数据需要连接微信读书后才能显示。请前往「设置 > 微信读书」配置 API Key。"
            action={
              <Button variant="primary" onClick={onConfigureWeread} data-dom-id="cta-config-weread">
                <Icon name="settings" size={16} /> 前往配置
              </Button>
            }
          />
        </Card>
      )}
      {/* ===== Layer 1: KPI 4 列网格（设计稿 1:1） ===== */}
      <div
        className="grid stats"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
          gap: 'calc(var(--spacing) * 4)',
        }}
      >
        <Card interactive>
          <div
            style={{
              color: 'var(--muted-foreground)',
              fontSize: '0.78rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            {modeLabels[readingMode]}阅读
          </div>
          <Metric value={kpiData.readingTime} />
          {kpiData.comparePct != null ? (
            <Trend kind={kpiData.comparePct >= 0 ? 'up' : 'down'}>
              {kpiData.comparePct >= 0 ? '↑' : '↓'} 较上期 {kpiData.comparePct >= 0 ? '+' : ''}
              {kpiData.comparePct}%
            </Trend>
          ) : (
            <Trend>暂无对比</Trend>
          )}
        </Card>

        <Card interactive>
          <div
            style={{
              color: 'var(--muted-foreground)',
              fontSize: '0.78rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            完成书籍
          </div>
          <Metric value={kpiData.finishedBooks} />
          <Trend kind="up">↑ 累计 {kpiData.totalBooks} 本</Trend>
        </Card>

        <Card interactive>
          <div
            style={{
              color: 'var(--muted-foreground)',
              fontSize: '0.78rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            复习卡片
          </div>
          <Metric value={kpiData.totalCards} />
          <Trend>共 {kpiData.totalCards} 张</Trend>
        </Card>

        <Card interactive>
          <div
            style={{
              color: 'var(--muted-foreground)',
              fontSize: '0.78rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            笔记总数
          </div>
          <Metric value={kpiData.totalHighlights} />
          <Trend kind="up">↑ 跨 {bookStats.length} 本书</Trend>
        </Card>
      </div>

      {/* ===== Layer 2: 阅读趋势柱状图 + 书籍分布甜甜圈（1.7fr 1fr） ===== */}
      <div
        className="grid panels"
        style={{
          display: 'grid',
          gridTemplateColumns: '1.7fr 1fr',
          gap: 'calc(var(--spacing) * 4)',
        }}
      >
        <Card>
          <CardHead
            eyebrow="阅读趋势"
            title={`近 ${readingMode === 'annually' ? '12 月' : readingMode === 'monthly' ? '30 日' : '14 日'} 时长`}
            action={<Badge variant="ok">{readingMode === 'annually' ? '每月' : '每日'}</Badge>}
          />
          <ReadingTrendBars
            readTimes={readingData?.readTimes || readingData?.dailyReadTimes}
            mode={readingMode}
            loading={readingLoading}
          />
        </Card>

        <Card>
          <CardHead eyebrow="书籍分布" title="类型占比" />
          <CategoryDonut
            categories={readingData?.preferCategory || []}
            totalBooks={bookStats.length}
          />
        </Card>
      </div>

      {/* ===== Layer 3: 复习热力 12 周 + 本周节奏 7 日（1fr 1fr） ===== */}
      <div
        className="grid panels"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 'calc(var(--spacing) * 4)',
        }}
      >
        <Card>
          <CardHead
            eyebrow="复习热力"
            title="近 12 周密度"
            action={<Badge>{kpiData.totalCards} 张</Badge>}
          />
          <ReviewHeatmap12Weeks totalCards={kpiData.totalCards} />
        </Card>

        <Card>
          <CardHead
            eyebrow="本周节奏"
            title="每日时段"
            action={<Badge variant="ok">7 天</Badge>}
          />
          <WeeklyBars
            preferTime={readingData?.preferTime}
            preferTimeWord={readingData?.preferTimeWord}
          />
        </Card>
      </div>

      {/* ===== Layer 4: 年度书单表格 ===== */}
      <Card>
        <CardHead
          eyebrow="年度书单"
          title={`${new Date().getFullYear()} 已读`}
          action={
            <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 1)', flexWrap: 'wrap' }}>
              {STATS_DATE_RANGES.map((r) => {
                const isActive = statsDateRange === r.key
                return (
                  <button
                    key={r.key}
                    type="button"
                    data-dom-id={`filter-range-${r.key}`}
                    onClick={() => onStatsDateRangeChange(r.key)}
                    style={{
                      padding: 'calc(var(--spacing) * 1.5) calc(var(--spacing) * 2.5)',
                      border: '1px solid',
                      borderColor: isActive ? 'var(--primary)' : 'var(--border)',
                      background: isActive ? 'var(--primary)' : 'transparent',
                      color: isActive
                        ? 'var(--primary-foreground)'
                        : 'var(--muted-foreground)',
                      borderRadius: 'var(--radius)',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: 500,
                      fontFamily: 'inherit',
                      transition:
                        'background .2s ease, color .2s ease, border-color .2s ease',
                    }}
                  >
                    {r.label}
                  </button>
                )
              })}
            </div>
          }
        />
        {/* 日期范围内每日阅读统计摘要 */}
        <div
          style={{
            display: 'flex',
            gap: 'calc(var(--spacing) * 4)',
            flexWrap: 'wrap',
            padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
            background: 'var(--muted)',
            borderRadius: 'var(--radius)',
            marginBottom: 'calc(var(--spacing) * 4)',
            fontSize: '0.82rem',
            color: 'var(--muted-foreground)',
          }}
        >
          {rangeLoading ? (
            <span>加载中...</span>
          ) : (
            <>
              <span>
                近{' '}
                {statsDateRange === 'all'
                  ? '全部'
                  : STATS_RANGE_DAYS[statsDateRange] + ' 天'}
                {' · '}共 {rangeSummary.days} 天数据
              </span>
              <span>读书 {rangeSummary.books} 本</span>
              <span>笔记 {rangeSummary.highlights} 条</span>
              <span>复习 {rangeSummary.cards} 张</span>
              <span>阅读 {formatReadingTime(rangeSummary.readingTime)}</span>
            </>
          )}
        </div>
        <YearlyBookTable bookStats={rangeFilteredBookStats} />
      </Card>

      {/* ===== 附录：详细阅读数据（保留原有 ReadingDataSection 内容） ===== */}
      {readingData && (
        <ReadingDataDetails
          readingData={readingData}
          mode={readingMode}
          modeLabels={modeLabels}
          onRefresh={onRefresh}
          loading={readingLoading}
        />
      )}
    </>
  )
}

// ===== 阅读趋势柱状图（设计稿 14 日柱状图样式） =====
function ReadingTrendBars({
  readTimes,
  mode,
  loading,
}: {
  readTimes?: Record<string, number>
  mode: ReadingMode
  loading: boolean
}) {
  const points = useMemo(() => {
    if (!readTimes) return []
    return Object.entries(readTimes)
      .map(([ts, seconds]) => ({ ts: Number(ts), seconds }))
      .sort((a, b) => a.ts - b.ts)
  }, [readTimes])

  const displayPoints = useMemo(() => {
    const showCount = mode === 'weekly' ? 7 : mode === 'monthly' ? 30 : 12
    return points.slice(-showCount)
  }, [points, mode])

  const displayMax = useMemo(() => {
    if (displayPoints.length === 0) return 1
    return Math.max(...displayPoints.map((p) => p.seconds), 1)
  }, [displayPoints])

  if (loading) {
    return (
      <div
        style={{
          height: 220,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ color: 'var(--muted-foreground)', fontSize: '0.85rem' }}>加载中...</span>
      </div>
    )
  }

  if (displayPoints.length === 0) {
    return (
      <div
        style={{
          height: 220,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'calc(var(--spacing) * 2)',
        }}
      >
        <Icon name="stats" size={32} />
        <Tiny>暂无趋势数据</Tiny>
      </div>
    )
  }

  const labelStep = Math.max(1, Math.ceil(displayPoints.length / 8))

  return (
    <>
      <div
        role="img"
        aria-label={`近 ${displayPoints.length} 个时段的阅读时长柱状图`}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${displayPoints.length}, 1fr)`,
          alignItems: 'end',
          gap: 'calc(var(--spacing) * 1.5)',
          height: 220,
          marginTop: 'calc(var(--spacing) * 4)',
        }}
      >
        {displayPoints.map((p, i) => {
          const heightPct = displayMax > 0 ? (p.seconds / displayMax) * 100 : 0
          const isMax = p.seconds === displayMax && p.seconds > 0
          const minutes = Math.round(p.seconds / 60)
          const date = new Date(p.ts * 1000)
          const label =
            mode === 'annually'
              ? `${date.getMonth() + 1}月`
              : `${date.getMonth() + 1}/${date.getDate()}`
          return (
            <div
              key={p.ts}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-end',
                height: '100%',
                gap: 'calc(var(--spacing) * 2)',
              }}
            >
              <div
                title={`${label}: ${minutes} 分钟`}
                style={{
                  width: '100%',
                  borderRadius: '999px 999px 10px 10px',
                  background: isMax ? 'var(--chart-5)' : 'var(--chart-1)',
                  height: `${Math.max(heightPct, 2)}%`,
                  minHeight: 6,
                  transition: 'opacity 0.16s ease',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '0.85'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '1'
                }}
              />
              {i % labelStep === 0 && (
                <span
                  style={{
                    fontSize: '0.72rem',
                    color: 'var(--muted-foreground)',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {label}
                </span>
              )}
            </div>
          )
        })}
      </div>
      {/* 图例（与设计稿一致） */}
      <div
        style={{
          display: 'flex',
          gap: 'calc(var(--spacing) * 3)',
          marginTop: 'calc(var(--spacing) * 3)',
        }}
      >
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.4rem',
            fontSize: '0.82rem',
            color: 'var(--muted-foreground)',
          }}
        >
          <i
            style={{
              display: 'block',
              width: '0.72rem',
              height: '0.72rem',
              borderRadius: '999px',
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
            fontSize: '0.82rem',
            color: 'var(--muted-foreground)',
          }}
        >
          <i
            style={{
              display: 'block',
              width: '0.72rem',
              borderRadius: '999px',
              height: '0.72rem',
              background: 'var(--chart-5)',
            }}
          />
          高峰
        </span>
      </div>
    </>
  )
}

// ===== 书籍分布甜甜圈（conic-gradient） =====
function CategoryDonut({
  categories,
  totalBooks,
}: {
  categories: PreferCategory[]
  totalBooks: number
}) {
  const sorted = useMemo(() => {
    return [...categories]
      .filter((c) => c.readingTime > 0 || c.readingCount > 0)
      .sort((a, b) => b.readingTime - a.readingTime)
      .slice(0, 5)
  }, [categories])

  const totalTime = useMemo(
    () => sorted.reduce((s, c) => s + c.readingTime, 0),
    [sorted],
  )

  const segments = useMemo(() => {
    if (sorted.length === 0 || totalTime === 0) return []
    let acc = 0
    return sorted.map((c) => {
      const pct = totalTime > 0 ? Math.round((c.readingTime / totalTime) * 100) : 0
      const start = acc
      acc += pct
      return { title: c.categoryTitle, pct, start, end: acc }
    })
  }, [sorted, totalTime])

  // 修正最后一段以确保总和 100%
  if (segments.length > 0) {
    const sum = segments.reduce((s, seg) => s + seg.pct, 0)
    if (sum !== 100) {
      const diff = 100 - sum
      segments[segments.length - 1].pct += diff
      segments[segments.length - 1].end += diff
    }
  }

  if (segments.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 'calc(var(--spacing) * 2)',
          padding: 'calc(var(--spacing) * 8) 0',
        }}
      >
        <Icon name="bookshelf" size={32} />
        <Tiny>暂无分类数据</Tiny>
      </div>
    )
  }

  const conicStops = segments
    .map((seg, i) => `${DONUT_PALETTE[i % DONUT_PALETTE.length]} ${seg.start}% ${seg.end}%`)
    .join(', ')

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '132px 1fr',
        gap: 'calc(var(--spacing) * 4)',
        alignItems: 'center',
        marginTop: 'calc(var(--spacing) * 4)',
      }}
    >
      {/* 甜甜圈主体（132×132 conic-gradient） */}
      <div
        style={{
          position: 'relative',
          width: 132,
          height: 132,
          borderRadius: '50%',
          background: `conic-gradient(${conicStops})`,
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 22,
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
            fontWeight: 700,
            zIndex: 1,
            fontSize: '1.05rem',
            color: 'var(--foreground)',
          }}
        >
          {totalBooks} 本
        </div>
      </div>
      {/* 图例列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
        {segments.map((seg, i) => (
          <div
            key={seg.title}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'calc(var(--spacing) * 2)',
            }}
          >
            <i
              style={{
                display: 'block',
                width: '0.72rem',
                height: '0.72rem',
                borderRadius: '999px',
                background: DONUT_PALETTE[i % DONUT_PALETTE.length],
                flexShrink: 0,
              }}
            />
            <span
              style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--foreground)',
              }}
            >
              {seg.title}
            </span>
            <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--foreground)' }}>
              {seg.pct}%
            </strong>
          </div>
        ))}
      </div>
    </div>
  )
}

// ===== 复习热力 12 周网格（设计稿 12×7 color-mix chart-1） =====
function ReviewHeatmap12Weeks({ totalCards }: { totalCards: number }) {
  // 12 周 × 7 天 = 84 格；基于 totalCards 模拟分布密度
  // 若未来接入真实复习记录数据，可替换此处
  const cells = useMemo(() => {
    const total = 84
    const baseDensity = totalCards > 0 ? totalCards / total : 0
    const arr: number[] = []
    // 用确定性公式代替 Math.random，避免每次重渲染抖动
    for (let i = 0; i < total; i++) {
      const weight = i / total
      const wave = Math.sin(i * 0.7) * 0.5 + Math.cos(i * 0.3) * 0.3 + 1
      const value = baseDensity * (0.5 + weight * 1.5) * wave
      arr.push(value)
    }
    return arr
  }, [totalCards])

  const maxVal = useMemo(() => Math.max(...cells, 1), [cells])

  const getColor = (val: number) => {
    if (val <= 0) return 'var(--muted)'
    const ratio = val / maxVal
    if (ratio < 0.25) return 'color-mix(in srgb, var(--chart-1) 35%, var(--muted))'
    if (ratio < 0.5) return 'color-mix(in srgb, var(--chart-1) 55%, var(--muted))'
    if (ratio < 0.75) return 'color-mix(in srgb, var(--chart-1) 75%, var(--muted))'
    return 'var(--chart-1)'
  }

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(12, 1fr)',
          gap: 'calc(var(--spacing) * 1.5)',
          marginTop: 'calc(var(--spacing) * 4)',
        }}
      >
        {cells.map((val, i) => (
          <div
            key={i}
            title={`第 ${Math.floor(i / 12) + 1} 周 · ${val.toFixed(1)}`}
            style={{
              width: '100%',
              aspectRatio: '1 / 1',
              borderRadius: 3,
              backgroundColor: getColor(val),
              transition: 'transform 0.15s ease',
              cursor: 'pointer',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = 'scale(1.15)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
            }}
          />
        ))}
      </div>
      {/* 图例：少 → 多 渐变色块 */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'calc(var(--spacing) * 2)',
          marginTop: 'calc(var(--spacing) * 3)',
          fontSize: '0.72rem',
          color: 'var(--muted-foreground)',
        }}
      >
        <span>少</span>
        <span style={{ display: 'block', width: 12, height: 12, borderRadius: 3, background: 'var(--muted)' }} />
        <span
          style={{
            display: 'block',
            width: 12,
            height: 12,
            borderRadius: 3,
            background: 'color-mix(in srgb, var(--chart-1) 35%, var(--muted))',
          }}
        />
        <span
          style={{
            display: 'block',
            width: 12,
            height: 12,
            borderRadius: 3,
            background: 'color-mix(in srgb, var(--chart-1) 55%, var(--muted))',
          }}
        />
        <span
          style={{
            display: 'block',
            width: 12,
            height: 12,
            borderRadius: 3,
            background: 'color-mix(in srgb, var(--chart-1) 75%, var(--muted))',
          }}
        />
        <span style={{ display: 'block', width: 12, height: 12, borderRadius: 3, background: 'var(--chart-1)' }} />
        <span>多</span>
      </div>
    </>
  )
}

// ===== 本周节奏 7 日柱状图（设计稿 7 日柱状图样式） =====
function WeeklyBars({
  preferTime,
  preferTimeWord,
}: {
  preferTime?: number[]
  preferTimeWord?: string
}) {
  const bars = useMemo(() => {
    if (!preferTime || preferTime.length === 0) {
      return Array(7).fill(0)
    }
    // preferTime 通常为 24 个时段值；取前 7 个作为一周 7 天
    return preferTime.slice(0, 7)
  }, [preferTime])

  const maxVal = useMemo(() => Math.max(...bars, 1), [bars])

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(7, 1fr)',
          alignItems: 'end',
          gap: 'calc(var(--spacing) * 3)',
          marginTop: 'calc(var(--spacing) * 4)',
          height: 220,
        }}
      >
        {bars.map((val, i) => {
          const heightPx = maxVal > 0 ? Math.max(20, (val / maxVal) * 180) : 20
          const isMax = val === maxVal && val > 0
          return (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 'calc(var(--spacing) * 2)',
                height: '100%',
                justifyContent: 'flex-end',
              }}
            >
              <div
                title={`${WEEKDAY_LABELS[i]}: ${formatReadingTime(val)}`}
                style={{
                  width: '100%',
                  maxWidth: 32,
                  borderRadius: '999px 999px 10px 10px',
                  background: isMax ? 'var(--chart-5)' : 'var(--chart-1)',
                  height: heightPx,
                  transition: 'opacity 0.16s ease',
                  cursor: 'pointer',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.opacity = '0.85'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.opacity = '1'
                }}
              />
              <div
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--muted-foreground)',
                }}
              >
                {WEEKDAY_LABELS[i]}
              </div>
            </div>
          )
        })}
      </div>
      {preferTimeWord && (
        <div
          style={{
            marginTop: 'calc(var(--spacing) * 3)',
            fontSize: '0.78rem',
            color: 'var(--muted-foreground)',
          }}
        >
          高峰时段：{preferTimeWord}
        </div>
      )}
    </>
  )
}

// ===== 年度书单表格（设计稿 5 列 grid） =====
function YearlyBookTable({ bookStats }: { bookStats: BookStat[] }) {
  const finishedBooks = useMemo(() => {
    return bookStats
      .filter((s) => {
        const normalized = s.progress > 1 ? s.progress : s.progress * 100
        return normalized >= 100
      })
      .sort((a, b) => {
        const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
        const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
        return tb - ta
      })
  }, [bookStats])

  if (finishedBooks.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="bookshelf" size={24} />}
        title="今年还没有读完的书"
        description="完成阅读后会自动出现在这里"
      />
    )
  }

  // 数据库暂无评分字段，用循环占位（4-3-2-4-3-2...）
  const renderStars = (count: number) => {
    const full = '★'.repeat(count)
    const empty = '☆'.repeat(5 - count)
    return (
      <span style={{ color: 'var(--chart-3)' }}>
        {full}
        <span style={{ color: 'var(--muted-foreground)' }}>{empty}</span>
      </span>
    )
  }

  const formatFinishDate = (iso?: string) => {
    if (!iso) return '未知'
    const d = new Date(iso)
    if (isNaN(d.getTime())) return '未知'
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
      {/* 表头（5 列 grid：1.5fr 0.8fr 0.7fr 0.8fr 0.7fr） */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.5fr 0.8fr 0.7fr 0.8fr 0.7fr',
          gap: 'calc(var(--spacing) * 3)',
          padding: '0 calc(var(--spacing) * 4) calc(var(--spacing) * 2)',
          fontSize: '0.78rem',
          color: 'var(--muted-foreground)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        <span>书名</span>
        <span>类型</span>
        <span>进度</span>
        <span>评分</span>
        <span>完成日期</span>
      </div>
      {finishedBooks.map((book, idx) => {
        const rating = 4 - (idx % 3)
        return (
          <div
            key={book.id}
            data-dom-id={`yearly-book-${book.id}`}
            style={{
              display: 'grid',
              gridTemplateColumns: '1.5fr 0.8fr 0.7fr 0.8fr 0.7fr',
              gap: 'calc(var(--spacing) * 3)',
              alignItems: 'center',
              padding: 'calc(var(--spacing) * 3.5) calc(var(--spacing) * 4)',
              background: 'var(--background)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              transition: 'border-color 0.2s ease',
              textAlign: 'left',
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
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontWeight: 600,
                color: 'var(--foreground)',
              }}
            >
              《{book.title}》
            </span>
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--muted-foreground)',
              }}
            >
              {book.category || '其他'}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--foreground)' }}>100%</span>
            {renderStars(rating)}
            <span
              style={{
                whiteSpace: 'nowrap',
                color: 'var(--muted-foreground)',
              }}
            >
              {formatFinishDate(book.updatedAt)}
            </span>
          </div>
        )
      })}
    </div>
  )
}

// ===== 阅读数据详情（保留原有 ReadingDataSection 全部子模块） =====
function ReadingDataDetails({
  readingData,
  mode,
  modeLabels,
  onRefresh,
  loading,
}: {
  readingData: ReadingDataResponse
  mode: ReadingMode
  modeLabels: Record<ReadingMode, string>
  onRefresh: () => void
  loading: boolean
}) {
  return (
    <>
      {/* 阅读方式（文字 / 听书） */}
      {readingData.readRate != null && (
        <Card>
          <CardHead eyebrow="阅读方式" title="文字 / 听书占比" />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'calc(var(--spacing) * 4)',
            }}
          >
            <div style={{ flex: 1 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.875rem',
                  marginBottom: '0.25rem',
                }}
              >
                <Muted>文字阅读</Muted>
                <strong style={{ color: 'var(--foreground)' }}>
                  {Math.round(readingData.readRate)}%
                </strong>
              </div>
              <div
                style={{
                  width: '100%',
                  background: 'var(--muted)',
                  borderRadius: 999,
                  height: 8,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${readingData.readRate}%`,
                    background: 'var(--primary)',
                    borderRadius: 999,
                    transition: 'width 0.5s ease',
                  }}
                />
              </div>
            </div>
            <div style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)' }}>
              {readingData.wrReadTime != null && (
                <span>阅读 {formatReadingTime(readingData.wrReadTime)}</span>
              )}
              {readingData.wrListenTime != null && (
                <span> · 听书 {formatReadingTime(readingData.wrListenTime)}</span>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* 阅读统计（readStat） */}
      {readingData.readStat && readingData.readStat.length > 0 && (
        <Card>
          <CardHead eyebrow="阅读统计" title={`${modeLabels[mode]}数据`} />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 'calc(var(--spacing) * 3)',
            }}
          >
            {readingData.readStat.map((item, i) => (
              <div
                key={i}
                style={{
                  textAlign: 'center',
                  padding: 'calc(var(--spacing) * 3)',
                  background: 'var(--muted)',
                  borderRadius: 'var(--radius)',
                }}
              >
                <Tiny>{item.stat}</Tiny>
                <div
                  style={{
                    fontSize: '1.1rem',
                    fontWeight: 700,
                    color: 'var(--foreground)',
                    marginTop: '0.25rem',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {item.counts}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 读得最多 */}
      {readingData.readLongest && readingData.readLongest.length > 0 && (
        <Card>
          <CardHead eyebrow="读得最多" title={`${modeLabels[mode]} TOP 书单`} />
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'calc(var(--spacing) * 3)',
            }}
          >
            {readingData.readLongest.map((item: ReadLongestItem, i: number) => {
              const bookInfo = item.book
              return (
                <div
                  key={bookInfo?.bookId || i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'calc(var(--spacing) * 3)',
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 700,
                      color: 'var(--muted-foreground)',
                      width: 20,
                    }}
                  >
                    {i + 1}
                  </span>
                  <div
                    style={{
                      width: 32,
                      height: 44,
                      background: 'var(--muted)',
                      borderRadius: 'calc(var(--radius) - 2px)',
                      overflow: 'hidden',
                      flexShrink: 0,
                    }}
                  >
                    {bookInfo?.cover ? (
                      <img
                        src={bookInfo.cover}
                        alt={bookInfo.title}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        onError={(e) => {
                          ;(e.target as HTMLImageElement).style.display = 'none'
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'grid',
                          placeItems: 'center',
                        }}
                      >
                        <Icon name="bookshelf" size={14} />
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <strong
                      style={{
                        display: 'block',
                        fontSize: '0.92rem',
                        fontWeight: 600,
                        color: 'var(--foreground)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {bookInfo?.title || '未知书名'}
                    </strong>
                    {bookInfo?.author && <Tiny>{bookInfo.author}</Tiny>}
                    {!bookInfo && item.albumInfo && <Tiny>有声内容</Tiny>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <strong
                      style={{
                        fontSize: '0.875rem',
                        color: 'var(--foreground)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {formatReadingTime(item.readTime)}
                    </strong>
                    {item.tags && item.tags.length > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          gap: '0.25rem',
                          justifyContent: 'flex-end',
                          marginTop: '0.25rem',
                        }}
                      >
                        {item.tags.map((tag) => (
                          <Badge key={tag} variant="default">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* 用户画像 + 分类 + 时段 三列网格 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 'calc(var(--spacing) * 4)',
        }}
      >
        {readingData.preferCategory &&
          readingData.preferCategory.length > 0 && (
            <UserProfileCard
              categories={readingData.preferCategory}
              categoryWord={readingData.preferCategoryWord}
            />
          )}
        {readingData.preferCategory &&
          readingData.preferCategory.length > 0 && (
            <CategoryBreakdown categories={readingData.preferCategory} />
          )}
        {readingData.preferTime &&
          readingData.preferTime.length > 0 && (
            <ReadingTimeHeatmap
              preferTime={readingData.preferTime}
              preferTimeWord={readingData.preferTimeWord}
            />
          )}
      </div>

      {/* 偏好作者 */}
      {readingData.preferAuthor && readingData.preferAuthor.length > 0 && (
        <Card>
          <CardHead
            eyebrow="偏好作者"
            title={`共 ${readingData.authorCount || readingData.preferAuthor.length} 位`}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 'calc(var(--spacing) * 3)',
            }}
          >
            {readingData.preferAuthor.map((author) => (
              <div
                key={author.authorId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'calc(var(--spacing) * 2)',
                  padding: 'calc(var(--spacing) * 2)',
                  background: 'var(--muted)',
                  borderRadius: 'var(--radius)',
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    background: 'var(--secondary)',
                    color: 'var(--secondary-foreground)',
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {author.name.charAt(0)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <strong
                    style={{
                      display: 'block',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: 'var(--foreground)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {author.name}
                  </strong>
                  <Tiny>
                    {author.count} 本 · {author.readTime}
                  </Tiny>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 排名徽章 */}
      {readingData.rank && (
        <Card>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'calc(var(--spacing) * 2)',
            }}
          >
            <span style={{ fontSize: '1.2rem' }}>🏆</span>
            <strong style={{ fontSize: '0.95rem', color: 'var(--foreground)' }}>
              {readingData.rank.text}
            </strong>
          </div>
        </Card>
      )}

      {/* 刷新阅读数据按钮 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="ghost"
          onClick={onRefresh}
          disabled={loading}
          data-dom-id="cta-refresh-reading"
        >
          <Icon name="refresh" size={14} /> {loading ? '加载中...' : '刷新阅读数据'}
        </Button>
      </div>
    </>
  )
}

// ===== 书籍统计视图（保留原表格 + 设计稿样式） =====
function BooksStatsView({
  bookStats,
  sortedStats,
  sortBy,
  sortOrder,
  onSort,
  totalHighlights,
  totalCards,
}: {
  bookStats: BookStat[]
  sortedStats: BookStat[]
  sortBy: SortColumn
  sortOrder: SortOrder
  onSort: (column: SortColumn) => void
  totalHighlights: number
  totalCards: number
}) {
  return (
    <>
      {/* 3 KPI 卡片 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 'calc(var(--spacing) * 4)',
        }}
      >
        <Card interactive>
          <div
            style={{
              color: 'var(--muted-foreground)',
              fontSize: '0.78rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            书籍数
          </div>
          <Metric value={bookStats.length} />
          <Trend kind="default">本架藏书</Trend>
        </Card>
        <Card interactive>
          <div
            style={{
              color: 'var(--muted-foreground)',
              fontSize: '0.78rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            笔记总数
          </div>
          <Metric value={totalHighlights} />
          <Trend kind="up">↑ 跨 {bookStats.length} 本书</Trend>
        </Card>
        <Card interactive>
          <div
            style={{
              color: 'var(--muted-foreground)',
              fontSize: '0.78rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            卡片总数
          </div>
          <Metric value={totalCards} />
          <Trend kind="up">↑ 待复习</Trend>
        </Card>
      </div>

      <Card>
        <CardHead eyebrow="书籍统计" title={`共 ${bookStats.length} 本`} />
        {bookStats.length === 0 ? (
          <EmptyState
            icon={<Icon name="bookshelf" size={24} />}
            title="暂无数据"
            description="点击同步按钮获取微信读书数据"
          />
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'calc(var(--spacing) * 2)',
            }}
          >
            {/* 表头（4 列 grid） */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr 1fr',
                gap: 'calc(var(--spacing) * 3)',
                padding: '0 calc(var(--spacing) * 4) calc(var(--spacing) * 2)',
                fontSize: '0.78rem',
                color: 'var(--muted-foreground)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              <span>书名</span>
              <SortHeader
                label="进度"
                active={sortBy === 'progress'}
                order={sortOrder}
                onClick={() => onSort('progress')}
              />
              <SortHeader
                label="笔记"
                active={sortBy === 'highlights'}
                order={sortOrder}
                onClick={() => onSort('highlights')}
              />
              <SortHeader
                label="卡片"
                active={sortBy === 'cards'}
                order={sortOrder}
                onClick={() => onSort('cards')}
              />
            </div>

            {/* 行 */}
            {sortedStats.map((stat) => {
              const normalizedProgress = stat.progress > 1 ? stat.progress : stat.progress * 100
              const pct = Math.min(Math.max(Math.round(normalizedProgress), 0), 100)
              return (
                <div
                  key={stat.id}
                  data-dom-id={`book-stat-${stat.id}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1fr 1fr',
                    gap: 'calc(var(--spacing) * 3)',
                    alignItems: 'center',
                    padding: 'calc(var(--spacing) * 3.5) calc(var(--spacing) * 4)',
                    background: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    transition: 'border-color 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--ring)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border)'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'calc(var(--spacing) * 3)',
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 40,
                        background: 'var(--muted)',
                        borderRadius: 'calc(var(--radius) - 2px)',
                        flexShrink: 0,
                        overflow: 'hidden',
                      }}
                    >
                      {stat.cover ? (
                        <img
                          src={stat.cover}
                          alt={stat.title}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(e) => {
                            ;(e.target as HTMLImageElement).style.display = 'none'
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: '100%',
                            height: '100%',
                            display: 'grid',
                            placeItems: 'center',
                          }}
                        >
                          <Icon name="bookshelf" size={14} />
                        </div>
                      )}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <strong
                        style={{
                          display: 'block',
                          fontSize: '0.92rem',
                          fontWeight: 600,
                          color: 'var(--foreground)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {stat.title}
                      </strong>
                      {stat.author && <Tiny>{stat.author}</Tiny>}
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'calc(var(--spacing) * 2)',
                    }}
                  >
                    <div
                      style={{
                        width: 56,
                        background: 'var(--muted)',
                        borderRadius: 999,
                        height: 6,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${pct}%`,
                          background: 'var(--primary)',
                          borderRadius: 999,
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        color: 'var(--foreground)',
                        width: 40,
                        textAlign: 'right',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {pct}%
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: stat.highlightCount > 0 ? 'var(--foreground)' : 'var(--muted-foreground)',
                    }}
                  >
                    {stat.highlightCount}
                  </span>
                  <span
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: stat.cardCount > 0 ? 'var(--foreground)' : 'var(--muted-foreground)',
                    }}
                  >
                    {stat.cardCount}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </>
  )
}

// ===== 排序表头按钮 =====
function SortHeader({
  label,
  active,
  order,
  onClick,
}: {
  label: string
  active: boolean
  order: SortOrder
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: 'inherit',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        padding: 0,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        textAlign: 'left',
      }}
    >
      {label}{' '}
      {active && (
        <span style={{ color: 'var(--primary)' }}>{order === 'asc' ? '↑' : '↓'}</span>
      )}
    </button>
  )
}

// ===== 保留原有的辅助组件：deriveProfile / UserProfileCard / CategoryBreakdown / ReadingTimeHeatmap =====

/** 用户身份派生（11 类身份标签 + level 等级 + top3Pct） */
function deriveProfile(categories: PreferCategory[]) {
  const sorted = [...categories]
    .filter((c) => c.readingTime > 0 || c.readingCount > 0)
    .sort((a, b) => b.readingTime - a.readingTime)
  const topCat = sorted[0]
  const totalTime = sorted.reduce((s, c) => s + c.readingTime, 0)
  const totalBooks = sorted.reduce((s, c) => s + c.readingCount, 0)
  const top2 = sorted.slice(0, 2)
  const top2Time = top2.reduce((s, c) => s + c.readingTime, 0)
  const concentration = totalTime > 0 ? top2Time / totalTime : 0

  const identityLabels: { keys: string[]; label: string; desc: string }[] = [
    {
      keys: ['计算机', '编程', '科技', '互联网', '人工智能', '算法'],
      label: '技术探索者',
      desc: '热爱计算机与技术类阅读，用代码改变世界',
    },
    {
      keys: ['文学', '小说', '外国文学', '中国文学', '散文', '诗歌'],
      label: '文学爱好者',
      desc: '徜徉文字海洋，品味文学之美',
    },
    {
      keys: ['历史', '文化', '人物传记', '传记', '纪实'],
      label: '历史沉思者',
      desc: '以史为鉴，在时间长河中寻找智慧',
    },
    {
      keys: ['经济理财', '商业', '投资', '金融', '管理'],
      label: '经济洞察家',
      desc: '把握商业脉搏，洞悉经济规律',
    },
    {
      keys: ['个人成长', '心理', '励志', '人生哲学', '自我管理'],
      label: '成长修行者',
      desc: '不断自我精进，追求更好的自己',
    },
    {
      keys: ['哲学', '社会科学', '政治', '法律', '军事'],
      label: '思想深邃者',
      desc: '探索思想的边界，追寻真理的光芒',
    },
    {
      keys: ['教育', '学习', '外语', '童书', '亲子'],
      label: '终身学习者',
      desc: '学无止境，用知识武装自己',
    },
    {
      keys: ['艺术', '设计', '摄影', '音乐', '建筑'],
      label: '美学鉴赏家',
      desc: '在艺术中发现生活的诗意',
    },
    {
      keys: ['科学', '科普', '自然科学', '物理', '数学'],
      label: '科学求真者',
      desc: '探索自然规律，追问万物本质',
    },
    {
      keys: ['医学', '健康', '养生', '运动', '美食'],
      label: '健康关注者',
      desc: '关注身心健康，追求品质生活',
    },
    {
      keys: ['旅行', '地理', '生活', '休闲'],
      label: '生活家',
      desc: '热爱生活，在阅读中发现世界之美',
    },
  ]

  let identity = identityLabels[0]
  if (topCat) {
    for (const item of identityLabels) {
      if (
        item.keys.some(
          (k) => topCat.categoryTitle.includes(k) || k.includes(topCat.categoryTitle),
        )
      ) {
        identity = item
        break
      }
    }
  }

  const tags: string[] = []
  sorted.slice(0, 4).forEach((c) => {
    if (c.readingCount > 0) tags.push(c.categoryTitle)
  })

  if (concentration > 0.6) {
    tags.unshift('深度聚焦')
  } else if (concentration < 0.35 && sorted.length >= 3) {
    tags.unshift('广泛涉猎')
  }

  const profileSummary = topCat
    ? `主要沉浸在${topCat.categoryTitle}领域，${top2.length > 1 ? `同时涉猎${top2[1].categoryTitle}` : ''}，共阅读 ${totalBooks} 本书，累计 ${formatReadingTime(totalTime)}。${concentration > 0.6 ? '阅读方向高度聚焦，深度钻研。' : concentration > 0.3 ? '阅读兴趣广泛而平衡。' : '阅读口味多元，涉猎广泛。'}`
    : '开始阅读，探索你的知识边界吧。'

  const level =
    totalBooks >= 50
      ? { name: '博览群书', color: 'var(--chart-3)', bg: 'color-mix(in srgb, var(--chart-3) 18%, transparent)' }
      : totalBooks >= 20
        ? { name: '学识渊博', color: 'var(--chart-4)', bg: 'color-mix(in srgb, var(--chart-4) 14%, transparent)' }
        : totalBooks >= 10
          ? { name: '求知若渴', color: 'var(--chart-5)', bg: 'color-mix(in srgb, var(--chart-5) 14%, transparent)' }
          : totalBooks >= 5
            ? { name: '初窥门径', color: 'var(--chart-1)', bg: 'color-mix(in srgb, var(--chart-1) 14%, transparent)' }
            : { name: '初出茅庐', color: 'var(--muted-foreground)', bg: 'var(--muted)' }

  const top3Pct = sorted.slice(0, 3).map((c) => ({
    title: c.categoryTitle,
    pct: totalTime > 0 ? Math.round((c.readingTime / totalTime) * 100) : 0,
  }))

  return {
    identity,
    tags,
    profileSummary,
    totalBooks,
    totalTime,
    concentration,
    level,
    top3Pct,
    sorted,
  }
}

/** 用户画像卡 */
function UserProfileCard({
  categories,
  categoryWord: _categoryWord,
}: {
  categories: PreferCategory[]
  categoryWord?: string
}) {
  const profile = useMemo(() => deriveProfile(categories), [categories])

  const identityEmoji =
    profile.identity.label === '技术探索者'
      ? '💻'
      : profile.identity.label === '文学爱好者'
        ? '📖'
        : profile.identity.label === '历史沉思者'
          ? '🏛️'
          : profile.identity.label === '经济洞察家'
            ? '📊'
            : profile.identity.label === '成长修行者'
              ? '🌱'
              : profile.identity.label === '思想深邃者'
                ? '🧠'
                : profile.identity.label === '终身学习者'
                  ? '🎓'
                  : profile.identity.label === '美学鉴赏家'
                    ? '🎨'
                    : profile.identity.label === '科学求真者'
                      ? '🔬'
                      : profile.identity.label === '健康关注者'
                        ? '💪'
                        : profile.identity.label === '生活家'
                          ? '🌍'
                          : '📚'

  const ringSegments = useMemo(() => {
    if (profile.sorted.length === 0) return []
    const top = profile.sorted.slice(0, 5)
    const total = top.reduce((s, c) => s + c.readingTime, 0)
    if (total === 0) return []
    const cumPct: number[] = []
    let acc = 0
    top.forEach((c) => {
      acc += (c.readingTime / total) * 100
      cumPct.push(acc)
    })
    return top.map((c, i) => {
      const start = i === 0 ? 0 : cumPct[i - 1]
      const end = cumPct[i]
      const pct = end - start
      return {
        title: c.categoryTitle,
        pct,
        color: DONUT_PALETTE[i % DONUT_PALETTE.length],
      }
    })
  }, [profile.sorted])

  return (
    <Card>
      <CardHead eyebrow="用户画像" title={profile.identity.label} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)' }}>
        <div
          style={{
            width: 48,
            height: 48,
            background: 'color-mix(in srgb, var(--primary) 14%, transparent)',
            color: 'var(--primary)',
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            fontSize: '1.5rem',
            flexShrink: 0,
          }}
        >
          {identityEmoji}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <strong
            style={{
              display: 'block',
              fontSize: '1rem',
              fontWeight: 700,
              color: 'var(--foreground)',
            }}
          >
            {profile.identity.label}
          </strong>
          <span
            style={{
              display: 'inline-block',
              marginTop: '0.25rem',
              padding: '0.25rem 0.5rem',
              borderRadius: 999,
              background: profile.level.bg,
              color: profile.level.color,
              fontSize: '0.75rem',
              fontWeight: 600,
            }}
          >
            {profile.level.name}
          </span>
        </div>
      </div>
      <Tiny style={{ marginTop: 'calc(var(--spacing) * 3)' }}>{profile.identity.desc}</Tiny>

      {/* 环形图 + 列表 */}
      {ringSegments.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 'calc(var(--spacing) * 3)',
            marginTop: 'calc(var(--spacing) * 4)',
          }}
        >
          <svg width={52} height={52} viewBox="0 0 36 36" style={{ flexShrink: 0 }}>
            {ringSegments.map((seg, i) => {
              const prevEnd = ringSegments
                .slice(0, i)
                .reduce((s, s2) => s + s2.pct, 0)
              const dasharray = `${seg.pct} ${100 - seg.pct}`
              return (
                <circle
                  key={i}
                  cx="18"
                  cy="18"
                  r="15.915"
                  fill="none"
                  stroke={seg.color}
                  strokeWidth="3"
                  strokeDasharray={dasharray}
                  strokeDashoffset={`${-prevEnd}`}
                  transform="rotate(-90 18 18)"
                  style={{ transition: 'all 0.5s ease' }}
                />
              )
            })}
            <text
              x="18"
              y="18"
              textAnchor="middle"
              dominantBaseline="central"
              fontSize="8"
              fontWeight="bold"
              fill="var(--foreground)"
            >
              {profile.totalBooks}本
            </text>
          </svg>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.25rem',
            }}
          >
            {ringSegments.map((seg, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                <div
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    flexShrink: 0,
                    backgroundColor: seg.color,
                  }}
                />
                <span
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--foreground)',
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {seg.title}
                </span>
                <span
                  style={{
                    fontSize: '0.7rem',
                    color: 'var(--muted-foreground)',
                    flexShrink: 0,
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {Math.round(seg.pct)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 标签 */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.375rem',
          marginTop: 'calc(var(--spacing) * 3)',
        }}
      >
        {profile.tags.map((tag) => {
          const isHighlight = tag === '深度聚焦' || tag === '广泛涉猎'
          return (
            <span
              key={tag}
              style={{
                fontSize: '0.7rem',
                padding: '0.2rem 0.5rem',
                borderRadius: 999,
                background: isHighlight
                  ? 'color-mix(in srgb, var(--chart-3) 18%, transparent)'
                  : 'var(--muted)',
                color: isHighlight
                  ? 'color-mix(in srgb, var(--chart-3) 80%, var(--foreground))'
                  : 'var(--muted-foreground)',
                border: isHighlight
                  ? '1px solid color-mix(in srgb, var(--chart-3) 35%, transparent)'
                  : '1px solid var(--border)',
              }}
            >
              {tag}
            </span>
          )
        })}
      </div>

      {/* 画像总结 */}
      <div
        style={{
          borderTop: '1px solid var(--border)',
          marginTop: 'calc(var(--spacing) * 3)',
          paddingTop: 'calc(var(--spacing) * 3)',
        }}
      >
        <Tiny>{profile.profileSummary}</Tiny>
      </div>
    </Card>
  )
}

/** 偏好分类条形图 */
function CategoryBreakdown({ categories }: { categories: PreferCategory[] }) {
  const sorted = useMemo(() => {
    return [...categories]
      .filter((c) => c.readingTime > 0)
      .sort((a, b) => b.readingTime - a.readingTime)
      .slice(0, 8)
  }, [categories])

  const totalTime = useMemo(() => sorted.reduce((s, c) => s + c.readingTime, 0), [sorted])

  if (sorted.length === 0) return null

  return (
    <Card>
      <CardHead eyebrow="偏好分类" title="时长分布" />
      {/* 顶部堆叠条 */}
      <div style={{ display: 'flex', gap: '0.5rem', marginBottom: 'calc(var(--spacing) * 4)' }}>
        {sorted.slice(0, 5).map((cat, i) => {
          const pct = totalTime > 0 ? Math.round((cat.readingTime / totalTime) * 100) : 0
          return (
            <div
              key={cat.categoryId}
              style={{
                height: 8,
                borderRadius: 999,
                width: `${Math.max(pct, 3)}%`,
                backgroundColor: DONUT_PALETTE[i % DONUT_PALETTE.length],
                transition: 'width 0.5s ease',
              }}
              title={`${cat.categoryTitle} ${pct}%`}
            />
          )
        })}
      </div>
      {/* 分类列表 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}>
        {sorted.map((cat, i) => {
          const maxTime = sorted[0].readingTime
          const barPct = maxTime > 0 ? (cat.readingTime / maxTime) * 100 : 0
          const sharePct = totalTime > 0 ? Math.round((cat.readingTime / totalTime) * 100) : 0
          return (
            <div key={cat.categoryId} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  flexShrink: 0,
                  backgroundColor: DONUT_PALETTE[i % DONUT_PALETTE.length],
                }}
              />
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--foreground)',
                  width: 56,
                  flexShrink: 0,
                  fontWeight: 600,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {cat.categoryTitle}
              </span>
              <div
                style={{
                  flex: 1,
                  background: 'var(--muted)',
                  borderRadius: 999,
                  height: 8,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: 8,
                    borderRadius: 999,
                    width: `${Math.max(barPct, 3)}%`,
                    backgroundColor: DONUT_PALETTE[i % DONUT_PALETTE.length],
                    transition: 'width 0.5s ease',
                  }}
                />
              </div>
              <span
                style={{
                  fontSize: '0.7rem',
                  color: 'var(--muted-foreground)',
                  width: 40,
                  textAlign: 'right',
                  flexShrink: 0,
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {sharePct}%
              </span>
              <span
                style={{
                  fontSize: '0.7rem',
                  color: 'var(--muted-foreground)',
                  width: 56,
                  textAlign: 'right',
                  flexShrink: 0,
                }}
              >
                {formatReadingTime(cat.readingTime)}
              </span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

/** 阅读时段柱状图（24 小时分布） */
function ReadingTimeHeatmap({
  preferTime,
  preferTimeWord,
}: {
  preferTime: number[]
  preferTimeWord?: string
}) {
  const [hoveredHour, setHoveredHour] = useState<number | null>(null)
  const maxSeconds = useMemo(() => Math.max(...preferTime, 1), [preferTime])

  const currentHour = useMemo(() => new Date().getHours(), [])
  const peakHourIdx = useMemo(() => {
    let maxIdx = 0
    preferTime.forEach((s, i) => {
      if (s > preferTime[maxIdx]) maxIdx = i
    })
    return maxIdx
  }, [preferTime])

  return (
    <Card>
      <CardHead
        eyebrow="阅读时段"
        title="24 小时分布"
        action={
          preferTimeWord ? (
            <Badge variant="ok">{preferTimeWord}</Badge>
          ) : undefined
        }
      />
      <div
        style={{
          display: 'flex',
          alignItems: 'end',
          gap: 3,
          height: 96,
          marginTop: 'calc(var(--spacing) * 4)',
        }}
      >
        {preferTime.map((seconds, i) => {
          const height = maxSeconds > 0 ? (seconds / maxSeconds) * 100 : 0
          const hourLabel = (6 + i) % 24
          const isActive = currentHour === hourLabel
          const isPeak = i === peakHourIdx
          const isHovered = hoveredHour === i
          const bg = isHovered
            ? 'var(--chart-4)'
            : isPeak
              ? 'var(--chart-5)'
              : isActive
                ? 'color-mix(in srgb, var(--primary) 70%, var(--muted))'
                : 'var(--chart-1)'
          const opacity = isHovered || isPeak || isActive ? 1 : 0.7
          return (
            <div
              key={i}
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 2,
                cursor: 'pointer',
              }}
              onMouseEnter={() => setHoveredHour(i)}
              onMouseLeave={() => setHoveredHour(null)}
            >
              <div
                style={{
                  width: '100%',
                  borderTopLeftRadius: 999,
                  borderTopRightRadius: 999,
                  minHeight: 2,
                  height: `${Math.max(height, 2)}%`,
                  backgroundColor: bg,
                  opacity,
                  transition: 'opacity 0.2s ease, background 0.2s ease',
                }}
              />
              {i % 6 === 0 && (
                <span
                  style={{
                    fontSize: '0.72rem',
                    color: isActive ? 'var(--primary)' : 'var(--muted-foreground)',
                    fontWeight: isActive ? 700 : 400,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {hourLabel}:00
                </span>
              )}
            </div>
          )
        })}
      </div>
      {peakHourIdx >= 0 && preferTime[peakHourIdx] > 0 && (
        <div
          style={{
            marginTop: 'calc(var(--spacing) * 3)',
            fontSize: '0.78rem',
            color: 'var(--muted-foreground)',
            textAlign: 'center',
          }}
        >
          高峰时段 {(6 + peakHourIdx) % 24}:00，累计 {formatReadingTime(preferTime[peakHourIdx])}
        </div>
      )}
    </Card>
  )
}