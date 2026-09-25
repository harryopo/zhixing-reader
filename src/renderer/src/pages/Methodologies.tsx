/**
 * Methodologies — 书籍方法论页（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/methodologies-v2.html
 *
 * 结构：
 *   - hero: 标题 + 副标题 + 2 actions（AI提取方法论 / 开始练习）
 *   - extract-panel: AI提取面板（book-select + 开始提取 + token-hint）
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
import { safeStr, safeNum, formatDate, mapMethodologies, mapBooks } from '../utils/db-mapper'
import { deleteWithUndo } from '@/utils/undoable-delete'
import { useReviewEnrollment } from '@/utils/use-review-enrollment'
import {
  BookCoverageView,
  coverageNotice,
  describeBookCoverage,
  generateButtonLabel,
  resolveGenerateAction,
} from '../../../shared/ai-coverage'
import {
  MASTERY_FILTERS,
  VIEW_TOGGLES,
  type BookInfo,
  type MasteryFilter,
  type MethodologyItem,
  type ViewMode,
} from './methodologies/model'
import { IconAI, IconBookOpen, IconWand, ViewToggleIcon } from './methodologies/icons'
import { getMasteryLabel, getMasteryProgress, getTriggerBadge } from './methodologies/helpers'
import { MethodCardV2 } from './methodologies/MethodCardV2'
import { MethodDetailPanel } from './methodologies/MethodDetailPanel'




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
  /** 每本书的提取进度（来自批次台账，不是方法论上标的来源条数） */
  const [coverageByBook, setCoverageByBook] = useState<Record<string, BookCoverageView>>({})
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [selectedMethod, setSelectedMethod] = useState<MethodologyItem | null>(null)
  const [showExtractPanel, setShowExtractPanel] = useState(true)
  const [extractBook, setExtractBook] = useState('')

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
      const [methodsRaw, booksRaw, coverageRaw] = await Promise.all([
        window.electronAPI.methodology.getAll(),
        window.electronAPI.book.getAll(),
        window.electronAPI.methodology.coverage(),
      ])
      setMethodologies(mapMethodologies(methodsRaw))
      setCoverageByBook(Object.fromEntries(coverageRaw.map((c) => [c.bookId, c])))
      const books = mapBooks(booksRaw)
      setBooks(books)
      // 默认提取书籍：第一本
      if (books.length > 0) {
        setExtractBook((prev) => prev || books[0].id)
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

  /**
   * 这本书的按钮该说什么、点下去是"接着补剩下那批"还是"从头再来"。
   * 判定与主进程共用 src/shared/ai-coverage.ts 那一份。
   */
  const generatePlan = (bookId: string, existing: number) =>
    resolveGenerateAction(coverageByBook[bookId] ?? describeBookCoverage(0, 0, 0), existing)

  /** 提取面板当前选中那本书的按钮语义（面板与按书分组用的是同一条规则） */
  const extractPlan = extractBook
    ? generatePlan(extractBook, methodologies.filter((m) => m.bookId === extractBook).length)
    : null

  const handleExtract = async (bookId: string) => {
    const book = books.find((b) => b.id === bookId)
    if (!book) return

    // 还剩多少条没提取过，决定这一颗按钮是「继续」还是「从头再来」
    const view = coverageByBook[bookId]
    const existing = methodologies.filter((m) => m.bookId === bookId).length
    const isRedo = generatePlan(bookId, existing).action === 'replace'
    if (isRedo) {
      const progressKnown = (view?.processed ?? 0) > 0
      const ok = window.confirm(
        progressKnown
          ? `《${safeStr(book.title)}》的 ${view?.total ?? 0} 条划线都已提取过（现有 ${existing} 条方法论）。\n\n重新提取会先清空它们再从头再来，确定继续？`
          : `《${safeStr(book.title)}》已有 ${existing} 条方法论，但那批进度无从追溯（生成台账是后加的）。\n\n重新提取会先清空它们再从头再来，确定继续？`,
      )
      if (!ok) return
    }

    setExtractingBookId(bookId)
    const toastId = toast.loading(`正在从《${safeStr(book.title)}》提取方法论，请耐心等待...`)
    try {
      // isRedo=true 才会走到"清空重来"；其余情况主进程只喂台账里没记过的那批
      const { coverage, nothingNew } = await window.electronAPI.methodology.extract(
        bookId,
        safeStr(book.title),
        isRedo,
      )
      await loadData()
      toast.remove(toastId)
      const done = nothingNew
        ? `《${safeStr(book.title)}》的划线都已提取过了，这次没有新的内容`
        : isRedo
          ? `重新提取完成，已替换原有 ${existing} 条方法论`
          : existing > 0
            ? `已接着提取下一批（此前已有 ${existing} 条）`
            : '方法论提取完成，已自动注入智能体'
      // 一次最多喂 50 条划线（src/shared/ai-coverage.ts 的上限），没处理完的部分要如实说出
      const notice = coverageNotice(coverage, '划线')
      toast.success(notice ? `${done} · ${notice}` : done, notice ? 9000 : undefined)
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

  // 导出方法论为可复用 Skill 文件（主进程生成 + 弹保存对话框写盘）
  const handleExportSkill = async (m: MethodologyItem) => {
    const toastId = toast.loading(`正在生成《${safeStr(m.name)}》的 Skill 文件...`)
    try {
      const res = await window.electronAPI.skill.exportFile(m.id, getBookTitle(m.bookId))
      toast.remove(toastId)
      if (res?.saved) {
        toast.success(`Skill 已导出：${res.path ?? ''}`)
      } else {
        toast.info('已取消导出')
      }
    } catch (error) {
      toast.remove(toastId)
      toast.error(`导出失败: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // 复习队列里的方法论 id 由主进程说了算，界面只读不算
  const review = useReviewEnrollment('methodology')

  const handleDelete = async (id: string) => {
    if (!confirm('确定要删除这个方法论吗？')) return
    // 删一条方法论会连着它的复习卡一起走（外键级联），所以删完两边名单都要重读
    if (
      await deleteWithUndo({
        kind: 'methodology',
        id,
        refresh: async () => {
          await loadData()
          await review.refresh()
        },
      })
    ) {
      // 删掉的正是当前选中那条时清空选中；撤销回来后要用户自己再点一次
      if (selectedMethod?.id === id) setSelectedMethod(null)
    }
  }

  const toggleReview = async (id: string) => {
    if (review.isEnrolled(id)) await review.unenroll(id)
    else await review.enrollMany([id])
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
            onClick={() => void review.enrollMany(methodologies.map((m) => m.id))}
            disabled={methodologies.length === 0 || review.loading}
            data-dom-id="cta-enroll-review"
          >
            <Icon name="review" size={15} /> 把 {String(methodologies.length)} 条加入复习
          </Button>
          {/* 「开始练习」已删除：它跳的是知识卡片页，而那一页没有任何练习功能，
              全项目也没有练习页。真正的"练习"是让 AI 用上这条方法论 ——
              详情面板里的「注入AI对话」才是那个入口（用上之后 practice_count 会 +1）。 */}
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
                    <IconWand size={15} />
                    {extractPlan
                      ? generateButtonLabel(extractPlan.action, extractPlan.view, {
                          start: '开始提取',
                          continue: '继续',
                          redo: '重新提取',
                        })
                      : '开始提取'}
                  </>
                )}
              </Button>
              {extractPlan && extractPlan.view.processed > 0 && (
                <span style={{ fontSize: '0.78rem', color: 'var(--muted-foreground)' }}>
                  已处理 {extractPlan.view.processed}/{extractPlan.view.total} 条划线
                  {extractPlan.view.remaining > 0
                    ? ` · 还剩 ${extractPlan.view.remaining} 条`
                    : ' · 整本都已提取'}
                </span>
              )}
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
                const plan = generatePlan(bookId, methods.length)
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
                        {extractingBookId === bookId
                          ? '提取中...'
                          : generateButtonLabel(plan.action, plan.view, {
                              start: '提取',
                              continue: '继续',
                              redo: '重新提取',
                            })}
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

        {/* ===== 右列：详情面板（sticky + 滚动） ===== */}
        <aside
          className="card method-detail-v2 methodology-scroll"
          aria-label="方法论详情"
          style={{
            position: 'sticky',
            top: 'calc(var(--spacing) * 4)',
            maxHeight: 'calc(100vh - calc(var(--spacing) * 12))',
            padding: 'calc(var(--spacing) * 5)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'calc(var(--spacing) * 4)',
            minWidth: 0,
            maxWidth: '100%',
            overflowX: 'auto',
            overflowY: 'auto',
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
              enrolled={review.isEnrolled(selectedMethod.id)}
              onToggleReview={() => void toggleReview(selectedMethod.id)}
              onInjectChat={() => {
                const bookId = selectedMethod.bookId
                const name = selectedMethod.name || '方法论'
                // 带上 methodology 参数：对话页据此亮起「正在练习」芯片，
                // 主进程只在这一轮真的带着它时才给这条方法论记一次练习。
                const params = new URLSearchParams()
                if (bookId) params.set('bookId', bookId)
                params.set('methodology', selectedMethod.id)
                navigate(`/chat?${params.toString()}`)
                toast.success(`已进入练习「${name}」，先用自己的话讲一遍它的步骤`)
              }}
              onExportSkill={() => handleExportSkill(selectedMethod)}
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

