/**
 * Card — 卡片（Google Design Library 风格）
 * 边框分层 / 圆角 var(--radius)+6px / 轻微 shadow
 * 支持 interactive（hover 上浮 + shadow 加深 + 边框变色）
 */

import { CSSProperties, ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  interactive?: boolean
  className?: string
  style?: CSSProperties
  onClick?: () => void
  /** 自定义内边距（默认 var(--spacing)*5） */
  padding?: CSSProperties['padding']
}

export default function Card({ children, interactive, className, style, onClick, padding }: CardProps) {
  const baseStyle: CSSProperties = {
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: 'calc(var(--radius) + 6px)',
    padding: padding ?? 'calc(var(--spacing) * 5)',
    color: 'var(--card-foreground)',
    ...(interactive
      ? {
          transition:
            'transform 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease',
          cursor: 'pointer',
          boxShadow: 'var(--shadow-xs)',
        }
      : {}),
  }

  const handleMouseEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    if (interactive) {
      e.currentTarget.style.borderColor = 'var(--ring)'
      e.currentTarget.style.transform = 'translateY(-2px)'
      e.currentTarget.style.boxShadow = 'var(--shadow-md)'
    }
  }
  const handleMouseLeave = (e: React.MouseEvent<HTMLDivElement>) => {
    if (interactive) {
      e.currentTarget.style.borderColor = 'var(--border)'
      e.currentTarget.style.transform = 'translateY(0)'
      e.currentTarget.style.boxShadow = 'var(--shadow-xs)'
    }
  }

  return (
    <div
      className={className}
      style={{ ...baseStyle, ...style }}
      onClick={onClick}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {children}
    </div>
  )
}

/** 卡片头（标题 + 副标题 + 右侧操作） */
export function CardHead({
  eyebrow,
  title,
  action,
}: {
  eyebrow?: string
  title: string
  action?: ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 'calc(var(--spacing) * 3)',
        marginBottom: 'calc(var(--spacing) * 4)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        {eyebrow && (
          <div
            style={{
              color: 'var(--muted-foreground)',
              fontSize: '0.78rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: '0.2rem',
            }}
          >
            {eyebrow}
          </div>
        )}
        <strong style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)' }}>{title}</strong>
      </div>
      {action && <div style={{ flexShrink: 0 }}>{action}</div>}
    </div>
  )
}
