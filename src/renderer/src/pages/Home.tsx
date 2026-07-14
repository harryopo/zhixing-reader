import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { mapBooks, mapCards, mapHighlights, safeNum } from '../utils/db-mapper'

export default function Home() {
  const navigate = useNavigate()
  const [books, setBooks] = useState<Record<string, unknown>[]>([])
  const [cards, setCards] = useState<Record<string, unknown>[]>([])
  const [highlights, setHighlights] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const loadData = async () => {
      if (!window.electronAPI?.book || !window.electronAPI?.card || !window.electronAPI?.highlight) {
        setLoading(false)
        return
      }
      try {
        const [booksRaw, cardsRaw, highlightsRaw] = await Promise.all([
          window.electronAPI.book.getAll(),
          window.electronAPI.card.getDue(),
          window.electronAPI.highlight.getAll()
        ])
        setBooks(mapBooks(booksRaw as unknown[]))
        setCards(mapCards(cardsRaw as unknown[]))
        setHighlights(mapHighlights(highlightsRaw as unknown[]))
      } catch (error) {
        console.error('加载数据失败:', error)
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [])

  const dueCards = cards.filter(card => {
    if (!card.nextReviewAt) return false
    return new Date(card.nextReviewAt as string) <= new Date()
  })

  const today = new Date().toDateString()
  const todayReviewed = cards.filter(card =>
    card.lastReviewAt && new Date(card.lastReviewAt as string).toDateString() === today
  )

  const recentBooks = [...books]
    .sort((a, b) => new Date((b.updatedAt || b.createdAt || 0) as string | number).getTime() - new Date((a.updatedAt || a.createdAt || 0) as string | number).getTime())
    .slice(0, 5)

  const quickActions = [
    { title: '书架', path: '/bookshelf', description: '浏览我的书籍', icon: (<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></svg>) },
    { title: '笔记', path: '/notes', description: '查看读书笔记', icon: (<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>) },
    { title: '数据', path: '/stats', description: '阅读数据统计', icon: (<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>) },
    { title: '复习', path: '/review', description: '间隔复习卡片', icon: (<svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>) },
  ]

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-primary border-t-transparent"></div>
      </div>
    )
  }

  return (
    <div className="p-8 space-y-8 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-text-primary font-serif">欢迎回来</h1>
          <p className="text-text-secondary mt-1">今天也要好好读书哦</p>
        </div>
        <div className="text-right">
          <p className="text-sm text-text-tertiary">
            {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-2xl p-5 shadow-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-secondary">已同步书籍</p>
              <p className="text-3xl font-bold text-primary mt-1">{books.length}</p>
            </div>
            <div className="w-12 h-12 bg-primary-light rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-secondary">总卡片</p>
              <p className="text-3xl font-bold text-primary mt-1">{cards.length}</p>
            </div>
            <div className="w-12 h-12 bg-primary-light rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" /></svg>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-secondary">待复习</p>
              <p className="text-3xl font-bold text-accent mt-1">{dueCards.length}</p>
            </div>
            <div className="w-12 h-12 bg-accent-light rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
          </div>
        </div>
        <div className="bg-white rounded-2xl p-5 shadow-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-secondary">今日复习</p>
              <p className="text-3xl font-bold text-primary mt-1">{todayReviewed.length}</p>
            </div>
            <div className="w-12 h-12 bg-primary-light rounded-xl flex items-center justify-center">
              <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </div>
          </div>
        </div>
      </div>

      <div>
        <h2 className="text-lg font-semibold text-text-primary mb-4">快速操作</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {quickActions.map((action) => (
            <button key={action.path} onClick={() => navigate(action.path)} className="bg-white rounded-2xl p-5 shadow-card hover:shadow-elevated transition-all duration-200 text-left group">
              <div className="w-12 h-12 bg-primary-light rounded-xl flex items-center justify-center mb-3 text-primary group-hover:bg-primary group-hover:text-white transition-colors">{action.icon}</div>
              <h3 className="font-medium text-text-primary">{action.title}</h3>
              <p className="text-sm text-text-secondary mt-1">{action.description}</p>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-text-primary">最近同步书籍</h2>
          <button onClick={() => navigate('/bookshelf')} className="text-sm text-primary hover:text-primary-hover transition-colors">查看全部</button>
        </div>

        {recentBooks.length === 0 ? (
          <div className="bg-white rounded-2xl p-12 shadow-card text-center">
            <div className="w-16 h-16 bg-primary-light rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
            </div>
            <p className="text-text-primary font-medium">还没有同步书籍</p>
            <p className="text-sm text-text-secondary mt-1">点击书架开始同步微信读书</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl shadow-card overflow-hidden">
            {recentBooks.map((book, index) => (
              <div key={book.id as string} className={`flex items-center p-5 hover:bg-surface-secondary cursor-pointer transition-colors ${index !== recentBooks.length - 1 ? 'border-b border-border-light' : ''}`} onClick={() => navigate(`/bookshelf/${book.id}`)}>
                <div className="w-12 h-16 bg-primary-light rounded-lg flex-shrink-0 overflow-hidden shadow-sm mr-4">
                  {book.cover ? (
                    <img src={book.cover as string} alt={book.title as string} className="w-full h-full object-cover" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <svg className="w-6 h-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" /></svg>
                    </div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="font-medium text-text-primary truncate font-serif">{book.title as string}</h3>
                  <p className="text-sm text-text-secondary">{book.author as string}</p>
                </div>
                <div className="ml-4 flex-shrink-0">
                  <div className="flex items-center gap-2">
                    <div className="w-16 h-1.5 bg-border-light rounded-full overflow-hidden">
                      <div className="h-full bg-primary rounded-full" style={{ width: `${safeNum(book.progress) * 100}%` }} />
                    </div>
                    <span className="text-sm text-text-secondary w-10 text-right">{Math.round(safeNum(book.progress) * 100)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
