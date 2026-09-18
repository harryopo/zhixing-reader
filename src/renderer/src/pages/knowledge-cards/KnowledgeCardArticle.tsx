/** 卡片正文（正面/反面翻转）（从 KnowledgeCards.tsx 原样搬出，逻辑未改） */
import type { CSSProperties } from 'react'
import Icon from '@/components/ui/Icon'
import { formatDate, formatTimeAgo, safeNum } from '../../utils/db-mapper'
import { typeConfig, type KnowledgeCardItem } from './model'
import { aiGenBtnStyle, iconBtnStyle, spinnerStyle } from './styles'

interface KnowledgeCardArticleProps {
  card: KnowledgeCardItem
  isFlipped: boolean
  onFlip: () => void
  onClose: () => void
  onDelete: () => void
  onGenerateInterpretation: () => void
  onGenerateApplication: () => void
  getBookTitle: (bookId: string) => string
  generating: 'interpretation' | 'application' | null
}

function KnowledgeCardArticle({
  card,
  isFlipped,
  onFlip,
  onClose,
  onDelete,
  onGenerateInterpretation,
  onGenerateApplication,
  getBookTitle,
  generating,
}: KnowledgeCardArticleProps) {
  const typeInfo = typeConfig[card.type]
  const bookTitle = getBookTitle(card.bookId)
  const timeLabel = formatTimeAgo(card.updatedAt || card.createdAt)

  const articleStyle: CSSProperties = {
    padding: 'calc(var(--spacing) * 5)',
    border: '1px solid var(--border)',
    borderRadius: 'calc(var(--radius) + 4px)',
    background: 'var(--card)',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 'calc(var(--spacing) * 3)',
    transition: 'border-color 0.2s ease, transform 0.16s ease',
    position: 'relative',
  }

  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.borderColor = 'var(--ring)'
    e.currentTarget.style.transform = 'translateY(-2px)'
  }
  const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.borderColor = 'var(--border)'
    e.currentTarget.style.transform = 'translateY(0)'
  }

  return (
    <article
      data-dom-id={`card-${card.id}`}
      style={articleStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={onFlip}
    >
      {!isFlipped ? (
        <>
          {/* 顶部：badge + 书名 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 'calc(var(--spacing) * 3)',
            }}
          >
            <span style={typeInfo.badgeStyle}>{typeInfo.label}</span>
            <span
              style={{
                fontSize: '0.72rem',
                color: 'var(--muted-foreground)',
                fontFamily: 'var(--font-mono)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '60%',
              }}
            >
              《{bookTitle}》
            </span>
          </div>

          {/* 标题 */}
          <h3
            style={{
              margin: 0,
              fontSize: '1rem',
              fontWeight: 600,
              color: 'var(--card-foreground)',
              lineHeight: 1.5,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {card.title}
          </h3>

          {/* 内容预览 */}
          <p
            style={{
              margin: 0,
              fontSize: '0.88rem',
              lineHeight: 1.7,
              color: 'var(--muted-foreground)',
              flex: 1,
              display: '-webkit-box',
              WebkitLineClamp: 4,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {card.content}
          </p>

          {/* 底部：时间 + 3 icon-btn */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingTop: 'calc(var(--spacing) * 3)',
              borderTop: '1px solid var(--border)',
            }}
          >
            <span
              style={{
                fontSize: '0.72rem',
                color: 'var(--muted-foreground)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {timeLabel}
            </span>
            <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 2)' }}>
              <button
                type="button"
                aria-label="删除"
                data-dom-id={`card-${card.id}-delete`}
                style={iconBtnStyle(false)}
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          </div>
        </>
      ) : (
        /* 卡片反面：保留所有详情/AI/标签/评分逻辑 */
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 顶部 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 'calc(var(--spacing) * 3)',
            }}
          >
            <span style={typeInfo.badgeStyle}>{typeInfo.label}</span>
            <button type="button" aria-label="收起" onClick={onClose} style={iconBtnStyle(false)}>
              <Icon name="close" size={14} />
            </button>
          </div>

          {/* 标题 + 书名 */}
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: '1rem',
                fontWeight: 600,
                color: 'var(--card-foreground)',
                lineHeight: 1.5,
              }}
            >
              {card.title}
            </h3>
            <p
              style={{
                margin: '0.25rem 0 0',
                fontSize: '0.72rem',
                color: 'var(--muted-foreground)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              《{bookTitle}》
            </p>
          </div>

          {/* 内容 */}
          <div>
            <h4
              style={{
                margin: 0,
                fontSize: '0.72rem',
                fontWeight: 500,
                color: 'var(--muted-foreground)',
                marginBottom: 'calc(var(--spacing) * 1.5)',
              }}
            >
              内容
            </h4>
            <p
              style={{
                margin: 0,
                fontSize: '0.875rem',
                lineHeight: 1.7,
                color: 'var(--card-foreground)',
              }}
            >
              {card.content}
            </p>
          </div>

          {/* 解读（AI 生成） */}
          {card.interpretation ? (
            <div>
              <h4
                style={{
                  margin: 0,
                  fontSize: '0.72rem',
                  fontWeight: 500,
                  color: 'var(--muted-foreground)',
                  marginBottom: 'calc(var(--spacing) * 1.5)',
                }}
              >
                解读
              </h4>
              <p
                style={{
                  margin: 0,
                  fontSize: '0.875rem',
                  lineHeight: 1.7,
                  color: 'var(--card-foreground)',
                }}
              >
                {card.interpretation}
              </p>
            </div>
          ) : (
            <div
              style={{
                background: 'var(--muted)',
                borderRadius: 'var(--radius)',
                padding: 'calc(var(--spacing) * 3)',
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: '0.75rem',
                  color: 'var(--muted-foreground)',
                  marginBottom: 'calc(var(--spacing) * 2)',
                }}
              >
                暂无解读
              </p>
              <button
                type="button"
                onClick={onGenerateInterpretation}
                disabled={!!generating}
                style={aiGenBtnStyle(!!generating)}
                onMouseEnter={(e) => {
                  if (!generating) e.currentTarget.style.borderColor = 'var(--ring)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)'
                }}
              >
                {generating === 'interpretation' ? (
                  <>
                    <span style={spinnerStyle} />
                    生成中...
                  </>
                ) : (
                  <>
                    <Icon name="agent" size={12} /> AI 生成解读
                  </>
                )}
              </button>
            </div>
          )}

          {/* 应用（AI 生成） */}
          {card.application ? (
            <div>
              <h4
                style={{
                  margin: 0,
                  fontSize: '0.72rem',
                  fontWeight: 500,
                  color: 'var(--muted-foreground)',
                  marginBottom: 'calc(var(--spacing) * 1.5)',
                }}
              >
                应用
              </h4>
              <p
                style={{
                  margin: 0,
                  fontSize: '0.875rem',
                  lineHeight: 1.7,
                  color: 'var(--card-foreground)',
                }}
              >
                {card.application}
              </p>
            </div>
          ) : (
            <div
              style={{
                background: 'var(--muted)',
                borderRadius: 'var(--radius)',
                padding: 'calc(var(--spacing) * 3)',
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: '0.75rem',
                  color: 'var(--muted-foreground)',
                  marginBottom: 'calc(var(--spacing) * 2)',
                }}
              >
                暂无应用场景
              </p>
              <button
                type="button"
                onClick={onGenerateApplication}
                disabled={!!generating}
                style={aiGenBtnStyle(!!generating)}
                onMouseEnter={(e) => {
                  if (!generating) e.currentTarget.style.borderColor = 'var(--ring)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)'
                }}
              >
                {generating === 'application' ? (
                  <>
                    <span style={spinnerStyle} />
                    生成中...
                  </>
                ) : (
                  <>
                    <Icon name="agent" size={12} /> AI 生成应用场景
                  </>
                )}
              </button>
            </div>
          )}

          {/* 标签 */}
          {card.tags && card.tags.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'calc(var(--spacing) * 2)',
                flexWrap: 'wrap',
              }}
            >
              {card.tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    padding: '0.2rem 0.6rem',
                    fontSize: '0.72rem',
                    background: 'var(--muted)',
                    color: 'var(--muted-foreground)',
                    borderRadius: '999px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* 复习信息 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '0.72rem',
              color: 'var(--muted-foreground)',
              paddingTop: 'calc(var(--spacing) * 2)',
              borderTop: '1px solid var(--border)',
            }}
          >
            <span>
              复习 {safeNum(card.reviewCount)} 次
            </span>
            <span title="基于您的划线/笔记提取">{formatDate(card.createdAt)}</span>
          </div>

          {/* 底部时间 + 3 icon-btn */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingTop: 'calc(var(--spacing) * 3)',
              borderTop: '1px solid var(--border)',
            }}
          >
            <span
              style={{
                fontSize: '0.72rem',
                color: 'var(--muted-foreground)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {timeLabel}
            </span>
            <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 2)' }}>
              <button
                type="button"
                aria-label="删除"
                style={iconBtnStyle(false)}
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  )
}

export { KnowledgeCardArticle }
