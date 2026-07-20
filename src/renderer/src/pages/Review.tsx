import { useState, useEffect } from 'react'
import { mapCards, mapHighlights, safeStr, safeNum as _safeNum } from '../utils/db-mapper'
import { toast } from '../stores/toastStore'

interface ReviewStatsLocal {
  total: number
  due: number
  new: number
  learning: number
  review: number
}

// IPC 响应解包辅助函数
function unwrap<T>(res: unknown): T | null {
  if (!res || typeof res !== 'object') return null
  const r = res as Record<string, unknown>
  if (r.success === true && 'data' in r) {
    return r.data as T
  }
  // 兼容直接返回数据的情况
  return res as T
}

// 生成回忆线索：取前20字+隐藏
function generateClue(content: string): string {
  if (!content || content.length === 0) return '暂无内容'
  const trimmed = content.trim()
  if (trimmed.length <= 20) {
    // 短内容：隐藏后半部分
    const half = Math.floor(trimmed.length / 2)
    return trimmed.slice(0, half) + ' ...'
  }
  // 长内容：取前20字+省略号
  return trimmed.slice(0, 20) + ' ...'
}

// 应用标签选项
const APPLICATION_TAGS = [
  { key: 'work', label: '工作中', emoji: '💼' },
  { key: 'study', label: '学习中', emoji: '📚' },
  { key: 'life', label: '生活中', emoji: '🏠' },
  { key: 'practiced', label: '已实践', emoji: '✅' },
]

// 评分等级
const RATING_LEVELS = [
  { score: 1, emoji: '😵', label: '完全想不起', desc: '10分钟后复习', color: 'bg-red-100 text-red-700 hover:bg-red-200' },
  { score: 2, emoji: '😐', label: '有点印象', desc: '1天后复习', color: 'bg-orange-100 text-orange-700 hover:bg-orange-200' },
  { score: 3, emoji: '🙂', label: '基本记得', desc: '3天后复习', color: 'bg-blue-100 text-blue-700 hover:bg-blue-200' },
  { score: 4, emoji: '😄', label: '非常清晰', desc: '7天后复习', color: 'bg-green-100 text-green-700 hover:bg-green-200' },
]

export default function Review() {
  const [cards, setCards] = useState<Record<string, unknown>[]>([])
  const [highlights, setHighlights] = useState<Record<string, unknown>[]>([])
  const [books, setBooks] = useState<Record<string, unknown>[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [loading, setLoading] = useState(true)
  const [completed, setCompleted] = useState(false)
  const [reviewedCount, setReviewedCount] = useState(0)
  const [stats, setStats] = useState<ReviewStatsLocal | null>(null)
  const [totalHighlights, setTotalHighlights] = useState(0)
  const [totalCards, setTotalCards] = useState(0)
  const [creatingCards, setCreatingCards] = useState(false)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)

  useEffect(() => { loadDueCards() }, [])

  const loadDueCards = async () => {
    if (!window.electronAPI?.card || !window.electronAPI?.highlight || !window.electronAPI?.book) {
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      const [dueCardsRes, highlightsRes, booksRes, statsRes] = await Promise.all([
        window.electronAPI.card.getDue(),
        window.electronAPI.highlight.getAll(),
        window.electronAPI.book.getAll(),
        window.electronAPI.card.getStats().catch(() => null)
      ])

      const dueCardsRaw = unwrap<unknown[]>(dueCardsRes) ?? []
      const allHighlightsRaw = unwrap<unknown[]>(highlightsRes) ?? []
      const allBooksRaw = unwrap<unknown[]>(booksRes) ?? []
      const cardStats = unwrap<Record<string, number>>(statsRes)

      setCards(mapCards(dueCardsRaw))
      setHighlights(mapHighlights(allHighlightsRaw))
      setBooks(allBooksRaw as Record<string, unknown>[])

      if (cardStats) {
        const localStats: ReviewStatsLocal = {
          total: cardStats.total ?? 0,
          due: cardStats.due ?? 0,
          new: cardStats.new ?? 0,
          learning: cardStats.learning ?? 0,
          review: cardStats.review ?? 0,
        }
        setStats(localStats)
        setTotalCards(localStats.total)
      }
      setTotalHighlights(allHighlightsRaw.length)
    } catch (error) {
      console.error('加载待复习卡片失败:', error)
      toast.error('加载待复习卡片失败')
    } finally {
      setLoading(false)
    }
  }

  const handleCreateCardsForExisting = async () => {
    try {
      setCreatingCards(true)
      const res = await window.electronAPI.card.createForExisting()
      const result = unwrap<{ created: number; skipped: number }>(res)

      if (result && result.created > 0) {
        toast.success(`成功创建 ${result.created} 张复习卡片`)
        await loadDueCards()
      } else if (result && result.skipped > 0) {
        toast.info('所有笔记都已有复习卡片')
      } else {
        toast.info('没有需要创建卡片的高亮')
      }
    } catch (error) {
      console.error('创建复习卡片失败:', error)
      toast.error('创建复习卡片失败')
    } finally {
      setCreatingCards(false)
    }
  }

  const getHighlightForCard = (card: Record<string, unknown>) => {
    const highlightId = card.highlightId as string
    if (!highlightId) return null
    return highlights.find(h => h.id === highlightId) || null
  }

  const getBookForHighlight = (highlight: Record<string, unknown> | null) => {
    if (!highlight) return null
    const bookId = highlight.bookId as string
    if (!bookId) return null
    return books.find(b => b.id === bookId) || null
  }

  const handleShowAnswer = () => setShowAnswer(true)

  const handleRate = async (quality: number) => {
    const currentCard = cards[currentIndex]
    if (!currentCard) return
    try {
      // 保存应用标签
      if (selectedTag) {
        await window.electronAPI.card.updateApplicationTag(currentCard.id as string, selectedTag)
      }
      // 保存掌握度
      await window.electronAPI.card.updateMasteryLevel(currentCard.id as string, quality)
      // 执行FSRS复习
      await window.electronAPI.card.review(currentCard.id as string, quality)

      setReviewedCount(prev => prev + 1)
      setSelectedTag(null)

      if (currentIndex < cards.length - 1) {
        setCurrentIndex(prev => prev + 1)
        setShowAnswer(false)
      } else {
        setCompleted(true)
      }
    } catch (error) {
      console.error('评分失败:', error)
      toast.error('评分失败，请重试')
    }
  }

  const handleRestart = () => {
    setCurrentIndex(0)
    setShowAnswer(false)
    setCompleted(false)
    setReviewedCount(0)
    setSelectedTag(null)
    loadDueCards()
  }

  const handleSkip = () => {
    setSelectedTag(null)
    if (currentIndex < cards.length - 1) {
      setCurrentIndex(prev => prev + 1)
      setShowAnswer(false)
    } else {
      setCompleted(true)
    }
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  // 空状态：没有任何复习卡片
  if (totalCards === 0 && totalHighlights > 0) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-full max-w-2xl mx-auto">
        <div className="text-6xl mb-4">📝</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">还没有复习卡片</h1>
        <p className="text-gray-600 mb-2 text-center">
          你有 {totalHighlights} 条笔记，但还没有创建复习卡片。
        </p>
        <p className="text-gray-500 mb-6 text-center text-sm">
          复习卡片基于 FSRS 间隔重复算法，帮助你高效记忆笔记内容。
        </p>
        <button
          onClick={handleCreateCardsForExisting}
          disabled={creatingCards}
          className="px-6 py-3 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed text-lg font-medium flex items-center gap-2"
        >
          {creatingCards ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
              创建中...
            </>
          ) : (
            <>
              <span>✨</span>
              一键创建复习卡片
            </>
          )}
        </button>
      </div>
    )
  }

  // 空状态：有卡片但没有到期的
  if (cards.length === 0) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-full max-w-2xl mx-auto">
        <div className="text-6xl mb-4">🎉</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">没有待复习的卡片</h1>
        <p className="text-gray-600 mb-6 text-center">
          所有卡片都已复习完毕，明天再来吧！
        </p>

        {stats && (
          <div className="grid grid-cols-4 gap-4 w-full mb-6">
            <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
              <div className="text-2xl font-bold text-primary">{stats.total}</div>
              <div className="text-xs text-gray-500 mt-1">总卡片</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">{stats.new}</div>
              <div className="text-xs text-gray-500 mt-1">新卡片</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
              <div className="text-2xl font-bold text-amber-600">{stats.learning}</div>
              <div className="text-xs text-gray-500 mt-1">学习中</div>
            </div>
            <div className="bg-white rounded-lg border border-gray-200 p-4 text-center">
              <div className="text-2xl font-bold text-green-600">{stats.review}</div>
              <div className="text-xs text-gray-500 mt-1">复习中</div>
            </div>
          </div>
        )}

        <div className="flex gap-4">
          <button
            onClick={() => window.location.reload()}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover"
          >
            刷新页面
          </button>
          {totalHighlights > totalCards && (
            <button
              onClick={handleCreateCardsForExisting}
              disabled={creatingCards}
              className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              {creatingCards ? '创建中...' : '创建更多卡片'}
            </button>
          )}
        </div>
      </div>
    )
  }

  if (completed) {
    return (
      <div className="p-6 flex flex-col items-center justify-center h-full">
        <div className="text-6xl mb-4">🏆</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">复习完成！</h1>
        <p className="text-gray-600 mb-4">你已完成 {reviewedCount} 张卡片的复习</p>
        <div className="flex gap-4">
          <button
            onClick={handleRestart}
            className="px-4 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover"
          >
            继续复习
          </button>
          <button
            onClick={() => window.history.back()}
            className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            返回
          </button>
        </div>
      </div>
    )
  }

  const currentCard = cards[currentIndex]
  const highlight = getHighlightForCard(currentCard)
  const book = getBookForHighlight(highlight)

  const fullContent = highlight ? safeStr(highlight.content, '暂无内容') : '暂无内容'
  const clue = generateClue(fullContent)
  const bookTitle = book ? safeStr(book.title, '未知书籍') : '未知书籍'
  const chapterTitle = highlight ? safeStr(highlight.chapterTitle, '') : ''
  const progress = ((currentIndex) / cards.length) * 100

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      {/* 头部 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">间隔复习</h1>
          <p className="text-gray-600 mt-1">待复习: {cards.length} 张卡片</p>
        </div>
        <div className="text-sm text-gray-500">
          已复习 {reviewedCount} / {cards.length}
        </div>
      </div>

      {/* 进度条 */}
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm text-gray-600">复习进度</span>
          <span className="text-sm font-medium text-primary">{currentIndex + 1} / {cards.length}</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-primary h-2 rounded-full transition-all duration-300"
            style={{ width: `${progress}%` }}
          ></div>
        </div>
      </div>

      {/* 卡片内容 */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 min-h-[400px] flex flex-col">
        <div className="flex-1">
          {/* 来源信息 */}
          <div className="flex items-center gap-2 mb-4 text-sm text-gray-500">
            <span className="bg-gray-100 px-2 py-1 rounded">📚 {bookTitle}</span>
            {chapterTitle && chapterTitle !== '未知章节' && (
              <span className="bg-gray-100 px-2 py-1 rounded">{chapterTitle}</span>
            )}
          </div>

          {!showAnswer ? (
            /* Step 1: 主动回忆（正面） */
            <div className="text-center">
              <div className="w-16 h-16 bg-primary-light rounded-full flex items-center justify-center mx-auto mb-4">
                <span className="text-primary text-2xl">🤔</span>
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">先回忆一下</h2>
              <p className="text-gray-500 mb-6">不要看答案！尝试在脑海中回忆这条笔记的完整内容</p>

              {/* 线索卡片 */}
              <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-6 mb-8 border border-blue-100">
                <div className="text-sm text-blue-600 mb-2 font-medium">💡 概念线索</div>
                <p className="text-gray-900 text-xl leading-relaxed">{clue}</p>
              </div>

              <button
                onClick={handleShowAnswer}
                className="px-8 py-3 bg-primary text-white rounded-lg hover:bg-primary-hover text-lg font-medium transition-all hover:shadow-lg"
              >
                我想起来了，显示原文
              </button>
            </div>
          ) : (
            /* Step 2: 对照评分（背面） */
            <div>
              {/* 原文展示 */}
              <div className="mb-6">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                    <span className="text-green-600">📖</span>
                  </div>
                  <h2 className="text-lg font-semibold text-gray-900">原文对照</h2>
                </div>
                <div className="bg-green-50 rounded-xl p-5 border border-green-100">
                  <p className="text-gray-900 text-lg leading-relaxed">{fullContent}</p>
                </div>
              </div>

              {/* 行动标签 */}
              <div className="mb-6">
                <p className="text-sm text-gray-600 mb-3">🎯 这条笔记对你的实际意义？（可选）</p>
                <div className="flex flex-wrap gap-2">
                  {APPLICATION_TAGS.map(tag => (
                    <button
                      key={tag.key}
                      onClick={() => setSelectedTag(selectedTag === tag.key ? null : tag.key)}
                      className={`px-4 py-2 rounded-lg border transition-all ${
                        selectedTag === tag.key
                          ? 'bg-primary text-white border-primary'
                          : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      <span className="mr-1">{tag.emoji}</span>
                      {tag.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 评分按钮 */}
              <div className="pt-4 border-t border-gray-200">
                <p className="text-sm text-gray-600 text-center mb-4">
                  刚才回忆的流畅程度？
                </p>
                <div className="grid grid-cols-4 gap-3">
                  {RATING_LEVELS.map(level => (
                    <button
                      key={level.score}
                      onClick={() => handleRate(level.score)}
                      className={`px-3 py-4 rounded-xl transition-all hover:shadow-md ${level.color}`}
                    >
                      <div className="text-2xl mb-1">{level.emoji}</div>
                      <div className="text-sm font-medium">{level.label}</div>
                      <div className="text-xs mt-1 opacity-75">{level.desc}</div>
                    </button>
                  ))}
                </div>

                {/* 跳过按钮 */}
                <div className="text-center mt-4">
                  <button
                    onClick={handleSkip}
                    className="text-sm text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    跳过这张卡片
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
