/** 文章列表面板（从 DailyLearning.tsx 原样搬出，逻辑未改） */
import { useEffect, useRef } from 'react'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { DIFFICULTY_LABELS, type Article, type DifficultyFilter } from './constants'

interface ArticleListPanelProps {
  /** 已经过筛选的清单（不是全量） */
  articles: Article[]
  currentArticleId: string
  onSelect: (articleId: string) => void
  onClose: () => void
  /** 当前是否处于筛选状态（用于区分"筛选后为空"） */
  filtered?: boolean
  onClearFilters?: () => void
}

function ArticleListPanel({ articles, currentArticleId, onSelect, onClose, filtered = false, onClearFilters }: ArticleListPanelProps) {
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
            没有符合条件的文章
          </p>
        ) : filtered ? (
          <div style={{ textAlign: 'center', padding: 'calc(var(--spacing) * 6) 0' }}>
            <p style={{ color: 'var(--muted-foreground)', fontSize: '0.85rem', marginBottom: 'calc(var(--spacing) * 3)' }}>
              当前筛选下没有文章
            </p>
            <Button variant="secondary" onClick={onClearFilters}>清除筛选</Button>
          </div>
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

export { ArticleListPanel }
