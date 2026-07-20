import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { toast } from '../stores/toastStore'
import { safeStr, safeNum, formatDate, mapKnowledgeCards, mapBook } from '../utils/db-mapper'

type CardType = 'concept' | 'methodology' | 'quote'

interface KnowledgeCardItem {
  id: string
  bookId: string
  type: CardType
  title: string
  content: string
  interpretation?: string
  application?: string
  relatedCardIds?: string[]
  tags?: string[]
  sourceHighlightId?: string
  reviewCount: number
  masteryLevel: number
  createdAt: string
  updatedAt: string
}

interface DistillProgress {
  bookId: string
  bookTitle?: string
  stage: 'fetch' | 'batch' | 'parse' | 'save' | 'done' | 'error'
  current: number
  total: number
  message?: string
  error?: string
}

const typeConfig: Record<CardType, { label: string; icon: string; color: string; bgColor: string }> = {
  concept: { label: '概念', icon: '🧠', color: 'text-blue-600', bgColor: 'bg-blue-50' },
  methodology: { label: '方法论', icon: '⚙️', color: 'text-green-600', bgColor: 'bg-green-50' },
  quote: { label: '金句', icon: '✨', color: 'text-amber-600', bgColor: 'bg-amber-50' },
}

function classifyErrorMessage(msg: string): { type: 'timeout' | 'cancelled' | 'network' | 'config' | 'empty' | 'parse' | 'import' | 'unknown'; text: string } {
  if (msg.includes('已被取消') || msg.includes('用户取消') || msg.includes('aborted')) {
    return { type: 'cancelled', text: '蒸馏已取消' }
  }
  if (msg.includes('超时') || msg.includes('timeout')) {
    return { type: 'timeout', text: 'AI 响应超时。笔记较多时耗时较长，请稍后重试或减少笔记数量。' }
  }
  if (msg.includes('网络错误') || msg.includes('fetch failed') || msg.includes('ENOTFOUND') || msg.includes('ECONN')) {
    return { type: 'network', text: '网络连接失败，请检查网络后重试。' }
  }
  if (msg.includes('没有笔记') || msg.includes('无法蒸馏')) {
    return { type: 'empty', text: msg }
  }
  if (msg.includes('自动导入笔记失败')) {
    return { type: 'import', text: '自动导入笔记失败，请检查微信读书配置后重试。' }
  }
  if (msg.includes('JSON') || msg.includes('解析失败')) {
    return { type: 'parse', text: 'AI 响应格式异常，请重试或更换模型。' }
  }
  if (msg.includes('未配置') || msg.includes('not configured') || msg.includes('API Key')) {
    return { type: 'config', text: 'AI 服务未配置，请在设置中配置 API Key。' }
  }
  return { type: 'unknown', text: msg }
}

export default function KnowledgeCards() {
  const [activeTab, setActiveTab] = useState<'cards' | 'distill'>('cards')
  const [cards, setCards] = useState<KnowledgeCardItem[]>([])
  const [books, setBooks] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedBook, setSelectedBook] = useState('')
  const [selectedType, setSelectedType] = useState<CardType | ''>('')
  const [selectedTag, setSelectedTag] = useState('')
  const [distillingBookId, setDistillingBookId] = useState<string | null>(null)
  const [distillProgress, setDistillProgress] = useState<DistillProgress | null>(null)
  const [flippedId, setFlippedId] = useState<string | null>(null)
  const [generatingMap, setGeneratingMap] = useState<Record<string, 'interpretation' | 'application' | null>>({})
  const unsubscribeRef = useRef<(() => void) | null>(null)

  useEffect(() => { loadData() }, [])

  useEffect(() => {
    if (window.electronAPI?.knowledgeCard?.onDistillProgress) {
      unsubscribeRef.current = window.electronAPI.knowledgeCard.onDistillProgress((progress) => {
        setDistillProgress(progress as DistillProgress)
      })
    }
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current()
        unsubscribeRef.current = null
      }
    }
  }, [])

  const loadData = async () => {
    if (!window.electronAPI?.knowledgeCard || !window.electronAPI?.book) {
      setLoading(false)
      return
    }
    try {
      const [cardsRaw, booksRaw] = await Promise.all([
        window.electronAPI.knowledgeCard.getAll(),
        window.electronAPI.book.getAll()
      ])
      const mappedCards = mapKnowledgeCards(cardsRaw) as unknown as KnowledgeCardItem[]
      const mappedBooks = (booksRaw as unknown as Record<string, unknown>[]).map(b => mapBook(b))
      setCards(mappedCards)
      setBooks(mappedBooks)
    } catch (error) {
      console.error('加载知识卡片失败:', error)
      toast.error('加载知识卡片失败')
    } finally {
      setLoading(false)
    }
  }

  const getBookTitle = useCallback((bookId: string) => {
    const book = books.find(b => String(b.id) === bookId)
    return safeStr(book?.title, '未知书籍')
  }, [books])

  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    cards.forEach(c => {
      c.tags?.forEach(tag => tagSet.add(tag))
    })
    return Array.from(tagSet).sort()
  }, [cards])

  const stats = useMemo(() => {
    const total = cards.length
    const concepts = cards.filter(c => c.type === 'concept').length
    const methodologies = cards.filter(c => c.type === 'methodology').length
    const quotes = cards.filter(c => c.type === 'quote').length
    return { total, concepts, methodologies, quotes }
  }, [cards])

  const filteredCards = useMemo(() => {
    let result = cards

    if (selectedBook) {
      result = result.filter(c => c.bookId === selectedBook)
    }

    if (selectedType) {
      result = result.filter(c => c.type === selectedType)
    }

    if (selectedTag) {
      result = result.filter(c => c.tags?.includes(selectedTag))
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      const terms = query.split(/\s+/).filter(t => t.length > 0)
      result = result.filter(c => {
        const searchText = [
          c.title,
          c.content,
          c.interpretation,
          c.application,
          getBookTitle(c.bookId)
        ].filter(Boolean).join(' ').toLowerCase()
        return terms.every(term => searchText.includes(term))
      })
    }

    return result
  }, [cards, selectedBook, selectedType, selectedTag, searchQuery, getBookTitle])

  const handleDistill = async (bookId: string) => {
    const book = books.find(b => b.id === bookId)
    if (!book) return

    if (distillingBookId) {
      toast.warning('已有书籍正在蒸馏中，请等待完成或先取消')
      return
    }

    setDistillingBookId(bookId)
    setDistillProgress({
      bookId,
      bookTitle: safeStr(book.title),
      stage: 'fetch',
      current: 0,
      total: 0,
      message: '正在准备蒸馏...',
    })

    const loadingId = toast.loading(`正在从《${safeStr(book.title)}》蒸馏知识卡片，请耐心等待...`)

    try {
      await window.electronAPI.knowledgeCard.distill(bookId, safeStr(book.title))
      toast.remove(loadingId)
      toast.success('知识卡片蒸馏完成')
      await loadData()
    } catch (error) {
      toast.remove(loadingId)
      const errorMsg = error instanceof Error ? error.message : String(error)
      const classified = classifyErrorMessage(errorMsg)
      console.error('蒸馏失败:', errorMsg, classified)

      if (classified.type === 'cancelled') {
        toast.info('蒸馏已取消')
      } else if (classified.type === 'timeout') {
        toast.warning(classified.text, 6000)
      } else if (classified.type === 'network') {
        toast.error(classified.text, 6000)
      } else if (classified.type === 'empty') {
        toast.warning(classified.text)
      } else if (classified.type === 'import') {
        toast.error(classified.text, 6000)
      } else if (classified.type === 'parse') {
        toast.error(classified.text, 6000)
      } else if (classified.type === 'config') {
        toast.error(classified.text, 6000)
      } else {
        toast.error(`蒸馏失败: ${errorMsg}`, 8000)
      }
    } finally {
      setDistillingBookId(null)
      setTimeout(() => setDistillProgress(null), 5000)
    }
  }

  const handleCancelDistill = async (bookId: string) => {
    try {
      const result = await window.electronAPI.knowledgeCard.cancelDistill(bookId)
      if (result.success) {
        toast.info('正在取消蒸馏...')
      } else {
        toast.warning('当前没有正在进行的蒸馏任务')
      }
    } catch (error) {
      toast.error(`取消失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这张知识卡片吗？')) return
    try {
      await window.electronAPI.knowledgeCard.delete(id)
      await loadData()
      toast.success('已删除')
    } catch (error) {
      toast.error(`删除失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const handleGenerateInterpretation = async (card: KnowledgeCardItem) => {
    setGeneratingMap(prev => ({ ...prev, [card.id]: 'interpretation' }))
    try {
      const result = await window.electronAPI.knowledgeCard.generateInterpretation(
        getBookTitle(card.bookId),
        card.title,
        card.content,
        typeConfig[card.type].label
      )
      await window.electronAPI.knowledgeCard.update(card.id, { interpretation: result.text })
      await loadData()
      toast.success('解读生成完成')
    } catch (error) {
      toast.error(`生成解读失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setGeneratingMap(prev => ({ ...prev, [card.id]: null }))
    }
  }

  const handleGenerateApplication = async (card: KnowledgeCardItem) => {
    setGeneratingMap(prev => ({ ...prev, [card.id]: 'application' }))
    try {
      const result = await window.electronAPI.knowledgeCard.generateApplication(
        getBookTitle(card.bookId),
        card.title,
        card.content,
        typeConfig[card.type].label
      )
      await window.electronAPI.knowledgeCard.update(card.id, { application: result.text })
      await loadData()
      toast.success('应用场景生成完成')
    } catch (error) {
      toast.error(`生成应用失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setGeneratingMap(prev => ({ ...prev, [card.id]: null }))
    }
  }

  const getMasteryStars = (level: number) => {
    const stars = Math.ceil(safeNum(level) / 20)
    return '★'.repeat(Math.min(stars, 5)) + '☆'.repeat(Math.max(0, 5 - stars))
  }

  const renderDistillProgress = (bookId: string) => {
    if (distillingBookId !== bookId || !distillProgress) return null

    const percent = distillProgress.total > 0
      ? Math.min(100, Math.round((distillProgress.current / distillProgress.total) * 100))
      : 0

    const stageLabels: Record<DistillProgress['stage'], string> = {
      fetch: '准备中',
      batch: 'AI 蒸馏中',
      parse: '解析响应',
      save: '保存卡片',
      done: '完成',
      error: '失败',
    }

    const isError = distillProgress.stage === 'error'

    return (
      <div className="absolute inset-0 bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center p-4 rounded-xl z-10">
        <div className={`w-12 h-12 mb-3 ${isError ? 'text-red-500' : 'text-primary'}`}>
          {isError ? (
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ) : (
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
          )}
        </div>
        <p className="text-sm font-medium text-gray-900 mb-1">
          {stageLabels[distillProgress.stage] || '处理中'}
        </p>
        {distillProgress.message && (
          <p className="text-xs text-gray-600 mb-2 text-center max-w-[200px] truncate" title={distillProgress.message}>
            {distillProgress.message}
          </p>
        )}
        {distillProgress.total > 0 && !isError && (
          <div className="w-full max-w-[200px] mt-1">
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
            <p className="text-xs text-gray-500 text-center mt-1">
              {distillProgress.current} / {distillProgress.total} ({percent}%)
            </p>
          </div>
        )}
        {isError ? (
          <button
            onClick={() => handleCancelDistill(bookId)}
            className="mt-3 px-3 py-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
          >
            关闭
          </button>
        ) : (
          <button
            onClick={() => handleCancelDistill(bookId)}
            className="mt-3 px-3 py-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 rounded transition-colors"
          >
            取消蒸馏
          </button>
        )}
      </div>
    )
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">知识卡片</h1>
          <p className="text-gray-600 mt-1">
            共 {stats.total} 张卡片
            {activeTab === 'cards' && filteredCards.length !== stats.total && ` · 筛选显示 ${filteredCards.length} 张`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-gray-100 rounded-lg p-1">
            <button
              onClick={() => setActiveTab('cards')}
              className={`px-4 py-1.5 text-sm rounded-md transition-all ${
                activeTab === 'cards'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              卡片库
            </button>
            <button
              onClick={() => setActiveTab('distill')}
              className={`px-4 py-1.5 text-sm rounded-md transition-all ${
                activeTab === 'distill'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              蒸馏中心
            </button>
          </div>
          <button
            onClick={() => loadData()}
            className="px-4 py-2 text-sm bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 transition-all flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            刷新
          </button>
        </div>
      </div>

      {distillProgress && (
        <div className={`rounded-xl p-4 flex items-center gap-3 ${
          distillProgress.stage === 'done'
            ? 'bg-green-50 border border-green-200'
            : distillProgress.stage === 'error'
              ? 'bg-red-50 border border-red-200'
              : 'bg-blue-50 border border-blue-200'
        }`}>
          {distillProgress.stage === 'done' ? (
            <svg className="w-5 h-5 text-green-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          ) : distillProgress.stage === 'error' ? (
            <svg className="w-5 h-5 text-red-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          ) : (
            <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-blue-600 flex-shrink-0"></div>
          )}
          <div className="flex-1 min-w-0">
            <p className={`text-sm font-medium ${
              distillProgress.stage === 'done'
                ? 'text-green-900'
                : distillProgress.stage === 'error'
                  ? 'text-red-900'
                  : 'text-blue-900'
            }`}>
              {distillProgress.stage === 'done'
                ? `《${distillProgress.bookTitle}》蒸馏完成`
                : distillProgress.stage === 'error'
                  ? `《${distillProgress.bookTitle}》蒸馏失败`
                  : `正在蒸馏《${distillProgress.bookTitle}》`}
            </p>
            <p className={`text-xs truncate ${
              distillProgress.stage === 'done'
                ? 'text-green-700'
                : distillProgress.stage === 'error'
                  ? 'text-red-700'
                  : 'text-blue-700'
            }`}>
              {distillProgress.message || '处理中...'}
              {distillProgress.total > 0 && distillProgress.stage !== 'done' && distillProgress.stage !== 'error' && ` · ${distillProgress.current}/${distillProgress.total}`}
            </p>
          </div>
          {distillProgress.stage !== 'done' && distillProgress.stage !== 'error' && (
            <button
              onClick={() => handleCancelDistill(distillProgress.bookId)}
              className="px-2 py-1 text-xs text-blue-700 hover:text-blue-900 hover:bg-blue-100 rounded transition-colors flex-shrink-0"
            >
              取消
            </button>
          )}
        </div>
      )}

      {activeTab === 'cards' ? (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">概念卡片</p>
                  <p className="text-2xl font-bold text-blue-600">{stats.concepts}</p>
                </div>
                <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center text-xl">🧠</div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">方法论卡片</p>
                  <p className="text-2xl font-bold text-green-600">{stats.methodologies}</p>
                </div>
                <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center text-xl">⚙️</div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">金句卡片</p>
                  <p className="text-2xl font-bold text-amber-600">{stats.quotes}</p>
                </div>
                <div className="w-10 h-10 bg-amber-50 rounded-lg flex items-center justify-center text-xl">✨</div>
              </div>
            </div>
            <div className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">平均掌握度</p>
                  <p className="text-2xl font-bold text-primary">
                    {stats.total > 0 ? Math.round(cards.reduce((s, c) => s + safeNum(c.masteryLevel), 0) / stats.total) : 0}%
                  </p>
                </div>
                <div className="w-10 h-10 bg-primary-light rounded-lg flex items-center justify-center text-xl">📊</div>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <div className="flex-1 min-w-[240px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">搜索卡片</label>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="搜索标题、内容、解读..."
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
            <div className="min-w-[160px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">按书籍</label>
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
            <div className="min-w-[140px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">按类型</label>
              <select
                value={selectedType}
                onChange={(e) => setSelectedType(e.target.value as CardType | '')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="">全部类型</option>
                <option value="concept">概念</option>
                <option value="methodology">方法论</option>
                <option value="quote">金句</option>
              </select>
            </div>
            <div className="min-w-[140px]">
              <label className="block text-sm font-medium text-gray-700 mb-1">按标签</label>
              <select
                value={selectedTag}
                onChange={(e) => setSelectedTag(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="">全部标签</option>
                {allTags.map(tag => (
                  <option key={tag} value={tag}>{tag}</option>
                ))}
              </select>
            </div>
          </div>

          {filteredCards.length === 0 ? (
            <div className="bg-white rounded-xl p-12 border border-gray-200 text-center shadow-sm">
              <div className="text-6xl mb-4">🃏</div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">
                {searchQuery || selectedBook || selectedType || selectedTag ? '没有找到匹配的卡片' : '还没有知识卡片'}
              </h2>
              <p className="text-gray-600">
                {searchQuery || selectedBook || selectedType || selectedTag
                  ? '尝试调整筛选条件'
                  : '切换到"蒸馏中心"从书籍中提取知识卡片'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredCards.map((card) => {
                const typeInfo = typeConfig[card.type]
                const isFlipped = flippedId === card.id
                return (
                  <div
                    key={card.id}
                    className="bg-white rounded-xl border border-gray-200 hover:shadow-md transition-all duration-200 overflow-hidden cursor-pointer"
                    onClick={() => setFlippedId(isFlipped ? null : card.id)}
                  >
                    <div className="p-5">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className={`px-2 py-0.5 text-xs rounded-full ${typeInfo.bgColor} ${typeInfo.color}`}>
                            {typeInfo.icon} {typeInfo.label}
                          </span>
                          <span className="text-xs text-gray-400">{getBookTitle(card.bookId)}</span>
                        </div>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDelete(card.id) }}
                          className="text-gray-400 hover:text-red-600 transition-colors"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>

                      <h3 className="font-semibold text-gray-900 mb-2 line-clamp-2">{card.title}</h3>

                      {!isFlipped ? (
                        <>
                          <p className="text-sm text-gray-600 leading-relaxed line-clamp-4">{card.content}</p>
                          <div className="mt-3 flex items-center justify-between">
                            <div className="flex items-center gap-1 text-amber-500 text-sm">
                              {getMasteryStars(card.masteryLevel)}
                            </div>
                            <span className="text-xs text-gray-400">点击查看详情</span>
                          </div>
                        </>
                      ) : (
                        <div className="space-y-3" onClick={(e) => e.stopPropagation()}>
                          <div>
                            <h4 className="text-xs font-medium text-gray-500 mb-1">内容</h4>
                            <p className="text-sm text-gray-700 leading-relaxed">{card.content}</p>
                          </div>

                          {card.interpretation ? (
                            <div>
                              <h4 className="text-xs font-medium text-gray-500 mb-1">解读</h4>
                              <p className="text-sm text-gray-600 leading-relaxed">{card.interpretation}</p>
                            </div>
                          ) : (
                            <div className="bg-gray-50 rounded-lg p-3">
                              <p className="text-xs text-gray-500 mb-2">暂无解读</p>
                              <button
                                onClick={() => handleGenerateInterpretation(card)}
                                disabled={!!generatingMap[card.id]}
                                className="px-3 py-1.5 text-xs bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 hover:border-primary disabled:opacity-50 transition-all flex items-center gap-1"
                              >
                                {generatingMap[card.id] === 'interpretation' ? (
                                  <>
                                    <span className="animate-spin inline-block w-3 h-3 border-b border-gray-600 rounded-full"></span>
                                    生成中...
                                  </>
                                ) : (
                                  <>
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    AI 生成解读
                                  </>
                                )}
                              </button>
                            </div>
                          )}

                          {card.application ? (
                            <div>
                              <h4 className="text-xs font-medium text-gray-500 mb-1">应用</h4>
                              <p className="text-sm text-gray-600 leading-relaxed">{card.application}</p>
                            </div>
                          ) : (
                            <div className="bg-gray-50 rounded-lg p-3">
                              <p className="text-xs text-gray-500 mb-2">暂无应用场景</p>
                              <button
                                onClick={() => handleGenerateApplication(card)}
                                disabled={!!generatingMap[card.id]}
                                className="px-3 py-1.5 text-xs bg-white border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 hover:border-primary disabled:opacity-50 transition-all flex items-center gap-1"
                              >
                                {generatingMap[card.id] === 'application' ? (
                                  <>
                                    <span className="animate-spin inline-block w-3 h-3 border-b border-gray-600 rounded-full"></span>
                                    生成中...
                                  </>
                                ) : (
                                  <>
                                    <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                                    </svg>
                                    AI 生成应用场景
                                  </>
                                )}
                              </button>
                            </div>
                          )}

                          {card.tags && card.tags.length > 0 && (
                            <div className="flex items-center gap-2 flex-wrap">
                              {card.tags.map(tag => (
                                <span key={tag} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                                  {tag}
                                </span>
                              ))}
                            </div>
                          )}

                          <div className="flex items-center justify-between text-xs text-gray-400 pt-2 border-t border-gray-100">
                            <div className="flex items-center gap-2">
                              <span>复习 {safeNum(card.reviewCount)} 次</span>
                              <span>·</span>
                              <span>掌握度 {safeNum(card.masteryLevel)}%</span>
                            </div>
                            <span title="基于您的划线/笔记提取">{formatDate(card.createdAt)} · 来自笔记</span>
                          </div>

                          <div className="bg-gray-50 rounded-lg p-3">
                            <p className="text-xs text-gray-500 mb-2">你对这条内容的掌握程度：</p>
                            <div className="flex items-center gap-2">
                              {[1, 2, 3, 4, 5].map(level => (
                                <button
                                  key={level}
                                  onClick={async () => {
                                    try {
                                      await window.electronAPI.knowledgeCard.update(card.id, {
                                        masteryLevel: level * 20,
                                        reviewCount: safeNum(card.reviewCount) + 1,
                                      })
                                      await loadData()
                                      toast.success(`掌握度已更新为 ${level * 20}%`)
                                    } catch (_error) {
                                      toast.error('更新失败')
                                    }
                                  }}
                                  className={`px-3 py-1.5 text-sm rounded-lg transition-all ${
                                    Math.ceil(safeNum(card.masteryLevel) / 20) >= level
                                      ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                      : 'bg-white text-gray-500 border border-gray-200 hover:bg-gray-50'
                                  }`}
                                >
                                  {'★'.repeat(level)}
                                </button>
                              ))}
                            </div>
                          </div>

                          <button
                            onClick={() => setFlippedId(null)}
                            className="w-full py-1.5 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 rounded-lg transition-all"
                          >
                            收起详情
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      ) : (
        <>
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
            <h3 className="text-sm font-medium text-blue-900 mb-1">蒸馏说明</h3>
            <p className="text-sm text-blue-700">
              选择下方书籍，AI 会从你的划线/笔记中提取概念、方法论和金句，生成知识卡片。
              解读和应用场景可在卡片生成后手动添加。
            </p>
          </div>

          {books.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {books.map(book => {
                const bookId = String(book.id)
                const isCurrentDistilling = distillingBookId === bookId
                const cardCount = cards.filter(c => c.bookId === bookId).length
                return (
                  <div key={bookId} className="bg-white rounded-xl p-4 border border-gray-200 shadow-sm hover:border-primary transition-colors">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-12 h-16 bg-primary-light rounded flex-shrink-0 overflow-hidden">
                        {book.cover ? (
                          <img src={safeStr(book.cover)} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-primary text-lg">📖</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-gray-900 truncate">{safeStr(book.title)}</p>
                        <p className="text-xs text-gray-500">{safeStr(book.author)}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{cardCount > 0 ? `已有 ${cardCount} 张卡片` : '暂无卡片'}</p>
                      </div>
                    </div>
                    {isCurrentDistilling ? (
                      <button
                        onClick={() => handleCancelDistill(bookId)}
                        className="w-full px-3 py-2 text-sm bg-red-50 text-red-600 rounded-lg hover:bg-red-100 transition-colors"
                      >
                        取消蒸馏
                      </button>
                    ) : (
                      <button
                        onClick={() => handleDistill(bookId)}
                        disabled={!!distillingBookId}
                        className="w-full px-3 py-2 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                      >
                        {distillingBookId ? '等待中...' : cardCount > 0 ? '重新蒸馏' : '开始蒸馏'}
                      </button>
                    )}
                    {renderDistillProgress(bookId)}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className="bg-white rounded-xl p-12 border border-gray-200 text-center shadow-sm">
              <div className="text-6xl mb-4">📚</div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">暂无书籍</h2>
              <p className="text-gray-600">请先从书架导入书籍</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}
