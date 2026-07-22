import { useState, useEffect } from 'react'

interface Session {
  id: string
  title: string
  created_at: string
  updated_at: string
  message_count: number
  book_title?: string
}

interface Message {
  id: string
  role: string
  content: string
  created_at: string
}

export default function SessionHistory() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [searchQuery, setSearchQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [messagesLoading, setMessagesLoading] = useState(false)

  useEffect(() => {
    loadSessions()
  }, [])

  const loadSessions = async () => {
    try {
      const result = await (window as any).electronAPI.admin.getSessions()
      setSessions(Array.isArray(result) ? result : [])
    } catch (err) {
      console.error('加载会话失败:', err)
    } finally {
      setLoading(false)
    }
  }

  const handleSelectSession = async (sessionId: string) => {
    if (selectedSession === sessionId) {
      setSelectedSession(null)
      return
    }
    setSelectedSession(sessionId)
    setMessagesLoading(true)
    try {
      const result = await (window as any).electronAPI.admin.getSessionMessages(
        sessionId
      )
      setMessages(Array.isArray(result) ? result : [])
    } catch (err) {
      console.error('加载消息失败:', err)
    } finally {
      setMessagesLoading(false)
    }
  }

  const filteredSessions = searchQuery
    ? sessions.filter((s) =>
        s.title.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : sessions

  if (loading) {
    return (
      <div className="text-gray-400 text-sm text-center py-20">加载中...</div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <svg
          className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="搜索会话..."
          className="w-full pl-9 pr-4 py-2 text-[13px] bg-white border border-gray-200 rounded-xl focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 transition-all"
        />
      </div>

      <div className="space-y-2">
        {filteredSessions.map((session) => (
          <div
            key={session.id}
            className="bg-white rounded-xl border border-gray-100 overflow-hidden"
          >
            <button
              onClick={() => handleSelectSession(session.id)}
              className="w-full flex items-center justify-between p-3 hover:bg-gray-50 transition-colors text-left"
            >
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium text-gray-800 truncate">
                  {session.title}
                </p>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {session.book_title ? `${session.book_title} · ` : ''}
                  {session.message_count} 条消息 ·{' '}
                  {new Date(session.created_at).toLocaleString('zh-CN')}
                </p>
              </div>
              <svg
                className={`w-4 h-4 text-gray-300 transition-transform flex-shrink-0 ml-3 ${selectedSession === session.id ? 'rotate-90' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>

            {selectedSession === session.id && (
              <div className="border-t border-gray-100 p-3">
                {messagesLoading ? (
                  <div className="text-gray-400 text-[12px] text-center py-4">
                    加载中...
                  </div>
                ) : (
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[80%] px-3 py-2 rounded-lg text-[12px] leading-relaxed ${
                            msg.role === 'user'
                              ? 'bg-emerald-600 text-white rounded-br-sm'
                              : 'bg-gray-100 text-gray-700 rounded-bl-sm'
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">
                            {msg.content}
                          </p>
                          <p
                            className={`text-[10px] mt-1 ${
                              msg.role === 'user'
                                ? 'text-emerald-200'
                                : 'text-gray-300'
                            }`}
                          >
                            {new Date(msg.created_at).toLocaleTimeString(
                              'zh-CN'
                            )}
                          </p>
                        </div>
                      </div>
                    ))}
                    {messages.length === 0 && (
                      <p className="text-[12px] text-gray-400 text-center py-2">
                        暂无消息
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {filteredSessions.length === 0 && (
          <div className="text-gray-400 text-[13px] text-center py-10">
            {searchQuery ? '没有匹配的会话' : '暂无会话记录'}
          </div>
        )}
      </div>
    </div>
  )
}
