import { useState } from 'react'

interface Session {
  id: string
  title: string
  bookId?: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

interface SessionListProps {
  sessions: Session[]
  currentSessionId: string | null
  onSelect: (id: string) => void
  onCreate: () => void
  onDelete: (id: string) => void
}

export default function SessionList({ sessions, currentSessionId, onSelect, onCreate, onDelete }: SessionListProps) {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredSessions = searchQuery
    ? sessions.filter(s => s.title.toLowerCase().includes(searchQuery.toLowerCase()))
    : sessions

  const formatTime = (dateStr: string) => {
    const date = new Date(dateStr)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMs / 3600000)
    const diffDays = Math.floor(diffMs / 86400000)

    if (diffMins < 1) return '刚刚'
    if (diffMins < 60) return `${diffMins}分钟前`
    if (diffHours < 24) return `${diffHours}小时前`
    if (diffDays < 7) return `${diffDays}天前`
    return date.toLocaleDateString('zh-CN')
  }

  return (
    <div className="w-64 border-r border-gray-200 flex flex-col bg-gray-50">
      <div className="p-3 border-b border-gray-200">
        <button
          onClick={onCreate}
          className="w-full px-3 py-2 bg-primary text-white rounded-lg hover:bg-primary-hover transition-all duration-200 text-sm font-medium flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          新对话
        </button>
      </div>

      <div className="p-3 border-b border-gray-200">
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="搜索对话..."
          className="w-full px-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:ring-1 focus:ring-primary focus:border-transparent"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        {filteredSessions.length === 0 ? (
          <div className="p-4 text-center text-gray-400 text-sm">
            {searchQuery ? '没有找到匹配的对话' : '还没有对话'}
          </div>
        ) : (
          filteredSessions.map(session => (
            <div
              key={session.id}
              onClick={() => onSelect(session.id)}
              className={`px-3 py-2.5 cursor-pointer border-b border-gray-100 transition-all duration-150 group ${
                currentSessionId === session.id
                  ? 'bg-primary/5 border-l-2 border-l-primary'
                  : 'hover:bg-gray-100'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium truncate ${
                    currentSessionId === session.id ? 'text-primary' : 'text-gray-800'
                  }`}>
                    {session.title}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {formatTime(session.updatedAt || session.createdAt)} · {session.messageCount}条消息
                  </p>
                </div>
                <button
                  onClick={e => { e.stopPropagation(); onDelete(session.id) }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-all"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
