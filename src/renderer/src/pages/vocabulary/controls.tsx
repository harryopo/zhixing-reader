/** 筛选 chips / 掌握度徽标 / 评分按钮 / 图标按钮（从 VocabularyPage.tsx 原样搬出，逻辑未改） */
import { FILTERS, ReviewRating, masteryLabel, type FilterKey, type MasteryKind } from './model'

interface FilterChipsProps {
  value: FilterKey
  onChange: (v: FilterKey) => void
}
function FilterChips({ value, onChange }: FilterChipsProps) {
  return (
    <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 2)', flexWrap: 'wrap' }}>
      {FILTERS.map((item) => {
        const active = item.key === value
        return (
          <button
            key={item.key}
            type="button"
            data-active={active ? 'true' : undefined}
            onClick={() => onChange(item.key)}
            style={{
              padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 4)',
              border: '1px solid',
              borderColor: active ? 'var(--primary)' : 'var(--border)',
              background: active ? 'var(--primary)' : 'var(--card)',
              color: active ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              transition:
                'background 0.2s ease, color 0.2s ease, border-color 0.2s ease, transform 0.16s ease',
              fontSize: '0.84rem',
              whiteSpace: 'nowrap',
              font: 'inherit',
            }}
            onMouseEnter={(e) => {
              if (!active) {
                e.currentTarget.style.borderColor = 'var(--ring)'
                e.currentTarget.style.color = 'var(--foreground)'
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                e.currentTarget.style.borderColor = 'var(--border)'
                e.currentTarget.style.color = 'var(--muted-foreground)'
              }
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.97)'
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

// ===== 子组件：Mastery Badge =====
function MasteryBadge({ kind }: { kind: MasteryKind }) {
  const colors: Record<MasteryKind, { bg: string; color: string }> = {
    pending: {
      bg: 'color-mix(in srgb, var(--state-error) 12%, transparent)',
      color: 'var(--state-error)',
    },
    mastered: {
      bg: 'color-mix(in srgb, var(--state-success) 14%, transparent)',
      color: 'var(--state-success)',
    },
    new: {
      bg: 'color-mix(in srgb, var(--state-info) 12%, transparent)',
      color: 'var(--state-info)',
    },
  }
  const c = colors[kind]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0.28rem 0.6rem',
        borderRadius: 999,
        fontSize: '0.75rem',
        whiteSpace: 'nowrap',
        justifySelf: 'end',
        fontWeight: 600,
        background: c.bg,
        color: c.color,
      }}
    >
      {masteryLabel(kind)}
    </span>
  )
}

// ===== 子组件：复习评分按钮 =====
interface ReviewRatingButtonProps {
  rating: ReviewRating
  label: string
  color: 'error' | 'warning' | 'info' | 'success'
  onClick: (r: ReviewRating) => void
  /** 提交中时禁用：连点会让同一个词被评两次 */
  disabled?: boolean
}
function ReviewRatingButton({ rating, label, color, onClick, disabled = false }: ReviewRatingButtonProps) {
  const colorMap: Record<ReviewRatingButtonProps['color'], string> = {
    error: 'var(--state-error)',
    warning: 'var(--state-warning)',
    info: 'var(--state-info)',
    success: 'var(--state-success)',
  }
  const c = colorMap[color]
  return (
    <button
      type="button"
      onClick={() => onClick(rating)}
      disabled={disabled}
      style={{
        padding: 'calc(var(--spacing) * 4) calc(var(--spacing) * 3)',
        background: `color-mix(in srgb, ${c} 12%, transparent)`,
        color: c,
        border: '1px solid transparent',
        borderRadius: 'var(--radius)',
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        fontWeight: 500,
        font: 'inherit',
        transition: 'background 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = `color-mix(in srgb, ${c} 20%, transparent)`
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = `color-mix(in srgb, ${c} 12%, transparent)`
      }}
    >
      <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{label}</div>
    </button>
  )
}

// ===== 子组件：IconButton（小型图标按钮，如发音按钮） =====
interface IconButtonProps {
  children: React.ReactNode
  onClick: () => void
  ariaLabel: string
  dataDomId?: string
}
function IconButton({ children, onClick, ariaLabel, dataDomId }: IconButtonProps) {
  return (
    <button
      type="button"
      data-dom-id={dataDomId}
      aria-label={ariaLabel}
      onClick={onClick}
      style={{
        width: 36,
        height: 36,
        display: 'grid',
        placeItems: 'center',
        border: '1px solid var(--border)',
        background: 'var(--card)',
        color: 'var(--foreground)',
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        flexShrink: 0,
        transition:
          'background 0.2s ease, color 0.2s ease, border-color 0.2s ease, transform 0.16s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--sidebar-accent)'
        e.currentTarget.style.color = 'var(--sidebar-accent-foreground)'
        e.currentTarget.style.borderColor = 'var(--sidebar-border)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--card)'
        e.currentTarget.style.color = 'var(--foreground)'
        e.currentTarget.style.borderColor = 'var(--border)'
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = 'scale(0.97)'
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = 'scale(1)'
      }}
    >
      {children}
    </button>
  )
}

// ===== 子组件：抽屉 =====

export { FilterChips, MasteryBadge, ReviewRatingButton, IconButton }
