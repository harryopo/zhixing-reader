/**
 * Loading / EmptyState / Metric — 通用辅助组件
 */

import { CSSProperties, ReactNode } from 'react'

/** 全屏 loading */
export function Loading({ hint = '加载中...' }: { hint?: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        minHeight: 200,
        gap: 'calc(var(--spacing) * 3)',
        color: 'var(--muted-foreground)',
        fontSize: '0.9rem',
      }}
    >
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: '50%',
          border: '2px solid var(--border)',
          borderTopColor: 'var(--primary)',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <span>{hint}</span>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </div>
  )
}

interface EmptyStateProps {
  icon?: ReactNode
  title: string
  description?: string
  action?: ReactNode
  style?: CSSProperties
}

export function EmptyState({ icon, title, description, action, style }: EmptyStateProps) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 'calc(var(--spacing) * 12) calc(var(--spacing) * 6)',
        textAlign: 'center',
        gap: 'calc(var(--spacing) * 3)',
        ...style,
      }}
    >
      {icon && (
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'var(--secondary)',
            color: 'var(--secondary-foreground)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {icon}
        </div>
      )}
      <div>
        <h3 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 600, color: 'var(--foreground)' }}>
          {title}
        </h3>
        {description && (
          <p
            style={{
              margin: '0.5rem 0 0',
              color: 'var(--muted-foreground)',
              fontSize: '0.875rem',
              maxWidth: '40ch',
              lineHeight: 1.55,
            }}
          >
            {description}
          </p>
        )}
      </div>
      {action}
    </div>
  )
}

/** KPI 指标值（等宽数字） */
export function Metric({ value, style }: { value: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: 'var(--font-mono)',
        fontSize: '1.8rem',
        fontWeight: 700,
        margin: '0.45rem 0',
        letterSpacing: '-0.01em',
        color: 'var(--foreground)',
        fontVariantNumeric: 'tabular-nums',
        ...style,
      }}
    >
      {value}
    </div>
  )
}

/** 趋势小标签（up/down/warning） */
type TrendKind = 'up' | 'down' | 'warning' | 'default'

export function Trend({
  kind = 'default',
  children,
}: {
  kind?: TrendKind
  children: ReactNode
}) {
  const colorMap: Record<TrendKind, string> = {
    up: 'var(--chart-5)',
    down: 'var(--chart-2)',
    warning: 'var(--state-warning)',
    default: 'var(--foreground)',
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        padding: '0.3rem 0.6rem',
        borderRadius: 999,
        background: 'var(--muted)',
        color: colorMap[kind],
        fontSize: '0.82rem',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

/** 灰色微小文字 */
export function Muted({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <span style={{ color: 'var(--muted-foreground)', ...style }} className="muted">
      {children}
    </span>
  )
}

/** 极小灰文字 */
export function Tiny({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div
      style={{
        color: 'var(--muted-foreground)',
        fontSize: '0.78rem',
        lineHeight: 1.4,
        ...style,
      }}
      className="tiny"
    >
      {children}
    </div>
  )
}
