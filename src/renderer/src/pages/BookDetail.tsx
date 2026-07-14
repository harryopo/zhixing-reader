import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { toast } from '../stores/toastStore'
import { mapBooks, mapHighlights, mapCards, safeNum, safeStr, formatDate } from '../utils/db-mapper'

export default function BookDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [book, setBook] = useState<Record<string, unknown> | null>(null)
  const [highlights, setHighlights] = useState<Record<string, unknown>[]>([])
  const [cards, setCards] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)

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
      const books = mapBooks(bookData ? [bookData] : [])
      setBook(books.length > 0 ? books[0] : null)
      setHighlights(mapHighlights(highlightsRaw as unknown[]))
      setCards(mapCards(cardsRaw as unknown[]))
    } catch (error) {
      console.error('加载书籍数据失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleImportNotes = async () => {
    if (!id) return
    setImporting(true)
    const importToastId = toast.loading('正在从微信读书导入笔记...')
    try {
      const content = await window.electronAPI.weread.fetchAllContent(id) as {
        bookmarks: Array<{ bookmarkId: string; bookId: string; chapterUid: number; chapterTitle: string; markText: string; style: number; range: string; createTime: number }>
        notes: Array<{ reviewId: string; bookId: string; chapterUid: number; chapterTitle: string; abstract: string; content: string; range: string; createTime: number }>
      }

      let newCount = 0
      let totalCount = 0
      if (content.bookmarks && content.bookmarks.length > 0) {
        for (const bm of content.bookmarks) {
          try {
            const isNew = await window.electronAPI.highlight.create({
              bookId: id, content: bm.markText, chapterTitle: bm.chapterTitle, chapterUid: bm.chapterUid,
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
              bookId: id, content: note.abstract, note: note.content, chapterTitle: note.chapterTitle, chapterUid: note.chapterUid,
              type: 'note', source: 'weread', createdAt: note.createTime
            })
            totalCount++
            if (isNew) newCount++
          } catch (e) { console.error('导入笔记失败:', e) }
        }
      }

      await loadBookData(id)
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
      toast.error(`导入失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setImporting(false)
    }
  }

  if (loading) {
    return (<div className="p-6 flex items-center justify-center h-full"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>)
  }

  if (!book) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-full">
        <div className="text-6xl mb-4">📚</div>
        <h2 className="text-xl font-semibold text-gray-900 mb-2">书籍未找到</h2>
        <button onClick={() => navigate('/bookshelf')} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover">返回书架</button>
      </div>
    )
  }

  const progress = safeNum(book.progress)

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/bookshelf')} className="px-3 py-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" /></svg>
          返回书架
        </button>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <div className="flex items-start justify-between">
          <div className="flex-1 mr-6">
            <h1 className="text-2xl font-bold text-gray-900">{safeStr(book.title)}</h1>
            <p className="text-gray-600 mt-1">{safeStr(book.author, '未知作者')}</p>
            {!!book.publisher && <p className="text-sm text-gray-500 mt-1">出版社: {safeStr(book.publisher)}</p>}
          </div>
          <div className="w-28 h-36 bg-primary-light rounded-lg overflow-hidden shadow-md flex-shrink-0">
            {book.cover ? (
              <img src={safeStr(book.cover)} alt={safeStr(book.title)} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
            ) : (
              <div className="w-full h-full flex items-center justify-center"><span className="text-primary text-3xl">📖</span></div>
            )}
          </div>
        </div>
        <div className="mt-4 flex items-center gap-6 text-sm text-gray-500">
          <span>阅读进度: {Math.round(progress * 100)}%</span>
          <span>最后阅读: {formatDate(book.lastReadAt)}</span>
        </div>
        {progress > 0 && (
          <div className="mt-3">
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div className="bg-primary h-2 rounded-full" style={{ width: `${progress * 100}%` }}></div>
            </div>
          </div>
        )}
      </div>

      <div className="flex gap-4">
        <button onClick={handleImportNotes} disabled={importing} className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all duration-200">
          {importing ? (<><div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>导入中...</>) : (<><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>导入笔记</>)}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div><p className="text-sm text-gray-600">笔记数量</p><p className="text-2xl font-bold text-primary">{highlights.length}</p></div>
            <div className="w-10 h-10 bg-primary-light rounded-lg flex items-center justify-center"><span className="text-primary">📝</span></div>
          </div>
        </div>
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <div className="flex items-center justify-between">
            <div><p className="text-sm text-gray-600">卡片数量</p><p className="text-2xl font-bold text-primary">{cards.length}</p></div>
            <div className="w-10 h-10 bg-primary-light rounded-lg flex items-center justify-center"><span className="text-primary">🃏</span></div>
          </div>
        </div>
      </div>

      {highlights.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">笔记列表</h2>
          <div className="space-y-3 max-h-96 overflow-y-auto">
            {highlights.map((h, index) => (
              <div key={(h.id as string) || index} className="border-b border-gray-100 pb-3 last:border-0">
                <p className="text-sm text-gray-800 line-clamp-2">{safeStr(h.content)}</p>
                <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
                  <span>{safeStr(h.chapterTitle, '未知章节')}</span>
                  <span>{formatDate(h.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
