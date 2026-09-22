/**
 * BookDetail — 书籍详情页（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/book-detail.html
 *
 * 结构：
 *   - hero: 书名 + 作者 · 出版社 · 年份 + 3 actions（在微信读书打开 / AI 对话此书 / 返回书架）
 *   - 第一层双栏 grid [1fr 2fr]:
 *     - 左栏封面卡: book-cover-large + 4 stat-mini (进度/已读/划线/笔记) + progress-bar
 *     - 右栏动态卡: 最近划线/笔记 2 条（真实数据）+ action-btn 组
 *       （书籍简介/ISBN/分类无数据源已删除——微信读书同步不提供这些字段，展示只会是空占位）
 *   - 第二层 tab card: 划线 / 笔记 / 知识卡片 三标签 + 列表
 *
 * 业务逻辑全部保留:
 *   - loadBookData (book.getById + highlight.getByBook + card.getByBook)
 *   - handleImportNotes (weread.fetchAllContent)
 *   - 进度显示、笔记列表渲染、卡片列表渲染
 */

import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Card from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { Loading, EmptyState, Tiny } from '@/components/ui/Feedback'
import { toast } from '../stores/toastStore'
import { importWereadContentForBook, describeImportResult } from '../utils/import-weread-content'
import {
  mapBooks,
  mapHighlights,
  mapCards,
  safeStr,
  formatDate,
  formatDateShort,
  type BookRow,
  type HighlightRow,
  type CardRow,
} from '../utils/db-mapper'
import { getCardMastery } from '../../../shared/fsrs-metrics'
import type { BookSummary, ChapterSummary } from '../../../shared/types'

/** 卡片掌握度等级 → Badge 变体（与复习页保持一致） */
const CARD_MASTERY_BADGE: Record<string, 'success' | 'ok' | 'warning' | 'default'> = {
  精通: 'success',
  熟练: 'ok',
  进阶: 'warning',
  入门: 'default',
}

// ===== 工具 =====

// ===== 主组件 =====
type TabKey = 'highlights' | 'notes' | 'cards' | 'summary'

export default function BookDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()

  const [book, setBook] = useState<BookRow | null>(null)
  const [highlights, setHighlights] = useState<HighlightRow[]>([])
  const [cards, setCards] = useState<CardRow[]>([])
  const [chapters, setChapters] = useState<ChapterSummary[]>([])
  const [bookSummary, setBookSummary] = useState<BookSummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  // 通知面板的「摘要待更新」直接链到 ?tab=summary，点进来就在页签上，不用自己找
  const requestedTab = useSearchParams()[0].get('tab')
  const [activeTab, setActiveTab] = useState<TabKey>(
    requestedTab === 'notes' || requestedTab === 'cards' || requestedTab === 'summary'
      ? requestedTab
      : 'highlights',
  )

  useEffect(() => {
    if (id) loadBookData(id)
  }, [id])

  const loadBookData = async (bookId: string) => {
    if (!window.electronAPI?.book || !window.electronAPI?.highlight || !window.electronAPI?.card) {
      setLoading(false)
      return
    }
    try {
      const [bookData, highlightsRaw, cardsRaw] = await Promise.all([
        window.electronAPI.book.getById(bookId),
        window.electronAPI.highlight.getByBook(bookId),
        window.electronAPI.card.getByBook(bookId),
      ])
      const books = mapBooks(bookData ? [bookData] : [])
      setBook(books.length > 0 ? books[0] : null)
      setHighlights(mapHighlights(highlightsRaw as unknown[]))
      setCards(mapCards(cardsRaw as unknown[]))
      const [chapterRows, summaryRow] = await Promise.all([
        window.electronAPI.summary?.chapters(bookId) ?? Promise.resolve([]),
        window.electronAPI.summary?.getByBook(bookId) ?? Promise.resolve(null),
      ])
      setChapters(chapterRows)
      setBookSummary(summaryRow ?? null)
    } catch (error) {
      console.error('加载书籍数据失败:', error)
      toast.error('加载书籍详情失败')
    } finally {
      setLoading(false)
    }
  }

  /**
   * 生成分章摘要（L1）并顺带汇总全书摘要（L2）。
   * 只重做划线条数变了的章节，所以重复点不会重复烧钱 —— 但仍是几十次 AI 调用，按钮要防连点。
   */
  const handleGenerateSummaries = async () => {
    if (!id || summarizing) return
    setSummarizing(true)
    const pendingToast = toast.loading('正在按章节生成摘要…')
    try {
      const result = await window.electronAPI.summary?.generate(id)
      toast.remove(pendingToast)
      if (!result) {
        toast.error('当前环境不支持生成摘要')
        return
      }
      await loadBookData(id)
      setActiveTab('summary')
      const parts = [`新增 ${result.generated} 章`, `复用 ${result.skipped} 章`]
      if (result.failed > 0) parts.push(`失败 ${result.failed} 章`)
      parts.push(result.bookSummary ? '全书摘要已更新' : '全书摘要未更新')
      toast.success(`${result.bookTitle}：${parts.join(' · ')}`)
    } catch (error) {
      toast.remove(pendingToast)
      toast.error(`生成失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setSummarizing(false)
    }
  }

  const handleImportNotes = async () => {
    if (!id) return
    setImporting(true)
    const importToastId = toast.loading('正在从微信读书导入笔记...')
    try {
      const result = await importWereadContentForBook(id)
      await loadBookData(id)
      toast.remove(importToastId)
      const { kind, text } = describeImportResult(result)
      if (kind === 'success') toast.success(text)
      else toast.info(text)
    } catch (error) {
      toast.remove(importToastId)
      toast.error(`导入失败: ${error instanceof Error ? error.message : String(error)}`)
    } finally {
      setImporting(false)
    }
  }

  /** 本应用无内置阅读器：外开微信读书，不假装本地可读。
   *  仅 weread 来源的书籍可在微信读书打开；本地导入书籍 id 非微信读书 bookId，打开会跳到无效页面。
   *  旧数据 source 为 null/undefined 时按 weread 处理（保持向后兼容）。
   */
  const openInWeRead = async () => {
    if (!id) return
    if (book?.source && book.source !== 'weread') {
      toast.warning('本书非微信读书来源，无法在微信读书打开')
      return
    }
    const url = `https://weread.qq.com/web/reader/${encodeURIComponent(id)}`
    try {
      if (window.electronAPI?.system?.openExternal) {
        await window.electronAPI.system.openExternal(url)
        toast.success('已在浏览器打开微信读书')
      } else {
        window.open(url, '_blank', 'noopener,noreferrer')
      }
    } catch (error) {
      toast.error(`无法打开微信读书: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  const goChatWithBook = () => {
    if (!id) {
      navigate('/chat')
      return
    }
    navigate(`/chat?bookId=${encodeURIComponent(id)}`)
  }

  // ===== 派生数据 =====
  const progress = book?.progress ?? 0
  const progressPct = Math.round(progress * 100)

  const highlightList = useMemo(
    () => highlights.filter((h) => h.type === 'highlight'),
    [highlights],
  )
  const noteList = useMemo(() => highlights.filter((h) => h.type === 'note'), [highlights])

  /** 最近动态：划线+笔记混合按时间倒序取 2 条（划线取原文，笔记取笔记内容） */
  const recentActivity = useMemo(
    () =>
      [...highlights]
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        .slice(0, 2),
    [highlights],
  )

  const bookSubtitle = useMemo(() => {
    if (!book) return ''
    const parts: string[] = []
    if (book.author) parts.push(book.author)
    if (book.publisher) parts.push(book.publisher)
    if (book.createdAt) {
      const year = new Date(book.createdAt).getFullYear()
      if (!isNaN(year)) parts.push(String(year))
    }
    return parts.join(' · ')
  }, [book])

  const totalChapter = book?.totalChapter ?? 0

  if (loading) {
    return <Loading hint="正在加载书籍详情..." />
  }

  if (!book) {
    return (
      <EmptyState
        icon={<Icon name="bookshelf" size={24} />}
        title="书籍未找到"
        description="该书籍可能已被移除或同步失败"
        action={
          <Button variant="primary" onClick={() => navigate('/bookshelf')}>
            返回书架
          </Button>
        }
      />
    )
  }

  return (
    <PageHero
      title={book.title}
      subtitle={bookSubtitle}
      actions={
        <>
          {book?.source === 'weread' || !book?.source ? (
            <Button
              variant="primary"
              data-dom-id="cta-read"
              onClick={() => void openInWeRead()}
              title="本应用不同步全书正文，将打开微信读书网页版"
            >
              在微信读书打开
            </Button>
          ) : (
            <Button
              variant="ghost"
              data-dom-id="cta-read-disabled"
              disabled
              title="本书非微信读书来源，无法在微信读书打开"
            >
              本地书籍（暂不支持阅读）
            </Button>
          )}
          <Button
            variant="secondary"
            data-dom-id="cta-chat-book"
            onClick={goChatWithBook}
          >
            AI 对话此书
          </Button>
          <Button
            variant="ghost"
            data-dom-id="cta-back"
            onClick={() => navigate('/bookshelf')}
          >
            返回书架
          </Button>
        </>
      }
    >
      {/* ===== 第一层：双栏 detail grid (1fr cover + 2fr info) ===== */}
      <div
        className="book-detail-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr)',
          gap: 'calc(var(--spacing) * 5)',
        }}
      >
        {/* 左栏：封面卡 */}
        <Card>
          {/* book-cover-large */}
          <div
            className="book-cover-large"
            style={{
              width: '100%',
              aspectRatio: '3 / 4',
              borderRadius: 'calc(var(--radius) + 4px)',
              background: book.cover
                ? `url(${book.cover}) center/cover no-repeat`
                : 'linear-gradient(135deg, var(--chart-1), color-mix(in srgb, var(--chart-4) 80%, black))',
              display: 'grid',
              placeItems: 'center',
              color: 'var(--primary-foreground)',
              fontWeight: 700,
              fontSize: '1.5rem',
              textAlign: 'center',
              padding: 'calc(var(--spacing) * 6)',
              lineHeight: 1.3,
              wordBreak: 'keep-all',
              overflowWrap: 'break-word',
              overflow: 'hidden',
            }}
          >
            {!book.cover && book.title}
          </div>

          {/* book-stats: 4 stat-mini */}
          <div
            className="grid grid-cols-2"
            style={{ gap: 'calc(var(--spacing) * 3)', marginTop: 'calc(var(--spacing) * 5)' }}
          >
            <StatMini label="进度" value={`${progressPct}%`} />
            <StatMini
              label="已读"
              value={book.lastReadAt ? formatDateShort(book.lastReadAt) : '-'}
            />
            <StatMini label="划线" value={String(highlightList.length)} />
            <StatMini label="笔记" value={String(noteList.length)} />
          </div>

          {/* progress-bar */}
          <div style={{ marginTop: 'calc(var(--spacing) * 4)' }}>
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
                  width: `${progressPct}%`,
                  background: 'var(--primary)',
                  borderRadius: 999,
                  transition: 'width 0.3s ease',
                }}
              />
            </div>
            <div
              className="flex justify-between"
              style={{
                fontSize: '0.78rem',
                color: 'var(--muted-foreground)',
                marginTop: '0.4rem',
              }}
            >
              <span style={{ fontFamily: 'var(--font-mono)' }}>{progressPct}%</span>
              <span>
                {totalChapter > 0 ? `共 ${totalChapter} 章` : '章节信息未知'}
              </span>
            </div>
          </div>
        </Card>

        {/* 右栏：最近动态卡（真实划线/笔记数据；简介/ISBN/分类无数据源已删除） */}
        <Card>
          <div
            style={{
              color: 'var(--muted-foreground)',
              fontSize: '0.75rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            最近动态
          </div>
          {recentActivity.length === 0 ? (
            <p
              style={{
                fontSize: '0.92rem',
                lineHeight: 1.7,
                color: 'var(--muted-foreground)',
                margin: 'calc(var(--spacing) * 3) 0 0',
              }}
            >
              还没有划线与笔记。点击下方「导入笔记」可从微信读书同步本书的划线内容。
            </p>
          ) : (
            <div style={{ marginTop: 'calc(var(--spacing) * 2)' }}>
              {recentActivity.map((h, idx) => {
                const text = h.note || h.content
                return (
                  <div
                    key={h.id}
                    style={{
                      padding: 'calc(var(--spacing) * 3) 0',
                      borderTop: idx === 0 ? 'none' : '1px solid var(--border)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 2)' }}>
                      {h.note ? <Badge variant="ok">笔记</Badge> : <Badge>划线</Badge>}
                      <Tiny>
                        {h.chapterTitle || '未知章节'} · {formatDateShort(h.createdAt)}
                      </Tiny>
                    </div>
                    <p
                      style={{
                        margin: 'calc(var(--spacing) * 2) 0 0',
                        fontSize: '0.88rem',
                        lineHeight: 1.6,
                        color: 'var(--card-foreground)',
                      }}
                    >
                      {text.length > 120 ? `${text.slice(0, 120)}…` : text}
                    </p>
                  </div>
                )
              })}
            </div>
          )}

          {/* book-actions: action-btn 组 */}
          <div
            className="flex flex-wrap"
            style={{ gap: 'calc(var(--spacing) * 3)', marginTop: 'calc(var(--spacing) * 5)' }}
          >
            {/* 这里原来还有一个「在微信读书打开」，与页面顶部 hero 的按钮是同一个函数，
                两个按钮在同一屏相距不到 200px。保留 hero 那一个。 */}
            <Button
              variant="secondary"
              data-dom-id="cta-add-review"
              onClick={() => navigate(`/knowledge-cards?bookId=${book.id}`)}
            >
              本书知识卡片
            </Button>
            <Button
              variant="secondary"
              data-dom-id="cta-import-notes"
              onClick={handleImportNotes}
              disabled={importing}
            >
              <Icon name="refresh" size={14} />
              {importing ? '导入中...' : '导入笔记'}
            </Button>
            <Button
              variant="secondary"
              data-dom-id="cta-generate-summaries"
              onClick={handleGenerateSummaries}
              disabled={summarizing || highlightList.length === 0}
              title={highlightList.length === 0 ? '先导入划线，才能按章节生成摘要' : '按章节用 AI 概括你的划线，只重做划线有变化的章节'}
            >
              <Icon name="agent" size={14} />
              {summarizing ? '生成中...' : '生成 AI 摘要'}
            </Button>
          </div>
        </Card>
      </div>

      {/* ===== 第二层：标签页 card ===== */}
      <Card padding={0} style={{ overflow: 'hidden' }}>
        {/* tab-nav */}
        <div
          className="flex tab-nav"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <TabBtn
            label="划线"
            count={highlightList.length}
            active={activeTab === 'highlights'}
            onClick={() => setActiveTab('highlights')}
          />
          <TabBtn
            label="笔记"
            count={noteList.length}
            active={activeTab === 'notes'}
            onClick={() => setActiveTab('notes')}
          />
          <TabBtn
            label="知识卡片"
            count={cards.length}
            active={activeTab === 'cards'}
            onClick={() => setActiveTab('cards')}
          />
          <TabBtn
            label="摘要"
            count={chapters.length}
            active={activeTab === 'summary'}
            onClick={() => setActiveTab('summary')}
          />
        </div>

        {/* tab-content */}
        <div style={{ padding: 'calc(var(--spacing) * 5)' }}>
          {activeTab === 'highlights' && (
            <HighlightList
              items={highlightList}
              emptyHint="还没有划线，点击「导入笔记」同步微信读书"
            />
          )}
          {activeTab === 'notes' && (
            <HighlightList items={noteList} emptyHint="还没有笔记" noteMode />
          )}
          {activeTab === 'cards' && (
            <CardList
              items={cards}
              highlights={highlights}
              emptyHint="还没有知识卡片"
            />
          )}
          {activeTab === 'summary' && (
            <SummaryPanel
              bookSummary={bookSummary}
              chapters={chapters}
              generating={summarizing}
              onGenerate={handleGenerateSummaries}
            />
          )}
        </div>
      </Card>
    </PageHero>
  )
}

// ===== 子组件 =====

/** 单个 stat-mini（封面卡 4 宫格） */
function StatMini({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-center">
      <div
        style={{
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          color: 'var(--muted-foreground)',
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: '1.15rem',
          fontWeight: 700,
          marginTop: '0.35rem',
          color: 'var(--foreground)',
          fontFamily: 'var(--font-mono)',
          fontVariantNumeric: 'tabular-nums',
        }}
      >
        {value}
      </div>
    </div>
  )
}

/** 标签按钮 */
function TabBtn({
  label,
  count,
  active,
  onClick,
}: {
  label: string
  count: number
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex-1 font-medium tab-btn"
      style={{
        padding: 'calc(var(--spacing) * 4)',
        background: 'transparent',
        border: 'none',
        borderBottom: `2px solid ${active ? 'var(--primary)' : 'transparent'}`,
        color: active ? 'var(--primary)' : 'var(--muted-foreground)',
        fontSize: '0.92rem',
        fontWeight: 500,
        cursor: 'pointer',
        transition: 'color 0.2s ease, border-color 0.2s ease',
        font: 'inherit',
      }}
      onMouseEnter={(e) => {
        if (!active) e.currentTarget.style.color = 'var(--foreground)'
      }}
      onMouseLeave={(e) => {
        if (!active) e.currentTarget.style.color = 'var(--muted-foreground)'
      }}
    >
      {label} ({count})
    </button>
  )
}

/** 划线/笔记列表 */
function HighlightList({
  items,
  emptyHint,
  noteMode,
}: {
  items: HighlightRow[]
  emptyHint: string
  noteMode?: boolean
}) {
  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Icon name={noteMode ? 'notes' : 'bookshelf'} size={24} />}
        title={noteMode ? '暂无笔记' : '暂无划线'}
        description={emptyHint}
      />
    )
  }
  return (
    <div className="flex flex-col" style={{ gap: 'calc(var(--spacing) * 4)' }}>
      {items.map((h) => (
        <div
          key={h.id}
          style={{
            padding: 'calc(var(--spacing) * 4)',
            borderLeft: `3px solid ${noteMode ? 'var(--chart-3)' : 'var(--chart-1)'}`,
            background: 'var(--background)',
            borderRadius: `0 var(--radius) var(--radius) 0`,
          }}
        >
          <p
            style={{
              fontSize: '0.92rem',
              lineHeight: 1.7,
              color: 'var(--card-foreground)',
              margin: 0,
            }}
          >
            {h.content || '（无内容）'}
          </p>
          {noteMode && h.note && (
            <p
              style={{
                fontSize: '0.85rem',
                lineHeight: 1.6,
                color: 'var(--muted-foreground)',
                margin: 'calc(var(--spacing) * 2) 0 0',
                fontStyle: 'italic',
              }}
            >
              ↳ {h.note}
            </p>
          )}
          <div
            className="flex"
            style={{
              gap: 'calc(var(--spacing) * 3)',
              fontSize: '0.72rem',
              color: 'var(--muted-foreground)',
              marginTop: 'calc(var(--spacing) * 2)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            <span>{safeStr(h.chapterTitle, '未知章节')}</span>
            {h.createdAt && (
              <>
                <span>·</span>
                <span>{formatDate(h.createdAt)}</span>
              </>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

/** 摘要面板：L2 全书摘要 + L1 逐章摘要。两者都是 AI 的二手概括，界面上不装作原文 */
function SummaryPanel({
  bookSummary,
  chapters,
  generating,
  onGenerate,
}: {
  bookSummary: BookSummary | null
  chapters: ChapterSummary[]
  generating: boolean
  onGenerate: () => void
}) {
  const keyPoints = useMemo(() => parseKeyPoints(bookSummary?.keyPoints), [bookSummary])

  if (!bookSummary && chapters.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="agent" size={24} />}
        title="还没有摘要"
        description="按章节把你的划线圈概括成一段话，再由各章汇总成全书摘要。划线有变化的章节才会重做。"
        action={
          <Button variant="primary" data-dom-id="cta-generate-summaries-empty" onClick={onGenerate} disabled={generating}>
            {generating ? '生成中...' : '生成 AI 摘要'}
          </Button>
        }
      />
    )
  }

  return (
    <div className="flex flex-col" style={{ gap: 'calc(var(--spacing) * 5)' }}>
      {bookSummary && (
        <div
          style={{
            padding: 'calc(var(--spacing) * 4)',
            borderLeft: '3px solid var(--chart-5)',
            background: 'var(--background)',
            borderRadius: '0 var(--radius) var(--radius) 0',
          }}
        >
          <div className="flex" style={{ justifyContent: 'space-between', gap: 'calc(var(--spacing) * 3)' }}>
            <strong style={{ fontSize: '0.95rem' }}>全书摘要</strong>
            <Tiny>{bookSummary.generatedAt ? formatDate(bookSummary.generatedAt) : ''}</Tiny>
          </div>
          <p style={{ fontSize: '0.9rem', lineHeight: 1.75, margin: 'calc(var(--spacing) * 2) 0 0' }}>
            {bookSummary.summary}
          </p>
          {keyPoints.length > 0 && (
            <ul className="flex flex-col" style={{ gap: '0.35rem', margin: 'calc(var(--spacing) * 3) 0 0', paddingLeft: '1.1rem' }}>
              {keyPoints.map((point, i) => (
                <li key={i} style={{ fontSize: '0.86rem', lineHeight: 1.6 }}>{point}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {chapters.map((c) => (
        <div
          key={c.id}
          style={{
            padding: 'calc(var(--spacing) * 4)',
            borderLeft: '3px solid var(--chart-1)',
            background: 'var(--background)',
            borderRadius: '0 var(--radius) var(--radius) 0',
          }}
        >
          <div className="flex" style={{ justifyContent: 'space-between', gap: 'calc(var(--spacing) * 3)' }}>
            <strong style={{ fontSize: '0.92rem' }}>{c.chapterTitle}</strong>
            <Tiny>基于 {c.sourceCount} 条划线</Tiny>
          </div>
          <p style={{ fontSize: '0.88rem', lineHeight: 1.7, margin: 'calc(var(--spacing) * 2) 0 0' }}>{c.summary}</p>
        </div>
      ))}

      <div className="flex" style={{ gap: 'calc(var(--spacing) * 3)', alignItems: 'center' }}>
        <Button variant="secondary" data-dom-id="cta-regenerate-summaries" onClick={onGenerate} disabled={generating}>
          {generating ? '生成中...' : '补齐 / 更新摘要'}
        </Button>
        <Tiny>只重做划线条数变了的章节，其余直接复用</Tiny>
      </div>
    </div>
  )
}

/** key_points 列存的是 JSON 字符串；模型给怪东西就当没有，不让整页崩 */
function parseKeyPoints(raw?: string | null): string[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  } catch {
    return []
  }
}

/** 知识卡片列表 */
function CardList({
  items,
  highlights,
  emptyHint,
}: {
  items: CardRow[]
  highlights: HighlightRow[]
  emptyHint: string
}) {
  // 卡片 → 卡面原文：按 highlightId 做一次本地 join，避免逐卡再走一次 IPC
  const contentByHighlight = useMemo(() => {
    const map = new Map<string, HighlightRow>()
    for (const h of highlights) map.set(h.id, h)
    return map
  }, [highlights])

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="cards" size={24} />}
        title="暂无知识卡片"
        description={emptyHint}
      />
    )
  }
  return (
    <div className="flex flex-col" style={{ gap: 'calc(var(--spacing) * 4)' }}>
      {items.map((c) => {
        const source = contentByHighlight.get(c.highlightId)
        // 掌握度由 FSRS 状态推导（见 src/shared/fsrs-metrics.ts），不读写死的列
        const mastery = getCardMastery({
          stability: c.stability,
          difficulty: c.difficulty,
          reps: c.reps,
          lapses: c.lapses,
        })
        return (
          <div
            key={c.id}
            style={{
              padding: 'calc(var(--spacing) * 4)',
              borderLeft: '3px solid var(--chart-5)',
              background: 'var(--background)',
              borderRadius: '0 var(--radius) var(--radius) 0',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 'calc(var(--spacing) * 3)',
              }}
            >
              <strong style={{ fontSize: '0.95rem', color: 'var(--foreground)' }}>
                卡片 #{c.id.slice(0, 6)}
              </strong>
              <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 2)', flexWrap: 'wrap' }}>
                <Badge variant={CARD_MASTERY_BADGE[mastery.level] ?? 'default'}>
                  掌握度 {mastery.score}
                </Badge>
                <Badge variant="ok">已复习 {c.reps} 次</Badge>
              </div>
            </div>

            {/* 卡面原文（来自来源划线） */}
            {source?.content ? (
              <blockquote
                style={{
                  margin: 'calc(var(--spacing) * 3) 0 0',
                  padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 3)',
                  borderLeft: '2px solid var(--border)',
                  background: 'var(--muted)',
                  borderRadius: 'var(--radius)',
                  fontSize: '0.86rem',
                  lineHeight: 1.7,
                  color: 'var(--foreground)',
                  display: '-webkit-box',
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: 'vertical' as const,
                  overflow: 'hidden',
                }}
              >
                {source.content}
              </blockquote>
            ) : (
              <Tiny style={{ marginTop: 'calc(var(--spacing) * 3)' }}>
                来源划线已不在本机（卡片仍可正常复习）
              </Tiny>
            )}

            <Tiny style={{ marginTop: 'calc(var(--spacing) * 2)' }}>
              {source?.chapterTitle ? source.chapterTitle + ' · ' : ''}
              创建于 {formatDate(c.createdAt)}
              {c.nextReviewAt ? ' · 下次复习 ' + formatDate(c.nextReviewAt) : ''}
              {c.lapses > 0 ? ' · 遗忘 ' + c.lapses + ' 次' : ''}
            </Tiny>
          </div>
        )
      })}
    </div>
  )
}
