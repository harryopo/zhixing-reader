import { useState, useEffect, ReactNode } from 'react'

interface Book {
  id: string
  title: string
  author: string
  cover: string
  highlight_count: number
}

interface Highlight {
  id: string
  content: string
  chapter_title: string
  note: string
  created_at: string
}

interface KnowledgeCard {
  id: string
  highlight_id: string
  question: string
  answer: string
  card_type: string
  highlight_content: string
  created_at: string
}

function highlightText(text: string, query: string): ReactNode {
  if (!query) return text
  const parts = text.split(
    new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi')
  )
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="bg-yellow-200 text-gray-800 rounded px-0.5">
        {part}
      </mark>
    ) : (
      part
    )
  )
}

export default function KnowledgeBase() {
  const [books, setBooks] = useState<Book[]>([])
  const [selectedBook, setSelectedBook] = useState<string | null>(null)
  const [highlights, setHighlights] = useState<Highlight[]>([])
  const [cards, setCards] = useState<KnowledgeCard[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)

  useEffect(() => {
    loadBooks()
  }, [])

  const loadBooks = async () => {
    try {
      const result = await (window as any).electronAPI.admin.getBooksWithCounts()
      setBooks(Array.isArray(result) ? result : [])
    } catch (err) {
      console.error('加载书籍失败:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSelectBook = async (bookId: string) => {
    if (selectedBook === bookId) {
      setSelectedBook(null)
      return
    }
    setSelectedBook(bookId)
    setDetailLoading(true)
    try {
      const [hlResult, cardResult] = await Promise.all([
        (window as any).electronAPI.admin.getHighlightsByBook(bookId),
        (window as any).electronAPI.admin.getCardsByBook(bookId),
      ])
      setHighlights(Array.isArray(hlResult) ? hlResult : [])
      setCards(Array.isArray(cardResult) ? cardResult : [])
    } catch (err) {
      console.error('加载书籍详情失败:', err)
    } finally {
      setDetailLoading(false)
    }
  }

  const filteredBooks = searchQuery
    ? books.filter(
        (b) =>
          b.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          (b.author || '').toLowerCase().includes(searchQuery.toLowerCase())
      )
    : books

  const filteredHighlights = searchQuery
    ? highlights.filter((h) =>
        h.content.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : highlights

  if (loading) {
    return (
      <div className="text-gray-400 text-sm text-center py-20">加载中...</div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <svg
          className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索书籍或笔记..."
          className="w-full pl-9 pr-4 py-2 text-[13px] bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 transition-all"
        />
      </div>

      <div className="space-y-2">
        {filteredBooks.map((book) => (
          <div
            key={book.id}
            className="bg-white rounded-xl border border-gray-100 overflow-hidden"
          >
            <button
              onClick={() => handleSelectBook(book.id)}
              className="w-full flex items-center gap-3 p-3 hover:bg-gray-50 transition-colors text-left"
            >
              <div className="w-10 h-14 bg-gray-200 rounded flex-shrink-0 overflow-hidden">
                {book.cover && (
                  <img
                    src={book.cover}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-gray-800 truncate">
                  {book.title}
                </p>
                <p className="text-[11px] text-gray-400">
                  {book.author || '未知作者'}
                </p>
              </div>
              <span className="text-[11px] text-indigo-500 bg-indigo-50 px-2 py-0.5 rounded-md font-medium">
                {book.highlight_count} 条笔记
              </span>
              <svg
                className={`w-4 h-4 text-gray-300 transition-transform ${selectedBook === book.id ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>

            {selectedBook === book.id && (
              <div className="border-t border-gray-100 p-3 space-y-3">
                {detailLoading ? (
                  <div className="text-gray-400 text-[12px] text-center py-4">
                    加载中...
                  </div>
                ) : (
                  <>
                    {filteredHighlights.length > 0 && (
                      <div>
                        <h4 className="text-[12px] font-semibold text-gray-500 mb-2">
                          划线 / 笔记 ({filteredHighlights.length})
                        </h4>
                        <div className="space-y-1.5 max-h-60 overflow-y-auto">
                          {filteredHighlights.slice(0, 20).map((hl) => (
                            <div
                              key={hl.id}
                              className="p-2 bg-gray-50 rounded-lg"
                            >
                              <p className="text-[12px] text-gray-700 leading-relaxed">
                                {searchQuery
                                  ? highlightText(hl.content, searchQuery)
                                  : hl.content}
                              </p>
                              {hl.note && (
                                <p className="text-[11px] text-indigo-500 mt-1">
                                  📝 {hl.note}
                                </p>
                              )}
                              <p className="text-[10px] text-gray-300 mt-1">
                                {hl.chapter_title || ''}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {cards.length > 0 && (
                      <div>
                        <h4 className="text-[12px] font-semibold text-gray-500 mb-2">
                          知识卡片 ({cards.length})
                        </h4>
                        <div className="space-y-1.5 max-h-40 overflow-y-auto">
                          {cards.slice(0, 10).map((card) => (
                            <div
                              key={card.id}
                              className="p-2 bg-indigo-50/50 rounded-lg border border-indigo-100"
                            >
                              <p className="text-[12px] text-indigo-700 font-medium">
                                Q: {card.question}
                              </p>
                              <p className="text-[12px] text-gray-600 mt-0.5">
                                A: {card.answer}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {filteredHighlights.length === 0 &&
                      cards.length === 0 && (
                        <p className="text-[12px] text-gray-400 text-center py-2">
                          暂无数据
                        </p>
                      )}
                  </>
                )}
              </div>
            )}
          </div>
        ))}
        {filteredBooks.length === 0 && (
          <div className="text-gray-400 text-[13px] text-center py-10">
            {searchQuery ? '没有匹配的书籍' : '暂无书籍数据'}
          </div>
        )}
      </div>
    </div>
  )
}
