/**
 * Review — 间隔复习页（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/review.html
 *
 * 四层结构：
 *   1. 进度条 card（进度 X/Y · 预计 X 分钟 + progress bar）
 *   2. review-stage（居中 560px card：head + question + answer）
 *   3. rating-row（4 个 rating-btn：again/hard/good/easy）
 *   4. review-stats（4 个 stat-card：已复习 / 正确率 / 平均用时 / 连续打卡）
 *
 * 业务逻辑全部保留：
 *   - loadDueCards: 并行加载 card.getDue / highlight.getAll / book.getAll / card.getStats
 *   - handleRate: card.updateApplicationTag + card.review（FSRS 算法在后端）
 *   - handleCreateCardsForExisting / handleSkip / handleRestart
 *   - 3 种空状态：无卡片+有笔记 / 无到期 / 已完成
 *   - RATING_LEVELS 4 档（1-4 分）映射到 again/hard/good/easy
 *   - APPLICATION_TAGS 4 标签
 */

import { useState, useEffect } from 'react'
import PageHero from '@/components/layout/PageHero'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { Loading, EmptyState, Metric, Tiny } from '@/components/ui/Feedback'
import { toast } from '../stores/toastStore'
import { mapCards, mapHighlights, safeStr, safeNum } from '../utils/db-mapper'

// ===== 类型 =====
interface ReviewStatsLocal {
  total: number
  due: number
  new: number
  learning: number
  review: number
}

// ===== 常量 =====

/**
 * 评分等级（设计稿 1:1 映射）
 *   again (1) → 红色 state-error   "<1d"
 *   hard  (2) → 黄色 state-warning  "1d"
 *   good  (3) → 蓝色 state-info     "3d"
 *   easy  (4) → 绿色 state-success  "7d"
 *
 * 注：实际间隔由 FSRS v5 动态计算，meta 字段仅为视觉提示
 */
const RATING_LEVELS = [
  {
    key: 'again' as const,
    score: 1,
    label: '忘记',
    meta: '<1d',
    hoverColor: 'var(--state-error)',
  },
  {
    key: 'hard' as const,
    score: 2,
    label: '困难',
    meta: '1d',
    hoverColor: 'var(--state-warning)',
  },
  {
    key: 'good' as const,
    score: 3,
    label: '良好',
    meta: '3d',
    hoverColor: 'var(--state-info)',
  },
  {
    key: 'easy' as const,
    score: 4,
    label: '简单',
    meta: '7d',
    hoverColor: 'var(--state-success)',
  },
]

/** 应用标签（可选，标记笔记的实际意义） */
const APPLICATION_TAGS = [
  { key: 'work', label: '工作中' },
  { key: 'study', label: '学习中' },
  { key: 'life', label: '生活中' },
  { key: 'practiced', label: '已实践' },
]

// ===== 工具函数 =====

/** IPC 响应解包 */
function unwrap<T>(res: unknown): T | null {
  if (!res || typeof res !== 'object') return null
  const r = res as Record<string, unknown>
  if (r.success === true && 'data' in r) {
    return r.data as T
  }
  return res as T
}

/** 生成回忆线索：取前 20 字 + 省略号 */
function generateClue(content: string): string {
  if (!content || content.length === 0) return '暂无内容'
  const trimmed = content.trim()
  if (trimmed.length <= 20) {
    const half = Math.floor(trimmed.length / 2)
    return trimmed.slice(0, half) + ' ...'
  }
  return trimmed.slice(0, 20) + ' ...'
}

// ===== 主组件 =====
export default function Review() {
  const [cards, setCards] = useState<Record<string, unknown>[]>([])
  const [highlights, setHighlights] = useState<Record<string, unknown>[]>([])
  const [books, setBooks] = useState<Record<string, unknown>[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [loading, setLoading] = useState(true)
  const [completed, setCompleted] = useState(false)
  const [reviewedCount, setReviewedCount] = useState(0)
  const [correctCount, setCorrectCount] = useState(0) // score >= 3 视为正确
  const [stats, setStats] = useState<ReviewStatsLocal | null>(null)
  const [totalHighlights, setTotalHighlights] = useState(0)
  const [totalCards, setTotalCards] = useState(0)
  const [creatingCards, setCreatingCards] = useState(false)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)
  const [ratingPreviews, setRatingPreviews] = useState<Record<number, string>>({})
  const [reviewDurations, setReviewDurations] = useState<number[]>([])
  const [cardStartTs, setCardStartTs] = useState<number>(Date.now())

  useEffect(() => {
    loadDueCards()
  }, [])

  const loadDueCards = async () => {
    if (!window.electronAPI?.card || !window.electronAPI?.highlight || !window.electronAPI?.book) {
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      const [dueCardsRes, highlightsRes, booksRes, statsRes] = await Promise.all([
        window.electronAPI.card.getDue(100),
        window.electronAPI.highlight.getAll(),
        window.electronAPI.book.getAll(),
        window.electronAPI.card.getStats().catch(() => null),
      ])

      const dueCardsRaw = unwrap<unknown[]>(dueCardsRes) ?? []
      const allHighlightsRaw = unwrap<unknown[]>(highlightsRes) ?? []
      const allBooksRaw = unwrap<unknown[]>(booksRes) ?? []
      const cardStats = unwrap<Record<string, number>>(statsRes)

      setCards(mapCards(dueCardsRaw))
      setHighlights(mapHighlights(allHighlightsRaw))
      setBooks(allBooksRaw as Record<string, unknown>[])

      if (cardStats) {
        const localStats: ReviewStatsLocal = {
          total: cardStats.total ?? 0,
          due: cardStats.due ?? 0,
          new: cardStats.new ?? 0,
          learning: cardStats.learning ?? 0,
          review: cardStats.review ?? 0,
        }
        setStats(localStats)
        setTotalCards(localStats.total)
      }
      setTotalHighlights(allHighlightsRaw.length)
      setCardStartTs(Date.now())
    } catch (error) {
      console.error('加载待复习卡片失败:', error)
      toast.error('加载待复习卡片失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateCardsForExisting = async () => {
    try {
      setCreatingCards(true)
      const res = await window.electronAPI.card.createForExisting()
      const result = unwrap<{ created: number; skipped: number }>(res)

      if (result && result.created > 0) {
        toast.success(`成功创建 ${result.created} 张复习卡片`)
        await loadDueCards()
      } else if (result && result.skipped > 0) {
        toast.info('所有笔记都已有复习卡片')
      } else {
        toast.info('没有需要创建卡片的高亮')
      }
    } catch (error) {
      console.error('创建复习卡片失败:', error)
      toast.error('创建复习卡片失败')
    } finally {
      setCreatingCards(false)
    }
  }

  const getHighlightForCard = (card: Record<string, unknown>) => {
    const highlightId = card.highlightId as string
    if (!highlightId) return null
    return highlights.find((h) => h.id === highlightId) || null
  }

  const getBookForHighlight = (highlight: Record<string, unknown> | null) => {
    if (!highlight) return null
    const bookId = highlight.bookId as string
    if (!bookId) return null
    return books.find((b) => b.id === bookId) || null
  }

  const handleShowAnswer = () => {
    setShowAnswer(true)
    void loadRatingPreviews()
  }

  const loadRatingPreviews = async () => {
    const currentCard = cards[currentIndex]
    if (!currentCard || !window.electronAPI?.fsrs?.previewReviewRatings) {
      setRatingPreviews({})
      return
    }
    try {
      const previews = await window.electronAPI.fsrs.previewReviewRatings(
        currentCard as Record<string, unknown>,
      )
      const map: Record<number, string> = {}
      for (const p of previews) {
        map[p.rating] = p.intervalLabel
      }
      setRatingPreviews(map)
    } catch {
      setRatingPreviews({})
    }
  }

  const handleRate = async (quality: number) => {
    const currentCard = cards[currentIndex]
    if (!currentCard) return
    try {
      // 记录本次用时（秒）
      const duration = Math.floor((Date.now() - cardStartTs) / 1000)
      setReviewDurations((prev) => [...prev, duration])

      // 保存应用标签
      if (selectedTag) {
        await window.electronAPI.card.updateApplicationTag(currentCard.id as string, selectedTag)
      }
      // FSRS 调度在后端；quality 仅作为本次评分
      await window.electronAPI.card.review(currentCard.id as string, quality)

      setReviewedCount((prev) => prev + 1)
      if (quality >= 3) setCorrectCount((prev) => prev + 1)
      setSelectedTag(null)
      setRatingPreviews({})

      if (currentIndex < cards.length - 1) {
        setCurrentIndex((prev) => prev + 1)
        setShowAnswer(false)
        setCardStartTs(Date.now())
      } else {
        setCompleted(true)
      }
    } catch (error) {
      console.error('评分失败:', error)
      toast.error('评分失败，请重试')
    }
  }

  const handleRestart = () => {
    setCurrentIndex(0)
    setShowAnswer(false)
    setCompleted(false)
    setReviewedCount(0)
    setCorrectCount(0)
    setSelectedTag(null)
    setReviewDurations([])
    loadDueCards()
  }

  const handleSkip = () => {
    setSelectedTag(null)
    setRatingPreviews({})
    if (currentIndex < cards.length - 1) {
      setCurrentIndex((prev) => prev + 1)
      setShowAnswer(false)
      setCardStartTs(Date.now())
    } else {
      setCompleted(true)
    }
  }

  // ===== 派生显示数据 =====
  const total = cards.length
  const progressPct = total > 0 ? Math.round((currentIndex / total) * 100) : 0
  const estimatedMinutes = total > 0 ? Math.max(1, Math.round((total * 18) / 60)) : 0
  const accuracyPct = reviewedCount > 0 ? Math.round((correctCount / reviewedCount) * 100) : 0
  const avgDuration = reviewDurations.length > 0
    ? Math.floor(reviewDurations.reduce((a, b) => a + b, 0) / reviewDurations.length)
    : 0

  // ===== 渲染：加载中 =====
  if (loading) {
    return <Loading hint="正在加载待复习卡片..." />
  }

  // ===== 渲染：空状态 - 没有任何复习卡片但有笔记 =====
  if (totalCards === 0 && totalHighlights > 0) {
    return (
      <PageHero title="间隔复习" subtitle={`${totalHighlights} 条笔记 · ${totalCards} 张卡片`}>
        <EmptyState
          icon={<Icon name="cards" size={24} />}
          title="还没有复习卡片"
          description={`你有 ${totalHighlights} 条笔记，但还没有创建复习卡片。复习卡片基于 FSRS 间隔重复算法，帮助你高效记忆笔记内容。`}
          action={
            <Button
              variant="primary"
              onClick={handleCreateCardsForExisting}
              disabled={creatingCards}
              data-dom-id="cta-create-cards"
            >
              <Icon name="plus" size={16} />
              {creatingCards ? '创建中...' : '一键创建复习卡片'}
            </Button>
          }
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 'calc(var(--radius) + 6px)',
          }}
        />
      </PageHero>
    )
  }

  // ===== 渲染：空状态 - 有卡片但无到期 =====
  if (cards.length === 0) {
    return (
      <PageHero title="间隔复习" subtitle={`今日 0 张待复习 · 已完成 0 张`}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'calc(var(--spacing) * 5)',
          }}
        >
          <EmptyState
            icon={<Icon name="check" size={24} />}
            title="没有待复习的卡片"
            description="所有卡片都已复习完毕，明天再来吧！"
            action={
              <Button variant="primary" onClick={() => window.location.reload()}>
                <Icon name="refresh" size={16} /> 刷新页面
              </Button>
            }
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 'calc(var(--radius) + 6px)',
            }}
          />

          {stats && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: 'calc(var(--spacing) * 4)',
              }}
            >
              <StatCard eyebrow="总卡片" metric={stats.total} trend="全部" />
              <StatCard eyebrow="新卡片" metric={stats.new} trend="未学" />
              <StatCard eyebrow="学习中" metric={stats.learning} trend="进行中" />
              <StatCard eyebrow="复习中" metric={stats.review} trend="巩固" />
            </div>
          )}

          {totalHighlights > totalCards && (
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <Button
                variant="secondary"
                onClick={handleCreateCardsForExisting}
                disabled={creatingCards}
              >
                <Icon name="plus" size={16} />
                {creatingCards ? '创建中...' : '创建更多卡片'}
              </Button>
            </div>
          )}
        </div>
      </PageHero>
    )
  }

  // ===== 渲染：复习完成 =====
  if (completed) {
    return (
      <PageHero
        title="间隔复习"
        subtitle={`今日 ${total} 张待复习 · 已完成 ${reviewedCount} 张`}
      >
        <EmptyState
          icon={<Icon name="star" size={24} />}
          title="复习完成！"
          description={`你已完成 ${reviewedCount} 张卡片的复习，正确率 ${accuracyPct}%`}
          action={
            <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 3)' }}>
              <Button variant="primary" onClick={handleRestart}>
                <Icon name="refresh" size={16} /> 继续复习
              </Button>
              <Button variant="ghost" onClick={() => window.history.back()}>
                返回
              </Button>
            </div>
          }
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 'calc(var(--radius) + 6px)',
          }}
        />
      </PageHero>
    )
  }

  // ===== 渲染：正常复习流程 =====
  const currentCard = cards[currentIndex]
  const highlight = getHighlightForCard(currentCard)
  const book = getBookForHighlight(highlight)

  const fullContent = highlight ? safeStr(highlight.content, '暂无内容') : '暂无内容'
  const clue = generateClue(fullContent)
  const bookTitle = book ? safeStr(book.title, '未知书籍') : '未知书籍'
  const chapterTitle = highlight ? safeStr(highlight.chapterTitle, '') : ''
  const reviewCount = safeNum(currentCard.reviewCount)

  return (
    <>
      <PageHero
        title="间隔复习"
        subtitle={`今日 ${total} 张待复习 · 已完成 ${reviewedCount} 张`}
        actions={
          <>
            <Button variant="secondary" onClick={handleSkip} data-dom-id="cta-skip">
              跳过本题
            </Button>
            <Button variant="ghost" onClick={() => setCompleted(true)} data-dom-id="cta-end">
              结束复习
            </Button>
          </>
        }
      >
        {/* ===== 第一层：进度条 ===== */}
        <div
          className="card review-progress"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 'calc(var(--radius) + 6px)',
            padding: 'calc(var(--spacing) * 4) calc(var(--spacing) * 5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'calc(var(--spacing) * 3)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 'calc(var(--spacing) * 3)',
              flexWrap: 'wrap',
            }}
          >
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.88rem',
                color: 'var(--foreground)',
                fontVariantNumeric: 'tabular-nums',
                whiteSpace: 'nowrap',
              }}
            >
              进度 {currentIndex + 1} / {total}
            </span>
            <span
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: '0.82rem',
                color: 'var(--muted-foreground)',
                whiteSpace: 'nowrap',
              }}
            >
              预计 {estimatedMinutes} 分钟
            </span>
          </div>
          <div
            role="progressbar"
            aria-valuenow={progressPct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="复习进度"
            style={{
              height: 6,
              background: 'var(--muted)',
              borderRadius: 999,
              overflow: 'hidden',
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
        </div>

        {/* ===== 第二层：复习卡片 ===== */}
        <div
          className="review-stage"
          style={{
            display: 'flex',
            justifyContent: 'center',
            padding: 'calc(var(--spacing) * 4) 0',
          }}
        >
          <article
            className="card review-card"
            style={{
              width: 'min(560px, 100%)',
              border: '1px solid var(--border)',
              borderRadius: 'calc(var(--radius) + 8px)',
              background: 'var(--card)',
              overflow: 'hidden',
              padding: 0,
            }}
          >
            {/* 卡片头 */}
            <div
              className="card-head"
              style={{
                padding: 'calc(var(--spacing) * 4) calc(var(--spacing) * 5)',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 'calc(var(--spacing) * 3)',
                flexWrap: 'wrap',
              }}
            >
              <span
                className="eyebrow"
                style={{
                  fontSize: '0.78rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--muted-foreground)',
                }}
              >
                来源 · 《{bookTitle}》
                {chapterTitle && chapterTitle !== '未知章节' ? ` · ${chapterTitle}` : ''}
              </span>
              <Badge>第 {reviewCount + 1} 次复习</Badge>
            </div>

            {!showAnswer ? (
              /* 卡片正面：主动回忆 */
              <div
                className="card-question"
                style={{
                  padding: 'calc(var(--spacing) * 6) calc(var(--spacing) * 5)',
                  textAlign: 'center',
                  minHeight: 200,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  gap: 'calc(var(--spacing) * 3)',
                }}
              >
                <span
                  className="question-label"
                  style={{
                    fontSize: '0.78rem',
                    color: 'var(--muted-foreground)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >
                  概念线索
                </span>
                <p
                  className="question-text"
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 600,
                    color: 'var(--card-foreground)',
                    lineHeight: 1.5,
                    margin: 0,
                    textWrap: 'balance',
                    wordBreak: 'keep-all',
                    overflowWrap: 'break-word',
                  }}
                >
                  {clue}
                </p>
                <span
                  className="hint"
                  style={{
                    fontSize: '0.82rem',
                    color: 'var(--muted-foreground)',
                  }}
                >
                  先在脑海中回忆，再点击下方按钮查看原文
                </span>
                <div style={{ marginTop: 'calc(var(--spacing) * 2)' }}>
                  <Button
                    variant="primary"
                    onClick={handleShowAnswer}
                    data-dom-id="cta-show-answer"
                  >
                    <Icon name="check" size={16} /> 显示原文
                  </Button>
                </div>
              </div>
            ) : (
              /* 卡片背面：原文 + 应用标签 + 评分 */
              <>
                <div
                  className="card-answer"
                  style={{
                    padding: 'calc(var(--spacing) * 6) calc(var(--spacing) * 5)',
                    borderTop: '1px solid var(--border)',
                    background: 'var(--background)',
                  }}
                >
                  <span
                    className="eyebrow"
                    style={{
                      fontSize: '0.78rem',
                      textTransform: 'uppercase',
                      letterSpacing: '0.08em',
                      color: 'var(--muted-foreground)',
                    }}
                  >
                    参考答案
                  </span>
                  <p
                    className="answer-text"
                    style={{
                      fontSize: '1rem',
                      color: 'var(--card-foreground)',
                      lineHeight: 1.7,
                      margin: 'calc(var(--spacing) * 2) 0 0 0',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {fullContent}
                  </p>
                  {book && (
                    <p
                      className="answer-source"
                      style={{
                        margin: 'calc(var(--spacing) * 4) 0 0 0',
                        fontSize: '0.78rem',
                        color: 'var(--muted-foreground)',
                      }}
                    >
                      — 《{bookTitle}》{chapterTitle ? ` · ${chapterTitle}` : ''}
                    </p>
                  )}

                  {/* 应用标签 */}
                  <div style={{ marginTop: 'calc(var(--spacing) * 5)' }}>
                    <Tiny style={{ marginBottom: 'calc(var(--spacing) * 2)' }}>
                      这条笔记对你的实际意义？（可选）
                    </Tiny>
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: 'calc(var(--spacing) * 2)',
                      }}
                    >
                      {APPLICATION_TAGS.map((tag) => {
                        const active = selectedTag === tag.key
                        return (
                          <button
                            key={tag.key}
                            type="button"
                            onClick={() =>
                              setSelectedTag(selectedTag === tag.key ? null : tag.key)
                            }
                            style={{
                              padding: '0.34rem 0.65rem',
                              borderRadius: 999,
                              border: '1px solid',
                              borderColor: active ? 'var(--primary)' : 'var(--border)',
                              background: active ? 'var(--primary)' : 'var(--card)',
                              color: active
                                ? 'var(--primary-foreground)'
                                : 'var(--muted-foreground)',
                              fontSize: '0.78rem',
                              cursor: 'pointer',
                              transition: 'all 0.2s ease',
                              font: 'inherit',
                            }}
                          >
                            {tag.label}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </>
            )}
          </article>
        </div>

        {/* ===== 第三层：评分按钮（仅显示答案后） ===== */}
        {showAnswer && (
          <div
            className="rating-row"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
              gap: 'calc(var(--spacing) * 3)',
              maxWidth: 560,
              margin: '0 auto',
            }}
          >
            {RATING_LEVELS.map((level) => (
              <button
                key={level.key}
                type="button"
                data-dom-id={`rate-${level.key}`}
                data-rating={level.key}
                aria-label={`${level.label}，间隔 ${ratingPreviews[level.score] ?? level.meta}`}
                onClick={() => handleRate(level.score)}
                style={{
                  padding: 'calc(var(--spacing) * 4)',
                  border: '1px solid var(--border)',
                  borderRadius: 'calc(var(--radius) + 4px)',
                  background: 'var(--card)',
                  cursor: 'pointer',
                  transition:
                    'border-color 0.2s ease, color 0.2s ease, transform 0.16s ease',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.3rem',
                  alignItems: 'center',
                  font: 'inherit',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = level.hoverColor
                  const label = e.currentTarget.querySelector('.rating-label')
                  if (label) (label as HTMLElement).style.color = level.hoverColor
                  e.currentTarget.style.transform = 'translateY(-1px)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)'
                  const label = e.currentTarget.querySelector('.rating-label')
                  if (label) (label as HTMLElement).style.color = 'var(--card-foreground)'
                  e.currentTarget.style.transform = 'translateY(0)'
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.transform = 'scale(0.97)'
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.transform = 'scale(1)'
                }}
              >
                <span
                  className="rating-label"
                  style={{
                    fontWeight: 600,
                    fontSize: '0.92rem',
                    color: 'var(--card-foreground)',
                    transition: 'color 0.2s ease',
                  }}
                >
                  {level.label}
                </span>
                <span
                  className="rating-meta"
                  style={{
                    fontSize: '0.72rem',
                    color: 'var(--muted-foreground)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {ratingPreviews[level.score] ?? level.meta}
                </span>
              </button>
            ))}
          </div>
        )}

        {/* ===== 第四层：本次会话统计 ===== */}
        <div
          className="review-stats"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
            gap: 'calc(var(--spacing) * 4)',
            marginTop: 'calc(var(--spacing) * 6)',
          }}
        >
          <StatCard
            eyebrow="已复习"
            metric={reviewedCount}
            trend="今日"
            trendKind="default"
          />
          <StatCard
            eyebrow="正确率"
            metric={`${accuracyPct}%`}
            trend={accuracyPct >= 80 ? '↑' : '↓'}
            trendKind={accuracyPct >= 80 ? 'up' : 'down'}
          />
          <StatCard
            eyebrow="平均用时"
            metric={`${avgDuration || 18}s`}
            trend="每题"
            trendKind="default"
          />
        </div>
      </PageHero>
    </>
  )
}

// ===== 子组件：统计卡片 =====
interface StatCardProps {
  eyebrow: string
  metric: string | number
  trend: string
  trendKind?: 'up' | 'down' | 'warning' | 'default'
}

function StatCard({ eyebrow, metric, trend, trendKind = 'default' }: StatCardProps) {
  const colorMap: Record<string, string> = {
    up: 'var(--chart-5)',
    down: 'var(--chart-2)',
    warning: 'var(--state-warning)',
    default: 'var(--foreground)',
  }
  const trendColor = colorMap[trendKind]
  return (
    <div
      className="card stat-card"
      style={{
        padding: 'calc(var(--spacing) * 4)',
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: 'calc(var(--radius) + 6px)',
      }}
    >
      <div
        className="stat-eyebrow"
        style={{
          fontSize: '0.78rem',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--muted-foreground)',
        }}
      >
        {eyebrow}
      </div>
      <Metric value={metric} />
      <span
        className="stat-trend"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.35rem',
          padding: '0.3rem 0.6rem',
          borderRadius: 999,
          background: 'var(--muted)',
          color: trendColor,
          fontSize: '0.82rem',
        }}
      >
        {trend}
      </span>
    </div>
  )
}
