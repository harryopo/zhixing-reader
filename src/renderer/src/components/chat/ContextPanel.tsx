import { useState, useEffect } from 'react'

interface Book {
  id: string
  title: string
  author: string
  cover: string
}

interface ContextPanelProps {
  currentBookId: string | null
  onBookSelect: (bookId: string | null) => void
}

export default function ContextPanel({ currentBookId, onBookSelect }: ContextPanelProps) {
  const [books, setBooks] = useState<Book[]>([])
  const [collapsed, setCollapsed] = useState(false)
  const [showBookSelector, setShowBookSelector] = useState(false)

  useEffect(() => {
    loadBooks()
  }, [])

  const loadBooks = async () => {
    try {
      if (!window.electronAPI?.book) return
      const allBooks = await window.electronAPI.book.getAll() as Book[]
      setBooks(allBooks)
    } catch (error) {
      console.error('加载书籍失败:', error)
    }
  }

  const currentBook = books.find(b => b.id === currentBookId)

  if (collapsed) {
    return (
      <div className="w-10 border-l border-gray-200 flex flex-col items-center pt-3 bg-gray-50">
        <button
          onClick={() => setCollapsed(false)}
          className="p-1.5 text-gray-400 hover:text-gray-600 transition-colors"
          title="展开上下文面板"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>
      </div>
    )
  }

  return (
    <div className="w-56 border-l border-gray-200 flex flex-col bg-gray-50">
      <div className="p-3 border-b border-gray-200 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">上下文</h3>
        <button
          onClick={() => setCollapsed(true)}
          className="p-1 text-gray-400 hover:text-gray-600 transition-colors"
          title="收起面板"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
          </svg>
        </button>
      </div>

      <div className="p-3 border-b border-gray-200">
        <div className="text-xs text-gray-500 mb-2">当前书籍</div>
        {currentBook ? (
          <div className="flex items-center gap-2 p-2 bg-white rounded-lg border border-gray-200">
            <div className="w-8 h-10 bg-gray-200 rounded flex-shrink-0 overflow-hidden">
              {currentBook.cover && <img src={currentBook.cover} alt="" className="w-full h-full object-cover" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-gray-800 truncate">{currentBook.title}</p>
              <p className="text-xs text-gray-400 truncate">{currentBook.author}</p>
            </div>
            <button
              onClick={() => onBookSelect(null)}
              className="p-0.5 text-gray-400 hover:text-red-500 transition-colors"
            >
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        ) : (
          <button
            onClick={() => setShowBookSelector(!showBookSelector)}
            className="w-full px-3 py-2 text-xs text-gray-500 border border-dashed border-gray-300 rounded-lg hover:border-primary hover:text-primary transition-colors"
          >
            + 选择书籍
          </button>
        )}

        {showBookSelector && (
          <div className="mt-2 max-h-40 overflow-y-auto bg-white border border-gray-200 rounded-lg">
            {books.map(book => (
              <button
                key={book.id}
                onClick={() => { onBookSelect(book.id); setShowBookSelector(false) }}
                className="w-full px-3 py-2 text-left text-xs hover:bg-gray-50 transition-colors flex items-center gap-2 border-b border-gray-100 last:border-0"
              >
                <span className="truncate font-medium text-gray-700">{book.title}</span>
                <span className="text-gray-400 flex-shrink-0">{book.author}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="flex-1 p-3">
        <div className="text-xs text-gray-400 text-center mt-4">
          选择书籍后，AI将基于该书笔记回答问题
        </div>
      </div>
    </div>
  )
}
