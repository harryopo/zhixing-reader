/** 阅读统计视图（从 Stats.tsx 原样搬出，逻辑未改） */
import { useMemo } from 'react'
import Card, { CardHead } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { EmptyState, Metric, Trend } from '@/components/ui/Feedback'
import { formatReadingTime } from '../../stores/readingDataStore'
import type { ReadingMode, ReadingDataResponse } from '../../../../shared/types'
import { STATS_DATE_RANGES, STATS_RANGE_DAYS, type BookStat, type StatsDateRange } from './constants'
import { CategoryDonut, ReadingTrendBars, ReviewHeatmap12Weeks, WeeklyBars, WeeklyTrendMini } from './charts'
import { YearlyBookTable } from './YearlyBookTable'
import { ReadingDataDetails } from './ReadingDataDetails'

export function ReadingStatsView({
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
  heatmapDaily,
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
  heatmapDaily: Record<string, number>
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

  // 年度书单：以 is_finished 或进度 100% 判定已读完，并按 updatedAt 近似完成时间过滤当年
  const yearFinishedBookStats = useMemo(() => {
    const currentYear = new Date().getFullYear()
    const startTime = new Date(currentYear, 0, 1).getTime()
    const endTime = new Date(currentYear + 1, 0, 1).getTime() - 1
    return bookStats
      .filter((b) => {
        const normalized = b.progress > 1 ? b.progress : b.progress * 100
        const finished = b.isFinished || normalized >= 100
        if (!finished) return false
        if (!b.updatedAt) return false
        const t = new Date(b.updatedAt).getTime()
        if (isNaN(t)) return false
        if (t < startTime || t > endTime) return false
        return true
      })
      .sort((a, b) => {
        const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
        const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
        return tb - ta
      })
  }, [bookStats])

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
        <Card>
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

        <Card>
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

        <Card>
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

        <Card>
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
            title={`近 ${readingMode === 'annually' ? '12 月' : '7 日'} 时长`}
            action={<Badge variant="ok">{readingMode === 'annually' ? '每月' : '每日'}</Badge>}
          />
          <ReadingTrendBars
            readTimes={readingData?.readTimes || readingData?.dailyReadTimes}
            mode={readingMode}
            loading={readingLoading}
          />
          <WeeklyTrendMini data={dailyRangeData} loading={rangeLoading} />
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
          <ReviewHeatmap12Weeks dailyCards={heatmapDaily} />
        </Card>

        <Card>
          <CardHead
            eyebrow="阅读节奏"
            title="时段分布"
            action={<Badge variant="ok">24 小时</Badge>}
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
            <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 1)', flexWrap: 'wrap', alignItems: 'center' }}>
              {/* 说清楚这排只管下面这张表，不然和顶部时段 chip 打架 */}
              <span style={{ fontSize: '0.72rem', color: 'var(--muted-foreground)', marginRight: 4 }}>
                本表范围
              </span>
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
        <YearlyBookTable bookStats={yearFinishedBookStats} />
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
