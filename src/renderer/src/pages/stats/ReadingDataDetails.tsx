/** 微信读书阅读数据明细（从 Stats.tsx 原样搬出，逻辑未改） */
import Card, { CardHead } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { Muted, Tiny } from '@/components/ui/Feedback'
import { formatReadingTime } from '../../stores/readingDataStore'
import type { ReadingMode, ReadingDataResponse, ReadLongestItem } from '../../../../shared/types'
import { CategoryBreakdown, ReadingTimeHeatmap, UserProfileCard } from './profile'

export function ReadingDataDetails({
  readingData,
  mode,
  modeLabels,
  onRefresh,
  loading,
}: {
  readingData: ReadingDataResponse
  mode: ReadingMode
  modeLabels: Record<ReadingMode, string>
  onRefresh: () => void
  loading: boolean
}) {
  return (
    <>
      {/* 阅读方式（文字 / 听书） */}
      {readingData.readRate != null && (
        <Card>
          <CardHead eyebrow="阅读方式" title="文字 / 听书占比" />
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'calc(var(--spacing) * 4)',
            }}
          >
            <div style={{ flex: 1 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: '0.875rem',
                  marginBottom: '0.25rem',
                }}
              >
                <Muted>文字阅读</Muted>
                <strong style={{ color: 'var(--foreground)' }}>
                  {Math.round(readingData.readRate)}%
                </strong>
              </div>
              <div
                style={{
                  width: '100%',
                  background: 'var(--muted)',
                  borderRadius: 999,
                  height: 8,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${readingData.readRate}%`,
                    background: 'var(--primary)',
                    borderRadius: 999,
                    transition: 'width 0.5s ease',
                  }}
                />
              </div>
            </div>
            <div style={{ fontSize: '0.875rem', color: 'var(--muted-foreground)' }}>
              {readingData.wrReadTime != null && (
                <span>阅读 {formatReadingTime(readingData.wrReadTime)}</span>
              )}
              {readingData.wrListenTime != null && (
                <span> · 听书 {formatReadingTime(readingData.wrListenTime)}</span>
              )}
            </div>
          </div>
        </Card>
      )}

      {/* 阅读统计（readStat） */}
      {readingData.readStat && readingData.readStat.length > 0 && (
        <Card>
          <CardHead eyebrow="阅读统计" title={`${modeLabels[mode]}数据`} />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 'calc(var(--spacing) * 3)',
            }}
          >
            {readingData.readStat.map((item, i) => (
              <div
                key={i}
                style={{
                  textAlign: 'center',
                  padding: 'calc(var(--spacing) * 3)',
                  background: 'var(--muted)',
                  borderRadius: 'var(--radius)',
                }}
              >
                <Tiny>{item.stat}</Tiny>
                <div
                  style={{
                    fontSize: '1.1rem',
                    fontWeight: 700,
                    color: 'var(--foreground)',
                    marginTop: '0.25rem',
                    fontFamily: 'var(--font-mono)',
                  }}
                >
                  {item.counts}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 读得最多 */}
      {readingData.readLongest && readingData.readLongest.length > 0 && (
        <Card>
          <CardHead eyebrow="读得最多" title={`${modeLabels[mode]} TOP 书单`} />
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'calc(var(--spacing) * 3)',
            }}
          >
            {readingData.readLongest.map((item: ReadLongestItem, i: number) => {
              const bookInfo = item.book
              return (
                <div
                  key={bookInfo?.bookId || i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'calc(var(--spacing) * 3)',
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 700,
                      color: 'var(--muted-foreground)',
                      width: 20,
                    }}
                  >
                    {i + 1}
                  </span>
                  <div
                    style={{
                      width: 32,
                      height: 44,
                      background: 'var(--muted)',
                      borderRadius: 'calc(var(--radius) - 2px)',
                      overflow: 'hidden',
                      flexShrink: 0,
                    }}
                  >
                    {bookInfo?.cover ? (
                      <img
                        src={bookInfo.cover}
                        alt={bookInfo.title}
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
                  <div style={{ flex: 1, minWidth: 0 }}>
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
                      {bookInfo?.title || '未知书名'}
                    </strong>
                    {bookInfo?.author && <Tiny>{bookInfo.author}</Tiny>}
                    {!bookInfo && item.albumInfo && <Tiny>有声内容</Tiny>}
                  </div>
                  <div style={{ textAlign: 'right', flexShrink: 0 }}>
                    <strong
                      style={{
                        fontSize: '0.875rem',
                        color: 'var(--foreground)',
                        fontFamily: 'var(--font-mono)',
                      }}
                    >
                      {formatReadingTime(item.readTime)}
                    </strong>
                    {item.tags && item.tags.length > 0 && (
                      <div
                        style={{
                          display: 'flex',
                          gap: '0.25rem',
                          justifyContent: 'flex-end',
                          marginTop: '0.25rem',
                        }}
                      >
                        {item.tags.map((tag) => (
                          <Badge key={tag} variant="default">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      )}

      {/* 用户画像 + 分类 + 时段 三列网格 */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 'calc(var(--spacing) * 4)',
        }}
      >
        {readingData.preferCategory &&
          readingData.preferCategory.length > 0 && (
            <UserProfileCard
              categories={readingData.preferCategory}
              categoryWord={readingData.preferCategoryWord}
            />
          )}
        {readingData.preferCategory &&
          readingData.preferCategory.length > 0 && (
            <CategoryBreakdown categories={readingData.preferCategory} />
          )}
        {readingData.preferTime &&
          readingData.preferTime.length > 0 && (
            <ReadingTimeHeatmap
              preferTime={readingData.preferTime}
              preferTimeWord={readingData.preferTimeWord}
            />
          )}
      </div>

      {/* 偏好作者 */}
      {readingData.preferAuthor && readingData.preferAuthor.length > 0 && (
        <Card>
          <CardHead
            eyebrow="偏好作者"
            title={`共 ${readingData.authorCount || readingData.preferAuthor.length} 位`}
          />
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              gap: 'calc(var(--spacing) * 3)',
            }}
          >
            {readingData.preferAuthor.map((author) => (
              <div
                key={author.authorId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'calc(var(--spacing) * 2)',
                  padding: 'calc(var(--spacing) * 2)',
                  background: 'var(--muted)',
                  borderRadius: 'var(--radius)',
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    background: 'var(--secondary)',
                    color: 'var(--secondary-foreground)',
                    borderRadius: '50%',
                    display: 'grid',
                    placeItems: 'center',
                    fontSize: '0.8rem',
                    fontWeight: 700,
                    flexShrink: 0,
                  }}
                >
                  {author.name.charAt(0)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <strong
                    style={{
                      display: 'block',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      color: 'var(--foreground)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {author.name}
                  </strong>
                  <Tiny>
                    {author.count} 本 · {author.readTime}
                  </Tiny>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* 排名徽章 */}
      {readingData.rank && (
        <Card>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'calc(var(--spacing) * 2)',
            }}
          >
            <span style={{ fontSize: '1.2rem' }}>🏆</span>
            <strong style={{ fontSize: '0.95rem', color: 'var(--foreground)' }}>
              {readingData.rank.text}
            </strong>
          </div>
        </Card>
      )}

      {/* 刷新阅读数据按钮 */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button
          variant="ghost"
          onClick={onRefresh}
          disabled={loading}
          data-dom-id="cta-refresh-reading"
        >
          <Icon name="refresh" size={14} /> {loading ? '加载中...' : '刷新阅读数据'}
        </Button>
      </div>
    </>
  )
}
