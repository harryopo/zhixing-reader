/**
 * SessionDrawer — 历史会话抽屉（overlay，替代原 240px 常驻左栏）
 *
 * 交互：头部 ☰ 触发 → 左滑出 320px 全高抽屉 + 遮罩；Esc / 点遮罩 / 切换会话后自动关闭。
 * 卡片风格：Apple 式轻卡片——无彩色侧边条，选中/悬停仅用柔和底色 + 圆角；删除按钮悬停显现。
 */
import { useEffect, useState, type CSSProperties } from 'react'
import Icon from '@/components/ui/Icon'
import Modal from '@/components/ui/Modal'

export interface DrawerSession {
  id: string
  title: string
  updatedAt: string
  createdAt: string
  messageCount: number
}

interface SessionDrawerProps {
  open: boolean
  onClose: () => void
  sessions: DrawerSession[]
  currentSessionId: string | null
  onSwitch: (id: string) => void
  onDelete: (id: string) => void
  onCreate: () => void
}

// ===== 模块级样式 =====

const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '0 16px 12px',
}

// ===== 工具函数 =====

/** 时间相对显示（"2 小时前 / 昨天 / 3 天前 / 上周"）——自原 Chat.tsx 左栏迁入 */
function formatRelativeTime(iso: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const min = Math.floor(diff / 60000)
  if (min < 60) return `${min || 1} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day === 1) return '昨天'
  if (day < 7) return `${day} 天前`
  if (day < 14) return '上周'
  return `${Math.floor(day / 7)} 周前`
}

/** 截断会话标题用于卡片展示 */
function truncate(s: string, n: number): string {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + '…' : s
}

// ===== 子组件 / hooks =====

/** 抽屉工具行：新对话 + 搜索 */
function DrawerToolbar({ keyword, onKeyword, onCreate }: {
  keyword: string
  onKeyword: (v: string) => void
  onCreate: () => void
}) {
  return (
    <div style={toolbarStyle}>
      <button
        type="button"
        onClick={onCreate}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 5,
          background: 'var(--primary)',
          color: 'var(--primary-foreground)',
          border: 'none',
          borderRadius: 8,
          padding: '7px 12px',
          font: 'inherit',
          fontSize: '0.8rem',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <Icon name="plus" size={13} /> 新对话
      </button>
      <input
        value={keyword}
        onChange={(e) => onKeyword(e.target.value)}
        placeholder="搜索会话…"
        style={{
          flex: 1,
          minWidth: 0,
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: '7px 10px',
          font: 'inherit',
          fontSize: '0.8rem',
          outline: 'none',
          background: 'var(--background)',
          color: 'var(--foreground)',
        }}
      />
    </div>
  )
}

interface SessionCardProps {
  session: DrawerSession
  active: boolean
  onSwitch: (id: string) => void
  onDelete: (id: string) => void
}

/** 单张会话卡片（Apple 风格：无侧边条，悬停柔和底色，删除按钮悬停显现） */
function SessionCard({ session, active, onSwitch, onDelete }: SessionCardProps) {
  const [hovered, setHovered] = useState(false)
  return (
    <div
      onClick={() => onSwitch(session.id)}
      style={{
        position: 'relative',
        padding: '10px 34px 10px 12px',
        borderRadius: 10,
        cursor: 'pointer',
        background: active ? 'var(--sidebar-accent)' : hovered ? 'var(--muted)' : 'transparent',
        transition: 'background 0.15s ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          fontSize: '0.85rem',
          fontWeight: 500,
          color: 'var(--foreground)',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {truncate(session.title || '新对话', 20)}
      </div>
      <div
        style={{
          fontSize: '0.7rem',
          color: 'var(--muted-foreground)',
          marginTop: 3,
          fontFamily: 'var(--font-mono)',
        }}
      >
        {formatRelativeTime(session.updatedAt || session.createdAt)}
        {session.messageCount > 0 ? ` · ${session.messageCount} 条` : ''}
      </div>
      <button
        type="button"
        aria-label={`删除会话：${session.title || '新对话'}`}
        onClick={(e) => {
          e.stopPropagation()
          onDelete(session.id)
        }}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          width: 22,
          height: 22,
          display: 'grid',
          placeItems: 'center',
          border: 'none',
          background: 'transparent',
          color: hovered ? 'var(--state-error)' : 'var(--muted-foreground)',
          opacity: hovered ? 1 : 0,
          cursor: 'pointer',
          borderRadius: 6,
          padding: 0,
          transition: 'opacity 0.15s ease, color 0.15s ease',
        }}
      >
        <Icon name="close" size={12} />
      </button>
    </div>
  )
}

/** 会话卡片列表（含空态与搜索过滤） */
function SessionList({ sessions, currentSessionId, onSwitch, onDelete, keyword }: {
  sessions: DrawerSession[]
  currentSessionId: string | null
  onSwitch: (id: string) => void
  onDelete: (id: string) => void
  keyword: string
}) {
  const kw = keyword.trim().toLowerCase()
  const filtered = kw ? sessions.filter((s) => (s.title || '').toLowerCase().includes(kw)) : sessions

  if (filtered.length === 0) {
    return (
      <div
        style={{
          padding: '32px 12px',
          textAlign: 'center',
          color: 'var(--muted-foreground)',
          fontSize: '0.82rem',
        }}
      >
        {kw ? '没有匹配的会话' : '暂无会话，点上方「新对话」开始'}
      </div>
    )
  }

  return (
    <>
      {filtered.map((s) => (
        <SessionCard
          key={s.id}
          session={s}
          active={s.id === currentSessionId}
          onSwitch={onSwitch}
          onDelete={onDelete}
        />
      ))}
    </>
  )
}

/** 主组件 ===== */
export default function SessionDrawer({
  open,
  onClose,
  sessions,
  currentSessionId,
  onSwitch,
  onDelete,
  onCreate,
}: SessionDrawerProps) {
  const [keyword, setKeyword] = useState('')

  // 每次打开清空搜索词
  useEffect(() => {
    if (open) setKeyword('')
  }, [open])

  if (!open) return null

  return (
    <Modal onClose={onClose} variant="drawer-left" ariaLabel="历史对话" padded={false} width={320}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 16px 10px',
          }}
        >
          <strong style={{ fontSize: '0.95rem', color: 'var(--foreground)' }}>历史对话</strong>
          <button
            type="button"
            aria-label="关闭历史对话"
            onClick={onClose}
            style={{
              width: 28,
              height: 28,
              display: 'grid',
              placeItems: 'center',
              border: 'none',
              background: 'transparent',
              color: 'var(--muted-foreground)',
              cursor: 'pointer',
              borderRadius: 'var(--radius)',
            }}
          >
            <Icon name="close" size={15} />
          </button>
        </div>

        <DrawerToolbar
          keyword={keyword}
          onKeyword={setKeyword}
          onCreate={onCreate}
        />

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 8px 8px', minHeight: 0 }}>
          <SessionList
            sessions={sessions}
            currentSessionId={currentSessionId}
            onSwitch={onSwitch}
            onDelete={onDelete}
            keyword={keyword}
          />
        </div>

        <div
          style={{
            padding: '10px 16px',
            borderTop: '1px solid var(--border)',
            fontSize: '0.7rem',
            color: 'var(--muted-foreground)',
          }}
        >
          切换会话后自动关闭 · Esc 或点遮罩关闭
        </div>
    </Modal>
  )
}
