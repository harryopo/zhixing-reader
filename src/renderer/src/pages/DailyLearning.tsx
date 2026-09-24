/**
 * DailyLearning — 每日学习页（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/daily-learning.html
 *
 * Dashboard 视图（默认）：
 *   Layer 1. 两栏看板：进度环 + 任务清单
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
import { useNavigate, useSearchParams } from 'react-router-dom'
import { readArticleDeepLink } from '../../../shared/source-anchor'
import PageHero from '@/components/layout/PageHero'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { Loading, EmptyState } from '@/components/ui/Feedback'
import {
  buildDailyTasks,
  summarizeDailyTasks,
  firstUnfinishedTask,
  type DailyTask,
} from '../../../shared/daily-tasks'
import { toast } from '../stores/toastStore'
import {
  DIFFICULTY_LABELS,
  STATUS_LABELS,
  TASK_TAG_STYLES,
  type Article,
  type CardQueue,
  type DifficultyFilter,
  type StatusFilter,
  type Vocabulary,
} from './daily-learning/constants'
import { normalizeArticle } from './daily-learning/format'
import { VocabPanel } from './daily-learning/VocabPanel'
import { ArticleListPanel } from './daily-learning/ArticleListPanel'
/**
 * 列表长度会被直接当成界面上的数字（「还有 N 个待掌握」「现有文章都读完了」），
 * 而主进程默认只给 articles 50 条 / vocabulary 200 条 —— 本机实测已有 80 篇文章，
 * 用默认值就是把「还有没读完的」算成「都读完了」。一次取够，别拿被截断的列表当计数。
 */
const FULL_LIST_LIMIT = 1000

// ===== 主组件 =====
export default function DailyLearning() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

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
  /** 复习评分提交中：防止连点对同一个词提交两次 */
  const [reviewSubmitting, setReviewSubmitting] = useState(false)
  const [dueWords, setDueWords] = useState<Vocabulary[]>([])

  // 筛选状态
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // 单词缓存：避免每次悬停都发送IPC请求
  const wordCacheRef = useRef<Map<string, Record<string, unknown> | null>>(new Map())
  // 悬停防抖：快速移动时只保留最后一个单词，避免连续弹出多个 tooltip
  const hoverTimerRef = useRef<number | null>(null)
  const leaveTimerRef = useRef<number | null>(null)
  const pendingHoverRef = useRef<{ word: string; x: number; y: number } | null>(null)
  // 鼠标是否位于 tooltip 内容区，用于防止单词 -> tooltip 切换时闪烁
  const isOverTooltipRef = useRef(false)
  // 记录最近鼠标位置，检测快速划过（距离 / 时间）
  const lastMousePosRef = useRef<{ x: number; y: number; time: number }>({ x: 0, y: 0, time: 0 })

  // ===== Dashboard 新增状态 =====
  const [view, setView] = useState<'dashboard' | 'article'>('dashboard')
  // 今日真实信号：卡片队列 / 今天实际完成了多少 / 今天是否和 AI 聊过。
  // 清单上的每一项都由它们判定，不再依赖手点的勾（见 tasks 的注释）。
  const [queue, setQueue] = useState<CardQueue | null>(null)
  const [todayStats, setTodayStats] = useState<{ cardsReviewed: number; readingSeconds: number } | null>(null)
  const [chattedToday, setChattedToday] = useState(false)
  // 翻译与文章选择状态
  const [translating, setTranslating] = useState(false)
  const [showArticleList, setShowArticleList] = useState(false)

  /** 今天的日期（UTC，与 daily_stats / conversations 的写入口径一致） */
  const todayStr = new Date().toISOString().split('T')[0]

  // ===== 数据加载（全部保留） =====

  const loadArticles = useCallback(async () => {
    if (!window.electronAPI?.article) {
      setLoading(false)
      return
    }
    try {
      setLoading(true)
      const data = await window.electronAPI.article.getAll(FULL_LIST_LIMIT)
      const raw = Array.isArray(data) ? data : []
      // 在边界处把 0/1 掰成真 boolean（见 normalizeArticle 的注释）
      const articleList = raw.map((a) => normalizeArticle(a as Record<string, unknown>))
      if (articleList.length > 0) {
        setArticles(articleList)
        // 生词抽屉里的「回到文章」链到 ?article=<id>：直接落在那篇上，
        // 而不是把用户丢在列表第一篇。
        const wantedId = readArticleDeepLink((key) => searchParams.get(key))
        const wantedIndex = wantedId ? articleList.findIndex((a) => a.id === wantedId) : -1
        if (wantedIndex >= 0) {
          setCurrentIndex(wantedIndex)
          setView('article')
          preloadWordCache(articleList[wantedIndex])
        } else {
          preloadWordCache(articleList[0])
          if (wantedId) toast.warning('那篇文章不在当前列表里（超出取数范围或已删除）')
        }
      }
    } catch (error) {
      console.error('加载文章失败:', error)
    } finally {
      setLoading(false)
    }
  }, [searchParams])

  const loadVocabulary = useCallback(async () => {
    if (!window.electronAPI?.vocabulary) return
    try {
      const data = await window.electronAPI.vocabulary.getAll(FULL_LIST_LIMIT)
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

  /**
   * 今日真实信号加载。
   *
   * 「每日学习」这张清单存在的意义是**它说的每一条都能兑现**：
   * 数量来自真实队列，完成与否由真实数据判定。
   * 一旦靠手点的勾，进度环就成了自欺欺人的数字 —— 所以这里只认数据。
   */
  const loadTodaySignals = useCallback(async () => {
    try {
      const q = await window.electronAPI?.card?.getQueueStats?.()
      if (q) setQueue(q as CardQueue)
    } catch (error) {
      console.error('加载卡片队列失败:', error)
    }
    try {
      const s = await window.electronAPI?.stats?.getToday?.()
      // 注意：renderer.d.ts 把 DailyStats 声明成驼峰（readingTime/reviewsCount），
      // 但 dailyStatsDb.getToday() 是 SELECT * —— 运行时拿到的是**下划线**列名。
      // 全项目都是两种写法都认（见 Stats.tsx / Profile.tsx），这里保持一致。
      const row = (s ?? {}) as unknown as Record<string, unknown>
      setTodayStats({
        cardsReviewed: Number(row.cards_reviewed ?? row.reviewsCount) || 0,
        readingSeconds: Number(row.reading_time ?? row.readingTime) || 0,
      })
    } catch (error) {
      console.error('加载今日统计失败:', error)
    }
    try {
      const convs = await window.electronAPI?.conversation?.getAll?.()
      const list = Array.isArray(convs) ? convs : []
      setChattedToday(
        list.some((c) => {
          const row = c as unknown as Record<string, unknown>
          const stamp = String(row.updated_at ?? row.updatedAt ?? '')
          return stamp.slice(0, 10) === todayStr
        }),
      )
    } catch (error) {
      console.error('加载对话记录失败:', error)
    }
  }, [todayStr])

  useEffect(() => {
    loadArticles()
    loadVocabulary()
    loadDueWords()
    void loadTodaySignals()
    // 检查是否首次使用右键添加功能
    const hasSeenGuide = localStorage.getItem('vocab-rightclick-guide')
    // 「稍后再说」只压住本次会话：下次启动还会提醒
    const deferredThisSession = sessionStorage.getItem('vocab-rightclick-guide-later')
    if (!hasSeenGuide && !deferredThisSession) {
      const timer = setTimeout(() => setShowGuide(true), 1500)
      return () => clearTimeout(timer)
    }
  }, [loadArticles, loadVocabulary, loadDueWords, loadTodaySignals])

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

  /**
   * 下一篇。
   *
   * 2026-09-16：原来用的是 articles 的**全量下标**（currentIndex + 1），
   * 而"下一篇"按钮的 disabled 用的是 displayArticles 的**筛选后下标** ——
   * 两套下标混用，筛选生效时点了画面不动（跳到一篇被筛掉的文章，标题却不变）。
   * 现在统一按筛选后列表走。
   */
  const handleNext = () => {
    const next = displayArticles[displayIndex + 1]
    const nextIdx = next ? articles.findIndex((a) => a.id === next.id) : -1
    if (nextIdx >= 0) {
      setCurrentIndex(nextIdx)
      setVisibleTranslations(new Set())
      preloadWordCache(articles[nextIdx])
    }
  }

  /** 上一篇：同样按筛选后列表走（与按钮的 disabled 口径一致） */
  const handlePrev = () => {
    const prev = displayArticles[displayIndex - 1]
    const prevIdx = prev ? articles.findIndex((a) => a.id === prev.id) : -1
    if (prevIdx >= 0) {
      setCurrentIndex(prevIdx)
      setVisibleTranslations(new Set())
      preloadWordCache(articles[prevIdx])
    }
  }

  const toggleTranslation = (index: number) => {
    setVisibleTranslations(prev => {
      // 一次只展开一个段落的翻译；点击已展开的则收起
      if (prev.has(index)) {
        return new Set()
      }
      return new Set([index])
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

  const clearHoverTimer = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current)
      hoverTimerRef.current = null
    }
    if (leaveTimerRef.current !== null) {
      window.clearTimeout(leaveTimerRef.current)
      leaveTimerRef.current = null
    }
  }, [])

  const handleWordHover = useCallback((word: string, event: React.MouseEvent) => {
    const cleanWord = word.replace(/[^a-zA-Z]/g, '').toLowerCase()
    if (cleanWord.length < 3) {
      clearHoverTimer()
      setHoveredWord(null)
      setTooltipContent(null)
      pendingHoverRef.current = null
      return
    }

    // 检测鼠标是否快速划过：90ms 内移动超过 60px 视为快速移动，不触发查词
    // 避免鼠标快速扫过整行时连续弹出多个 tooltip
    const now = Date.now()
    const dx = event.clientX - lastMousePosRef.current.x
    const dy = event.clientY - lastMousePosRef.current.y
    const dt = now - lastMousePosRef.current.time
    lastMousePosRef.current = { x: event.clientX, y: event.clientY, time: now }

    if (dt > 0 && dt < 90 && (Math.abs(dx) > 60 || Math.abs(dy) > 60)) {
      clearHoverTimer()
      pendingHoverRef.current = null
      return
    }

    // 同单词内移动只更新位置，不重复查询
    if (hoveredWord === cleanWord) {
      setTooltipPosition({ x: event.clientX, y: event.clientY - 10 })
      return
    }

    pendingHoverRef.current = { word: cleanWord, x: event.clientX, y: event.clientY - 10 }
    clearHoverTimer()

    hoverTimerRef.current = window.setTimeout(() => {
      const pending = pendingHoverRef.current
      if (!pending || pending.word !== cleanWord) return

      setHoveredWord(cleanWord)
      setTooltipPosition({ x: pending.x, y: pending.y })

      const cache = wordCacheRef.current
      if (cache.has(cleanWord)) {
        setTooltipContent(cache.get(cleanWord) ?? null)
        return
      }

      window.electronAPI.dictionary.lookup(cleanWord).then(result => {
        cache.set(cleanWord, result)
        // 仅在仍悬停于该单词时更新内容，避免异步结果覆盖新悬停
        if (hoveredWord === cleanWord || pendingHoverRef.current?.word === cleanWord) {
          setTooltipContent(result)
        }
      }).catch(error => {
        console.error('词典查询失败:', error)
        cache.set(cleanWord, null)
      })
    }, 280)
  }, [clearHoverTimer, hoveredWord])

  const handleWordLeave = useCallback(() => {
    clearHoverTimer()
    pendingHoverRef.current = null
    // 如果鼠标移入 tooltip 内容区，保持显示；否则延迟 120ms 隐藏
    // 延迟可消除相邻单词间快速切换导致的闪烁
    if (isOverTooltipRef.current) return
    leaveTimerRef.current = window.setTimeout(() => {
      if (isOverTooltipRef.current) return
      setHoveredWord(null)
      setTooltipContent(null)
    }, 120)
  }, [clearHoverTimer])

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

  /**
   * 关闭右键引导。
   *
   * 两个按钮原来调的是同一个函数（都是"关掉 + 永久记住"），
   * 「稍后再说」和「知道了」在行为上没有任何区别 —— 摆两个按钮等于骗人。
   * 现在分开：知道了 = 以后不再提示；稍后再说 = 本次会话不再弹，下次启动还会提醒。
   */
  const dismissGuide = useCallback((remember: boolean) => {
    setShowGuide(false)
    if (remember) {
      localStorage.setItem('vocab-rightclick-guide', 'true')
    } else {
      sessionStorage.setItem('vocab-rightclick-guide-later', 'true')
    }
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

  /**
   * 提交复习评分。
   * `rating` 是 **ts-fsrs 的 Rating**（1=Again / 2=Hard / 3=Good / 4=Easy），
   * 与生词本复习模式、划线卡片复习页同一口径，不做再映射。
   */
  const handleReviewWord = async (wordId: string, rating: number) => {
    if (reviewSubmitting) return
    setReviewSubmitting(true)
    try {
      await window.electronAPI.vocabulary.updateReviewData(wordId, { quality: rating })
      toast.success(rating >= 3 ? '记住了！' : '继续加油')
      // 评完自动切到下一个到期词（原来固定 setReviewingWord(null) 退回起始页，
      // 20 个待复习词就得点 20 次「开始复习」）。
      const rest = dueWords.filter((w) => w.id !== wordId)
      setReviewingWord(rest.length > 0 ? rest[0] : null)
      await loadVocabulary()
      await loadDueWords()
    } catch (error) {
      console.error('复习失败:', error)
      toast.error('复习失败')
    } finally {
      setReviewSubmitting(false)
    }
  }

  const handleMarkMastered = async (wordId: string) => {
    try {
      // is_mastered 是用户显式意图（不再复习）；评分用 Easy，语义上"这次很轻松"
      await window.electronAPI.vocabulary.updateReviewData(wordId, { quality: 4, isMastered: true })
      toast.success('已标记为掌握')
      await loadVocabulary()
      await loadDueWords()
    } catch (error) {
      console.error('标记掌握失败:', error)
    }
  }

  const handleDeleteVocab = async (wordId: string) => {
    // 删词不可恢复，先问一句（右键菜单里的"删除"离"复制单词"只有一行距离）
    if (!window.confirm('确定从生词本删除这个词？')) return
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

  // 2026-09-16：「筛不到就显示全部」等于让筛选器说谎 —— 用户点了筛选，看到的是全部文章，
  // 只会以为筛选坏了。现在永远用筛选结果，空态交给渲染层（文章列表那里有无匹配提示）。
  const displayArticles = filteredArticles
  const displayIndex = displayArticles.findIndex((a) => a.id === articles[currentIndex]?.id)
  /**
   * 当前正在读的文章。
   * 注意：displayIndex < 0（当前这篇不在筛选结果里）时不能 fallback 到 displayArticles[0] ——
   * 那会让顶部标题显示 A、正文却是 B。这里直接回退到 articles[currentIndex]。
   */
  const currentArticle =
    displayIndex >= 0 ? displayArticles[displayIndex] : articles[currentIndex] ?? articles[0]

  // ===== Dashboard 派生数据 =====

  /**
   * 今日任务清单。
   *
   * 规则本身在 `src/shared/daily-tasks.ts`（纯函数，被 `tests/daily-tasks.test.ts` 钉着），
   * 这里只负责把**页面已经加载到的真实数据**喂进去。
   * 一句话规矩：**每个任务都必须有"系统自己知道做没做"的判定依据** ——
   * 没有依据的事不进这张清单（详见纯模块的文件头注释）。
   */
  const tasks = useMemo<DailyTask[]>(() => {
    // 生成规则见纯模块；这里只做数据适配
    const pending = vocabulary.filter((v) => !v.is_mastered).length
    const learnedToday = vocabulary.filter(
      (v) => String(v.last_review_at ?? '').slice(0, 10) === todayStr,
    ).length
    return buildDailyTasks({
      articles: articles.map((a) => ({
        id: a.id,
        titleEn: a.title_en,
        isRead: a.is_read,
        wordCount: (a.content_en || '').trim().split(/\s+/).filter(Boolean).length,
      })),
      queue,
      vocabulary: { total: vocabulary.length, pending, learnedToday },
      chattedToday,
      cardsReviewedToday: todayStats?.cardsReviewed ?? 0,
    })
  }, [articles, vocabulary, queue, todayStats, chattedToday, todayStr])

  const { completed: completedCount, total: totalCount, percent: progressPct } = summarizeDailyTasks(tasks)
  // 今日日期（中文星期名内联计算）
  const today = new Date()
  const weekdayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
  const subtitleDate = `${today.getFullYear()} 年 ${today.getMonth() + 1} 月 ${today.getDate()} 日 · ${weekdayNames[today.getDay()]}`

  // ===== Dashboard 任务交互 =====

  /** 每个任务都指向一个**真实去处**（不再有"点了弹个提示就算完成"的项） */
  const handleTaskClick = (task: DailyTask) => {
    switch (task.action) {
      case 'article': {
        const index = task.articleIndex ?? -1
        const article = articles[index]
        if (!article) return
        setCurrentIndex(index)
        setVisibleTranslations(new Set())
        preloadWordCache(article)
        setView('article')
        return
      }
      case 'review':
        navigate('/review')
        return
      case 'vocab':
        setShowVocabPanel(true)
        return
      case 'chat':
        navigate('/chat')
        return
      case 'fetch':
        void handleFetchRss()
        return
    }
  }

  const handleStartToday = () => {
    const firstUndone = firstUnfinishedTask(tasks)
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
          subtitle={`${currentArticle.source} · ${DIFFICULTY_LABELS[currentArticle.difficulty as DifficultyFilter] ?? currentArticle.difficulty} · ${
          displayIndex >= 0
            ? `第 ${displayIndex + 1} / ${displayArticles.length} 篇`
            : '这篇不在当前筛选内'
        }`}
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
                      <p style={{ margin: '0 0 0.6em 0', fontSize: '1.1rem', lineHeight: 1.85, color: 'var(--foreground)', flex: 1, whiteSpace: 'pre-wrap', textIndent: '2em', textAlign: 'justify' }}>
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
                        <p style={{ margin: '0 0 0.6em 0', fontSize: '1.1rem', lineHeight: 1.85, color: 'var(--foreground)', whiteSpace: 'pre-wrap', textIndent: '2em', textAlign: 'justify' }}>
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
            reviewSubmitting={reviewSubmitting}
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
            // 传筛选后的清单（传 articles 会让"筛了跟没筛一样"）
            articles={displayArticles}
            currentArticleId={currentArticle.id}
            onSelect={handleSelectArticle}
            onClose={() => setShowArticleList(false)}
            filtered={filteredArticles.length !== articles.length}
            onClearFilters={() => {
              setDifficultyFilter('all')
              setStatusFilter('all')
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
                  // 原来没有 catch：复制失败也会弹「已复制到剪贴板」
                  navigator.clipboard
                    .writeText(contextMenu.word)
                    .then(() => toast.success('已复制到剪贴板'))
                    .catch(() => toast.error('复制失败，请手动选中复制'))
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
                <Button variant="ghost" onClick={() => dismissGuide(false)}>稍后再说</Button>
                <Button variant="primary" onClick={() => dismissGuide(true)}>知道了</Button>
              </div>
            </div>
          </div>
        )}

        {/* 单词悬停提示框 */}
        {hoveredWord && (
          <div
            style={{
              position: 'fixed',
              // 水平居中于鼠标，限制在视口内
              left: Math.min(Math.max(tooltipPosition.x - 160, 12), window.innerWidth - 332),
              // 上方空间足够时置于鼠标上方，否则置于下方，避免遮挡单词导致闪烁
              top: tooltipPosition.y > 170 ? tooltipPosition.y - 150 : tooltipPosition.y + 20,
              zIndex: 50,
              maxWidth: 320,
              pointerEvents: 'none',
            }}
          >
            <div
              onMouseEnter={() => { isOverTooltipRef.current = true }}
              onMouseLeave={() => {
                isOverTooltipRef.current = false
                handleWordLeave()
              }}
              style={{
                background: 'var(--popover)',
                border: '1px solid var(--border)',
                borderRadius: 'calc(var(--radius) + 4px)',
                boxShadow: 'var(--shadow-xl)',
                overflow: 'hidden',
                pointerEvents: 'auto',
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
        {/* ===== 第一层：两栏看板（进度环 + 任务清单） ===== */}
        <div
          className="grid daily"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 2fr',
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
                {/* 这两块原来写的是「已用时间 / 预计剩余」，但那两个数字是**编的**：
                    只是把写死的 30/15/10 分钟按勾选状态加起来，没有任何计时器。
                    换成今天真实发生的两件事（口径与统计页一致）。 */}
                <div style={{ padding: 'calc(var(--spacing) * 3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--background)', textAlign: 'left' }}>
                  <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>今天已复习</span>
                  <strong style={{ display: 'block', marginTop: '0.3rem', fontFamily: 'var(--font-mono)', fontSize: '1.05rem', fontVariantNumeric: 'tabular-nums', color: 'var(--foreground)', fontWeight: 700 }}>{todayStats ? `${todayStats.cardsReviewed}` : '—'}<span style={{ fontSize: '0.75rem', marginLeft: '0.15rem', color: 'var(--muted-foreground)' }}>张</span></strong>
                </div>
                <div style={{ padding: 'calc(var(--spacing) * 3)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--background)', textAlign: 'left' }}>
                  <span style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)' }}>今天已阅读</span>
                  <strong style={{ display: 'block', marginTop: '0.3rem', fontFamily: 'var(--font-mono)', fontSize: '1.05rem', fontVariantNumeric: 'tabular-nums', color: 'var(--foreground)', fontWeight: 700 }}>{todayStats ? Math.round(todayStats.readingSeconds / 60) : '—'}<span style={{ fontSize: '0.75rem', marginLeft: '0.15rem', color: 'var(--muted-foreground)' }}>分钟</span></strong>
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
              {tasks.map((task) => {
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
                    {/* 状态点只表示**状态**，不再可点。
                        原来这行里嵌了一个会 toggle 的 span（按钮里套按钮），
                        配合 localStorage 里的手点覆盖，可以让"没做的事"显示成已完成 ——
                        进度环于是变成一个自欺欺人的数字。现在完成与否只由真实数据说了算。
                        另外：这里必须是三元而不是 `&&` —— 数据库的 0/1 让
                        `{0 && <Icon/>}` 求值成数字 0，React 会把它当文本画出来（就是那个「0」）。 */}
                    <span
                      aria-hidden="true"
                      style={{
                        width: 22,
                        height: 22,
                        border: '2px solid',
                        borderColor: task.done ? 'var(--state-success)' : 'var(--border)',
                        borderRadius: '50%',
                        flexShrink: 0,
                        marginTop: '0.1rem',
                        display: 'grid',
                        placeItems: 'center',
                        background: task.done ? 'var(--state-success)' : 'var(--card)',
                        transition: 'background 0.2s ease, border-color 0.2s ease',
                      }}
                    >
                      {task.done ? (
                        <Icon name="check" size={13} style={{ stroke: 'var(--primary-foreground)', strokeWidth: 3 }} />
                      ) : null}
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
                        <span>{task.meta}</span>
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
                    {/* 未完成时给一个"点了会去哪"的提示；完成了就不再催 */}
                    {task.done ? null : (
                      <Icon name="chevron-right" size={16} style={{ color: 'var(--muted-foreground)', flexShrink: 0, alignSelf: 'center' }} />
                    )}
                  </button>
                )
              })}
            </div>
          </Card>
        </div>
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
          reviewSubmitting={reviewSubmitting}
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
              <Button variant="ghost" onClick={() => dismissGuide(false)}>稍后再说</Button>
              <Button variant="primary" onClick={() => dismissGuide(true)}>知道了</Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
