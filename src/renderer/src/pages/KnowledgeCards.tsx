/**
 * KnowledgeCards — 知识卡片页（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/knowledge-cards.html
 *
 * 结构：
 *   - hero: 标题 + 副标题（X 张卡片 · 跨 X 本书） + 2 actions（AI生成/导出）
 *   - 双 tab: 卡片库 / 蒸馏中心
 *   - 全局蒸馏进度 banner（distillProgress 显示时）
 *   - cards tab:
 *     - 3 统计卡（概念/方法/引用）
 *     - 筛选条 card（5 类型 chips + 搜索 + 书籍 select + 标签 select + 网格/列表切换）
 *     - 卡片网格（auto-fill minmax(280px, 1fr)）
 *       - 卡片正面：badge + 书名 + 标题 + 内容 + 时间 + 删除 icon-btn
 *       - 卡片反面：内容 + 解读(AI生成) + 应用(AI生成) + 标签 + 复习信息
 *   - distill tab:
 *     - 说明卡
 *     - 书籍网格（含蒸馏按钮 + 进度浮层）
 *
 * 业务逻辑全部保留：cards/distill 双 tab / 统计 / 4 筛选 / 翻转 / AI 生成解读与应用 /
 *   蒸馏中心 / onDistillProgress 监听 / 取消订阅 / toast 全套反馈
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { Loading, EmptyState, Metric } from '@/components/ui/Feedback'
import { toast } from '../stores/toastStore'
import { safeStr, mapKnowledgeCards, mapBooks } from '../utils/db-mapper'
import {
  TABS,
  TYPE_FILTERS,
  classifyErrorMessage,
  typeConfig,
  type BookRow,
  type DistillProgress,
  type FilterType,
  type KnowledgeCardItem,
  type TabKey,
} from './knowledge-cards/model'
import { iconBtnStyle, selectStyle } from './knowledge-cards/styles'
import { Chips, CompactSearch } from './knowledge-cards/controls'
import { KnowledgeCardArticle } from './knowledge-cards/KnowledgeCardArticle'

// ===== 主组件 =====
export default function KnowledgeCards() {
  /**
   * 支持 ?bookId=xxx 深链：书籍详情页的「知识卡片」按钮点进来要**停在那本书**上。
   * 之前那个按钮只能跳到全局列表（页面根本不认参数），用户还得自己在下拉里再选一次书 ——
   * 按钮的承诺和实际行为对不上。
   */
  const [searchParams] = useSearchParams()

  const [activeTab, setActiveTab] = useState<TabKey>('cards')
  const [cards, setCards] = useState<KnowledgeCardItem[]>([])
  const [books, setBooks] = useState<BookRow[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedBook, setSelectedBook] = useState(() => searchParams.get('bookId') ?? '')
  const [selectedType, setSelectedType] = useState<FilterType>('all')
  const [selectedTag, setSelectedTag] = useState('')
  const [distillingBookId, setDistillingBookId] = useState<string | null>(null)
  const [distillProgress, setDistillProgress] = useState<DistillProgress | null>(null)
  const [flippedId, setFlippedId] = useState<string | null>(null)
  const [generatingMap, setGeneratingMap] = useState<Record<string, 'interpretation' | 'application' | null>>({})
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')
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
      setCards(mapKnowledgeCards(cardsRaw as unknown[]))
      setBooks(mapBooks(booksRaw as unknown[]))
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
    return { total, concepts, methodologies, quotes }
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

    // 这本已经有卡片了 → 点的是「重新蒸馏」，语义是**替换**。
    // 旧卡片上的解读、应用、掌握度会一起消失，必须先问清楚。
    const existing = cards.filter((c) => c.bookId === bookId).length
    if (existing > 0) {
      const ok = window.confirm(
        `《${safeStr(book.title)}》已有 ${existing} 张卡片。\n\n重新蒸馏会先清空它们再重新生成（解读、应用、掌握度都会丢失），确定继续？`,
      )
      if (!ok) return
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
      // replace=true：主进程会先清空这本书的旧卡片（界面上的「重新蒸馏」）
      await window.electronAPI.knowledgeCard.distill(bookId, safeStr(book.title), existing > 0)
      toast.remove(loadingId)
      toast.success(existing > 0 ? `重新蒸馏完成，已替换原有 ${existing} 张卡片` : '知识卡片蒸馏完成')
      // distill 的 Promise 在卡片蒸馏并落库完成后才 resolve，直接清进度 + 刷新即可：
      // 进度浮层已由 finally 的 distillingBookId=null 关闭，800ms 魔法延时只会让列表晚刷新
      setDistillProgress(null)
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

  /** 导出当前筛选结果为 JSON（纯前端下载，无后端） */
  const handleExportCards = () => {
    if (filteredCards.length === 0) {
      toast.info('没有可导出的卡片')
      return
    }
    try {
      const payload = filteredCards.map((c) => ({
        id: c.id,
        bookId: c.bookId,
        bookTitle: getBookTitle(c.bookId),
        type: c.type,
        title: c.title,
        content: c.content,
        interpretation: c.interpretation ?? '',
        application: c.application ?? '',
        tags: c.tags ?? [],
        masteryLevel: c.masteryLevel,
        reviewCount: c.reviewCount,
      }))
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `knowledge-cards-${new Date().toISOString().slice(0, 10)}.json`
      a.click()
      URL.revokeObjectURL(url)
      toast.success(`已导出 ${payload.length} 张卡片`)
    } catch (error) {
      toast.error(`导出失败: ${error instanceof Error ? error.message : String(error)}`)
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
            {/* 「AI 批量生成」已删除：它只是 setActiveTab('distill') —— 和下面那排
                tab 芯片里的「蒸馏中心」是同一个动作，而且它自己不生成任何东西
                （真正的生成按钮在蒸馏中心里，要选一本书）。
                同一个"去蒸馏中心"留一个入口就够了。 */}
            <Button
              variant="ghost"
              onClick={handleExportCards}
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
            {/* 3 统计卡 */}
            <div
              className="grid stats"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
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
                      onClick={() => setViewMode('grid')}
                      style={iconBtnStyle(viewMode === 'grid')}
                    >
                      <Icon name="cards" size={14} />
                    </button>
                    <button
                      type="button"
                      data-dom-id="view-list"
                      aria-label="列表视图"
                      onClick={() => setViewMode('list')}
                      style={iconBtnStyle(viewMode === 'list')}
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
            ) : viewMode === 'list' ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
                {filteredCards.map((card) => (
                  <div
                    key={card.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1.4fr 0.6fr 1fr auto',
                      gap: 'calc(var(--spacing) * 3)',
                      alignItems: 'center',
                      padding: 'calc(var(--spacing) * 3.5) calc(var(--spacing) * 4)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      background: 'var(--card)',
                    }}
                  >
                    <strong
                      style={{
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={card.title}
                    >
                      {card.title}
                    </strong>
                    <span style={{ color: 'var(--muted-foreground)', fontSize: '0.84rem' }}>
                      {typeConfig[card.type]?.label ?? card.type}
                    </span>
                    <span
                      style={{
                        color: 'var(--muted-foreground)',
                        fontSize: '0.84rem',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={getBookTitle(card.bookId)}
                    >
                      {getBookTitle(card.bookId)}
                    </span>
                    <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 2)' }}>
                      <button
                        type="button"
                        aria-label="删除"
                        data-dom-id={`card-${card.id}-delete-list`}
                        style={iconBtnStyle(false)}
                        onClick={() => void handleDelete(card.id)}
                      >
                        <Icon name="trash" size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
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
                    onGenerateInterpretation={() => handleGenerateInterpretation(card)}
                    onGenerateApplication={() => handleGenerateApplication(card)}
                    getBookTitle={getBookTitle}
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
            {/* 书籍网格 */}
            {books.length > 0 ? (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                  gap: 'calc(var(--spacing) * 3)',
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
                        padding: 'calc(var(--spacing) * 3)',
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
                          gap: 'calc(var(--spacing) * 2)',
                          marginBottom: 'calc(var(--spacing) * 2)',
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



