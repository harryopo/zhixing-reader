/** 知识卡片页共享的内联样式（从 KnowledgeCards.tsx 原样搬出） */
import type { CSSProperties } from 'react'

export const selectStyle: CSSProperties = {
  width: 160,
  padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 4)',
  border: '1px solid var(--input)',
  borderRadius: 'var(--radius)',
  background: 'var(--card)',
  color: 'var(--foreground)',
  fontSize: '0.84rem',
  outline: 'none',
  fontFamily: 'inherit',
  cursor: 'pointer',
}

export function iconBtnStyle(active: boolean): CSSProperties {
  return {
    width: 28,
    height: 28,
    display: 'grid',
    placeItems: 'center',
    border: '1px solid',
    borderColor: active ? 'var(--sidebar-border)' : 'var(--border)',
    background: active ? 'var(--sidebar-accent)' : 'var(--card)',
    color: active ? 'var(--sidebar-accent-foreground)' : 'var(--foreground)',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
    transition:
      'background 0.2s ease, color 0.2s ease, border-color 0.2s ease, transform 0.16s ease',
    padding: 0,
    fontFamily: 'inherit',
  }
}

export function aiGenBtnStyle(disabled: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'calc(var(--spacing) * 2)',
    padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 3)',
    fontSize: '0.75rem',
    background: 'var(--card)',
    border: '1px solid var(--border)',
    color: 'var(--foreground)',
    borderRadius: 'var(--radius)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'border-color 0.2s ease',
    fontFamily: 'inherit',
  }
}

export const spinnerStyle: CSSProperties = {
  width: 12,
  height: 12,
  borderRadius: '50%',
  border: '1.5px solid var(--muted-foreground)',
  borderTopColor: 'transparent',
  animation: 'spin 0.8s linear infinite',
  display: 'inline-block',
}
