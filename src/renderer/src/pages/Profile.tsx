import { useState, useEffect, useCallback } from 'react'
import { useProfileStore } from '../stores/profileStore'
import { toast } from '../stores/toastStore'

export default function Profile() {
  const { stats, achievements, loading, error, fetchStats } = useProfileStore()
  const [activeTab, setActiveTab] = useState<'overview' | 'achievements' | 'progress' | 'report'>('overview')
  const [chartPeriod, setChartPeriod] = useState<'week' | 'month'>('week')
  const [reportPeriod, setReportPeriod] = useState<'week' | 'month' | 'year'>('week')

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}秒`
    if (seconds < 3600) return `${Math.floor(seconds / 60)}分钟`
    return `${Math.floor(seconds / 3600)}小时${Math.floor((seconds % 3600) / 60)}分钟`
  }

  const getChartData = () => {
    const data = chartPeriod === 'week' ? stats.weeklyReadingData : stats.monthlyReadingData
    const labels = data.map(d => {
      const date = new Date(d.date)
      return chartPeriod === 'week'
        ? date.toLocaleDateString('zh-CN', { weekday: 'short' })
        : date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
    })
    const values = data.map(d => d.readingTime / 60)
    return { labels, values }
  }

  const getAchievementProgress = (achievement: { condition: (stats: { finishedBooks: number; totalHighlights: number; masteredCards: number; totalReviews: number; currentStreak: number }) => boolean }) => {
    if (achievement.condition(stats)) return 100
    return 0
  }

  const unlockedAchievements = achievements.filter(a => a.unlockedAt)
  const lockedAchievements = achievements.filter(a => !a.unlockedAt)

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-500">加载失败: {error}</p>
        <button onClick={fetchStats} className="mt-4 px-4 py-2 bg-primary text-white rounded-lg">
          重试
        </button>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">学习档案</h1>
          <p className="text-gray-600 mt-1">查看你的学习历程和成就</p>
        </div>
      </div>

      <div className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
        <button
          onClick={() => setActiveTab('overview')}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'overview'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          概览
        </button>
        <button
          onClick={() => setActiveTab('achievements')}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'achievements'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          成就徽章
        </button>
        <button
          onClick={() => setActiveTab('progress')}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'progress'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          学习曲线
        </button>
        <button
          onClick={() => setActiveTab('report')}
          className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
            activeTab === 'report'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-600 hover:text-gray-900'
          }`}
        >
          学习报告
        </button>
      </div>

      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg p-4 border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">已读书籍</p>
                  <p className="text-2xl font-bold text-primary">{stats.finishedBooks}</p>
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
                  <p className="text-2xl font-bold text-primary">{stats.totalHighlights}</p>
                </div>
                <div className="w-10 h-10 bg-primary-light rounded-lg flex items-center justify-center">
                  <span className="text-primary">📝</span>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg p-4 border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">掌握卡片</p>
                  <p className="text-2xl font-bold text-primary">{stats.masteredCards}</p>
                </div>
                <div className="w-10 h-10 bg-primary-light rounded-lg flex items-center justify-center">
                  <span className="text-primary">🃏</span>
                </div>
              </div>
            </div>
            <div className="bg-white rounded-lg p-4 border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-600">连续学习</p>
                  <p className="text-2xl font-bold text-primary">{stats.currentStreak}天</p>
                </div>
                <div className="w-10 h-10 bg-primary-light rounded-lg flex items-center justify-center">
                  <span className="text-primary">🔥</span>
                </div>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg p-6 border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">学习统计</h3>
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">总阅读时间</span>
                  <span className="font-medium">{formatTime(stats.totalReadingTime)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">日均阅读时间</span>
                  <span className="font-medium">{formatTime(stats.averageDailyReadingTime)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">总复习次数</span>
                  <span className="font-medium">{stats.totalReviews}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">最长连续学习</span>
                  <span className="font-medium">{stats.longestStreak}天</span>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-lg p-6 border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">最近成就</h3>
              {unlockedAchievements.length > 0 ? (
                <div className="space-y-3">
                  {unlockedAchievements.slice(0, 3).map((achievement) => (
                    <div key={achievement.id} className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-yellow-100 rounded-lg flex items-center justify-center">
                        <span className="text-xl">{achievement.icon}</span>
                      </div>
                      <div>
                        <p className="font-medium text-gray-900">{achievement.name}</p>
                        <p className="text-sm text-gray-600">{achievement.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-500 text-center py-4">还没有解锁成就</p>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'achievements' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">成就徽章</h3>
              <span className="text-sm text-gray-500">
                已解锁 {unlockedAchievements.length} / {achievements.length}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {achievements.map((achievement) => {
                const isUnlocked = !!achievement.unlockedAt
                return (
                  <div
                    key={achievement.id}
                    className={`p-4 rounded-lg border ${
                      isUnlocked
                        ? 'border-yellow-200 bg-yellow-50'
                        : 'border-gray-200 bg-gray-50 opacity-60'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
                        isUnlocked ? 'bg-yellow-100' : 'bg-gray-200'
                      }`}>
                        <span className="text-2xl">{achievement.icon}</span>
                      </div>
                      <div>
                        <p className={`font-medium ${isUnlocked ? 'text-gray-900' : 'text-gray-500'}`}>
                          {achievement.name}
                        </p>
                        <p className="text-sm text-gray-600">{achievement.description}</p>
                      </div>
                    </div>
                    {isUnlocked && (
                      <p className="text-xs text-gray-500 mt-2">
                        解锁于 {new Date(achievement.unlockedAt!).toLocaleDateString('zh-CN')}
                      </p>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'progress' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">学习曲线</h3>
              <div className="flex space-x-2">
                <button
                  onClick={() => setChartPeriod('week')}
                  className={`px-3 py-1 rounded-md text-sm ${
                    chartPeriod === 'week'
                      ? 'bg-primary text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  本周
                </button>
                <button
                  onClick={() => setChartPeriod('month')}
                  className={`px-3 py-1 rounded-md text-sm ${
                    chartPeriod === 'month'
                      ? 'bg-primary text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  本月
                </button>
              </div>
            </div>
            <div className="h-64 flex items-end justify-between gap-2">
              {getChartData().values.map((value, index) => {
                const maxValue = Math.max(...getChartData().values, 1)
                const height = (value / maxValue) * 100
                return (
                  <div key={index} className="flex-1 flex flex-col items-center">
                    <div className="w-full bg-gray-100 rounded-t" style={{ height: `${height}%` }}>
                      <div className="w-full h-full bg-primary rounded-t opacity-80"></div>
                    </div>
                    <span className="text-xs text-gray-500 mt-2">
                      {getChartData().labels[index]}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg p-6 border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">阅读时间分布</h3>
              <div className="space-y-3">
                {stats.weeklyReadingData.slice(0, 5).map((data, index) => (
                  <div key={index} className="flex items-center gap-3">
                    <span className="text-sm text-gray-600 w-16">
                      {new Date(data.date).toLocaleDateString('zh-CN', { weekday: 'short' })}
                    </span>
                    <div className="flex-1 bg-gray-100 rounded-full h-2">
                      <div
                        className="bg-primary h-2 rounded-full"
                        style={{ width: `${Math.min((data.readingTime / 3600) * 100, 100)}%` }}
                      ></div>
                    </div>
                    <span className="text-sm text-gray-600 w-16 text-right">
                      {formatTime(data.readingTime)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="bg-white rounded-lg p-6 border border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">学习趋势</h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span className="text-green-500">📈</span>
                    <span className="text-sm font-medium text-green-800">本周学习时间</span>
                  </div>
                  <span className="text-sm font-bold text-green-800">
                    {formatTime(stats.weeklyReadingData.reduce((sum, d) => sum + d.readingTime, 0))}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-blue-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span className="text-blue-500">📚</span>
                    <span className="text-sm font-medium text-blue-800">本周新增笔记</span>
                  </div>
                  <span className="text-sm font-bold text-blue-800">
                    {stats.weeklyReadingData.reduce((sum, d) => sum + d.highlightsCount, 0)}
                  </span>
                </div>
                <div className="flex items-center justify-between p-3 bg-purple-50 rounded-lg">
                  <div className="flex items-center gap-2">
                    <span className="text-purple-500">🔄</span>
                    <span className="text-sm font-medium text-purple-800">本周复习次数</span>
                  </div>
                  <span className="text-sm font-bold text-purple-800">
                    {stats.weeklyReadingData.reduce((sum, d) => sum + d.reviewsCount, 0)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'report' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg p-6 border border-gray-200">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900">学习报告</h3>
              <div className="flex space-x-2">
                <button
                  onClick={() => setReportPeriod('week')}
                  className={`px-3 py-1 rounded-md text-sm ${
                    reportPeriod === 'week'
                      ? 'bg-primary text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  本周
                </button>
                <button
                  onClick={() => setReportPeriod('month')}
                  className={`px-3 py-1 rounded-md text-sm ${
                    reportPeriod === 'month'
                      ? 'bg-primary text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  本月
                </button>
                <button
                  onClick={() => setReportPeriod('year')}
                  className={`px-3 py-1 rounded-md text-sm ${
                    reportPeriod === 'year'
                      ? 'bg-primary text-white'
                      : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  本年
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <div className="bg-blue-50 rounded-lg p-4">
                <p className="text-sm text-blue-600">阅读时间</p>
                <p className="text-2xl font-bold text-blue-800">
                  {formatTime(stats.weeklyReadingData.reduce((sum, d) => sum + d.readingTime, 0))}
                </p>
              </div>
              <div className="bg-green-50 rounded-lg p-4">
                <p className="text-sm text-green-600">新增笔记</p>
                <p className="text-2xl font-bold text-green-800">
                  {stats.weeklyReadingData.reduce((sum, d) => sum + d.highlightsCount, 0)}
                </p>
              </div>
              <div className="bg-purple-50 rounded-lg p-4">
                <p className="text-sm text-purple-600">复习次数</p>
                <p className="text-2xl font-bold text-purple-800">
                  {stats.weeklyReadingData.reduce((sum, d) => sum + d.reviewsCount, 0)}
                </p>
              </div>
              <div className="bg-orange-50 rounded-lg p-4">
                <p className="text-sm text-orange-600">学习天数</p>
                <p className="text-2xl font-bold text-orange-800">
                  {stats.weeklyReadingData.filter(d => d.readingTime > 0).length}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <h4 className="font-medium text-gray-900">学习建议</h4>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {stats.currentStreak < 3 && (
                  <div className="p-4 bg-yellow-50 rounded-lg border border-yellow-200">
                    <p className="text-sm text-yellow-800">
                      💡 建议保持连续学习，当前连续学习 {stats.currentStreak} 天，尝试达到 3 天连续学习目标。
                    </p>
                  </div>
                )}
                {stats.averageDailyReadingTime < 1800 && (
                  <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
                    <p className="text-sm text-blue-800">
                      ⏰ 建议增加每日阅读时间，当前日均 {formatTime(stats.averageDailyReadingTime)}，尝试达到 30 分钟。
                    </p>
                  </div>
                )}
                {stats.totalHighlights < 50 && (
                  <div className="p-4 bg-green-50 rounded-lg border border-green-200">
                    <p className="text-sm text-green-800">
                      📝 建议多做笔记，当前共 {stats.totalHighlights} 条笔记，尝试达到 50 条。
                    </p>
                  </div>
                )}
                {stats.masteredCards < 20 && (
                  <div className="p-4 bg-purple-50 rounded-lg border border-purple-200">
                    <p className="text-sm text-purple-800">
                      🃏 建议坚持复习，当前掌握 {stats.masteredCards} 张卡片，尝试达到 20 张。
                    </p>
                  </div>
                )}
              </div>
            </div>


          </div>
        </div>
      )}
    </div>
  )
}
