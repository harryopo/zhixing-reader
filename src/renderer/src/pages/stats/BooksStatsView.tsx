/** 书籍统计视图 + 可排序表头（从 Stats.tsx 原样搬出，逻辑未改） */
import Card, { CardHead } from '@/components/ui/Card'
import Icon from '@/components/ui/Icon'
import { EmptyState, Metric, Trend, Tiny } from '@/components/ui/Feedback'
import type { BookStat, SortColumn, SortOrder } from './constants'

export function BooksStatsView({
  bookStats,
  sortedStats,
  sortBy,
  sortOrder,
  onSort,
  totalHighlights,
  totalCards,
}: {
  bookStats: BookStat[]
  sortedStats: BookStat[]
  sortBy: SortColumn
  sortOrder: SortOrder
  onSort: (column: SortColumn) => void
  totalHighlights: number
  totalCards: number
}) {
  return (
    <>
      {/* 3 KPI 卡片 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 'calc(var(--spacing) * 4)',
        }}
      >
        <Card>
          <div
            style={{
              color: 'var(--muted-foreground)',
              fontSize: '0.78rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            书籍数
          </div>
          <Metric value={bookStats.length} />
          <Trend kind="default">本架藏书</Trend>
        </Card>
        <Card>
          <div
            style={{
              color: 'var(--muted-foreground)',
              fontSize: '0.78rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            笔记总数
          </div>
          <Metric value={totalHighlights} />
          <Trend kind="up">↑ 跨 {bookStats.length} 本书</Trend>
        </Card>
        <Card>
          <div
            style={{
              color: 'var(--muted-foreground)',
              fontSize: '0.78rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}
          >
            卡片总数
          </div>
          <Metric value={totalCards} />
          <Trend kind="up">↑ 待复习</Trend>
        </Card>
      </div>

      <Card>
        <CardHead eyebrow="书籍统计" title={`共 ${bookStats.length} 本`} />
        {bookStats.length === 0 ? (
          <EmptyState
            icon={<Icon name="bookshelf" size={24} />}
            title="暂无数据"
            description="点击同步按钮获取微信读书数据"
          />
        ) : (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'calc(var(--spacing) * 2)',
            }}
          >
            {/* 表头（4 列 grid） */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1fr 1fr 1fr',
                gap: 'calc(var(--spacing) * 3)',
                padding: '0 calc(var(--spacing) * 4) calc(var(--spacing) * 2)',
                fontSize: '0.78rem',
                color: 'var(--muted-foreground)',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              <span>书名</span>
              <SortHeader
                label="进度"
                active={sortBy === 'progress'}
                order={sortOrder}
                onClick={() => onSort('progress')}
              />
              <SortHeader
                label="笔记"
                active={sortBy === 'highlights'}
                order={sortOrder}
                onClick={() => onSort('highlights')}
              />
              <SortHeader
                label="卡片"
                active={sortBy === 'cards'}
                order={sortOrder}
                onClick={() => onSort('cards')}
              />
            </div>

            {/* 行 */}
            {sortedStats.map((stat) => {
              const normalizedProgress = stat.progress > 1 ? stat.progress : stat.progress * 100
              const pct = Math.min(Math.max(Math.round(normalizedProgress), 0), 100)
              return (
                <div
                  key={stat.id}
                  data-dom-id={`book-stat-${stat.id}`}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1fr 1fr',
                    gap: 'calc(var(--spacing) * 3)',
                    alignItems: 'center',
                    padding: 'calc(var(--spacing) * 3.5) calc(var(--spacing) * 4)',
                    background: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    transition: 'border-color 0.2s ease',
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
                      minWidth: 0,
                    }}
                  >
                    <div
                      style={{
                        width: 28,
                        height: 40,
                        background: 'var(--muted)',
                        borderRadius: 'calc(var(--radius) - 2px)',
                        flexShrink: 0,
                        overflow: 'hidden',
                      }}
                    >
                      {stat.cover ? (
                        <img
                          src={stat.cover}
                          alt={stat.title}
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          onError={(e) => {
                            ;(e.target as HTMLImageElement).style.display = 'none'
                          }}
                        />
                      ) : (
                        <div
                          style={{
                            width: '100%',
                            height: '100%',
                            display: 'grid',
                            placeItems: 'center',
                          }}
                        >
                          <Icon name="bookshelf" size={14} />
                        </div>
                      )}
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <strong
                        style={{
                          display: 'block',
                          fontSize: '0.92rem',
                          fontWeight: 600,
                          color: 'var(--foreground)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {stat.title}
                      </strong>
                      {stat.author && <Tiny>{stat.author}</Tiny>}
                    </div>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'calc(var(--spacing) * 2)',
                    }}
                  >
                    <div
                      style={{
                        width: 56,
                        background: 'var(--muted)',
                        borderRadius: 999,
                        height: 6,
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          width: `${pct}%`,
                          background: 'var(--primary)',
                          borderRadius: 999,
                          transition: 'width 0.3s ease',
                        }}
                      />
                    </div>
                    <span
                      style={{
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        color: 'var(--foreground)',
                        width: 40,
                        textAlign: 'right',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {pct}%
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: stat.highlightCount > 0 ? 'var(--foreground)' : 'var(--muted-foreground)',
                    }}
                  >
                    {stat.highlightCount}
                  </span>
                  <span
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: stat.cardCount > 0 ? 'var(--foreground)' : 'var(--muted-foreground)',
                    }}
                  >
                    {stat.cardCount}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </Card>
    </>
  )
}

// ===== 排序表头按钮 =====
export function SortHeader({
  label,
  active,
  order,
  onClick,
}: {
  label: string
  active: boolean
  order: SortOrder
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        color: 'inherit',
        fontFamily: 'inherit',
        fontSize: 'inherit',
        padding: 0,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        textAlign: 'left',
      }}
    >
      {label}{' '}
      {active && (
        <span style={{ color: 'var(--primary)' }}>{order === 'asc' ? '↑' : '↓'}</span>
      )}
    </button>
  )
}
