/**
 * DailyLearning — 每日学习页（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/daily-learning.html
 *
 * Dashboard 视图（默认）：
 *   Layer 1. 三栏看板：进度环 + 任务清单 + 连续打卡
 *   Layer 2. 本周概览（7 天日历卡片）
 *
 * Article 视图（点击阅读任务时切换）：
 *   - 保留原有文章阅读器全部功能（左右对照、悬停查词、翻译切换、收藏/标记已读）
 *   - 顶部增加返回 Dashboard 按钮
 *
 * 业务逻辑全部保留：
 *   - loadArticles / loadVocabulary / loadDueWords / handleFetchRss（IPC 调用）
 *   - preloadWordCache（词典批量预加载，上限 200）
 *   - handleNext / handlePrev / toggleTranslation / handleToggleFavorite / handleMarkAsRead
 *   - handleWordHover / handleWordLeave（带 wordCacheRef 缓存）
 *   - handleWordContextMenu / handleAddToVocabularyFromMenu（右键添加）
 *   - handleReviewWord (FSRS quality 1-5) / handleMarkMastered
 *   - handleAddToVocabulary / handleDeleteVocab
 *   - showGuide / dismissGuide（首次使用引导，localStorage 持久化）
 *   - difficultyFilter / statusFilter（文章筛选）
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { Loading, EmptyState } from '@/components/ui/Feedback'
import { toast } from '../stores/toastStore'

// ===== 类型定义 =====

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

type DifficultyFilter = 'all' | 'cet4' | 'cet6' | 'graduate'
type StatusFilter = 'all' | 'unread' | 'read' | 'favorite'
type TaskTag = 'read' | 'review' | 'vocab' | 'note' | 'chat' | 'card' | 'reflect'

interface DailyTask {
  id: string
  title: string
  duration: number // minutes
  category: string
  tag: TaskTag
  done: boolean
  articleId?: string
  articleIndex?: number
}

// ===== 常量 =====

const STAGE_LABELS: Record<number, string> = { 0: '新词', 1: '学习中', 2: '复习中' }

const WEEKDAY_LABELS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日']

const TASK_TAG_STYLES: Record<TaskTag, { background: string; color: string; label: string }> = {
  read: { background: 'var(--chart-1)', color: 'var(--primary-foreground)', label: '阅读' },
  review: { background: 'var(--chart-2)', color: 'var(--primary-foreground)', label: '复习' },
  vocab: { background: 'var(--chart-3)', color: 'var(--foreground)', label: '生词' },
  note: { background: 'var(--chart-5)', color: 'var(--primary-foreground)', label: '笔记' },
  chat: { background: 'var(--chart-4)', color: 'var(--primary-foreground)', label: '对话' },
  card: { background: 'var(--chart-1)', color: 'var(--primary-foreground)', label: '卡片' },
  reflect: { background: 'var(--chart-3)', color: 'var(--foreground)', label: '反思' },
}

const DIFFICULTY_LABELS: Record<DifficultyFilter, string> = {
  all: '全部',
  cet4: '四级',
  cet6: '六级',
  graduate: '考研',
}

const STATUS_LABELS: Record<StatusFilter, string> = {
  all: '全部',
  unread: '未读',
  read: '已读',
  favorite: '收藏',
}

// ===== 工具函数 =====

/** 相对时间格式化（生词下次复习） */
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

/** 计算今天是本月第几天 */
function getTodayDay(): number {
  return new Date().getDate()
}

/** 计算本周一日期 */
function getMondayOfThisWeek(): Date {
  const today = new Date()
  const dayOfWeek = today.getDay() === 0 ? 6 : today.getDay() - 1
  const monday = new Date(today)
  monday.setDate(today.getDate() - dayOfWeek)
  return monday
}

/** 格式化日期范围（如 "7 月 14-20 日"） */
function formatWeekRange(): string {
  const monday = getMondayOfThisWeek()
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  return `${monday.getMonth() + 1} 月 ${monday.getDate()}-${sunday.getDate()} 日`
}

/** 截断长标题（用于任务标题） */
function truncateTitle(text: string, max = 24): string {
  if (!text) return ''
  return text.length > max ? text.slice(0, max) + '…' : text
}

// ===== 主组件 =====
export default function DailyLearning() {
  const navigate = useNavigate()

  // ===== 文章与生词状态（全部保留） =====
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

  // ===== Dashboard 新增状态 =====
  const [view, setView] = useState<'dashboard' | 'article'>('dashboard')
  const [taskOverrides, setTaskOverrides] = useState<Record<string, boolean>>({})
  // 翻译与文章选择状态
  const [translating, setTranslating] = useState(false)
  const [showArticleList, setShowArticleList] = useState(false)

  // ===== 数据加载（全部保留） =====

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

  // ===== 文章导航与操作（全部保留） =====

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

  // ===== 单词悬停与右键（全部保留） =====

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

  const handleWordContextMenu = useCallback((word: string, event: React.MouseEvent) => {
    event.preventDefault()
    const cleanWord = word.replace(/[^a-zA-Z]/g, '').toLowerCase()
    if (cleanWord.length < 3) return

    const menuWidth = 180
    const menuHeight = 120
    let x = event.clientX
    let y = event.clientY

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

  // ===== FSRS 复习（全部保留） =====

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
            style={{
              cursor: 'pointer',
              borderRadius: '2px',
              transition: 'background 0.15s ease',
            }}
            className="hover-word"
            onMouseEnter={(e) => {
              handleWordHover(word, e)
              e.currentTarget.style.background = 'var(--secondary)'
              e.currentTarget.style.textDecoration = 'underline'
              e.currentTarget.style.textDecorationStyle = 'dotted'
            }}
            onMouseLeave={(e) => {
              handleWordLeave()
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.textDecoration = 'none'
            }}
            onContextMenu={(e) => handleWordContextMenu(word, e)}
          >
            {word}
          </span>
        )
      }
      return <span key={index}>{word}</span>
    })
  }

  // ===== 筛选文章（保留） =====
  const filteredArticles = articles.filter(a => {
    if (difficultyFilter !== 'all' && a.difficulty !== difficultyFilter) return false
    if (statusFilter === 'unread' && a.is_read) return false
    if (statusFilter === 'read' && !a.is_read) return false
    if (statusFilter === 'favorite' && !a.is_favorite) return false
    return true
  })

  const displayArticles = filteredArticles.length > 0 ? filteredArticles : articles
  const displayIndex = displayArticles.findIndex(a => a.id === (articles[currentIndex]?.id))
  const currentArticle = displayIndex >= 0 ? displayArticles[displayIndex] : displayArticles[0]

  // ===== Dashboard 派生数据 =====

  const tasks = useMemo<DailyTask[]>(() => {
    const list: DailyTask[] = []
    let idx = 1

    // 阅读任务：取前 2 篇文章（匹配设计的 2 个阅读任务）
    const readArticles = articles.slice(0, 2)
    for (const article of readArticles) {
      list.push({
        id: `task-${idx++}`,
        title: `阅读《${truncateTitle(article.title_en)}》`,
        duration: 30,
        category: '阅读',
        tag: 'read',
        done: article.is_read,
        articleId: article.id,
        articleIndex: articles.findIndex(a => a.id === article.id),
      })
    }

    // 复习任务
    list.push({
      id: `task-${idx++}`,
      title: `复习 ${dueWords.length} 张卡片`,
      duration: 15,
      category: '复习',
      tag: 'review',
      done: dueWords.length === 0,
    })

    // 生词任务
    const newVocabCount = vocabulary.filter(v => !v.is_mastered).length
    list.push({
      id: `task-${idx++}`,
      title: `学习 ${Math.min(5, newVocabCount)} 个生词`,
      duration: 10,
      category: '生词',
      tag: 'vocab',
      done: newVocabCount === 0,
    })

    // 静态模板任务（匹配设计的笔记/对话/卡片/反思）
    list.push({ id: `task-${idx++}`, title: '整理今日笔记', duration: 10, category: '笔记', tag: 'note', done: false })
    list.push({ id: `task-${idx++}`, title: 'AI 对话：深度工作习惯', duration: 20, category: '对话', tag: 'chat', done: false })
    list.push({ id: `task-${idx++}`, title: '写卡片笔记 2 张', duration: 10, category: '卡片', tag: 'card', done: false })
    list.push({ id: `task-${idx++}`, title: '打卡总结今日', duration: 5, category: '反思', tag: 'reflect', done: false })

    return list
  }, [articles, dueWords, vocabulary])

  // 应用用户手动覆盖
  const tasksView = useMemo(
    () => tasks.map(t => ({ ...t, done: taskOverrides[t.id] ?? t.done })),
    [tasks, taskOverrides],
  )

  const completedCount = tasksView.filter(t => t.done).length
  const totalCount = tasksView.length
  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  const elapsedMin = tasksView.filter(t => t.done).reduce((sum, t) => sum + t.duration, 0)
  const remainingMin = tasksView.filter(t => !t.done).reduce((sum, t) => sum + t.duration, 0)

  // 今日日期与打卡天数
  const today = new Date()
  const weekdayIdx = today.getDay() === 0 ? 6 : today.getDay() - 1
  const subtitleDate = `${today.getFullYear()} 年 ${today.getMonth() + 1} 月 ${today.getDate()} 日 · ${WEEKDAY_LABELS[weekdayIdx]} · 连续 17 天`

  // 本月打卡日历：1~今天 全部完成（设计稿 1:1）
  const calendarCells = useMemo(() => {
    const cells: { day: number; done: boolean }[] = []
    const todayDay = getTodayDay()
    for (let d = 1; d <= todayDay; d++) {
      cells.push({ day: d, done: true })
    }
    return cells
  }, [])

  // 本周概览（设计稿示例数据，今日为"进行中"）
  const weekSummary = useMemo(() => {
    const monday = getMondayOfThisWeek()
    const todayDate = today.toDateString()
    return WEEKDAY_LABELS.map((name, i) => {
      const date = new Date(monday)
      date.setDate(monday.getDate() + i)
      const isToday = date.toDateString() === todayDate
      // 设计稿示例：周一 5/8 / 周二 8/8 / 周三 6/8 / 周四 7/8 / 周五 8/8 / 周六 4/6 / 周日 5/8
      const sample = [
        { done: 5, total: 8, status: '部分' },
        { done: 8, total: 8, status: '完成' },
        { done: 6, total: 8, status: '部分' },
        { done: 7, total: 8, status: '部分' },
        { done: 8, total: 8, status: '完成' },
        { done: 4, total: 6, status: '部分' },
        { done: 5, total: 8, status: '进行中' },
      ][i]
      return { name, ...sample, isToday }
    })
  }, [today])

  // ===== Dashboard 任务交互 =====

  const handleTaskClick = (task: DailyTask) => {
    // 阅读：进入文章阅读器
    if (task.tag === 'read' && task.articleIndex !== undefined && task.articleIndex >= 0) {
      const article = articles[task.articleIndex]
      if (article) {
        setCurrentIndex(task.articleIndex)
        setVisibleTranslations(new Set())
        preloadWordCache(article)
        setView('article')
        return
      }
    }
    // 其他任务：路由跳转
    if (task.tag === 'review') {
      navigate('/review')
    } else if (task.tag === 'vocab') {
      setShowVocabPanel(true)
    } else if (task.tag === 'note') {
      navigate('/notes')
    } else if (task.tag === 'chat') {
      navigate('/chat')
    } else if (task.tag === 'card') {
      navigate('/knowledge-cards')
    } else if (task.tag === 'reflect') {
      setTaskOverrides(prev => ({ ...prev, [task.id]: true }))
      toast.success('已打卡总结今日')
    }
  }

  const handleTaskToggle = (taskId: string) => {
    setTaskOverrides(prev => ({ ...prev, [taskId]: !prev[taskId] }))
  }

  const handleStartToday = () => {
    const firstUndone = tasksView.find(t => !t.done)
    if (firstUndone) {
      handleTaskClick(firstUndone)
    } else {
      toast.success('今日任务已全部完成！')
    }
  }

  const handleBackToDashboard = () => {
    setView('dashboard')
    setShowArticleList(false)
  }

  // 按需翻译当前文章（content_zh 为空或用户主动触发重新翻译）
  const handleTranslateArticle = async () => {
    const article = articles[currentIndex]
    if (!article || translating) return
    try {
      setTranslating(true)
      const { title_zh, summary_zh, content_zh } = await window.electronAPI.article.translate(article.id)
      setArticles(prev => prev.map(a =>
        a.id === article.id ? { ...a, title_zh, summary_zh, content_zh } : a
      ))
      toast.success('翻译完成')
    } catch (error) {
      console.error('翻译失败:', error)
      const msg = error instanceof Error ? error.message : String(error)
      toast.error('翻译失败：' + msg)
    } finally {
      setTranslating(false)
    }
  }

  // 从文章列表选择一篇切换
  const handleSelectArticle = (articleId: string) => {
    const idx = articles.findIndex(a => a.id === articleId)
    if (idx < 0) return
    setCurrentIndex(idx)
    setVisibleTranslations(new Set())
    preloadWordCache(articles[idx])
    setShowArticleList(false)
  }

  // ===== 渲染：加载中 =====
  if (loading) {
    return <Loading hint="正在加载今日学习数据..." />
  }

  // ===== 渲染：空状态 =====
  if (articles.length === 0 && view !== 'article') {
    return (
      <PageHero title="每日学习" subtitle="从优质英文文章中学习，配套生词本与间隔复习">
        <EmptyState
          icon={<Icon name="daily" size={24} />}
          title="开始每日英语学习"
          description="从心理学、认知科学、自我提升等领域的优质英文文章中学习。支持四级 / 六级 / 考研难度，悬停查词，一键收藏生词。"
          action={
            <Button variant="primary" onClick={handleFetchRss} data-dom-id="cta-fetch-rss">
              <Icon name="refresh" size={16} /> 获取最新文章
            </Button>
          }
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 'calc(var(--radius) + 6px)',
          }}
        />
      </PageHero>
    )
  }

  // ===== 渲染：文章阅读器视图 =====
  if (view === 'article' && currentArticle) {
    const paragraphs = currentArticle.content_en.split(/\n\s*\n/).filter(p => p.trim())
    const zhParagraphs = (currentArticle.content_zh || '').split(/\n\s*\n/).filter(p => p.trim())

    return (
      <>
        <PageHero
          title="文章阅读"
          subtitle={`${currentArticle.source} · ${DIFFICULTY_LABELS[currentArticle.difficulty as DifficultyFilter] ?? currentArticle.difficulty} · 第 ${displayIndex + 1} / ${displayArticles.length} 篇`}
          actions={
            <>
              <Button variant="ghost" onClick={handleBackToDashboard} data-dom-id="cta-back-dashboard">
                <Icon name="arrow-left" size={16} /> 返回今日学习
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowArticleList(!showArticleList)}
                data-dom-id="cta-toggle-article-list"
                aria-expanded={showArticleList}
              >
                <Icon name="menu" size={16} /> 文章列表
              </Button>
              <Button variant="secondary" onClick={() => setShowVocabPanel(!showVocabPanel)} data-dom-id="cta-toggle-vocab">
                <Icon name="vocabulary" size={16} /> 生词本
              </Button>
              <Button
                variant="primary"
                onClick={handleTranslateArticle}
                disabled={translating}
                data-dom-id="cta-translate-article"
              >
                <Icon name="refresh" size={16} /> {translating ? '翻译中...' : (currentArticle.content_zh ? '重新翻译' : '翻译此文')}
              </Button>
              <Button variant="ghost" onClick={handleFetchRss} data-dom-id="cta-fetch-rss-article">
                <Icon name="refresh" size={16} /> 获取新文章
              </Button>
            </>
          }
        >
          {/* 筛选栏 */}
          <Card padding="calc(var(--spacing) * 4) calc(var(--spacing) * 5)">
            <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 5)', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 2)' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>难度</span>
                {(['all', 'cet4', 'cet6', 'graduate'] as DifficultyFilter[]).map(d => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDifficultyFilter(d)}
                    style={{
                      padding: '0.34rem 0.65rem',
                      borderRadius: 999,
                      border: '1px solid',
                      borderColor: difficultyFilter === d ? 'var(--primary)' : 'var(--border)',
                      background: difficultyFilter === d ? 'var(--primary)' : 'var(--card)',
                      color: difficultyFilter === d ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      font: 'inherit',
                    }}
                  >
                    {DIFFICULTY_LABELS[d]}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 2)' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>状态</span>
                {(['all', 'unread', 'read', 'favorite'] as StatusFilter[]).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setStatusFilter(s)}
                    style={{
                      padding: '0.34rem 0.65rem',
                      borderRadius: 999,
                      border: '1px solid',
                      borderColor: statusFilter === s ? 'var(--primary)' : 'var(--border)',
                      background: statusFilter === s ? 'var(--primary)' : 'var(--card)',
                      color: statusFilter === s ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                      fontSize: '0.78rem',
                      cursor: 'pointer',
                      transition: 'all 0.2s ease',
                      font: 'inherit',
                    }}
                  >
                    {STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            </div>
          </Card>

          {/* 标题区域（英中对照） */}
          <Card>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'calc(var(--spacing) * 6)' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--foreground)', lineHeight: 1.3 }}>
                  {currentArticle.title_en}
                </h3>
                {currentArticle.summary_zh && (
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.82rem', color: 'var(--muted-foreground)', fontStyle: 'italic' }}>
                    Summary: {currentArticle.summary_zh.slice(0, 50)}...
                  </p>
                )}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 700, color: 'var(--foreground)', lineHeight: 1.3 }}>
                  {currentArticle.title_zh || '（未翻译，点击右上角「翻译此文」）'}
                </h3>
                {currentArticle.summary_zh && (
                  <p style={{ margin: '0.5rem 0 0', fontSize: '0.82rem', color: 'var(--muted-foreground)' }}>
                    摘要：{currentArticle.summary_zh}
                  </p>
                )}
              </div>
            </div>
          </Card>

          {/* 文章段落（英中对照，点击切换翻译） */}
          <Card padding={0} style={{ overflow: 'hidden' }}>
            {paragraphs.map((para, index) => {
              const isTranslationVisible = visibleTranslations.has(index)
              return (
                <div
                  key={index}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 1fr',
                    gap: 0,
                    background: index % 2 === 0 ? 'var(--card)' : 'var(--muted)',
                    borderBottom: '1px solid var(--border)',
                  }}
                >
                  <div
                    style={{
                      padding: 'calc(var(--spacing) * 5)',
                      borderRight: '1px solid var(--border)',
                      cursor: 'pointer',
                      transition: 'background 0.15s ease',
                      background: isTranslationVisible ? 'var(--secondary)' : 'transparent',
                    }}
                    onClick={() => toggleTranslation(index)}
                    onMouseEnter={(e) => {
                      if (!isTranslationVisible) e.currentTarget.style.background = 'var(--secondary)'
                    }}
                    onMouseLeave={(e) => {
                      if (!isTranslationVisible) e.currentTarget.style.background = 'transparent'
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'calc(var(--spacing) * 2)' }}>
                      <span style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)', marginTop: '0.2rem', userSelect: 'none', fontFamily: 'var(--font-mono)' }}>{index + 1}</span>
                      <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: 1.7, color: 'var(--foreground)', flex: 1 }}>
                        {renderEnglishText(para)}
                      </p>
                    </div>
                    {!isTranslationVisible && (
                      <p style={{ margin: '0.5rem 0 0 1.5rem', fontSize: '0.78rem', color: 'var(--primary)', opacity: 0.7 }}>
                        点击显示翻译 →
                      </p>
                    )}
                  </div>
                  <div style={{ padding: 'calc(var(--spacing) * 5)' }}>
                    {currentArticle.content_zh ? (
                      isTranslationVisible && zhParagraphs[index] ? (
                        <p style={{ margin: 0, fontSize: '0.95rem', lineHeight: 1.7, color: 'var(--foreground)' }}>
                          {zhParagraphs[index]}
                        </p>
                      ) : (
                        <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--muted-foreground)', fontStyle: 'italic' }}>
                          点击左侧英文查看翻译
                        </p>
                      )
                    ) : (
                      <p style={{ margin: 0, fontSize: '0.82rem', color: 'var(--state-warning)', fontStyle: 'italic' }}>
                        本文尚未翻译，请点击右上角「翻译此文」
                      </p>
                    )}
                  </div>
                </div>
              )
            })}
          </Card>

          {/* 操作按钮 */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'calc(var(--spacing) * 3)' }}>
            <Button
              variant="ghost"
              onClick={handlePrev}
              disabled={displayIndex <= 0}
              data-dom-id="cta-prev-article"
            >
              <Icon name="arrow-left" size={16} /> 上一篇
            </Button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)' }}>
              <Button
                variant={currentArticle.is_favorite ? 'danger' : 'ghost'}
                onClick={handleToggleFavorite}
                data-dom-id="cta-toggle-favorite"
              >
                <Icon name="heart" size={16} /> {currentArticle.is_favorite ? '已收藏' : '收藏'}
              </Button>
              {!currentArticle.is_read && (
                <Button variant="secondary" onClick={handleMarkAsRead} data-dom-id="cta-mark-read">
                  <Icon name="check" size={16} /> 标记已读
                </Button>
              )}
              {currentArticle.source_url && (
                <a
                  href={currentArticle.source_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-dom-id="link-source"
                  style={{ textDecoration: 'none' }}
                >
                  <Button variant="ghost">
                    <Icon name="external-link" size={16} /> 查看原文
                  </Button>
                </a>
              )}
            </div>
            <Button
              variant="primary"
              onClick={handleNext}
              disabled={displayIndex >= displayArticles.length - 1}
              data-dom-id="cta-next-article"
            >
              下一篇 <Icon name="arrow-right" size={16} />
            </Button>
          </div>
        </PageHero>

        {/* 生词本侧边面板 */}
        {showVocabPanel && (
          <VocabPanel
            vocabulary={vocabulary}
            dueWords={dueWords}
            vocabTab={vocabTab}
            reviewingWord={reviewingWord}
            setVocabTab={setVocabTab}
            setReviewingWord={setReviewingWord}
            onClose={() => { setShowVocabPanel(false); setReviewingWord(null) }}
            onReviewWord={handleReviewWord}
            onMarkMastered={handleMarkMastered}
            onDeleteVocab={handleDeleteVocab}
            onContextMenu={(word, e) => {
              e.preventDefault()
              setContextMenu({ x: e.clientX, y: e.clientY, word })
            }}
          />
        )}

        {/* 文章列表面板（左侧抽屉，类似 VocabPanel） */}
        {showArticleList && (
          <ArticleListPanel
            articles={articles}
            currentArticleId={currentArticle.id}
            onSelect={handleSelectArticle}
            onClose={() => setShowArticleList(false)}
          />
        )}

        {/* 右键菜单 */}
        {contextMenu && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onClick={closeContextMenu} onContextMenu={(e) => { e.preventDefault(); closeContextMenu() }} />
            <div
              style={{
                position: 'fixed',
                left: contextMenu.x,
                top: contextMenu.y,
                background: 'var(--popover)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                boxShadow: 'var(--shadow-lg)',
                zIndex: 50,
                padding: '0.34rem 0',
                minWidth: 180,
              }}
            >
              <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border)' }}>
                <strong style={{ color: 'var(--foreground)' }}>{contextMenu.word}</strong>
              </div>
              <button
                type="button"
                onClick={handleAddToVocabularyFromMenu}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.5rem 0.75rem',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--primary)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.88rem',
                  font: 'inherit',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--secondary)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <Icon name="plus" size={14} /> 添加到生词本
              </button>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(contextMenu.word)
                  toast.success('已复制到剪贴板')
                  setContextMenu(null)
                }}
                style={{
                  width: '100%',
                  textAlign: 'left',
                  padding: '0.5rem 0.75rem',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--foreground)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.5rem',
                  fontSize: '0.88rem',
                  font: 'inherit',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--muted)' }}
                onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
              >
                <Icon name="file" size={14} /> 复制单词
              </button>
              {/* 生词本中的单词额外显示删除和标记掌握 */}
              {vocabTab === 'all' && vocabulary.some(v => v.word === contextMenu.word) && (
                <>
                  <div style={{ borderTop: '1px solid var(--border)', margin: '0.34rem 0' }} />
                  <button
                    type="button"
                    onClick={() => {
                      const vocab = vocabulary.find(v => v.word === contextMenu.word)
                      if (vocab) handleMarkMastered(vocab.id)
                      setContextMenu(null)
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '0.5rem 0.75rem',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--state-success)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontSize: '0.88rem',
                      font: 'inherit',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--secondary)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <Icon name="check" size={14} /> 标记已掌握
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const vocab = vocabulary.find(v => v.word === contextMenu.word)
                      if (vocab) handleDeleteVocab(vocab.id)
                      setContextMenu(null)
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '0.5rem 0.75rem',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--destructive)',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                      fontSize: '0.88rem',
                      font: 'inherit',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                  >
                    <Icon name="trash" size={14} /> 删除
                  </button>
                </>
              )}
            </div>
          </>
        )}

        {/* 首次使用引导 */}
        {showGuide && (
          <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.3)' }}>
            <div style={{ background: 'var(--card)', borderRadius: 'calc(var(--radius) + 8px)', boxShadow: 'var(--shadow-xl)', maxWidth: 420, margin: '0 1rem', padding: 'calc(var(--spacing) * 6)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)', marginBottom: 'calc(var(--spacing) * 4)' }}>
                <div style={{ width: 40, height: 40, background: 'var(--secondary)', borderRadius: '50%', display: 'grid', placeItems: 'center', color: 'var(--primary)' }}>
                  <Icon name="mouse-click" size={20} />
                </div>
                <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--foreground)' }}>新功能：右键添加生词</h3>
              </div>
              <p style={{ margin: '0 0 calc(var(--spacing) * 4)', color: 'var(--muted-foreground)', lineHeight: 1.6, fontSize: '0.9rem' }}>
                在阅读文章时，<strong style={{ color: 'var(--foreground)' }}>右键点击</strong>任意英文单词，即可快速添加到生词本。
                无需等待悬停提示，一键收藏生词。
              </p>
              <div style={{ background: 'var(--secondary)', borderRadius: 'var(--radius)', padding: 'calc(var(--spacing) * 3)', marginBottom: 'calc(var(--spacing) * 4)', display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)' }}>
                <Icon name="mouse-click" size={24} style={{ color: 'var(--primary)' }} />
                <div style={{ fontSize: '0.85rem', color: 'var(--muted-foreground)' }}>
                  <div style={{ fontWeight: 600, color: 'var(--foreground)' }}>操作方式</div>
                  <div>右键点击单词 → 选择"添加到生词本"</div>
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'calc(var(--spacing) * 3)' }}>
                <Button variant="ghost" onClick={dismissGuide}>稍后再说</Button>
                <Button variant="primary" onClick={dismissGuide}>知道了</Button>
              </div>
            </div>
          </div>
        )}

        {/* 单词悬停提示框 */}
        {hoveredWord && (
          <div
            style={{
              position: 'fixed',
              left: Math.min(tooltipPosition.x, window.innerWidth - 320),
              top: Math.max(tooltipPosition.y - 120, 10),
              background: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: 'calc(var(--radius) + 4px)',
              boxShadow: 'var(--shadow-xl)',
              zIndex: 50,
              maxWidth: 320,
              overflow: 'hidden',
            }}
          >
            {tooltipContent ? (
              <div style={{ padding: 'calc(var(--spacing) * 4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 2)', marginBottom: 'calc(var(--spacing) * 2)' }}>
                  <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--foreground)' }}>{hoveredWord}</span>
                  {String(tooltipContent.phonetic || '') && (
                    <span style={{ fontSize: '0.82rem', color: 'var(--muted-foreground)' }}>{String(tooltipContent.phonetic || '')}</span>
                  )}
                </div>
                {String(tooltipContent.pos || '') && (
                  <span style={{ display: 'inline-block', padding: '0.2rem 0.5rem', fontSize: '0.78rem', background: 'var(--secondary)', color: 'var(--accent-foreground)', borderRadius: 'var(--radius-sm)', marginBottom: 'calc(var(--spacing) * 2)' }}>
                    {String(tooltipContent.pos || '')}
                  </span>
                )}
                <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--foreground)', lineHeight: 1.6 }}>
                  {String(tooltipContent.translation || '')}
                </p>
                {String(tooltipContent.tag || '') && (
                  <div style={{ marginTop: 'calc(var(--spacing) * 2)', display: 'flex', flexWrap: 'wrap', gap: '0.25rem' }}>
                    {String(tooltipContent.tag || '').split(' ').map((tag: string, i: number) => (
                      <span key={i} style={{ padding: '0.2rem 0.4rem', fontSize: '0.72rem', background: 'var(--state-warning)', color: '#ffffff', borderRadius: 'var(--radius-sm)' }}>
                        {tag.toUpperCase()}
                      </span>
                    ))}
                  </div>
                )}
                {Number(tooltipContent.collins || 0) > 0 && (
                  <div style={{ marginTop: 'calc(var(--spacing) * 2)', fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>
                    柯林斯星级: {'★'.repeat(Number(tooltipContent.collins || 0))}{'☆'.repeat(5 - Number(tooltipContent.collins || 0))}
                  </div>
                )}
                <Button
                  variant="secondary"
                  onClick={handleAddToVocabulary}
                  style={{ marginTop: 'calc(var(--spacing) * 3)', width: '100%' }}
                >
                  <Icon name="plus" size={14} /> 添加到生词本
                </Button>
              </div>
            ) : (
              <div style={{ padding: 'calc(var(--spacing) * 4)' }}>
                <div style={{ fontWeight: 700, color: 'var(--foreground)', marginBottom: '0.25rem' }}>{hoveredWord}</div>
                <div style={{ fontSize: '0.85rem', color: 'var(--muted-foreground)' }}>本地词典未收录</div>
                <Button
                  variant="secondary"
                  onClick={handleAddToVocabulary}
                  style={{ marginTop: 'calc(var(--spacing) * 3)', width: '100%' }}
                >
                  <Icon name="plus" size={14} /> 添加到生词本
                </Button>
              </div>
            )}
          </div>
        )}
      </>
    )
  }

  // ===== 渲染：Dashboard 主视图（设计稿 1:1） =====
  return (
    <>
      <PageHero
        title="每日学习"
        subtitle={subtitleDate}
        actions={
          <>
            <Button variant="primary" onClick={handleStartToday} data-dom-id="cta-start">
              <Icon name="play" size={16} /> 开始今日学习
            </Button>
          </>
        }
      >
        {/* ===== 第一层：三栏看板（进度环 + 任务清单 + 连续打卡） ===== */}
        <div
          className="grid daily"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1.5fr 1fr',
            gap: 'calc(var(--spacing) * 5)',
            alignItems: 'stretch',
          }}
        >
          {/* 左栏：进度环卡片 */}
          <Card aria-label="今日学习进度">
            <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'calc(var(--spacing) * 4)' }}>
              <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>今日进度</span>
              <div
                role="img"
                aria-label={`今日完成进度 ${progressPct}%`}
                style={{
                  width: 140,
                  height: 140,
                  position: 'relative',
                  margin: 'calc(var(--spacing) * 3) 0',
                  background: `conic-gradient(var(--primary) 0 ${progressPct}%, var(--muted) ${progressPct}% 100%)`,
                  borderRadius: '50%',
                }}
              >
                <div style={{ position: 'absolute', inset: 16, borderRadius: '50%', background: 'var(--card)' }} />
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', zIndex: 1, textAlign: 'center' }}>
                  <div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--foreground)', lineHeight: 1 }}>{progressPct}%</div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--muted-foreground)', marginTop: '0.2rem' }}>{completedCount}/{totalCount} 完成</div>
                  </div>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 'calc(var(--spacing) * 3)', width: '100%', marginTop: 'calc(var(--spacing) * 3)' }}>
                <div style={{ padding: 'calc(var(--spacing) * 3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--background)', textAlign: 'left' }}>
                  <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>已用时间</span>
                  <strong style={{ display: 'block', marginTop: '0.3rem', fontFamily: 'var(--font-mono)', fontSize: '1.05rem', fontVariantNumeric: 'tabular-nums', color: 'var(--foreground)', fontWeight: 700 }}>{elapsedMin}m</strong>
                </div>
                <div style={{ padding: 'calc(var(--spacing) * 3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--background)', textAlign: 'left' }}>
                  <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>预计剩余</span>
                  <strong style={{ display: 'block', marginTop: '0.3rem', fontFamily: 'var(--font-mono)', fontSize: '1.05rem', fontVariantNumeric: 'tabular-nums', color: 'var(--foreground)', fontWeight: 700 }}>{remainingMin}m</strong>
                </div>
              </div>
            </div>
          </Card>

          {/* 中栏：今日任务清单 */}
          <Card aria-label="今日任务清单">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'calc(var(--spacing) * 3)', marginBottom: 'calc(var(--spacing) * 4)' }}>
              <div>
                <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>今日任务</span>
                <strong style={{ display: 'block', marginTop: '0.3rem', fontSize: '1rem', color: 'var(--card-foreground)' }}>{totalCount} 项 · {completedCount} 完成</strong>
              </div>
              <Badge variant="success">进行中</Badge>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)' }}>
              {tasksView.map((task) => {
                const tagStyle = TASK_TAG_STYLES[task.tag]
                return (
                  <button
                    key={task.id}
                    type="button"
                    data-dom-id={task.id}
                    onClick={() => handleTaskClick(task)}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 'calc(var(--spacing) * 3)',
                      padding: 'calc(var(--spacing) * 3.5)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      background: 'var(--background)',
                      cursor: 'pointer',
                      transition: 'border-color 0.2s ease, background 0.2s ease',
                      textAlign: 'left',
                      font: 'inherit',
                      color: 'inherit',
                      width: '100%',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)' }}
                  >
                    <span
                      onClick={(e) => { e.stopPropagation(); handleTaskToggle(task.id) }}
                      style={{
                        width: 20,
                        height: 20,
                        border: '2px solid',
                        borderColor: task.done ? 'var(--state-success)' : 'var(--border)',
                        borderRadius: '50%',
                        flexShrink: 0,
                        marginTop: '0.1rem',
                        position: 'relative',
                        display: 'grid',
                        placeItems: 'center',
                        background: task.done ? 'var(--state-success)' : 'var(--card)',
                        cursor: 'pointer',
                        transition: 'background 0.2s ease, border-color 0.2s ease',
                      }}
                    >
                      {task.done && (
                        <Icon name="check" size={12} style={{ stroke: 'var(--primary-foreground)', strokeWidth: 3 }} />
                      )}
                    </span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: '0.92rem',
                        fontWeight: 500,
                        color: task.done ? 'var(--muted-foreground)' : 'var(--card-foreground)',
                        lineHeight: 1.4,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        textDecoration: task.done ? 'line-through' : 'none',
                      }}>
                        {task.title}
                      </div>
                      <div style={{
                        display: 'flex',
                        gap: 'calc(var(--spacing) * 3)',
                        fontSize: '0.72rem',
                        color: 'var(--muted-foreground)',
                        marginTop: '0.3rem',
                        fontFamily: 'var(--font-mono)',
                        fontVariantNumeric: 'tabular-nums',
                        flexWrap: 'wrap',
                      }}>
                        <span>{task.duration}min</span>
                        <span>{task.category}</span>
                      </div>
                    </div>
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      fontSize: '0.68rem',
                      padding: '0.2rem 0.5rem',
                      borderRadius: 999,
                      whiteSpace: 'nowrap',
                      flexShrink: 0,
                      alignSelf: 'center',
                      fontWeight: 600,
                      background: tagStyle.background,
                      color: tagStyle.color,
                    }}>
                      {tagStyle.label}
                    </span>
                  </button>
                )
              })}
            </div>
          </Card>

          {/* 右栏：连续打卡卡片 */}
          <Card aria-label="连续打卡统计">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'calc(var(--spacing) * 3)', marginBottom: 'calc(var(--spacing) * 4)' }}>
              <div>
                <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>连续打卡</span>
                <strong style={{ display: 'block', marginTop: '0.3rem', fontSize: '1rem', color: 'var(--card-foreground)' }}>17 天</strong>
              </div>
            </div>
            <div style={{ fontSize: '1.875rem', fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--primary)', textAlign: 'center', margin: 'calc(var(--spacing) * 4) 0 calc(var(--spacing) * 2)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>17</div>
            <div style={{ textAlign: 'center', fontSize: '0.82rem', color: 'var(--muted-foreground)', lineHeight: 1.5 }}>历史最长 23 天 · 距破纪录 6 天</div>
            <div style={{ marginTop: 'calc(var(--spacing) * 5)' }}>
              <div style={{ marginBottom: 'calc(var(--spacing) * 3)' }}>
                <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>本月打卡</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'calc(var(--spacing) * 1.5)' }}>
                {calendarCells.map((cell) => (
                  <span
                    key={cell.day}
                    style={{
                      aspectRatio: '1',
                      borderRadius: 4,
                      display: 'grid',
                      placeItems: 'center',
                      fontSize: '0.72rem',
                      fontFamily: 'var(--font-mono)',
                      fontVariantNumeric: 'tabular-nums',
                      fontWeight: 600,
                      background: 'var(--state-success)',
                      color: 'var(--card)',
                    }}
                  >
                    {cell.day}
                  </span>
                ))}
              </div>
            </div>
          </Card>
        </div>

        {/* ===== 第二层：本周概览 ===== */}
        <Card aria-label="本周学习概览">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'calc(var(--spacing) * 3)', marginBottom: 'calc(var(--spacing) * 4)' }}>
            <div>
              <span style={{ fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>本周概览</span>
              <strong style={{ display: 'block', marginTop: '0.3rem', fontSize: '1rem', color: 'var(--card-foreground)' }}>{formatWeekRange()}</strong>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 'calc(var(--spacing) * 3)' }}>
            {weekSummary.map((day, i) => (
              <div
                key={i}
                style={{
                  padding: 'calc(var(--spacing) * 4)',
                  border: '1px solid',
                  borderColor: day.isToday ? 'var(--primary)' : 'var(--border)',
                  borderRadius: 'var(--radius)',
                  textAlign: 'center',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'calc(var(--spacing) * 2)',
                  background: day.isToday ? 'var(--popover)' : 'var(--background)',
                }}
              >
                <span style={{ fontSize: '0.72rem', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{day.name}</span>
                <span style={{ fontSize: '1.1rem', fontWeight: 700, fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', color: 'var(--foreground)' }}>{day.done}/{day.total}</span>
                <span style={{ alignSelf: 'center' }}>
                  {day.status === '完成' ? (
                    <Badge variant="success">完成</Badge>
                  ) : day.status === '进行中' ? (
                    <Badge variant="alert">进行中</Badge>
                  ) : (
                    <Badge>部分</Badge>
                  )}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </PageHero>

      {/* 生词本侧边面板（dashboard 视图也可访问） */}
      {showVocabPanel && (
        <VocabPanel
          vocabulary={vocabulary}
          dueWords={dueWords}
          vocabTab={vocabTab}
          reviewingWord={reviewingWord}
          setVocabTab={setVocabTab}
          setReviewingWord={setReviewingWord}
          onClose={() => { setShowVocabPanel(false); setReviewingWord(null) }}
          onReviewWord={handleReviewWord}
          onMarkMastered={handleMarkMastered}
          onDeleteVocab={handleDeleteVocab}
          onContextMenu={(word, e) => {
            e.preventDefault()
            setContextMenu({ x: e.clientX, y: e.clientY, word })
          }}
        />
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onClick={closeContextMenu} onContextMenu={(e) => { e.preventDefault(); closeContextMenu() }} />
          <div
            style={{
              position: 'fixed',
              left: contextMenu.x,
              top: contextMenu.y,
              background: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              boxShadow: 'var(--shadow-lg)',
              zIndex: 50,
              padding: '0.34rem 0',
              minWidth: 180,
            }}
          >
            <div style={{ padding: '0.5rem 0.75rem', borderBottom: '1px solid var(--border)' }}>
              <strong style={{ color: 'var(--foreground)' }}>{contextMenu.word}</strong>
            </div>
            <button
              type="button"
              onClick={handleAddToVocabularyFromMenu}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '0.5rem 0.75rem',
                border: 'none',
                background: 'transparent',
                color: 'var(--primary)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.88rem',
                font: 'inherit',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--secondary)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <Icon name="plus" size={14} /> 添加到生词本
            </button>
            <button
              type="button"
              onClick={() => {
                navigator.clipboard.writeText(contextMenu.word)
                toast.success('已复制到剪贴板')
                setContextMenu(null)
              }}
              style={{
                width: '100%',
                textAlign: 'left',
                padding: '0.5rem 0.75rem',
                border: 'none',
                background: 'transparent',
                color: 'var(--foreground)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: '0.88rem',
                font: 'inherit',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--muted)' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <Icon name="file" size={14} /> 复制单词
            </button>
            {vocabTab === 'all' && vocabulary.some(v => v.word === contextMenu.word) && (
              <>
                <div style={{ borderTop: '1px solid var(--border)', margin: '0.34rem 0' }} />
                <button
                  type="button"
                  onClick={() => {
                    const vocab = vocabulary.find(v => v.word === contextMenu.word)
                    if (vocab) handleMarkMastered(vocab.id)
                    setContextMenu(null)
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.5rem 0.75rem',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--state-success)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.88rem',
                    font: 'inherit',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--secondary)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <Icon name="check" size={14} /> 标记已掌握
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const vocab = vocabulary.find(v => v.word === contextMenu.word)
                    if (vocab) handleDeleteVocab(vocab.id)
                    setContextMenu(null)
                  }}
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    padding: '0.5rem 0.75rem',
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--destructive)',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.5rem',
                    fontSize: '0.88rem',
                    font: 'inherit',
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <Icon name="trash" size={14} /> 删除
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* 首次使用引导 */}
      {showGuide && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0, 0, 0, 0.3)' }}>
          <div style={{ background: 'var(--card)', borderRadius: 'calc(var(--radius) + 8px)', boxShadow: 'var(--shadow-xl)', maxWidth: 420, margin: '0 1rem', padding: 'calc(var(--spacing) * 6)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)', marginBottom: 'calc(var(--spacing) * 4)' }}>
              <div style={{ width: 40, height: 40, background: 'var(--secondary)', borderRadius: '50%', display: 'grid', placeItems: 'center', color: 'var(--primary)' }}>
                <Icon name="mouse-click" size={20} />
              </div>
              <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--foreground)' }}>新功能：右键添加生词</h3>
            </div>
            <p style={{ margin: '0 0 calc(var(--spacing) * 4)', color: 'var(--muted-foreground)', lineHeight: 1.6, fontSize: '0.9rem' }}>
              在阅读文章时，<strong style={{ color: 'var(--foreground)' }}>右键点击</strong>任意英文单词，即可快速添加到生词本。
              无需等待悬停提示，一键收藏生词。
            </p>
            <div style={{ background: 'var(--secondary)', borderRadius: 'var(--radius)', padding: 'calc(var(--spacing) * 3)', marginBottom: 'calc(var(--spacing) * 4)', display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)' }}>
              <Icon name="mouse-click" size={24} style={{ color: 'var(--primary)' }} />
              <div style={{ fontSize: '0.85rem', color: 'var(--muted-foreground)' }}>
                <div style={{ fontWeight: 600, color: 'var(--foreground)' }}>操作方式</div>
                <div>右键点击单词 → 选择"添加到生词本"</div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 'calc(var(--spacing) * 3)' }}>
              <Button variant="ghost" onClick={dismissGuide}>稍后再说</Button>
              <Button variant="primary" onClick={dismissGuide}>知道了</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

// ===== 子组件：生词本侧边面板 =====
interface VocabPanelProps {
  vocabulary: Vocabulary[]
  dueWords: Vocabulary[]
  vocabTab: 'all' | 'review'
  reviewingWord: Vocabulary | null
  setVocabTab: (tab: 'all' | 'review') => void
  setReviewingWord: (word: Vocabulary | null) => void
  onClose: () => void
  onReviewWord: (wordId: string, quality: number) => void
  onMarkMastered: (wordId: string) => void
  onDeleteVocab: (wordId: string) => void
  onContextMenu: (word: string, e: React.MouseEvent) => void
}

function VocabPanel({
  vocabulary,
  dueWords,
  vocabTab,
  reviewingWord,
  setVocabTab,
  setReviewingWord,
  onClose,
  onReviewWord,
  onContextMenu,
}: VocabPanelProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        bottom: 0,
        width: 360,
        background: 'var(--card)',
        borderLeft: '1px solid var(--border)',
        boxShadow: 'var(--shadow-xl)',
        zIndex: 40,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* 面板头部 */}
      <div style={{ padding: 'calc(var(--spacing) * 4)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'calc(var(--spacing) * 3)' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--foreground)' }}>生词本</h3>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--muted-foreground)',
              cursor: 'pointer',
              padding: '0.34rem',
              borderRadius: 'var(--radius-sm)',
              display: 'grid',
              placeItems: 'center',
            }}
            aria-label="关闭"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 4)', fontSize: '0.78rem', color: 'var(--muted-foreground)', marginBottom: 'calc(var(--spacing) * 3)' }}>
          <span>总词数: {vocabulary.length}</span>
          <span>待复习: {dueWords.length}</span>
        </div>
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)' }}>
          <button
            type="button"
            onClick={() => { setVocabTab('all'); setReviewingWord(null) }}
            style={{
              flex: 1,
              padding: '0.5rem 0',
              border: 'none',
              background: 'transparent',
              borderBottom: vocabTab === 'all' ? '2px solid var(--primary)' : '2px solid transparent',
              color: vocabTab === 'all' ? 'var(--primary)' : 'var(--muted-foreground)',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            全部 ({vocabulary.length})
          </button>
          <button
            type="button"
            onClick={() => { setVocabTab('review'); setReviewingWord(null) }}
            style={{
              flex: 1,
              padding: '0.5rem 0',
              border: 'none',
              background: 'transparent',
              borderBottom: vocabTab === 'review' ? '2px solid var(--primary)' : '2px solid transparent',
              color: vocabTab === 'review' ? 'var(--primary)' : 'var(--muted-foreground)',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            待复习 ({dueWords.length})
          </button>
        </div>
      </div>

      {/* 面板内容 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 'calc(var(--spacing) * 4)' }}>
        {vocabTab === 'review' ? (
          // 复习模式
          reviewingWord ? (
            <div>
              <div style={{ textAlign: 'center', marginBottom: 'calc(var(--spacing) * 5)' }}>
                <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--foreground)', marginBottom: '0.25rem' }}>{reviewingWord.word}</div>
                {reviewingWord.phonetic && <div style={{ fontSize: '0.85rem', color: 'var(--muted-foreground)' }}>{reviewingWord.phonetic}</div>}
                {reviewingWord.part_of_speech && (
                  <span style={{ display: 'inline-block', marginTop: '0.5rem', padding: '0.2rem 0.5rem', fontSize: '0.78rem', background: 'var(--secondary)', color: 'var(--accent-foreground)', borderRadius: 'var(--radius-sm)' }}>
                    {reviewingWord.part_of_speech}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
                <button
                  type="button"
                  onClick={() => onReviewWord(reviewingWord.id, 1)}
                  style={{
                    padding: '0.75rem',
                    background: 'var(--accent)',
                    color: 'var(--destructive)',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                    fontWeight: 600,
                    font: 'inherit',
                  }}
                >
                  忘记
                </button>
                <button
                  type="button"
                  onClick={() => onReviewWord(reviewingWord.id, 3)}
                  style={{
                    padding: '0.75rem',
                    background: 'var(--secondary)',
                    color: 'var(--accent-foreground)',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                    fontWeight: 600,
                    font: 'inherit',
                  }}
                >
                  模糊
                </button>
                <button
                  type="button"
                  onClick={() => onReviewWord(reviewingWord.id, 4)}
                  style={{
                    padding: '0.75rem',
                    background: 'var(--state-success)',
                    color: '#ffffff',
                    borderRadius: 'var(--radius)',
                    border: '1px solid var(--border)',
                    cursor: 'pointer',
                    fontWeight: 600,
                    font: 'inherit',
                  }}
                >
                  认识
                </button>
              </div>
              <button
                type="button"
                onClick={() => setReviewingWord(null)}
                style={{
                  width: '100%',
                  marginTop: 'calc(var(--spacing) * 3)',
                  padding: '0.5rem 0',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--muted-foreground)',
                  cursor: 'pointer',
                  fontSize: '0.85rem',
                  font: 'inherit',
                }}
              >
                返回单词列表
              </button>
            </div>
          ) : dueWords.length > 0 ? (
            <div style={{ textAlign: 'center', padding: 'calc(var(--spacing) * 6) 0' }}>
              <div style={{ marginBottom: 'calc(var(--spacing) * 4)' }}>
                <Icon name="vocabulary" size={32} style={{ color: 'var(--primary)' }} />
              </div>
              <p style={{ color: 'var(--foreground)', marginBottom: 'calc(var(--spacing) * 4)', fontSize: '0.9rem' }}>今日有 {dueWords.length} 个单词待复习</p>
              <Button variant="primary" onClick={() => setReviewingWord(dueWords[0])}>
                <Icon name="play" size={14} /> 开始复习
              </Button>
            </div>
          ) : (
            <p style={{ color: 'var(--muted-foreground)', fontSize: '0.85rem', textAlign: 'center', padding: 'calc(var(--spacing) * 6) 0' }}>
              今日暂无待复习单词 🎉
            </p>
          )
        ) : (
          // 全部生词列表
          vocabulary.length === 0 ? (
            <p style={{ color: 'var(--muted-foreground)', fontSize: '0.85rem', textAlign: 'center', padding: 'calc(var(--spacing) * 6) 0' }}>
              暂无生词，悬停或右键点击英文单词可添加
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)' }}>
              {vocabulary.map(vocab => (
                <div
                  key={vocab.id}
                  style={{
                    background: 'var(--background)',
                    borderRadius: 'var(--radius)',
                    padding: 'calc(var(--spacing) * 3)',
                    border: '1px solid var(--border)',
                  }}
                  onContextMenu={(e) => onContextMenu(vocab.word, e)}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                    <span style={{ fontWeight: 700, color: 'var(--foreground)' }}>{vocab.word}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      {vocab.cefr_level && (
                        <span style={{ fontSize: '0.72rem', background: 'var(--secondary)', color: 'var(--accent-foreground)', padding: '0.2rem 0.4rem', borderRadius: 'var(--radius-sm)' }}>
                          {vocab.cefr_level}
                        </span>
                      )}
                      {vocab.learning_stage !== undefined && (
                        <span style={{
                          fontSize: '0.72rem',
                          padding: '0.2rem 0.4rem',
                          borderRadius: 'var(--radius-sm)',
                          background: vocab.learning_stage === 0
                            ? 'var(--state-info)'
                            : vocab.learning_stage === 1
                            ? 'var(--state-warning)'
                            : 'var(--state-success)',
                          color: '#ffffff',
                        }}>
                          {STAGE_LABELS[vocab.learning_stage] || '新词'}
                        </span>
                      )}
                    </div>
                  </div>
                  {vocab.phonetic && (
                    <span style={{ fontSize: '0.82rem', color: 'var(--muted-foreground)' }}>{vocab.phonetic}</span>
                  )}
                  <p style={{ margin: '0.25rem 0 0', fontSize: '0.85rem', color: 'var(--foreground)' }}>{vocab.meaning_zh}</p>
                  {vocab.next_review_at && (
                    <p style={{ margin: '0.25rem 0 0', fontSize: '0.72rem', color: 'var(--muted-foreground)' }}>
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
  )
}

// ===== 子组件：文章列表面板（左侧抽屉，便于切换文章） =====
interface ArticleListPanelProps {
  articles: Article[]
  currentArticleId: string
  onSelect: (articleId: string) => void
  onClose: () => void
}

function ArticleListPanel({ articles, currentArticleId, onSelect, onClose }: ArticleListPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  // 记录打开面板前的焦点元素（触发按钮），关闭时还原
  const triggerRef = useRef<HTMLElement | null>(null)

  // ESC 关闭 + focus trap（Tab 循环焦点，匹配 aria-modal=true 语义）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const panel = panelRef.current
      if (!panel) return
      const focusables = panel.querySelectorAll<HTMLElement>(
        'button, a, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
      if (focusables.length === 0) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault()
        first.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  // 打开面板：焦点进入；关闭时：焦点返回触发按钮
  useEffect(() => {
    triggerRef.current = document.activeElement as HTMLElement
    closeButtonRef.current?.focus()
    return () => {
      triggerRef.current?.focus()
    }
  }, [])

  const currentIdx = articles.findIndex(a => a.id === currentArticleId)

  return (
    <>
      {/* 遮罩层：与 aria-modal=true 语义一致，点击关闭 */}
      <div
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(0, 0, 0, 0.5)',
          zIndex: 30,
        }}
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="文章列表"
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          bottom: 0,
          width: 360,
          background: 'var(--card)',
          borderRight: '1px solid var(--border)',
          boxShadow: 'var(--shadow-xl)',
          zIndex: 40,
          display: 'flex',
          flexDirection: 'column',
        }}
      >
      {/* 面板头部 */}
      <div style={{ padding: 'calc(var(--spacing) * 4)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--foreground)' }}>文章列表</h3>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--muted-foreground)',
              cursor: 'pointer',
              padding: '0.34rem',
              borderRadius: 'var(--radius-sm)',
              display: 'grid',
              placeItems: 'center',
            }}
            aria-label="关闭"
          >
            <Icon name="close" size={16} />
          </button>
        </div>
        <div style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)', marginTop: '0.5rem' }}>
          共 {articles.length} 篇 · 当前第 {currentIdx + 1} 篇
        </div>
      </div>

      {/* 列表 */}
      <div style={{ flex: 1, overflow: 'auto', padding: 'calc(var(--spacing) * 3)' }}>
        {articles.length === 0 ? (
          <p style={{ color: 'var(--muted-foreground)', fontSize: '0.85rem', textAlign: 'center', padding: 'calc(var(--spacing) * 6) 0' }}>
            暂无文章，请点击右上角「获取新文章」
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
            {articles.map((article, idx) => {
              const isCurrent = article.id === currentArticleId
              const isTranslated = Boolean(article.content_zh)
              return (
                <button
                  key={article.id}
                  type="button"
                  onClick={() => onSelect(article.id)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '0.34rem',
                    padding: 'calc(var(--spacing) * 3)',
                    border: '1px solid',
                    borderColor: isCurrent ? 'var(--primary)' : 'var(--border)',
                    borderRadius: 'var(--radius)',
                    background: isCurrent ? 'var(--secondary)' : 'var(--background)',
                    cursor: 'pointer',
                    textAlign: 'left',
                    font: 'inherit',
                    color: 'inherit',
                  }}
                  onMouseEnter={(e) => { if (!isCurrent) e.currentTarget.style.borderColor = 'var(--ring)' }}
                  onMouseLeave={(e) => { if (!isCurrent) e.currentTarget.style.borderColor = 'var(--border)' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span style={{ fontSize: '0.72rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)' }}>#{idx + 1}</span>
                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                      {article.is_favorite && (
                        <span style={{ fontSize: '0.68rem', padding: '0.1rem 0.4rem', borderRadius: 999, background: 'var(--state-warning)', color: '#ffffff' }}>
                          收藏
                        </span>
                      )}
                      {article.is_read && (
                        <span style={{ fontSize: '0.68rem', padding: '0.1rem 0.4rem', borderRadius: 999, background: 'var(--state-success)', color: '#ffffff' }}>
                          已读
                        </span>
                      )}
                      <span style={{ fontSize: '0.68rem', padding: '0.1rem 0.4rem', borderRadius: 999, background: isTranslated ? 'var(--state-success)' : 'var(--muted)', color: '#ffffff' }}>
                        {isTranslated ? '已译' : '未译'}
                      </span>
                    </div>
                  </div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--foreground)', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {article.title_en}
                  </div>
                  {article.title_zh && (
                    <div style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 1, WebkitBoxOrient: 'vertical' }}>
                      {article.title_zh}
                    </div>
                  )}
                  <div style={{ fontSize: '0.72rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)' }}>
                    {article.source} · {DIFFICULTY_LABELS[article.difficulty as DifficultyFilter] ?? article.difficulty}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>
      </div>
    </>
  )
}
