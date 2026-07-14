import { useState, useEffect, useMemo } from 'react'
import { mapBooks, mapHighlights, formatDate } from '../utils/db-mapper'

export default function Notes() {
  const [highlights, setHighlights] = useState<Record<string, unknown>[]>([])
  const [books, setBooks] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedBook, setSelectedBook] = useState<string>('')
  const [searchQuery, setSearchQuery] = useState('')

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    if (!window.electronAPI?.highlight || !window.electronAPI?.book) {
      setLoading(false)
      return
    }
    try {
      const [highlightsRaw, booksRaw] = await Promise.all([
        window.electronAPI.highlight.getAll(),
        window.electronAPI.book.getAll()
      ])
      setHighlights(mapHighlights(highlightsRaw as unknown[]))
      setBooks(mapBooks(booksRaw as unknown[]))
    } catch (error) {
      console.error('加载数据失败:', error)
    } finally {
      setLoading(false)
    }
  }

  const getBookTitle = (bookId: unknown) => {
    if (!bookId) return '未知书籍'
    const book = books.find(b => b.id === bookId)
    return (book?.title as string) || '未知书籍'
  }

  const filteredHighlights = useMemo(() => {
    let result = highlights

    if (selectedBook) {
      result = result.filter(h => h.bookId === selectedBook)
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      const terms = query.split(/\s+/).filter(t => t.length > 0)
      result = result.filter(h => {
        const content = ((h.content as string) || '').toLowerCase()
        const note = ((h.note as string) || '').toLowerCase()
        const chapterTitle = ((h.chapterTitle as string) || '').toLowerCase()
        const bookTitle = getBookTitle(h.bookId).toLowerCase()
        const searchText = `${content} ${note} ${chapterTitle} ${bookTitle}`
        return terms.every(term => searchText.includes(term))
      })
    }

    return result
  }, [highlights, selectedBook, searchQuery, books])

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">笔记中心</h1>
        <p className="text-gray-600 mt-1">共 {highlights.length} 条笔记{filteredHighlights.length !== highlights.length ? ` · 筛选显示 ${filteredHighlights.length} 条` : ''}</p>
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-sm font-medium text-gray-700 mb-1">搜索笔记</label>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索笔记内容、批注、章节..."
              className="w-full pl-10 pr-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="min-w-[200px]">
          <label className="block text-sm font-medium text-gray-700 mb-1">按书籍筛选</label>
          <select
            value={selectedBook}
            onChange={(e) => setSelectedBook(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
          >
            <option value="">全部书籍</option>
            {books.map(book => (
              <option key={book.id as string} value={book.id as string}>{book.title as string}</option>
            ))}
          </select>
        </div>
      </div>

      {filteredHighlights.length === 0 ? (
        <div className="bg-white rounded-lg p-12 border border-gray-200 text-center">
          <div className="text-6xl mb-4">📝</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            {searchQuery ? '没有找到匹配的笔记' : '没有找到笔记'}
          </h2>
          <p className="text-gray-600">
            {searchQuery
              ? '尝试调整搜索关键词或清除筛选条件'
              : highlights.length === 0
                ? '还没有导入任何笔记，请先到书架导入'
                : '当前筛选条件下没有笔记'}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {filteredHighlights.map((h) => (
            <div key={h.id as string} className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition-shadow duration-200">
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <p className="text-gray-900 leading-relaxed">{h.content as string}</p>
                  {!!h.note && (
                    <p className="text-gray-600 mt-2 text-sm italic">"{String(h.note)}"</p>
                  )}
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-sm text-gray-500">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    {getBookTitle(h.bookId)}
                  </span>
                  {!!h.chapterTitle && String(h.chapterTitle) !== '未知章节' && (
                    <span className="flex items-center gap-1">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {String(h.chapterTitle)}
                    </span>
                  )}
                </div>
                <span>{formatDate(h.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
