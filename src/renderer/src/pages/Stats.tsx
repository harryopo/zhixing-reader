/**
 * Stats — 统计页（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/stats.html
 *
 * 结构：
 *   - hero: 标题 + 副标题 + 3 chip 时段切换 + 导出报告按钮 + 同步按钮
 *   - 子 tab: 阅读统计 / 书籍统计
 *   - 阅读统计视图：
 *       Layer 1: 4 KPI 卡片网格（{时段}阅读 / 完成书籍 / 卡片总数 / 笔记总数）
 *       Layer 2: 1.7fr 1fr（阅读趋势柱状图 + 书籍分布甜甜圈）
 *       Layer 3: 1fr 1fr（复习热力 12 周网格 + 一天 24 小时的时段分布）
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
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { Loading } from '@/components/ui/Feedback'
import { toast } from '../stores/toastStore'
import { mapBooks, mapHighlights, mapCards } from '../utils/db-mapper'
import { useReadingDataStore, formatReadingTime } from '../stores/readingDataStore'
import { useSettingsStore } from '../stores/settingsStore'
import { ReadingMode } from '../../../shared/types'
import { syncBookshelfToDb, describeSyncResult } from '../utils/sync-bookshelf'
import { READING_TREND_SPECS, recentDayKeys } from '../../../shared/reading-trend'
import {
  PERIOD_CHIPS,
  formatExportTimestamp,
  getStatsRangeDates,
  type BookStat,
  type SortColumn,
  type SortOrder,
  type StatsDateRange,
  type TabKey,
} from './stats/constants'
import { ReadingStatsView } from './stats/ReadingStatsView'
import { BooksStatsView } from './stats/BooksStatsView'

// ===== 类型 =====

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

  // 微信读书配置状态：用独立 selector 避免整体订阅 store（Zustand v5 规范）。
  // 读的是「主进程有没有存着 key」—— 密钥原值从 2026-09-23 起不再下发到渲染层。
  const wereadApiKeySet = useSettingsStore((s) => s.wereadApiKeySet)
  const loadSettings = useSettingsStore((s) => s.loadSettings)
  const isWereadConfigured = wereadApiKeySet

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

      // 逐本书并行查询：串行版本每本书 2 次 IPC 依次等待，书多时首屏阻塞严重；
      // 并行后单本书查询失败仍不阻断整体加载
      const stats = await Promise.all(
        books.map(async (book) => {
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
          return {
            id: book.id,
            title: book.title,
            author: book.author,
            cover: book.cover,
            category: book.category || '其他',
            progress: book.progress,
            highlightCount,
            cardCount,
            lastReadAt: book.lastReadAt,
            updatedAt: book.updatedAt,
            publishDate: book.publishDate,
            isFinished: book.isFinished === 1,
          }
        })
      )

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

  // 挂载时加载设置，确保「微信读书配没配」同步到 store（Stats 不在设置页加载链路上）
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
      // 与顶栏 / 书架 / 设置-微信读书共用同一份同步实现。
      // 这一页原先自己写了一套，三处都是错的：按书名判重（同名两本互相覆盖）、
      // 把 /shelf/sync 根本不返回的 progress 当 0 写回（每次同步抹掉真实阅读进度）、
      // 把秒级的 lastReadTime 交给 new Date(...)（算出来是 1970 年）。
      const result = await syncBookshelfToDb({
        onItemError: (title, err) => console.error(`同步书籍失败: ${title}`, err),
      })

      const syncMsg = describeSyncResult(result)
      await loadData()
      toast.remove(syncToastId)
      if (syncMsg.tone === 'warning') toast.warning(syncMsg.text)
      else toast.success(syncMsg.text)
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

  /**
   * 阅读数据是否已经到达。
   *
   * daily_stats.reading_time 的真值来自微信读书，由主进程在取阅读数据时覆盖写入。
   * 本页的 KPI 与 7 天柱状图读的是本地表，所以必须等阅读数据先落地再拉区间，
   * 否则首次进入页面会显示刷新前的旧值（0）。
   */
  const hasReadingData = Boolean(readingData)

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
  }, [statsDateRange, hasReadingData])

  // 复习热力 12 周：拉取每日复习次数（daily_stats.cards_reviewed，由每次 FSRS 评分累加）
  const [heatmapDaily, setHeatmapDaily] = useState<Record<string, number>>({})
  useEffect(() => {
    if (!window.electronAPI?.stats) return
    let isCancelled = false
    const days = recentDayKeys(new Date())
    window.electronAPI.stats
      .getRange(days[0], days[days.length - 1])
      .then((rows) => {
        if (isCancelled) return
        const map: Record<string, number> = {}
        for (const row of rows ?? []) {
          const r = row as unknown as Record<string, unknown>
          const date = String(r.date ?? '')
          if (!date) continue
          map[date] = Number(r.cards_reviewed) || 0
        }
        setHeatmapDaily(map)
      })
      .catch(() => {
        // 非致命：热力图保持空态
      })
    return () => {
      isCancelled = true
    }
  }, [])

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

  // 时段名字与趋势图共用 READING_TREND_SPECS，避免 chip / KPI 卡 / 图标题三套说法
  const modeLabels: Record<ReadingMode, string> = {
    weekly: READING_TREND_SPECS.weekly.chipLabel,
    monthly: READING_TREND_SPECS.monthly.chipLabel,
    annually: READING_TREND_SPECS.annually.chipLabel,
    overall: READING_TREND_SPECS.overall.chipLabel,
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
                    // setMode 内部会触发 fetchReadingData(mode)；点当前已选中的那个时段
                    // 等于白跑一次网络请求（效果和右上角「刷新阅读数据」完全一样）—— 直接跳过。
                    if (!isActive) setMode(chip.key)
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
          heatmapDaily={heatmapDaily}
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
