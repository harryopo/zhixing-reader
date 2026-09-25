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
import Badge from '../components/ui/Badge'
import { useReviewStore } from '../stores/reviewStore'
import { getCardMastery, getRetrievability } from '../../../shared/fsrs-metrics'
import { describeForgetting, describeNextReview, voiceTone } from '../../../shared/fsrs-voice'

/** 掌握度等级 → Badge 配色（与方法论页的语义保持一致，变体取自 ui/Badge 的 6 种） */
const MASTERY_BADGE: Record<string, 'success' | 'ok' | 'warning' | 'default'> = {
  精通: 'success',
  熟练: 'ok',
  进阶: 'warning',
  入门: 'default',
}

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
    lastMasteryDelta,
    roundStats,
    remaining,
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
      // 一轮做完（completed >= total）之后键盘必须彻底失效：
      // 否则按空格+数字会**静默给最后一张卡再评一次**，把「这一轮过了 N 张」也改掉。
      if (loading || !currentCard || completed >= total) return
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
  }, [loading, currentCard, showAnswer, showAnswerCard, rateCard, completed, total])

  const progress = total > 0 ? Math.round((completed / total) * 100) : 0

  /** 当前卡片的掌握度与保持率（均由 FSRS 状态推导，非写死） */
  const currentMastery = useMemo(
    () =>
      currentCard
        ? getCardMastery({
            stability: currentCard.stability ?? 0,
            difficulty: currentCard.difficulty ?? 0,
            reps: currentCard.reps ?? 0,
            lapses: currentCard.lapses ?? 0,
          })
        : null,
    [currentCard],
  )
  const currentRetention = useMemo(
    () =>
      currentCard
        ? getRetrievability(currentCard.stability ?? 0, currentCard.elapsedDays ?? 0)
        : 0,
    [currentCard],
  )

  /**
   * 这张卡的「遗忘播报」——界面上的主文案。
   * 用一句人话替代 stability / difficulty / 保持率 三个数字。
   */
  const currentVoice = useMemo(
    () =>
      currentCard
        ? describeForgetting({
            stability: currentCard.stability ?? 0,
            elapsedDays: currentCard.elapsedDays ?? 0,
            due: currentCard.due,
            reps: currentCard.reps ?? 0,
            lapses: currentCard.lapses ?? 0,
          })
        : null,
    [currentCard],
  )

  // 说明：roundStats 里仍然累计了 stability 的前后和，
  // 但界面不再展示「平均稳定性 12.3 → 46.4 天」——那个数字对读者没有意义。
  // 原始值可在「为什么这么说」里按卡片查看。

  return (
    <PageHero
      title="间隔复习"
      subtitle="基于 FSRS-6.0 间隔重复算法（Anki 同源），按记忆遗忘曲线安排复习节奏。展示划线原文，回忆语境后按实际记住程度评分。"
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
            {/*
              一批只取前 100 张，所以"过完这一轮"和"今日复习完了"是两件事。
              顶栏可能还写着剩 300 张 —— 这里必须跟着队列的真实剩余说，
              查不到就说查不到，不许替用户宣布做完。
            */}
            <h3 style={{ margin: '0 0 0.5rem', fontSize: '1.05rem' }}>
              {remaining === null
                ? '这一轮过完了'
                : remaining > 0
                  ? `这一轮过完了 · 今日还剩 ${remaining} 张`
                  : '今日复习完成'}
            </h3>
            <p style={{ margin: '0 0 calc(var(--spacing) * 5)', color: 'var(--muted-foreground)', fontSize: '0.875rem' }}>
              {remaining === null
                ? `过完 ${completed} 张。今日还剩多少张没查到，下一轮拉取时再核。`
                : remaining > 0
                  ? `过完 ${completed} 张，但今天没做完 —— 队列里还剩 ${remaining} 张。接着来，还是留给明天，都由你。`
                  : `过完 ${completed} 张。剩下的交给时间 —— 我会在它们快被忘掉的时候再叫你来。`}
            </p>

            {/*
              本轮统计。
              原来这里写的是「平均记忆稳定性 12.3 → 46.4 天」，用户看不懂；
              换成两个可以理解的量：复习张数，以及最远那张能记到哪天（一个具体日期）。
            */}
            {roundStats.reviewed > 0 && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 'calc(var(--spacing) * 3)',
                  maxWidth: 560,
                  margin: '0 auto calc(var(--spacing) * 5)',
                }}
              >
                <StatCell label="这一轮过了" value={`${roundStats.reviewed}`} unit="张" />
                <StatCell
                  label="最远的一张能记到"
                  value={roundStats.furthestDue ? formatDueDay(roundStats.furthestDue) : '—'}
                  unit=""
                />
                <StatCell
                  label="比上次记得更牢"
                  value={`${roundStats.improved}`}
                  unit="张"
                />
              </div>
            )}

            <Button variant="primary" onClick={() => fetchDueCards()}>
              {remaining !== null && remaining > 0 ? '继续下一批' : '再拉取一轮'}
            </Button>
          </div>
        </Card>
      )}

      {/* ===== 复习中 ===== */}
      {!loading && !error && currentCard && !isFinished && (
        <Card>
          {/* 上一张的反馈：一句承诺，而不是「掌握度 32 → 41」 */}
          {lastMasteryDelta && (
            <div
              role="status"
              aria-live="polite"
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 'calc(var(--spacing) * 3)',
                marginBottom: 'calc(var(--spacing) * 4)',
                padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 3)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                background: 'var(--muted)',
                fontSize: '0.82rem',
              }}
            >
              {/* 承诺句：把"掌握度 32 → 41"换成"我什么时候再来问你" */}
              <span style={{ fontWeight: 600, color: 'var(--foreground)' }}>
                {describeNextReview(lastMasteryDelta.nextReviewAt)}
              </span>
              <span
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.78rem',
                  color: 'var(--muted-foreground)',
                }}
                title={`掌握度 ${lastMasteryDelta.before} → ${lastMasteryDelta.after}`}
              >
                {lastMasteryDelta.after !== lastMasteryDelta.before && (
                  <span>
                    {lastMasteryDelta.after > lastMasteryDelta.before ? '↑' : '↓'}
                    {Math.abs(lastMasteryDelta.after - lastMasteryDelta.before)}
                  </span>
                )}
                <Badge variant={MASTERY_BADGE[lastMasteryDelta.levelAfter] ?? 'default'}>
                  {lastMasteryDelta.levelAfter}
                </Badge>
              </span>
            </div>
          )}

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

          {/* 卡片正面：问的东西（划线问原文，卡片问标题，方法论问"什么时候用"） */}
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
              whiteSpace: 'pre-wrap',
            }}
          >
            <Badge variant="ok" style={{ display: 'inline-block', marginBottom: 'calc(var(--spacing) * 2)' }}>
              {currentCard.label}
            </Badge>
            <div>{currentCard.front}</div>
          </blockquote>

          {/* 卡片背面：答案 + 出处 */}
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
              {currentCard.back && (
                <div style={{ fontSize: '0.98rem', lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                  {currentCard.back}
                </div>
              )}
              {currentCard.detail && (
                <div style={{ fontSize: '0.9rem', lineHeight: 1.7, whiteSpace: 'pre-wrap' }}>
                  {currentCard.detail}
                </div>
              )}
              {currentCard.sourceLine && (
                <div style={{ fontSize: '0.88rem', color: 'var(--muted-foreground)' }}>
                  出处：<strong style={{ color: 'var(--foreground)' }}>{currentCard.sourceLine}</strong>
                </div>
              )}
              {/* 主文案：一句人话。数字收进下面的「为什么这么说」里 */}
              {currentVoice && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 'calc(var(--spacing) * 3)',
                    flexWrap: 'wrap',
                  }}
                >
                  <strong
                    style={{
                      fontSize: '0.95rem',
                      fontWeight: 600,
                      color:
                        voiceTone(currentVoice.bucket) === 'urgent'
                          ? 'var(--destructive)'
                          : 'var(--foreground)',
                    }}
                  >
                    {currentVoice.sentence}
                  </strong>
                  {currentVoice.imperative && (
                    <span style={{ fontSize: '0.82rem', color: 'var(--muted-foreground)' }}>
                      {currentVoice.imperative}
                    </span>
                  )}
                </div>
              )}

              {/* 数字：默认收起来，想核对的人随时能展开 */}
              <details style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>
                <summary
                  style={{ cursor: 'pointer', listStyle: 'revert', width: 'fit-content' }}
                  data-dom-id="cta-why-say-so"
                >
                  为什么这么说
                </summary>
                <div
                  style={{
                    marginTop: '0.4rem',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'calc(var(--spacing) * 3)',
                    flexWrap: 'wrap',
                  }}
                >
                  {currentMastery && (
                    <Badge variant={MASTERY_BADGE[currentMastery.level] ?? 'default'}>
                      掌握度 {currentMastery.score} · {currentMastery.level}
                    </Badge>
                  )}
                  <span>
                    已复习 {currentCard.reps} 次 · 记忆稳定性 {currentCard.stability.toFixed(2)} 天
                    {currentCard.lapses > 0 ? ` · 遗忘 ${currentCard.lapses} 次` : ''}
                  </span>
                  <span>
                    当前保持率 {Math.round(currentRetention * 100)}%
                  </span>
                  {currentVoice?.dueLabel && <span>排定复习日 {currentVoice.dueLabel}</span>}
                </div>
              </details>
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

/** ISO 时间 → 「9月28日」（完成态展示用，不暴露算法量） */
function formatDueDay(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 完成态统计单元格 */
function StatCell({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div
      style={{
        padding: 'calc(var(--spacing) * 3)',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius)',
        background: 'var(--muted)',
      }}
    >
      <div style={{ fontSize: '0.75rem', color: 'var(--muted-foreground)', marginBottom: '0.35rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.15rem', fontWeight: 700, color: 'var(--foreground)' }}>
        {value}
        <span style={{ fontSize: '0.72rem', fontWeight: 400, color: 'var(--muted-foreground)', marginLeft: '0.2rem' }}>
          {unit}
        </span>
      </div>
    </div>
  )
}
