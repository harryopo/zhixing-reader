/**
 * VocabularyPage — 生词本（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/vocabulary.html + vocabulary-drawer.html
 *
 * 三种状态：
 *   1. 默认态：双栏布局（左列表 + 右快速详情 sticky 卡片）
 *   2. 抽屉态：点击列表项 / "详情"按钮，打开右侧 420px 抽屉（含完整词典信息 + 掌握度进度条）
 *   3. 复习态：覆盖整页的复习模式（4 评分按钮，FSRS 评分提交）
 *
 * 业务逻辑全部保留：vocabulary.* IPC、复习模式、搜索、tab 筛选、添加/删除/标记掌握/加入复习
 */

import { useState, useEffect, useCallback, useMemo, CSSProperties } from 'react'
import PageHero from '@/components/layout/PageHero'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { Loading, EmptyState } from '@/components/ui/Feedback'
import { toast } from '../stores/toastStore'

// ===== 类型定义 =====
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

enum ReviewRating {
  AGAIN = 1, // 完全忘记
  HARD = 3, // 困难想起
  GOOD = 4, // 正常想起
  EASY = 5, // 轻松想起
}

// ===== 常量 =====
type FilterKey = 'all' | 'due' | 'mastered' | 'unmastered'
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'due', label: '待复习' },
  { key: 'mastered', label: '已掌握' },
  // schema 无 favorite：用未掌握代替设计稿「收藏」，避免假 toast
  { key: 'unmastered', label: '未掌握' },
]

type MasteryKind = 'pending' | 'mastered' | 'new'

// ===== 工具函数 =====

/** 根据单词状态推导 mastery 类型 */
function getMasteryKind(item: VocabularyItem): MasteryKind {
  if (item.is_mastered === 1) return 'mastered'
  if ((item.learning_stage ?? 0) === 0 && (item.review_count ?? 0) === 0) return 'new'
  return 'pending'
}

/** mastery 标签 */
function masteryLabel(kind: MasteryKind): string {
  switch (kind) {
    case 'mastered':
      return '已掌握'
    case 'new':
      return '新增'
    case 'pending':
    default:
      return '待复习'
  }
}

/** 计算下次复习时间显示 */
function getNextReviewText(nextReview?: string): string {
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

/** 格式化日期（YYYY-MM-DD） */
function formatDateOnly(val?: string): string {
  if (!val) return '-'
  try {
    const d = new Date(val)
    if (isNaN(d.getTime())) return '-'
    return d.toISOString().split('T')[0]
  } catch {
    return '-'
  }
}

/** 计算掌握度百分比（基于 familiarity_level 0-5 + is_mastered） */
function calcMasteryPct(item: VocabularyItem): number {
  if (item.is_mastered === 1) return 100
  const fam = item.familiarity_level ?? 0
  return Math.min(100, Math.round((fam / 5) * 100))
}

/** 根据掌握度选状态色 */
function masteryStatusColor(pct: number): string {
  if (pct >= 80) return 'var(--state-success)'
  if (pct >= 40) return 'var(--state-warning)'
  return 'var(--state-error)'
}

/** 根据掌握度选状态标签 */
function masteryStatusLabel(pct: number): string {
  if (pct >= 80) return '已掌握'
  if (pct >= 40) return '学习中'
  return '入门'
}

// ===== 主组件 =====
export default function VocabularyPage() {
  // 列表 + 统计
  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([])
  const [stats, setStats] = useState({ total: 0, mastered: 0, dueToday: 0 })
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<FilterKey>('all')
  const [searchKeyword, setSearchKeyword] = useState('')

  // 选中的单词（右侧详情）
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // 抽屉
  const [drawerOpen, setDrawerOpen] = useState(false)

  // 复习模式
  const [reviewMode, setReviewMode] = useState(false)
  const [currentReviewIndex, setCurrentReviewIndex] = useState(0)
  const [showAnswer, setShowAnswer] = useState(false)
  const [reviewList, setReviewList] = useState<VocabularyItem[]>([])
  const [reviewStats, setReviewStats] = useState({ correct: 0, total: 0 })

  // ===== 数据加载 =====
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
        result = (all as unknown as VocabularyItem[]).filter((v) => v.is_mastered === 1)
      } else if (activeTab === 'unmastered') {
        result = await window.electronAPI.vocabulary.getUnmastered(200)
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

  // 选中单词的派生数据（未选时 fallback 到第一个）
  const selectedItem = useMemo(() => {
    if (!selectedId) return vocabulary[0] ?? null
    return vocabulary.find((v) => v.id === selectedId) ?? null
  }, [selectedId, vocabulary])

  // ===== 业务逻辑 =====

  /** 搜索 */
  const handleSearch = async () => {
    if (!window.electronAPI?.vocabulary) return
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
      toast.error('搜索失败')
    }
  }

  /** 添加生词（通过词典查询） */
  const handleAddWord = async () => {
    if (!window.electronAPI?.vocabulary) return
    const word = window.prompt('请输入要添加的英文单词：')
    if (!word || !word.trim()) return
    try {
      const result = await window.electronAPI.vocabulary.createFromLookup(
        word.trim().toLowerCase(),
        '手动添加',
      )
      if (result === null) {
        toast.info(`"${word}" 已在生词本中`)
      } else {
        toast.success(`已添加 "${word}"`)
        await loadVocabulary()
      }
    } catch (error) {
      console.error('添加失败:', error)
      toast.error(error instanceof Error ? error.message : '添加失败')
    }
  }

  /** 批量导入：每行一个英文词 → createFromLookup */
  const handleBatchImport = async () => {
    if (!window.electronAPI?.vocabulary) {
      toast.error('生词接口不可用')
      return
    }
    const raw = window.prompt('批量导入：每行一个英文单词（最多 50 个）')
    if (raw === null || !raw.trim()) return
    const words = [
      ...new Set(
        raw
          .split(/[\n,，;；\s]+/)
          .map((w) => w.trim().toLowerCase())
          .filter((w) => /^[a-z][a-z'-]*$/i.test(w)),
      ),
    ].slice(0, 50)
    if (words.length === 0) {
      toast.info('未识别到有效英文单词')
      return
    }
    let added = 0
    let skipped = 0
    let failed = 0
    for (const word of words) {
      try {
        const result = await window.electronAPI.vocabulary.createFromLookup(word, '批量导入')
        if (result === null) skipped++
        else added++
      } catch {
        failed++
      }
    }
    await loadVocabulary()
    toast.success(`导入完成：新增 ${added} · 已存在 ${skipped} · 失败 ${failed}`)
  }

  /** 删除生词 */
  const handleDelete = async (id: string, word: string) => {
    if (!window.electronAPI?.vocabulary) return
    if (!window.confirm(`确定要删除 "${word}" 吗？`)) return
    try {
      await window.electronAPI.vocabulary.delete(id)
      toast.success('已删除')
      setDrawerOpen(false)
      if (selectedId === id) setSelectedId(null)
      await loadVocabulary()
    } catch (error) {
      console.error('删除失败:', error)
      toast.error('删除失败')
    }
  }

  /** 标记已掌握 */
  const handleMarkMastered = async (id: string) => {
    if (!window.electronAPI?.vocabulary) return
    try {
      await window.electronAPI.vocabulary.markAsMastered(id)
      toast.success('已标记为掌握')
      await loadVocabulary()
    } catch (error) {
      console.error('标记掌握失败:', error)
      toast.error('标记掌握失败')
    }
  }

  /** 加入复习（立即触发一次 GOOD 评分，将其纳入复习队列） */
  const handleAddReview = async (id: string) => {
    if (!window.electronAPI?.vocabulary) return
    try {
      await window.electronAPI.vocabulary.updateReviewData(id, { quality: ReviewRating.GOOD })
      toast.success('已加入复习队列')
      await loadVocabulary()
    } catch (error) {
      console.error('加入复习失败:', error)
      toast.error('加入复习失败')
    }
  }

  /** 朗读单词（Web Speech API） */
  const handlePronounce = (word: string) => {
    try {
      if ('speechSynthesis' in window) {
        const utter = new SpeechSynthesisUtterance(word)
        utter.lang = 'en-US'
        utter.rate = 0.9
        window.speechSynthesis.cancel()
        window.speechSynthesis.speak(utter)
      } else {
        toast.info('当前环境不支持语音合成')
      }
    } catch (error) {
      console.error('朗读失败:', error)
    }
  }

  /** 开始复习模式 */
  const startReview = async () => {
    if (!window.electronAPI?.vocabulary) return
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

  /** 提交复习评分 */
  const submitReview = async (rating: ReviewRating) => {
    if (!window.electronAPI?.vocabulary) return
    const currentWord = reviewList[currentReviewIndex]
    if (!currentWord) return
    try {
      await window.electronAPI.vocabulary.updateReviewData(currentWord.id, {
        quality: rating,
      })

      const newCorrect = reviewStats.correct + (rating >= ReviewRating.GOOD ? 1 : 0)
      const newTotal = reviewStats.total + 1
      setReviewStats({ correct: newCorrect, total: newTotal })

      if (currentReviewIndex < reviewList.length - 1) {
        setCurrentReviewIndex((prev) => prev + 1)
        setShowAnswer(false)
      } else {
        const pct = Math.round((newCorrect / newTotal) * 100)
        toast.success(`复习完成！正确率: ${pct}%`)
        setReviewMode(false)
        await loadVocabulary()
      }
    } catch (error) {
      console.error('提交复习失败:', error)
      toast.error('提交复习失败')
    }
  }

  // ===== 渲染 =====
  if (loading) {
    return <Loading hint="正在加载生词本..." />
  }

  // ===== 复习模式 UI =====
  if (reviewMode && reviewList.length > 0) {
    const currentWord = reviewList[currentReviewIndex]
    const progress = ((currentReviewIndex + 1) / reviewList.length) * 100
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          background: 'var(--background)',
        }}
      >
        {/* 复习头部 */}
        <div
          style={{
            borderBottom: '1px solid var(--border)',
            padding: 'calc(var(--spacing) * 4) calc(var(--spacing) * 6)',
            background: 'var(--card)',
            flexShrink: 0,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              maxWidth: 720,
              margin: '0 auto',
              gap: 'calc(var(--spacing) * 4)',
            }}
          >
            <Button variant="ghost" onClick={() => setReviewMode(false)}>
              <Icon name="close" size={16} /> 退出
            </Button>
            <div style={{ flex: 1 }}>
              <div
                style={{
                  height: 8,
                  background: 'var(--muted)',
                  borderRadius: 999,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${progress}%`,
                    background: 'var(--primary)',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>
            <span
              style={{
                fontSize: '0.85rem',
                color: 'var(--muted-foreground)',
                fontFamily: 'var(--font-mono)',
                whiteSpace: 'nowrap',
              }}
            >
              {currentReviewIndex + 1} / {reviewList.length}
            </span>
          </div>
        </div>

        {/* 复习卡片 */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 'calc(var(--spacing) * 6)',
          }}
        >
          <div style={{ width: '100%', maxWidth: 560 }}>
            <Card style={{ textAlign: 'center', marginBottom: 'calc(var(--spacing) * 5)' }}>
              <h2
                style={{
                  margin: 0,
                  fontSize: '2rem',
                  fontWeight: 700,
                  color: 'var(--foreground)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {currentWord.word}
              </h2>
              {currentWord.phonetic && (
                <p
                  style={{
                    margin: '0.5rem 0 0',
                    fontSize: '1rem',
                    color: 'var(--muted-foreground)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {currentWord.phonetic}
                </p>
              )}

              {!showAnswer ? (
                <div style={{ marginTop: 'calc(var(--spacing) * 6)' }}>
                  <p
                    style={{
                      color: 'var(--muted-foreground)',
                      marginBottom: 'calc(var(--spacing) * 4)',
                    }}
                  >
                    先回忆一下这个单词的意思...
                  </p>
                  <Button variant="primary" onClick={() => setShowAnswer(true)}>
                    显示答案
                  </Button>
                </div>
              ) : (
                <div
                  className="animate-fade-in"
                  style={{ marginTop: 'calc(var(--spacing) * 5)' }}
                >
                  {currentWord.part_of_speech && (
                    <Badge
                      variant="ok"
                      style={{ marginBottom: 'calc(var(--spacing) * 3)' }}
                    >
                      {currentWord.part_of_speech}
                    </Badge>
                  )}
                  <p
                    style={{
                      fontSize: '1.1rem',
                      color: 'var(--foreground)',
                      margin: '0 0 calc(var(--spacing) * 4)',
                    }}
                  >
                    {currentWord.meaning_zh}
                  </p>
                  {currentWord.example_en && (
                    <div
                      style={{
                        background: 'var(--muted)',
                        borderRadius: 'var(--radius)',
                        padding: 'calc(var(--spacing) * 4)',
                        textAlign: 'left',
                      }}
                    >
                      <p
                        style={{
                          margin: 0,
                          fontStyle: 'italic',
                          color: 'var(--foreground)',
                        }}
                      >
                        {currentWord.example_en}
                      </p>
                      {currentWord.example_zh && (
                        <p
                          style={{
                            margin: '0.5rem 0 0',
                            fontSize: '0.85rem',
                            color: 'var(--muted-foreground)',
                          }}
                        >
                          {currentWord.example_zh}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </Card>

            {showAnswer && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(4, 1fr)',
                  gap: 'calc(var(--spacing) * 3)',
                }}
              >
                <ReviewRatingButton
                  rating={ReviewRating.AGAIN}
                  label="忘记"
                  color="error"
                  onClick={submitReview}
                />
                <ReviewRatingButton
                  rating={ReviewRating.HARD}
                  label="困难"
                  color="warning"
                  onClick={submitReview}
                />
                <ReviewRatingButton
                  rating={ReviewRating.GOOD}
                  label="良好"
                  color="info"
                  onClick={submitReview}
                />
                <ReviewRatingButton
                  rating={ReviewRating.EASY}
                  label="简单"
                  color="success"
                  onClick={submitReview}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ===== 主页面 =====
  return (
    <>
      <PageHero
        title="生词本"
        subtitle={`共 ${stats.total} 个生词 · 待复习 ${stats.dueToday} 个`}
        actions={
          <>
            <Button variant="primary" onClick={handleAddWord} data-dom-id="cta-add">
              <Icon name="plus" size={16} /> 添加生词
            </Button>
            <Button
              variant="secondary"
              onClick={startReview}
              disabled={stats.dueToday === 0}
              data-dom-id="cta-review"
            >
              <Icon name="refresh" size={16} /> 开始复习
            </Button>
            <Button
              variant="ghost"
              onClick={() => void handleBatchImport()}
              data-dom-id="cta-import"
            >
              <Icon name="file" size={16} /> 导入
            </Button>
          </>
        }
      >
        {/* 双栏布局：左列表 + 右快速详情 */}
        <div
          className="vocab-page-body"
          style={{
            display: 'grid',
            gridTemplateColumns: '1.6fr 1fr',
            gap: 'calc(var(--spacing) * 5)',
            alignItems: 'start',
          }}
        >
          {/* ===== 左：vocab-table 卡片 ===== */}
          <Card
            padding={0}
            style={{ overflow: 'hidden', display: 'flex', flexDirection: 'column' }}
          >
            {/* head bar：chips + search */}
            <div
              style={{
                padding: 'calc(var(--spacing) * 4) calc(var(--spacing) * 5)',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 'calc(var(--spacing) * 4)',
                flexWrap: 'wrap',
              }}
            >
              <FilterChips value={activeTab} onChange={setActiveTab} />
              <input
                type="search"
                placeholder="搜索单词..."
                aria-label="搜索单词"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch()
                }}
                style={{
                  width: 180,
                  padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 3)',
                  border: '1px solid var(--input)',
                  borderRadius: 'var(--radius)',
                  background: 'var(--popover)',
                  fontSize: '0.82rem',
                  color: 'var(--foreground)',
                  outline: 'none',
                  fontFamily: 'inherit',
                }}
              />
            </div>

            {/* body: vocab-list */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 'calc(var(--spacing) * 3)',
                maxHeight: 'calc(100vh - 280px)',
              }}
            >
              {vocabulary.length === 0 ? (
                <EmptyState
                  icon={<Icon name="vocabulary" size={24} />}
                  title={
                    activeTab === 'due'
                      ? '没有待复习的单词'
                      : activeTab === 'mastered'
                        ? '还没有掌握的单词'
                        : '生词本为空'
                  }
                  description={
                    activeTab === 'due'
                      ? '继续阅读文章，遇到生词即可添加到生词本'
                      : '点击上方"添加生词"按钮，或在阅读时右键点击单词'
                  }
                />
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'calc(var(--spacing) * 2)',
                  }}
                >
                  {vocabulary.map((item) => {
                    const kind = getMasteryKind(item)
                    const active = selectedItem?.id === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        data-dom-id={`vocab-item-${item.id}`}
                        onClick={() => setSelectedId(item.id)}
                        style={{
                          width: '100%',
                          padding: 'calc(var(--spacing) * 3.5) calc(var(--spacing) * 4)',
                          textAlign: 'left',
                          border: '1px solid',
                          borderColor: active ? 'var(--primary)' : 'var(--border)',
                          borderRadius: 'var(--radius)',
                          background: active ? 'var(--popover)' : 'var(--background)',
                          cursor: 'pointer',
                          transition:
                            'border-color 0.2s ease, background 0.2s ease, transform 0.16s ease',
                          display: 'grid',
                          gridTemplateColumns: '1.5fr 2fr 0.8fr 0.7fr',
                          gap: 'calc(var(--spacing) * 3)',
                          alignItems: 'center',
                          font: 'inherit',
                          color: 'inherit',
                        }}
                        onMouseEnter={(e) => {
                          if (!active) {
                            e.currentTarget.style.borderColor = 'var(--ring)'
                            e.currentTarget.style.background = 'var(--popover)'
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!active) {
                            e.currentTarget.style.borderColor = 'var(--border)'
                            e.currentTarget.style.background = 'var(--background)'
                          }
                        }}
                        onMouseDown={(e) => {
                          e.currentTarget.style.transform = 'scale(0.99)'
                        }}
                        onMouseUp={(e) => {
                          e.currentTarget.style.transform = 'scale(1)'
                        }}
                      >
                        <span
                          style={{
                            fontSize: '1rem',
                            fontWeight: 600,
                            fontFamily: 'var(--font-mono)',
                            color: 'var(--card-foreground)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.word}
                        </span>
                        <span
                          style={{
                            fontSize: '0.88rem',
                            color: 'var(--muted-foreground)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.meaning_zh}
                        </span>
                        <span
                          style={{
                            fontSize: '0.78rem',
                            color: 'var(--muted-foreground)',
                            fontFamily: 'var(--font-mono)',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.source ? `《${item.source}》` : '—'}
                        </span>
                        <MasteryBadge kind={kind} />
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </Card>

          {/* ===== 右：vocab-detail 卡片（快速详情） ===== */}
          {selectedItem ? (
            <Card
              style={{
                position: 'sticky',
                top: 'calc(var(--spacing) * 4)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'calc(var(--spacing) * 4)',
                alignSelf: 'start',
              }}
            >
              {/* head：word + phonetic + play-btn */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'space-between',
                  gap: 'calc(var(--spacing) * 3)',
                }}
              >
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: '1.5rem',
                      fontWeight: 700,
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--card-foreground)',
                      wordBreak: 'break-all',
                    }}
                  >
                    {selectedItem.word}
                  </div>
                  {selectedItem.phonetic && (
                    <div
                      style={{
                        fontSize: '0.88rem',
                        color: 'var(--muted-foreground)',
                        fontFamily: 'var(--font-mono)',
                        marginTop: '0.4rem',
                      }}
                    >
                      {selectedItem.phonetic}
                    </div>
                  )}
                </div>
                <IconButton
                  dataDomId="cta-pronounce"
                  ariaLabel="发音"
                  onClick={() => handlePronounce(selectedItem.word)}
                >
                  <Icon name="play" size={16} />
                </IconButton>
              </div>

              {/* 释义 section */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={eyebrowStyle}>释义</div>
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 'calc(var(--spacing) * 2)',
                    marginTop: 'calc(var(--spacing) * 2)',
                  }}
                >
                  <div
                    style={{
                      padding: 'calc(var(--spacing) * 3)',
                      background: 'var(--background)',
                      borderRadius: 'var(--radius)',
                      borderLeft: '3px solid var(--chart-1)',
                      fontSize: '0.9rem',
                      color: 'var(--card-foreground)',
                      lineHeight: 1.55,
                    }}
                  >
                    {selectedItem.part_of_speech && (
                      <span
                        style={{
                          fontWeight: 600,
                          color: 'var(--foreground)',
                          marginRight: '0.3rem',
                        }}
                      >
                        {selectedItem.part_of_speech}
                      </span>
                    )}
                    {selectedItem.meaning_zh}
                  </div>
                </div>
              </div>

              {/* 例句 section */}
              {selectedItem.example_en && (
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <div style={eyebrowStyle}>例句</div>
                  <p
                    style={{
                      fontSize: '0.92rem',
                      lineHeight: 1.7,
                      color: 'var(--card-foreground)',
                      marginTop: 'calc(var(--spacing) * 2)',
                      fontStyle: 'italic',
                      margin: 'calc(var(--spacing) * 2) 0 0 0',
                    }}
                  >
                    {selectedItem.example_en}
                  </p>
                  {selectedItem.example_zh && (
                    <p
                      style={{
                        fontSize: '0.82rem',
                        color: 'var(--muted-foreground)',
                        marginTop: '0.5rem',
                        lineHeight: 1.6,
                      }}
                    >
                      {selectedItem.example_zh}
                    </p>
                  )}
                </div>
              )}

              {/* 来源 section */}
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={eyebrowStyle}>来源</div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'calc(var(--spacing) * 3)',
                    marginTop: 'calc(var(--spacing) * 2)',
                    padding: 'calc(var(--spacing) * 3)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                  }}
                >
                  <div
                    style={{
                      width: 40,
                      height: 56,
                      borderRadius: 4,
                      background: 'var(--chart-1)',
                      flexShrink: 0,
                    }}
                    aria-hidden="true"
                  />
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <strong
                      style={{
                        display: 'block',
                        fontSize: '0.9rem',
                        color: 'var(--card-foreground)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {selectedItem.source || '手动添加'}
                    </strong>
                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--muted-foreground)',
                        fontFamily: 'var(--font-mono)',
                        marginTop: '0.2rem',
                      }}
                    >
                      复习 {selectedItem.review_count} 次 ·{' '}
                      {getNextReviewText(selectedItem.next_review_at)}
                    </div>
                  </div>
                </div>
              </div>

              {/* 操作按钮 */}
              <div
                style={{
                  display: 'flex',
                  gap: 'calc(var(--spacing) * 3)',
                  flexWrap: 'wrap',
                }}
              >
                <Button
                  variant="primary"
                  data-dom-id="cta-add-review"
                  onClick={() => handleAddReview(selectedItem.id)}
                >
                  加入复习
                </Button>
                <Button
                  variant="secondary"
                  data-dom-id="cta-master"
                  onClick={() => handleMarkMastered(selectedItem.id)}
                >
                  标记掌握
                </Button>
                <Button
                  variant="ghost"
                  data-dom-id="cta-edit-word"
                  onClick={() => setDrawerOpen(true)}
                >
                  <Icon name="edit" size={14} /> 详情
                </Button>
              </div>
            </Card>
          ) : (
            <Card
              style={{
                position: 'sticky',
                top: 'calc(var(--spacing) * 4)',
                alignSelf: 'start',
              }}
            >
              <EmptyState
                icon={<Icon name="vocabulary" size={24} />}
                title="选择一个单词查看详情"
                description="点击左侧列表中的任意单词，此处将展示它的释义、例句与来源。"
              />
            </Card>
          )}
        </div>
      </PageHero>

      {/* ===== 抽屉（深度详情） ===== */}
      {drawerOpen && selectedItem && (
        <VocabularyDrawer
          item={selectedItem}
          onClose={() => setDrawerOpen(false)}
          onPronounce={handlePronounce}
          onAddReview={handleAddReview}
          onMarkMastered={handleMarkMastered}
          onDelete={handleDelete}
        />
      )}
    </>
  )
}

// ===== 子组件：Filter Chips =====
interface FilterChipsProps {
  value: FilterKey
  onChange: (v: FilterKey) => void
}
function FilterChips({ value, onChange }: FilterChipsProps) {
  return (
    <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 2)', flexWrap: 'wrap' }}>
      {FILTERS.map((item) => {
        const active = item.key === value
        return (
          <button
            key={item.key}
            type="button"
            data-active={active ? 'true' : undefined}
            onClick={() => onChange(item.key)}
            style={{
              padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 4)',
              border: '1px solid',
              borderColor: active ? 'var(--primary)' : 'var(--border)',
              background: active ? 'var(--primary)' : 'var(--card)',
              color: active ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              transition:
                'background 0.2s ease, color 0.2s ease, border-color 0.2s ease, transform 0.16s ease',
              fontSize: '0.84rem',
              whiteSpace: 'nowrap',
              font: 'inherit',
            }}
            onMouseEnter={(e) => {
              if (!active) {
                e.currentTarget.style.borderColor = 'var(--ring)'
                e.currentTarget.style.color = 'var(--foreground)'
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                e.currentTarget.style.borderColor = 'var(--border)'
                e.currentTarget.style.color = 'var(--muted-foreground)'
              }
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.97)'
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            {item.label}
          </button>
        )
      })}
    </div>
  )
}

// ===== 子组件：Mastery Badge =====
function MasteryBadge({ kind }: { kind: MasteryKind }) {
  const colors: Record<MasteryKind, { bg: string; color: string }> = {
    pending: {
      bg: 'color-mix(in srgb, var(--state-error) 12%, transparent)',
      color: 'var(--state-error)',
    },
    mastered: {
      bg: 'color-mix(in srgb, var(--state-success) 14%, transparent)',
      color: 'var(--state-success)',
    },
    new: {
      bg: 'color-mix(in srgb, var(--state-info) 12%, transparent)',
      color: 'var(--state-info)',
    },
  }
  const c = colors[kind]
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0.28rem 0.6rem',
        borderRadius: 999,
        fontSize: '0.75rem',
        whiteSpace: 'nowrap',
        justifySelf: 'end',
        fontWeight: 600,
        background: c.bg,
        color: c.color,
      }}
    >
      {masteryLabel(kind)}
    </span>
  )
}

// ===== 子组件：复习评分按钮 =====
interface ReviewRatingButtonProps {
  rating: ReviewRating
  label: string
  color: 'error' | 'warning' | 'info' | 'success'
  onClick: (r: ReviewRating) => void
}
function ReviewRatingButton({ rating, label, color, onClick }: ReviewRatingButtonProps) {
  const colorMap: Record<ReviewRatingButtonProps['color'], string> = {
    error: 'var(--state-error)',
    warning: 'var(--state-warning)',
    info: 'var(--state-info)',
    success: 'var(--state-success)',
  }
  const c = colorMap[color]
  return (
    <button
      type="button"
      onClick={() => onClick(rating)}
      style={{
        padding: 'calc(var(--spacing) * 4) calc(var(--spacing) * 3)',
        background: `color-mix(in srgb, ${c} 12%, transparent)`,
        color: c,
        border: '1px solid transparent',
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        fontWeight: 500,
        font: 'inherit',
        transition: 'background 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = `color-mix(in srgb, ${c} 20%, transparent)`
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = `color-mix(in srgb, ${c} 12%, transparent)`
      }}
    >
      <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>{label}</div>
    </button>
  )
}

// ===== 子组件：IconButton（小型图标按钮，如发音按钮） =====
interface IconButtonProps {
  children: React.ReactNode
  onClick: () => void
  ariaLabel: string
  dataDomId?: string
}
function IconButton({ children, onClick, ariaLabel, dataDomId }: IconButtonProps) {
  return (
    <button
      type="button"
      data-dom-id={dataDomId}
      aria-label={ariaLabel}
      onClick={onClick}
      style={{
        width: 36,
        height: 36,
        display: 'grid',
        placeItems: 'center',
        border: '1px solid var(--border)',
        background: 'var(--card)',
        color: 'var(--foreground)',
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        flexShrink: 0,
        transition:
          'background 0.2s ease, color 0.2s ease, border-color 0.2s ease, transform 0.16s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--sidebar-accent)'
        e.currentTarget.style.color = 'var(--sidebar-accent-foreground)'
        e.currentTarget.style.borderColor = 'var(--sidebar-border)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--card)'
        e.currentTarget.style.color = 'var(--foreground)'
        e.currentTarget.style.borderColor = 'var(--border)'
      }}
      onMouseDown={(e) => {
        e.currentTarget.style.transform = 'scale(0.97)'
      }}
      onMouseUp={(e) => {
        e.currentTarget.style.transform = 'scale(1)'
      }}
    >
      {children}
    </button>
  )
}

// ===== 子组件：抽屉 =====
interface VocabularyDrawerProps {
  item: VocabularyItem
  onClose: () => void
  onPronounce: (word: string) => void
  onAddReview: (id: string) => void
  onMarkMastered: (id: string) => void
  onDelete: (id: string, word: string) => void
}
function VocabularyDrawer({
  item,
  onClose,
  onPronounce,
  onAddReview,
  onMarkMastered,
  onDelete,
}: VocabularyDrawerProps) {
  const masteryPct = calcMasteryPct(item)
  const statusColor = masteryStatusColor(masteryPct)
  const statusLabel = masteryStatusLabel(masteryPct)

  // ESC 关闭
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <>
      {/* scrim */}
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(14, 17, 21, 0.5)',
          zIndex: 40,
          animation: 'scrim-in 0.24s cubic-bezier(.3,0,0,1)',
        }}
      />
      <style>{`
        @keyframes scrim-in { from { opacity: 0 } to { opacity: 1 } }
        @keyframes drawer-in { from { transform: translateX(100%) } to { transform: translateX(0) } }
      `}</style>

      {/* drawer */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-word-title"
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          width: 420,
          maxWidth: '100vw',
          background: 'var(--card)',
          borderLeft: '1px solid var(--border)',
          boxShadow: 'var(--shadow-lg)',
          zIndex: 50,
          display: 'flex',
          flexDirection: 'column',
          animation: 'drawer-in 0.28s cubic-bezier(.3,0,0,1)',
        }}
      >
        {/* ===== header ===== */}
        <header
          style={{
            padding: 'calc(var(--spacing) * 6)',
            borderBottom: '1px solid var(--border)',
            position: 'relative',
            flexShrink: 0,
            background: 'var(--card)',
          }}
        >
          <button
            type="button"
            data-dom-id="cta-close"
            aria-label="关闭抽屉"
            onClick={onClose}
            style={{
              position: 'absolute',
              top: 'calc(var(--spacing) * 5)',
              right: 'calc(var(--spacing) * 5)',
              width: 32,
              height: 32,
              display: 'grid',
              placeItems: 'center',
              border: 'none',
              background: 'transparent',
              color: 'var(--muted-foreground)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              transition: 'background 0.16s ease, color 0.16s ease, transform 0.16s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = 'var(--muted)'
              e.currentTarget.style.color = 'var(--foreground)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent'
              e.currentTarget.style.color = 'var(--muted-foreground)'
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.94)'
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            <Icon name="close" size={18} />
          </button>
          <h2
            id="drawer-word-title"
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: '1.75rem',
              fontWeight: 700,
              color: 'var(--card-foreground)',
              letterSpacing: '-0.01em',
              lineHeight: 1.2,
              wordBreak: 'keep-all',
              overflowWrap: 'break-word',
              paddingRight: 'calc(var(--spacing) * 8)',
              margin: 0,
            }}
          >
            {item.word}
          </h2>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'calc(var(--spacing) * 3)',
              marginTop: '0.55rem',
              flexWrap: 'wrap',
            }}
          >
            {item.phonetic && (
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.9rem',
                  color: 'var(--muted-foreground)',
                }}
              >
                {item.phonetic}
              </span>
            )}
            {item.part_of_speech && (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0.28rem 0.7rem',
                  borderRadius: 999,
                  background: 'var(--secondary)',
                  color: 'var(--secondary-foreground)',
                  fontSize: '0.78rem',
                  whiteSpace: 'nowrap',
                  fontWeight: 600,
                }}
              >
                {item.part_of_speech}
              </span>
            )}
            <IconButton
              dataDomId="cta-pronounce"
              ariaLabel="播放发音"
              onClick={() => onPronounce(item.word)}
            >
              <Icon name="play" size={16} />
            </IconButton>
          </div>
        </header>

        {/* ===== body ===== */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 'calc(var(--spacing) * 6)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'calc(var(--spacing) * 6)',
            minHeight: 0,
          }}
        >
          {/* 释义 */}
          <section
            style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)' }}
          >
            <span style={sectionLabelStyle}>释义</span>
            <div>
              <p
                style={{
                  fontSize: '1rem',
                  lineHeight: 1.6,
                  color: 'var(--card-foreground)',
                  fontWeight: 600,
                  margin: 0,
                }}
              >
                {item.meaning_zh}
              </p>
              {item.part_of_speech && (
                <p
                  style={{
                    fontSize: '0.84rem',
                    lineHeight: 1.6,
                    color: 'var(--muted-foreground)',
                    fontFamily: 'var(--font-mono)',
                    marginTop: '0.5rem',
                    wordBreak: 'break-word',
                    margin: '0.5rem 0 0 0',
                  }}
                >
                  {item.part_of_speech}
                </p>
              )}
            </div>
          </section>

          {/* 例句 */}
          {item.example_en && (
            <section
              style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)' }}
            >
              <span style={sectionLabelStyle}>例句</span>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 4)' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  <p
                    style={{
                      fontSize: '0.9rem',
                      lineHeight: 1.65,
                      color: 'var(--card-foreground)',
                      fontStyle: 'italic',
                      wordBreak: 'break-word',
                      margin: 0,
                    }}
                  >
                    {item.example_en}
                  </p>
                  {item.example_zh && (
                    <span
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        alignSelf: 'flex-start',
                        padding: '0.22rem 0.6rem',
                        borderRadius: 'var(--radius)',
                        background: 'var(--muted)',
                        color: 'var(--muted-foreground)',
                        fontSize: '0.72rem',
                        whiteSpace: 'nowrap',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {item.example_zh}
                    </span>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* 出处与掌握度 */}
          <section
            style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)' }}
          >
            <span style={sectionLabelStyle}>出处与掌握度</span>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 'calc(var(--spacing) * 4) calc(var(--spacing) * 4)',
              }}
            >
              <MetaItem label="来源书籍" value={item.source || '手动添加'} />
              <MetaItem label="添加日期" value={formatDateOnly(item.created_at)} mono />
              <MetaItem label="复习次数" value={`${item.review_count} 次`} mono />
              <MetaItem label="下次复习" value={formatDateOnly(item.next_review_at)} mono />
              <MetaItem label="熟悉度" value={`Lv.${item.familiarity_level ?? 0}`} mono />
              <MetaItem label="状态" value={statusLabel} style={{ color: statusColor }} />
            </div>
            {/* 掌握度进度条 */}
            <div
              style={{
                marginTop: 'calc(var(--spacing) * 4)',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              <div
                style={{
                  height: 8,
                  borderRadius: 999,
                  background: 'var(--muted)',
                  overflow: 'hidden',
                }}
              >
                <div
                  role="progressbar"
                  aria-valuenow={masteryPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`掌握度 ${masteryPct}%`}
                  style={{
                    height: '100%',
                    width: `${masteryPct}%`,
                    borderRadius: 999,
                    background: statusColor,
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                }}
              >
                <span
                  style={{
                    fontSize: '0.78rem',
                    color: statusColor,
                    fontWeight: 600,
                  }}
                >
                  {masteryStatusLabel(masteryPct)}
                </span>
                <span
                  style={{
                    fontSize: '0.78rem',
                    color: 'var(--muted-foreground)',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {masteryPct}%
                </span>
              </div>
            </div>
          </section>
        </div>

        {/* ===== footer ===== */}
        <footer
          style={{
            padding: 'calc(var(--spacing) * 5) calc(var(--spacing) * 6)',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'calc(var(--spacing) * 3)',
            flexShrink: 0,
            background: 'var(--card)',
          }}
        >
          <div
            style={{
              display: 'flex',
              gap: 'calc(var(--spacing) * 3)',
              flexWrap: 'wrap',
            }}
          >
            <Button
              variant="primary"
              data-dom-id="cta-review"
              onClick={() => onAddReview(item.id)}
              style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}
            >
              加入复习
            </Button>
            <Button
              variant="secondary"
              data-dom-id="cta-master"
              onClick={() => onMarkMastered(item.id)}
              style={{ flex: 1, minWidth: 0, justifyContent: 'center' }}
            >
              标记已掌握
            </Button>
          </div>
          <button
            type="button"
            data-dom-id="cta-delete"
            onClick={() => onDelete(item.id, item.word)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--state-error)',
              fontSize: '0.85rem',
              fontWeight: 500,
              cursor: 'pointer',
              padding: 'calc(var(--spacing) * 2) 0',
              transition: 'color 0.2s ease, text-decoration 0.2s ease',
              textAlign: 'center',
              borderRadius: 'var(--radius)',
              font: 'inherit',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.textDecoration = 'underline'
              e.currentTarget.style.textUnderlineOffset = '3px'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.textDecoration = 'none'
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'scale(0.98)'
            }}
            onMouseUp={(e) => {
              e.currentTarget.style.transform = 'scale(1)'
            }}
          >
            删除该生词
          </button>
        </footer>
      </aside>
    </>
  )
}

// ===== MetaItem =====
interface MetaItemProps {
  label: string
  value: string
  mono?: boolean
  style?: CSSProperties
}
function MetaItem({ label, value, mono, style }: MetaItemProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', minWidth: 0 }}>
      <span
        style={{
          fontSize: '0.7rem',
          color: 'var(--muted-foreground)',
          textTransform: 'uppercase',
          letterSpacing: '0.06em',
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontSize: '0.88rem',
          color: 'var(--card-foreground)',
          fontWeight: 500,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          ...(mono
            ? { fontFamily: 'var(--font-mono)', fontSize: '0.82rem', fontWeight: 400 }
            : {}),
          ...style,
        }}
      >
        {value}
      </span>
    </div>
  )
}

// ===== 共享 style =====
const eyebrowStyle: CSSProperties = {
  fontSize: '0.78rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--muted-foreground)',
}

const sectionLabelStyle: CSSProperties = {
  fontSize: '0.72rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--muted-foreground)',
  fontWeight: 600,
}
