/**
 * Home — 首页（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/home.html
 * 4 KPI + 阅读趋势柱状图 + 复习队列 + 最近阅读表格
 * 所有数据通过 IPC 真实加载
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Card, { CardHead } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { Loading, Metric, Trend, Muted, Tiny, EmptyState } from '@/components/ui/Feedback'
import { mapBooks, mapCards, safeNum, formatTimeAgo } from '../utils/db-mapper'

interface BookRow {
  id: string
  title: string
  author: string
  cover: string
  progress: number
  lastReadAt: string
  isFinished?: number
}

interface CardRow {
  id: string
  bookId: string
  nextReviewAt: string
  lastReviewAt: string
  reviewCount: number
}

interface DailyStats {
  date: string
  readingTimeSeconds: number
  booksRead: number
  highlightsCreated: number
  cardsCreated: number
}

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

/** 计算近 7 天阅读时长（秒 → 像素高度，最大 180px） */
function buildBarData(stats: DailyStats[]): { day: string; minutes: number; heightPx: number }[] {
  const today = new Date()
  // 取本周一为起点（与设计稿一致：周一首列）
  const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1
  const monday = new Date(today)
  monday.setDate(today.getDate() - dayOfWeek)

  const result: { day: string; minutes: number; heightPx: number }[] = []
  const maxMinutes = 96 // 设计稿最大值（周四 96 分钟 → 180px）

  for (let i = 0; i < 7; i++) {
    const date = new Date(monday)
    date.setDate(monday.getDate() + i)
    const dateStr = date.toISOString().split('T')[0]
    const stat = stats.find((s) => s.date === dateStr)
    const minutes = stat ? Math.floor((stat.readingTimeSeconds || 0) / 60) : 0
    const heightPx = Math.max(20, Math.min(180, (minutes / maxMinutes) * 180))
    result.push({ day: WEEKDAY_LABELS[i], minutes, heightPx })
  }
  return result
}

/** 估算逾期天数（nextReviewAt 早于今天） */
function overdueDays(nextReviewAt: string): number {
  if (!nextReviewAt) return 0
  const due = new Date(nextReviewAt)
  const today = new Date()
  due.setHours(0, 0, 0, 0)
  today.setHours(0, 0, 0, 0)
  return Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86400000))
}

/** 计算连续打卡天数（基于 daily_stats，从今天往前数连续有数据的天数） */
function calcStreak(stats: DailyStats[]): number {
  if (!stats.length) return 0
  const sorted = [...stats].sort((a, b) => b.date.localeCompare(a.date))
  const today = new Date().toISOString().split('T')[0]
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]

  // 今天没数据时从昨天开始算；今天有则从今天开始
  let streak = 0
  let cursor = sorted[0]
  if (cursor.date === today) {
    streak = 1
  } else if (cursor.date === yesterday) {
    streak = 1
  } else {
    return 0
  }

  for (let i = 1; i < sorted.length; i++) {
    const prev = new Date(cursor.date)
    prev.setDate(prev.getDate() - 1)
    const prevStr = prev.toISOString().split('T')[0]
    if (sorted[i].date === prevStr) {
      streak++
      cursor = sorted[i]
    } else {
      break
    }
  }
  return streak
}

/** 格式化阅读时长（分钟 → "1h 24m" / "23m"） */
function formatDuration(seconds: number): string {
  if (!seconds) return '0m'
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${m}m`
}

export default function Home() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [books, setBooks] = useState<BookRow[]>([])
  const [dueCards, setDueCards] = useState<CardRow[]>([])
  const [weeklyStats, setWeeklyStats] = useState<DailyStats[]>([])
  const [todayStats, setTodayStats] = useState<DailyStats | null>(null)

  useEffect(() => {
    const loadData = async () => {
      if (!window.electronAPI?.book || !window.electronAPI?.card) {
        setLoading(false)
        return
      }
      try {
        const [booksRaw, cardsRaw] = await Promise.all([
          window.electronAPI.book.getAll(),
          window.electronAPI.card.getDue(50),
        ])
        setBooks(mapBooks(booksRaw as unknown[]) as unknown as BookRow[])
        setDueCards(mapCards(cardsRaw as unknown[]) as unknown as CardRow[])

        // 今日 + 本周统计
        if (window.electronAPI?.stats) {
          try {
            const today = await window.electronAPI.stats.getToday()
            setTodayStats(today as unknown as DailyStats)
            // 近 7 天：从本周一算起
            const todayDate = new Date()
            const dayOfWeek = todayDate.getDay() === 0 ? 6 : todayDate.getDay() - 1
            const monday = new Date(todayDate)
            monday.setDate(todayDate.getDate() - dayOfWeek)
            const mondayStr = monday.toISOString().split('T')[0]
            const range = await window.electronAPI.stats.getRange(mondayStr, todayDate.toISOString().split('T')[0])
            setWeeklyStats(range as unknown as DailyStats[])
          } catch (err) {
            console.warn('加载统计数据失败（非致命）:', err)
          }
        }
      } catch (error) {
        console.error('加载首页数据失败:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  const barData = useMemo(() => buildBarData(weeklyStats), [weeklyStats])
  const streak = useMemo(() => calcStreak(weeklyStats), [weeklyStats])
  const maxBarMinutes = Math.max(...barData.map((b) => b.minutes), 1)

  const recentBooks = useMemo(() => {
    return [...books]
      .sort((a, b) => {
        const ta = a.lastReadAt ? new Date(a.lastReadAt).getTime() : 0
        const tb = b.lastReadAt ? new Date(b.lastReadAt).getTime() : 0
        return tb - ta
      })
      .slice(0, 4)
  }, [books])

  const overdueCount = useMemo(
    () => dueCards.filter((c) => overdueDays(c.nextReviewAt) > 0).length,
    [dueCards],
  )

  const todayReadingSeconds = todayStats?.readingTimeSeconds || 0
  const yesterdaySeconds = useMemo(() => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0]
    const s = weeklyStats.find((x) => x.date === yesterday)
    return s?.readingTimeSeconds || 0
  }, [weeklyStats])
  const todayTrendPct =
    yesterdaySeconds > 0
      ? Math.round(((todayReadingSeconds - yesterdaySeconds) / yesterdaySeconds) * 100)
      : 0

  if (loading) {
    return <Loading hint="正在加载今日阅读数据..." />
  }

  return (
    <>
      <PageHero
        title="今日阅读"
        subtitle="一屏掌握阅读进度、待办复习与增长趋势"
        actions={
          <>
            <Button variant="primary" onClick={() => navigate('/bookshelf')} data-dom-id="cta-start-reading">
              <Icon name="bookshelf" size={16} /> 开始今日阅读
            </Button>
            <Button variant="secondary" onClick={() => navigate('/settings/weread')} data-dom-id="cta-sync-weread">
              <Icon name="refresh" size={16} /> 同步微信读书
            </Button>
          </>
        }
      >
        {/* ===== Layer 1: 4-up KPI cards ===== */}
        <div
          className="grid stats"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gap: 'calc(var(--spacing) * 4)',
          }}
        >
          <Card interactive>
            <div style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              今日阅读时长
            </div>
            <Metric value={formatDuration(todayReadingSeconds)} />
            <Trend kind={todayTrendPct >= 0 ? 'up' : 'down'}>
              {todayTrendPct >= 0 ? '↑' : '↓'} 较昨日 {todayTrendPct >= 0 ? '+' : ''}{todayTrendPct}%
            </Trend>
          </Card>

          <Card interactive onClick={() => navigate('/review')}>
            <div style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              待复习卡片
            </div>
            <Metric value={dueCards.length} />
            <Trend kind={overdueCount > 0 ? 'warning' : 'default'}>
              {overdueCount > 0 ? `其中 ${overdueCount} 张逾期` : '今日全部到期'}
            </Trend>
          </Card>

          <Card interactive onClick={() => navigate('/bookshelf')}>
            <div style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              本周新书
            </div>
            <Metric value={weeklyStats.reduce((acc, s) => acc + (s.booksRead || 0), 0)} />
            <Trend kind="up">↑ 累计 {books.length} 本</Trend>
          </Card>

          <Card interactive>
            <div style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              连续打卡
            </div>
            <Metric value={`${streak} 天`} />
            <Trend kind={streak > 0 ? 'up' : 'default'}>{streak > 0 ? '↑ 坚持中' : '今日未打卡'}</Trend>
          </Card>
        </div>

        {/* ===== Layer 2: trend chart + review queue ===== */}
        <div
          className="grid panels"
          style={{
            display: 'grid',
            gridTemplateColumns: '1.7fr 1fr',
            gap: 'calc(var(--spacing) * 4)',
          }}
        >
          {/* 阅读趋势柱状图 */}
          <Card>
            <CardHead
              eyebrow="阅读趋势"
              title="近 7 日时长"
              action={<Badge variant="ok">本周视图</Badge>}
            />
            <div
              role="img"
              aria-label={`近7日每日阅读时长柱状图，最高 ${maxBarMinutes} 分钟`}
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(7, 1fr)',
                alignItems: 'end',
                gap: 'calc(var(--spacing) * 3)',
                height: 220,
                marginTop: 'calc(var(--spacing) * 4)',
              }}
            >
              {barData.map((b, i) => {
                const isMax = b.minutes === maxBarMinutes && b.minutes > 0
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
                      title={`${b.day}: ${b.minutes} 分钟`}
                      style={{
                        width: '100%',
                        maxWidth: 38,
                        borderRadius: '999px 999px 10px 10px',
                        background: isMax ? 'var(--chart-5)' : 'var(--chart-1)',
                        minHeight: 20,
                        height: b.heightPx,
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
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {b.day}
                    </div>
                  </div>
                )
              })}
            </div>
          </Card>

          {/* 复习队列 */}
          <Card>
            <CardHead
              eyebrow="今日待办"
              title="复习队列"
              action={<Badge>{dueCards.length} 张</Badge>}
            />
            {dueCards.length === 0 ? (
              <EmptyState
                icon={<Icon name="check" size={24} />}
                title="今日复习已完成"
                description="所有到期卡片均已复习，明日再来。"
              />
            ) : (
              <>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
                  {dueCards.slice(0, 4).map((card) => {
                    const book = books.find((b) => b.id === card.bookId)
                    const overdue = overdueDays(card.nextReviewAt)
                    return (
                      <div
                        key={card.id}
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          gap: 'calc(var(--spacing) * 3)',
                          padding: 'calc(var(--spacing) * 3.5) 0',
                          borderTop: '1px solid var(--border)',
                        }}
                      >
                        <div style={{ minWidth: 0 }}>
                          <strong
                            style={{
                              display: 'block',
                              fontSize: '0.92rem',
                              fontWeight: 600,
                              color: 'var(--foreground)',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                          >
                            {book?.title || '未关联书籍'}
                          </strong>
                          <Tiny>已复习 {card.reviewCount} 次 · {overdue > 0 ? `逾期 ${overdue} 天` : '今日到期'}</Tiny>
                        </div>
                        {overdue > 0 ? <Badge variant="alert">逾期 {overdue} 天</Badge> : <Badge variant="ok">今日</Badge>}
                      </div>
                    )
                  })}
                  {/* 移除第一个元素的顶边框 */}
                  <style>{`.list > div:first-child { border-top: none; padding-top: 0; }`}</style>
                </div>
                <div style={{ marginTop: 'calc(var(--spacing) * 4)', display: 'flex', justifyContent: 'flex-end' }}>
                  <Button variant="secondary" onClick={() => navigate('/review')} data-dom-id="cta-review-start">
                    开始复习
                  </Button>
                </div>
              </>
            )}
          </Card>
        </div>

        {/* ===== Layer 3: recent books table ===== */}
        <Card>
          <CardHead
            eyebrow="最近阅读"
            title="书籍进度"
            action={
              <Button variant="ghost" onClick={() => navigate('/bookshelf')} data-dom-id="cta-all-books">
                查看全部
              </Button>
            }
          />
          {recentBooks.length === 0 ? (
            <EmptyState
              icon={<Icon name="bookshelf" size={24} />}
              title="还没有同步书籍"
              description="前往设置页配置微信读书 API Key 后即可同步书架"
              action={<Button variant="primary" onClick={() => navigate('/settings/weread')}>立即配置</Button>}
            />
          ) : (
            <>
              {/* 表头 */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1.5fr 0.8fr 0.7fr 0.8fr',
                  gap: 'calc(var(--spacing) * 3)',
                  alignItems: 'center',
                  padding: '0 calc(var(--spacing) * 4) calc(var(--spacing) * 2)',
                  fontSize: '0.78rem',
                  color: 'var(--muted-foreground)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                }}
              >
                <span>书籍</span>
                <span>进度</span>
                <span>状态</span>
                <span>最近阅读</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
                {recentBooks.map((book) => {
                  const progressPct = Math.round(safeNum(book.progress) * 100)
                  const isFinished = book.isFinished === 1 || progressPct >= 100
                  return (
                    <button
                      key={book.id}
                      type="button"
                      onClick={() => navigate(`/bookshelf/${book.id}`)}
                      data-dom-id={`book-card-${book.id}`}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '1.5fr 0.8fr 0.7fr 0.8fr',
                        gap: 'calc(var(--spacing) * 3)',
                        alignItems: 'center',
                        background: 'var(--background)',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        padding: 'calc(var(--spacing) * 3.5) calc(var(--spacing) * 4)',
                        cursor: 'pointer',
                        transition: 'border-color 0.2s ease, transform 0.16s ease',
                        textAlign: 'left',
                        fontFamily: 'inherit',
                        fontSize: 'inherit',
                        color: 'inherit',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--ring)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border)'
                      }}
                      onMouseDown={(e) => {
                        e.currentTarget.style.transform = 'scale(0.99)'
                      }}
                      onMouseUp={(e) => {
                        e.currentTarget.style.transform = 'scale(1)'
                      }}
                    >
                      <span
                        style={{
                          minWidth: 0,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          fontWeight: 600,
                          color: 'var(--foreground)',
                        }}
                      >
                        《{book.title}》
                      </span>
                      <Muted>{progressPct}%</Muted>
                      {isFinished ? (
                        <Badge variant="ok">已读</Badge>
                      ) : progressPct > 0 ? (
                        <Badge variant="ok">在读</Badge>
                      ) : (
                        <Badge>未读</Badge>
                      )}
                      <Muted>{formatTimeAgo(book.lastReadAt)}</Muted>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </Card>
      </PageHero>
    </>
  )
}
