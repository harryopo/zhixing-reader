/** 统计页的图表组件（从 Stats.tsx 原样搬出，逻辑未改） */
import { useMemo } from 'react'
import Icon from '@/components/ui/Icon'
import { Tiny } from '@/components/ui/Feedback'
import { safeNum, safeStr } from '../../utils/db-mapper'
import { formatReadingTime } from '../../stores/readingDataStore'
import type { ReadingMode, PreferCategory } from '../../../../shared/types'
import { buildReadingTrendPoints, recentDayKeys, READING_TREND_SPECS } from '../../../../shared/reading-trend'
import { DONUT_PALETTE, WEEKDAY_LABELS } from './constants'

// ===== 阅读趋势柱状图（分桶与标签来自 src/shared/reading-trend.ts 的同一份口径）=====
export function ReadingTrendBars({
  readTimes,
  mode,
  loading,
}: {
  readTimes?: Record<string, number>
  mode: ReadingMode
  loading: boolean
}) {
  const spec = READING_TREND_SPECS[mode] ?? READING_TREND_SPECS.monthly

  const displayPoints = useMemo(
    () => buildReadingTrendPoints(readTimes, mode),
    [readTimes, mode],
  )

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
        aria-label={`${spec.trendTitle}（${displayPoints.length} 根柱子）`}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${displayPoints.length}, 1fr)`,
          alignItems: 'end',
          gap: 'calc(var(--spacing) * 3)',
          height: 220,
          marginTop: 'calc(var(--spacing) * 4)',
        }}
      >
        {displayPoints.map((p, i) => {
          const heightPct = displayMax > 0 ? (p.seconds / displayMax) * 100 : 0
          const isMax = p.seconds === displayMax && p.seconds > 0
          const minutes = Math.round(p.seconds / 60)
          const label = p.label
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
                  maxWidth: 10,
                  borderRadius: '999px 999px 8px 8px',
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

// ===== 一周趋势 mini 柱状图（基于 dailyRangeData 最近 7 天） =====
export function WeeklyTrendMini({
  data,
  loading,
}: {
  data: unknown[]
  loading: boolean
}) {
  const points = useMemo(() => {
    const rows = (data || []).map((row) => {
      const r = (row ?? {}) as Record<string, unknown>
      const date = safeStr(r.date)
      const seconds = safeNum(r.reading_time ?? r.readingTime)
      return { date, seconds, minutes: Math.round(seconds / 60) }
    })
    return rows
      .filter((p) => p.date)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(-7)
  }, [data])

  const maxVal = useMemo(() => Math.max(...points.map((p) => p.minutes), 1), [points])

  if (loading) {
    return (
      <div style={{ marginTop: 'calc(var(--spacing) * 5)', padding: 'calc(var(--spacing) * 4) 0' }}>
        <span style={{ color: 'var(--muted-foreground)', fontSize: '0.85rem' }}>加载一周趋势...</span>
      </div>
    )
  }

  if (points.length === 0) {
    return (
      <div style={{ marginTop: 'calc(var(--spacing) * 5)', padding: 'calc(var(--spacing) * 2) 0' }}>
        <Tiny>暂无一周趋势数据</Tiny>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 'calc(var(--spacing) * 5)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'calc(var(--spacing) * 3)',
        }}
      >
        <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--foreground)' }}>
          一周趋势
        </span>
        <span style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)' }}>
          近 7 天阅读时长（分钟）
        </span>
      </div>
      <div
        role="img"
        aria-label="最近 7 天阅读时长 mini 柱状图"
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${points.length}, 1fr)`,
          alignItems: 'end',
          gap: 'calc(var(--spacing) * 2.5)',
          height: 96,
        }}
      >
        {points.map((p) => {
          const heightPct = maxVal > 0 ? (p.minutes / maxVal) * 100 : 0
          const isMax = p.minutes === maxVal && p.minutes > 0
          const d = new Date(p.date)
          const label = `${d.getMonth() + 1}/${d.getDate()}`
          const weekday = WEEKDAY_LABELS[(d.getDay() + 6) % 7]
          return (
            <div
              key={p.date}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'flex-end',
                height: '100%',
                gap: 'calc(var(--spacing) * 1.5)',
              }}
            >
              <div
                title={`${label} ${weekday}: ${p.minutes} 分钟`}
                style={{
                  width: '100%',
                  maxWidth: 10,
                  borderRadius: '999px 999px 6px 6px',
                  background: isMax ? 'var(--chart-5)' : 'var(--chart-1)',
                  height: `${Math.max(heightPct, 4)}%`,
                  minHeight: 4,
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
              <span
                style={{
                  fontSize: '0.7rem',
                  color: 'var(--muted-foreground)',
                  whiteSpace: 'nowrap',
                }}
              >
                {weekday}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ===== 书籍分布甜甜圈（conic-gradient） =====
export function CategoryDonut({
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

// ===== 复习热力 12 周网格（设计稿 12×7 color-mix chart-1；真实数据：每日 FSRS 评分次数） =====
export function ReviewHeatmap12Weeks({ dailyCards }: { dailyCards: Record<string, number> }) {
  // 12 周 × 7 天 = 84 格，格子与取数窗口共用 recentDayKeys（本地日期，不按 UTC 切）
  const cells = useMemo(() => {
    return recentDayKeys(new Date()).map((dateStr) => ({ date: dateStr, count: dailyCards[dateStr] ?? 0 }))
  }, [dailyCards])

  const maxVal = useMemo(() => Math.max(...cells.map((c) => c.count), 1), [cells])

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
        {cells.map((cell, i) => (
          <div
            key={i}
            title={`${cell.date} · 复习 ${cell.count} 次`}
            style={{
              width: '100%',
              aspectRatio: '1 / 1',
              borderRadius: 3,
              backgroundColor: getColor(cell.count),
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

// ===== 阅读时段分布柱状图（数据来源为微信读书 24 小时时段分布） =====
export function HourlyBars({
  preferTime,
  preferTimeWord,
}: {
  preferTime?: number[]
  preferTimeWord?: string
}) {
  const bars = useMemo(() => {
    if (!preferTime || preferTime.length === 0) {
      return Array(24).fill(0) as number[]
    }
    return preferTime
  }, [preferTime])

  const maxVal = useMemo(() => Math.max(...bars, 1), [bars])

  return (
    <>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${bars.length}, 1fr)`,
          alignItems: 'end',
          gap: 'calc(var(--spacing) * 1)',
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
                title={`${i}:00 · ${formatReadingTime(val)}`}
                style={{
                  width: '100%',
                  maxWidth: 14,
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
                {i % 4 === 0 ? `${i}时` : ''}
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
