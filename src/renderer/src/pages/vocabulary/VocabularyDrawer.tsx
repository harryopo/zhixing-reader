/** 生词详情抽屉（例句/复习数据等区块从 VocabularyPage.tsx 搬出，逻辑未改） */
import { useEffect, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import Modal from '@/components/ui/Modal'
import { describeForgetting } from '../../../../shared/fsrs-voice'
import { articleDeepLink } from '../../../../shared/source-anchor'
import { calcMasteryPct, formatDateOnly, masteryStatusColor, masteryStatusLabel, type VocabularyItem } from './model'
import { sectionLabelStyle } from './styles'
import { IconButton } from './controls'

interface VocabularyDrawerProps {
  item: VocabularyItem
  onClose: () => void
  onPronounce: (word: string) => void
  onAddReview: (id: string) => void
  onMarkMastered: (id: string) => void
  onDelete: (id: string, word: string) => void
}
function VocabularyDrawer({
  item,
  onClose,
  onPronounce,
  onAddReview,
  onMarkMastered,
  onDelete,
}: VocabularyDrawerProps) {
  const masteryPct = calcMasteryPct(item)
  const statusColor = masteryStatusColor(masteryPct)
  const statusLabel = masteryStatusLabel(masteryPct)
  /**
   * 这个词的「遗忘播报」——与复习页共用同一个模块，全应用只有一张嘴。
   * elapsedDays 由 last_review_at 现算：生词表没有存这个派生量。
   */
  const elapsedDays = item.last_review_at
    ? Math.max(0, Math.floor((Date.now() - new Date(item.last_review_at).getTime()) / 86400000))
    : 0
  const voice = describeForgetting({
    stability: item.stability ?? 0,
    elapsedDays: Number.isFinite(elapsedDays) ? elapsedDays : 0,
    due: item.next_review_at ?? null,
    reps: item.repetition_count ?? item.review_count ?? 0,
    lapses: item.lapses ?? 0,
  })

  /*
    这个词是在哪篇文章里遇到的：id 从导入时就存在 vocabulary.source_article_id，
    抽屉里以前从来不显示 —— 记不住一个词往往是因为忘了当时的语境，
    所以这里既报出篇名，也给一条回到文章的路。
  */
  const navigate = useNavigate()
  const [sourceArticleTitle, setSourceArticleTitle] = useState<string | null>(null)
  const sourceArticleId = item.source_article_id ?? null
  useEffect(() => {
    setSourceArticleTitle(null)
    if (!sourceArticleId) return
    let alive = true
    window.electronAPI.article
      .getById(sourceArticleId)
      .then((raw: unknown) => {
        if (!alive || !raw || typeof raw !== 'object') return
        const row = raw as Record<string, unknown>
        const zh = typeof row.title_zh === 'string' ? row.title_zh : ''
        const en = typeof row.title_en === 'string' ? row.title_en : ''
        setSourceArticleTitle(zh || en || null)
      })
      .catch(() => {
        if (alive) setSourceArticleTitle(null)
      })
    return () => {
      alive = false
    }
  }, [sourceArticleId])

  // ESC / 遮罩 / 焦点由 ui/Modal 原语负责
  return (
    <Modal
      onClose={onClose}
      variant="drawer-right"
      ariaLabel={item.word}
      width={420}
      padded={false}
      overlayStyle={{ animation: 'scrim-in 0.24s cubic-bezier(.3,0,0,1)' }}
      panelStyle={{ animation: 'drawer-in 0.28s cubic-bezier(.3,0,0,1)', maxWidth: '100vw' }}
    >
      <style>{`
        @keyframes scrim-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes drawer-in { from { transform: translateX(100%) } to { transform: translateX(0) } }
      `}</style>

      {/* ===== header ===== */}
        <header
          style={{
            padding: 'calc(var(--spacing) * 6)',
            borderBottom: '1px solid var(--border)',
            position: 'relative',
            flexShrink: 0,
            background: 'var(--card)',
          }}
        >
          <button
            type="button"
            data-dom-id="cta-close"
            aria-label="关闭抽屉"
            onClick={onClose}
            style={{
              position: 'absolute',
              top: 'calc(var(--spacing) * 5)',
              right: 'calc(var(--spacing) * 5)',
              width: 32,
              height: 32,
              display: 'grid',
              placeItems: 'center',
              border: 'none',
              background: 'transparent',
              color: 'var(--muted-foreground)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              transition: 'background 0.16s ease, color 0.16s ease, transform 0.16s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--muted)'
              e.currentTarget.style.color = 'var(--foreground)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--muted-foreground)'
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.94)'
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            <Icon name="close" size={18} />
          </button>
          <h2
            id="drawer-word-title"
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '1.75rem',
              fontWeight: 700,
              color: 'var(--card-foreground)',
              letterSpacing: '-0.01em',
              lineHeight: 1.2,
              wordBreak: 'keep-all',
              overflowWrap: 'break-word',
              paddingRight: 'calc(var(--spacing) * 8)',
              margin: 0,
            }}
          >
            {item.word}
          </h2>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'calc(var(--spacing) * 3)',
              marginTop: '0.55rem',
              flexWrap: 'wrap',
            }}
          >
            {item.phonetic && (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.9rem',
                  color: 'var(--muted-foreground)',
                }}
              >
                {item.phonetic}
              </span>
            )}
            {item.part_of_speech && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0.28rem 0.7rem',
                  borderRadius: 999,
                  background: 'var(--secondary)',
                  color: 'var(--secondary-foreground)',
                  fontSize: '0.78rem',
                  whiteSpace: 'nowrap',
                  fontWeight: 600,
                }}
              >
                {item.part_of_speech}
              </span>
            )}
            <IconButton
              dataDomId="cta-pronounce"
              ariaLabel="播放发音"
              onClick={() => onPronounce(item.word)}
            >
              <Icon name="play" size={16} />
            </IconButton>
          </div>
        </header>

        {/* ===== body ===== */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 'calc(var(--spacing) * 6)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'calc(var(--spacing) * 6)',
            minHeight: 0,
          }}
        >
          {/* 释义 */}
          <section
            style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)' }}
          >
            <span style={sectionLabelStyle}>释义</span>
            <div>
              <p
                style={{
                  fontSize: '1rem',
                  lineHeight: 1.6,
                  color: 'var(--card-foreground)',
                  fontWeight: 600,
                  margin: 0,
                }}
              >
                {item.meaning_zh}
              </p>
              {item.part_of_speech && (
                <p
                  style={{
                    fontSize: '0.84rem',
                    lineHeight: 1.6,
                    color: 'var(--muted-foreground)',
                    fontFamily: 'var(--font-mono)',
                    marginTop: '0.5rem',
                    wordBreak: 'break-word',
                    margin: '0.5rem 0 0 0',
                  }}
                >
                  {item.part_of_speech}
                </p>
              )}
            </div>
          </section>

          {/* 例句 */}
          {item.example_en && (
            <section
              style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)' }}
            >
              <span style={sectionLabelStyle}>例句</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 4)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <p
                    style={{
                      fontSize: '0.9rem',
                      lineHeight: 1.65,
                      color: 'var(--card-foreground)',
                      fontStyle: 'italic',
                      wordBreak: 'break-word',
                      margin: 0,
                    }}
                  >
                    {item.example_en}
                  </p>
                  {item.example_zh && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        alignSelf: 'flex-start',
                        padding: '0.22rem 0.6rem',
                        borderRadius: 'var(--radius)',
                        background: 'var(--muted)',
                        color: 'var(--muted-foreground)',
                        fontSize: '0.72rem',
                        whiteSpace: 'nowrap',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {item.example_zh}
                    </span>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* 出处 */}
          {sourceArticleId && (
            <section
              style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)' }}
            >
              <span style={sectionLabelStyle}>出处</span>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 'calc(var(--spacing) * 3)',
                }}
              >
                <span style={{ fontSize: '0.85rem', color: 'var(--card-foreground)' }}>
                  {sourceArticleTitle ?? '这篇文章已经不在了'}
                </span>
                {sourceArticleTitle && (
                  <Button
                    variant="ghost"
                    onClick={() => navigate(articleDeepLink(sourceArticleId))}
                  >
                    <Icon name="arrow-right" size={14} /> 回到文章
                  </Button>
                )}
              </div>
            </section>
          )}

          {/* 复习数据 */}
          <section
            style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)' }}
          >
            <span style={sectionLabelStyle}>复习数据</span>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 'calc(var(--spacing) * 4) calc(var(--spacing) * 4)',
              }}
            >
              <MetaItem label="添加日期" value={formatDateOnly(item.created_at)} mono />
              <MetaItem label="复习次数" value={`${item.review_count} 次`} mono />
              {/*
                这里原本是「记忆稳定性 46.3 天 / 当前保持率 87%」两个数字。
                读者无从判断 46.3 是好是坏，也做不了任何动作 —— 换成一句结论。
              */}
              <MetaItem
                label="什么时候该再看"
                value={voice ? voice.sentence : '—'}
                style={{ color: statusColor }}
              />
              <MetaItem label="状态" value={statusLabel} style={{ color: statusColor }} />
            </div>
            {/* 掌握度进度条 */}
            <div
              style={{
                marginTop: 'calc(var(--spacing) * 4)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              <div
                style={{
                  height: 8,
                  borderRadius: 999,
                  background: 'var(--muted)',
                  overflow: 'hidden',
                }}
              >
                <div
                  role="progressbar"
                  aria-valuenow={masteryPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`掌握度 ${masteryPct}%`}
                  style={{
                    height: '100%',
                    width: `${masteryPct}%`,
                    borderRadius: 999,
                    background: statusColor,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span
                  style={{
                    fontSize: '0.78rem',
                    color: statusColor,
                    fontWeight: 600,
                  }}
                >
                  {masteryStatusLabel(masteryPct)}
                  {voice.imperative && (
                    <span style={{ fontWeight: 400, color: 'var(--muted-foreground)', marginLeft: '0.4rem' }}>
                      · {voice.imperative}
                    </span>
                  )}
                </span>
                <span
                  style={{
                    fontSize: '0.78rem',
                    color: 'var(--muted-foreground)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {masteryPct}%
                </span>
              </div>
            </div>
          </section>
        </div>

        {/* ===== footer ===== */}
        <footer
          style={{
            padding: 'calc(var(--spacing) * 5) calc(var(--spacing) * 6)',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'calc(var(--spacing) * 3)',
            flexShrink: 0,
            background: 'var(--card)',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 'calc(var(--spacing) * 3)',
              flexWrap: 'wrap',
            }}
          >
            <Button
              variant="primary"
              // 原来这里和页头的「批量复习」共用 data-dom-id="cta-review"，
              // 同一个名字下面是两个完全不同的动作（一个进复习模式、一个记一次 Good 评分）
              data-dom-id="cta-review-word"
              onClick={() => onAddReview(item.id)}
              style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}
            >
              加入复习
            </Button>
            <Button
              variant="secondary"
              data-dom-id="cta-master"
              onClick={() => onMarkMastered(item.id)}
              style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}
            >
              标记已掌握
            </Button>
          </div>
          <button
            type="button"
            data-dom-id="cta-delete"
            onClick={() => onDelete(item.id, item.word)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--state-error)',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: 'pointer',
              padding: 'calc(var(--spacing) * 2) 0',
              transition: 'color 0.2s ease, text-decoration 0.2s ease',
              textAlign: 'center',
              borderRadius: 'var(--radius)',
              font: 'inherit',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.textDecoration = 'underline'
              e.currentTarget.style.textUnderlineOffset = '3px'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.textDecoration = 'none'
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.98)'
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            删除该生词
          </button>
        </footer>
    </Modal>
  )
}

// ===== MetaItem =====
interface MetaItemProps {
  label: string
  value: string
  mono?: boolean
  style?: CSSProperties
}
function MetaItem({ label, value, mono, style }: MetaItemProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0 }}>
      <span
        style={{
          fontSize: '0.7rem',
          color: 'var(--muted-foreground)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: '0.88rem',
          color: 'var(--card-foreground)',
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          ...(mono
            ? { fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 400 }
            : {}),
          ...style,
        }}
      >
        {value}
      </span>
    </div>
  )
}

// ===== 共享 style =====

export { VocabularyDrawer }
