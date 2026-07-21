/**
 * Topbar — 顶栏（76px，Google Design Library）
 * 基于设计稿 zhixing-reader-redesign/partials/project-shell.html
 * 4 个 icon-btn：toggle-sidebar / theme-toggle / refresh / notify + search + avatar
 * data-dom-id 与设计稿一致
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon, { IconName } from '@/components/ui/Icon'

interface TopbarProps {
  onToggleSidebar?: () => void
  onRefresh?: () => void
}

interface IconButtonProps {
  domId: string
  icon: IconName
  label: string
  onClick?: () => void
}

function IconButton({ domId, icon, label, onClick }: IconButtonProps) {
  return (
    <button
      type="button"
      data-dom-id={domId}
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        width: 40,
        height: 40,
        display: 'grid',
        placeItems: 'center',
        border: '1px solid var(--border)',
        background: 'var(--card)',
        color: 'var(--foreground)',
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        transition:
          'background 0.2s ease, color 0.2s ease, transform 0.16s ease, border-color 0.2s ease',
        padding: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--sidebar-accent)'
        e.currentTarget.style.color = 'var(--sidebar-accent-foreground)'
        e.currentTarget.style.borderColor = 'var(--sidebar-border)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--card)'
        e.currentTarget.style.color = 'var(--foreground)'
        e.currentTarget.style.borderColor = 'var(--border)'
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = 'scale(0.97)'
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
    >
      <Icon name={icon} size={18} />
    </button>
  )
}

export default function Topbar({ onToggleSidebar, onRefresh }: TopbarProps) {
  const navigate = useNavigate()
  const [isDark, setIsDark] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  // 读取主题偏好
  useEffect(() => {
    const stored = localStorage.getItem('zhixing-theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const dark = stored === 'dark' || (!stored && prefersDark)
    setIsDark(dark)
    document.documentElement.classList.toggle('dark', dark)
  }, [])

  const handleThemeToggle = () => {
    const next = !isDark
    setIsDark(next)
    document.documentElement.classList.toggle('dark', next)
    localStorage.setItem('zhixing-theme', next ? 'dark' : 'light')
  }

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const q = searchQuery.trim()
    if (!q) return
    // 简单路由：搜索关键词 → 书架页（由书架页处理 query 参数）
    navigate(`/bookshelf?q=${encodeURIComponent(q)}`)
  }

  return (
    <header
      className="topbar"
      style={{
        height: 76,
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'calc(var(--spacing) * 4)',
        padding: '0 calc(var(--spacing) * 6)',
        background: 'var(--background)',
        flexShrink: 0,
      }}
    >
      {/* ===== Left ===== */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)' }}>
        <IconButton
          domId="toggle-sidebar"
          icon="menu"
          label="折叠侧边栏"
          onClick={onToggleSidebar}
        />
        <form onSubmit={handleSearchSubmit} role="search" style={{ flex: 1 }}>
          <div
            className="search"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'calc(var(--spacing) * 3)',
              width: 'min(420px, 46vw)',
              padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
              border: '1px solid var(--input)',
              borderRadius: 999,
              background: 'var(--popover)',
              color: 'var(--muted-foreground)',
            }}
          >
            <span
              className="glyph"
              aria-hidden="true"
              style={{ width: '1.1rem', flex: '0 0 1.1rem', display: 'grid', placeItems: 'center' }}
            >
              <Icon name="search" size={16} />
            </span>
            <input
              type="search"
              aria-label="搜索"
              placeholder="搜索书籍、笔记、卡片..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'var(--foreground)',
                width: '100%',
                fontSize: '0.9rem',
              }}
            />
          </div>
        </form>
      </div>

      {/* ===== Right ===== */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)' }}>
        <IconButton
          domId="theme-toggle"
          icon={isDark ? 'sun' : 'moon'}
          label="切换主题"
          onClick={handleThemeToggle}
        />
        <IconButton
          domId="action-refresh"
          icon="refresh"
          label="刷新数据"
          onClick={onRefresh}
        />
        <IconButton
          domId="action-notify"
          icon="bell"
          label="通知"
        />
        <div
          className="avatar"
          aria-label="用户头像"
          title="读"
          onClick={() => navigate('/profile')}
          style={{
            width: 40,
            height: 40,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--primary)',
            color: 'var(--primary-foreground)',
            fontWeight: 700,
            fontSize: '0.95rem',
            flexShrink: 0,
            cursor: 'pointer',
            transition: 'transform 0.16s ease',
          }}
          onMouseDown={(e) => {
            e.currentTarget.style.transform = 'scale(0.95)'
          }}
          onMouseUp={(e) => {
            e.currentTarget.style.transform = 'scale(1)'
          }}
        >
          读
        </div>
      </div>
    </header>
  )
}
