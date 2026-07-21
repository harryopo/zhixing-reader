/**
 * KnowledgeCards — 知识卡片页（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/knowledge-cards.html
 *
 * 结构：
 *   - hero: 标题 + 副标题（X 张卡片 · 跨 X 本书） + 3 actions（新建/AI生成/导出）
 *   - 双 tab: 卡片库 / 蒸馏中心
 *   - 全局蒸馏进度 banner（distillProgress 显示时）
 *   - cards tab:
 *     - 4 统计卡（概念/方法/引用/平均掌握度）
 *     - 筛选条 card（5 类型 chips + 搜索 + 书籍 select + 标签 select + 网格/列表切换）
 *     - 卡片网格（auto-fill minmax(280px, 1fr)）
 *       - 卡片正面：badge + 书名 + 标题 + 内容 + 时间 + 3 icon-btn（复习/编辑/删除）
 *       - 卡片反面：内容 + 解读(AI生成) + 应用(AI生成) + 标签 + 复习信息 + 5星评分
 *   - distill tab:
 *     - 说明卡
 *     - 书籍网格（含蒸馏按钮 + 进度浮层）
 *
 * 业务逻辑全部保留：cards/distill 双 tab / 统计 / 4 筛选 / 翻转 / AI 生成解读与应用 /
 *   蒸馏中心 / onDistillProgress 监听 / 取消订阅 / toast 全套反馈
 */

import { useState, useEffect, useMemo, useCallback, useRef, CSSProperties } from 'react'
import PageHero from '@/components/layout/PageHero'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { Loading, EmptyState, Metric } from '@/components/ui/Feedback'
import { toast } from '../stores/toastStore'
import { safeStr, safeNum, formatDate, formatTimeAgo, mapKnowledgeCards, mapBook } from '../utils/db-mapper'

// ===== 类型 =====
type CardType = 'concept' | 'methodology' | 'quote'

type FilterType = 'all' | 'concept' | 'methodology' | 'quote' | 'reflection'

type TabKey = 'cards' | 'distill'

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

interface BookRow {
  id: string
  title: string
  author: string
  cover: string
}

// ===== 类型 → 视觉配置（设计稿 1:1） =====
const typeConfig: Record<CardType, { label: string; badgeStyle: CSSProperties }> = {
  concept: {
    label: '概念',
    badgeStyle: {
      fontSize: '0.72rem',
      padding: '0.2rem 0.6rem',
      borderRadius: '999px',
      background: 'color-mix(in srgb, var(--chart-1) 14%, transparent)',
      color: 'var(--chart-1)',
      whiteSpace: 'nowrap',
      fontWeight: 600,
      display: 'inline-flex',
      alignItems: 'center',
    },
  },
  methodology: {
    label: '方法',
    badgeStyle: {
      fontSize: '0.72rem',
      padding: '0.2rem 0.6rem',
      borderRadius: '999px',
      background: 'color-mix(in srgb, var(--chart-5) 14%, transparent)',
      color: 'var(--chart-5)',
      whiteSpace: 'nowrap',
      fontWeight: 600,
      display: 'inline-flex',
      alignItems: 'center',
    },
  },
  quote: {
    label: '引用',
    badgeStyle: {
      fontSize: '0.72rem',
      padding: '0.2rem 0.6rem',
      borderRadius: '999px',
      background: 'color-mix(in srgb, var(--chart-3) 16%, transparent)',
      color: 'var(--chart-4)',
      whiteSpace: 'nowrap',
      fontWeight: 600,
      display: 'inline-flex',
      alignItems: 'center',
    },
  },
}

// 类型筛选 chips（设计稿 5 个：全部/概念/方法/引用/反思）
const TYPE_FILTERS: { key: FilterType; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'concept', label: '概念' },
  { key: 'methodology', label: '方法' },
  { key: 'quote', label: '引用' },
  { key: 'reflection', label: '反思' },
]

const TABS: { key: TabKey; label: string }[] = [
  { key: 'cards', label: '卡片库' },
  { key: 'distill', label: '蒸馏中心' },
]

// ===== 错误分类（保留原逻辑） =====
function classifyErrorMessage(msg: string): {
  type: 'timeout' | 'cancelled' | 'network' | 'config' | 'empty' | 'parse' | 'import' | 'unknown'
  text: string
} {
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

// ===== 主组件 =====
export default function KnowledgeCards() {
  const [activeTab, setActiveTab] = useState<TabKey>('cards')
  const [cards, setCards] = useState<KnowledgeCardItem[]>([])
  const [books, setBooks] = useState<BookRow[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedBook, setSelectedBook] = useState('')
  const [selectedType, setSelectedType] = useState<FilterType>('all')
  const [selectedTag, setSelectedTag] = useState('')
  const [distillingBookId, setDistillingBookId] = useState<string | null>(null)
  const [distillProgress, setDistillProgress] = useState<DistillProgress | null>(null)
  const [flippedId, setFlippedId] = useState<string | null>(null)
  const [generatingMap, setGeneratingMap] = useState<Record<string, 'interpretation' | 'application' | null>>({})
  const unsubscribeRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    loadData()
  }, [])

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
        window.electronAPI.book.getAll(),
      ])
      const mappedCards = mapKnowledgeCards(cardsRaw) as unknown as KnowledgeCardItem[]
      const mappedBooks = (booksRaw as unknown as Record<string, unknown>[]).map((b) => mapBook(b)) as unknown as BookRow[]
      setCards(mappedCards)
      setBooks(mappedBooks)
    } catch (error) {
      console.error('加载知识卡片失败:', error)
      toast.error('加载知识卡片失败')
    } finally {
      setLoading(false)
    }
  }

  const getBookTitle = useCallback(
    (bookId: string) => {
      const book = books.find((b) => b.id === bookId)
      return safeStr(book?.title, '未知书籍')
    },
    [books],
  )

  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    cards.forEach((c) => {
      c.tags?.forEach((tag) => tagSet.add(tag))
    })
    return Array.from(tagSet).sort()
  }, [cards])

  const stats = useMemo(() => {
    const total = cards.length
    const concepts = cards.filter((c) => c.type === 'concept').length
    const methodologies = cards.filter((c) => c.type === 'methodology').length
    const quotes = cards.filter((c) => c.type === 'quote').length
    const avgMastery =
      total > 0 ? Math.round(cards.reduce((s, c) => s + safeNum(c.masteryLevel), 0) / total) : 0
    return { total, concepts, methodologies, quotes, avgMastery }
  }, [cards])

  const bookCount = useMemo(() => {
    const ids = new Set(cards.map((c) => c.bookId).filter(Boolean))
    return ids.size
  }, [cards])

  const filteredCards = useMemo(() => {
    let result = cards

    if (selectedBook) {
      result = result.filter((c) => c.bookId === selectedBook)
    }

    if (selectedType !== 'all') {
      result = result.filter((c) => c.type === selectedType)
    }

    if (selectedTag) {
      result = result.filter((c) => c.tags?.includes(selectedTag))
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      const terms = query.split(/\s+/).filter((t) => t.length > 0)
      result = result.filter((c) => {
        const searchText = [c.title, c.content, c.interpretation, c.application, getBookTitle(c.bookId)]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return terms.every((term) => searchText.includes(term))
      })
    }

    return result
  }, [cards, selectedBook, selectedType, selectedTag, searchQuery, getBookTitle])

  const handleDistill = async (bookId: string) => {
    const book = books.find((b) => b.id === bookId)
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
    setGeneratingMap((prev) => ({ ...prev, [card.id]: 'interpretation' }))
    try {
      const result = await window.electronAPI.knowledgeCard.generateInterpretation(
        getBookTitle(card.bookId),
        card.title,
        card.content,
        typeConfig[card.type].label,
      )
      await window.electronAPI.knowledgeCard.update(card.id, { interpretation: result.text })
      await loadData()
      toast.success('解读生成完成')
    } catch (error) {
      toast.error(`生成解读失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setGeneratingMap((prev) => ({ ...prev, [card.id]: null }))
    }
  }

  const handleGenerateApplication = async (card: KnowledgeCardItem) => {
    setGeneratingMap((prev) => ({ ...prev, [card.id]: 'application' }))
    try {
      const result = await window.electronAPI.knowledgeCard.generateApplication(
        getBookTitle(card.bookId),
        card.title,
        card.content,
        typeConfig[card.type].label,
      )
      await window.electronAPI.knowledgeCard.update(card.id, { application: result.text })
      await loadData()
      toast.success('应用场景生成完成')
    } catch (error) {
      toast.error(`生成应用失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setGeneratingMap((prev) => ({ ...prev, [card.id]: null }))
    }
  }

  const getMasteryStars = (level: number) => {
    const stars = Math.ceil(safeNum(level) / 20)
    return '★'.repeat(Math.min(stars, 5)) + '☆'.repeat(Math.max(0, 5 - stars))
  }

  const handleUpdateMastery = async (card: KnowledgeCardItem, level: number) => {
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
  }

  // 蒸馏进度浮层（覆盖在蒸馏书籍卡片上）
  const renderDistillProgress = (bookId: string) => {
    if (distillingBookId !== bookId || !distillProgress) return null

    const percent =
      distillProgress.total > 0
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
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'color-mix(in srgb, var(--card) 95%, transparent)',
          backdropFilter: 'blur(4px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 'calc(var(--spacing) * 4)',
          borderRadius: 'calc(var(--radius) + 4px)',
          zIndex: 10,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            marginBottom: 12,
            color: isError ? 'var(--state-error)' : 'var(--primary)',
          }}
        >
          {isError ? (
            <Icon name="alert" size={48} />
          ) : (
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                border: '2px solid var(--primary)',
                borderTopColor: 'transparent',
                animation: 'spin 0.8s linear infinite',
              }}
            />
          )}
        </div>
        <p
          style={{
            fontSize: '0.875rem',
            fontWeight: 500,
            color: 'var(--foreground)',
            marginBottom: 4,
            margin: '0 0 4px 0',
          }}
        >
          {stageLabels[distillProgress.stage] || '处理中'}
        </p>
        {distillProgress.message && (
          <p
            style={{
              fontSize: '0.75rem',
              color: 'var(--muted-foreground)',
              marginBottom: 8,
              textAlign: 'center',
              maxWidth: 200,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              margin: '0 0 8px 0',
            }}
            title={distillProgress.message}
          >
            {distillProgress.message}
          </p>
        )}
        {distillProgress.total > 0 && !isError && (
          <div style={{ width: '100%', maxWidth: 200, marginTop: 4 }}>
            <div
              style={{
                height: 6,
                background: 'var(--muted)',
                borderRadius: 999,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  height: '100%',
                  background: 'var(--primary)',
                  transition: 'width 0.3s ease',
                  width: `${percent}%`,
                }}
              />
            </div>
            <p
              style={{
                fontSize: '0.75rem',
                color: 'var(--muted-foreground)',
                textAlign: 'center',
                marginTop: 4,
                margin: '4px 0 0 0',
              }}
            >
              {distillProgress.current} / {distillProgress.total} ({percent}%)
            </p>
          </div>
        )}
        <button
          type="button"
          onClick={() => handleCancelDistill(bookId)}
          style={{
            marginTop: 12,
            padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 3)',
            fontSize: '0.75rem',
            color: isError ? 'var(--muted-foreground)' : 'var(--state-error)',
            background: 'transparent',
            border: '1px solid currentColor',
            borderRadius: 'var(--radius)',
            cursor: 'pointer',
            transition: 'background 0.2s ease',
            fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = isError
              ? 'var(--muted)'
              : 'color-mix(in srgb, var(--state-error) 8%, transparent)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          {isError ? '关闭' : '取消蒸馏'}
        </button>
      </div>
    )
  }

  if (loading) {
    return <Loading hint="正在加载知识卡片..." />
  }

  const subtitle = `共 ${stats.total} 张卡片 · 跨 ${bookCount} 本书`
  const hasFilter = !!(searchQuery || selectedBook || selectedType !== 'all' || selectedTag)

  return (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      <PageHero
        title="知识卡片"
        subtitle={subtitle}
        actions={
          <>
            <Button
              variant="primary"
              onClick={() => toast.info('新建卡片功能即将上线')}
              data-dom-id="cta-new"
            >
              <Icon name="plus" size={16} /> 新建卡片
            </Button>
            <Button
              variant="secondary"
              onClick={() => setActiveTab('distill')}
              data-dom-id="cta-ai-gen"
            >
              <Icon name="agent" size={16} /> AI 批量生成
            </Button>
            <Button
              variant="ghost"
              onClick={() => toast.info('导出功能即将上线')}
              data-dom-id="cta-export"
            >
              <Icon name="external-link" size={16} /> 导出
            </Button>
          </>
        }
      >
        {/* ===== 双 tab 切换 ===== */}
        <Chips items={TABS} value={activeTab} onChange={setActiveTab} />

        {/* ===== 全局蒸馏进度 banner ===== */}
        {distillProgress && (
          <div
            style={{
              background:
                distillProgress.stage === 'done'
                  ? 'color-mix(in srgb, var(--state-success) 8%, transparent)'
                  : distillProgress.stage === 'error'
                    ? 'color-mix(in srgb, var(--state-error) 8%, transparent)'
                    : 'color-mix(in srgb, var(--state-info) 8%, transparent)',
              border: '1px solid',
              borderColor:
                distillProgress.stage === 'done'
                  ? 'color-mix(in srgb, var(--state-success) 30%, transparent)'
                  : distillProgress.stage === 'error'
                    ? 'color-mix(in srgb, var(--state-error) 30%, transparent)'
                    : 'color-mix(in srgb, var(--state-info) 30%, transparent)',
              borderRadius: 'calc(var(--radius) + 6px)',
              padding: 'calc(var(--spacing) * 4) calc(var(--spacing) * 5)',
              display: 'flex',
              alignItems: 'center',
              gap: 'calc(var(--spacing) * 3)',
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                flexShrink: 0,
                color:
                  distillProgress.stage === 'done'
                    ? 'var(--state-success)'
                    : distillProgress.stage === 'error'
                      ? 'var(--state-error)'
                      : 'var(--state-info)',
              }}
            >
              {distillProgress.stage === 'done' ? (
                <Icon name="check" size={20} />
              ) : distillProgress.stage === 'error' ? (
                <Icon name="alert" size={20} />
              ) : (
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    border: '2px solid currentColor',
                    borderTopColor: 'transparent',
                    animation: 'spin 0.8s linear infinite',
                  }}
                />
              )}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <p
                style={{
                  margin: 0,
                  fontSize: '0.875rem',
                  fontWeight: 500,
                  color: 'var(--foreground)',
                }}
              >
                {distillProgress.stage === 'done'
                  ? `《${distillProgress.bookTitle}》蒸馏完成`
                  : distillProgress.stage === 'error'
                    ? `《${distillProgress.bookTitle}》蒸馏失败`
                    : `正在蒸馏《${distillProgress.bookTitle}》`}
              </p>
              <p
                style={{
                  margin: '4px 0 0',
                  fontSize: '0.75rem',
                  color: 'var(--muted-foreground)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {distillProgress.message || '处理中...'}
                {distillProgress.total > 0 &&
                  distillProgress.stage !== 'done' &&
                  distillProgress.stage !== 'error' &&
                  ` · ${distillProgress.current}/${distillProgress.total}`}
              </p>
            </div>
            {distillProgress.stage !== 'done' && distillProgress.stage !== 'error' && (
              <button
                type="button"
                onClick={() => handleCancelDistill(distillProgress.bookId)}
                style={{
                  padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 3)',
                  fontSize: '0.75rem',
                  color: 'var(--state-info)',
                  background: 'transparent',
                  border: '1px solid currentColor',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  flexShrink: 0,
                  fontFamily: 'inherit',
                }}
              >
                取消
              </button>
            )}
          </div>
        )}

        {/* ===== cards tab ===== */}
        {activeTab === 'cards' && (
          <>
            {/* 4 统计卡 */}
            <div
              className="grid stats"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
                gap: 'calc(var(--spacing) * 4)',
              }}
            >
              <Card interactive>
                <div
                  style={{
                    color: 'var(--muted-foreground)',
                    fontSize: '0.78rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >
                  概念卡片
                </div>
                <Metric value={stats.concepts} />
                <span style={typeConfig.concept.badgeStyle}>概念</span>
              </Card>

              <Card interactive>
                <div
                  style={{
                    color: 'var(--muted-foreground)',
                    fontSize: '0.78rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >
                  方法卡片
                </div>
                <Metric value={stats.methodologies} />
                <span style={typeConfig.methodology.badgeStyle}>方法</span>
              </Card>

              <Card interactive>
                <div
                  style={{
                    color: 'var(--muted-foreground)',
                    fontSize: '0.78rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >
                  引用卡片
                </div>
                <Metric value={stats.quotes} />
                <span style={typeConfig.quote.badgeStyle}>引用</span>
              </Card>

              <Card interactive>
                <div
                  style={{
                    color: 'var(--muted-foreground)',
                    fontSize: '0.78rem',
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                  }}
                >
                  平均掌握度
                </div>
                <Metric value={`${stats.avgMastery}%`} />
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '0.35rem',
                    padding: '0.34rem 0.65rem',
                    borderRadius: 999,
                    background: 'var(--muted)',
                    color: 'var(--foreground)',
                    fontSize: '0.8rem',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {getMasteryStars(stats.avgMastery)}
                </span>
              </Card>
            </div>

            {/* 筛选条 card */}
            <div
              className="card"
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 'calc(var(--radius) + 6px)',
                padding: 'calc(var(--spacing) * 4) calc(var(--spacing) * 5)',
                color: 'var(--card-foreground)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 'calc(var(--spacing) * 4)',
                  flexWrap: 'wrap',
                }}
              >
                {/* 左侧：5 类型 chips */}
                <Chips items={TYPE_FILTERS} value={selectedType} onChange={setSelectedType} />

                {/* 右侧：搜索 + 书籍 + 标签 + 网格/列表切换 */}
                <div
                  style={{
                    display: 'flex',
                    gap: 'calc(var(--spacing) * 3)',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                  }}
                >
                  <CompactSearch value={searchQuery} onChange={setSearchQuery} placeholder="搜索卡片..." />

                  {/* 书籍筛选 */}
                  <select
                    value={selectedBook}
                    onChange={(e) => setSelectedBook(e.target.value)}
                    aria-label="按书籍筛选"
                    style={selectStyle}
                  >
                    <option value="">全部书籍</option>
                    {books.map((book) => (
                      <option key={book.id} value={book.id}>
                        {book.title}
                      </option>
                    ))}
                  </select>

                  {/* 标签筛选 */}
                  <select
                    value={selectedTag}
                    onChange={(e) => setSelectedTag(e.target.value)}
                    aria-label="按标签筛选"
                    style={selectStyle}
                  >
                    <option value="">全部标签</option>
                    {allTags.map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </select>

                  {/* 网格/列表切换 */}
                  <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 2)', alignItems: 'center' }}>
                    <button
                      type="button"
                      data-dom-id="view-grid"
                      aria-label="网格视图"
                      style={iconBtnStyle(true)}
                    >
                      <Icon name="cards" size={14} />
                    </button>
                    <button
                      type="button"
                      data-dom-id="view-list"
                      aria-label="列表视图"
                      onClick={() => toast.info('列表视图即将上线')}
                      style={iconBtnStyle(false)}
                    >
                      <Icon name="menu" size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* 卡片网格 */}
            {filteredCards.length === 0 ? (
              <EmptyState
                icon={<Icon name="cards" size={24} />}
                title={hasFilter ? '没有找到匹配的卡片' : '还没有知识卡片'}
                description={
                  hasFilter ? '尝试调整筛选条件' : '切换到"蒸馏中心"从书籍中提取知识卡片'
                }
                action={
                  !hasFilter ? (
                    <Button variant="primary" onClick={() => setActiveTab('distill')}>
                      <Icon name="agent" size={16} /> 前往蒸馏中心
                    </Button>
                  ) : undefined
                }
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'calc(var(--radius) + 6px)',
                }}
              />
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 'calc(var(--spacing) * 4)',
                }}
              >
                {filteredCards.map((card) => (
                  <KnowledgeCardArticle
                    key={card.id}
                    card={card}
                    isFlipped={flippedId === card.id}
                    onFlip={() => setFlippedId(flippedId === card.id ? null : card.id)}
                    onClose={() => setFlippedId(null)}
                    onDelete={() => handleDelete(card.id)}
                    onEdit={() => toast.info('编辑卡片功能即将上线')}
                    onReview={() => setFlippedId(card.id)}
                    onReviewAction={() => toast.info('复习功能即将上线')}
                    onGenerateInterpretation={() => handleGenerateInterpretation(card)}
                    onGenerateApplication={() => handleGenerateApplication(card)}
                    onUpdateMastery={(level) => handleUpdateMastery(card, level)}
                    getBookTitle={getBookTitle}
                    getMasteryStars={getMasteryStars}
                    generating={generatingMap[card.id] ?? null}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* ===== distill tab ===== */}
        {activeTab === 'distill' && (
          <>
            {/* 蒸馏说明卡 */}
            <Card>
              <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 3)', alignItems: 'flex-start' }}>
                <div
                  style={{
                    width: 36,
                    height: 36,
                    flexShrink: 0,
                    borderRadius: 'var(--radius)',
                    background: 'var(--accent)',
                    color: 'var(--accent-foreground)',
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  <Icon name="agent" size={18} />
                </div>
                <div>
                  <h3
                    style={{
                      margin: 0,
                      fontSize: '0.95rem',
                      fontWeight: 600,
                      color: 'var(--foreground)',
                    }}
                  >
                    蒸馏说明
                  </h3>
                  <p
                    style={{
                      margin: '0.5rem 0 0',
                      fontSize: '0.875rem',
                      color: 'var(--muted-foreground)',
                      lineHeight: 1.55,
                    }}
                  >
                    选择下方书籍，AI
                    会从你的划线/笔记中提取概念、方法论和金句，生成知识卡片。解读和应用场景可在卡片生成后手动添加。
                  </p>
                </div>
              </div>
            </Card>

            {/* 书籍网格 */}
            {books.length > 0 ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 'calc(var(--spacing) * 4)',
                }}
              >
                {books.map((book) => {
                  const bookId = String(book.id)
                  const isCurrentDistilling = distillingBookId === bookId
                  const cardCount = cards.filter((c) => c.bookId === bookId).length
                  return (
                    <div
                      key={bookId}
                      style={{
                        position: 'relative',
                        background: 'var(--card)',
                        border: '1px solid var(--border)',
                        borderRadius: 'calc(var(--radius) + 4px)',
                        padding: 'calc(var(--spacing) * 4)',
                        transition: 'border-color 0.2s ease',
                        overflow: 'hidden',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--ring)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border)'
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'calc(var(--spacing) * 3)',
                          marginBottom: 'calc(var(--spacing) * 3)',
                        }}
                      >
                        <div
                          style={{
                            width: 48,
                            height: 64,
                            flexShrink: 0,
                            background: 'var(--muted)',
                            borderRadius: 'var(--radius)',
                            overflow: 'hidden',
                            display: 'grid',
                            placeItems: 'center',
                            color: 'var(--primary)',
                          }}
                        >
                          {book.cover ? (
                            <img
                              src={book.cover}
                              alt=""
                              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                          ) : (
                            <Icon name="bookshelf" size={20} />
                          )}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <p
                            style={{
                              margin: 0,
                              fontSize: '0.92rem',
                              fontWeight: 600,
                              color: 'var(--card-foreground)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {safeStr(book.title)}
                          </p>
                          <p
                            style={{
                              margin: '0.18rem 0 0',
                              fontSize: '0.75rem',
                              color: 'var(--muted-foreground)',
                            }}
                          >
                            {safeStr(book.author, '未知作者')}
                          </p>
                          <p
                            style={{
                              margin: '0.18rem 0 0',
                              fontSize: '0.72rem',
                              color: 'var(--muted-foreground)',
                              fontFamily: 'var(--font-mono)',
                            }}
                          >
                            {cardCount > 0 ? `已有 ${cardCount} 张卡片` : '暂无卡片'}
                          </p>
                        </div>
                      </div>
                      {isCurrentDistilling ? (
                        <button
                          type="button"
                          onClick={() => handleCancelDistill(bookId)}
                          style={{
                            width: '100%',
                            padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 3)',
                            fontSize: '0.84rem',
                            fontWeight: 600,
                            background: 'color-mix(in srgb, var(--state-error) 8%, transparent)',
                            color: 'var(--state-error)',
                            border: '1px solid color-mix(in srgb, var(--state-error) 30%, transparent)',
                            borderRadius: 'var(--radius)',
                            cursor: 'pointer',
                            transition: 'background 0.2s ease',
                            fontFamily: 'inherit',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background =
                              'color-mix(in srgb, var(--state-error) 14%, transparent)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background =
                              'color-mix(in srgb, var(--state-error) 8%, transparent)'
                          }}
                        >
                          取消蒸馏
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleDistill(bookId)}
                          disabled={!!distillingBookId}
                          style={{
                            width: '100%',
                            padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 3)',
                            fontSize: '0.84rem',
                            fontWeight: 600,
                            background: 'var(--primary)',
                            color: 'var(--primary-foreground)',
                            border: '1px solid var(--primary)',
                            borderRadius: 'var(--radius)',
                            cursor: distillingBookId ? 'not-allowed' : 'pointer',
                            opacity: distillingBookId ? 0.5 : 1,
                            transition: 'background 0.2s ease, border-color 0.2s ease',
                            fontFamily: 'inherit',
                          }}
                          onMouseEnter={(e) => {
                            if (!distillingBookId) e.currentTarget.style.borderColor = 'var(--ring)'
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.borderColor = 'var(--primary)'
                          }}
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
              <EmptyState
                icon={<Icon name="bookshelf" size={24} />}
                title="暂无书籍"
                description="请先从书架导入书籍"
                style={{
                  background: 'var(--card)',
                  border: '1px solid var(--border)',
                  borderRadius: 'calc(var(--radius) + 6px)',
                }}
              />
            )}
          </>
        )}
      </PageHero>
    </>
  )
}

// ===== 子组件：知识卡片 article（正面 + 反面） =====
interface KnowledgeCardArticleProps {
  card: KnowledgeCardItem
  isFlipped: boolean
  onFlip: () => void
  onClose: () => void
  onDelete: () => void
  onEdit: () => void
  onReview: () => void
  onReviewAction: () => void
  onGenerateInterpretation: () => void
  onGenerateApplication: () => void
  onUpdateMastery: (level: number) => void
  getBookTitle: (bookId: string) => string
  getMasteryStars: (level: number) => string
  generating: 'interpretation' | 'application' | null
}

function KnowledgeCardArticle({
  card,
  isFlipped,
  onFlip,
  onClose,
  onDelete,
  onEdit,
  onReview,
  onReviewAction,
  onGenerateInterpretation,
  onGenerateApplication,
  onUpdateMastery,
  getBookTitle,
  getMasteryStars,
  generating,
}: KnowledgeCardArticleProps) {
  const typeInfo = typeConfig[card.type]
  const bookTitle = getBookTitle(card.bookId)
  const timeLabel = formatTimeAgo(card.updatedAt || card.createdAt)

  const articleStyle: CSSProperties = {
    padding: 'calc(var(--spacing) * 5)',
    border: '1px solid var(--border)',
    borderRadius: 'calc(var(--radius) + 4px)',
    background: 'var(--card)',
    cursor: 'pointer',
    display: 'flex',
    flexDirection: 'column',
    gap: 'calc(var(--spacing) * 3)',
    transition: 'border-color 0.2s ease, transform 0.16s ease',
    position: 'relative',
  }

  const handleMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.borderColor = 'var(--ring)'
    e.currentTarget.style.transform = 'translateY(-2px)'
  }
  const handleMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.borderColor = 'var(--border)'
    e.currentTarget.style.transform = 'translateY(0)'
  }

  return (
    <article
      data-dom-id={`card-${card.id}`}
      style={articleStyle}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onClick={onFlip}
    >
      {!isFlipped ? (
        <>
          {/* 顶部：badge + 书名 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 'calc(var(--spacing) * 3)',
            }}
          >
            <span style={typeInfo.badgeStyle}>{typeInfo.label}</span>
            <span
              style={{
                fontSize: '0.72rem',
                color: 'var(--muted-foreground)',
                fontFamily: 'var(--font-mono)',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: '60%',
              }}
            >
              《{bookTitle}》
            </span>
          </div>

          {/* 标题 */}
          <h3
            style={{
              margin: 0,
              fontSize: '1rem',
              fontWeight: 600,
              color: 'var(--card-foreground)',
              lineHeight: 1.5,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {card.title}
          </h3>

          {/* 内容预览 */}
          <p
            style={{
              margin: 0,
              fontSize: '0.88rem',
              lineHeight: 1.7,
              color: 'var(--muted-foreground)',
              flex: 1,
              display: '-webkit-box',
              WebkitLineClamp: 4,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {card.content}
          </p>

          {/* 底部：时间 + 3 icon-btn */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingTop: 'calc(var(--spacing) * 3)',
              borderTop: '1px solid var(--border)',
            }}
          >
            <span
              style={{
                fontSize: '0.72rem',
                color: 'var(--muted-foreground)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {timeLabel}
            </span>
            <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 2)' }}>
              <button
                type="button"
                aria-label="复习"
                data-dom-id={`card-${card.id}-review`}
                style={iconBtnStyle(false)}
                onClick={(e) => {
                  e.stopPropagation()
                  onReview()
                }}
              >
                <Icon name="refresh" size={14} />
              </button>
              <button
                type="button"
                aria-label="编辑"
                data-dom-id={`card-${card.id}-edit`}
                style={iconBtnStyle(false)}
                onClick={(e) => {
                  e.stopPropagation()
                  onEdit()
                }}
              >
                <Icon name="edit" size={14} />
              </button>
              <button
                type="button"
                aria-label="删除"
                data-dom-id={`card-${card.id}-delete`}
                style={iconBtnStyle(false)}
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          </div>
        </>
      ) : (
        /* 卡片反面：保留所有详情/AI/标签/评分逻辑 */
        <div
          style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)' }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 顶部 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'flex-start',
              gap: 'calc(var(--spacing) * 3)',
            }}
          >
            <span style={typeInfo.badgeStyle}>{typeInfo.label}</span>
            <button type="button" aria-label="收起" onClick={onClose} style={iconBtnStyle(false)}>
              <Icon name="close" size={14} />
            </button>
          </div>

          {/* 标题 + 书名 */}
          <div>
            <h3
              style={{
                margin: 0,
                fontSize: '1rem',
                fontWeight: 600,
                color: 'var(--card-foreground)',
                lineHeight: 1.5,
              }}
            >
              {card.title}
            </h3>
            <p
              style={{
                margin: '0.25rem 0 0',
                fontSize: '0.72rem',
                color: 'var(--muted-foreground)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              《{bookTitle}》
            </p>
          </div>

          {/* 内容 */}
          <div>
            <h4
              style={{
                margin: 0,
                fontSize: '0.72rem',
                fontWeight: 500,
                color: 'var(--muted-foreground)',
                marginBottom: 'calc(var(--spacing) * 1.5)',
              }}
            >
              内容
            </h4>
            <p
              style={{
                margin: 0,
                fontSize: '0.875rem',
                lineHeight: 1.7,
                color: 'var(--card-foreground)',
              }}
            >
              {card.content}
            </p>
          </div>

          {/* 解读（AI 生成） */}
          {card.interpretation ? (
            <div>
              <h4
                style={{
                  margin: 0,
                  fontSize: '0.72rem',
                  fontWeight: 500,
                  color: 'var(--muted-foreground)',
                  marginBottom: 'calc(var(--spacing) * 1.5)',
                }}
              >
                解读
              </h4>
              <p
                style={{
                  margin: 0,
                  fontSize: '0.875rem',
                  lineHeight: 1.7,
                  color: 'var(--card-foreground)',
                }}
              >
                {card.interpretation}
              </p>
            </div>
          ) : (
            <div
              style={{
                background: 'var(--muted)',
                borderRadius: 'var(--radius)',
                padding: 'calc(var(--spacing) * 3)',
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: '0.75rem',
                  color: 'var(--muted-foreground)',
                  marginBottom: 'calc(var(--spacing) * 2)',
                }}
              >
                暂无解读
              </p>
              <button
                type="button"
                onClick={onGenerateInterpretation}
                disabled={!!generating}
                style={aiGenBtnStyle(!!generating)}
                onMouseEnter={(e) => {
                  if (!generating) e.currentTarget.style.borderColor = 'var(--ring)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)'
                }}
              >
                {generating === 'interpretation' ? (
                  <>
                    <span style={spinnerStyle} />
                    生成中...
                  </>
                ) : (
                  <>
                    <Icon name="agent" size={12} /> AI 生成解读
                  </>
                )}
              </button>
            </div>
          )}

          {/* 应用（AI 生成） */}
          {card.application ? (
            <div>
              <h4
                style={{
                  margin: 0,
                  fontSize: '0.72rem',
                  fontWeight: 500,
                  color: 'var(--muted-foreground)',
                  marginBottom: 'calc(var(--spacing) * 1.5)',
                }}
              >
                应用
              </h4>
              <p
                style={{
                  margin: 0,
                  fontSize: '0.875rem',
                  lineHeight: 1.7,
                  color: 'var(--card-foreground)',
                }}
              >
                {card.application}
              </p>
            </div>
          ) : (
            <div
              style={{
                background: 'var(--muted)',
                borderRadius: 'var(--radius)',
                padding: 'calc(var(--spacing) * 3)',
              }}
            >
              <p
                style={{
                  margin: 0,
                  fontSize: '0.75rem',
                  color: 'var(--muted-foreground)',
                  marginBottom: 'calc(var(--spacing) * 2)',
                }}
              >
                暂无应用场景
              </p>
              <button
                type="button"
                onClick={onGenerateApplication}
                disabled={!!generating}
                style={aiGenBtnStyle(!!generating)}
                onMouseEnter={(e) => {
                  if (!generating) e.currentTarget.style.borderColor = 'var(--ring)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--border)'
                }}
              >
                {generating === 'application' ? (
                  <>
                    <span style={spinnerStyle} />
                    生成中...
                  </>
                ) : (
                  <>
                    <Icon name="agent" size={12} /> AI 生成应用场景
                  </>
                )}
              </button>
            </div>
          )}

          {/* 标签 */}
          {card.tags && card.tags.length > 0 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'calc(var(--spacing) * 2)',
                flexWrap: 'wrap',
              }}
            >
              {card.tags.map((tag) => (
                <span
                  key={tag}
                  style={{
                    padding: '0.2rem 0.6rem',
                    fontSize: '0.72rem',
                    background: 'var(--muted)',
                    color: 'var(--muted-foreground)',
                    borderRadius: '999px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {tag}
                </span>
              ))}
            </div>
          )}

          {/* 复习信息 */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              fontSize: '0.72rem',
              color: 'var(--muted-foreground)',
              paddingTop: 'calc(var(--spacing) * 2)',
              borderTop: '1px solid var(--border)',
            }}
          >
            <span>
              复习 {safeNum(card.reviewCount)} 次 · 掌握度 {safeNum(card.masteryLevel)}%
            </span>
            <span title="基于您的划线/笔记提取">{formatDate(card.createdAt)}</span>
          </div>

          {/* 5 星评分 */}
          <div
            style={{
              background: 'var(--muted)',
              borderRadius: 'var(--radius)',
              padding: 'calc(var(--spacing) * 3)',
            }}
          >
            <p
              style={{
                margin: 0,
                fontSize: '0.75rem',
                color: 'var(--muted-foreground)',
                marginBottom: 'calc(var(--spacing) * 2)',
              }}
            >
              你对这条内容的掌握程度：
            </p>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'calc(var(--spacing) * 2)',
                flexWrap: 'wrap',
              }}
            >
              {[1, 2, 3, 4, 5].map((level) => {
                const active = Math.ceil(safeNum(card.masteryLevel) / 20) >= level
                return (
                  <button
                    key={level}
                    type="button"
                    onClick={() => onUpdateMastery(level)}
                    style={{
                      padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 3)',
                      fontSize: '0.875rem',
                      borderRadius: 'var(--radius)',
                      cursor: 'pointer',
                      transition: 'background 0.2s ease, color 0.2s ease',
                      fontFamily: 'inherit',
                      border: '1px solid',
                      background: active
                        ? 'color-mix(in srgb, var(--state-warning) 20%, transparent)'
                        : 'var(--card)',
                      color: active ? 'var(--state-warning)' : 'var(--muted-foreground)',
                      borderColor: active
                        ? 'color-mix(in srgb, var(--state-warning) 30%, transparent)'
                        : 'var(--border)',
                    }}
                  >
                    {'★'.repeat(level)}
                  </button>
                )
              })}
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--muted-foreground)',
                  fontFamily: 'var(--font-mono)',
                }}
              >
                {getMasteryStars(card.masteryLevel)}
              </span>
            </div>
          </div>

          {/* 底部时间 + 3 icon-btn */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              paddingTop: 'calc(var(--spacing) * 3)',
              borderTop: '1px solid var(--border)',
            }}
          >
            <span
              style={{
                fontSize: '0.72rem',
                color: 'var(--muted-foreground)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {timeLabel}
            </span>
            <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 2)' }}>
              <button
                type="button"
                aria-label="复习"
                style={iconBtnStyle(false)}
                onClick={(e) => {
                  e.stopPropagation()
                  onReviewAction()
                }}
              >
                <Icon name="refresh" size={14} />
              </button>
              <button
                type="button"
                aria-label="编辑"
                style={iconBtnStyle(false)}
                onClick={(e) => {
                  e.stopPropagation()
                  onEdit()
                }}
              >
                <Icon name="edit" size={14} />
              </button>
              <button
                type="button"
                aria-label="删除"
                style={iconBtnStyle(false)}
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
              >
                <Icon name="trash" size={14} />
              </button>
            </div>
          </div>
        </div>
      )}
    </article>
  )
}

// ===== 子组件：Chip 组 =====
interface ChipsProps<T extends string> {
  items: { key: T; label: string }[]
  value: T
  onChange: (v: T) => void
}

function Chips<T extends string>({ items, value, onChange }: ChipsProps<T>) {
  return (
    <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 2)', flexWrap: 'wrap' }}>
      {items.map((item) => {
        const active = item.key === value
        return (
          <button
            key={item.key}
            type="button"
            data-dom-id={`filter-${item.key}`}
            onClick={() => onChange(item.key)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
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
              fontWeight: active ? 600 : 400,
              whiteSpace: 'nowrap',
              fontFamily: 'inherit',
            }}
            onMouseEnter={(e) => {
              if (!active) {
                e.currentTarget.style.background = 'var(--sidebar-accent)'
                e.currentTarget.style.color = 'var(--sidebar-accent-foreground)'
                e.currentTarget.style.borderColor = 'var(--sidebar-border)'
              }
            }}
            onMouseLeave={(e) => {
              if (!active) {
                e.currentTarget.style.background = 'var(--card)'
                e.currentTarget.style.color = 'var(--muted-foreground)'
                e.currentTarget.style.borderColor = 'var(--border)'
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

// ===== 子组件：紧凑搜索框 =====
interface CompactSearchProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

function CompactSearch({ value, onChange, placeholder }: CompactSearchProps) {
  return (
    <div
      role="search"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 'calc(var(--spacing) * 3)',
        width: 200,
        padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 3)',
        border: '1px solid var(--input)',
        borderRadius: 'var(--radius)',
        background: 'var(--popover)',
        color: 'var(--muted-foreground)',
      }}
    >
      <Icon name="search" size={14} />
      <input
        type="search"
        aria-label="搜索卡片"
        placeholder={placeholder ?? '搜索...'}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          border: 'none',
          outline: 'none',
          background: 'transparent',
          color: 'var(--foreground)',
          width: '100%',
          fontSize: '0.82rem',
          fontFamily: 'inherit',
        }}
      />
    </div>
  )
}

// ===== 共享样式常量 =====
const selectStyle: CSSProperties = {
  width: 160,
  padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 4)',
  border: '1px solid var(--input)',
  borderRadius: 'var(--radius)',
  background: 'var(--card)',
  color: 'var(--foreground)',
  fontSize: '0.84rem',
  outline: 'none',
  fontFamily: 'inherit',
  cursor: 'pointer',
}

function iconBtnStyle(active: boolean): CSSProperties {
  return {
    width: 28,
    height: 28,
    display: 'grid',
    placeItems: 'center',
    border: '1px solid',
    borderColor: active ? 'var(--sidebar-border)' : 'var(--border)',
    background: active ? 'var(--sidebar-accent)' : 'var(--card)',
    color: active ? 'var(--sidebar-accent-foreground)' : 'var(--foreground)',
    borderRadius: 'var(--radius)',
    cursor: 'pointer',
    transition:
      'background 0.2s ease, color 0.2s ease, border-color 0.2s ease, transform 0.16s ease',
    padding: 0,
    fontFamily: 'inherit',
  }
}

function aiGenBtnStyle(disabled: boolean): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'calc(var(--spacing) * 2)',
    padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 3)',
    fontSize: '0.75rem',
    background: 'var(--card)',
    border: '1px solid var(--border)',
    color: 'var(--foreground)',
    borderRadius: 'var(--radius)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
    transition: 'border-color 0.2s ease',
    fontFamily: 'inherit',
  }
}

const spinnerStyle: CSSProperties = {
  width: 12,
  height: 12,
  borderRadius: '50%',
  border: '1.5px solid var(--muted-foreground)',
  borderTopColor: 'transparent',
  animation: 'spin 0.8s linear infinite',
  display: 'inline-block',
}
