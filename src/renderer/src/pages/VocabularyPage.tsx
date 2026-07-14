import { useState, useEffect, useCallback } from 'react'
import { toast } from '../stores/toastStore'

// 生词类型定义
interface VocabularyItem {
  id: string
  word: string
  phonetic?: string
  part_of_speech?: string
  meaning_zh: string
  example_en?: string
  example_zh?: string
  source?: string
  is_mastered: number
  review_count: number
  last_review_at?: string
  next_review_at?: string
  ef_factor?: number
  interval_days?: number
  repetition_count?: number
  familiarity_level?: number
  learning_stage?: number
  created_at: string
}

// 复习评分
enum ReviewRating {
  AGAIN = 1,   // 完全忘记
  HARD = 3,    // 困难想起
  GOOD = 4,    // 正常想起
  EASY = 5,    // 轻松想起
}

export default function VocabularyPage() {
  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([])
  const [stats, setStats] = useState({ total: 0, mastered: 0, dueToday: 0 })
  const [loading, setLoading] = useState(true)
  const [searchKeyword, setSearchKeyword] = useState('')
  const [activeTab, setActiveTab] = useState<'all' | 'due' | 'mastered'>('all')

  // 复习模式状态
  const [reviewMode, setReviewMode] = useState(false)
  const [currentReviewIndex, setCurrentReviewIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [reviewList, setReviewList] = useState<VocabularyItem[]>([])
  const [reviewStats, setReviewStats] = useState({ correct: 0, total: 0 })

  // 加载生词本数据
  const loadVocabulary = useCallback(async () => {
    if (!window.electronAPI?.vocabulary) {
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      let result: unknown[] = []

      if (activeTab === 'due') {
        result = await window.electronAPI.vocabulary.getDueForReview(200)
      } else if (activeTab === 'mastered') {
        const all = await window.electronAPI.vocabulary.getAll(200)
        result = (all as unknown as VocabularyItem[]).filter(v => v.is_mastered === 1)
      } else {
        result = await window.electronAPI.vocabulary.getAll(200)
      }

      const data = Array.isArray(result) ? result : []
      setVocabulary(data as unknown as VocabularyItem[])

      // 加载统计
      const statsResult = await window.electronAPI.vocabulary.getStats()
      setStats(statsResult as { total: number; mastered: number; dueToday: number })
    } catch (error) {
      console.error('加载生词本失败:', error)
      toast.error('加载生词本失败')
    } finally {
      setLoading(false)
    }
  }, [activeTab])

  useEffect(() => {
    loadVocabulary()
  }, [loadVocabulary])

  // 搜索功能
  const handleSearch = async () => {
    if (!searchKeyword.trim()) {
      loadVocabulary()
      return
    }
    try {
      const result = await window.electronAPI.vocabulary.search(searchKeyword)
      const data = Array.isArray(result) ? result : []
      setVocabulary(data as unknown as VocabularyItem[])
    } catch (error) {
      console.error('搜索失败:', error)
    }
  }

  // 删除生词
  const handleDelete = async (id: string, word: string) => {
    if (!confirm(`确定要删除 "${word}" 吗？`)) return
    try {
      await window.electronAPI.vocabulary.delete(id)
      toast.success('已删除')
      loadVocabulary()
    } catch (error) {
      console.error('删除失败:', error)
      toast.error('删除失败')
    }
  }

  // 开始复习模式
  const startReview = async () => {
    try {
      const result = await window.electronAPI.vocabulary.getDueForReview(50)
      const data = Array.isArray(result) ? result : []
      if (data.length === 0) {
        toast.info('没有待复习的单词')
        return
      }
      setReviewList(data as unknown as VocabularyItem[])
      setCurrentReviewIndex(0)
      setShowAnswer(false)
      setReviewStats({ correct: 0, total: 0 })
      setReviewMode(true)
    } catch (error) {
      console.error('启动复习失败:', error)
      toast.error('启动复习失败')
    }
  }

  // 提交复习评分
  const submitReview = async (rating: ReviewRating) => {
    const currentWord = reviewList[currentReviewIndex]
    if (!currentWord) return

    try {
      await window.electronAPI.vocabulary.updateReviewData(currentWord.id, {
        quality: rating,
      })

      setReviewStats(prev => ({
        correct: prev.correct + (rating >= ReviewRating.GOOD ? 1 : 0),
        total: prev.total + 1,
      }))

      if (currentReviewIndex < reviewList.length - 1) {
        setCurrentReviewIndex(prev => prev + 1)
        setShowAnswer(false)
      } else {
        // 复习完成
        toast.success(`复习完成！正确率: ${Math.round((reviewStats.correct + (rating >= ReviewRating.GOOD ? 1 : 0)) / (reviewStats.total + 1) * 100)}%`)
        setReviewMode(false)
        loadVocabulary()
      }
    } catch (error) {
      console.error('提交复习失败:', error)
      toast.error('提交复习失败')
    }
  }

  // 获取熟悉度颜色
  const getFamiliarityColor = (level?: number) => {
    switch (level) {
      case 0: return 'bg-gray-200'
      case 1: return 'bg-red-300'
      case 2: return 'bg-orange-300'
      case 3: return 'bg-yellow-300'
      case 4: return 'bg-green-300'
      case 5: return 'bg-green-500'
      default: return 'bg-gray-200'
    }
  }

  // 获取学习阶段标签
  const getLearningStageLabel = (stage?: number) => {
    switch (stage) {
      case 0: return { text: '新词', color: 'bg-gray-100 text-gray-600' }
      case 1: return { text: '学习中', color: 'bg-amber-100 text-amber-700' }
      case 2: return { text: '复习中', color: 'bg-blue-100 text-blue-700' }
      default: return { text: '新词', color: 'bg-gray-100 text-gray-600' }
    }
  }

  // 获取下次复习时间显示
  const getNextReviewText = (nextReview?: string) => {
    if (!nextReview) return '立即复习'
    const next = new Date(nextReview)
    const now = new Date()
    const diff = next.getTime() - now.getTime()
    if (diff <= 0) return '立即复习'
    const minutes = Math.ceil(diff / (1000 * 60))
    if (minutes < 60) return `${minutes}分钟后`
    const hours = Math.ceil(diff / (1000 * 60 * 60))
    if (hours < 24) return `${hours}小时后`
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
    if (days === 1) return '明天'
    return `${days}天后`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  // 复习模式
  if (reviewMode && reviewList.length > 0) {
    const currentWord = reviewList[currentReviewIndex]
    const progress = ((currentReviewIndex + 1) / reviewList.length) * 100

    return (
      <div className="flex flex-col h-full bg-gray-50">
        {/* 复习头部 */}
        <div className="bg-white border-b border-gray-200 p-4">
          <div className="flex items-center justify-between max-w-2xl mx-auto">
            <button
              onClick={() => setReviewMode(false)}
              className="text-gray-500 hover:text-gray-700"
            >
              ✕ 退出
            </button>
            <div className="flex-1 mx-4">
              <div className="h-2 bg-gray-200 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            <span className="text-sm text-gray-500">
              {currentReviewIndex + 1} / {reviewList.length}
            </span>
          </div>
        </div>

        {/* 复习卡片 */}
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-lg">
            {/* 单词正面 */}
            <div className="bg-white rounded-2xl shadow-lg p-8 mb-6 text-center">
              <h2 className="text-4xl font-bold text-gray-900 mb-3">{currentWord.word}</h2>
              {currentWord.phonetic && (
                <p className="text-lg text-gray-500 mb-4">{currentWord.phonetic}</p>
              )}

              {!showAnswer ? (
                <div className="mt-8">
                  <p className="text-gray-400 mb-6">先回忆一下这个单词的意思...</p>
                  <button
                    onClick={() => setShowAnswer(true)}
                    className="px-8 py-3 bg-primary text-white rounded-xl hover:bg-primary-hover text-lg font-medium"
                  >
                    显示答案
                  </button>
                </div>
              ) : (
                <div className="mt-6 animate-fade-in">
                  {currentWord.part_of_speech && (
                    <span className="inline-block px-3 py-1 text-sm bg-blue-100 text-blue-700 rounded-full mb-3">
                      {currentWord.part_of_speech}
                    </span>
                  )}
                  <p className="text-xl text-gray-800 mb-4">{currentWord.meaning_zh}</p>
                  {currentWord.example_en && (
                    <div className="bg-gray-50 rounded-lg p-4 mt-4 text-left">
                      <p className="text-gray-700 italic">{currentWord.example_en}</p>
                      {currentWord.example_zh && (
                        <p className="text-gray-500 text-sm mt-2">{currentWord.example_zh}</p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 评分按钮 */}
            {showAnswer && (
              <div className="grid grid-cols-4 gap-3">
                <button
                  onClick={() => submitReview(ReviewRating.AGAIN)}
                  className="py-3 bg-red-100 text-red-700 rounded-xl hover:bg-red-200 font-medium"
                >
                  <div className="text-lg mb-1">😵</div>
                  <div className="text-sm">忘记</div>
                </button>
                <button
                  onClick={() => submitReview(ReviewRating.HARD)}
                  className="py-3 bg-orange-100 text-orange-700 rounded-xl hover:bg-orange-200 font-medium"
                >
                  <div className="text-lg mb-1">😰</div>
                  <div className="text-sm">困难</div>
                </button>
                <button
                  onClick={() => submitReview(ReviewRating.GOOD)}
                  className="py-3 bg-blue-100 text-blue-700 rounded-xl hover:bg-blue-200 font-medium"
                >
                  <div className="text-lg mb-1">🙂</div>
                  <div className="text-sm">良好</div>
                </button>
                <button
                  onClick={() => submitReview(ReviewRating.EASY)}
                  className="py-3 bg-green-100 text-green-700 rounded-xl hover:bg-green-200 font-medium"
                >
                  <div className="text-lg mb-1">😎</div>
                  <div className="text-sm">简单</div>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full bg-gray-50">
      {/* 头部 */}
      <div className="bg-white border-b border-gray-200 p-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">生词本</h1>
              <p className="text-sm text-gray-500 mt-1">
                共 {stats.total} 个单词 · 已掌握 {stats.mastered} · 今日待复习 {stats.dueToday}
              </p>
            </div>
            <button
              onClick={startReview}
              disabled={stats.dueToday === 0}
              className="px-6 py-3 bg-primary text-white rounded-xl hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed font-medium flex items-center gap-2"
            >
              <span>📚</span>
              <span>开始复习</span>
              {stats.dueToday > 0 && (
                <span className="bg-white text-primary text-xs px-2 py-0.5 rounded-full">
                  {stats.dueToday}
                </span>
              )}
            </button>
          </div>

          {/* 搜索和筛选 */}
          <div className="flex items-center gap-3">
            <div className="flex-1 relative">
              <input
                type="text"
                placeholder="搜索单词或释义..."
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="w-full px-4 py-2 pl-10 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
            </div>
            <button
              onClick={handleSearch}
              className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
            >
              搜索
            </button>
          </div>

          {/* 标签页 */}
          <div className="flex items-center gap-1 mt-4">
            {(['all', 'due', 'mastered'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeTab === tab
                    ? 'bg-primary text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {tab === 'all' && '全部单词'}
                {tab === 'due' && `待复习 ${stats.dueToday > 0 ? `(${stats.dueToday})` : ''}`}
                {tab === 'mastered' && '已掌握'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 单词列表 */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="max-w-6xl mx-auto">
          {vocabulary.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-6xl mb-4">📖</div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">
                {activeTab === 'due' ? '没有待复习的单词' : activeTab === 'mastered' ? '还没有掌握的单词' : '生词本为空'}
              </h3>
              <p className="text-gray-500">
                {activeTab === 'due'
                  ? '先去学习模块阅读文章，右键点击单词添加到生词本吧'
                  : '在阅读文章时，右键点击单词即可添加到生词本'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {vocabulary.map((item) => (
                <div
                  key={item.id}
                  className="bg-white rounded-xl border border-gray-200 p-5 hover:shadow-md transition-shadow"
                >
                  {/* 单词头部 */}
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="text-xl font-bold text-gray-900">{item.word}</h3>
                      {item.phonetic && (
                        <span className="text-sm text-gray-500">{item.phonetic}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {(() => {
                        const stageLabel = getLearningStageLabel(item.learning_stage)
                        return (
                          <span className={`text-xs px-2 py-1 rounded-full ${stageLabel.color}`}>
                            {stageLabel.text}
                          </span>
                        )
                      })()}
                      {item.is_mastered === 1 && (
                        <span className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-full">
                          已掌握
                        </span>
                      )}
                      <button
                        onClick={() => handleDelete(item.id, item.word)}
                        className="text-gray-400 hover:text-red-500 text-sm"
                        title="删除"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>

                  {/* 词性和释义 */}
                  <div className="mb-3">
                    {item.part_of_speech && (
                      <span className="inline-block px-2 py-0.5 text-xs bg-blue-100 text-blue-700 rounded mb-2 mr-2">
                        {item.part_of_speech}
                      </span>
                    )}
                    <p className="text-gray-700">{item.meaning_zh}</p>
                  </div>

                  {/* 例句 */}
                  {item.example_en && (
                    <div className="bg-gray-50 rounded-lg p-3 mb-3">
                      <p className="text-sm text-gray-600 italic">{item.example_en}</p>
                      {item.example_zh && (
                        <p className="text-sm text-gray-500 mt-1">{item.example_zh}</p>
                      )}
                    </div>
                  )}

                  {/* 底部信息 */}
                  <div className="flex items-center justify-between pt-3 border-t border-gray-100">
                    <div className="flex items-center gap-2">
                      {/* 熟悉度指示器 */}
                      <div className="flex items-center gap-1">
                        {[1, 2, 3, 4, 5].map((level) => (
                          <div
                            key={level}
                            className={`w-2 h-2 rounded-full ${
                              level <= (item.familiarity_level || 0)
                                ? getFamiliarityColor(item.familiarity_level)
                                : 'bg-gray-200'
                            }`}
                          />
                        ))}
                      </div>
                      <span className="text-xs text-gray-400">
                        复习 {item.review_count} 次
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">
                      {getNextReviewText(item.next_review_at)}
                    </span>
                  </div>

                  {/* 来源 */}
                  {item.source && (
                    <div className="mt-2 text-xs text-gray-400">
                      来源: {item.source}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
