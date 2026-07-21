/**
 * Topbar — 顶栏（76px，Google Design Library）
 * 基于设计稿 zhixing-reader-redesign/partials/project-shell.html
 * 4 个 icon-btn：toggle-sidebar / theme-toggle / refresh / notify + search + avatar
 * data-dom-id 与设计稿一致
 *
 * T2 修复（phase5）：
 *   - 刷新按钮调 weread.getBookshelf + 写库，实现真实同步
 *   - 同步中：disabled + 图标旋转
 *   - 同步成功/失败：toast 提示
 *   - 通知按钮实现下拉面板：未读笔记数 + 今日复习数 + 同步状态
 *   - 面板外点击关闭
 *
 * T2 P0+P1 fix（phase5）：
 *   - P0-1: 未读笔记数用 mapHighlights 映射 created_at → createdAt,修复永远 0 的 bug
 *   - P1-2: handleSync 重复逻辑提取到 utils/sync-bookshelf.ts,与 Bookshelf 共用
 *   - P1-3: 通知按钮加 aria-expanded/aria-haspopup/aria-controls,面板加 id/aria-modal
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon, { IconName } from '@/components/ui/Icon'
import { toast } from '../../stores/toastStore'
import { mapHighlights } from '../../utils/db-mapper'
import { syncBookshelfToDb } from '../../utils/sync-bookshelf'

interface TopbarProps {
  onToggleSidebar?: () => void
  /** 外部传入的刷新回调（已废弃：内部改为真实同步，保留兼容） */
  onRefresh?: () => void
}

interface IconButtonProps {
  domId: string
  icon: IconName
  label: string
  onClick?: () => void
  disabled?: boolean
  /** 图标是否旋转（用于 loading 状态） */
  spinning?: boolean
  /** 是否激活（用于通知按钮 toggle 状态） */
  active?: boolean
  /** 无障碍：按钮控制的元素是否展开（用于 toggle 按钮） */
  'aria-expanded'?: boolean
  /** 无障碍：按钮控制的元素 id（用于 toggle 按钮） */
  'aria-controls'?: string
  /** 无障碍：按钮控制的元素类型（dialog/menu/listbox 等） */
  'aria-haspopup'?: boolean | 'dialog' | 'menu' | 'listbox' | 'true' | 'false'
}

/** localStorage 中存"上次查看笔记时间"的 key（用于未读笔记计数） */
const LAST_VIEW_NOTES_AT_KEY = 'zhixing-lastViewNotesAt'
/** localStorage 中存"上次同步时间/状态"的 key */
const LAST_SYNC_KEY = 'zhixing-lastSync'

function IconButton({
  domId,
  icon,
  label,
  onClick,
  disabled,
  spinning,
  active,
  'aria-expanded': ariaExpanded,
  'aria-controls': ariaControls,
  'aria-haspopup': ariaHasPopup,
}: IconButtonProps) {
  return (
    <button
      type="button"
      data-dom-id={domId}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      aria-expanded={ariaExpanded}
      aria-controls={ariaControls}
      aria-haspopup={ariaHasPopup}
      style={{
        width: 40,
        height: 40,
        display: 'grid',
        placeItems: 'center',
        border: `1px solid ${active ? 'var(--ring)' : 'var(--border)'}`,
        background: active ? 'var(--sidebar-accent)' : 'var(--card)',
        color: active ? 'var(--sidebar-accent-foreground)' : 'var(--foreground)',
        borderRadius: 'var(--radius)',
        cursor: disabled ? 'wait' : 'pointer',
        transition:
          'background 0.2s ease, color 0.2s ease, transform 0.16s ease, border-color 0.2s ease',
        padding: 0,
        opacity: disabled ? 0.6 : 1,
      }}
      onMouseEnter={(e) => {
        if (disabled) return
        e.currentTarget.style.background = 'var(--sidebar-accent)'
        e.currentTarget.style.color = 'var(--sidebar-accent-foreground)'
        e.currentTarget.style.borderColor = 'var(--sidebar-border)'
      }}
      onMouseLeave={(e) => {
        if (disabled) return
        e.currentTarget.style.background = active ? 'var(--sidebar-accent)' : 'var(--card)'
        e.currentTarget.style.color = active ? 'var(--sidebar-accent-foreground)' : 'var(--foreground)'
        e.currentTarget.style.borderColor = active ? 'var(--ring)' : 'var(--border)'
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
    >
      <Icon
        name={icon}
        size={18}
        style={spinning ? { animation: 'topbar-spin 0.9s linear infinite' } : undefined}
      />
      <style>{`@keyframes topbar-spin { to { transform: rotate(360deg) } }`}</style>
    </button>
  )
}

interface NotifData {
  unreadNotes: number
  dueCards: number
  lastSyncAt: string | null
  lastSyncOk: boolean | null
  lastSyncCount: number | null
}

export default function Topbar({ onToggleSidebar }: TopbarProps) {
  const navigate = useNavigate()
  const [isDark, setIsDark] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [notifyOpen, setNotifyOpen] = useState(false)
  const [notif, setNotif] = useState<NotifData>({
    unreadNotes: 0,
    dueCards: 0,
    lastSyncAt: null,
    lastSyncOk: null,
    lastSyncCount: null,
  })

  /** 通知按钮容器 ref，用于面板外点击关闭 */
  const notifyWrapRef = useRef<HTMLDivElement>(null)

  // 读取主题偏好
  useEffect(() => {
    const stored = localStorage.getItem('zhixing-theme')
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
    const dark = stored === 'dark' || (!stored && prefersDark)
    setIsDark(dark)
    document.documentElement.classList.toggle('dark', dark)
  }, [])

  // 面板外点击关闭
  useEffect(() => {
    if (!notifyOpen) return
    const handler = (e: MouseEvent) => {
      const wrap = notifyWrapRef.current
      if (wrap && !wrap.contains(e.target as Node)) {
        setNotifyOpen(false)
      }
    }
    // 用 mousedown 捕获早于按钮 onClick，避免点击按钮自身时面板被关后又开
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [notifyOpen])

  /** 拉取通知数据：未读笔记 + 今日复习 + 同步状态 */
  const refreshNotifData = useCallback(async () => {
    try {
      const [highlights, dueCards] = await Promise.all([
        window.electronAPI.highlight.getAll().catch(() => []),
        window.electronAPI.card.getDue(100).catch(() => []),
      ])

      const lastViewAt = Number(localStorage.getItem(LAST_VIEW_NOTES_AT_KEY) || 0)
      // P0-1 修复：highlight.getAll() 返回 snake_case 字段（created_at），
      // 需用 mapHighlights 映射为 camelCase（createdAt）后再过滤,否则 unreadNotes 永远 0
      const mappedHighlights = mapHighlights(highlights as unknown[])
      const unreadNotes = mappedHighlights.filter((h) => {
        const createdAt = h.createdAt as string | undefined
        const t = createdAt ? new Date(createdAt).getTime() : 0
        return t > lastViewAt
      }).length

      const syncRaw = localStorage.getItem(LAST_SYNC_KEY)
      let lastSyncAt: string | null = null
      let lastSyncOk: boolean | null = null
      let lastSyncCount: number | null = null
      if (syncRaw) {
        try {
          const parsed = JSON.parse(syncRaw) as {
            at: number
            ok: boolean
            count?: number
          }
          lastSyncAt = new Date(parsed.at).toLocaleString('zh-CN', { hour12: false })
          lastSyncOk = parsed.ok
          lastSyncCount = typeof parsed.count === 'number' ? parsed.count : null
        } catch {
          // ignore parse error
        }
      }

      setNotif({
        unreadNotes,
        dueCards: (dueCards as unknown[]).length,
        lastSyncAt,
        lastSyncOk,
        lastSyncCount,
      })
    } catch {
      // 静默失败，不打扰用户
    }
  }, [])

  // 打开面板时拉取最新数据
  useEffect(() => {
    if (notifyOpen) {
      void refreshNotifData()
    }
  }, [notifyOpen, refreshNotifData])

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
    navigate(`/bookshelf?q=${encodeURIComponent(q)}`)
  }

  /** 刷新按钮：调用微信读书 API 拉取书架并写库（真实同步） */
  const handleSync = useCallback(async () => {
    if (syncing) return
    setSyncing(true)
    const syncToastId = toast.loading('正在同步微信读书书架...')
    try {
      // P1-2 修复：提取重复逻辑到 syncBookshelfToDb,Topbar 只负责 toast/localStorage/刷新
      const result = await syncBookshelfToDb()

      if (result.total === 0) {
        toast.remove(syncToastId)
        toast.warning('未获取到书籍，请检查微信读书配置')
        localStorage.setItem(
          LAST_SYNC_KEY,
          JSON.stringify({ at: Date.now(), ok: false, count: 0 }),
        )
        return
      }

      toast.remove(syncToastId)
      toast.success(
        result.newCount > 0
          ? `同步完成，共 ${result.total} 本书，新导入 ${result.newCount} 本，更新 ${result.updatedCount} 本`
          : `书架已是最新，共 ${result.total} 本书`,
      )
      localStorage.setItem(
        LAST_SYNC_KEY,
        JSON.stringify({ at: Date.now(), ok: true, count: result.total }),
      )
    } catch (error) {
      toast.remove(syncToastId)
      const msg = error instanceof Error ? error.message : String(error)
      toast.error(`同步失败: ${msg}`)
      localStorage.setItem(
        LAST_SYNC_KEY,
        JSON.stringify({ at: Date.now(), ok: false }),
      )
    } finally {
      setSyncing(false)
      // 同步后刷新通知面板数据
      void refreshNotifData()
    }
  }, [syncing, refreshNotifData])

  /** 通知按钮：toggle 下拉面板 */
  const handleToggleNotify = () => {
    setNotifyOpen((v) => !v)
  }

  /** "查看全部笔记"：记录查看时间（清零未读数）并跳转 */
  const handleViewAllNotes = () => {
    localStorage.setItem(LAST_VIEW_NOTES_AT_KEY, String(Date.now()))
    setNotifyOpen(false)
    setNotif((s) => ({ ...s, unreadNotes: 0 }))
    navigate('/notes')
  }

  /** "去复习"：跳转复习页 */
  const handleGoReview = () => {
    setNotifyOpen(false)
    navigate('/review')
  }

  /** 同步状态文案 */
  const syncStatusText = (() => {
    if (notif.lastSyncAt === null) return '尚未同步'
    if (notif.lastSyncOk === false) return `上次同步失败 · ${notif.lastSyncAt}`
    const countText = notif.lastSyncCount !== null ? `（共 ${notif.lastSyncCount} 本）` : ''
    return `上次同步成功 · ${notif.lastSyncAt}${countText}`
  })()

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
          label={syncing ? '同步中...' : '刷新数据'}
          onClick={handleSync}
          disabled={syncing}
          spinning={syncing}
        />
        {/* 通知按钮 + 下拉面板（容器 relative 用于 absolute 定位） */}
        <div ref={notifyWrapRef} style={{ position: 'relative' }}>
          <IconButton
            domId="action-notify"
            icon="bell"
            label="通知"
            onClick={handleToggleNotify}
            active={notifyOpen}
            aria-expanded={notifyOpen}
            aria-haspopup="dialog"
            aria-controls="notif-panel"
          />
          {/* 未读/复习数 > 0 时显示红点徽标 */}
          {(notif.unreadNotes > 0 || notif.dueCards > 0) && !notifyOpen && (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: 4,
                right: 4,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--chart-2, #ef4444)',
                border: '2px solid var(--background)',
                pointerEvents: 'none',
              }}
            />
          )}
          {notifyOpen && (
            <div
              id="notif-panel"
              role="dialog"
              aria-label="通知"
              aria-modal="false"
              style={{
                position: 'absolute',
                top: 'calc(100% + 8px)',
                right: 0,
                width: 320,
                background: 'var(--popover)',
                border: '1px solid var(--border)',
                borderRadius: 'calc(var(--radius) + 6px)',
                boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
                zIndex: 100,
                overflow: 'hidden',
              }}
            >
              {/* 面板头 */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                  borderBottom: '1px solid var(--border)',
                  background: 'var(--card)',
                }}
              >
                <strong style={{ fontSize: '0.95rem', color: 'var(--foreground)' }}>通知</strong>
                <button
                  type="button"
                  aria-label="关闭通知面板"
                  onClick={() => setNotifyOpen(false)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--muted-foreground)',
                    cursor: 'pointer',
                    padding: 4,
                    display: 'grid',
                    placeItems: 'center',
                    borderRadius: 'var(--radius)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--muted)'
                    e.currentTarget.style.color = 'var(--foreground)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = 'var(--muted-foreground)'
                  }}
                >
                  <Icon name="close" size={16} />
                </button>
              </div>

              {/* 面板内容 */}
              <div style={{ padding: 'calc(var(--spacing) * 2) 0' }}>
                {/* 未读笔记 */}
                <button
                  type="button"
                  onClick={handleViewAllNotes}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'calc(var(--spacing) * 3)',
                    width: '100%',
                    padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--foreground)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--muted)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: 'var(--chart-1, #10b981)',
                      color: '#fff',
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="notes" size={16} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: '0.88rem', fontWeight: 500 }}>
                      未读笔记
                    </span>
                    <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>
                      {notif.unreadNotes > 0 ? `${notif.unreadNotes} 条新笔记待查看` : '暂无新笔记'}
                    </span>
                  </span>
                  <Icon name="chevron-right" size={16} />
                </button>

                {/* 今日复习 */}
                <button
                  type="button"
                  onClick={handleGoReview}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'calc(var(--spacing) * 3)',
                    width: '100%',
                    padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--foreground)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--muted)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent'
                  }}
                >
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background: 'var(--chart-5, #f59e0b)',
                      color: '#fff',
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="review" size={16} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: '0.88rem', fontWeight: 500 }}>
                      今日复习
                    </span>
                    <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>
                      {notif.dueCards > 0 ? `${notif.dueCards} 张卡片待复习` : '今日无待复习卡片'}
                    </span>
                  </span>
                  <Icon name="chevron-right" size={16} />
                </button>

                {/* 同步状态（仅展示，不可点击） */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'calc(var(--spacing) * 3)',
                    width: '100%',
                    padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                  }}
                >
                  <span
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: '50%',
                      background:
                        notif.lastSyncOk === false
                          ? 'var(--chart-2, #ef4444)'
                          : 'var(--chart-4, #06b6d4)',
                      color: '#fff',
                      display: 'grid',
                      placeItems: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon name="refresh" size={16} />
                  </span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ display: 'block', fontSize: '0.88rem', fontWeight: 500 }}>
                      同步状态
                    </span>
                    <span style={{ display: 'block', fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>
                      {syncStatusText}
                    </span>
                  </span>
                </div>
              </div>

              {/* 面板底：刷新按钮 */}
              <div
                style={{
                  borderTop: '1px solid var(--border)',
                  padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                  background: 'var(--card)',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    void handleSync()
                  }}
                  disabled={syncing}
                  style={{
                    width: '100%',
                    padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 3)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    background: syncing ? 'var(--muted)' : 'var(--primary)',
                    color: syncing ? 'var(--muted-foreground)' : 'var(--primary-foreground)',
                    cursor: syncing ? 'wait' : 'pointer',
                    fontSize: '0.85rem',
                    fontWeight: 500,
                    opacity: syncing ? 0.7 : 1,
                  }}
                >
                  {syncing ? '同步中...' : '立即同步书架'}
                </button>
              </div>
            </div>
          )}
        </div>
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
