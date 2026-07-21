/**
 * Badge — 徽章（Google Design Library 风格）
 * 4 个变体：default / ok / alert / warning
 */

import { CSSProperties, ReactNode } from 'react'

type BadgeVariant = 'default' | 'ok' | 'alert' | 'warning' | 'success' | 'error'

interface BadgeProps {
  children: ReactNode
  variant?: BadgeVariant
  style?: CSSProperties
}

const VARIANT_STYLES: Record<BadgeVariant, Record<string, string>> = {
  default: {
    background: 'var(--secondary)',
    color: 'var(--secondary-foreground)',
  },
  ok: {
    background: 'var(--muted)',
    color: 'var(--foreground)',
  },
  alert: {
    background: 'var(--accent)',
    color: 'var(--accent-foreground)',
  },
  warning: {
    background: 'var(--state-warning)',
    color: '#ffffff',
  },
  success: {
    background: 'var(--state-success)',
    color: '#ffffff',
  },
  error: {
    background: 'var(--state-error)',
    color: '#ffffff',
  },
}

export default function Badge({ children, variant = 'default', style }: BadgeProps) {
  const variantStyle = VARIANT_STYLES[variant]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.34rem 0.65rem',
        borderRadius: 999,
        fontSize: '0.8rem',
        whiteSpace: 'nowrap',
        ...variantStyle,
        ...style,
      }}
    >
      {children}
    </span>
  )
}
