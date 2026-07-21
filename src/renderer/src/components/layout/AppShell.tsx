/**
 * AppShell — 应用外壳
 * 260px Sidebar + 76px Topbar + 可滚动 Content
 * 基于设计稿 zhixing-reader-redesign/partials/project-shell.html
 * 提供折叠侧边栏能力 + 主题切换持久化
 */

import { ReactNode, useCallback, useEffect, useState } from 'react'
import Sidebar from './Sidebar'
import Topbar from './Topbar'

interface AppShellProps {
  children: ReactNode
}

export default function AppShell({ children }: AppShellProps) {
  const [collapsed, setCollapsed] = useState(false)

  // 持久化折叠状态
  useEffect(() => {
    const stored = localStorage.getItem('zhixing-sidebar-collapsed')
    if (stored === 'true') setCollapsed(true)
  }, [])

  const handleToggleSidebar = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('zhixing-sidebar-collapsed', String(next))
      return next
    })
  }, [])

  return (
    <div
      className="app-shell"
      data-collapsed={collapsed}
      style={{
        display: 'grid',
        gridTemplateColumns: collapsed ? '88px 1fr' : '260px 1fr',
        height: '100%',
        background: 'var(--background)',
        overflow: 'hidden',
        transition: 'grid-template-columns 0.2s ease',
      }}
    >
      <Sidebar collapsed={collapsed} />
      <main
        className="main"
        style={{ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0 }}
      >
        <Topbar onToggleSidebar={handleToggleSidebar} />
        <section
          className="content"
          data-scroll-region="primary"
          style={{
            flex: 1,
            padding: 'calc(var(--spacing) * 6)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'calc(var(--spacing) * 5)',
            minHeight: 0,
            overflow: 'auto',
          }}
        >
          {children}
        </section>
      </main>
    </div>
  )
}
