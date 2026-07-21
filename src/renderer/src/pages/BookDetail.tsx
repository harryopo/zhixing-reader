/**
 * BookDetail — 书籍详情页（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/book-detail.html
 *
 * 结构：
 *   - hero: 书名 + 作者 · 出版社 · 年份 + 3 actions（继续阅读 / AI 对话此书 / 返回书架）
 *   - 第一层双栏 grid [1fr 2fr]:
 *     - 左栏封面卡: book-cover-large + 4 stat-mini (进度/已读/划线/笔记) + progress-bar
 *     - 右栏信息卡: description + 4 meta-item (ISBN/分类/字数/难度) + 4 action-btn
 *   - 第二层 tab card: 划线 / 笔记 / 知识卡片 三标签 + 列表
 *
 * 业务逻辑全部保留:
 *   - loadBookData (book.getById + highlight.getByBook + card.getByBook)
 *   - handleImportNotes (weread.fetchAllContent)
 *   - 进度显示、笔记列表渲染、卡片列表渲染
 */

import { useState, useEffect, useMemo, ReactNode } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { Loading, EmptyState, Tiny } from '@/components/ui/Feedback'
import { toast } from '../stores/toastStore'
import {
  mapBooks,
  mapHighlights,
  mapCards,
  safeNum,
  safeStr,
  formatDate,
  formatDateShort,
} from '../utils/db-mapper'

// ===== 类型 =====
interface BookRow {
  id: string
  title: string
  author: string
  cover: string
  isbn: string
  publisher: string
  description: string
  category: string
  progress: number
  reading_progress?: number
  totalChapter?: number
  total_chapter?: number
  lastReadAt: string
  createdAt: string
  source?: string
}

interface HighlightRow {
  id: string
  bookId: string
  content: string
  note: string
  chapterTitle: string
  chapterId: string
  type?: string
  createdAt: string
}

interface CardRow {
  id: string
  bookId: string
  reviewCount: number
  nextReviewAt: string
  lastReviewAt: string
  createdAt: string
}

// ===== 工具 =====

/** 渲染阅读难度星级（默认 3 星） */
function renderDifficulty(level: number): { filled: string; empty: string } {
  const safe = Math.max(1, Math.min(5, level))
  return { filled: '★'.repeat(safe), empty: '☆'.repeat(5 - safe) }
}

// ===== 主组件 =====
type TabKey = 'highlights' | 'notes' | 'cards'

export default function BookDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [book, setBook] = useState<BookRow | null>(null)
  const [highlights, setHighlights] = useState<HighlightRow[]>([])
  const [cards, setCards] = useState<CardRow[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [activeTab, setActiveTab] = useState<TabKey>('highlights')

  useEffect(() => {
    if (id) loadBookData(id)
  }, [id])

  const loadBookData = async (bookId: string) => {
    if (!window.electronAPI?.book || !window.electronAPI?.highlight || !window.electronAPI?.card) {
      setLoading(false)
      return
    }
    try {
      const [bookData, highlightsRaw, cardsRaw] = await Promise.all([
        window.electronAPI.book.getById(bookId),
        window.electronAPI.highlight.getByBook(bookId),
        window.electronAPI.card.getByBook(bookId),
      ])
      const books = mapBooks(bookData ? [bookData] : []) as unknown as BookRow[]
      setBook(books.length > 0 ? books[0] : null)
      setHighlights(mapHighlights(highlightsRaw as unknown[]) as unknown as HighlightRow[])
      setCards(mapCards(cardsRaw as unknown[]) as unknown as CardRow[])
    } catch (error) {
      console.error('加载书籍数据失败:', error)
      toast.error('加载书籍详情失败')
    } finally {
      setLoading(false)
    }
  }

  const handleImportNotes = async () => {
    if (!id) return
    setImporting(true)
    const importToastId = toast.loading('正在从微信读书导入笔记...')
    try {
      const content = (await window.electronAPI.weread.fetchAllContent(id)) as {
        bookmarks: Array<{
          bookmarkId: string
          bookId: string
          chapterUid: number
          chapterTitle: string
          markText: string
          style: number
          range: string
          createTime: number
        }>
        notes: Array<{
          reviewId: string
          bookId: string
          chapterUid: number
          chapterTitle: string
          abstract: string
          content: string
          range: string
          createTime: number
        }>
      }

      let newCount = 0
      let totalCount = 0
      if (content.bookmarks && content.bookmarks.length > 0) {
        for (const bm of content.bookmarks) {
          try {
            const isNew = await window.electronAPI.highlight.create({
              bookId: id,
              content: bm.markText,
              chapterTitle: bm.chapterTitle,
              chapterUid: bm.chapterUid,
              type: 'highlight',
              source: 'weread',
              createdAt: bm.createTime,
            })
            totalCount++
            if (isNew) newCount++
          } catch (e) {
            console.error('导入划线失败:', e)
          }
        }
      }
      if (content.notes && content.notes.length > 0) {
        for (const note of content.notes) {
          try {
            const isNew = await window.electronAPI.highlight.create({
              bookId: id,
              content: note.abstract,
              note: note.content,
              chapterTitle: note.chapterTitle,
              chapterUid: note.chapterUid,
              type: 'note',
              source: 'weread',
              createdAt: note.createTime,
            })
            totalCount++
            if (isNew) newCount++
          } catch (e) {
            console.error('导入笔记失败:', e)
          }
        }
      }

      await loadBookData(id)
      toast.remove(importToastId)
      if (newCount > 0) {
        toast.success(`导入完成！新增 ${newCount} 条笔记（已自动生成复习卡片）`)
      } else if (totalCount > 0) {
        toast.info('笔记已是最新，无需重复导入')
      } else {
        toast.info('没有找到笔记')
      }
    } catch (error) {
      toast.remove(importToastId)
      toast.error(`导入失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setImporting(false)
    }
  }

  /** 本应用无内置阅读器：外开微信读书，不假装本地可读。
   *  仅 weread 来源的书籍可在微信读书打开；本地导入书籍 id 非微信读书 bookId，打开会跳到无效页面。
   *  旧数据 source 为 null/undefined 时按 weread 处理（保持向后兼容）。
   */
  const openInWeRead = async () => {
    if (!id) return
    if (book?.source && book.source !== 'weread') {
      toast.warning('本书非微信读书来源，无法在微信读书打开')
      return
    }
    const url = `https://weread.qq.com/web/reader/${encodeURIComponent(id)}`
    try {
      if (window.electronAPI?.system?.openExternal) {
        await window.electronAPI.system.openExternal(url)
        toast.success('已在浏览器打开微信读书')
      } else {
        window.open(url, '_blank', 'noopener,noreferrer')
      }
    } catch (error) {
      toast.error(`无法打开微信读书: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const goChatWithBook = () => {
    if (!id) {
      navigate('/chat')
      return
    }
    navigate(`/chat?bookId=${encodeURIComponent(id)}`)
  }

  // ===== 派生数据 =====
  const progress = safeNum(book?.progress ?? book?.reading_progress)
  const progressPct = Math.round(progress * 100)

  const highlightList = useMemo(
    () => highlights.filter((h) => !h.type || h.type === 'highlight'),
    [highlights],
  )
  const noteList = useMemo(() => highlights.filter((h) => h.type === 'note'), [highlights])

  const bookSubtitle = useMemo(() => {
    if (!book) return ''
    const parts: string[] = []
    if (book.author) parts.push(book.author)
    if (book.publisher) parts.push(book.publisher)
    if (book.createdAt) {
      const year = new Date(book.createdAt).getFullYear()
      if (!isNaN(year)) parts.push(String(year))
    }
    return parts.join(' · ')
  }, [book])

  const totalChapter = safeNum(book?.totalChapter ?? book?.total_chapter)

  if (loading) {
    return <Loading hint="正在加载书籍详情..." />
  }

  if (!book) {
    return (
      <EmptyState
        icon={<Icon name="bookshelf" size={24} />}
        title="书籍未找到"
        description="该书籍可能已被移除或同步失败"
        action={
          <Button variant="primary" onClick={() => navigate('/bookshelf')}>
            返回书架
          </Button>
        }
      />
    )
  }

  const difficulty = renderDifficulty(3) // 默认 3 星（数据库暂无难度字段）

  return (
    <PageHero
      title={book.title}
      subtitle={bookSubtitle}
      actions={
        <>
          {book?.source === 'weread' || !book?.source ? (
            <Button
              variant="primary"
              data-dom-id="cta-read"
              onClick={() => void openInWeRead()}
              title="本应用不同步全书正文，将打开微信读书网页版"
            >
              在微信读书打开
            </Button>
          ) : (
            <Button
              variant="ghost"
              data-dom-id="cta-read-disabled"
              disabled
              title="本书非微信读书来源，无法在微信读书打开"
            >
              本地书籍（暂不支持阅读）
            </Button>
          )}
          <Button
            variant="secondary"
            data-dom-id="cta-chat-book"
            onClick={goChatWithBook}
          >
            AI 对话此书
          </Button>
          <Button
            variant="ghost"
            data-dom-id="cta-back"
            onClick={() => navigate('/bookshelf')}
          >
            返回书架
          </Button>
        </>
      }
    >
      {/* ===== 第一层：双栏 detail grid (1fr cover + 2fr info) ===== */}
      <div
        className="book-detail-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)',
          gap: 'calc(var(--spacing) * 5)',
        }}
      >
        {/* 左栏：封面卡 */}
        <Card>
          {/* book-cover-large */}
          <div
            className="book-cover-large"
            style={{
              width: '100%',
              aspectRatio: '3 / 4',
              borderRadius: 'calc(var(--radius) + 4px)',
              background: book.cover
                ? `url(${book.cover}) center/cover no-repeat`
                : 'linear-gradient(135deg, var(--chart-1), color-mix(in srgb, var(--chart-4) 80%, black))',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--primary-foreground)',
              fontWeight: 700,
              fontSize: '1.5rem',
              textAlign: 'center',
              padding: 'calc(var(--spacing) * 6)',
              lineHeight: 1.3,
              wordBreak: 'keep-all',
              overflowWrap: 'break-word',
              overflow: 'hidden',
            }}
          >
            {!book.cover && book.title}
          </div>

          {/* book-stats: 4 stat-mini */}
          <div
            className="grid grid-cols-2"
            style={{ gap: 'calc(var(--spacing) * 3)', marginTop: 'calc(var(--spacing) * 5)' }}
          >
            <StatMini label="进度" value={`${progressPct}%`} />
            <StatMini
              label="已读"
              value={book.lastReadAt ? formatDateShort(book.lastReadAt) : '-'}
            />
            <StatMini label="划线" value={String(highlightList.length)} />
            <StatMini label="笔记" value={String(noteList.length)} />
          </div>

          {/* progress-bar */}
          <div style={{ marginTop: 'calc(var(--spacing) * 4)' }}>
            <div
              style={{
                height: 6,
                background: 'var(--muted)',
                borderRadius: 999,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  width: `${progressPct}%`,
                  background: 'var(--primary)',
                  borderRadius: 999,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <div
              className="flex justify-between"
              style={{
                fontSize: '0.78rem',
                color: 'var(--muted-foreground)',
                marginTop: '0.4rem',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)' }}>{progressPct}%</span>
              <span>
                {totalChapter > 0 ? `共 ${totalChapter} 章` : '章节信息未知'}
              </span>
            </div>
          </div>
        </Card>

        {/* 右栏：书籍信息卡 */}
        <Card>
          {/* book-description */}
          <div>
            <div
              style={{
                color: 'var(--muted-foreground)',
                fontSize: '0.75rem',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              书籍简介
            </div>
            <p
              style={{
                fontSize: '0.92rem',
                lineHeight: 1.7,
                color: 'var(--card-foreground)',
                margin: 'calc(var(--spacing) * 2) 0 0',
              }}
            >
              {book.description || '暂无简介'}
            </p>
          </div>

          {/* book-meta-grid: 4 meta-item */}
          <div
            className="grid grid-cols-2"
            style={{ gap: 'calc(var(--spacing) * 4)', marginTop: 'calc(var(--spacing) * 5)' }}
          >
            <MetaItem label="ISBN" value={book.isbn || '-'} mono />
            <MetaItem label="分类" value={book.category || '-'} />
            <MetaItem label="字数" value="-" />
            <MetaItem
              label="阅读难度"
              value={
                <>
                  <span style={{ color: 'var(--chart-3)' }}>{difficulty.filled}</span>
                  <span style={{ color: 'var(--muted-foreground)' }}>{difficulty.empty}</span>
                </>
              }
            />
          </div>

          {/* book-actions: 4 action-btn */}
          <div
            className="flex flex-wrap"
            style={{ gap: 'calc(var(--spacing) * 3)', marginTop: 'calc(var(--spacing) * 5)' }}
          >
            <Button
              variant="primary"
              data-dom-id="cta-read-2"
              onClick={() => void openInWeRead()}
              disabled={!!book?.source && book.source !== 'weread'}
              title={
                book?.source && book.source !== 'weread'
                  ? '本书非微信读书来源，无法在微信读书打开'
                  : '本应用不同步全书正文，将打开微信读书网页版'
              }
            >
              {book?.source && book.source !== 'weread' ? '本地书籍（暂不支持阅读）' : '在微信读书打开'}
            </Button>
            <Button
              variant="secondary"
              data-dom-id="cta-add-review"
              onClick={() => navigate('/review')}
            >
              去复习
            </Button>
            <Button
              variant="secondary"
              data-dom-id="cta-import-notes"
              onClick={handleImportNotes}
              disabled={importing}
            >
              <Icon name="refresh" size={14} />
              {importing ? '导入中...' : '导入笔记'}
            </Button>
          </div>
        </Card>
      </div>

      {/* ===== 第二层：标签页 card ===== */}
      <Card padding={0} style={{ overflow: 'hidden' }}>
        {/* tab-nav */}
        <div
          className="flex tab-nav"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <TabBtn
            label="划线"
            count={highlightList.length}
            active={activeTab === 'highlights'}
            onClick={() => setActiveTab('highlights')}
          />
          <TabBtn
            label="笔记"
            count={noteList.length}
            active={activeTab === 'notes'}
            onClick={() => setActiveTab('notes')}
          />
          <TabBtn
            label="知识卡片"
            count={cards.length}
            active={activeTab === 'cards'}
            onClick={() => setActiveTab('cards')}
          />
        </div>

        {/* tab-content */}
        <div style={{ padding: 'calc(var(--spacing) * 5)' }}>
          {activeTab === 'highlights' && (
            <HighlightList
              items={highlightList}
              emptyHint="还没有划线，点击「导入笔记」同步微信读书"
            />
          )}
          {activeTab === 'notes' && (
            <HighlightList items={noteList} emptyHint="还没有笔记" noteMode />
          )}
          {activeTab === 'cards' && (
            <CardList items={cards} emptyHint="还没有知识卡片" />
          )}
        </div>
      </Card>
    </PageHero>
  )
}

// ===== 子组件 =====

/** 单个 stat-mini（封面卡 4 宫格） */
function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div
        style={{
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--muted-foreground)',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '1.15rem',
          fontWeight: 700,
          marginTop: '0.35rem',
          color: 'var(--foreground)',
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
    </div>
  )
}

/** 单个 meta-item（信息卡 4 宫格） */
function MetaItem({
  label,
  value,
  mono,
}: {
  label: string
  value: ReactNode
  mono?: boolean
}) {
  return (
    <div>
      <div
        style={{
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--muted-foreground)',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '0.9rem',
          fontWeight: 600,
          marginTop: '0.35rem',
          color: 'var(--foreground)',
          fontFamily: mono ? 'var(--font-mono)' : 'inherit',
          wordBreak: 'break-all',
        }}
      >
        {value}
      </div>
    </div>
  )
}

/** 标签按钮 */
function TabBtn({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 font-medium tab-btn"
      style={{
        padding: 'calc(var(--spacing) * 4)',
        background: 'transparent',
        border: 'none',
        borderBottom: `2px solid ${active ? 'var(--primary)' : 'transparent'}`,
        color: active ? 'var(--primary)' : 'var(--muted-foreground)',
        fontSize: '0.92rem',
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'color 0.2s ease, border-color 0.2s ease',
        font: 'inherit',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.color = 'var(--foreground)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.color = 'var(--muted-foreground)'
      }}
    >
      {label} ({count})
    </button>
  )
}

/** 划线/笔记列表 */
function HighlightList({
  items,
  emptyHint,
  noteMode,
}: {
  items: HighlightRow[]
  emptyHint: string
  noteMode?: boolean
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Icon name={noteMode ? 'notes' : 'bookshelf'} size={24} />}
        title={noteMode ? '暂无笔记' : '暂无划线'}
        description={emptyHint}
      />
    )
  }
  return (
    <div className="flex flex-col" style={{ gap: 'calc(var(--spacing) * 4)' }}>
      {items.map((h) => (
        <div
          key={h.id}
          style={{
            padding: 'calc(var(--spacing) * 4)',
            borderLeft: `3px solid ${noteMode ? 'var(--chart-3)' : 'var(--chart-1)'}`,
            background: 'var(--background)',
            borderRadius: `0 var(--radius) var(--radius) 0`,
          }}
        >
          <p
            style={{
              fontSize: '0.92rem',
              lineHeight: 1.7,
              color: 'var(--card-foreground)',
              margin: 0,
            }}
          >
            {safeStr(h.content) || '（无内容）'}
          </p>
          {noteMode && h.note && (
            <p
              style={{
                fontSize: '0.85rem',
                lineHeight: 1.6,
                color: 'var(--muted-foreground)',
                margin: 'calc(var(--spacing) * 2) 0 0',
                fontStyle: 'italic',
              }}
            >
              ↳ {h.note}
            </p>
          )}
          <div
            className="flex"
            style={{
              gap: 'calc(var(--spacing) * 3)',
              fontSize: '0.72rem',
              color: 'var(--muted-foreground)',
              marginTop: 'calc(var(--spacing) * 2)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <span>{safeStr(h.chapterTitle, '未知章节')}</span>
            {h.createdAt && (
              <>
                <span>·</span>
                <span>{formatDate(h.createdAt)}</span>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/** 知识卡片列表 */
function CardList({ items, emptyHint }: { items: CardRow[]; emptyHint: string }) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="cards" size={24} />}
        title="暂无知识卡片"
        description={emptyHint}
      />
    )
  }
  return (
    <div className="flex flex-col" style={{ gap: 'calc(var(--spacing) * 4)' }}>
      {items.map((c) => (
        <div
          key={c.id}
          style={{
            padding: 'calc(var(--spacing) * 4)',
            borderLeft: '3px solid var(--chart-5)',
            background: 'var(--background)',
            borderRadius: `0 var(--radius) var(--radius) 0`,
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 'calc(var(--spacing) * 3)',
            }}
          >
            <strong style={{ fontSize: '0.95rem', color: 'var(--foreground)' }}>
              卡片 #{c.id.slice(0, 6)}
            </strong>
            <Badge variant="ok">已复习 {c.reviewCount} 次</Badge>
          </div>
          <Tiny style={{ marginTop: 'calc(var(--spacing) * 2)' }}>
            创建于 {formatDate(c.createdAt)}
            {c.nextReviewAt ? ` · 下次复习 ${formatDate(c.nextReviewAt)}` : ''}
          </Tiny>
        </div>
      ))}
    </div>
  )
}
