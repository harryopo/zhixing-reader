/**
 * Badge — 徽章（Google Design Library 风格）
 * 6 个变体：default / ok / alert / warning / success / error
 * 文字与背景对比度均满足 WCAG AA（≥ 4.5:1）
 */

import { CSSProperties, HTMLAttributes, ReactNode } from 'react'

type BadgeVariant = 'default' | 'ok' | 'alert' | 'warning' | 'success' | 'error'

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
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
    /* #fbbc05 黄色背景上白字对比度仅 1.6:1,改深色文字（对比度 ~11:1,过 AA） */
    background: 'var(--state-warning)',
    color: 'var(--foreground)',
  },
  success: {
    /* emerald-700 #047857 + 白字对比度 4.8:1,过 AA */
    background: 'var(--emerald-700)',
    color: '#ffffff',
  },
  error: {
    /* #dc2626 + 白字对比度 4.5:1,过 AA */
    background: 'var(--destructive)',
    color: '#ffffff',
  },
}

export default function Badge({ children, variant = 'default', style, ...rest }: BadgeProps) {
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
        fontWeight: 500,
        lineHeight: 1.4,
        whiteSpace: 'nowrap',
        ...variantStyle,
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  )
}
