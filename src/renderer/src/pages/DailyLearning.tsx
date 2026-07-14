import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from '../stores/toastStore'

// 文章类型定义
interface Article {
  id: string
  title_en: string
  title_zh?: string
  content_en: string
  content_zh?: string
  summary_zh?: string
  source: string
  source_url?: string
  source_website?: string
  category: string
  difficulty: string
  vocabulary_json?: string
  is_read: boolean
  is_favorite: boolean
  created_at: string
}

// 生词类型定义
interface Vocabulary {
  id: string
  word: string
  phonetic?: string
  part_of_speech?: string
  meaning_zh: string
  example_en?: string
  example_zh?: string
  cefr_level?: string
  is_mastered: boolean
  learning_stage?: number
  next_review_at?: string
}

// 学习阶段标签映射
const STAGE_LABELS: Record<number, string> = { 0: '新词', 1: '学习中', 2: '复习中' }

// 相对时间格式化
function formatRelativeTime(dateStr: string | undefined): string {
  if (!dateStr) return ''
  const diff = new Date(dateStr).getTime() - Date.now()
  if (diff <= 0) return '现在'
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}分钟后`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时后`
  return `${Math.floor(hours / 24)}天后`
}

// 筛选类型
type DifficultyFilter = 'all' | 'cet4' | 'cet6' | 'graduate'
type StatusFilter = 'all' | 'unread' | 'read' | 'favorite'

export default function DailyLearning() {
  const [articles, setArticles] = useState<Article[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [visibleTranslations, setVisibleTranslations] = useState<Set<number>>(new Set())
  const [hoveredWord, setHoveredWord] = useState<string | null>(null)
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 })
  const [tooltipContent, setTooltipContent] = useState<Record<string, unknown> | null>(null)
  const [vocabulary, setVocabulary] = useState<Vocabulary[]>([])
  const [showVocabPanel, setShowVocabPanel] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; word: string } | null>(null)
  const [showGuide, setShowGuide] = useState(false)

  // 复习相关状态
  const [vocabTab, setVocabTab] = useState<'all' | 'review'>('all')
  const [reviewingWord, setReviewingWord] = useState<Vocabulary | null>(null)
  const [dueWords, setDueWords] = useState<Vocabulary[]>([])

  // 筛选状态
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // 单词缓存：避免每次悬停都发送IPC请求
  const wordCacheRef = useRef<Map<string, Record<string, unknown> | null>>(new Map())

  // 加载文章
  const loadArticles = useCallback(async () => {
    if (!window.electronAPI?.article) {
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      const data = await window.electronAPI.article.getAll()
      const articleList = Array.isArray(data) ? data : []
      if (articleList.length > 0) {
        setArticles(articleList as unknown as Article[])
        preloadWordCache(articleList[0] as unknown as Article)
      }
    } catch (error) {
      console.error('加载文章失败:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // 加载生词本
  const loadVocabulary = useCallback(async () => {
    if (!window.electronAPI?.vocabulary) return
    try {
      const data = await window.electronAPI.vocabulary.getAll()
      const vocabList = Array.isArray(data) ? data : []
      setVocabulary(vocabList as unknown as Vocabulary[])
    } catch (error) {
      console.error('加载生词本失败:', error)
    }
  }, [])

  // 加载待复习单词
  const loadDueWords = useCallback(async () => {
    if (!window.electronAPI?.vocabulary) return
    try {
      const data = await window.electronAPI.vocabulary.getDueForReview()
      const words = Array.isArray(data) ? data : []
      setDueWords(words as unknown as Vocabulary[])
    } catch (error) {
      console.error('加载待复习单词失败:', error)
    }
  }, [])

  useEffect(() => {
    loadArticles()
    loadVocabulary()
    loadDueWords()
    // 检查是否首次使用右键添加功能
    const hasSeenGuide = localStorage.getItem('vocab-rightclick-guide')
    if (!hasSeenGuide) {
      const timer = setTimeout(() => setShowGuide(true), 1500)
      return () => clearTimeout(timer)
    }
  }, [loadArticles, loadVocabulary, loadDueWords])

  // 获取 RSS 最新文章
  const handleFetchRss = useCallback(async () => {
    setLoading(true)
    try {
      const data = await window.electronAPI.article.fetchRss()
      const savedArticles = Array.isArray(data) ? data : []
      if (savedArticles.length > 0) {
        await loadArticles()
        toast.success(`获取到 ${savedArticles.length} 篇新文章`)
      } else {
        toast.info('没有新文章')
      }
    } catch (error) {
      console.error('获取RSS失败:', error)
      toast.error('获取文章失败')
    } finally {
      setLoading(false)
    }
  }, [loadArticles])

  // 预加载文章单词到缓存（只缓存词典有收录的单词，上限200）
  const preloadWordCache = useCallback(async (article: Article) => {
    const words = article.content_en.match(/\b[a-zA-Z]{3,}\b/g) || []
    const uniqueWords = [...new Set(words.map(w => w.toLowerCase()))]
    if (uniqueWords.length === 0) return

    try {
      const batchResult = await window.electronAPI.dictionary.lookupBatch(uniqueWords)
      const cache = wordCacheRef.current
      cache.clear()
      let count = 0
      if (batchResult && typeof batchResult === 'object') {
        for (const [word, entry] of Object.entries(batchResult)) {
          // 只缓存词典有收录的单词
          if (entry && count < 200) {
            cache.set(word, entry as Record<string, unknown>)
            count++
          }
        }
      }
    } catch (error) {
      console.error('预加载单词缓存失败:', error)
    }
  }, [])

  const handleNext = () => {
    if (currentIndex < articles.length - 1) {
      const nextIdx = currentIndex + 1
      setCurrentIndex(nextIdx)
      setVisibleTranslations(new Set())
      preloadWordCache(articles[nextIdx])
    }
  }

  const handlePrev = () => {
    if (currentIndex > 0) {
      setCurrentIndex(prev => prev - 1)
      setVisibleTranslations(new Set())
    }
  }

  const toggleTranslation = (index: number) => {
    setVisibleTranslations(prev => {
      const next = new Set(prev)
      if (next.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  const handleToggleFavorite = async () => {
    const article = articles[currentIndex]
    if (!article) return

    try {
      const isFav = await window.electronAPI.article.toggleFavorite(article.id)
      if (typeof isFav === 'boolean') {
        setArticles(prev => prev.map((a, i) =>
          i === currentIndex ? { ...a, is_favorite: isFav } : a
        ))
        toast.success(isFav ? '已收藏' : '已取消收藏')
      }
    } catch (error) {
      console.error('收藏操作失败:', error)
    }
  }

  const handleMarkAsRead = async () => {
    const article = articles[currentIndex]
    if (!article || article.is_read) return

    try {
      await window.electronAPI.article.markAsRead(article.id)
      setArticles(prev => prev.map((a, i) =>
        i === currentIndex ? { ...a, is_read: true } : a
      ))
    } catch (error) {
      console.error('标记已读失败:', error)
    }
  }

  // 鼠标悬停显示单词释义
  const handleWordHover = useCallback((word: string, event: React.MouseEvent) => {
    const cleanWord = word.replace(/[^a-zA-Z]/g, '').toLowerCase()
    if (cleanWord.length < 3) {
      setHoveredWord(null)
      return
    }

    setHoveredWord(cleanWord)
    setTooltipPosition({ x: event.clientX, y: event.clientY - 10 })

    const cache = wordCacheRef.current
    if (cache.has(cleanWord)) {
      setTooltipContent(cache.get(cleanWord) ?? null)
      return
    }

    window.electronAPI.dictionary.lookup(cleanWord).then(result => {
      cache.set(cleanWord, result)
      setTooltipContent(result)
    }).catch(error => {
      console.error('词典查询失败:', error)
      cache.set(cleanWord, null)
    })
  }, [])

  const handleWordLeave = useCallback(() => {
    setHoveredWord(null)
    setTooltipContent(null)
  }, [])

  // 右键菜单（带边界检测）
  const handleWordContextMenu = useCallback((word: string, event: React.MouseEvent) => {
    event.preventDefault()
    const cleanWord = word.replace(/[^a-zA-Z]/g, '').toLowerCase()
    if (cleanWord.length < 3) return

    const menuWidth = 180
    const menuHeight = 120
    let x = event.clientX
    let y = event.clientY

    // 边界检测：防止菜单超出屏幕
    if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth
    if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight
    if (x < 0) x = 0
    if (y < 0) y = 0

    setContextMenu({ x, y, word: cleanWord })
  }, [])

  const closeContextMenu = useCallback(() => {
    setContextMenu(null)
  }, [])

  const dismissGuide = useCallback(() => {
    setShowGuide(false)
    localStorage.setItem('vocab-rightclick-guide', 'true')
  }, [])

  // 从右键菜单添加到生词本
  const handleAddToVocabularyFromMenu = async () => {
    if (!contextMenu) return

    try {
      const result = await window.electronAPI.vocabulary.createFromLookup(
        contextMenu.word,
        articles[currentIndex]?.title_en || '手动添加'
      )
      if (result) {
        toast.success(`"${contextMenu.word}" 已添加到生词本`)
        await loadVocabulary()
        await loadDueWords()
      } else {
        toast.info(`"${contextMenu.word}" 已在生词本中`)
      }
    } catch (error) {
      console.error('添加生词失败:', error)
      toast.error('添加生词失败：' + (error instanceof Error ? error.message : String(error)))
    }
    setContextMenu(null)
  }

  // 从悬停提示框添加到生词本
  const handleAddToVocabulary = async () => {
    if (!hoveredWord) return

    try {
      const result = await window.electronAPI.vocabulary.createFromLookup(
        hoveredWord,
        articles[currentIndex]?.title_en || '手动添加'
      )
      if (result) {
        toast.success(`"${hoveredWord}" 已添加到生词本`)
        await loadVocabulary()
        await loadDueWords()
      } else {
        toast.info(`"${hoveredWord}" 已在生词本中`)
      }
    } catch (error) {
      console.error('添加生词失败:', error)
      toast.error('添加生词失败')
    }
  }

  // 复习单词
  const handleReviewWord = async (wordId: string, quality: number) => {
    try {
      await window.electronAPI.vocabulary.updateReviewData(wordId, { quality })
      toast.success(quality >= 3 ? '记住了！' : '继续加油')
      setReviewingWord(null)
      await loadVocabulary()
      await loadDueWords()
    } catch (error) {
      console.error('复习失败:', error)
      toast.error('复习失败')
    }
  }

  // 标记生词已掌握
  const handleMarkMastered = async (wordId: string) => {
    try {
      await window.electronAPI.vocabulary.updateReviewData(wordId, { quality: 5, isMastered: true })
      toast.success('已标记为掌握')
      await loadVocabulary()
      await loadDueWords()
    } catch (error) {
      console.error('标记掌握失败:', error)
    }
  }

  // 删除生词
  const handleDeleteVocab = async (wordId: string) => {
    try {
      await window.electronAPI.vocabulary.delete(wordId)
      toast.success('已删除')
      await loadVocabulary()
      await loadDueWords()
    } catch (error) {
      console.error('删除生词失败:', error)
    }
  }

  // 渲染带悬停功能的英文文本
  const renderEnglishText = (text: string) => {
    const words = text.split(/(\s+)/)
    return words.map((word, index) => {
      const cleanWord = word.replace(/[^a-zA-Z]/g, '')
      if (cleanWord.length >= 3) {
        return (
          <span
            key={index}
            className="cursor-pointer hover:bg-emerald-100 hover:underline decoration-dotted select-text"
            onMouseEnter={(e) => handleWordHover(word, e)}
            onMouseLeave={handleWordLeave}
            onContextMenu={(e) => handleWordContextMenu(word, e)}
          >
            {word}
          </span>
        )
      }
      return <span key={index}>{word}</span>
    })
  }

  // 筛选文章
  const filteredArticles = articles.filter(a => {
    if (difficultyFilter !== 'all' && a.difficulty !== difficultyFilter) return false
    if (statusFilter === 'unread' && a.is_read) return false
    if (statusFilter === 'read' && !a.is_read) return false
    if (statusFilter === 'favorite' && !a.is_favorite) return false
    return true
  })

  // 使用筛选后的文章列表
  const displayArticles = filteredArticles.length > 0 ? filteredArticles : articles
  const displayIndex = displayArticles.findIndex(a => a.id === (articles[currentIndex]?.id))
  const currentArticle = displayIndex >= 0 ? displayArticles[displayIndex] : displayArticles[0]

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600"></div>
      </div>
    )
  }

  // 空状态引导页
  if (articles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8">
        <div className="text-6xl mb-4">📖</div>
        <h2 className="text-2xl font-bold text-gray-900 mb-2">开始每日英语学习</h2>
        <p className="text-gray-600 mb-2 text-center max-w-md">
          从心理学、认知科学、自我提升等领域的优质英文文章中学习
        </p>
        <p className="text-gray-500 mb-6 text-sm">
          支持四级 / 六级 / 考研难度，悬停查词，一键收藏生词
        </p>
        <button
          onClick={handleFetchRss}
          className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium"
        >
          获取最新文章
        </button>
      </div>
    )
  }

  const paragraphs = currentArticle.content_en.split(/\n\s*\n/).filter(p => p.trim())
  const zhParagraphs = (currentArticle.content_zh || '').split(/\n\s*\n/).filter(p => p.trim())

  return (
    <div className="flex h-full bg-emerald-50/30">
      {/* 主内容区 */}
      <div className="flex-1 overflow-y-auto">
        {/* 头部导航 */}
        <div className="sticky top-0 bg-white border-b border-emerald-200 p-4 z-10">
          <div className="flex items-center justify-between max-w-6xl mx-auto">
            <div>
              <h1 className="text-xl font-bold text-gray-900">每日学习</h1>
              <div className="flex items-center gap-3 mt-1">
                <span className="text-sm text-gray-500">
                  {currentArticle.source} · {currentArticle.difficulty === 'cet4' ? '四级' : currentArticle.difficulty === 'cet6' ? '六级' : '考研'}
                </span>
                {currentArticle.source_url && (
                  <a
                    href={currentArticle.source_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-emerald-600 hover:text-emerald-800 hover:underline"
                  >
                    📄 原文链接
                  </a>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-500">
                {displayIndex + 1} / {displayArticles.length}
              </span>
              <button
                onClick={() => setShowVocabPanel(!showVocabPanel)}
                className="px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 text-sm border border-emerald-200"
              >
                📝 生词本
              </button>
            </div>
          </div>

          {/* 筛选栏 */}
          <div className="flex items-center gap-4 mt-3 max-w-6xl mx-auto">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">难度:</span>
              {(['all', 'cet4', 'cet6', 'graduate'] as DifficultyFilter[]).map(d => (
                <button
                  key={d}
                  onClick={() => setDifficultyFilter(d)}
                  className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                    difficultyFilter === d
                      ? 'bg-emerald-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {d === 'all' ? '全部' : d === 'cet4' ? '四级' : d === 'cet6' ? '六级' : '考研'}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">状态:</span>
              {(['all', 'unread', 'read', 'favorite'] as StatusFilter[]).map(s => (
                <button
                  key={s}
                  onClick={() => setStatusFilter(s)}
                  className={`px-2.5 py-1 text-xs rounded-full transition-colors ${
                    statusFilter === s
                      ? 'bg-emerald-600 text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {s === 'all' ? '全部' : s === 'unread' ? '未读' : s === 'read' ? '已读' : '收藏'}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 文章内容 - 左右对照 */}
        <div className="max-w-6xl mx-auto p-6">
          {/* 标题区域 */}
          <div className="bg-white rounded-xl shadow-sm p-6 mb-6 border border-emerald-100">
            <div className="grid grid-cols-2 gap-8">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2 font-sans">
                  {currentArticle.title_en}
                </h2>
                {currentArticle.summary_zh && (
                  <p className="text-sm text-gray-500 italic">
                    Summary: {currentArticle.summary_zh.slice(0, 50)}...
                  </p>
                )}
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2 font-sans">
                  {currentArticle.title_zh || '翻译加载中...'}
                </h2>
                {currentArticle.summary_zh && (
                  <p className="text-sm text-gray-600">
                    摘要：{currentArticle.summary_zh}
                  </p>
                )}
              </div>
            </div>
          </div>

          {/* 文章段落 - 左右对照 */}
          <div className="bg-white rounded-xl shadow-sm overflow-hidden border border-emerald-100">
            {paragraphs.map((para, index) => {
              const isTranslationVisible = visibleTranslations.has(index)
              return (
                <div
                  key={index}
                  className={`grid grid-cols-2 gap-0 ${index % 2 === 0 ? 'bg-white' : 'bg-emerald-50/50'} border-b border-emerald-100 last:border-b-0`}
                >
                  {/* 英文段落 */}
                  <div
                    className={`p-6 border-r border-emerald-100 cursor-pointer transition-colors ${isTranslationVisible ? 'bg-emerald-50' : 'hover:bg-emerald-50'}`}
                    onClick={() => toggleTranslation(index)}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-xs text-gray-400 mt-1 select-none">{index + 1}</span>
                      <p className="text-gray-900 leading-relaxed font-sans text-[15px] flex-1">
                        {renderEnglishText(para)}
                      </p>
                    </div>
                    {!isTranslationVisible && (
                      <p className="text-xs text-emerald-600 mt-2 ml-6 opacity-60">点击显示翻译 →</p>
                    )}
                  </div>
                  {/* 中文段落 */}
                  <div className="p-6">
                    {isTranslationVisible && zhParagraphs[index] ? (
                      <p className="text-gray-700 leading-relaxed text-[15px] font-sans">
                        {zhParagraphs[index]}
                      </p>
                    ) : (
                      <p className="text-gray-300 italic text-sm">
                        点击左侧英文查看翻译
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* 操作按钮 */}
          <div className="flex items-center justify-between mt-6">
            <button
              onClick={handlePrev}
              disabled={displayIndex <= 0}
              className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              ← 上一篇
            </button>
            <div className="flex items-center gap-3">
              <button
                onClick={handleToggleFavorite}
                className={`px-4 py-2 rounded-lg ${
                  currentArticle.is_favorite
                    ? 'bg-red-100 text-red-700 hover:bg-red-200'
                    : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                }`}
              >
                {currentArticle.is_favorite ? '❤️ 已收藏' : '🤍 收藏'}
              </button>
              {!currentArticle.is_read && (
                <button
                  onClick={handleMarkAsRead}
                  className="px-4 py-2 bg-emerald-100 text-emerald-700 rounded-lg hover:bg-emerald-200"
                >
                  ✓ 标记已读
                </button>
              )}
              {currentArticle.source_url && (
                <a
                  href={currentArticle.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50"
                >
                  🔗 查看原文
                </a>
              )}
            </div>
            <button
              onClick={handleNext}
              disabled={displayIndex >= displayArticles.length - 1}
              className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              下一篇 →
            </button>
          </div>
        </div>
      </div>

      {/* 生词本侧边栏 */}
      {showVocabPanel && (
        <div className="w-80 bg-white border-l border-emerald-200 overflow-y-auto flex flex-col">
          <div className="p-4 border-b border-emerald-200">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-bold text-gray-900">📝 生词本</h3>
              <button
                onClick={() => { setShowVocabPanel(false); setReviewingWord(null) }}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            {/* 统计 */}
            <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
              <span>总词数: {vocabulary.length}</span>
              <span>待复习: {dueWords.length}</span>
            </div>
            {/* Tab 切换 */}
            <div className="flex border-b border-gray-200">
              <button
                onClick={() => { setVocabTab('all'); setReviewingWord(null) }}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  vocabTab === 'all'
                    ? 'text-emerald-600 border-b-2 border-emerald-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                全部 ({vocabulary.length})
              </button>
              <button
                onClick={() => { setVocabTab('review'); setReviewingWord(null) }}
                className={`flex-1 py-2 text-sm font-medium transition-colors ${
                  vocabTab === 'review'
                    ? 'text-emerald-600 border-b-2 border-emerald-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                待复习 ({dueWords.length})
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {vocabTab === 'review' ? (
              // 复习模式
              reviewingWord ? (
                <div>
                  <div className="text-center mb-6">
                    <div className="text-2xl font-bold text-gray-900 mb-1">{reviewingWord.word}</div>
                    {reviewingWord.phonetic && <div className="text-sm text-gray-500">{reviewingWord.phonetic}</div>}
                    {reviewingWord.part_of_speech && (
                      <span className="inline-block mt-1 px-2 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded">
                        {reviewingWord.part_of_speech}
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    <button
                      onClick={() => handleReviewWord(reviewingWord.id, 1)}
                      className="w-full py-3 bg-red-50 text-red-700 rounded-lg hover:bg-red-100 font-medium border border-red-200"
                    >
                      忘记
                    </button>
                    <button
                      onClick={() => handleReviewWord(reviewingWord.id, 3)}
                      className="w-full py-3 bg-amber-50 text-amber-700 rounded-lg hover:bg-amber-100 font-medium border border-amber-200"
                    >
                      模糊
                    </button>
                    <button
                      onClick={() => handleReviewWord(reviewingWord.id, 4)}
                      className="w-full py-3 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 font-medium border border-emerald-200"
                    >
                      认识
                    </button>
                  </div>
                  <button
                    onClick={() => setReviewingWord(null)}
                    className="w-full mt-3 py-2 text-sm text-gray-500 hover:text-gray-700"
                  >
                    返回单词列表
                  </button>
                </div>
              ) : dueWords.length > 0 ? (
                <div className="text-center py-8">
                  <div className="text-4xl mb-3"></div>
                  <p className="text-gray-600 mb-4">今日有 {dueWords.length} 个单词待复习</p>
                  <button
                    onClick={() => setReviewingWord(dueWords[0])}
                    className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium"
                  >
                    开始复习
                  </button>
                </div>
              ) : (
                <p className="text-gray-500 text-sm text-center py-8">今日暂无待复习单词 🎉</p>
              )
            ) : (
              // 全部生词列表
              vocabulary.length === 0 ? (
                <p className="text-gray-500 text-sm text-center py-8">
                  暂无生词，悬停或右键点击英文单词可添加
                </p>
              ) : (
                <div className="space-y-3">
                  {vocabulary.map(vocab => (
                    <div
                      key={vocab.id}
                      className="bg-emerald-50/50 rounded-lg p-3 border border-emerald-100"
                      onContextMenu={(e) => {
                        e.preventDefault()
                        setContextMenu({ x: e.clientX, y: e.clientY, word: vocab.word })
                      }}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-bold text-gray-900">{vocab.word}</span>
                        <div className="flex items-center gap-1">
                          {vocab.cefr_level && (
                            <span className="text-xs bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">
                              {vocab.cefr_level}
                            </span>
                          )}
                          {vocab.learning_stage !== undefined && (
                            <span className={`text-xs px-1.5 py-0.5 rounded ${
                              vocab.learning_stage === 0
                                ? 'bg-blue-100 text-blue-700'
                                : vocab.learning_stage === 1
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-emerald-100 text-emerald-700'
                            }`}>
                              {STAGE_LABELS[vocab.learning_stage] || '新词'}
                            </span>
                          )}
                        </div>
                      </div>
                      {vocab.phonetic && (
                        <span className="text-sm text-gray-500">{vocab.phonetic}</span>
                      )}
                      <p className="text-sm text-gray-700 mt-1">{vocab.meaning_zh}</p>
                      {vocab.next_review_at && (
                        <p className="text-xs text-gray-400 mt-1">
                          下次复习: {formatRelativeTime(vocab.next_review_at)}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              )
            )}
          </div>
        </div>
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <>
          <div className="fixed inset-0 z-50" onClick={closeContextMenu} />
          <div
            className="fixed bg-white border border-gray-200 rounded-lg shadow-xl z-50 py-1 min-w-[180px]"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <div className="px-3 py-2 border-b border-gray-100">
              <span className="font-bold text-gray-900">{contextMenu.word}</span>
            </div>
            <button
              onClick={handleAddToVocabularyFromMenu}
              className="w-full text-left px-3 py-2 hover:bg-emerald-50 flex items-center gap-2 text-sm text-emerald-700"
            >
              <span>+</span>
              <span>添加到生词本</span>
            </button>
            <button
              onClick={() => {
                navigator.clipboard.writeText(contextMenu.word)
                toast.success('已复制到剪贴板')
                setContextMenu(null)
              }}
              className="w-full text-left px-3 py-2 hover:bg-gray-100 flex items-center gap-2 text-sm"
            >
              <span>📋</span>
              <span>复制单词</span>
            </button>
            {/* 生词本中的单词额外显示删除和标记掌握 */}
            {vocabTab === 'all' && vocabulary.some(v => v.word === contextMenu.word) && (
              <>
                <div className="border-t border-gray-100 my-1" />
                <button
                  onClick={() => {
                    const vocab = vocabulary.find(v => v.word === contextMenu.word)
                    if (vocab) handleMarkMastered(vocab.id)
                    setContextMenu(null)
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-emerald-50 flex items-center gap-2 text-sm text-emerald-700"
                >
                  <span>✓</span>
                  <span>标记已掌握</span>
                </button>
                <button
                  onClick={() => {
                    const vocab = vocabulary.find(v => v.word === contextMenu.word)
                    if (vocab) handleDeleteVocab(vocab.id)
                    setContextMenu(null)
                  }}
                  className="w-full text-left px-3 py-2 hover:bg-red-50 flex items-center gap-2 text-sm text-red-700"
                >
                  <span>🗑</span>
                  <span>删除</span>
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* 首次使用引导 */}
      {showGuide && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md mx-4 p-6 animate-fade-in">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 bg-emerald-100 rounded-full flex items-center justify-center text-lg">
                💡
              </div>
              <h3 className="text-lg font-bold text-gray-900">新功能：右键添加生词</h3>
            </div>
            <p className="text-gray-600 mb-4 leading-relaxed">
              在阅读文章时，<strong>右键点击</strong>任意英文单词，即可快速添加到生词本。
              无需等待悬停提示，一键收藏生词。
            </p>
            <div className="bg-emerald-50 rounded-lg p-3 mb-4 flex items-center gap-3 border border-emerald-100">
              <span className="text-2xl">🖱️</span>
              <div className="text-sm text-gray-600">
                <div className="font-medium text-gray-800">操作方式</div>
                <div>右键点击单词 → 选择"添加到生词本"</div>
              </div>
            </div>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={dismissGuide}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700"
              >
                稍后再说
              </button>
              <button
                onClick={dismissGuide}
                className="px-5 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 text-sm font-medium"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 单词悬停提示框 - 可交互 */}
      {hoveredWord && (
        <div
          className="fixed bg-white border border-emerald-200 rounded-xl shadow-xl z-50 max-w-sm overflow-hidden"
          style={{
            left: Math.min(tooltipPosition.x, window.innerWidth - 320),
            top: Math.max(tooltipPosition.y - 120, 10),
          }}
        >
          {tooltipContent ? (
            <div className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg font-bold text-gray-900">{hoveredWord}</span>
                {String(tooltipContent.phonetic || '') && (
                  <span className="text-sm text-gray-500">{String(tooltipContent.phonetic || '')}</span>
                )}
              </div>
              {String(tooltipContent.pos || '') && (
                <span className="inline-block px-2 py-0.5 text-xs bg-emerald-100 text-emerald-700 rounded mb-2">
                  {String(tooltipContent.pos || '')}
                </span>
              )}
              <p className="text-sm text-gray-700 leading-relaxed">
                {String(tooltipContent.translation || '')}
              </p>
              {String(tooltipContent.tag || '') && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {String(tooltipContent.tag || '').split(' ').map((tag: string) => (
                    <span key={tag} className="px-1.5 py-0.5 text-xs bg-amber-100 text-amber-700 rounded">
                      {tag.toUpperCase()}
                    </span>
                  ))}
                </div>
              )}
              {Number(tooltipContent.collins || 0) > 0 && (
                <div className="mt-2 text-xs text-gray-500">
                  柯林斯星级: {'★'.repeat(Number(tooltipContent.collins || 0))}{'☆'.repeat(5 - Number(tooltipContent.collins || 0))}
                </div>
              )}
              {/* 添加到生词本按钮 */}
              <button
                onClick={handleAddToVocabulary}
                className="mt-3 w-full py-1.5 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 text-xs font-medium border border-emerald-200"
              >
                + 添加到生词本
              </button>
            </div>
          ) : (
            <div className="p-4">
              <div className="font-bold text-gray-900 mb-1">{hoveredWord}</div>
              <div className="text-sm text-gray-500">本地词典未收录</div>
              <button
                onClick={handleAddToVocabulary}
                className="mt-3 w-full py-1.5 bg-emerald-50 text-emerald-700 rounded-lg hover:bg-emerald-100 text-xs font-medium border border-emerald-200"
              >
                + 添加到生词本
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
