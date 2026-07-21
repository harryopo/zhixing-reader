/**
 * Notes — 笔记页（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/notes.html
 *
 * 结构：
 *   - hero: 标题 + 副标题（共 X 条笔记 · 跨 Y 本书） + 3 actions（新建/导出/搜索）
 *   - 可选: 展开式搜索框（点击"搜索"按钮切换显示）
 *   - 主体: 1fr 书籍分组列表 + 2fr 笔记流（卡片内卡片）
 *
 * 业务逻辑全部保留：loadData (highlight.getAll + book.getAll) / 搜索 / 书籍筛选
 */

import { useEffect, useMemo, useState } from 'react'
import PageHero from '@/components/layout/PageHero'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { Loading, EmptyState } from '@/components/ui/Feedback'
import { mapBooks, mapHighlights, formatTimeAgo } from '../utils/db-mapper'
import { toast } from '../stores/toastStore'

// ===== 类型 =====
interface BookRow {
  id: string
  title: string
  author: string
}

interface HighlightRow {
  id: string
  bookId: string
  chapterTitle: string
  content: string
  note: string
  createdAt: string
}

// ===== 工具函数 =====

/** 从文本中提取 #标签（中文/英文/数字/下划线） */
function extractTags(...texts: (string | undefined)[]): string[] {
  const joined = texts.filter(Boolean).join(' ')
  if (!joined) return []
  const matches = joined.match(/#[\u4e00-\u9fa5a-zA-Z0-9_]+/g)
  return matches ? Array.from(new Set(matches)).slice(0, 5) : []
}

/** 笔记标题：从 content 提取首句作为标题（最长 30 字，超出加省略号） */
function deriveTitle(content: string): string {
  if (!content) return '（无内容）'
  const firstSentence = content.split(/[。！？!?\n]/)[0] || content
  if (firstSentence.length <= 30) return firstSentence
  return firstSentence.slice(0, 30) + '…'
}

// ===== 主组件 =====
export default function Notes() {
  const [highlights, setHighlights] = useState<HighlightRow[]>([])
  const [books, setBooks] = useState<BookRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedBook, setSelectedBook] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    if (!window.electronAPI?.highlight || !window.electronAPI?.book) {
      setLoading(false)
      return
    }
    try {
      const [highlightsRaw, booksRaw] = await Promise.all([
        window.electronAPI.highlight.getAll(),
        window.electronAPI.book.getAll(),
      ])
      setHighlights(mapHighlights(highlightsRaw as unknown[]) as unknown as HighlightRow[])
      setBooks(mapBooks(booksRaw as unknown[]) as unknown as BookRow[])
    } catch (error) {
      console.error('加载数据失败:', error)
      toast.error('加载笔记失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const getBookTitle = (bookId: string) => {
    if (!bookId) return '未知书籍'
    const book = books.find((b) => b.id === bookId)
    return book?.title || '未知书籍'
  }

  /** 每本书的笔记数（用于左侧列表 badge 与筛选"有笔记的书"） */
  const bookHighlightCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const h of highlights) {
      const bid = h.bookId
      if (bid) counts.set(bid, (counts.get(bid) || 0) + 1)
    }
    return counts
  }, [highlights])

  /** 仅显示有笔记的书（与设计稿一致：书籍分组 = 有笔记的书） */
  const booksWithNotes = useMemo(() => {
    return books.filter((b) => (bookHighlightCounts.get(b.id) || 0) > 0)
  }, [books, bookHighlightCounts])

  const filteredHighlights = useMemo(() => {
    let result = highlights

    if (selectedBook) {
      result = result.filter((h) => h.bookId === selectedBook)
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      const terms = query.split(/\s+/).filter((t) => t.length > 0)
      result = result.filter((h) => {
        const content = (h.content || '').toLowerCase()
        const note = (h.note || '').toLowerCase()
        const chapterTitle = (h.chapterTitle || '').toLowerCase()
        const bookTitle = getBookTitle(h.bookId).toLowerCase()
        const searchText = `${content} ${note} ${chapterTitle} ${bookTitle}`
        return terms.every((term) => searchText.includes(term))
      })
    }

    // 按创建时间倒序，最近在前
    return [...result].sort((a, b) => {
      const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0
      const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0
      return tb - ta
    })
  }, [highlights, selectedBook, searchQuery, books])

  const streamTitle = selectedBook ? `《${getBookTitle(selectedBook)}》笔记` : '全部笔记'
  const streamSubtitle = (() => {
    const count = filteredHighlights.length
    if (count === 0) return '暂无笔记'
    const latest = filteredHighlights[0]
    const latestLabel = latest?.createdAt ? formatTimeAgo(latest.createdAt) : '未知'
    return `${count} 条 · 最近更新 ${latestLabel}`
  })()

  if (loading) {
    return <Loading hint="正在加载笔记..." />
  }

  return (
    <PageHero
      title="读书笔记"
      subtitle={`共 ${highlights.length} 条笔记 · 跨 ${booksWithNotes.length} 本书`}
      actions={
        <>
          <Button
            variant="primary"
            onClick={() => toast.info('新建笔记功能即将上线')}
            data-dom-id="cta-new"
          >
            <Icon name="plus" size={16} /> 新建笔记
          </Button>
          <Button
            variant="secondary"
            onClick={() => toast.info('导出功能即将上线')}
            data-dom-id="cta-export"
          >
            <Icon name="external-link" size={16} /> 导出全部
          </Button>
          <Button
            variant="ghost"
            onClick={() => setSearchOpen((v) => !v)}
            data-dom-id="cta-search"
          >
            <Icon name="search" size={16} /> 搜索
          </Button>
        </>
      }
    >
      {/* 展开式搜索框（点击"搜索"按钮切换显示） */}
      {searchOpen && (
        <Card padding="calc(var(--spacing) * 3) calc(var(--spacing) * 5)">
          <CompactSearch
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="搜索笔记内容、批注、章节..."
          />
        </Card>
      )}

      {/* 主体: 1fr 书籍分组 + 2fr 笔记流 */}
      {highlights.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon name="notes" size={24} />}
            title="还没有笔记"
            description="请先到书架导入微信读书笔记"
          />
        </Card>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 2fr',
            gap: 'calc(var(--spacing) * 5)',
            minHeight: 'calc(100vh - 76px - 200px)',
          }}
        >
          {/* ===== 左侧: 书籍分组 ===== */}
          <Card
            padding={0}
            style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            {/* header */}
            <div
              style={{
                padding: 'calc(var(--spacing) * 4) calc(var(--spacing) * 5)',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span
                style={{
                  fontSize: '0.78rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--muted-foreground)',
                }}
              >
                书籍分组
              </span>
              <Badge>{booksWithNotes.length}</Badge>
            </div>

            {/* list */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 'calc(var(--spacing) * 2)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'calc(var(--spacing) * 1)',
              }}
            >
              <BookButton
                active={selectedBook === ''}
                title="全部书籍"
                count={highlights.length}
                isAll
                onClick={() => setSelectedBook('')}
              />
              {booksWithNotes.map((book) => (
                <BookButton
                  key={book.id}
                  active={selectedBook === book.id}
                  title={book.title}
                  count={bookHighlightCounts.get(book.id) || 0}
                  onClick={() => setSelectedBook(book.id)}
                />
              ))}
            </div>
          </Card>

          {/* ===== 右侧: 笔记流 ===== */}
          <Card
            padding={0}
            style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            {/* header */}
            <div
              style={{
                padding: 'calc(var(--spacing) * 4) calc(var(--spacing) * 5)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <strong
                style={{
                  fontSize: '1rem',
                  fontWeight: 600,
                  color: 'var(--card-foreground)',
                }}
              >
                {streamTitle}
              </strong>
              <div
                style={{
                  fontSize: '0.78rem',
                  color: 'var(--muted-foreground)',
                  marginTop: '0.3rem',
                }}
              >
                {streamSubtitle}
              </div>
            </div>

            {/* stream */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 'calc(var(--spacing) * 5)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'calc(var(--spacing) * 4)',
              }}
            >
              {filteredHighlights.length === 0 ? (
                <EmptyState
                  icon={<Icon name="search" size={24} />}
                  title={searchQuery ? '没有找到匹配的笔记' : '当前书籍暂无笔记'}
                  description={
                    searchQuery
                      ? '尝试调整搜索关键词或清除筛选条件'
                      : '选择左侧的"全部书籍"查看所有笔记'
                  }
                  style={{ padding: 'calc(var(--spacing) * 8) calc(var(--spacing) * 4)' }}
                />
              ) : (
                filteredHighlights.map((h) => (
                  <NoteItem
                    key={h.id}
                    highlight={h}
                    bookTitle={getBookTitle(h.bookId)}
                    onEdit={() => toast.info('编辑笔记功能即将上线')}
                    onDelete={() => toast.info('删除笔记功能即将上线')}
                  />
                ))
              )}
            </div>
          </Card>
        </div>
      )}
    </PageHero>
  )
}

// ===== 子组件: 书籍按钮 =====
interface BookButtonProps {
  active: boolean
  title: string
  count: number
  isAll?: boolean
  onClick: () => void
}

function BookButton({ active, title, count, isAll, onClick }: BookButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active ? 'true' : 'false'}
      style={{
        width: '100%',
        padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
        textAlign: 'left',
        border: 'none',
        background: active ? 'var(--sidebar-accent)' : 'transparent',
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        gap: 'calc(var(--spacing) * 3)',
        transition: 'background 0.2s ease, color 0.2s ease',
        font: 'inherit',
      }}
      onMouseEnter={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'var(--sidebar-accent)'
        }
      }}
      onMouseLeave={(e) => {
        if (!active) {
          e.currentTarget.style.background = 'transparent'
        }
      }}
    >
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.2rem',
          minWidth: 0,
        }}
      >
        <span
          style={{
            fontSize: '0.88rem',
            fontWeight: 500,
            color: 'var(--card-foreground)',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {isAll ? title : `《${title}》`}
        </span>
        <span
          style={{
            fontSize: '0.72rem',
            color: 'var(--muted-foreground)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          {count} 条
        </span>
      </span>
      <Badge variant={active ? 'alert' : 'default'}>{count}</Badge>
    </button>
  )
}

// ===== 子组件: 笔记条目 =====
interface NoteItemProps {
  highlight: HighlightRow
  bookTitle: string
  onEdit?: () => void
  onDelete?: () => void
}

function NoteItem({ highlight, bookTitle, onEdit, onDelete }: NoteItemProps) {
  const chapter =
    highlight.chapterTitle && highlight.chapterTitle !== '未知章节'
      ? highlight.chapterTitle
      : ''
  const tags = extractTags(highlight.content, highlight.note)
  const title = deriveTitle(highlight.content)

  return (
    <div
      style={{
        padding: 'calc(var(--spacing) * 5)',
        border: '1px solid var(--border)',
        borderRadius: 'calc(var(--radius) + 4px)',
        background: 'var(--background)',
      }}
    >
      {/* 顶部 row: chapter eyebrow + time + 编辑/删除 icon-btn */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 'calc(var(--spacing) * 3)',
          marginBottom: 'calc(var(--spacing) * 3)',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.2rem',
            minWidth: 0,
          }}
        >
          <span
            style={{
              fontSize: '0.78rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              color: 'var(--muted-foreground)',
            }}
          >
            {chapter || bookTitle}
          </span>
          <span
            style={{
              fontSize: '0.72rem',
              color: 'var(--muted-foreground)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {formatTimeAgo(highlight.createdAt)}
          </span>
        </div>
        <div
          style={{
            display: 'flex',
            gap: 'calc(var(--spacing) * 2)',
            flexShrink: 0,
          }}
        >
          <IconButton28 icon="edit" label="编辑笔记" onClick={onEdit} />
          <IconButton28 icon="trash" label="删除笔记" onClick={onDelete} />
        </div>
      </div>

      {/* 标题（首句作为标题） */}
      <h3
        style={{
          fontSize: '1rem',
          fontWeight: 600,
          color: 'var(--card-foreground)',
          margin: '0 0 calc(var(--spacing) * 2) 0',
        }}
      >
        {title}
      </h3>

      {/* 内容 */}
      <p
        style={{
          fontSize: '0.92rem',
          lineHeight: 1.7,
          color: 'var(--card-foreground)',
          margin: 0,
        }}
      >
        {highlight.content}
      </p>

      {/* 批注（如有 note） */}
      {!!highlight.note && (
        <p
          style={{
            fontSize: '0.88rem',
            lineHeight: 1.7,
            color: 'var(--muted-foreground)',
            fontStyle: 'italic',
            margin: 'calc(var(--spacing) * 2) 0 0',
            borderLeft: '2px solid var(--border)',
            paddingLeft: 'calc(var(--spacing) * 3)',
          }}
        >
          {highlight.note}
        </p>
      )}

      {/* 标签 chips */}
      {tags.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 'calc(var(--spacing) * 2)',
            marginTop: 'calc(var(--spacing) * 3)',
          }}
        >
          {tags.map((tag) => (
            <span
              key={tag}
              style={{
                padding: 'calc(var(--spacing) * 1.5) calc(var(--spacing) * 3)',
                border: '1px solid var(--border)',
                background: 'var(--card)',
                color: 'var(--muted-foreground)',
                borderRadius: 'var(--radius)',
                fontSize: '0.75rem',
                whiteSpace: 'nowrap',
              }}
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ===== 子组件: 28px icon button（设计稿笔记卡片右上角编辑/删除按钮） =====
function IconButton28({
  icon,
  label,
  onClick,
}: {
  icon: 'edit' | 'trash'
  label: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        display: 'grid',
        placeItems: 'center',
        border: '1px solid var(--border)',
        background: 'var(--card)',
        color: 'var(--foreground)',
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        padding: 0,
        transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
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
    >
      <Icon name={icon} size={14} />
    </button>
  )
}

// ===== 子组件: 紧凑搜索框 =====
function CompactSearch({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <div
      role="search"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'calc(var(--spacing) * 3)',
        width: '100%',
        padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 4)',
        border: '1px solid var(--input)',
        borderRadius: 999,
        background: 'var(--popover)',
        color: 'var(--muted-foreground)',
      }}
    >
      <Icon name="search" size={16} />
      <input
        type="search"
        aria-label="搜索笔记"
        placeholder={placeholder ?? '搜索...'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'var(--foreground)',
          width: '100%',
          fontSize: '0.85rem',
          fontFamily: 'inherit',
        }}
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="清除搜索"
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--muted-foreground)',
            cursor: 'pointer',
            padding: 0,
            display: 'grid',
            placeItems: 'center',
          }}
        >
          <Icon name="close" size={14} />
        </button>
      )}
    </div>
  )
}
