/**
 * Home — 首页（重构版）
 *
 * 定位：行动入口，不做统计展示（统计信息全部收敛到「统计」模块）。
 * 结构：
 *   - Layer 1: 继续阅读（最近 3 本，封面 + 进度，点击直达书籍详情）
 *   - Layer 2: 最新划线/笔记（真实 highlights）+ 复习队列（今日到期卡片）
 *
 * 数据全部来自真实 IPC：book.getAll / card.getDue / highlight.getAll
 * （原 4 KPI 统计卡与近 7 日柱状图已移除——与统计页重合，且未同步时长时恒为 0 观感如假数据）
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Card, { CardHead } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { Loading, EmptyState, Tiny, Muted } from '@/components/ui/Feedback'
import { mapBooks, mapCards, mapHighlights, safeNum, formatTimeAgo } from '../utils/db-mapper'

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

interface HighlightRow {
  id: string
  bookId: string
  content: string
  note: string
  chapterTitle: string
  type?: string
  createdAt: string
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

export default function Home() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [books, setBooks] = useState<BookRow[]>([])
  const [dueCards, setDueCards] = useState<CardRow[]>([])
  const [highlights, setHighlights] = useState<HighlightRow[]>([])

  const loadData = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
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

      // 最新划线/笔记（非致命：接口不可用时保持空列表）
      if (window.electronAPI?.highlight?.getAll) {
        try {
          const highlightsRaw = await window.electronAPI.highlight.getAll()
          setHighlights(mapHighlights(highlightsRaw as unknown[]) as unknown as HighlightRow[])
        } catch (err) {
          console.warn('加载划线数据失败（非致命）:', err)
        }
      }
    } catch (error) {
      console.error('加载首页数据失败:', error)
      setLoadError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // 继续阅读：最近阅读的 3 本
  const recentBooks = useMemo(() => {
    return [...books]
      .sort((a, b) => {
        const ta = a.lastReadAt ? new Date(a.lastReadAt).getTime() : 0
        const tb = b.lastReadAt ? new Date(b.lastReadAt).getTime() : 0
        return tb - ta
      })
      .slice(0, 3)
  }, [books])

  // 最新划线/笔记：按创建时间倒序取 6 条（划线与笔记混合，笔记优先展示内容）
  const recentHighlights = useMemo(() => {
    return [...highlights]
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, 6)
  }, [highlights])

  if (loading) {
    return <Loading hint="正在加载今日阅读数据..." />
  }

  return (
    <>
      {loadError && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'calc(var(--spacing) * 3)',
            padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
            marginBottom: 'calc(var(--spacing) * 4)',
            borderRadius: 12,
            border: '1px solid #ef4444',
            background: 'rgba(239, 68, 68, 0.08)',
            color: '#ef4444',
            fontSize: '0.88rem',
          }}
        >
          <span>加载首页数据失败：{loadError}</span>
          <Button variant="secondary" onClick={() => void loadData()}>重试</Button>
        </div>
      )}
      <PageHero
        title="今日阅读"
        subtitle="继续阅读、处理复习与回顾划线"
        actions={
          <>
            <Button variant="primary" onClick={() => navigate('/knowledge-cards')} data-dom-id="cta-start-reading">
              <Icon name="cards" size={16} /> 今日卡片
            </Button>
            <Button variant="secondary" onClick={() => navigate('/bookshelf')} data-dom-id="cta-open-bookshelf">
              <Icon name="bookshelf" size={16} /> 打开书架
            </Button>
            <Button variant="ghost" onClick={() => navigate('/settings/weread')} data-dom-id="cta-sync-weread">
              <Icon name="refresh" size={16} /> 同步微信读书
            </Button>
          </>
        }
      >
        {/* ===== Layer 1: 继续阅读 ===== */}
        <Card>
          <CardHead
            eyebrow="继续阅读"
            title="接着上次读"
            action={
              <Button variant="ghost" onClick={() => navigate('/bookshelf')} data-dom-id="cta-all-books">
                全部书籍
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
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 'calc(var(--spacing) * 4)',
                marginTop: 'calc(var(--spacing) * 4)',
              }}
            >
              {recentBooks.map((book) => {
                const progressPct = Math.round(safeNum(book.progress) * 100)
                return (
                  <button
                    key={book.id}
                    type="button"
                    onClick={() => navigate(`/bookshelf/${book.id}`)}
                    data-dom-id={`continue-reading-${book.id}`}
                    style={{
                      display: 'flex',
                      gap: 'calc(var(--spacing) * 4)',
                      alignItems: 'stretch',
                      padding: 'calc(var(--spacing) * 3.5)',
                      background: 'var(--background)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      cursor: 'pointer',
                      textAlign: 'left',
                      fontFamily: 'inherit',
                      color: 'inherit',
                      transition: 'border-color 0.2s ease, transform 0.16s ease',
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
                    {/* 封面 */}
                    <div
                      aria-hidden="true"
                      style={{
                        width: 64,
                        flexShrink: 0,
                        aspectRatio: '3 / 4',
                        borderRadius: 'calc(var(--radius) - 2px)',
                        overflow: 'hidden',
                        display: 'grid',
                        placeItems: 'center',
                        fontWeight: 700,
                        fontSize: '1.1rem',
                        color: 'var(--primary-foreground)',
                        background: book.cover
                          ? 'var(--muted)'
                          : 'linear-gradient(135deg, var(--chart-1), color-mix(in srgb, var(--chart-4) 80%, black))',
                      }}
                    >
                      {book.cover ? (
                        <img
                          src={book.cover}
                          alt=""
                          loading="lazy"
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                      ) : (
                        book.title.charAt(0)
                      )}
                    </div>

                    {/* 信息 */}
                    <div style={{ minWidth: 0, flex: 1, display: 'flex', flexDirection: 'column' }}>
                      <strong
                        style={{
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          fontSize: '0.95rem',
                          fontWeight: 600,
                          color: 'var(--foreground)',
                          lineHeight: 1.4,
                        }}
                      >
                        {book.title}
                      </strong>
                      <Muted>{book.author}</Muted>

                      <div style={{ marginTop: 'auto', paddingTop: 'calc(var(--spacing) * 3)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                          <span style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>阅读进度</span>
                          <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 600, color: 'var(--foreground)' }}>
                            {progressPct}%
                          </span>
                        </div>
                        <div
                          style={{
                            height: 5,
                            background: 'var(--muted)',
                            borderRadius: 999,
                            overflow: 'hidden',
                            marginTop: 'calc(var(--spacing) * 1.5)',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${progressPct}%`,
                              background: 'var(--primary)',
                              borderRadius: 999,
                              transition: 'width 0.3s ease',
                            }}
                          />
                        </div>
                        <Tiny>{book.lastReadAt ? formatTimeAgo(book.lastReadAt) : '尚未开始阅读'}</Tiny>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </Card>

        {/* ===== Layer 2: 最新划线/笔记 + 复习队列 ===== */}
        <div
          className="grid panels"
          style={{
            display: 'grid',
            gridTemplateColumns: '1.7fr 1fr',
            gap: 'calc(var(--spacing) * 4)',
          }}
        >
          {/* 最新划线/笔记 */}
          <Card>
            <CardHead
              eyebrow="回顾"
              title="最新划线与笔记"
              action={<Badge>{recentHighlights.length} 条</Badge>}
            />
            {recentHighlights.length === 0 ? (
              <EmptyState
                icon={<Icon name="notes" size={24} />}
                title="还没有划线与笔记"
                description="同步微信读书后在书籍详情页点击「导入笔记」即可收集划线"
              />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {recentHighlights.map((h, idx) => {
                  const book = books.find((b) => b.id === h.bookId)
                  const text = h.note || h.content
                  return (
                    <button
                      key={h.id}
                      type="button"
                      onClick={() => navigate(`/bookshelf/${h.bookId}`)}
                      data-dom-id={`recent-highlight-${h.id}`}
                      style={{
                        display: 'flex',
                        gap: 'calc(var(--spacing) * 3)',
                        alignItems: 'flex-start',
                        padding: 'calc(var(--spacing) * 3.5) 0',
                        borderTop: idx === 0 ? 'none' : '1px solid var(--border)',
                        background: 'transparent',
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontFamily: 'inherit',
                        color: 'inherit',
                      }}
                      onMouseEnter={(e) => {
                        const text0 = e.currentTarget.querySelector('p') as HTMLElement | null
                        if (text0) text0.style.color = 'var(--primary)'
                      }}
                      onMouseLeave={(e) => {
                        const text0 = e.currentTarget.querySelector('p') as HTMLElement | null
                        if (text0) text0.style.color = 'var(--foreground)'
                      }}
                    >
                      {h.note ? <Badge variant="ok">笔记</Badge> : <Badge>划线</Badge>}
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <p
                          style={{
                            margin: 0,
                            fontSize: '0.9rem',
                            lineHeight: 1.6,
                            color: 'var(--foreground)',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {text.length > 100 ? `${text.slice(0, 100)}…` : text}
                        </p>
                        <Tiny>
                          《{book?.title || '未关联书籍'}》 · {h.chapterTitle || '未知章节'} · {formatTimeAgo(h.createdAt)}
                        </Tiny>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
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
                  {dueCards.slice(0, 4).map((card, idx) => {
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
                          padding: idx === 0 ? '0 0 calc(var(--spacing) * 3.5)' : 'calc(var(--spacing) * 3.5) 0',
                          borderTop: idx === 0 ? 'none' : '1px solid var(--border)',
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
      </PageHero>
    </>
  )
}
