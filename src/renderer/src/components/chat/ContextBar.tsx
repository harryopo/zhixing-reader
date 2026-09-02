/**
 * ContextBar — 关联书籍上下文条（输入区上方，替代原 280px 右栏）
 *
 * 有关联书：真实书封 40×56 + 书名/作者 + [更换关联][取消关联]，常驻不折叠。
 * 无关联书：虚线引导条，点击弹出书籍选择 popover。
 * popover：选完自动关闭、点外部关闭；内部滚动。
 * 刻意不做：阅读进度条（同步未写真实进度，展示即假数据——去伪存真）。
 */
import { useState, type CSSProperties, type ReactNode } from 'react'
import Icon from '@/components/ui/Icon'
import { Loading, Tiny } from '@/components/ui/Feedback'

export interface ContextBook {
  id: string
  title: string
  author: string
  cover: string
}

interface ContextBarProps {
  currentBook: ContextBook | null
  books: ContextBook[]
  loading: boolean
  onSelect: (bookId: string) => void
  onClear: () => void
}

// ===== 模块级样式（组件外定义，保持各函数 ≤ lint 限长） =====

const barStyle: CSSProperties = {
  position: 'relative',
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  margin: '0 0 8px',
  padding: '8px 12px',
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius)',
}

const pickerStyle: CSSProperties = {
  position: 'absolute',
  right: 0,
  /* 向上展开：条位于视口底部，向下会被截断 */
  bottom: 'calc(100% + 6px)',
  width: 340,
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.14)',
  zIndex: 30,
  padding: 8,
}

const barBtnBase: CSSProperties = {
  font: 'inherit',
  fontSize: '0.78rem',
  padding: '5px 12px',
  borderRadius: 8,
  cursor: 'pointer',
  transition: 'color 0.15s ease, border-color 0.15s ease',
}

// ===== 小组件 =====

/** 书籍封面：优先真实封面图，加载失败/缺失时降级为书名首字渐变块 */
function Cover({ cover, title, width, height }: { cover: string; title: string; width: number; height: number }) {
  const [failed, setFailed] = useState(false)
  if (!cover || failed) {
    return (
      <div
        aria-hidden="true"
        style={{
          width,
          height,
          borderRadius: 6,
          flexShrink: 0,
          background: 'linear-gradient(160deg, var(--chart-1), var(--primary))',
          color: 'var(--primary-foreground)',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 700,
          overflow: 'hidden',
          fontSize: width > 32 ? '0.8rem' : '0.55rem',
          textAlign: 'center',
          padding: 2,
        }}
      >
        {title.slice(0, 2)}
      </div>
    )
  }
  return (
    <img
      src={cover}
      alt={`${title} 封面`}
      onError={() => setFailed(true)}
      style={{
        width,
        height,
        borderRadius: 6,
        objectFit: 'cover',
        flexShrink: 0,
        background: 'var(--muted)',
      }}
    />
  )
}

/** 上下文条内的小型操作按钮（更换/取消共用 hover 语义） */
function BarButton({ label, children, danger, onClick }: {
  label: string
  children: ReactNode
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      style={{
        ...barBtnBase,
        display: 'grid',
        placeItems: 'center',
        width: 28,
        height: 28,
        padding: 0,
        border: '1px solid var(--border)',
        background: 'var(--card)',
        color: 'var(--muted-foreground)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = danger ? 'var(--state-error)' : 'var(--primary)'
        e.currentTarget.style.borderColor = danger ? 'var(--state-error)' : 'var(--primary)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--muted-foreground)'
        e.currentTarget.style.borderColor = 'var(--border)'
      }}
    >
      {children}
    </button>
  )
}

/** 书籍选择 popover 中的单行 */
function PickerItem({ book, active, onSelect }: { book: ContextBook; active: boolean; onSelect: (id: string) => void }) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      type="button"
      onClick={() => onSelect(book.id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        padding: '9px 10px',
        border: '1px solid transparent',
        borderRadius: 10,
        background: active ? 'var(--sidebar-accent)' : hovered ? 'var(--muted)' : 'transparent',
        color: 'inherit',
        font: 'inherit',
        textAlign: 'left',
        cursor: 'pointer',
        transition: 'background 0.15s ease, border-color 0.15s ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Cover cover={book.cover} title={book.title} width={38} height={52} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: '0.85rem',
            fontWeight: 600,
            color: 'var(--foreground)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {book.title}
        </div>
        <Tiny>{book.author || '未知作者'}</Tiny>
      </div>
      {active && (
        <span
          aria-label="当前关联"
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            background: 'var(--primary)',
            color: 'var(--primary-foreground)',
            display: 'grid',
            placeItems: 'center',
            flexShrink: 0,
          }}
        >
          <Icon name="check" size={12} />
        </span>
      )}
    </button>
  )
}

/** 书籍选择 popover（更换 / 首次关联共用；选完/点外自动关闭） */
function BookPicker({ books, currentBookId, onSelect, onClose }: {
  books: ContextBook[]
  currentBookId: string | null
  onSelect: (id: string) => void
  onClose: () => void
}) {
  return (
    <div style={pickerStyle}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 8px 10px',
          borderBottom: '1px solid var(--border)',
          marginBottom: 6,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--foreground)' }}>
            选择关联书籍
          </div>
          <Tiny>AI 将基于该书的笔记与划线作答</Tiny>
        </div>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          aria-label="关闭书籍选择"
          onClick={onClose}
          style={{
            width: 26,
            height: 26,
            display: 'grid',
            placeItems: 'center',
            border: 'none',
            background: 'transparent',
            color: 'var(--muted-foreground)',
            cursor: 'pointer',
            borderRadius: 6,
            flexShrink: 0,
          }}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      <div style={{ maxHeight: 320, overflowY: 'auto', padding: '0 4px 4px' }}>
        {books.length === 0 ? (
          <Tiny>书架为空，请先在书架页同步书籍</Tiny>
        ) : (
          books.map((b) => (
            <PickerItem key={b.id} book={b} active={b.id === currentBookId} onSelect={onSelect} />
          ))
        )}
      </div>
    </div>
  )
}

/** 已关联书籍的展示态 */
function AssociatedBook({ book, pickerOpen, onTogglePicker, onClear }: {
  book: ContextBook
  pickerOpen: boolean
  onTogglePicker: () => void
  onClear: () => void
}) {
  return (
    <>
      <Cover cover={book.cover} title={book.title} width={40} height={56} />
      <div style={{ minWidth: 0 }}>
        <div
          title={book.title}
          style={{
            fontSize: '0.85rem',
            fontWeight: 600,
            color: 'var(--foreground)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            maxWidth: 340,
          }}
        >
          {book.title}
        </div>
        <Tiny>{book.author || '未知作者'}</Tiny>
      </div>
      <span style={{ flex: 1 }} />
      <button
        type="button"
        onClick={onTogglePicker}
        aria-expanded={pickerOpen}
        style={{
          ...barBtnBase,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          border: '1px solid var(--border)',
          background: 'var(--card)',
          color: 'var(--muted-foreground)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--primary)'
          e.currentTarget.style.borderColor = 'var(--primary)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--muted-foreground)'
          e.currentTarget.style.borderColor = 'var(--border)'
        }}
      >
        <Icon name="refresh" size={12} /> 更换关联
      </button>
      <BarButton label={`取消关联：${book.title}`} danger onClick={onClear}>
        <Icon name="close" size={13} />
      </BarButton>
    </>
  )
}

/** 主组件 ===== */
export default function ContextBar({ currentBook, books, loading, onSelect, onClear }: ContextBarProps) {
  const [pickerOpen, setPickerOpen] = useState(false)

  if (loading) {
    return (
      <div style={barStyle}>
        <Loading hint="加载书籍上下文..." />
      </div>
    )
  }

  /** 选书后自动关闭 popover（此前重构时遗失了关闭逻辑） */
  const handleSelect = (id: string) => {
    onSelect(id)
    setPickerOpen(false)
  }

  return (
    <div style={barStyle}>
      {currentBook ? (
        <AssociatedBook
          book={currentBook}
          pickerOpen={pickerOpen}
          onTogglePicker={() => setPickerOpen((v) => !v)}
          onClear={onClear}
        />
      ) : (
        <button
          type="button"
          onClick={() => setPickerOpen(true)}
          aria-expanded={pickerOpen}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            width: '100%',
            padding: '9px 12px',
            border: '1px dashed var(--border)',
            borderRadius: 8,
            background: 'transparent',
            color: 'var(--muted-foreground)',
            font: 'inherit',
            fontSize: '0.8rem',
            cursor: 'pointer',
            transition: 'color 0.15s ease, border-color 0.15s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--primary)'
            e.currentTarget.style.borderColor = 'var(--primary)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--muted-foreground)'
            e.currentTarget.style.borderColor = 'var(--border)'
          }}
        >
          <Icon name="plus" size={13} />
          关联书籍后，AI 将基于这本书的笔记与检索作答
        </button>
      )}

      {pickerOpen && (
        <>
          {/* 透明点击捕获层：点 popover 外任意处关闭 */}
          <div
            onClick={() => setPickerOpen(false)}
            aria-hidden="true"
            style={{ position: 'fixed', inset: 0, zIndex: 29 }}
          />
          <BookPicker
            books={books}
            currentBookId={currentBook?.id ?? null}
            onSelect={handleSelect}
            onClose={() => setPickerOpen(false)}
          />
        </>
      )}
    </div>
  )
}
