/**
 * Methodologies — 书籍方法论页（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/methodologies-v2.html
 *
 * 结构：
 *   - hero: 标题 + 副标题 + 2 actions（AI提取方法论 / 开始练习）
 *   - extract-panel: AI提取面板（book-select + 4 opt-chips + 开始提取 + token-hint）
 *   - page-body methodologies-v2 (grid 1.4fr 1fr):
 *       左 method-list（toolbar-search + view-toggle + filter-chips + method-card-v2 列表）
 *       右 method-detail-v2（sticky 详情面板：head + 6 sections + 3 actions）
 *
 * 业务逻辑全部保留：loadData / handleExtract（错误分类）/ handleDelete / 搜索 / 书籍筛选 / 标签筛选 /
 *   掌握度等级 getMasteryLabel / getMasteryProgress / 所有 toast 消息
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { Loading, EmptyState } from '@/components/ui/Feedback'
import { toast } from '../stores/toastStore'
import { safeStr, safeNum, formatDate, formatDateShort, mapMethodologies } from '../utils/db-mapper'

// ===== 类型 =====
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

type ViewMode = 'card' | 'list' | 'book'
type MasteryFilter = 'all' | 'todo' | 'mastered'

// ===== 常量 =====

/** 触发场景徽章配色（与设计稿 6 张卡片一致：primary / chart-5 / chart-3 / chart-4 循环） */
const TRIGGER_PALETTE: { bg: string; color: string }[] = [
  { bg: 'color-mix(in srgb, var(--primary) 12%, transparent)', color: 'var(--primary)' },
  { bg: 'color-mix(in srgb, var(--chart-5) 14%, transparent)', color: 'var(--chart-5)' },
  {
    bg: 'color-mix(in srgb, var(--chart-3) 22%, transparent)',
    color: 'color-mix(in srgb, var(--chart-3) 70%, var(--foreground))',
  },
  { bg: 'color-mix(in srgb, var(--chart-4) 14%, transparent)', color: 'var(--chart-4)' },
]

/** 视图切换配置 */
const VIEW_TOGGLES: { mode: ViewMode; label: string; icon: 'grid' | 'list' | 'book-group' }[] = [
  { mode: 'card', label: '卡片', icon: 'grid' },
  { mode: 'list', label: '列表', icon: 'list' },
  { mode: 'book', label: '按书分组', icon: 'book-group' },
]

/** 掌握度筛选配置 */
const MASTERY_FILTERS: { key: MasteryFilter; label: string; domId: string }[] = [
  { key: 'all', label: '全部', domId: 'filter-all' },
  { key: 'todo', label: '待练习', domId: 'filter-todo' },
  { key: 'mastered', label: '已掌握', domId: 'filter-mastered' },
]

/** AI 提取可选项 */
const EXTRACT_OPTIONS: { key: 'steps' | 'scenario' | 'examples' | 'outputFormat'; label: string; default: boolean }[] = [
  { key: 'steps', label: '步骤', default: true },
  { key: 'scenario', label: '场景', default: true },
  { key: 'examples', label: '示例', default: true },
  { key: 'outputFormat', label: '输出格式', default: false },
]

// ===== 内联 SVG 图标（设计稿特有，不在 Icon 组件库中） =====

/** AI 提取方法论（麦克风样式） */
function IconAI({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M12 3a1 1 0 0 0-1 1v9a1 1 0 0 0 2 0V4a1 1 0 0 0-1-1z" />
      <path d="M5.5 8a6.5 6.5 0 1 0 13 0" />
      <path d="M5 21h14" />
    </svg>
  )
}

/** 提取/魔杖 */
function IconWand({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
      <path d="m14 7 3 3" />
      <path d="m7 14-3-3" />
      <path d="M7 7 4.636 4.636a3 3 0 0 0-0.953 2.16v3.408a3 3 0 0 0 .879 2.121l9.578 9.578a3 3 0 0 0 4.243 0l1.768-1.768a3 3 0 0 0 0-4.243z" />
    </svg>
  )
}

/** 卡片网格视图 */
function IconGrid({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  )
}

/** 列表视图 */
function IconList({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <line x1="8" x2="21" y1="6" y2="6" />
      <line x1="8" x2="21" y1="12" y2="12" />
      <line x1="8" x2="21" y1="18" y2="18" />
      <line x1="3" x2="3.01" y1="6" y2="6" />
      <line x1="3" x2="3.01" y1="12" y2="12" />
      <line x1="3" x2="3.01" y1="18" y2="18" />
    </svg>
  )
}

/** 按书分组视图 */
function IconBookGroup({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <rect x="7" y="7" width="10" height="10" />
    </svg>
  )
}

/** 练习次数（带勾的圆） */
function IconCheckCircle({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}

/** 书籍（打开的书） */
function IconBookOpen({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  )
}

/** 通用 SVG 图标映射（视图切换） */
function ViewToggleIcon({ name, size }: { name: 'grid' | 'list' | 'book-group'; size: number }) {
  if (name === 'grid') return <IconGrid size={size} />
  if (name === 'list') return <IconList size={size} />
  return <IconBookGroup size={size} />
}

// ===== 工具函数 =====

/** 掌握度等级标签（与设计稿一致：精通 / 熟练 / 进阶 / 入门） */
function getMasteryLabel(level: number): string {
  const pct = Math.min(Math.max(safeNum(level), 0), 100)
  if (pct >= 80) return '精通'
  if (pct >= 60) return '熟练'
  if (pct >= 30) return '进阶'
  return '入门'
}

/** 掌握度进度（0-100，clamp） */
function getMasteryProgress(level: number): number {
  return Math.min(Math.max(safeNum(level), 0), 100)
}

/** 为方法论计算触发徽章（文本 + 配色） */
function getTriggerBadge(
  m: MethodologyItem,
  index: number,
): { text: string; bg: string; color: string } | null {
  let text = ''
  if (m.tags && m.tags.length > 0) {
    text = safeStr(m.tags[0])
  } else if (m.triggerScenario) {
    const s = safeStr(m.triggerScenario)
    text = s.length > 6 ? `${s.slice(0, 6)}…` : s
  }
  if (!text) return null
  const palette = TRIGGER_PALETTE[index % TRIGGER_PALETTE.length]
  return { text, bg: palette.bg, color: palette.color }
}

// ===== 主组件 =====
export default function Methodologies() {
  const navigate = useNavigate()
  const [methodologies, setMethodologies] = useState<MethodologyItem[]>([])
  const [books, setBooks] = useState<BookInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedBook, setSelectedBook] = useState('')
  const [selectedTag, setSelectedTag] = useState('')
  const [viewMode, setViewMode] = useState<ViewMode>('card')
  const [masteryFilter, setMasteryFilter] = useState<MasteryFilter>('all')
  const [extractingBookId, setExtractingBookId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedMethod, setSelectedMethod] = useState<MethodologyItem | null>(null)
  const [showExtractPanel, setShowExtractPanel] = useState(true)
  const [extractBook, setExtractBook] = useState('')
  const [extractOptions, setExtractOptions] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    EXTRACT_OPTIONS.forEach((opt) => {
      initial[opt.key] = opt.default
    })
    return initial
  })

  const initialSelectDone = useRef(false)

  useEffect(() => {
    loadData()
  }, [])

  // 首次加载完成后自动选中第一个方法论（与设计稿一致：右侧详情面板默认显示）
  useEffect(() => {
    if (!initialSelectDone.current && methodologies.length > 0) {
      setSelectedMethod(methodologies[0])
      initialSelectDone.current = true
    }
  }, [methodologies])

  const loadData = async () => {
    if (!window.electronAPI?.methodology || !window.electronAPI?.book) {
      setLoading(false)
      return
    }
    try {
      const [methodsRaw, booksRaw] = await Promise.all([
        window.electronAPI.methodology.getAll(),
        window.electronAPI.book.getAll(),
      ])
      const mappedMethods = mapMethodologies(methodsRaw as unknown as Record<string, unknown>[])
      setMethodologies(mappedMethods as unknown as MethodologyItem[])
      setBooks((booksRaw as BookInfo[]) || [])
      // 默认提取书籍：第一本
      if (booksRaw && Array.isArray(booksRaw) && booksRaw.length > 0) {
        const firstBook = (booksRaw as BookInfo[])[0]
        setExtractBook((prev) => prev || safeStr(firstBook.id))
      }
    } catch (error) {
      console.error('加载方法论数据失败:', error)
      toast.error('加载方法论数据失败')
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

  const getBookInfo = useCallback(
    (bookId: string): BookInfo | undefined => {
      return books.find((b) => b.id === bookId)
    },
    [books],
  )

  const allTags = useMemo(() => {
    const tagSet = new Set<string>()
    methodologies.forEach((m) => {
      m.tags?.forEach((tag) => tagSet.add(tag))
    })
    return Array.from(tagSet).sort()
  }, [methodologies])

  const filteredMethodologies = useMemo(() => {
    let result = methodologies

    if (selectedBook) {
      result = result.filter((m) => m.bookId === selectedBook)
    }

    if (selectedTag) {
      result = result.filter((m) => m.tags?.includes(selectedTag))
    }

    if (masteryFilter === 'todo') {
      result = result.filter((m) => getMasteryProgress(m.masteryLevel) < 30)
    } else if (masteryFilter === 'mastered') {
      result = result.filter((m) => getMasteryProgress(m.masteryLevel) >= 80)
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim()
      const terms = query.split(/\s+/).filter((t) => t.length > 0)
      result = result.filter((m) => {
        const searchText = [
          m.name,
          m.nameEn,
          m.triggerScenario,
          m.description,
          m.outputFormat,
          m.examples,
          getBookTitle(m.bookId),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        return terms.every((term) => searchText.includes(term))
      })
    }

    return result
  }, [methodologies, selectedBook, selectedTag, masteryFilter, searchQuery, getBookTitle])

  const methodologiesByBook = useMemo(() => {
    const map = new Map<string, MethodologyItem[]>()
    filteredMethodologies.forEach((m) => {
      const list = map.get(m.bookId) || []
      list.push(m)
      map.set(m.bookId, list)
    })
    return map
  }, [filteredMethodologies])

  /** 各筛选档位计数（用于 filter-chips 显示数量） */
  const masteryCounts = useMemo(() => {
    let todo = 0
    let mastered = 0
    methodologies.forEach((m) => {
      const pct = getMasteryProgress(m.masteryLevel)
      if (pct < 30) todo++
      else if (pct >= 80) mastered++
    })
    return { all: methodologies.length, todo, mastered }
  }, [methodologies])

  const handleExtract = async (bookId: string) => {
    const book = books.find((b) => b.id === bookId)
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
      // 若删除的是当前选中的方法论，清空选中
      if (selectedMethod?.id === id) {
        setSelectedMethod(null)
      }
      await loadData()
      toast.success('已删除')
    } catch (error) {
      toast.error(`删除失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** 切换提取选项 chip */
  const toggleExtractOption = (key: string) => {
    setExtractOptions((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  if (loading) {
    return <Loading hint="正在加载方法论数据..." />
  }

  return (
    <PageHero
      title="书籍方法论"
      subtitle="从阅读中提取可复用的方法论"
      actions={
        <>
          <Button
            variant="primary"
            onClick={() => setShowExtractPanel((v) => !v)}
            data-dom-id="cta-extract"
          >
            <IconAI size={15} /> AI提取方法论
          </Button>
          <Button
            variant="ghost"
            onClick={() => navigate('/review')}
            data-dom-id="cta-practice"
          >
            <Icon name="play" size={15} /> 开始练习
          </Button>
        </>
      }
    >
      {/* ===== AI 提取面板 ===== */}
      {showExtractPanel && books.length > 0 && (
        <div
          className="extract-panel"
          role="region"
          aria-label="AI方法论提取"
          style={{
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 'calc(var(--radius) + 6px)',
            padding: 'calc(var(--spacing) * 5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'calc(var(--spacing) * 4)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          {/* head: 标题 + token 提示 */}
          <div
            className="extract-head"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'calc(var(--spacing) * 3)',
            }}
          >
            <div className="extract-title" style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)', minWidth: 0 }}>
              <span
                className="glyph"
                style={{
                  width: '1.4rem',
                  height: '1.4rem',
                  flex: '0 0 1.4rem',
                  display: 'grid',
                  placeItems: 'center',
                  borderRadius: 'var(--radius)',
                  background: 'color-mix(in srgb, var(--primary) 12%, transparent)',
                  color: 'var(--primary)',
                }}
              >
                <IconAI size={18} />
              </span>
              <div style={{ minWidth: 0 }}>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600, color: 'var(--card-foreground)' }}>
                  AI提取方法论
                </h3>
                <div style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)', marginTop: '0.15rem' }}>
                  从书籍划线笔记中智能识别可复用方法
                </div>
              </div>
            </div>
            <span
              className="token-hint"
              style={{
                fontSize: '0.76rem',
                color: 'var(--muted-foreground)',
                fontFamily: 'var(--font-mono)',
                whiteSpace: 'nowrap',
              }}
            >
              约消耗 1,240 tokens
            </span>
          </div>

          {/* body: 书籍选择 + 选项 chips + 提取按钮 */}
          <div
            className="extract-body"
            style={{
              display: 'flex',
              alignItems: 'flex-end',
              gap: 'calc(var(--spacing) * 4)',
              flexWrap: 'wrap',
            }}
          >
            {/* 书籍选择 */}
            <div className="extract-field" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)', minWidth: 0, flex: 1 }}>
              <label htmlFor="book-select" style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted-foreground)' }}>
                选择书籍
              </label>
              <div
                className="field-control"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'calc(var(--spacing) * 3)',
                  padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                  border: '1px solid var(--input)',
                  borderRadius: 'var(--radius)',
                  background: 'var(--popover)',
                  color: 'var(--foreground)',
                  fontSize: '0.88rem',
                  minWidth: 0,
                }}
              >
                <span className="glyph" style={{ width: '1.1rem', flex: '0 0 1.1rem', color: 'var(--muted-foreground)' }}>
                  <IconBookOpen size={16} />
                </span>
                <select
                  id="book-select"
                  aria-label="选择书籍"
                  value={extractBook}
                  onChange={(e) => setExtractBook(e.target.value)}
                  style={{
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    color: 'var(--foreground)',
                    fontSize: '0.88rem',
                    width: '100%',
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                >
                  {books.map((book) => (
                    <option key={book.id} value={book.id}>
                      {safeStr(book.title)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* 提取内容选项 */}
            <div className="extract-field" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)', flex: '0 0 auto' }}>
              <label style={{ fontSize: '0.78rem', fontWeight: 600, color: 'var(--muted-foreground)' }}>
                提取内容
              </label>
              <div className="extract-options" style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 2)', flexWrap: 'wrap' }}>
                {EXTRACT_OPTIONS.map((opt) => {
                  const active = !!extractOptions[opt.key]
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      data-active={active}
                      onClick={() => toggleExtractOption(opt.key)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.4rem',
                        padding: '0.42rem 0.85rem',
                        border: '1px solid',
                        borderColor: active ? 'var(--secondary)' : 'var(--border)',
                        background: active ? 'var(--secondary)' : 'var(--card)',
                        color: active ? 'var(--secondary-foreground)' : 'var(--muted-foreground)',
                        borderRadius: 'var(--radius)',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
                        fontFamily: 'inherit',
                      }}
                    >
                      <span
                        className="dot"
                        style={{
                          width: 8,
                          height: 8,
                          borderRadius: 999,
                          background: active ? 'var(--primary)' : 'var(--muted-foreground)',
                          flexShrink: 0,
                        }}
                      />
                      {opt.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 开始提取按钮 */}
            <div className="extract-actions" style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)', flexShrink: 0 }}>
              <Button
                variant="primary"
                onClick={() => extractBook && handleExtract(extractBook)}
                disabled={!extractBook || extractingBookId === extractBook}
                data-dom-id="cta-extract-run"
              >
                {extractingBookId === extractBook ? (
                  <>
                    <span
                      style={{
                        width: 12,
                        height: 12,
                        borderRadius: '50%',
                        border: '1.5px solid var(--primary-foreground)',
                        borderTopColor: 'transparent',
                        animation: 'spin 0.8s linear infinite',
                        display: 'inline-block',
                      }}
                    />
                    提取中
                  </>
                ) : (
                  <>
                    <IconWand size={15} /> 开始提取
                  </>
                )}
              </Button>
            </div>
          </div>
          <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
        </div>
      )}

      {/* ===== 方法论主体：列表 + 详情 ===== */}
      <div
        className="page-body methodologies-v2"
        style={{
          display: 'grid',
          // minmax(0, ...) 强制 fr 列允许收缩到 0，避免 min-content 把右侧 aside 撑出父容器
          gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)',
          gap: 'calc(var(--spacing) * 5)',
          alignItems: 'start',
          minWidth: 0,
        }}
      >
        {/* ===== 左列：方法论列表 ===== */}
        <div className="method-list" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 4)', minWidth: 0 }}>
          {/* 工具条：搜索 + 视图切换 + 筛选 chips */}
          <div className="list-toolbar" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)' }}>
            <div className="toolbar-row" style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)', flexWrap: 'wrap' }}>
              {/* 搜索框 */}
              <div
                className="toolbar-search"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'calc(var(--spacing) * 2.5)',
                  flex: 1,
                  minWidth: 180,
                  padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 3.5)',
                  border: '1px solid var(--input)',
                  borderRadius: 'var(--radius)',
                  background: 'var(--popover)',
                  color: 'var(--muted-foreground)',
                }}
              >
                <span className="glyph" style={{ width: '1rem', flex: '0 0 1rem' }}>
                  <Icon name="search" size={15} />
                </span>
                <input
                  type="search"
                  aria-label="搜索方法论"
                  placeholder="搜索方法论名称或标签..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  style={{
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    color: 'var(--foreground)',
                    width: '100%',
                    fontSize: '0.85rem',
                    fontFamily: 'inherit',
                  }}
                />
              </div>

              {/* 视图切换 */}
              <div
                className="view-toggle"
                role="tablist"
                aria-label="视图切换"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0,
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  background: 'var(--card)',
                  padding: 'var(--spacing)',
                  marginLeft: 'auto',
                }}
              >
                {VIEW_TOGGLES.map((toggle) => {
                  const active = viewMode === toggle.mode
                  return (
                    <button
                      key={toggle.mode}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      data-active={active}
                      onClick={() => setViewMode(toggle.mode)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 'calc(var(--spacing) * 2)',
                        padding: '0.4rem 0.8rem',
                        border: 'none',
                        background: active ? 'var(--secondary)' : 'transparent',
                        color: active ? 'var(--secondary-foreground)' : 'var(--muted-foreground)',
                        borderRadius: 'calc(var(--radius) - 2px)',
                        cursor: 'pointer',
                        fontSize: '0.8rem',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        transition: 'background 0.2s ease, color 0.2s ease',
                        fontFamily: 'inherit',
                      }}
                    >
                      <span className="glyph" style={{ width: '1rem', flex: '0 0 1rem', display: 'grid', placeItems: 'center' }}>
                        <ViewToggleIcon name={toggle.icon} size={15} />
                      </span>
                      {toggle.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* 掌握度筛选 chips */}
            <div className="filter-chips" role="tablist" aria-label="掌握度筛选" style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 2)', flexWrap: 'wrap' }}>
              {MASTERY_FILTERS.map((f) => {
                const active = masteryFilter === f.key
                const count = masteryCounts[f.key]
                return (
                  <button
                    key={f.key}
                    type="button"
                    className={active ? 'chip active' : 'chip'}
                    data-dom-id={f.domId}
                    onClick={() => setMasteryFilter(f.key)}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '0.42rem 0.95rem',
                      border: '1px solid',
                      borderColor: active ? 'var(--primary)' : 'var(--border)',
                      background: active ? 'var(--primary)' : 'var(--card)',
                      color: active ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                      borderRadius: 'var(--radius)',
                      cursor: 'pointer',
                      fontSize: '0.8rem',
                      fontWeight: 500,
                      whiteSpace: 'nowrap',
                      transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
                      fontFamily: 'inherit',
                    }}
                  >
                    {f.label}
                    <span className="count" style={{ fontFamily: 'var(--font-mono)', opacity: 0.7, marginLeft: '0.3rem' }}>
                      {count}
                    </span>
                  </button>
                )
              })}

              {/* 标签筛选（仅在存在标签时显示） */}
              {allTags.length > 0 && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'calc(var(--spacing) * 2)',
                    marginLeft: 'auto',
                    padding: '0.3rem 0.6rem',
                    border: '1px solid var(--input)',
                    borderRadius: 'var(--radius)',
                    background: 'var(--popover)',
                  }}
                >
                  <Icon name="tag" size={14} />
                  <select
                    aria-label="按标签筛选"
                    value={selectedTag}
                    onChange={(e) => setSelectedTag(e.target.value)}
                    style={{
                      border: 'none',
                      outline: 'none',
                      background: 'transparent',
                      color: 'var(--foreground)',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    <option value="">全部标签</option>
                    {allTags.map((tag) => (
                      <option key={tag} value={tag}>
                        {tag}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* 书籍筛选（仅在存在多本书时显示） */}
              {books.length > 1 && (
                <div
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'calc(var(--spacing) * 2)',
                    padding: '0.3rem 0.6rem',
                    border: '1px solid var(--input)',
                    borderRadius: 'var(--radius)',
                    background: 'var(--popover)',
                  }}
                >
                  <IconBookOpen size={14} />
                  <select
                    aria-label="按书籍筛选"
                    value={selectedBook}
                    onChange={(e) => setSelectedBook(e.target.value)}
                    style={{
                      border: 'none',
                      outline: 'none',
                      background: 'transparent',
                      color: 'var(--foreground)',
                      fontSize: '0.8rem',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      maxWidth: 160,
                    }}
                  >
                    <option value="">全部书籍</option>
                    {books.map((book) => (
                      <option key={book.id} value={book.id}>
                        {safeStr(book.title)}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          </div>

          {/* 列表区域：空状态 / 卡片视图 / 列表视图 / 按书分组 */}
          {filteredMethodologies.length === 0 ? (
            <div
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 'calc(var(--radius) + 6px)',
              }}
            >
              <EmptyState
                icon={<Icon name="methodology" size={24} />}
                title={searchQuery || selectedBook || selectedTag || masteryFilter !== 'all' ? '没有找到匹配的方法论' : '还没有方法论'}
                description={
                  searchQuery || selectedBook || selectedTag || masteryFilter !== 'all'
                    ? '尝试调整筛选条件或搜索关键词'
                    : '从书籍中提取方法论，自动注入智能体让它越来越聪明'
                }
                action={
                  books.length > 0 && !searchQuery && !selectedBook && !selectedTag ? (
                    <Button variant="primary" onClick={() => extractBook && handleExtract(extractBook)} disabled={!extractBook || extractingBookId === extractBook}>
                      <IconWand size={15} /> 立即提取
                    </Button>
                  ) : undefined
                }
              />
            </div>
          ) : viewMode === 'book' ? (
            /* 按书分组视图 */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 5)' }}>
              {Array.from(methodologiesByBook.entries()).map(([bookId, methods]) => {
                const book = getBookInfo(bookId)
                return (
                  <div
                    key={bookId}
                    style={{
                      background: 'var(--card)',
                      border: '1px solid var(--border)',
                      borderRadius: 'calc(var(--radius) + 4px)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        padding: 'calc(var(--spacing) * 4) calc(var(--spacing) * 5)',
                        borderBottom: '1px solid var(--border)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 'calc(var(--spacing) * 3)',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)' }}>
                        <span style={{ color: 'var(--primary)' }}>
                          <IconBookOpen size={16} />
                        </span>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 600, color: 'var(--card-foreground)' }}>
                            《{safeStr(book?.title, '未知书籍')}》
                          </div>
                          <div style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)', marginTop: '0.15rem' }}>
                            {methods.length} 个方法论
                          </div>
                        </div>
                      </div>
                      <Button variant="ghost" onClick={() => handleExtract(bookId)} disabled={extractingBookId === bookId}>
                        <Icon name="refresh" size={14} />
                        {extractingBookId === bookId ? '提取中...' : '重新提取'}
                      </Button>
                    </div>
                    <div style={{ padding: 'calc(var(--spacing) * 4)', display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)' }}>
                      {methods.map((m, idx) => (
                        <MethodCardV2
                          key={m.id}
                          methodology={m}
                          index={idx}
                          bookTitle={getBookTitle(m.bookId)}
                          active={selectedMethod?.id === m.id}
                          onSelect={() => setSelectedMethod(m)}
                          onDelete={() => handleDelete(m.id)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          ) : viewMode === 'list' ? (
            /* 列表视图（紧凑行） */
            <div
              style={{
                background: 'var(--card)',
                border: '1px solid var(--border)',
                borderRadius: 'calc(var(--radius) + 4px)',
                overflow: 'hidden',
              }}
            >
              {filteredMethodologies.map((m, idx) => {
                const isExpanded = expandedId === m.id
                const pct = getMasteryProgress(m.masteryLevel)
                const lvl = getMasteryLabel(m.masteryLevel)
                const badge = getTriggerBadge(m, idx)
                return (
                  <div
                    key={m.id}
                    style={{
                      borderBottom: '1px solid var(--border)',
                      transition: 'background 0.16s ease',
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setExpandedId(isExpanded ? null : m.id)
                        setSelectedMethod(m)
                      }}
                      style={{
                        width: '100%',
                        padding: 'calc(var(--spacing) * 4) calc(var(--spacing) * 5)',
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        textAlign: 'left',
                        font: 'inherit',
                        color: 'inherit',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        gap: 'calc(var(--spacing) * 3)',
                        flexWrap: 'wrap',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'var(--muted)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent'
                      }}
                    >
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--card-foreground)' }}>
                            {safeStr(m.name)}
                          </strong>
                          {m.nameEn && (
                            <span style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)', fontFamily: 'var(--font-mono)' }}>
                              {safeStr(m.nameEn)}
                            </span>
                          )}
                          {badge && (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '0.35rem',
                                padding: '0.28rem 0.7rem',
                                borderRadius: 999,
                                fontSize: '0.72rem',
                                fontWeight: 600,
                                whiteSpace: 'nowrap',
                                lineHeight: 1,
                                background: badge.bg,
                                color: badge.color,
                              }}
                            >
                              {badge.text}
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)', marginTop: '0.2rem' }}>
                          来自《{getBookTitle(m.bookId)}》· 练习 {safeNum(m.practiceCount)} 次
                        </div>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)', flexShrink: 0 }}>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '0.82rem', color: 'var(--foreground)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                            {pct}%
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                            {lvl}
                          </div>
                        </div>
                        <Icon name={isExpanded ? 'chevron-up' : 'chevron-down'} size={16} />
                      </div>
                    </button>
                    {isExpanded && (
                      <div
                        style={{
                          padding: 'calc(var(--spacing) * 4) calc(var(--spacing) * 5)',
                          background: 'var(--muted)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 'calc(var(--spacing) * 3)',
                        }}
                      >
                        {m.triggerScenario && (
                          <div>
                            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)', fontWeight: 600, marginBottom: '0.4rem' }}>
                              触发场景
                            </div>
                            <div style={{ fontSize: '0.86rem', lineHeight: 1.65, color: 'var(--card-foreground)' }}>
                              {safeStr(m.triggerScenario)}
                            </div>
                          </div>
                        )}
                        {m.steps && m.steps.length > 0 && (
                          <div>
                            <div style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)', fontWeight: 600, marginBottom: '0.4rem' }}>
                              执行步骤
                            </div>
                            <ol style={{ margin: 0, paddingLeft: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
                              {m.steps.map((step, i) => (
                                <li key={i} style={{ display: 'flex', gap: 'calc(var(--spacing) * 3)', alignItems: 'flex-start', fontSize: '0.82rem', color: 'var(--muted-foreground)' }}>
                                  <span
                                    style={{
                                      width: 22,
                                      height: 22,
                                      borderRadius: '50%',
                                      background: 'var(--primary)',
                                      color: 'var(--primary-foreground)',
                                      display: 'grid',
                                      placeItems: 'center',
                                      fontWeight: 700,
                                      fontSize: '0.72rem',
                                      flexShrink: 0,
                                      fontFamily: 'var(--font-mono)',
                                    }}
                                  >
                                    {i + 1}
                                  </span>
                                  <span style={{ lineHeight: 1.55 }}>{safeStr(step)}</span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        )}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 4)', flexWrap: 'wrap', fontSize: '0.76rem', color: 'var(--muted-foreground)' }}>
                          <span>掌握度: {pct}%</span>
                          <span>练习次数: {safeNum(m.practiceCount)}</span>
                          <span>创建于: {formatDate(m.createdAt)}</span>
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            /* 卡片视图（默认）：垂直堆叠 method-card-v2 */
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 4)' }}>
              {filteredMethodologies.map((m, idx) => (
                <MethodCardV2
                  key={m.id}
                  methodology={m}
                  index={idx}
                  bookTitle={getBookTitle(m.bookId)}
                  active={selectedMethod?.id === m.id}
                  onSelect={() => setSelectedMethod(m)}
                  onDelete={() => handleDelete(m.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* ===== 右列：详情面板（sticky） ===== */}
        <aside
          className="card method-detail-v2 methodology-scroll"
          aria-label="方法论详情"
          style={{
            position: 'sticky',
            top: 'calc(var(--spacing) * 4)',
            padding: 'calc(var(--spacing) * 5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'calc(var(--spacing) * 4)',
            minWidth: 0,
            maxWidth: '100%',
            overflowX: 'auto',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 'calc(var(--radius) + 6px)',
            boxShadow: 'var(--shadow-sm)',
          }}
        >
          {selectedMethod ? (
            <MethodDetailPanel
              methodology={selectedMethod}
              index={methodologies.findIndex((m) => m.id === selectedMethod.id)}
              bookTitle={getBookTitle(selectedMethod.bookId)}
              onClose={() => setSelectedMethod(null)}
              onDelete={() => handleDelete(selectedMethod.id)}
              onInjectChat={() => {
                const bookId = selectedMethod.bookId
                const name = selectedMethod.name || '方法论'
                // 带书上下文进入对话；编排器会自动加载该书方法论
                if (bookId) {
                  navigate(`/chat?bookId=${encodeURIComponent(bookId)}`)
                } else {
                  navigate('/chat')
                }
                toast.success(`已打开对话，可继续讨论「${name}」`)
              }}
              onPractice={() => navigate('/review')}
            />
          ) : (
            <EmptyState
              icon={<Icon name="methodology" size={24} />}
              title="选择左侧方法论查看详情"
              description="点击左侧任意方法论卡片，即可在此查看完整信息"
            />
          )}
        </aside>

        {/* 自定义细滚动条：不抢视觉，仅在 hover 时高亮 */}
        <style>{`
          .methodology-scroll::-webkit-scrollbar {
            height: 6px;
            width: 6px;
          }
          .methodology-scroll::-webkit-scrollbar-thumb {
            background: var(--border);
            border-radius: 3px;
            transition: background 0.2s ease;
          }
          .methodology-scroll:hover::-webkit-scrollbar-thumb {
            background: var(--muted-foreground);
          }
          .methodology-scroll::-webkit-scrollbar-track {
            background: transparent;
          }
          .methodology-scroll::-webkit-scrollbar-corner {
            background: transparent;
          }
          .methodology-scroll {
            scrollbar-width: thin;
            scrollbar-color: var(--border) transparent;
          }
        `}</style>
      </div>
    </PageHero>
  )
}

// ===== 子组件：方法论卡片 v2 =====
interface MethodCardV2Props {
  methodology: MethodologyItem
  index: number
  bookTitle: string
  active: boolean
  onSelect: () => void
  onDelete: () => void
}

function MethodCardV2({ methodology, index, bookTitle, active, onSelect, onDelete }: MethodCardV2Props) {
  const pct = getMasteryProgress(methodology.masteryLevel)
  const lvl = getMasteryLabel(methodology.masteryLevel)
  const badge = getTriggerBadge(methodology, index)

  return (
    <article
      className="method-card-v2"
      data-active={active}
      data-method-id={methodology.id}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
      style={{
        padding: 'calc(var(--spacing) * 5)',
        border: '1px solid',
        borderColor: active ? 'var(--primary)' : 'var(--border)',
        borderRadius: 'calc(var(--radius) + 4px)',
        background: 'var(--card)',
        cursor: 'pointer',
        transition: 'border-color 0.2s ease, transform 0.16s ease',
        boxShadow: active ? '0 0 0 1px var(--primary)' : 'var(--shadow-sm)',
        outline: 'none',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.borderColor = 'var(--ring)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.borderColor = 'var(--border)'
      }}
      onFocus={(e) => {
        e.currentTarget.style.outline = '2px solid var(--ring)'
        e.currentTarget.style.outlineOffset = '2px'
      }}
      onBlur={(e) => {
        e.currentTarget.style.outline = 'none'
      }}
    >
      {/* 头部：trigger badge + name + mastery */}
      <div
        className="mc-head"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 'calc(var(--spacing) * 3)',
          marginBottom: 'calc(var(--spacing) * 3)',
        }}
      >
        <div className="mc-info" style={{ minWidth: 0, flex: 1 }}>
          {badge && (
            <span
              className="mc-trigger"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.28rem 0.7rem',
                borderRadius: 999,
                fontSize: '0.72rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                lineHeight: 1,
                background: badge.bg,
                color: badge.color,
              }}
            >
              {badge.text}
            </span>
          )}
          <div
            className="mc-name"
            style={{
              fontSize: '1.02rem',
              fontWeight: 600,
              marginTop: '0.5rem',
              color: 'var(--card-foreground)',
              textWrap: 'balance',
              wordBreak: 'keep-all',
              overflowWrap: 'break-word',
            }}
          >
            {safeStr(methodology.name)}
          </div>
          {methodology.nameEn && (
            <div
              className="mc-name-en"
              style={{
                fontSize: '0.78rem',
                color: 'var(--muted-foreground)',
                marginTop: '0.2rem',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {safeStr(methodology.nameEn)}
            </div>
          )}
        </div>
        <div
          className="mc-mastery"
          style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.4rem' }}
        >
          <div style={{ fontSize: '0.82rem', color: 'var(--foreground)', fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
            {pct}%
          </div>
          <div
            className="progress-track"
            style={{
              width: 84,
              height: 4,
              background: 'var(--muted)',
              borderRadius: 999,
              overflow: 'hidden',
            }}
          >
            <div
              className="progress-fill"
              style={{
                height: '100%',
                width: `${pct}%`,
                background: 'var(--primary)',
                transition: 'width 0.3s ease',
              }}
            />
          </div>
          <div
            className="lvl"
            style={{ fontSize: '0.7rem', color: 'var(--muted-foreground)', textTransform: 'uppercase', letterSpacing: '0.04em' }}
          >
            {lvl}
          </div>
        </div>
      </div>

      {/* 标签 */}
      {methodology.tags && methodology.tags.length > 0 && (
        <div
          className="mc-tags"
          style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap', marginTop: 'calc(var(--spacing) * 3)' }}
        >
          {methodology.tags.map((tag) => (
            <span
              key={tag}
              className="mc-tag"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                padding: '0.24rem 0.6rem',
                borderRadius: 'var(--radius)',
                background: 'var(--muted)',
                color: 'var(--muted-foreground)',
                fontSize: '0.72rem',
                whiteSpace: 'nowrap',
              }}
            >
              {safeStr(tag)}
            </span>
          ))}
        </div>
      )}

      {/* 元信息：练习次数 + 来源书 + 删除 */}
      <div
        className="mc-meta"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'calc(var(--spacing) * 4)',
          marginTop: 'calc(var(--spacing) * 4)',
          paddingTop: 'calc(var(--spacing) * 3)',
          borderTop: '1px solid var(--border)',
          fontSize: '0.76rem',
          color: 'var(--muted-foreground)',
          flexWrap: 'wrap',
        }}
      >
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap' }}>
          <span className="glyph" style={{ width: '0.95rem', flex: '0 0 0.95rem', color: 'var(--muted-foreground)', display: 'inline-flex' }}>
            <IconCheckCircle size={14} />
          </span>
          练习 {safeNum(methodology.practiceCount)} 次
        </span>
        <span className="src" style={{ minWidth: 0, flex: 1, display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}>
          <span className="glyph" style={{ width: '0.95rem', flex: '0 0 0.95rem', color: 'var(--muted-foreground)', display: 'inline-flex' }}>
            <IconBookOpen size={14} />
          </span>
          <b style={{ fontWeight: 600, color: 'var(--card-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {bookTitle}
          </b>
        </span>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            onDelete()
          }}
          aria-label="删除方法论"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.3rem',
            padding: '0.2rem 0.5rem',
            border: 'none',
            background: 'transparent',
            color: 'var(--destructive)',
            cursor: 'pointer',
            fontSize: '0.72rem',
            fontFamily: 'inherit',
            borderRadius: 'var(--radius)',
            transition: 'background 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'color-mix(in srgb, var(--destructive) 12%, transparent)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent'
          }}
        >
          <Icon name="trash" size={13} />
          删除
        </button>
      </div>
    </article>
  )
}

// ===== 子组件：详情面板 =====
interface MethodDetailPanelProps {
  methodology: MethodologyItem
  index: number
  bookTitle: string
  onClose: () => void
  onDelete: () => void
  onInjectChat: () => void
  onPractice: () => void
}

function MethodDetailPanel({
  methodology,
  index,
  bookTitle,
  onClose,
  onDelete,
  onInjectChat,
  onPractice,
}: MethodDetailPanelProps) {
  const pct = getMasteryProgress(methodology.masteryLevel)
  const lvl = getMasteryLabel(methodology.masteryLevel)
  const badge = getTriggerBadge(methodology, index)
  const steps = methodology.steps ?? []
  const updatedAt = methodology.updatedAt

  return (
    <>
      {/* 头部 */}
      <div
        className="md-head"
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 'calc(var(--spacing) * 3)',
        }}
      >
        <div className="md-head-info" style={{ minWidth: 0, flex: 1 }}>
          {badge && (
            <span
              className="md-trigger"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.35rem',
                padding: '0.28rem 0.7rem',
                borderRadius: 999,
                fontSize: '0.72rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                lineHeight: 1,
                background: badge.bg,
                color: badge.color,
              }}
            >
              {badge.text}
            </span>
          )}
          <h3
            style={{
              fontSize: '1.15rem',
              fontWeight: 700,
              margin: 'calc(var(--spacing) * 3) 0 0',
              color: 'var(--card-foreground)',
              textWrap: 'balance',
              wordBreak: 'keep-all',
              overflowWrap: 'break-word',
            }}
          >
            {safeStr(methodology.name)}
          </h3>
          {methodology.nameEn && (
            <div
              className="md-name-en"
              style={{
                fontSize: '0.78rem',
                color: 'var(--muted-foreground)',
                marginTop: '0.25rem',
                fontFamily: 'var(--font-mono)',
              }}
            >
              {safeStr(methodology.nameEn)}
            </div>
          )}
        </div>
        <button
          className="md-close"
          type="button"
          data-dom-id="detail-close"
          aria-label="关闭详情"
          onClick={onClose}
          style={{
            width: 32,
            height: 32,
            display: 'grid',
            placeItems: 'center',
            border: '1px solid var(--border)',
            background: 'var(--card)',
            color: 'var(--muted-foreground)',
            borderRadius: 'var(--radius)',
            cursor: 'pointer',
            flexShrink: 0,
            transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--sidebar-accent)'
            e.currentTarget.style.color = 'var(--sidebar-accent-foreground)'
            e.currentTarget.style.borderColor = 'var(--sidebar-border)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'var(--card)'
            e.currentTarget.style.color = 'var(--muted-foreground)'
            e.currentTarget.style.borderColor = 'var(--border)'
          }}
        >
          <Icon name="close" size={15} />
        </button>
      </div>

      {/* 触发场景 */}
      {methodology.triggerScenario && (
        <div className="md-section" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2.5)' }}>
          <div className="eyebrow" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)', fontWeight: 600 }}>
            触发场景
          </div>
          <p style={{ fontSize: '0.86rem', lineHeight: 1.65, color: 'var(--card-foreground)', margin: 0 }}>
            {safeStr(methodology.triggerScenario)}
          </p>
        </div>
      )}

      {/* 四步骤 */}
      {steps.length > 0 && (
        <div className="md-section" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2.5)' }}>
          <div className="eyebrow" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)', fontWeight: 600 }}>
            四步骤
          </div>
          <div className="steps-list" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 3)' }}>
            {steps.map((step, i) => {
              // 兼容 "标题：描述" 或 "标题。描述" 格式：尝试拆分
              const sep = step.match(/[：:。]\s*/)
              const strong = sep ? step.slice(0, sep.index).trim() : ''
              const desc = sep && sep.index !== undefined ? step.slice(sep.index + sep[0].length).trim() : ''
              return (
                <div className="step-item" key={i} style={{ display: 'flex', gap: 'calc(var(--spacing) * 3)', alignItems: 'flex-start' }}>
                  <div
                    className="step-num"
                    style={{
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      background: 'var(--primary)',
                      color: 'var(--primary-foreground)',
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 700,
                      fontSize: '0.78rem',
                      flexShrink: 0,
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {i + 1}
                  </div>
                  <div className="step-content" style={{ minWidth: 0, flex: 1 }}>
                    {strong && (
                      <strong style={{ fontSize: '0.86rem', fontWeight: 600, color: 'var(--card-foreground)', display: 'block' }}>
                        {strong}
                      </strong>
                    )}
                    <p style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)', marginTop: strong ? '0.2rem' : 0, lineHeight: 1.55, margin: strong ? '0.2rem 0 0' : 0 }}>
                      {desc || (strong ? '' : safeStr(step))}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 输出格式 */}
      {methodology.outputFormat && (
        <div className="md-section" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2.5)' }}>
          <div className="eyebrow" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)', fontWeight: 600 }}>
            输出格式
          </div>
          <div
            className="md-output"
            style={{
              padding: 'calc(var(--spacing) * 3.5)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              background: 'var(--muted)',
              fontSize: '0.82rem',
              lineHeight: 1.6,
              color: 'var(--card-foreground)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {safeStr(methodology.outputFormat)}
          </div>
        </div>
      )}

      {/* 应用示例 */}
      {methodology.examples && (
        <div className="md-section" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2.5)' }}>
          <div className="eyebrow" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)', fontWeight: 600 }}>
            应用示例
          </div>
          <div
            className="md-example"
            style={{
              padding: 'calc(var(--spacing) * 3.5)',
              border: '1px solid var(--border)',
              borderLeft: '3px solid var(--primary)',
              borderRadius: 'var(--radius)',
              background: 'var(--card)',
              fontSize: '0.82rem',
              lineHeight: 1.65,
              color: 'var(--muted-foreground)',
            }}
          >
            {safeStr(methodology.examples)}
          </div>
        </div>
      )}

      {/* 掌握度 */}
      <div className="md-section" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2.5)' }}>
        <div className="eyebrow" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)', fontWeight: 600 }}>
          掌握度
        </div>
        <div className="md-mastery-row" style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 4)', flexWrap: 'wrap' }}>
          <div className="md-mastery-bar" style={{ flex: 1, minWidth: 120 }}>
            <div
              className="progress-track"
              style={{
                width: '100%',
                height: 6,
                background: 'var(--muted)',
                borderRadius: 999,
                overflow: 'hidden',
              }}
            >
              <div
                className="progress-fill"
                style={{
                  height: '100%',
                  width: `${pct}%`,
                  background: 'var(--primary)',
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
          </div>
          <div
            className="md-mastery-stats"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'calc(var(--spacing) * 4)',
              fontSize: '0.78rem',
              color: 'var(--muted-foreground)',
              flexShrink: 0,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
              {pct}%
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
              练习 {safeNum(methodology.practiceCount)} 次
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.35rem', whiteSpace: 'nowrap', fontFamily: 'var(--font-mono)' }}>
              {lvl} · 最近 {formatDateShort(updatedAt)}
            </span>
          </div>
        </div>
      </div>

      {/* 来源划线 */}
      <div className="md-section" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2.5)' }}>
        <div className="eyebrow" style={{ fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-foreground)', fontWeight: 600 }}>
          来源划线
        </div>
        <div
          className="md-source"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'calc(var(--spacing) * 2.5)',
            padding: 'calc(var(--spacing) * 3.5)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--radius)',
            background: 'var(--popover)',
          }}
        >
          <div
            className="md-source-head"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'calc(var(--spacing) * 3)',
              fontSize: '0.8rem',
            }}
          >
            <span className="glyph" style={{ width: '1rem', flex: '0 0 1rem', color: 'var(--primary)' }}>
              <IconBookOpen size={15} />
            </span>
            <b style={{ fontWeight: 600, color: 'var(--card-foreground)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {bookTitle}
            </b>
            {methodology.createdAt && (
              <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'var(--muted-foreground)' }}>
                创建于 {formatDateShort(methodology.createdAt)}
              </span>
            )}
          </div>
          {methodology.description && (
            <div
              className="md-source-quote"
              style={{
                fontSize: '0.82rem',
                lineHeight: 1.65,
                color: 'var(--muted-foreground)',
                borderLeft: '2px solid var(--border)',
                paddingLeft: 'calc(var(--spacing) * 3)',
                textWrap: 'pretty',
              }}
            >
              {safeStr(methodology.description)}
            </div>
          )}
        </div>
      </div>

      {/* 操作按钮 */}
      <div
        className="md-actions"
        style={{
          display: 'flex',
          gap: 'calc(var(--spacing) * 3)',
          marginTop: 'calc(var(--spacing) * 2)',
          flexWrap: 'wrap',
          paddingTop: 'calc(var(--spacing) * 4)',
          borderTop: '1px solid var(--border)',
        }}
      >
        <Button variant="primary" onClick={onInjectChat} data-dom-id="cta-inject-chat">
          <Icon name="chat" size={15} /> 注入AI对话
        </Button>
        <Button variant="ghost" onClick={onPractice} data-dom-id="cta-practice-detail">
          <Icon name="play" size={15} /> 开始练习
        </Button>
        <Button
          variant="ghost"
          onClick={onDelete}
          data-dom-id="cta-delete"
          style={{ marginLeft: 'auto', color: 'var(--destructive)', borderColor: 'var(--destructive)' }}
        >
          <Icon name="trash" size={15} /> 删除
        </Button>
        <p className="text-sm text-gray-500" style={{ width: '100%', fontSize: '0.82rem' }}>
          方法论来自 AI 提取，暂不支持本地编辑；可删除后重新提取
        </p>
      </div>
    </>
  )
}
