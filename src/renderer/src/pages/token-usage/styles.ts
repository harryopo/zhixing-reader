/** TokenUsage 页复用的内联样式（从 TokenUsage.tsx 原样搬出，逻辑未改） */
import type { CSSProperties } from 'react'

export const eyebrowStyle: CSSProperties = {
  color: 'var(--muted-foreground)',
  fontSize: '0.78rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}

export const providerBadgeStyle: CSSProperties = {
  fontSize: '0.72rem',
  fontWeight: 500,
  textTransform: 'uppercase',
  background: 'var(--muted)',
  color: 'var(--foreground)',
  padding: '0.2rem 0.5rem',
  borderRadius: 'var(--radius)',
  whiteSpace: 'nowrap',
}

export const filterFieldStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 'calc(var(--spacing) * 2)',
}

export const filterLabelStyle: CSSProperties = {
  fontSize: '0.8rem',
  color: 'var(--muted-foreground)',
  whiteSpace: 'nowrap',
}

export const selectStyle: CSSProperties = {
  padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 3)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
  background: 'var(--card)',
  color: 'var(--foreground)',
  fontSize: '0.85rem',
  fontFamily: 'inherit',
  cursor: 'pointer',
  outline: 'none',
  minWidth: 110,
}

export const spinnerStyle: CSSProperties = {
  display: 'inline-block',
  width: 24,
  height: 24,
  borderRadius: '50%',
  border: '2px solid var(--border)',
  borderTopColor: 'var(--primary)',
  animation: 'spin 0.8s linear infinite',
}
