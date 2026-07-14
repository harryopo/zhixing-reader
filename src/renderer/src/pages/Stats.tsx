import { useState, useEffect, useCallback, useMemo } from 'react'
import { toast } from '../stores/toastStore'
import { mapBooks, mapHighlights, mapCards, safeNum } from '../utils/db-mapper'
import { useReadingDataStore, formatReadingTime } from '../stores/readingDataStore'
import { ReadingMode, ReadingDataResponse, ReadLongestItem, PreferCategory, Book } from '../../../shared/types'

type TabKey = 'reading' | 'books'

export default function Stats() {
  const [bookStats, setBookStats] = useState<Array<{
    id: string
    title: string
    author: string
    cover: string
    progress: number
    highlightCount: number
    cardCount: number
  }>>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [sortBy, setSortBy] = useState<'title' | 'progress' | 'highlights' | 'cards'>('progress')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [activeTab, setActiveTab] = useState<TabKey>('reading')

  const { data: readingData, mode: readingMode, loading: readingLoading, fetchReadingData, setMode } = useReadingDataStore()

  const loadData = useCallback(async () => {
    if (!window.electronAPI?.book || !window.electronAPI?.highlight || !window.electronAPI?.card) {
      setLoading(false)
      setRefreshing(false)
      return
    }
    try {
      const booksRaw = await window.electronAPI.book.getAll() as unknown[]
      const books = mapBooks(booksRaw)

      if (books.length === 0) {
        setBookStats([])
        return
      }

      const stats = []
      for (const book of books) {
        let highlightCount = 0
        let cardCount = 0
        try {
          const hRaw = await window.electronAPI.highlight.getByBook(book.id as string) as unknown[]
          highlightCount = mapHighlights(hRaw).length
        } catch {}
        try {
          const cRaw = await window.electronAPI.card.getByBook(book.id as string) as unknown[]
          cardCount = mapCards(cRaw).length
        } catch {}
        stats.push({
          id: book.id as string,
          title: book.title as string,
          author: book.author as string,
          cover: book.cover as string,
          progress: safeNum(book.progress),
          highlightCount,
          cardCount,
        })
      }

      setBookStats(stats)
    } catch (error) {
      console.error('加载数据失败:', error)
      toast.error('加载统计数据失败')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { loadData() }, [loadData])

  useEffect(() => {
    fetchReadingData(readingMode).catch(() => {})
  }, [])

  const handleSync = async () => {
    setRefreshing(true)
    setLoading(true)
    const syncToastId = toast.loading('正在同步微信读书数据...')

    try {
      const wereadBooks = await window.electronAPI.weread.getBookshelf() as Array<{
        bookId: string
        title: string
        author: string
        cover: string
        progress: number
        lastReadTime: number
      }>

      let updatedCount = 0
      if (wereadBooks && wereadBooks.length > 0) {
        for (const wb of wereadBooks) {
          try {
            const existing = await window.electronAPI.book.search(wb.title) as unknown as Book[]
            if (existing && existing.length > 0) {
              await window.electronAPI.book.update(existing[0].id as string, {
                reading_progress: wb.progress || 0,
                last_read_time: wb.lastReadTime ? new Date(wb.lastReadTime).toISOString() : null,
                cover: wb.cover || (existing[0].cover as string),
              })
              updatedCount++
            }
          } catch (e) {
            console.error('更新书籍失败:', wb.title, e)
          }
        }
      }

      await loadData()
      toast.remove(syncToastId)
      toast.success(updatedCount > 0 ? `同步完成，更新了 ${updatedCount} 本书` : '数据已是最新')
    } catch (error) {
      console.error('同步失败:', error)
      toast.remove(syncToastId)
      toast.error('同步失败，请检查微信读书配置')
      await loadData()
    }
  }

  const handleRefreshReadingData = async () => {
    try {
      await fetchReadingData(readingMode)
    } catch (error) {
      toast.error('获取阅读数据失败，请检查微信读书配置')
    }
  }

  const sortedStats = [...bookStats].sort((a, b) => {
    let comparison = 0
    switch (sortBy) {
      case 'title': comparison = a.title.localeCompare(b.title); break
      case 'progress': comparison = a.progress - b.progress; break
      case 'highlights': comparison = a.highlightCount - b.highlightCount; break
      case 'cards': comparison = a.cardCount - b.cardCount; break
    }
    return sortOrder === 'desc' ? -comparison : comparison
  })

  const handleSort = (column: 'title' | 'progress' | 'highlights' | 'cards') => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(column)
      setSortOrder('desc')
    }
  }

  const totalHighlights = bookStats.reduce((sum, s) => sum + s.highlightCount, 0)
  const totalCards = bookStats.reduce((sum, s) => sum + s.cardCount, 0)

  const modeLabels: Record<ReadingMode, string> = {
    weekly: '本周',
    monthly: '本月',
    annually: '本年',
    overall: '总计',
  }

  if (loading && !refreshing) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">阅读数据</h1>
          <p className="text-gray-600 mt-1">查看你的阅读和学习统计</p>
        </div>
        <button
          onClick={handleSync}
          disabled={refreshing}
          className="px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all duration-200 text-sm font-medium shadow-sm hover:shadow"
        >
          {refreshing ? (
            <>
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              同步中...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              同步更新
            </>
          )}
        </button>
      </div>

      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit">
        {(['reading', 'books'] as TabKey[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-md transition-all duration-200 ${
              activeTab === tab
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab === 'reading' ? '阅读统计' : '书籍统计'}
          </button>
        ))}
      </div>

      {activeTab === 'reading' && (
        <ReadingDataSection
          data={readingData}
          mode={readingMode}
          loading={readingLoading}
          modeLabels={modeLabels}
          onModeChange={setMode}
          onRefresh={handleRefreshReadingData}
        />
      )}

      {activeTab === 'books' && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="bg-white rounded-lg p-4 border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">书籍数</p>
                  <p className="text-2xl font-bold text-primary">{bookStats.length}</p>
                </div>
                <div className="w-10 h-10 bg-primary-light rounded-lg flex items-center justify-center">
                  <span className="text-primary">📚</span>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg p-4 border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">笔记总数</p>
                  <p className="text-2xl font-bold text-primary">{totalHighlights}</p>
                </div>
                <div className="w-10 h-10 bg-primary-light rounded-lg flex items-center justify-center">
                  <span className="text-primary">📝</span>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg p-4 border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">卡片总数</p>
                  <p className="text-2xl font-bold text-primary">{totalCards}</p>
                </div>
                <div className="w-10 h-10 bg-primary-light rounded-lg flex items-center justify-center">
                  <span className="text-primary">🃏</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-semibold text-gray-900">书籍统计</h2>
              <span className="text-sm text-gray-500">共 {bookStats.length} 本</span>
            </div>

            {bookStats.length === 0 ? (
              <div className="text-center py-12 text-gray-500">
                <div className="text-5xl mb-3">📊</div>
                <p className="text-lg font-medium">暂无数据</p>
                <p className="text-sm mt-1">点击"同步更新"获取微信读书数据</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 px-4 text-sm font-medium text-gray-600">书名</th>
                      <th className="text-center py-3 px-4 text-sm font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none" onClick={() => handleSort('progress')}>
                        <div className="flex items-center justify-center gap-1">
                          进度 {sortBy === 'progress' && <span className="text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                        </div>
                      </th>
                      <th className="text-center py-3 px-4 text-sm font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none" onClick={() => handleSort('highlights')}>
                        <div className="flex items-center justify-center gap-1">
                          笔记 {sortBy === 'highlights' && <span className="text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                        </div>
                      </th>
                      <th className="text-center py-3 px-4 text-sm font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none" onClick={() => handleSort('cards')}>
                        <div className="flex items-center justify-center gap-1">
                          卡片 {sortBy === 'cards' && <span className="text-primary">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedStats.map((stat) => (
                      <tr key={stat.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-10 bg-primary-light rounded flex-shrink-0 overflow-hidden">
                              {stat.cover ? (
                                <img src={stat.cover} alt={stat.title} className="w-full h-full object-cover"
                                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center"><span className="text-xs">📖</span></div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-gray-900 truncate max-w-[180px]">{stat.title}</p>
                              {stat.author && <p className="text-xs text-gray-500 truncate max-w-[180px]">{stat.author}</p>}
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex items-center justify-center gap-2">
                            {(() => {
                              const normalizedProgress = stat.progress > 1 ? stat.progress : stat.progress * 100
                              const pct = Math.min(Math.max(Math.round(normalizedProgress), 0), 100)
                              return (
                                <>
                                  <div className="w-14 bg-gray-200 rounded-full h-1.5">
                                    <div className="bg-primary h-1.5 rounded-full transition-all duration-300" style={{ width: `${pct}%` }}></div>
                                  </div>
                                  <span className="text-sm text-gray-700 w-10 text-right font-medium">{pct}%</span>
                                </>
                              )
                            })()}
                          </div>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`text-sm font-medium ${stat.highlightCount > 0 ? 'text-gray-900' : 'text-gray-400'}`}>{stat.highlightCount}</span>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <span className={`text-sm font-medium ${stat.cardCount > 0 ? 'text-gray-900' : 'text-gray-400'}`}>{stat.cardCount}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

function ReadingDataSection({
  data,
  mode,
  loading,
  modeLabels,
  onModeChange,
  onRefresh,
}: {
  data: ReadingDataResponse | null
  mode: ReadingMode
  loading: boolean
  modeLabels: Record<ReadingMode, string>
  onModeChange: (mode: ReadingMode) => void
  onRefresh: () => void
}) {
  const compareText = data?.compare != null
    ? data.compare >= 0
      ? `较上期增长 ${Math.round(data.compare * 100)}%`
      : `较上期下降 ${Math.round(Math.abs(data.compare) * 100)}%`
    : null

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
          {(['weekly', 'monthly', 'annually', 'overall'] as ReadingMode[]).map(m => (
            <button
              key={m}
              onClick={() => onModeChange(m)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all duration-200 ${
                mode === m
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {modeLabels[m]}
            </button>
          ))}
        </div>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary-light rounded-md transition-colors disabled:opacity-50"
        >
          {loading ? '加载中...' : '刷新'}
        </button>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : !data ? (
        <div className="text-center py-16 text-gray-500">
          <div className="text-5xl mb-3">📊</div>
          <p className="text-lg font-medium">暂无阅读数据</p>
          <p className="text-sm mt-1">请确保已配置微信读书 API Key 后刷新</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="总阅读时长" value={formatReadingTime(data.totalReadTime)} icon="⏱️" />
            <StatCard label="阅读天数" value={`${data.readDays} 天`} icon="📅" />
            <StatCard label="日均时长" value={formatReadingTime(data.dayAverageReadTime)} icon="📈" />
            <StatCard
              label="较上期"
              value={compareText || '暂无对比'}
              icon="📊"
              highlight={compareText ? data.compare! >= 0 : undefined}
            />
          </div>

          {(() => {
            const chartData = data.readTimes && Object.keys(data.readTimes).length > 0
              ? data.readTimes
              : data.dailyReadTimes && Object.keys(data.dailyReadTimes).length > 0
                ? data.dailyReadTimes
                : null
            if (chartData) {
              return <ReadingTrendChart readTimes={chartData} mode={mode} baseTime={data.baseTime} />
            }
            return (
              <div className="bg-white rounded-lg border border-gray-200 p-5">
                <h3 className="text-sm font-semibold text-gray-700 mb-4">
                  {mode === 'weekly' ? '每日阅读时长' : mode === 'monthly' ? '每日阅读时长' : mode === 'annually' ? '每月阅读时长' : '每年阅读时长'}
                </h3>
                <div className="flex flex-col items-center justify-center py-12 text-gray-400">
                  <svg className="w-12 h-12 mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
                  </svg>
                  <p className="text-sm">暂无趋势数据</p>
                  <p className="text-xs mt-1">该周期内没有阅读记录</p>
                </div>
              </div>
            )
          })()}

          {data.readRate != null && (
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">阅读方式</h3>
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-gray-600">文字阅读</span>
                    <span className="font-medium text-gray-900">{Math.round(data.readRate)}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="bg-primary h-2 rounded-full transition-all duration-500" style={{ width: `${data.readRate}%` }}></div>
                  </div>
                </div>
                <div className="text-sm text-gray-500">
                  {data.wrReadTime != null && <span>阅读 {formatReadingTime(data.wrReadTime)}</span>}
                  {data.wrListenTime != null && <span> · 听书 {formatReadingTime(data.wrListenTime)}</span>}
                </div>
              </div>
            </div>
          )}

          {data.readStat && data.readStat.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">阅读统计</h3>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {data.readStat.map((item, i) => (
                  <div key={i} className="text-center p-3 bg-gray-50 rounded-lg">
                    <p className="text-xs text-gray-500">{item.stat}</p>
                    <p className="text-lg font-bold text-gray-900 mt-1">{item.counts}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.readLongest && data.readLongest.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">读得最多</h3>
              <div className="space-y-3">
                {data.readLongest.map((item: ReadLongestItem, i: number) => {
                  const bookInfo = item.book
                  return (
                    <div key={bookInfo?.bookId || i} className="flex items-center gap-3">
                      <span className="text-sm font-bold text-gray-400 w-5">{i + 1}</span>
                      <div className="w-8 h-11 bg-gray-100 rounded overflow-hidden flex-shrink-0">
                        {bookInfo?.cover ? (
                          <img src={bookInfo.cover} alt={bookInfo.title} className="w-full h-full object-cover"
                            onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }} />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs">📖</div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{bookInfo?.title || '未知书名'}</p>
                        {bookInfo?.author && <p className="text-xs text-gray-500 truncate">{bookInfo.author}</p>}
                        {!bookInfo && item.albumInfo && (
                          <p className="text-xs text-gray-500 truncate">有声内容</p>
                        )}
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-sm font-medium text-gray-900">{formatReadingTime(item.readTime)}</p>
                        {item.tags && item.tags.length > 0 && (
                          <div className="flex gap-1 justify-end mt-0.5">
                            {item.tags.map(tag => (
                              <span key={tag} className="text-[10px] px-1.5 py-0.5 bg-primary-light text-primary rounded-full">{tag}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {data.preferCategory && data.preferCategory.length > 0 && (
              <UserProfileCard categories={data.preferCategory} categoryWord={data.preferCategoryWord} />
            )}

            {data.preferCategory && data.preferCategory.length > 0 && (
              <CategoryBreakdown categories={data.preferCategory} />
            )}

            {data.preferTime && data.preferTime.length > 0 && (
              <ReadingTimeHeatmap preferTime={data.preferTime} preferTimeWord={data.preferTimeWord} />
            )}
          </div>

          {data.preferAuthor && data.preferAuthor.length > 0 && (
            <div className="bg-white rounded-lg border border-gray-200 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">
                偏好作者
                {data.authorCount != null && <span className="text-gray-400 font-normal ml-2">共 {data.authorCount} 位</span>}
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                {data.preferAuthor.map(author => (
                  <div key={author.authorId} className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
                    <div className="w-8 h-8 bg-primary-light rounded-full flex items-center justify-center text-xs font-bold text-primary flex-shrink-0">
                      {author.name.charAt(0)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{author.name}</p>
                      <p className="text-xs text-gray-500">{author.count}本 · {author.readTime}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.rank && (
            <div className="bg-gradient-to-r from-primary/10 to-primary/5 rounded-lg border border-primary/20 p-4">
              <div className="flex items-center gap-2">
                <span className="text-lg">🏆</span>
                <p className="text-sm font-medium text-gray-900">{data.rank.text}</p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, icon, highlight }: {
  label: string
  value: string
  icon: string
  highlight?: boolean
}) {
  return (
    <div className="bg-white rounded-lg p-4 border border-gray-200">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-600">{label}</p>
          <p className={`text-xl font-bold mt-1 ${
            highlight === true ? 'text-green-600' :
            highlight === false ? 'text-red-500' :
            'text-primary'
          }`}>{value}</p>
        </div>
        <div className="w-10 h-10 bg-primary-light rounded-lg flex items-center justify-center">
          <span>{icon}</span>
        </div>
      </div>
    </div>
  )
}

function deriveProfile(categories: PreferCategory[]) {
  const sorted = [...categories].filter(c => c.readingTime > 0 || c.readingCount > 0).sort((a, b) => b.readingTime - a.readingTime)
  const topCat = sorted[0]
  const totalTime = sorted.reduce((s, c) => s + c.readingTime, 0)
  const totalBooks = sorted.reduce((s, c) => s + c.readingCount, 0)
  const top2 = sorted.slice(0, 2)
  const top2Time = top2.reduce((s, c) => s + c.readingTime, 0)
  const concentration = totalTime > 0 ? top2Time / totalTime : 0

  const identityLabels: { keys: string[]; label: string; desc: string }[] = [
    { keys: ['计算机', '编程', '科技', '互联网', '人工智能', '算法'], label: '技术探索者', desc: '热爱计算机与技术类阅读，用代码改变世界' },
    { keys: ['文学', '小说', '外国文学', '中国文学', '散文', '诗歌'], label: '文学爱好者', desc: '徜徉文字海洋，品味文学之美' },
    { keys: ['历史', '文化', '人物传记', '传记', '纪实'], label: '历史沉思者', desc: '以史为鉴，在时间长河中寻找智慧' },
    { keys: ['经济理财', '商业', '投资', '金融', '管理'], label: '经济洞察家', desc: '把握商业脉搏，洞悉经济规律' },
    { keys: ['个人成长', '心理', '励志', '人生哲学', '自我管理'], label: '成长修行者', desc: '不断自我精进，追求更好的自己' },
    { keys: ['哲学', '社会科学', '政治', '法律', '军事'], label: '思想深邃者', desc: '探索思想的边界，追寻真理的光芒' },
    { keys: ['教育', '学习', '外语', '童书', '亲子'], label: '终身学习者', desc: '学无止境，用知识武装自己' },
    { keys: ['艺术', '设计', '摄影', '音乐', '建筑'], label: '美学鉴赏家', desc: '在艺术中发现生活的诗意' },
    { keys: ['科学', '科普', '自然科学', '物理', '数学'], label: '科学求真者', desc: '探索自然规律，追问万物本质' },
    { keys: ['医学', '健康', '养生', '运动', '美食'], label: '健康关注者', desc: '关注身心健康，追求品质生活' },
    { keys: ['旅行', '地理', '生活', '休闲'], label: '生活家', desc: '热爱生活，在阅读中发现世界之美' },
  ]

  let identity = identityLabels[0]
  if (topCat) {
    for (const item of identityLabels) {
      if (item.keys.some(k => topCat.categoryTitle.includes(k) || k.includes(topCat.categoryTitle))) {
        identity = item
        break
      }
    }
  }

  const tags: string[] = []
  sorted.slice(0, 4).forEach(c => {
    if (c.readingCount > 0) tags.push(c.categoryTitle)
  })

  if (concentration > 0.6) {
    tags.unshift('深度聚焦')
  } else if (concentration < 0.35 && sorted.length >= 3) {
    tags.unshift('广泛涉猎')
  }

  const profileSummary = topCat
    ? `主要沉浸在${topCat.categoryTitle}领域，${top2.length > 1 ? `同时涉猎${top2[1].categoryTitle}` : ''}，共阅读 ${totalBooks} 本书，累计 ${formatReadingTime(totalTime)}。${concentration > 0.6 ? '阅读方向高度聚焦，深度钻研。' : concentration > 0.3 ? '阅读兴趣广泛而平衡。' : '阅读口味多元，涉猎广泛。'}`
    : '开始阅读，探索你的知识边界吧。'

  const level = totalBooks >= 50 ? { name: '博览群书', color: 'text-amber-600', bg: 'bg-amber-50' }
    : totalBooks >= 20 ? { name: '学识渊博', color: 'text-indigo-600', bg: 'bg-indigo-50' }
    : totalBooks >= 10 ? { name: '求知若渴', color: 'text-emerald-600', bg: 'bg-emerald-50' }
    : totalBooks >= 5 ? { name: '初窥门径', color: 'text-sky-600', bg: 'bg-sky-50' }
    : { name: '初出茅庐', color: 'text-gray-600', bg: 'bg-gray-50' }

  const top3Pct = sorted.slice(0, 3).map(c => ({
    title: c.categoryTitle,
    pct: totalTime > 0 ? Math.round((c.readingTime / totalTime) * 100) : 0,
  }))

  return { identity, tags, profileSummary, totalBooks, totalTime, concentration, level, top3Pct, sorted }
}

const CATEGORY_COLORS = [
  '#6366f1', '#8b5cf6', '#a78bfa',
  '#f59e0b', '#10b981', '#3b82f6',
  '#ec4899', '#ef4444', '#06b6d4',
]

function UserProfileCard({ categories, categoryWord }: { categories: PreferCategory[]; categoryWord?: string }) {
  const profile = useMemo(() => deriveProfile(categories), [categories])

  const identityEmoji =
    profile.identity.label === '技术探索者' ? '💻' :
    profile.identity.label === '文学爱好者' ? '📖' :
    profile.identity.label === '历史沉思者' ? '🏛️' :
    profile.identity.label === '经济洞察家' ? '📊' :
    profile.identity.label === '成长修行者' ? '🌱' :
    profile.identity.label === '思想深邃者' ? '🧠' :
    profile.identity.label === '终身学习者' ? '🎓' :
    profile.identity.label === '美学鉴赏家' ? '🎨' :
    profile.identity.label === '科学求真者' ? '🔬' :
    profile.identity.label === '健康关注者' ? '💪' :
    profile.identity.label === '生活家' ? '🌍' : '📚'

  const ringSegments = useMemo(() => {
    if (profile.sorted.length === 0) return []
    const top = profile.sorted.slice(0, 5)
    const total = top.reduce((s, c) => s + c.readingTime, 0)
    if (total === 0) return []
    const cumPct: number[] = []
    let acc = 0
    top.forEach(c => {
      acc += (c.readingTime / total) * 100
      cumPct.push(acc)
    })
    return top.map((c, i) => {
      const start = i === 0 ? 0 : cumPct[i - 1]
      const end = cumPct[i]
      const pct = end - start
      return { title: c.categoryTitle, pct, color: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }
    })
  }, [profile.sorted])

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      <div className="bg-gradient-to-br from-indigo-500 via-purple-500 to-fuchsia-500 px-5 pt-4 pb-3">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-12 h-12 bg-white/20 backdrop-blur rounded-full flex items-center justify-center text-2xl">
            {identityEmoji}
          </div>
          <div>
            <p className="text-base font-bold text-white">{profile.identity.label}</p>
            <p className={`text-xs px-2 py-0.5 rounded-full inline-block mt-0.5 ${profile.level.bg} ${profile.level.color} font-medium`}>
              {profile.level.name}
            </p>
          </div>
        </div>
        <p className="text-xs text-white/80 leading-relaxed">{profile.identity.desc}</p>
      </div>

      <div className="px-5 py-4 space-y-3">
        {ringSegments.length > 0 && (
          <div className="flex items-center gap-3">
            <svg width="52" height="52" viewBox="0 0 36 36" className="flex-shrink-0">
              {ringSegments.map((seg, i) => {
                const prevEnd = ringSegments.slice(0, i).reduce((s, s2) => s + s2.pct, 0)
                const dasharray = `${seg.pct} ${100 - seg.pct}`
                return (
                  <circle
                    key={i}
                    cx="18" cy="18" r="15.915"
                    fill="none"
                    stroke={seg.color}
                    strokeWidth="3"
                    strokeDasharray={dasharray}
                    strokeDashoffset={`${-prevEnd}`}
                    transform="rotate(-90 18 18)"
                    className="transition-all duration-500"
                  />
                )
              })}
              <text x="18" y="18" textAnchor="middle" dominantBaseline="central" fontSize="8" fontWeight="bold" fill="#1f2937">{profile.totalBooks}本</text>
            </svg>
            <div className="flex-1 min-w-0 space-y-1">
              {ringSegments.map((seg, i) => (
                <div key={i} className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: seg.color }}></div>
                  <span className="text-[11px] text-gray-700 truncate flex-1">{seg.title}</span>
                  <span className="text-[11px] text-gray-400 flex-shrink-0">{seg.pct}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-wrap gap-1.5">
          {profile.tags.map(tag => (
            <span key={tag} className={`text-[10px] px-2 py-0.5 rounded-full ${
              tag === '深度聚焦' || tag === '广泛涉猎'
                ? 'bg-amber-50 text-amber-600 ring-1 ring-amber-200'
                : 'bg-gray-50 text-gray-600 ring-1 ring-gray-200'
            }`}>{tag}</span>
          ))}
        </div>

        <div className="border-t border-gray-100 pt-3">
          <p className="text-[11px] text-gray-500 leading-relaxed">{profile.profileSummary}</p>
        </div>
      </div>
    </div>
  )
}

function CategoryBreakdown({ categories }: { categories: PreferCategory[] }) {
  const sorted = useMemo(() => {
    return [...categories]
      .filter(c => c.readingTime > 0)
      .sort((a, b) => b.readingTime - a.readingTime)
      .slice(0, 8)
  }, [categories])

  const totalTime = useMemo(() => sorted.reduce((s, c) => s + c.readingTime, 0), [sorted])

  if (sorted.length === 0) return null

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 flex flex-col">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">偏好分类</h3>

      <div className="flex gap-2 mb-4">
        {sorted.slice(0, 5).map((cat, i) => {
          const pct = totalTime > 0 ? Math.round((cat.readingTime / totalTime) * 100) : 0
          return (
            <div
              key={cat.categoryId}
              className="h-2 rounded-full transition-all duration-500"
              style={{
                width: `${Math.max(pct, 3)}%`,
                backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length],
              }}
              title={`${cat.categoryTitle} ${pct}%`}
            ></div>
          )
        })}
      </div>

      <div className="flex-1 space-y-2.5">
        {sorted.map((cat, i) => {
          const maxTime = sorted[0].readingTime
          const barPct = maxTime > 0 ? (cat.readingTime / maxTime) * 100 : 0
          const sharePct = totalTime > 0 ? Math.round((cat.readingTime / totalTime) * 100) : 0
          return (
            <div key={cat.categoryId} className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}></div>
              <span className="text-xs text-gray-700 w-14 truncate flex-shrink-0 font-medium">{cat.categoryTitle}</span>
              <div className="flex-1 bg-gray-100 rounded-full h-2 overflow-hidden">
                <div
                  className="h-2 rounded-full transition-all duration-500"
                  style={{ width: `${Math.max(barPct, 3)}%`, backgroundColor: CATEGORY_COLORS[i % CATEGORY_COLORS.length] }}
                ></div>
              </div>
              <span className="text-[11px] text-gray-400 w-10 text-right flex-shrink-0">{sharePct}%</span>
              <span className="text-[11px] text-gray-500 w-14 text-right flex-shrink-0">{formatReadingTime(cat.readingTime)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ReadingTimeHeatmap({ preferTime, preferTimeWord }: { preferTime: number[]; preferTimeWord?: string }) {
  const [hoveredHour, setHoveredHour] = useState<number | null>(null)
  const maxSeconds = useMemo(() => Math.max(...preferTime, 1), [preferTime])

  const currentHour = useMemo(() => new Date().getHours(), [])
  const peakHourIdx = useMemo(() => {
    let maxIdx = 0
    preferTime.forEach((s, i) => { if (s > preferTime[maxIdx]) maxIdx = i })
    return maxIdx
  }, [preferTime])

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700">
          阅读时段
          {preferTimeWord && <span className="text-primary font-normal ml-2">{preferTimeWord}</span>}
        </h3>
        {hoveredHour !== null && (
          <span className="text-xs text-gray-500">{(6 + hoveredHour) % 24}:00 · {formatReadingTime(preferTime[hoveredHour])}</span>
        )}
      </div>
      <div className="flex-1 flex items-end gap-[3px] h-24 relative">
        {preferTime.map((seconds, i) => {
          const height = maxSeconds > 0 ? (seconds / maxSeconds) * 100 : 0
          const hourLabel = (6 + i) % 24
          const isActive = currentHour === hourLabel
          const isPeak = i === peakHourIdx
          const isHovered = hoveredHour === i
          return (
            <div
              key={i}
              className="flex-1 flex flex-col items-center gap-0.5 cursor-pointer group"
              onMouseEnter={() => setHoveredHour(i)}
              onMouseLeave={() => setHoveredHour(null)}
            >
              <div
                className={`w-full rounded-t transition-all duration-200 min-h-[2px] ${
                  isHovered
                    ? 'bg-indigo-500 opacity-100'
                    : isPeak
                      ? 'bg-primary opacity-90'
                      : isActive
                        ? 'bg-primary/70'
                        : 'bg-primary/40 group-hover:bg-primary/70'
                }`}
                style={{ height: `${Math.max(height, 2)}%` }}
              ></div>
              {i % 6 === 0 && (
                <span className={`text-[9px] ${isActive ? 'text-primary font-bold' : 'text-gray-400'}`}>{hourLabel}</span>
              )}
            </div>
          )
        })}
      </div>
      {peakHourIdx >= 0 && (
        <p className="text-[10px] text-gray-400 mt-2 text-center">
          高峰时段 {(6 + peakHourIdx) % 24}:00，累计 {formatReadingTime(preferTime[peakHourIdx])}
        </p>
      )}
    </div>
  )
}

function ReadingTrendChart({ readTimes, mode, baseTime }: {
  readTimes: Record<string, number>
  mode: ReadingMode
  baseTime: number
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)

  const points = useMemo(() => {
    const entries = Object.entries(readTimes)
      .map(([ts, seconds]) => ({ ts: Number(ts), seconds }))
      .sort((a, b) => a.ts - b.ts)
    return entries
  }, [readTimes])

  const maxSeconds = useMemo(() => {
    if (points.length === 0) return 0
    return Math.max(...points.map(p => p.seconds), 1)
  }, [points])

  const gradientId = useMemo(() => `areaGrad-${mode}-${baseTime}`, [mode, baseTime])

  const getLabel = useCallback((ts: number, _index: number) => {
    const date = new Date(ts * 1000)
    if (mode === 'weekly' || mode === 'monthly') {
      return `${date.getMonth() + 1}/${date.getDate()}`
    }
    if (mode === 'annually') {
      return `${date.getMonth() + 1}月`
    }
    return `${date.getFullYear()}`
  }, [mode])

  const labels = useMemo(() => points.map((p, i) => getLabel(p.ts, i)), [points, getLabel])

  const chartTitle = mode === 'weekly' ? '每日阅读时长' : mode === 'monthly' ? '每日阅读时长' : mode === 'annually' ? '每月阅读时长' : '每年阅读时长'

  const chartW = 700
  const chartH = 180
  const padL = 50
  const padR = 16
  const padT = 16
  const padB = 30
  const plotW = chartW - padL - padR
  const plotH = chartH - padT - padB

  const barW = points.length > 1 ? Math.max(2, Math.min(28, plotW / points.length - 2)) : 28
  const gap = points.length > 1 ? (plotW - barW * points.length) / (points.length - 1) : 0

  const getX = (i: number) => padL + i * (barW + gap)
  const getY = (seconds: number) => padT + plotH - (seconds / maxSeconds) * plotH

  const yTicks = useMemo(() => {
    const rawMax = maxSeconds / 60
    let step: number
    if (rawMax <= 10) step = 2
    else if (rawMax <= 30) step = 5
    else if (rawMax <= 60) step = 15
    else if (rawMax <= 180) step = 30
    else if (rawMax <= 360) step = 60
    else step = 120
    const ticks: { value: number; label: string }[] = []
    for (let v = 0; v * 60 <= maxSeconds; v += step) {
      const mins = v * 60
      ticks.push({ value: mins, label: v < 60 ? `${v}m` : `${Math.floor(v / 60)}h${v % 60 > 0 ? (v % 60) : ''}` })
    }
    return ticks
  }, [maxSeconds])

  const areaPath = useMemo(() => {
    if (points.length === 0) return ''
    const start = `M ${getX(0)} ${getY(points[0].seconds)}`
    const lineParts = points.slice(1).map((p, i) => {
      const x0 = getX(i)
      const x1 = getX(i + 1)
      const y0 = getY(points[i].seconds)
      const y1 = getY(p.seconds)
      const cpx = (x0 + x1) / 2
      return `C ${cpx} ${y0}, ${cpx} ${y1}, ${x1} ${y1}`
    }).join(' ')
    const lastX = getX(points.length - 1)
    const bottomY = padT + plotH
    return `${start} ${lineParts} L ${lastX} ${bottomY} L ${getX(0)} ${bottomY} Z`
  }, [points, maxSeconds])

  const linePath = useMemo(() => {
    if (points.length === 0) return ''
    const start = `M ${getX(0)} ${getY(points[0].seconds)}`
    return points.slice(1).map((p, i) => {
      const x0 = getX(i)
      const x1 = getX(i + 1)
      const y0 = getY(points[i].seconds)
      const y1 = getY(p.seconds)
      const cpx = (x0 + x1) / 2
      return `C ${cpx} ${y0}, ${cpx} ${y1}, ${x1} ${y1}`
    }).join(' ').replace(/^/, start + ' ')
  }, [points, maxSeconds])

  const labelStep = Math.max(1, Math.ceil(points.length / 10))

  if (points.length === 0) return null

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-5 overflow-hidden">
      <h3 className="text-sm font-semibold text-gray-700 mb-4">{chartTitle}</h3>
      <div className="relative w-full overflow-x-auto">
        <svg viewBox={`0 0 ${chartW} ${chartH}`} className="w-full" style={{ minWidth: Math.min(chartW, points.length * 30 + padL + padR), maxHeight: 200 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary, #6366f1)" stopOpacity="0.25" />
              <stop offset="100%" stopColor="var(--color-primary, #6366f1)" stopOpacity="0.02" />
            </linearGradient>
          </defs>

          {yTicks.map(tick => {
            const y = getY(tick.value)
            return (
              <g key={tick.value}>
                <line x1={padL} y1={y} x2={chartW - padR} y2={y} stroke="#e5e7eb" strokeWidth="0.5" />
                <text x={padL - 6} y={y + 3} textAnchor="end" fontSize="9" fill="#9ca3af">{tick.label}</text>
              </g>
            )
          })}

          {points.length > 1 && <path d={areaPath} fill={`url(#${gradientId})`} />}
          {points.length > 1 && <path d={linePath} fill="none" stroke="var(--color-primary, #6366f1)" strokeWidth="2" strokeLinecap="round" />}

          {points.map((p, i) => {
            const x = getX(i)
            const y = getY(p.seconds)
            const isHovered = hoveredIndex === i
            const minutes = Math.round(p.seconds / 60)
            return (
              <g key={p.ts}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                {isHovered && (
                  <>
                    <line x1={x} y1={padT} x2={x} y2={padT + plotH} stroke="var(--color-primary, #6366f1)" strokeWidth="0.5" strokeDasharray="3,3" opacity="0.5" />
                    <rect x={x - 40} y={y - 28} width={80} height={22} rx={4} fill="#1f2937" opacity="0.9" />
                    <text x={x} y={y - 14} textAnchor="middle" fontSize="10" fill="white" fontWeight="500">
                      {minutes >= 60 ? `${Math.floor(minutes / 60)}h${minutes % 60 > 0 ? `${minutes % 60}m` : ''}` : `${minutes}m`}
                    </text>
                  </>
                )}
                <circle cx={x} cy={y} r={isHovered ? 4.5 : 2.5} fill="var(--color-primary, #6366f1)" stroke="white" strokeWidth="1.5" style={{ transition: 'r 0.15s ease' }} />
              </g>
            )
          })}

          {labels.map((label, i) => {
            if (i % labelStep !== 0 && i !== points.length - 1) return null
            const x = getX(i)
            return (
              <text key={i} x={x} y={chartH - 4} textAnchor="middle" fontSize="9" fill="#9ca3af">{label}</text>
            )
          })}
        </svg>
      </div>
    </div>
  )
}
