/**
 * Review — 间隔复习页面
 * 打通 FSRS 复习闭环：到期卡片 → 显示答案 → 四级评分 → FSRS 调度落库
 * 数据源：card.getDueWithContent（JOIN 划线原文/笔记/书名）
 * 间隔预览：fsrs.previewReviewRatings（不落库）
 */

import { useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHero from '../components/layout/PageHero'
import Card from '../components/ui/Card'
import Button from '../components/ui/Button'
import { useReviewStore } from '../stores/reviewStore'

/** 评分按钮配置：FSRS Rating（Again=1 Hard=2 Good=3 Easy=4） */
const RATING_BUTTONS = [
  { rating: 1, label: '忘记', desc: '想不起来', bg: 'var(--destructive)', fg: 'var(--destructive-foreground)' },
  { rating: 2, label: '困难', desc: '勉强想起', bg: 'var(--muted)', fg: 'var(--foreground)' },
  { rating: 3, label: '良好', desc: '想起来了', bg: 'var(--primary)', fg: 'var(--primary-foreground)' },
  { rating: 4, label: '简单', desc: '轻松回忆', bg: 'var(--secondary)', fg: 'var(--secondary-foreground)' },
] as const

export default function Review() {
  const navigate = useNavigate()
  const {
    dueCards,
    currentIndex,
    showAnswer,
    completed,
    loading,
    error,
    previews,
    fetchDueCards,
    showAnswerCard,
    rateCard,
  } = useReviewStore()

  useEffect(() => {
    fetchDueCards()
  }, [fetchDueCards])

  const currentCard = dueCards[currentIndex]
  const total = dueCards.length
  const isFinished = total > 0 && completed >= total

  /** 评分间隔预览：rating → intervalLabel */
  const previewMap = useMemo(() => {
    const map = new Map<number, string>()
    for (const p of previews) map.set(p.rating, p.intervalLabel)
    return map
  }, [previews])

  // 键盘快捷键：空格显示答案，1-4 评分（仅显示答案后生效）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (loading || !currentCard) return
      if (e.code === 'Space' && !showAnswer) {
        e.preventDefault()
        showAnswerCard()
        return
      }
      if (showAnswer && ['1', '2', '3', '4'].includes(e.key)) {
        e.preventDefault()
        rateCard(Number(e.key))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [loading, currentCard, showAnswer, showAnswerCard, rateCard])

  const progress = total > 0 ? Math.round((completed / total) * 100) : 0

  return (
    <PageHero
      title="间隔复习"
      subtitle="基于 FSRS v5 间隔重复算法（Anki 同源），按记忆遗忘曲线安排复习节奏。展示划线原文，回忆语境后按实际记住程度评分。"
    >
      {/* ===== 加载态 ===== */}
      {loading && !currentCard && (
        <Card>
          <div style={{ textAlign: 'center', padding: 'calc(var(--spacing) * 8) 0', color: 'var(--muted-foreground)' }}>
            正在加载到期卡片...
          </div>
        </Card>
      )}

      {/* ===== 错误态 ===== */}
      {error && (
        <Card>
          <div style={{ textAlign: 'center', padding: 'calc(var(--spacing) * 6) 0' }}>
            <div style={{ color: 'var(--destructive)', marginBottom: 'calc(var(--spacing) * 3)' }}>{error}</div>
            <Button variant="secondary" onClick={() => fetchDueCards()}>重试</Button>
          </div>
        </Card>
      )}

      {/* ===== 空态：无到期卡片 ===== */}
      {!loading && !error && total === 0 && (
        <Card>
          <div style={{ textAlign: 'center', padding: 'calc(var(--spacing) * 8) 0' }}>
            <div style={{ fontSize: '2rem', marginBottom: 'calc(var(--spacing) * 3)' }}>✓</div>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>暂无到期待复习的卡片</h3>
            <p style={{ margin: '0 0 calc(var(--spacing) * 4)', color: 'var(--muted-foreground)', fontSize: '0.875rem' }}>
              复习卡片来自微信读书划线同步。同步后自动为划线创建复习卡片，到期即可在此复习。
            </p>
            <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 3)', justifyContent: 'center' }}>
              <Button variant="secondary" onClick={() => navigate('/settings/weread')}>去同步微信读书</Button>
              <Button variant="ghost" onClick={() => navigate('/knowledge-cards')}>查看知识卡片</Button>
            </div>
          </div>
        </Card>
      )}

      {/* ===== 完成态 ===== */}
      {!loading && !error && isFinished && (
        <Card>
          <div style={{ textAlign: 'center', padding: 'calc(var(--spacing) * 8) 0' }}>
            <div style={{ fontSize: '2rem', marginBottom: 'calc(var(--spacing) * 3)' }}>🎉</div>
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>本轮复习完成</h3>
            <p style={{ margin: '0 0 calc(var(--spacing) * 4)', color: 'var(--muted-foreground)', fontSize: '0.875rem' }}>
              已完成 {completed} 张卡片，FSRS 将根据你的评分安排下次复习时间。
            </p>
            <Button variant="primary" onClick={() => fetchDueCards()}>再拉取一轮</Button>
          </div>
        </Card>
      )}

      {/* ===== 复习中 ===== */}
      {!loading && !error && currentCard && !isFinished && (
        <Card>
          {/* 进度条 */}
          <div style={{ marginBottom: 'calc(var(--spacing) * 4)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 'calc(var(--spacing) * 2)', fontSize: '0.82rem', color: 'var(--muted-foreground)' }}>
              <span>第 {currentIndex + 1} / {total} 张</span>
              <span>已完成 {completed} 张</span>
            </div>
            <div style={{ height: 6, borderRadius: 999, background: 'var(--muted)', overflow: 'hidden' }}>
              <div
                style={{
                  width: `${progress}%`,
                  height: '100%',
                  background: 'var(--primary)',
                  borderRadius: 999,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>

          {/* 卡片正面：划线原文 */}
          <blockquote
            style={{
              margin: 0,
              padding: 'calc(var(--spacing) * 5)',
              borderLeft: '3px solid var(--primary)',
              background: 'var(--muted)',
              borderRadius: 'var(--radius)',
              fontSize: '1.02rem',
              lineHeight: 1.8,
              color: 'var(--foreground)',
            }}
          >
            {currentCard.highlightContent}
          </blockquote>

          {/* 卡片背面：出处 + 笔记 */}
          {showAnswer ? (
            <div
              style={{
                marginTop: 'calc(var(--spacing) * 4)',
                padding: 'calc(var(--spacing) * 4)',
                border: '1px dashed var(--border)',
                borderRadius: 'var(--radius)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'calc(var(--spacing) * 2)',
              }}
            >
              <div style={{ fontSize: '0.88rem', color: 'var(--muted-foreground)' }}>
                出处：<strong style={{ color: 'var(--foreground)' }}>{currentCard.bookTitle || '未知书籍'}</strong>
                {currentCard.chapterTitle && <span> · {currentCard.chapterTitle}</span>}
              </div>
              {currentCard.highlightNote && (
                <div style={{ fontSize: '0.9rem', lineHeight: 1.7 }}>
                  <span style={{ color: 'var(--muted-foreground)' }}>我的笔记：</span>
                  {currentCard.highlightNote}
                </div>
              )}
              <div style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)' }}>
                已复习 {currentCard.reps} 次 · 记忆稳定性 {currentCard.stability.toFixed(2)}
              </div>
            </div>
          ) : (
            <div style={{ marginTop: 'calc(var(--spacing) * 4)', textAlign: 'center' }}>
              <Button variant="primary" onClick={showAnswerCard}>
                显示答案（空格）
              </Button>
            </div>
          )}

          {/* 评分区：显示答案后出现 */}
          {showAnswer && (
            <div
              style={{
                marginTop: 'calc(var(--spacing) * 5)',
                display: 'grid',
                gridTemplateColumns: 'repeat(4, 1fr)',
                gap: 'calc(var(--spacing) * 3)',
              }}
            >
              {RATING_BUTTONS.map(({ rating, label, desc, bg, fg }) => (
                <button
                  key={rating}
                  type="button"
                  disabled={loading}
                  onClick={() => rateCard(rating)}
                  title={`按「${rating}」评分`}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: '0.25rem',
                    padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 2)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    background: bg,
                    color: fg,
                    cursor: loading ? 'not-allowed' : 'pointer',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                    opacity: loading ? 0.5 : 1,
                    transition: 'transform 0.15s ease, border-color 0.15s ease',
                  }}
                  onMouseDown={(e) => {
                    if (!loading) e.currentTarget.style.transform = 'scale(0.97)'
                  }}
                  onMouseUp={(e) => {
                    e.currentTarget.style.transform = 'scale(1)'
                  }}
                >
                  <span>{label}（{rating}）</span>
                  <span style={{ fontSize: '0.72rem', fontWeight: 400, opacity: 0.75 }}>{desc}</span>
                  {previewMap.get(rating) && (
                    <span style={{ fontSize: '0.72rem', fontWeight: 500, opacity: 0.9 }}>
                      {previewMap.get(rating)}后再复习
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </Card>
      )}
    </PageHero>
  )
}
