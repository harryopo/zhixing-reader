import { useState, useRef, useEffect } from 'react'
import { useChatStore } from '../stores/chatStore'
import { toast } from '../stores/toastStore'
import MessageBubble from '../components/chat/MessageBubble'
import SessionList from '../components/chat/SessionList'
import ContextPanel from '../components/chat/ContextPanel'
import QuickActions from '../components/chat/QuickActions'

export default function Chat() {
  const {
    sessions,
    currentSessionId,
    messages,
    loading,
    streaming,
    streamingContent,
    error,
    currentBookId,
    loadSessions,
    createSession,
    switchSession,
    deleteSession,
    sendMessage,
    setCurrentBook,
    clearError,
  } = useChatStore()

  const [input, setInput] = useState('')
  const [showSessionList, setShowSessionList] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadSessions()
  }, [loadSessions])

  useEffect(() => {
    scrollToBottom()
  }, [messages, streamingContent])

  useEffect(() => {
    if (error) {
      toast.error(error)
      clearError()
    }
  }, [error, clearError])

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleSend = async () => {
    if (!input.trim() || loading || streaming) return
    const question = input.trim()
    setInput('')
    await sendMessage(question)
  }

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleQuickAction = (prompt: string) => {
    if (loading || streaming) return
    setInput('')
    sendMessage(prompt)
  }

  const handleDeleteSession = async (id: string) => {
    await deleteSession(id)
    toast.info('对话已删除')
  }

  return (
    <div className="h-full flex bg-gray-50">
      {showSessionList && (
        <SessionList
          sessions={sessions}
          currentSessionId={currentSessionId}
          onSelect={switchSession}
          onCreate={() => createSession(currentBookId || undefined)}
          onDelete={handleDeleteSession}
        />
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 bg-white/80 backdrop-blur-sm sticky top-0 z-10">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSessionList(!showSessionList)}
              className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
              title={showSessionList ? '收起会话列表' : '展开会话列表'}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
            <div>
              <h1 className="text-sm font-semibold text-gray-800">AI 阅读助手</h1>
              <p className="text-[11px] text-gray-400">智能对话 · 费曼教学 · 深度提问</p>
            </div>
          </div>
          {currentBookId && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-medium">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
              </svg>
              已关联书籍
            </div>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="max-w-3xl mx-auto px-5 py-6">
            {messages.length === 0 && !streaming ? (
              <div className="flex flex-col items-center justify-center h-full text-center py-20">
                <div className="w-14 h-14 bg-gradient-to-br from-violet-500 to-indigo-600 rounded-2xl flex items-center justify-center mb-5 shadow-lg shadow-indigo-200">
                  <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <h2 className="text-lg font-semibold text-gray-800 mb-2">你好！我是AI阅读助手</h2>
                <p className="text-gray-400 text-sm max-w-sm mb-8 leading-relaxed">
                  我可以帮你理解书籍内容、进行费曼教学、深度提问、跨书关联
                </p>
                <div className="grid grid-cols-2 gap-3 w-full max-w-md">
                  <button
                    onClick={() => handleQuickAction('请帮我总结这本书的核心观点和主要内容')}
                    className="flex items-center gap-2.5 px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:border-indigo-300 hover:bg-indigo-50/50 transition-all duration-200 shadow-sm"
                  >
                    <svg className="w-4 h-4 text-indigo-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                    </svg>
                    <span className="font-medium">全书问答</span>
                  </button>
                  <button
                    onClick={() => handleQuickAction('请用费曼学习法教我这本书中最核心的概念')}
                    className="flex items-center gap-2.5 px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:border-violet-300 hover:bg-violet-50/50 transition-all duration-200 shadow-sm"
                  >
                    <svg className="w-4 h-4 text-violet-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                    </svg>
                    <span className="font-medium">费曼教学</span>
                  </button>
                  <button
                    onClick={() => handleQuickAction('请对我正在读的内容提出一些深度思考问题')}
                    className="flex items-center gap-2.5 px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:border-amber-300 hover:bg-amber-50/50 transition-all duration-200 shadow-sm"
                  >
                    <svg className="w-4 h-4 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <span className="font-medium">深度提问</span>
                  </button>
                  <button
                    onClick={() => handleQuickAction('请考考我对这本书内容的理解程度')}
                    className="flex items-center gap-2.5 px-4 py-3 bg-white border border-gray-200 rounded-xl text-sm text-gray-700 hover:border-emerald-300 hover:bg-emerald-50/50 transition-all duration-200 shadow-sm"
                  >
                    <svg className="w-4 h-4 text-emerald-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="font-medium">考考我</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                {messages.map((message, index) => (
                  <MessageBubble
                    key={message.id || index}
                    role={message.role}
                    content={message.content}
                    sources={message.sources}
                  />
                ))}
                {streaming && streamingContent && (
                  <MessageBubble
                    role="assistant"
                    content={streamingContent}
                    isStreaming={true}
                  />
                )}
                {loading && !streaming && (
                  <div className="flex items-start gap-3">
                    <div className="flex-shrink-0 w-7 h-7 rounded-full bg-gradient-to-br from-violet-500 to-indigo-600 flex items-center justify-center shadow-sm">
                      <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                    </div>
                    <div className="flex items-center gap-2 px-4 py-2.5 bg-white rounded-xl shadow-sm border border-gray-100">
                      <div className="flex gap-1">
                        <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                        <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                        <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                      </div>
                      <span className="text-gray-400 text-xs">正在思考</span>
                    </div>
                  </div>
                )}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        <div className="border-t border-gray-100 bg-white/80 backdrop-blur-sm">
          <div className="max-w-3xl mx-auto px-5 py-3">
            <QuickActions onAction={handleQuickAction} disabled={loading || streaming} />
            <div className="flex gap-2 mt-2 items-end">
              <div className="flex-1 relative">
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder="输入你的问题..."
                  className="w-full px-4 py-2.5 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-400 resize-none transition-all text-[13px] leading-relaxed placeholder-gray-400"
                  rows={1}
                  disabled={loading || streaming}
                />
              </div>
              <button
                onClick={handleSend}
                disabled={!input.trim() || loading || streaming}
                className="flex-shrink-0 w-9 h-9 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200 flex items-center justify-center shadow-sm shadow-indigo-200"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

      <ContextPanel
        currentBookId={currentBookId}
        onBookSelect={setCurrentBook}
      />
    </div>
  )
}
