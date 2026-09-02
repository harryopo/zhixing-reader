/**
 * BookChip — 头部关联书籍芯片 + 下拉选择 popover（替代原底部 ContextBar，节省纵向空间）
 *
 * 有关联书：真实书封 22×30 + 书名 + 下拉箭头；无关联书：虚线「＋关联书籍」引导。
 * popover 固定定位（头部在 overflow:hidden 卡片内，需 escape 裁剪）；
 * 选完自动关闭、点外部关闭、头部可取消关联。
 */
import { useRef, useState, type CSSProperties, type RefObject } from 'react'
import Icon from '@/components/ui/Icon'
import { Tiny } from '@/components/ui/Feedback'

export interface ChipBook {
  id: string
  title: string
  author: string
  cover: string
}

interface BookChipProps {
  currentBook: ChipBook | null
  books: ChipBook[]
  onSelect: (bookId: string) => void
  onClear: () => void
}

const pickerStyle: CSSProperties = {
  position: 'fixed',
  width: 340,
  background: 'var(--card)',
  border: '1px solid var(--border)',
  borderRadius: 12,
  boxShadow: '0 12px 32px rgba(0, 0, 0, 0.14)',
  zIndex: 40,
  padding: 8,
}

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
          borderRadius: 5,
          flexShrink: 0,
          background: 'linear-gradient(160deg, var(--chart-1), var(--primary))',
          color: 'var(--primary-foreground)',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 700,
          overflow: 'hidden',
          fontSize: width > 26 ? '0.65rem' : '0.5rem',
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
        borderRadius: 5,
        objectFit: 'cover',
        flexShrink: 0,
        background: 'var(--muted)',
      }}
    />
  )
}

/** 书籍选择 popover 中的单行 */
function PickerItem({ book, active, onSelect }: { book: ChipBook; active: boolean; onSelect: (id: string) => void }) {
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
        transition: 'background 0.15s ease',
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

/** 选择列表（含头部：标题 + 取消关联 + 关闭） */
function PickerList({ books, currentBookId, onSelect, onClear, onClose }: {
  books: ChipBook[]
  currentBookId: string | null
  onSelect: (id: string) => void
  onClear: () => void
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
        {currentBookId && (
          <button
            type="button"
            onClick={() => {
              onClear()
              onClose()
            }}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--muted-foreground)',
              font: 'inherit',
              fontSize: '0.75rem',
              cursor: 'pointer',
              padding: '4px 6px',
              borderRadius: 6,
            }}
          >
            取消关联
          </button>
        )}
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

/** 关联书籍芯片（按钮本体，抽出以保持主组件 ≤ lint 限长） */
function ChipButton({ currentBook, btnRef, onToggle }: {
  currentBook: ChipBook | null
  btnRef: RefObject<HTMLButtonElement | null>
  onToggle: () => void
}) {
  const [hovered, setHovered] = useState(false)
  return (
    <button
      ref={btnRef}
      type="button"
      onClick={onToggle}
      aria-expanded={false}
      aria-label={currentBook ? `关联书籍：${currentBook.title}，点击更换` : '关联书籍'}
      title={currentBook ? `关联书籍：${currentBook.title}` : '关联书籍'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 7,
        maxWidth: 220,
        padding: '4px 9px',
        border: currentBook ? '1px solid var(--border)' : '1px dashed var(--border)',
        borderRadius: 999,
        background: 'var(--card)',
        color: currentBook ? 'var(--foreground)' : hovered ? 'var(--primary)' : 'var(--muted-foreground)',
        font: 'inherit',
        fontSize: '0.78rem',
        cursor: 'pointer',
        transition: 'border-color 0.15s ease, color 0.15s ease',
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {currentBook ? (
        <>
          <Cover cover={currentBook.cover} title={currentBook.title} width={22} height={30} />
          <span
            style={{
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              fontWeight: 500,
            }}
          >
            {currentBook.title}
          </span>
          <Icon name="chevron-down" size={13} />
        </>
      ) : (
        <>
          <Icon name="plus" size={12} /> 关联书籍
        </>
      )}
    </button>
  )
}

/** 主组件 ===== */
export default function BookChip({ currentBook, books, onSelect, onClear }: BookChipProps) {
  const [open, setOpen] = useState(false)
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)

  /** 打开前记录按钮位置（popover 用 fixed 定位逃离 overflow:hidden 卡片） */
  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      setAnchor({ top: r.bottom + 6, right: window.innerWidth - r.right })
    }
    setOpen((v) => !v)
  }

  const handleSelect = (id: string) => {
    onSelect(id)
    setOpen(false)
  }

  return (
    <>
      <ChipButton currentBook={currentBook} btnRef={btnRef} onToggle={toggle} />

      {open && anchor && (
        <>
          {/* 透明点击捕获层：点 popover 外任意处关闭 */}
          <div
            onClick={() => setOpen(false)}
            aria-hidden="true"
            style={{ position: 'fixed', inset: 0, zIndex: 39 }}
          />
          <PickerList
            books={books}
            currentBookId={currentBook?.id ?? null}
            onSelect={handleSelect}
            onClear={onClear}
            onClose={() => setOpen(false)}
          />
        </>
      )}
    </>
  )
}
