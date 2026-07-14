import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { toast } from '../stores/toastStore'
import { mapBooks, mapHighlights, mapCards, safeNum, safeStr, formatTimeAgo } from '../utils/db-mapper'
import { Book } from '../../../shared/types'

function sortByReadTime(books: Record<string, unknown>[]): Record<string, unknown>[] {
  return [...books].sort((a, b) => {
    const timeA = a.lastReadAt ? new Date(a.lastReadAt as string).getTime() : 0
    const timeB = b.lastReadAt ? new Date(b.lastReadAt as string).getTime() : 0
    return timeB - timeA
  })
}

export default function Bookshelf() {
  const navigate = useNavigate()
  const [books, setBooks] = useState<Record<string, unknown>[]>([])
  const [highlights, setHighlights] = useState<Record<string, unknown>[]>([])
  const [cards, setCards] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [importingBookId, setImportingBookId] = useState<string | null>(null)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    if (!window.electronAPI?.book || !window.electronAPI?.highlight || !window.electronAPI?.card) {
      setLoading(false)
      return
    }
    try {
      const [booksRaw, highlightsRaw, cardsRaw] = await Promise.all([
        window.electronAPI.book.getAll(),
        window.electronAPI.highlight.getAll(),
        window.electronAPI.card.getDue()
      ])
      setBooks(sortByReadTime(mapBooks(booksRaw as unknown[])))
      setHighlights(mapHighlights(highlightsRaw as unknown[]))
      setCards(mapCards(cardsRaw as unknown[]))
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
      const wereadBooks = await window.electronAPI.weread.getBookshelf() as Array<{
        bookId: string; title: string; author: string; cover: string; isbn: string; publisher: string
        progress: number; totalChapter: number; lastReadTime: number; readUpdateTime: number
        finishReading: number; isTop: number; secret: number; updateTime: number
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
          const existingBooks = await window.electronAPI.book.search(wb.title) as unknown as Book[]
          const exists = existingBooks.some(b => b.title === wb.title)
          const readTime = wb.readUpdateTime || wb.lastReadTime || 0
          const lastReadTimeStr = readTime > 0 ? new Date(readTime * 1000).toISOString() : null

          if (!exists) {
            await window.electronAPI.book.create({
              id: wb.bookId, title: wb.title, author: wb.author, cover: wb.cover,
              isbn: wb.isbn, publisher: wb.publisher,
              reading_progress: wb.progress || 0,
              total_chapter: wb.totalChapter || 0,
              last_read_time: lastReadTimeStr,
              is_finished: wb.finishReading || 0,
              source: 'weread'
            })
            importedCount++
          } else {
            const existing = existingBooks.find(b => b.title === wb.title)
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
      toast.success(importedCount > 0
        ? `同步成功！共 ${wereadBooks.length} 本书籍，新导入 ${importedCount} 本，更新 ${updatedCount} 本`
        : `书架已是最新，共 ${wereadBooks.length} 本书籍`
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
      const content = await window.electronAPI.weread.fetchAllContent(bookId) as {
        bookmarks: Array<{ bookmarkId: string; chapterTitle: string; markText: string; chapterUid: number; createTime: number }>
        notes: Array<{ reviewId: string; chapterTitle: string; abstract: string; content: string; chapterUid: number; createTime: number }>
      }

      let newCount = 0
      let totalCount = 0
      if (content.bookmarks && content.bookmarks.length > 0) {
        for (const bm of content.bookmarks) {
          try {
            const isNew = await window.electronAPI.highlight.create({
              bookId, content: bm.markText, chapterTitle: bm.chapterTitle, chapterUid: bm.chapterUid,
              type: 'highlight', source: 'weread', createdAt: bm.createTime
            })
            totalCount++
            if (isNew) newCount++
          } catch (e) { console.error('导入划线失败:', e) }
        }
      }
      if (content.notes && content.notes.length > 0) {
        for (const note of content.notes) {
          try {
            const isNew = await window.electronAPI.highlight.create({
              bookId, content: note.abstract, note: note.content, chapterTitle: note.chapterTitle, chapterUid: note.chapterUid,
              type: 'note', source: 'weread', createdAt: note.createTime
            })
            totalCount++
            if (isNew) newCount++
          } catch (e) { console.error('导入笔记失败:', e) }
        }
      }

      await loadData()
      toast.remove(importToastId)
      if (newCount > 0) {
        toast.success(`导入完成！新增 ${newCount} 条笔记`)
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

  const getBookHighlights = (bookId: string) => highlights.filter(h => h.bookId === bookId)
  const getBookCards = (bookId: string) => cards.filter(c => (c.bookId === bookId) || (c.highlightId && highlights.some(h => h.id === c.highlightId && h.bookId === bookId)))

  const getReadingStatus = (book: Record<string, unknown>) => {
    const progress = safeNum(book.progress ?? book.reading_progress)
    const isFinished = safeNum(book.is_finished ?? book.isFinished)
    if (isFinished === 1 || progress >= 1) return { label: '已读完', color: 'text-green-600 bg-green-50' }
    if (progress > 0) return { label: '阅读中', color: 'text-blue-600 bg-blue-50' }
    return { label: '未读', color: 'text-gray-500 bg-gray-50' }
  }

  if (loading) {
    return (<div className="p-6 flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>)
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">我的书架</h1>
          <p className="text-gray-600 mt-1">共 {books.length} 本书籍 · 按最近阅读排序</p>
        </div>
        <button onClick={handleSync} disabled={syncing} className="px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all duration-200 text-sm font-medium shadow-sm hover:shadow">
          {syncing ? (<><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>同步中...</>) : (<><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>同步微信读书书架</>)}
        </button>
      </div>

      {books.length === 0 ? (
        <div className="bg-white rounded-xl p-12 border border-gray-200 text-center shadow-sm">
          <div className="text-6xl mb-4">📚</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">还没有书籍</h2>
          <p className="text-gray-600 mb-4">点击上方按钮同步微信读书书架</p>
          <button onClick={handleSync} className="px-6 py-2.5 bg-primary text-white rounded-lg hover:bg-primary-hover transition-all duration-200 text-sm font-medium shadow-sm hover:shadow">开始同步</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {books.map((book) => {
            const progress = safeNum(book.progress ?? book.reading_progress)
            const status = getReadingStatus(book)
            const lastReadAt = book.lastReadAt as string | undefined
            return (
              <div key={book.id as string} className="bg-white rounded-xl border border-gray-200 hover:shadow-lg transition-all duration-300 group">
                <div className="p-4 cursor-pointer" onClick={() => navigate(`/bookshelf/${book.id}`)}>
                  <div className="flex items-start gap-4 mb-3">
                    <div className="w-16 h-22 bg-primary-light rounded-lg flex-shrink-0 overflow-hidden shadow-sm">
                      {book.cover ? (
                        <img src={safeStr(book.cover)} alt={safeStr(book.title)} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center"><svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg></div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold text-gray-900 truncate group-hover:text-primary transition-colors">{safeStr(book.title)}</h3>
                        <span className={`px-1.5 py-0.5 text-xs rounded-full flex-shrink-0 ${status.color}`}>{status.label}</span>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">{safeStr(book.author)}</p>
                      {lastReadAt && (
                        <p className="text-xs text-gray-400 mt-1">
                          最近阅读: {formatTimeAgo(lastReadAt)}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center justify-between text-sm text-gray-500">
                    <div className="flex items-center gap-4">
                      <span className="flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                        {getBookHighlights(book.id as string).length} 条笔记
                      </span>
                      <span className="flex items-center gap-1">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
                        {getBookCards(book.id as string).length} 张卡片
                      </span>
                    </div>
                    <span className="text-primary font-medium">{Math.round(progress * 100)}%</span>
                  </div>

                  <div className="mt-3">
                    <div className="w-full bg-gray-200 rounded-full h-1.5">
                      <div className="bg-primary h-1.5 rounded-full transition-all duration-500" style={{ width: `${progress * 100}%` }}></div>
                    </div>
                  </div>
                </div>

                <div className="px-4 pb-4 pt-0">
                  <button onClick={(e) => { e.stopPropagation(); handleImportNotes(book.id as string) }} disabled={importingBookId === book.id} className="w-full px-3 py-2 text-sm text-primary border border-primary rounded-lg hover:bg-primary-light transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
                    {importingBookId === book.id ? (<><div className="animate-spin rounded-full h-3 w-3 border-b-2 border-primary"></div>导入中...</>) : (<><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>导入微信读书笔记</>)}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
