import { useState, useEffect, useMemo, useCallback } from 'react'
import { toast } from '../stores/toastStore'
import { safeStr, safeNum, formatDate, mapMethodologies } from '../utils/db-mapper'

interface MethodologyItem {
  id: string
  bookId: string
  name: string
  nameEn?: string
  triggerScenario?: string
  description?: string
  steps?: string[]
  outputFormat?: string
  examples?: string
  tags?: string[]
  sourceHighlightIds?: string[]
  masteryLevel: number
  practiceCount: number
  createdAt: string
  updatedAt: string
}

interface BookInfo {
  id: string
  title: string
  author?: string
  cover?: string
}

type ViewMode = 'list' | 'card' | 'book'

export default function Methodologies() {
  const [methodologies, setMethodologies] = useState<MethodologyItem[]>([])
  const [books, setBooks] = useState<BookInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedBook, setSelectedBook] = useState('')
  const [selectedTag, setSelectedTag] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('card')
  const [extractingBookId, setExtractingBookId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [detailModal, setDetailModal] = useState<MethodologyItem | null>(null)
  const [showExtractPanel, setShowExtractPanel] = useState(false)

  useEffect(() => { loadData() }, [])

  const loadData = async () => {
    if (!window.electronAPI?.methodology || !window.electronAPI?.book) {
      setLoading(false)
      return
    }
    try {
      const [methodsRaw, booksRaw] = await Promise.all([
        window.electronAPI.methodology.getAll(),
        window.electronAPI.book.getAll()
      ])
      const mappedMethods = mapMethodologies(methodsRaw as unknown as Record<string, unknown>[])
      setMethodologies(mappedMethods as unknown as MethodologyItem[])
      setBooks((booksRaw as BookInfo[]) || [])
    } catch (error) {
      console.error('加载方法论数据失败:', error)
      toast.error('加载方法论数据失败')
    } finally {
      setLoading(false)
    }
  }

  const getBookTitle = useCallback((bookId: string) => {
    const book = books.find(b => b.id === bookId)
    return safeStr(book?.title, '未知书籍')
  }, [books])

  const getBookInfo = useCallback((bookId: string): BookInfo | undefined => {
    return books.find(b => b.id === bookId)
  }, [books])

  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    methodologies.forEach(m => {
      m.tags?.forEach(tag => tagSet.add(tag))
    })
    return Array.from(tagSet).sort()
  }, [methodologies])

  const filteredMethodologies = useMemo(() => {
    let result = methodologies

    if (selectedBook) {
      result = result.filter(m => m.bookId === selectedBook)
    }

    if (selectedTag) {
      result = result.filter(m => m.tags?.includes(selectedTag))
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      const terms = query.split(/\s+/).filter(t => t.length > 0)
      result = result.filter(m => {
        const searchText = [
          m.name,
          m.nameEn,
          m.triggerScenario,
          m.description,
          m.outputFormat,
          m.examples,
          getBookTitle(m.bookId)
        ].filter(Boolean).join(' ').toLowerCase()
        return terms.every(term => searchText.includes(term))
      })
    }

    return result
  }, [methodologies, selectedBook, selectedTag, searchQuery, getBookTitle])

  const methodologiesByBook = useMemo(() => {
    const map = new Map<string, MethodologyItem[]>()
    filteredMethodologies.forEach(m => {
      const list = map.get(m.bookId) || []
      list.push(m)
      map.set(m.bookId, list)
    })
    return map
  }, [filteredMethodologies])

  const handleExtract = async (bookId: string) => {
    const book = books.find(b => b.id === bookId)
    if (!book) return
    setExtractingBookId(bookId)
    const toastId = toast.loading(`正在从《${safeStr(book.title)}》提取方法论，请耐心等待...`)
    try {
      await window.electronAPI.methodology.extract(bookId, safeStr(book.title))
      await loadData()
      toast.remove(toastId)
      toast.success('方法论提取完成，已自动注入智能体')
    } catch (error) {
      toast.remove(toastId)
      const errorMsg = error instanceof Error ? error.message : String(error)

      if (errorMsg.includes('超时') || errorMsg.includes('timeout') || errorMsg.includes('aborted')) {
        toast.error('提取超时，笔记较多时可能需要更长时间，请稍后重试')
      } else if (errorMsg.includes('该书在微信读书中也没有笔记')) {
        toast.warning('该书在微信读书中没有笔记，无法提取方法论')
      } else if (errorMsg.includes('自动导入笔记失败')) {
        toast.error('自动导入笔记失败，请检查微信读书配置后重试')
      } else {
        toast.error(`提取失败: ${errorMsg}`)
      }
    } finally {
      setExtractingBookId(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个方法论吗？')) return
    try {
      await window.electronAPI.methodology.delete(id)
      await loadData()
      toast.success('已删除')
    } catch (error) {
      toast.error(`删除失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const getMasteryLabel = (level: number) => {
    if (level >= 80) return { label: '精通', color: 'bg-green-500', textColor: 'text-green-700', bgLight: 'bg-green-50' }
    if (level >= 50) return { label: '熟练', color: 'bg-blue-500', textColor: 'text-blue-700', bgLight: 'bg-blue-50' }
    if (level >= 20) return { label: '入门', color: 'bg-yellow-500', textColor: 'text-yellow-700', bgLight: 'bg-yellow-50' }
    return { label: '初学', color: 'bg-gray-400', textColor: 'text-gray-600', bgLight: 'bg-gray-50' }
  }

  const getMasteryProgress = (level: number) => {
    return Math.min(Math.max(safeNum(level), 0), 100)
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
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">方法论中心</h1>
          <p className="text-gray-600 mt-1">
            共 {methodologies.length} 个方法论
            {filteredMethodologies.length !== methodologies.length && ` · 筛选显示 ${filteredMethodologies.length} 个`}
          </p>
          <p className="text-sm text-primary mt-1">
            提取的方法论会自动注入智能体，让智能体越来越聪明
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowExtractPanel(!showExtractPanel)}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-all flex items-center gap-2"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            提取方法论
          </button>
          <div className="flex items-center gap-2 bg-gray-100 rounded-lg p-1">
          {([['card', '卡片'], ['list', '列表'], ['book', '按书']] as const).map(([mode, label]) => (
            <button
              key={mode}
              onClick={() => setViewMode(mode)}
              className={`px-3 py-1.5 text-sm rounded-md transition-all ${
                viewMode === mode
                  ? 'bg-white text-gray-900 shadow-sm font-medium'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        </div>
      </div>

      {/* Extract Panel */}
      {showExtractPanel && books.length > 0 && (
        <div className="bg-white rounded-xl p-6 border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">从书籍中提取方法论</h2>
            <button onClick={() => setShowExtractPanel(false)} className="text-gray-400 hover:text-gray-600">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-sm text-gray-600 mb-4">选择书籍提取方法论，提取后自动注入智能体</p>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {books.map(book => (
              <div key={book.id} className="flex items-center gap-3 p-3 border border-gray-200 rounded-lg hover:border-primary transition-colors">
                <div className="w-8 h-11 bg-primary-light rounded flex-shrink-0 overflow-hidden">
                  {book.cover ? (
                    <img src={safeStr(book.cover)} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-primary text-sm">📖</div>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-gray-900 truncate text-sm">{safeStr(book.title)}</p>
                  <p className="text-xs text-gray-500">{safeStr(book.author)}</p>
                </div>
                <button
                  onClick={() => handleExtract(book.id)}
                  disabled={extractingBookId === book.id}
                  className="px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1 transition-all"
                >
                  {extractingBookId === book.id ? (
                    <><div className="animate-spin rounded-full h-3 w-3 border-b-2 border-white"></div>提取中</>
                  ) : (
                    <>提取</>
                  )}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[240px]">
          <label className="block text-sm font-medium text-gray-700 mb-1">搜索方法论</label>
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索方法论名称、触发场景、描述..."
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
              <option key={book.id} value={book.id}>{book.title}</option>
            ))}
          </select>
        </div>
        <div className="min-w-[160px]">
          <label className="block text-sm font-medium text-gray-700 mb-1">按标签筛选</label>
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

      {/* Empty state */}
      {filteredMethodologies.length === 0 ? (
        <div className="bg-white rounded-xl p-12 border border-gray-200 text-center shadow-sm">
          <div className="text-6xl mb-4">💡</div>
          <h2 className="text-xl font-semibold text-gray-900 mb-2">
            {searchQuery || selectedBook || selectedTag ? '没有找到匹配的方法论' : '还没有方法论'}
          </h2>
          <p className="text-gray-600">
            {searchQuery || selectedBook || selectedTag
              ? '尝试调整筛选条件'
              : '从书籍中提取方法论，自动注入智能体让它越来越聪明'}
          </p>
        </div>
      ) : viewMode === 'book' ? (
        /* Book Group View */
        <div className="space-y-8">
          {Array.from(methodologiesByBook.entries()).map(([bookId, methods]) => {
            const book = getBookInfo(bookId)
            return (
              <div key={bookId} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="p-4 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-11 bg-primary-light rounded flex-shrink-0 overflow-hidden">
                      {book?.cover ? (
                        <img src={safeStr(book.cover)} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-primary text-sm">📖</div>
                      )}
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">《{safeStr(book?.title, '未知书籍')}》</h3>
                      <p className="text-sm text-gray-500">{methods.length} 个方法论</p>
                    </div>
                  </div>
                  <button
                    onClick={() => handleExtract(bookId)}
                    disabled={extractingBookId === bookId}
                    className="px-3 py-1.5 text-sm bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50 transition-all"
                  >
                    {extractingBookId === bookId ? '提取中...' : '重新提取'}
                  </button>
                </div>
                <div className="p-4 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {methods.map(m => (
                    <MethodologyCard
                      key={m.id}
                      methodology={m}
                      mastery={getMasteryLabel(safeNum(m.masteryLevel))}
                      progress={getMasteryProgress(m.masteryLevel)}
                      onDetail={() => setDetailModal(m)}
                      onDelete={() => handleDelete(m.id)}
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ) : viewMode === 'card' ? (
        /* Card Grid View */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredMethodologies.map(m => (
            <MethodologyCard
              key={m.id}
              methodology={m}
              mastery={getMasteryLabel(safeNum(m.masteryLevel))}
              progress={getMasteryProgress(m.masteryLevel)}
              bookTitle={getBookTitle(m.bookId)}
              onDetail={() => setDetailModal(m)}
              onDelete={() => handleDelete(m.id)}
            />
          ))}
        </div>
      ) : (
        /* List View */
        <div className="space-y-3">
          {filteredMethodologies.map(m => {
            const mastery = getMasteryLabel(safeNum(m.masteryLevel))
            const isExpanded = expandedId === m.id
            return (
              <div key={m.id} className="bg-white rounded-xl border border-gray-200 hover:shadow-md transition-all duration-200 overflow-hidden">
                <div className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="text-lg font-semibold text-gray-900">{m.name}</h3>
                        {m.nameEn && (
                          <span className="text-sm text-gray-500">{m.nameEn}</span>
                        )}
                        <span className={`px-2 py-0.5 text-xs rounded-full ${mastery.bgLight} ${mastery.textColor}`}>
                          {mastery.label}
                        </span>
                      </div>
                      <p className="text-sm text-gray-500 mt-1">
                        来自《{getBookTitle(m.bookId)}》· 练习 {safeNum(m.practiceCount)} 次
                      </p>
                      {m.triggerScenario && (
                        <p className="text-sm text-primary mt-2">
                          <span className="font-medium">触发场景:</span> {m.triggerScenario}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => setExpandedId(isExpanded ? null : m.id)}
                        className="px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-all"
                      >
                        {isExpanded ? '收起' : '详情'}
                      </button>
                      <button
                        onClick={() => handleDelete(m.id)}
                        className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-all"
                      >
                        删除
                      </button>
                    </div>
                  </div>

                  {m.tags && m.tags.length > 0 && (
                    <div className="flex items-center gap-2 mt-3 flex-wrap">
                      {m.tags.map(tag => (
                        <span key={tag} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-600 rounded-full">
                          {tag}
                        </span>
                      ))}
                    </div>
                  )}

                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-gray-100 space-y-4">
                      {m.description && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-700 mb-1">描述</h4>
                          <p className="text-sm text-gray-600 leading-relaxed">{m.description}</p>
                        </div>
                      )}
                      {m.steps && m.steps.length > 0 && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-700 mb-2">执行步骤</h4>
                          <ol className="space-y-2">
                            {m.steps.map((step, idx) => (
                              <li key={idx} className="flex items-start gap-2 text-sm text-gray-600">
                                <span className="flex-shrink-0 w-5 h-5 bg-primary-light text-primary rounded-full flex items-center justify-center text-xs font-medium">
                                  {idx + 1}
                                </span>
                                <span className="leading-relaxed">{step}</span>
                              </li>
                            ))}
                          </ol>
                        </div>
                      )}
                      {m.outputFormat && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-700 mb-1">输出格式</h4>
                          <p className="text-sm text-gray-600 leading-relaxed">{m.outputFormat}</p>
                        </div>
                      )}
                      {m.examples && (
                        <div>
                          <h4 className="text-sm font-medium text-gray-700 mb-1">示例</h4>
                          <div className="bg-gray-50 rounded-lg p-3 text-sm text-gray-600 leading-relaxed">
                            {m.examples}
                          </div>
                        </div>
                      )}
                      <div className="flex items-center gap-4 text-xs text-gray-400 pt-2">
                        <span>掌握度: {safeNum(m.masteryLevel)}%</span>
                        <span>练习次数: {safeNum(m.practiceCount)}</span>
                        <span>创建于: {formatDate(m.createdAt)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Detail Modal */}
      {detailModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setDetailModal(null)}>
          <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-gray-100">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">{detailModal.name}</h2>
                  {detailModal.nameEn && <p className="text-gray-500 mt-1">{detailModal.nameEn}</p>}
                </div>
                <button onClick={() => setDetailModal(null)} className="text-gray-400 hover:text-gray-600">
                  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
            <div className="p-6 space-y-6">
              {detailModal.triggerScenario && (
                <div className="bg-primary-light rounded-xl p-4">
                  <h4 className="text-sm font-medium text-primary mb-1">触发场景</h4>
                  <p className="text-gray-700">{detailModal.triggerScenario}</p>
                </div>
              )}
              {detailModal.description && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">描述</h4>
                  <p className="text-gray-600 leading-relaxed">{detailModal.description}</p>
                </div>
              )}
              {detailModal.steps && detailModal.steps.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-3">执行步骤</h4>
                  <div className="space-y-3">
                    {detailModal.steps.map((step, idx) => (
                      <div key={idx} className="flex items-start gap-3">
                        <div className="flex-shrink-0 w-8 h-8 bg-primary text-white rounded-full flex items-center justify-center text-sm font-medium">
                          {idx + 1}
                        </div>
                        <p className="text-gray-600 leading-relaxed pt-1">{step}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {detailModal.outputFormat && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">输出格式</h4>
                  <div className="bg-gray-50 rounded-lg p-4 text-gray-600">{detailModal.outputFormat}</div>
                </div>
              )}
              {detailModal.examples && (
                <div>
                  <h4 className="text-sm font-medium text-gray-700 mb-2">示例</h4>
                  <div className="bg-gray-50 rounded-lg p-4 text-gray-600 leading-relaxed">{detailModal.examples}</div>
                </div>
              )}
              {detailModal.tags && detailModal.tags.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  {detailModal.tags.map(tag => (
                    <span key={tag} className="px-3 py-1 text-sm bg-gray-100 text-gray-600 rounded-full">{tag}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="p-6 border-t border-gray-100 flex items-center justify-between">
              <div className="text-sm text-gray-500">
                来自《{getBookTitle(detailModal.bookId)}》· 掌握度 {safeNum(detailModal.masteryLevel)}% · 练习 {safeNum(detailModal.practiceCount)} 次
              </div>
              <button
                onClick={() => setDetailModal(null)}
                className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-all"
              >
                关闭
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* Methodology Card Component */
function MethodologyCard({
  methodology,
  mastery,
  progress,
  bookTitle,
  onDetail,
  onDelete,
}: {
  methodology: MethodologyItem
  mastery: { label: string; color: string; textColor: string; bgLight: string }
  progress: number
  bookTitle?: string
  onDetail: () => void
  onDelete: () => void
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 hover:shadow-lg transition-all duration-200 overflow-hidden flex flex-col">
      <div className="p-5 flex-1 cursor-pointer" onClick={onDetail}>
        <div className="flex items-start justify-between gap-2 mb-3">
          <h3 className="font-semibold text-gray-900 line-clamp-2 flex-1">{methodology.name}</h3>
          <span className={`flex-shrink-0 w-2 h-2 rounded-full ${mastery.color} mt-2`}></span>
        </div>

        {methodology.nameEn && (
          <p className="text-xs text-gray-400 mb-2">{methodology.nameEn}</p>
        )}

        {bookTitle && (
          <p className="text-xs text-gray-500 mb-3">《{bookTitle}》</p>
        )}

        {methodology.triggerScenario && (
          <p className="text-sm text-gray-600 line-clamp-2 mb-3">
            <span className="text-primary font-medium">场景:</span> {methodology.triggerScenario}
          </p>
        )}

        {/* Mastery Progress */}
        <div className="mb-3">
          <div className="flex items-center justify-between text-xs mb-1">
            <span className="text-gray-500">掌握度</span>
            <span className={`font-medium ${mastery.textColor}`}>{mastery.label}</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className={`${mastery.color} h-1.5 rounded-full transition-all duration-300`}
              style={{ width: `${progress}%` }}
            ></div>
          </div>
        </div>

        {methodology.tags && methodology.tags.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap">
            {methodology.tags.slice(0, 3).map(tag => (
              <span key={tag} className="px-2 py-0.5 text-xs bg-gray-100 text-gray-500 rounded-full">{tag}</span>
            ))}
            {methodology.tags.length > 3 && (
              <span className="text-xs text-gray-400">+{methodology.tags.length - 3}</span>
            )}
          </div>
        )}
      </div>

      <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
        <span className="text-xs text-gray-400">点击查看详情</span>
        <button
          onClick={(e) => { e.stopPropagation(); onDelete() }}
          className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-all"
        >
          删除
        </button>
      </div>
    </div>
  )
}
