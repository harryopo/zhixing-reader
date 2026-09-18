/** 年度书单表格（从 Stats.tsx 原样搬出，逻辑未改） */
import { useNavigate } from 'react-router-dom'
import { useMemo } from 'react'
import Icon from '@/components/ui/Icon'
import { EmptyState } from '@/components/ui/Feedback'
import type { BookStat } from './constants'

export function YearlyBookTable({ bookStats }: { bookStats: BookStat[] }) {
  // 这个子组件不在主组件里，拿不到外面的 navigate，得自己取一个
  const navigate = useNavigate()
  const finishedBooks = useMemo(() => {
    return bookStats
      .filter((s) => {
        const normalized = s.progress > 1 ? s.progress : s.progress * 100
        return s.isFinished || normalized >= 100
      })
      .sort((a, b) => {
        const ta = a.updatedAt ? new Date(a.updatedAt).getTime() : 0
        const tb = b.updatedAt ? new Date(b.updatedAt).getTime() : 0
        return tb - ta
      })
  }, [bookStats])

  if (finishedBooks.length === 0) {
    return (
      <EmptyState
        icon={<Icon name="bookshelf" size={24} />}
        title="今年还没有读完的书"
        description="完成阅读后会自动出现在这里"
      />
    )
  }

  const formatFinishDate = (iso?: string) => {
    if (!iso) return '未知'
    const d = new Date(iso)
    if (isNaN(d.getTime())) return '未知'
    return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
      {/* 表头（4 列 grid：1.5fr 0.8fr 0.7fr 0.8fr） */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1.5fr 0.8fr 0.7fr 0.8fr',
          gap: 'calc(var(--spacing) * 3)',
          padding: '0 calc(var(--spacing) * 4) calc(var(--spacing) * 2)',
          fontSize: '0.78rem',
          color: 'var(--muted-foreground)',
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
        }}
      >
        <span>书名</span>
        <span>类型</span>
        <span>进度</span>
        <span>完成日期</span>
      </div>
      {finishedBooks.map((book) => {
        return (
          <button
            key={book.id}
            type="button"
            data-dom-id={`yearly-book-${book.id}`}
            // 这行原来有手型光标和悬停描边，却**没有 onClick**（看着能点，点了没反应）。
            // 补成真的能跳：点书名进那本书的详情页。
            onClick={() => navigate(`/bookshelf/${book.id}`)}
            style={{
              display: 'grid',
              gridTemplateColumns: '1.5fr 0.8fr 0.7fr 0.8fr',
              gap: 'calc(var(--spacing) * 3)',
              alignItems: 'center',
              padding: 'calc(var(--spacing) * 3.5) calc(var(--spacing) * 4)',
              background: 'var(--background)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius)',
              cursor: 'pointer',
              transition: 'border-color 0.2s ease',
              textAlign: 'left',
              font: 'inherit',
              color: 'inherit',
              width: '100%',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--ring)'
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)'
            }}
          >
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                fontWeight: 600,
                color: 'var(--foreground)',
              }}
            >
              《{book.title}》
            </span>
            <span
              style={{
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--muted-foreground)',
              }}
            >
              {book.category || '其他'}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--foreground)' }}>100%</span>
            <span
              style={{
                whiteSpace: 'nowrap',
                color: 'var(--muted-foreground)',
              }}
            >
              {formatFinishDate(book.updatedAt)}
            </span>
          </button>
        )
      })}
    </div>
  )
}
