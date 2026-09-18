/** 方法论卡片（从 Methodologies.tsx 原样搬出，逻辑未改） */
import Icon from '@/components/ui/Icon'
import { safeNum, safeStr } from '../../utils/db-mapper'
import type { MethodologyItem } from './model'
import { IconBookOpen, IconCheckCircle } from './icons'
import { getMasteryLabel, getMasteryProgress, getTriggerBadge } from './helpers'

interface MethodCardV2Props {
  methodology: MethodologyItem
  index: number
  bookTitle: string
  active: boolean
  onSelect: () => void
  onDelete: () => void
}

function MethodCardV2({ methodology, index, bookTitle, active, onSelect, onDelete }: MethodCardV2Props) {
  const pct = getMasteryProgress(methodology.masteryLevel)
  const lvl = getMasteryLabel(methodology.masteryLevel)
  const badge = getTriggerBadge(methodology, index)

  return (
    <article
      className="method-card-v2"
      data-active={active}
      data-method-id={methodology.id}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      style={{
        padding: 'calc(var(--spacing) * 5)',
        border: '1px solid',
        borderColor: active ? 'var(--primary)' : 'var(--border)',
        borderRadius: 'calc(var(--radius) + 4px)',
        background: 'var(--card)',
        cursor: 'pointer',
        transition: 'border-color 0.2s ease, transform 0.16s ease',
        boxShadow: active ? '0 0 0 1px var(--primary)' : 'var(--shadow-sm)',
        outline: 'none',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.borderColor = 'var(--ring)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.borderColor = 'var(--border)'
      }}
      onFocus={(e) => {
        e.currentTarget.style.outline = '2px solid var(--ring)'
        e.currentTarget.style.outlineOffset = '2px'
      }}
      onBlur={(e) => {
        e.currentTarget.style.outline = 'none'
      }}
    >
      {/* 头部：trigger badge + name + mastery */}
      <div
        className="mc-head"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 'calc(var(--spacing) * 3)',
          marginBottom: 'calc(var(--spacing) * 3)',
        }}
      >
        <div className="mc-info" style={{ minWidth: 0, flex: 1 }}>
          {badge && (
            <span
              className="mc-trigger"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.28rem 0.7rem',
                borderRadius: 999,
                fontSize: '0.72rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                lineHeight: 1,
                background: badge.bg,
                color: badge.color,
              }}
            >
              {badge.text}
            </span>
          )}
          <div
            className="mc-name"
            style={{
              fontSize: '1.02rem',
              fontWeight: 600,
              marginTop: '0.5rem',
              color: 'var(--card-foreground)',
              textWrap: 'balance',
              wordBreak: 'keep-all',
              overflowWrap: 'break-word',
            }}
          >
            {safeStr(methodology.name)}
          </div>
          {methodology.nameEn && (
            <div
              className="mc-name-en"
              style={{
                fontSize: '0.78rem',
                color: 'var(--muted-foreground)',
                marginTop: '0.2rem',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {safeStr(methodology.nameEn)}
            </div>
          )}
        </div>
        <div
          className="mc-mastery"
          style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}
        >
          <div style={{ fontSize: '0.82rem', color: 'var(--foreground)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
            {pct}%
          </div>
          <div
            className="progress-track"
            style={{
              width: 84,
              height: 4,
              background: 'var(--muted)',
              borderRadius: 999,
              overflow: 'hidden',
            }}
          >
            <div
              className="progress-fill"
              style={{
                height: '100%',
                width: `${pct}%`,
                background: 'var(--primary)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <div
            className="lvl"
            style={{ fontSize: '0.7rem', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em' }}
          >
            {lvl}
          </div>
        </div>
      </div>

      {/* 标签 */}
      {methodology.tags && methodology.tags.length > 0 && (
        <div
          className="mc-tags"
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginTop: 'calc(var(--spacing) * 3)' }}
        >
          {methodology.tags.map((tag) => (
            <span
              key={tag}
              className="mc-tag"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0.24rem 0.6rem',
                borderRadius: 'var(--radius)',
                background: 'var(--muted)',
                color: 'var(--muted-foreground)',
                fontSize: '0.72rem',
                whiteSpace: 'nowrap',
              }}
            >
              {safeStr(tag)}
            </span>
          ))}
        </div>
      )}

      {/* 元信息：练习次数 + 来源书 + 删除 */}
      <div
        className="mc-meta"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'calc(var(--spacing) * 4)',
          marginTop: 'calc(var(--spacing) * 4)',
          paddingTop: 'calc(var(--spacing) * 3)',
          borderTop: '1px solid var(--border)',
          fontSize: '0.76rem',
          color: 'var(--muted-foreground)',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap' }}>
          <span className="glyph" style={{ width: '0.95rem', flex: '0 0 0.95rem', color: 'var(--muted-foreground)', display: 'inline-flex' }}>
            <IconCheckCircle size={14} />
          </span>
          练习 {safeNum(methodology.practiceCount)} 次
        </span>
        <span className="src" style={{ minWidth: 0, flex: 1, display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          <span className="glyph" style={{ width: '0.95rem', flex: '0 0 0.95rem', color: 'var(--muted-foreground)', display: 'inline-flex' }}>
            <IconBookOpen size={14} />
          </span>
          <b style={{ fontWeight: 600, color: 'var(--card-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {bookTitle}
          </b>
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          aria-label="删除方法论"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            padding: '0.2rem 0.5rem',
            border: 'none',
            background: 'transparent',
            color: 'var(--destructive)',
            cursor: 'pointer',
            fontSize: '0.72rem',
            fontFamily: 'inherit',
            borderRadius: 'var(--radius)',
            transition: 'background 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'color-mix(in srgb, var(--destructive) 12%, transparent)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <Icon name="trash" size={13} />
          删除
        </button>
      </div>
    </article>
  )
}

export { MethodCardV2 }
