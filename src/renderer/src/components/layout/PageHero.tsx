/**
 * PageHero — 页面级 Hero 区域（标题 + 副标题 + 操作按钮）
 * 设计稿约定：所有页面顶部都有 hero 区，统一通过此组件渲染
 * 调用：<PageHero title="..." subtitle="..." actions={<.../>}>body</PageHero>
 */

import { ReactNode } from 'react'

interface PageHeroProps {
  title: string
  subtitle?: string
  actions?: ReactNode
  children?: ReactNode
}

export default function PageHero({ title, subtitle, actions, children }: PageHeroProps) {
  return (
    <>
      <div
        className="page-hero"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 'calc(var(--spacing) * 4)',
          flexWrap: 'wrap',
        }}
      >
        <div className="page-hero-text" style={{ minWidth: 0, flex: 1, maxWidth: '100%' }}>
          <h2
            style={{
              margin: 0,
              fontSize: '1.5rem',
              fontWeight: 700,
              textWrap: 'balance',
              wordBreak: 'keep-all',
              overflowWrap: 'break-word',
              color: 'var(--foreground)',
            }}
          >
            {title}
          </h2>
          {subtitle && (
            <p
              style={{
                margin: '0.45rem 0 0',
                color: 'var(--muted-foreground)',
                fontSize: '0.875rem',
                lineHeight: 1.55,
                maxWidth: '60ch',
              }}
            >
              {subtitle}
            </p>
          )}
        </div>
        {actions && (
          <div
            className="page-hero-actions"
            style={{
              display: 'flex',
              gap: 'calc(var(--spacing) * 3)',
              flexWrap: 'wrap',
              flexShrink: 0,
            }}
          >
            {actions}
          </div>
        )}
      </div>
      {children && (
        <div
          className="page-body"
          style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 5)' }}
        >
          {children}
        </div>
      )}
    </>
  )
}
