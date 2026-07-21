/**
 * PlaceholderPage — 新页面占位组件
 * 用于阶段1路由注册，阶段2会被实际实现替换
 * 提供设计稿一致的 Hero + 简化卡片布局，保持视觉一致性
 */

import { ReactNode } from 'react'
import PageHero from '@/components/layout/PageHero'

interface PlaceholderPageProps {
  title: string
  subtitle?: string
  actions?: ReactNode
  /** 占位提示文案 */
  hint?: string
}

export default function PlaceholderPage({ title, subtitle, actions, hint }: PlaceholderPageProps) {
  return (
    <PageHero title={title} subtitle={subtitle} actions={actions}>
      <div
        className="card-base"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'calc(var(--spacing) * 12) calc(var(--spacing) * 6)',
          textAlign: 'center',
          gap: 'calc(var(--spacing) * 3)',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: 'var(--secondary)',
            color: 'var(--secondary-foreground)',
            display: 'grid',
            placeItems: 'center',
            fontSize: '1.5rem',
            fontWeight: 700,
          }}
        >
          {title.charAt(0)}
        </div>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: 'var(--foreground)' }}>
            {title}
          </h3>
          <p
            style={{
              margin: '0.5rem 0 0',
              color: 'var(--muted-foreground)',
              fontSize: '0.875rem',
              maxWidth: '40ch',
              lineHeight: 1.55,
            }}
          >
            {hint || '此页面正在按设计稿 1:1 重构中，将于阶段2 完成实现。当前可正常访问路由与基础布局。'}
          </p>
        </div>
      </div>
    </PageHero>
  )
}
