/**
 * Sidebar — 侧边栏（260px，Google Design Library）
 * 基于设计稿 zhixing-reader-redesign/partials/project-shell.html
 * 13 项主导航 + brand + sidebar-foot
 * 保留 data-dom-id（设计稿约定）+ 响应式折叠
 */

import { NavLink, useLocation } from 'react-router-dom'
import { useEffect, useState } from 'react'
import Icon, { IconName } from '@/components/ui/Icon'
import type { TokenSummary } from 'src/types/renderer'
import { useSettingsStore } from '@/stores/settingsStore'

interface NavItem {
  key: string
  path: string
  label: string
  icon: IconName
  domId: string
  /** 是否严格匹配（避免 / 匹配所有路由） */
  end?: boolean
  /** 匹配前缀（用于 settings/* 子路由高亮 settings 项） */
  matchPrefix?: string
}

const NAV_ITEMS: NavItem[] = [
  { key: 'home', path: '/', label: '首页', icon: 'home', domId: 'nav-home', end: true },
  { key: 'bookshelf', path: '/bookshelf', label: '书架', icon: 'bookshelf', domId: 'nav-bookshelf' },
  { key: 'chat', path: '/chat', label: 'AI对话', icon: 'chat', domId: 'nav-chat' },
  { key: 'review', path: '/review', label: '复习', icon: 'review', domId: 'nav-review' },
  { key: 'cards', path: '/knowledge-cards', label: '知识卡片', icon: 'cards', domId: 'nav-cards' },
  { key: 'daily', path: '/daily-learning', label: '每日学习', icon: 'daily', domId: 'nav-daily' },
  { key: 'methodology', path: '/methodologies', label: '方法论', icon: 'methodology', domId: 'nav-methodology' },
  { key: 'stats', path: '/stats', label: '统计', icon: 'stats', domId: 'nav-stats' },
  { key: 'vocabulary', path: '/vocabulary', label: '生词本', icon: 'vocabulary', domId: 'nav-vocabulary' },
  { key: 'notes', path: '/notes', label: '笔记', icon: 'notes', domId: 'nav-notes' },
  { key: 'profile', path: '/profile', label: '个人档案', icon: 'profile', domId: 'nav-profile' },
  { key: 'token', path: '/token-usage', label: 'Token用量', icon: 'token', domId: 'nav-token' },
  { key: 'settings', path: '/settings', label: '设置', icon: 'settings', domId: 'nav-settings', matchPrefix: '/settings/' },
]

function formatTokens(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n)
}

interface SidebarProps {
  collapsed?: boolean
}

export default function Sidebar({ collapsed = false }: SidebarProps) {
  const location = useLocation()
  const [tokenSummary, setTokenSummary] = useState<TokenSummary | null>(null)
  // 复习模块开关：用于条件渲染复习导航项
  const reviewEnabled = useSettingsStore((s) => s.reviewEnabled)
  const loadSettings = useSettingsStore((s) => s.loadSettings)

  useEffect(() => {
    let active = true
    const loadTokenData = async () => {
      if (!window.electronAPI?.tokenUsage) return
      try {
        const stats = await window.electronAPI.tokenUsage.getTotalStats()
        if (active) setTokenSummary(stats)
      } catch (error) {
        console.error('加载token数据失败:', error)
      }
    }
    loadTokenData()
    // 加载全局设置（含 reviewEnabled），与 SettingsAccount 共享状态
    void loadSettings()
    const interval = setInterval(loadTokenData, 30000)
    return () => {
      active = false
      clearInterval(interval)
    }
  }, [loadSettings])

  /** 判断导航项是否高亮（end 严格匹配 / matchPrefix 前缀匹配 / 默认前缀匹配） */
  const isActive = (item: NavItem): boolean => {
    if (item.end) return location.pathname === item.path
    if (item.matchPrefix) {
      return location.pathname === item.path || location.pathname.startsWith(item.matchPrefix)
    }
    return location.pathname === item.path || location.pathname.startsWith(item.path + '/')
  }

  const inputRatio =
    tokenSummary && tokenSummary.totalTokens > 0
      ? (tokenSummary.totalInputTokens / tokenSummary.totalTokens) * 100
      : 50

  return (
    <aside
      className="sidebar"
      style={{
        background: 'var(--sidebar)',
        color: 'var(--sidebar-foreground)',
        borderRight: '1px solid var(--sidebar-border)',
        padding: collapsed ? 'calc(var(--spacing) * 6) calc(var(--spacing) * 3)' : 'calc(var(--spacing) * 6)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'calc(var(--spacing) * 5)',
        minHeight: 0,
        overflowY: 'auto',
      }}
    >
      {/* ===== Brand ===== */}
      <div className="brand" style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)' }}>
        <div
          className="brand-mark"
          style={{
            width: 40,
            height: 40,
            borderRadius: 'calc(var(--radius) + 8px)',
            display: 'grid',
            placeItems: 'center',
            background: 'var(--sidebar-primary)',
            color: 'var(--sidebar-primary-foreground)',
            fontWeight: 700,
            fontSize: '1.05rem',
            flexShrink: 0,
          }}
        >
          知
        </div>
        {!collapsed && (
          <div className="brand-copy" style={{ minWidth: 0 }}>
            <h1 style={{ margin: 0, fontSize: '1rem', fontWeight: 700 }}>知行读书</h1>
            <p style={{ margin: '0.18rem 0 0', color: 'var(--muted-foreground)', fontSize: '0.82rem' }}>
              阅读成长工作台
            </p>
          </div>
        )}
      </div>

      {/* ===== Nav ===== */}
      <nav className="nav" aria-label="主导航" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
        {NAV_ITEMS.filter((item) => {
          // 复习模块关闭时隐藏复习导航项
          if (item.key === 'review' && !reviewEnabled) return false
          return true
        }).map((item) => {
          const active = isActive(item)
          return (
            <NavLink
              key={item.key}
              to={item.path}
              end={item.end}
              data-dom-id={item.domId}
              data-nav-key={item.key}
              data-active={active}
              title={collapsed ? item.label : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'calc(var(--spacing) * 3)',
                width: '100%',
                padding: collapsed
                  ? 'calc(var(--spacing) * 3.5)'
                  : 'calc(var(--spacing) * 3.5) calc(var(--spacing) * 4)',
                textAlign: 'left',
                border: 'none',
                background: active ? 'var(--sidebar-primary)' : 'transparent',
                color: active ? 'var(--sidebar-primary-foreground)' : 'inherit',
                borderRadius: 'var(--radius)',
                cursor: 'pointer',
                transition: 'background 0.2s ease, color 0.2s ease, transform 0.16s ease',
                textDecoration: 'none',
                justifyContent: collapsed ? 'center' : 'flex-start',
              }}
              onMouseEnter={(e) => {
                if (!active) {
                  e.currentTarget.style.background = 'var(--sidebar-accent)'
                  e.currentTarget.style.color = 'var(--sidebar-accent-foreground)'
                }
              }}
              onMouseLeave={(e) => {
                if (!active) {
                  e.currentTarget.style.background = 'transparent'
                  e.currentTarget.style.color = 'inherit'
                }
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.transform = 'scale(0.97)'
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.transform = 'scale(1)'
              }}
            >
              <span
                className="glyph"
                aria-hidden="true"
                style={{
                  width: '1.2rem',
                  flex: '0 0 1.2rem',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Icon name={item.icon} size={18} />
              </span>
              {!collapsed && (
                <span
                  className="label"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    fontSize: '0.92rem',
                  }}
                >
                  {item.label}
                </span>
              )}
            </NavLink>
          )
        })}
      </nav>

      {/* ===== Token 消耗（仅展开时显示） ===== */}
      {!collapsed && tokenSummary && tokenSummary.totalTokens > 0 && (
        <div
          style={{
            padding: 'calc(var(--spacing) * 3)',
            borderRadius: 'var(--radius)',
            background: 'var(--sidebar-accent)',
            color: 'var(--sidebar-accent-foreground)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.75rem', opacity: 0.85 }}>Token 消耗</span>
            <span style={{ fontSize: '0.75rem', fontWeight: 700 }}>{formatTokens(tokenSummary.totalTokens)}</span>
          </div>
          <div
            style={{
              position: 'relative',
              height: 4,
              borderRadius: 999,
              background: 'rgba(255,255,255,0.25)',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                inset: 0,
                left: 0,
                width: `${Math.max(inputRatio, 0)}%`,
                background: 'var(--sidebar-primary)',
                borderRadius: 999,
                transition: 'width 0.5s ease',
              }}
            />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '0.4rem', fontSize: '0.7rem', opacity: 0.7 }}>
            <span>{tokenSummary.totalRequests} 次请求</span>
            <span>
              {Math.round(inputRatio)}% 入 · {Math.round(100 - inputRatio)}% 出
            </span>
          </div>
        </div>
      )}

      {/* ===== Sidebar foot ===== */}
      {!collapsed && (
        <div
          className="sidebar-foot"
          style={{
            marginTop: 'auto',
            paddingTop: 'calc(var(--spacing) * 4)',
            borderTop: '1px solid var(--sidebar-border)',
            fontSize: '0.82rem',
            color: 'var(--muted-foreground)',
            lineHeight: 1.55,
          }}
        >
          知行合一，让阅读沉淀为成长的足迹。
        </div>
      )}
    </aside>
  )
}
