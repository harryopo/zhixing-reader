/**
 * Button — 按钮（Google Design Library 风格）
 * 4 个变体：primary / secondary / ghost / danger
 * 与设计稿 .action-btn 完全一致
 */

import { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  children: ReactNode
}

const VARIANT_STYLES: Record<ButtonVariant, Record<string, string>> = {
  primary: {
    background: 'var(--primary)',
    borderColor: 'var(--primary)',
    color: 'var(--primary-foreground)',
  },
  secondary: {
    background: 'var(--secondary)',
    borderColor: 'var(--secondary)',
    color: 'var(--secondary-foreground)',
  },
  ghost: {
    background: 'transparent',
    borderColor: 'var(--border)',
    color: 'var(--foreground)',
  },
  danger: {
    background: 'var(--destructive)',
    borderColor: 'var(--destructive)',
    color: 'var(--destructive-foreground)',
  },
}

export default function Button({
  variant = 'ghost',
  children,
  style,
  disabled,
  ...rest
}: ButtonProps) {
  const variantStyle = VARIANT_STYLES[variant]
  return (
    <button
      type="button"
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'calc(var(--spacing) * 2)',
        padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 5)',
        border: '1px solid',
        borderRadius: 'var(--radius)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontWeight: 600,
        fontSize: '0.88rem',
        lineHeight: 1,
        transition:
          'background 0.2s ease, color 0.2s ease, transform 0.16s ease, border-color 0.2s ease',
        opacity: disabled ? 0.5 : 1,
        ...variantStyle,
        ...style,
      }}
      onMouseEnter={(e) => {
        if (!disabled) {
          e.currentTarget.style.borderColor = 'var(--ring)'
        }
      }}
      onMouseLeave={(e) => {
        if (!disabled) {
          e.currentTarget.style.borderColor = variantStyle.borderColor
        }
      }}
      onMouseDown={(e) => {
        if (!disabled) e.currentTarget.style.transform = 'scale(0.97)'
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = 'scale(1)'
      }}
      onFocus={(e) => {
        e.currentTarget.style.outline = '2px solid var(--ring)'
        e.currentTarget.style.outlineOffset = '2px'
      }}
      onBlur={(e) => {
        e.currentTarget.style.outline = 'none'
      }}
      {...rest}
    >
      {children}
    </button>
  )
}
