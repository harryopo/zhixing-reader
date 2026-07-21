/**
 * Bookshelf — 书架页（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/bookshelf.html
 *
 * 结构：
 *   - hero: 标题 + 副标题（X 本藏书 · 上次同步 X 前） + 3 actions
 *   - 第一层 card: 筛选 chips（全部/在读/待复习/已读/想读） + 排序 chips + 紧凑搜索
 *   - 第二层 book-grid: auto-fill 160px 网格
 *
 * 业务逻辑全部保留：weread 同步、笔记导入、按最近阅读排序、进度/状态展示
 */

import { useState, useEffect, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { Loading, EmptyState, Tiny } from '@/components/ui/Feedback'
import { toast } from '../stores/toastStore'
import { mapBooks, mapHighlights, mapCards, safeNum, formatTimeAgo } from '../utils/db-mapper'
import { Book } from '../../../shared/types'

// ===== 类型 =====
interface BookRow {
  id: string
  title: string
  author: string
  cover: string
  isbn: string
  publisher: string
  progress: number
  reading_progress?: number
  lastReadAt: string
  lastReadTime?: string
  isFinished?: number
  is_finished?: number
  totalChapter?: number
  total_chapter?: number
}

// ===== 常量 =====

/** 书籍封面占位色板（与设计稿一致：chart-1 → 2 → 5 → 4 → 3 循环） */
const COVER_PALETTE = [
  'var(--chart-1)',
  'var(--chart-2)',
  'var(--chart-5)',
  'var(--chart-4)',
  'var(--chart-3)',
]

/** 筛选维度 */
type FilterKey = 'all' | 'reading' | 'due' | 'finished' | 'wanted'
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'reading', label: '在读' },
  { key: 'due', label: '待复习' },
  { key: 'finished', label: '已读' },
  { key: 'wanted', label: '想读' },
]

/** 排序维度 */
type SortKey = 'recent' | 'title' | 'progress'
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'recent', label: '按最近阅读' },
  { key: 'title', label: '按书名' },
  { key: 'progress', label: '按进度' },
]

// ===== 工具函数 =====

function sortByReadTime(books: BookRow[]): BookRow[] {
  return [...books].sort((a, b) => {
    const timeA = a.lastReadAt ? new Date(a.lastReadAt).getTime() : 0
    const timeB = b.lastReadAt ? new Date(b.lastReadAt).getTime() : 0
    return timeB - timeA
  })
}

function getReadingStatus(book: BookRow): { label: string; variant: 'ok' | 'alert' | 'default' } {
  const progress = safeNum(book.progress ?? book.reading_progress)
  const isFinished = safeNum(book.isFinished ?? book.is_finished)
  if (isFinished === 1 || progress >= 1) return { label: '已读完', variant: 'ok' }
  if (progress > 0) return { label: '在读', variant: 'ok' }
  return { label: '想读', variant: 'default' }
}

function coverColor(index: number): string {
  return COVER_PALETTE[index % COVER_PALETTE.length]
}

// ===== 主组件 =====
export default function Bookshelf() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const [books, setBooks] = useState<BookRow[]>([])
  const [highlights, setHighlights] = useState<Record<string, unknown>[]>([])
  const [cards, setCards] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [importingBookId, setImportingBookId] = useState<string | null>(null)

  // 筛选与排序
  const initialQuery = searchParams.get('q') ?? ''
  const [filter, setFilter] = useState<FilterKey>('all')
  const [sort, setSort] = useState<SortKey>('recent')
  const [query, setQuery] = useState(initialQuery)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    if (!window.electronAPI?.book || !window.electronAPI?.highlight || !window.electronAPI?.card) {
      setLoading(false)
      return
    }
    try {
      const [booksRaw, highlightsRaw] = await Promise.all([
        window.electronAPI.book.getAll(),
        window.electronAPI.highlight.getAll(),
      ])
      const mappedBooks = sortByReadTime(mapBooks(booksRaw as unknown[]) as unknown as BookRow[])
      setBooks(mappedBooks)
      setHighlights(mapHighlights(highlightsRaw as unknown[]))

      // 并行获取每本书的卡片数（限制 100 本）
      const bookIds = mappedBooks.map((b) => b.id).slice(0, 100)
      const cardLists = await Promise.all(
        bookIds.map((id) => window.electronAPI.card.getByBook(id).catch(() => [])),
      )
      setCards(mapCards(cardLists.flat() as unknown[]))
    } catch (error) {
      console.error('加载数据失败:', error)
      toast.error('加载书架数据失败')
    } finally {
      setLoading(false)
    }
  }

  const handleSync = useCallback(async () => {
    setSyncing(true)
    const syncToastId = toast.loading('正在同步微信读书书架...')
    try {
      const wereadBooks = (await window.electronAPI.weread.getBookshelf()) as Array<{
        bookId: string
        title: string
        author: string
        cover: string
        isbn: string
        publisher: string
        progress: number
        totalChapter: number
        lastReadTime: number
        readUpdateTime: number
        finishReading: number
        isTop: number
        secret: number
        updateTime: number
      }>

      if (!wereadBooks || wereadBooks.length === 0) {
        toast.remove(syncToastId)
        toast.warning('未获取到书籍，请检查微信读书配置')
        return
      }

      const sortedWereadBooks = [...wereadBooks].sort((a, b) => {
        return (b.readUpdateTime || b.lastReadTime || 0) - (a.readUpdateTime || a.lastReadTime || 0)
      })

      let importedCount = 0
      let updatedCount = 0
      for (const wb of sortedWereadBooks) {
        try {
          const existingBooks = (await window.electronAPI.book.search(wb.title)) as unknown as Book[]
          const exists = existingBooks.some((b) => b.title === wb.title)
          const readTime = wb.readUpdateTime || wb.lastReadTime || 0
          const lastReadTimeStr = readTime > 0 ? new Date(readTime * 1000).toISOString() : null

          if (!exists) {
            await window.electronAPI.book.create({
              id: wb.bookId,
              title: wb.title,
              author: wb.author,
              cover: wb.cover,
              isbn: wb.isbn,
              publisher: wb.publisher,
              reading_progress: wb.progress || 0,
              total_chapter: wb.totalChapter || 0,
              last_read_time: lastReadTimeStr,
              is_finished: wb.finishReading || 0,
              source: 'weread',
            })
            importedCount++
          } else {
            const existing = existingBooks.find((b) => b.title === wb.title)
            if (existing && existing.id) {
              await window.electronAPI.book.update(existing.id as string, {
                reading_progress: wb.progress || 0,
                last_read_time: lastReadTimeStr,
                is_finished: wb.finishReading || 0,
              })
              updatedCount++
            }
          }
        } catch (error) {
          console.error(`同步书籍失败: ${wb.title}`, error)
        }
      }

      await loadData()
      toast.remove(syncToastId)
      toast.success(
        importedCount > 0
          ? `同步成功！共 ${wereadBooks.length} 本书籍，新导入 ${importedCount} 本，更新 ${updatedCount} 本`
          : `书架已是最新，共 ${wereadBooks.length} 本书籍`,
      )
    } catch (error) {
      toast.remove(syncToastId)
      toast.error(`同步失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSyncing(false)
    }
  }, [])

  const handleImportNotes = useCallback(async (bookId: string) => {
    setImportingBookId(bookId)
    const importToastId = toast.loading('正在导入笔记...')
    try {
      const content = (await window.electronAPI.weread.fetchAllContent(bookId)) as {
        bookmarks: Array<{
          bookmarkId: string
          chapterTitle: string
          markText: string
          chapterUid: number
          createTime: number
        }>
        notes: Array<{
          reviewId: string
          chapterTitle: string
          abstract: string
          content: string
          chapterUid: number
          createTime: number
        }>
      }

      let newCount = 0
      let totalCount = 0
      if (content.bookmarks && content.bookmarks.length > 0) {
        for (const bm of content.bookmarks) {
          try {
            const isNew = await window.electronAPI.highlight.create({
              bookId,
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
              bookId,
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

      await loadData()
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
      toast.error(`笔记导入失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setImportingBookId(null)
    }
  }, [])

  // ===== 派生数据 =====

  const lastSyncLabel = useMemo(() => {
    if (!books.length) return '尚未同步'
    const latest = books
      .map((b) => (b.lastReadAt ? new Date(b.lastReadAt).getTime() : 0))
      .sort((a, b) => b - a)[0]
    return latest ? `${formatTimeAgo(new Date(latest).toISOString())} 同步` : '尚未同步'
  }, [books])

  const filteredBooks = useMemo(() => {
    let list = books

    // 筛选
    if (filter !== 'all') {
      list = list.filter((b) => {
        const progress = safeNum(b.progress ?? b.reading_progress)
        const isFinished = safeNum(b.isFinished ?? b.is_finished)
        const bookCards = cards.filter(
          (c) => (c.bookId as string) === b.id,
        )
        const hasDueCard = bookCards.some((c) => {
          const due = c.nextReviewAt as string
          if (!due) return false
          return new Date(due).getTime() <= Date.now()
        })

        switch (filter) {
          case 'reading':
            return isFinished !== 1 && progress > 0 && progress < 1
          case 'due':
            return hasDueCard
          case 'finished':
            return isFinished === 1 || progress >= 1
          case 'wanted':
            return progress === 0 && isFinished !== 1
          default:
            return true
        }
      })
    }

    // 搜索
    if (query.trim()) {
      const q = query.trim().toLowerCase()
      list = list.filter(
        (b) =>
          b.title.toLowerCase().includes(q) ||
          b.author.toLowerCase().includes(q),
      )
    }

    // 排序
    list = [...list]
    switch (sort) {
      case 'recent':
        list.sort((a, b) => {
          const ta = a.lastReadAt ? new Date(a.lastReadAt).getTime() : 0
          const tb = b.lastReadAt ? new Date(b.lastReadAt).getTime() : 0
          return tb - ta
        })
        break
      case 'title':
        list.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'))
        break
      case 'progress':
        list.sort(
          (a, b) =>
            safeNum(b.progress ?? b.reading_progress) -
            safeNum(a.progress ?? a.reading_progress),
        )
        break
    }
    return list
  }, [books, cards, filter, sort, query])

  const getBookHighlights = (bookId: string) =>
    highlights.filter((h) => h.bookId === bookId)
  const getBookCards = (bookId: string) => cards.filter((c) => (c.bookId as string) === bookId)

  if (loading) {
    return <Loading hint="正在加载书架..." />
  }

  return (
    <>
      <PageHero
        title="书架"
        subtitle={`${books.length} 本藏书 · 上次同步 ${lastSyncLabel}`}
        actions={
          <>
            <Button variant="primary" onClick={handleSync} disabled={syncing} data-dom-id="cta-sync">
              <Icon name="refresh" size={16} />
              {syncing ? '同步中...' : '同步微信读书'}
            </Button>
            <Button
              variant="secondary"
              onClick={() => toast.info('本地 EPUB 导入即将上线')}
              data-dom-id="cta-import"
            >
              <Icon name="file" size={16} /> 导入本地 EPUB
            </Button>
            <Button
              variant="ghost"
              onClick={() => toast.info('批量管理模式即将上线')}
              data-dom-id="cta-manage"
            >
              <Icon name="grip" size={16} /> 批量管理
            </Button>
          </>
        }
      >
        {/* ===== 第一层：筛选条 ===== */}
        <div
          className="card"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 'calc(var(--radius) + 6px)',
            padding: 'calc(var(--spacing) * 4) calc(var(--spacing) * 5)',
            color: 'var(--card-foreground)',
          }}
        >
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 'calc(var(--spacing) * 3)',
              marginBottom: 'calc(var(--spacing) * 3)',
              flexWrap: 'wrap',
            }}
          >
            <Chips items={FILTERS} value={filter} onChange={setFilter} />
            <CompactSearch value={query} onChange={setQuery} placeholder="搜索书名或作者" />
          </div>
          <Chips items={SORTS} value={sort} onChange={setSort} />
        </div>

        {/* ===== 第二层：书籍网格 ===== */}
        {filteredBooks.length === 0 ? (
          <EmptyState
            icon={<Icon name="bookshelf" size={24} />}
            title={books.length === 0 ? '还没有书籍' : '没有符合条件的书籍'}
            description={
              books.length === 0
                ? '点击上方按钮同步微信读书书架'
                : '尝试调整筛选条件或搜索关键词'
            }
            action={
              books.length === 0 ? (
                <Button variant="primary" onClick={handleSync} disabled={syncing}>
                  <Icon name="refresh" size={16} /> 开始同步
                </Button>
              ) : undefined
            }
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 'calc(var(--radius) + 6px)',
            }}
          />
        ) : (
          <div
            className="book-grid"
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
              gap: 'calc(var(--spacing) * 5)',
            }}
          >
            {filteredBooks.map((book, i) => {
              const progress = safeNum(book.progress ?? book.reading_progress)
              const status = getReadingStatus(book)
              const bookCards = getBookCards(book.id)
              const hasDueCard = bookCards.some((c) => {
                const due = c.nextReviewAt as string
                return due && new Date(due).getTime() <= Date.now()
              })
              const showBadge =
                status.variant !== 'default' || hasDueCard || progress > 0
              const badgeVariant: 'ok' | 'alert' | 'default' = hasDueCard
                ? 'alert'
                : status.variant
              const badgeLabel = hasDueCard ? '待复习' : status.label
              const pct = Math.round(progress * 100)

              return (
                <button
                  key={book.id}
                  type="button"
                  data-dom-id={`book-card-${book.id}`}
                  onClick={() => navigate(`/bookshelf/${book.id}`)}
                  style={{
                    position: 'relative',
                    display: 'block',
                    width: '100%',
                    padding: 0,
                    textAlign: 'left',
                    border: '1px solid var(--border)',
                    borderRadius: 'calc(var(--radius) + 4px)',
                    background: 'var(--card)',
                    cursor: 'pointer',
                    transition: 'border-color 0.2s ease, transform 0.16s ease',
                    overflow: 'hidden',
                    font: 'inherit',
                    color: 'inherit',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--ring)'
                    e.currentTarget.style.transform = 'translateY(-2px)'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border)'
                    e.currentTarget.style.transform = 'translateY(0)'
                  }}
                >
                  {/* 右上角状态徽章 */}
                  {showBadge && (
                    <span
                      style={{
                        position: 'absolute',
                        top: 'calc(var(--spacing) * 2)',
                        right: 'calc(var(--spacing) * 2)',
                        zIndex: 1,
                      }}
                    >
                      <Badge variant={badgeVariant}>{badgeLabel}</Badge>
                    </span>
                  )}

                  {/* 封面 */}
                  <div
                    className="book-cover"
                    style={{
                      aspectRatio: '3 / 4',
                      borderRadius: 'var(--radius)',
                      display: 'grid',
                      placeItems: 'center',
                      color: 'var(--primary-foreground)',
                      fontWeight: 700,
                      fontSize: '1rem',
                      textAlign: 'center',
                      padding: 'calc(var(--spacing) * 3)',
                      lineHeight: 1.3,
                      wordBreak: 'keep-all',
                      overflowWrap: 'break-word',
                      background: book.cover ? 'var(--muted)' : coverColor(i),
                      overflow: 'hidden',
                    }}
                  >
                    {book.cover ? (
                      <img
                        src={book.cover}
                        alt={book.title}
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'cover',
                          display: 'block',
                        }}
                        onError={(e) => {
                          // 加载失败时回退到色块占位
                          const target = e.currentTarget
                          target.style.display = 'none'
                          if (target.parentElement) {
                            target.parentElement.style.background = coverColor(i)
                            target.parentElement.textContent = book.title
                          }
                        }}
                      />
                    ) : (
                      book.title
                    )}
                  </div>

                  {/* 元信息 */}
                  <div style={{ padding: 'calc(var(--spacing) * 3)' }}>
                    <div
                      style={{
                        fontSize: '0.92rem',
                        fontWeight: 600,
                        color: 'var(--card-foreground)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {book.title}
                    </div>
                    <div
                      style={{
                        fontSize: '0.78rem',
                        color: 'var(--muted-foreground)',
                        marginTop: '0.18rem',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {book.author || '未知作者'}
                    </div>
                    <div
                      style={{
                        marginTop: 'calc(var(--spacing) * 2.5)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'calc(var(--spacing) * 2)',
                      }}
                    >
                      <div
                        style={{
                          flex: 1,
                          height: 4,
                          background: 'var(--muted)',
                          borderRadius: 999,
                          overflow: 'hidden',
                          minWidth: 0,
                        }}
                      >
                        <div
                          style={{
                            height: '100%',
                            width: `${pct}%`,
                            background: 'var(--primary)',
                            borderRadius: 999,
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                      <span
                        style={{
                          fontSize: '0.72rem',
                          color: 'var(--muted-foreground)',
                          fontFamily: 'var(--font-mono)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {pct}%
                      </span>
                    </div>

                    {/* 笔记导入按钮（卡片底部） */}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleImportNotes(book.id)
                      }}
                      disabled={importingBookId === book.id}
                      style={{
                        width: '100%',
                        marginTop: 'calc(var(--spacing) * 3)',
                        padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 3)',
                        fontSize: '0.8rem',
                        fontWeight: 500,
                        color: 'var(--primary)',
                        background: 'transparent',
                        border: '1px solid var(--primary)',
                        borderRadius: 'var(--radius)',
                        cursor: importingBookId === book.id ? 'not-allowed' : 'pointer',
                        opacity: importingBookId === book.id ? 0.5 : 1,
                        transition: 'background 0.2s ease',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 'calc(var(--spacing) * 2)',
                      }}
                      onMouseEnter={(e) => {
                        if (importingBookId !== book.id) {
                          e.currentTarget.style.background = 'var(--accent)'
                        }
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      {importingBookId === book.id ? (
                        <>
                          <span
                            style={{
                              width: 12,
                              height: 12,
                              borderRadius: '50%',
                              border: '1.5px solid var(--primary)',
                              borderTopColor: 'transparent',
                              animation: 'spin 0.8s linear infinite',
                              display: 'inline-block',
                            }}
                          />
                          导入中...
                        </>
                      ) : (
                        <>
                          <Icon name="refresh" size={12} /> 导入笔记
                        </>
                      )}
                    </button>

                    <Tiny style={{ marginTop: 'calc(var(--spacing) * 2)', textAlign: 'center' }}>
                      {getBookHighlights(book.id).length} 条笔记 · {getBookCards(book.id).length}{' '}
                      张卡片
                    </Tiny>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </PageHero>
    </>
  )
}

// ===== 子组件：Chip 组 =====
interface ChipsProps<T extends string> {
  items: { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
}

function Chips<T extends string>({ items, value, onChange }: ChipsProps<T>) {
  return (
    <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 2)', flexWrap: 'wrap' }}>
      {items.map((item) => {
        const active = item.key === value
        return (
          <button
            key={item.key}
            type="button"
            onClick={() => onChange(item.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 4)',
              border: '1px solid',
              borderColor: active ? 'var(--primary)' : 'var(--border)',
              background: active ? 'var(--primary)' : 'var(--card)',
              color: active ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              transition:
                'background 0.2s ease, color 0.2s ease, border-color 0.2s ease, transform 0.16s ease',
              fontSize: '0.84rem',
              whiteSpace: 'nowrap',
              font: 'inherit',
            }}
            onMouseEnter={(e) => {
              if (!active) {
                e.currentTarget.style.background = 'var(--sidebar-accent)'
                e.currentTarget.style.color = 'var(--sidebar-accent-foreground)'
                e.currentTarget.style.borderColor = 'var(--sidebar-border)'
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                e.currentTarget.style.background = 'var(--card)'
                e.currentTarget.style.color = 'var(--muted-foreground)'
                e.currentTarget.style.borderColor = 'var(--border)'
              }
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.97)'
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

// ===== 子组件：紧凑搜索框 =====
interface CompactSearchProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

function CompactSearch({ value, onChange, placeholder }: CompactSearchProps) {
  return (
    <div
      role="search"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'calc(var(--spacing) * 3)',
        width: 240,
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
        aria-label="搜索书架"
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
    </div>
  )
}
