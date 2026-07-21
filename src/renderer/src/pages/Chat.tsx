/**
 * Chat — AI 对话页（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/chat.html
 *
 * 三栏布局：240px sessions list + 1fr messages stream + 280px context panel
 *
 * 业务逻辑全部保留：
 *   - useChatStore: sessions / currentSessionId / messages / streaming / streamingContent
 *   - sendMessage / stopStreaming / createSession / switchSession / deleteSession
 *   - 4 个快捷操作（全书问答 / 费曼教学 / 深度提问 / 考考我）
 *   - Enter 发送 / Shift+Enter 换行
 *   - 自动滚动到底部 + error toast
 *   - 流式响应（onStreamChunk / onStreamComplete / onStreamError）
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import PageHero from '@/components/layout/PageHero'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { Loading, EmptyState, Tiny } from '@/components/ui/Feedback'
import { useChatStore } from '../stores/chatStore'
import { toast } from '../stores/toastStore'

// ===== 类型 =====
interface BookRow {
  id: string
  title: string
  author: string
  cover: string
  progress: number
  isFinished?: number
  is_finished?: number
}

interface HighlightRow {
  id: string
  bookId: string
  content: string
  chapterTitle?: string
  type?: string
}

// ===== 常量 =====

/** 4 个快捷操作（保留旧版业务逻辑） */
const QUICK_ACTIONS = [
  {
    key: 'summary',
    label: '全书问答',
    icon: 'bookshelf' as const,
    prompt: '请帮我总结这本书的核心观点和主要内容',
  },
  {
    key: 'feynman',
    label: '费曼教学',
    icon: 'message-circle' as const,
    prompt: '请用费曼学习法教我这本书中最核心的概念',
  },
  {
    key: 'deep',
    label: '深度提问',
    icon: 'question' as const,
    prompt: '请对我正在读的内容提出一些深度思考问题',
  },
  {
    key: 'quiz',
    label: '考考我',
    icon: 'check' as const,
    prompt: '请考考我对这本书内容的理解程度',
  },
]

/** 时间相对显示（"2 小时前 / 昨天 / 3 天前 / 上周"） */
function formatRelativeTime(iso: string): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const diff = Date.now() - then
  const min = Math.floor(diff / 60000)
  if (min < 60) return `${min || 1} 分钟前`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr} 小时前`
  const day = Math.floor(hr / 24)
  if (day === 1) return '昨天'
  if (day < 7) return `${day} 天前`
  if (day < 14) return '上周'
  return `${Math.floor(day / 7)} 周前`
}

/** 截断会话标题用于左侧列表展示 */
function truncate(s: string, n: number): string {
  if (!s) return ''
  return s.length > n ? s.slice(0, n) + '…' : s
}

// ===== 主组件 =====
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
    stopStreaming,
    setCurrentBook,
    clearError,
  } = useChatStore()

  const [input, setInput] = useState('')
  const [books, setBooks] = useState<BookRow[]>([])
  const [highlights, setHighlights] = useState<HighlightRow[]>([])
  const [loadingContext, setLoadingContext] = useState(true)

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  // ===== 初次加载：会话列表 + 书籍/笔记上下文 =====
  useEffect(() => {
    loadSessions()
    loadContextData()
  }, [loadSessions])

  // ===== 当切换关联书籍时，刷新该书的笔记 =====
  useEffect(() => {
    if (!currentBookId) {
      setHighlights([])
      return
    }
    let cancelled = false
    window.electronAPI?.highlight
      ?.getByBook(currentBookId)
      .then((res) => {
        if (cancelled) return
        const list = (res && Array.isArray(res) ? res : []) as unknown as HighlightRow[]
        setHighlights(list.map((h) => ({
          id: String(h.id ?? ''),
          bookId: String(h.bookId ?? ''),
          content: String(h.content ?? ''),
          chapterTitle: h.chapterTitle ? String(h.chapterTitle) : undefined,
          type: h.type ? String(h.type) : undefined,
        })))
      })
      .catch((err) => {
        console.warn('加载书籍笔记失败:', err)
        if (!cancelled) setHighlights([])
      })
    return () => {
      cancelled = true
    }
  }, [currentBookId])

  // ===== 自动滚动到底部 =====
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, streamingContent])

  // ===== error toast =====
  useEffect(() => {
    if (error) {
      toast.error(error)
      clearError()
    }
  }, [error, clearError])

  const loadContextData = async () => {
    if (!window.electronAPI?.book) {
      setLoadingContext(false)
      return
    }
    try {
      const raw = (await window.electronAPI.book.getAll()) as unknown as BookRow[]
      const list = (raw || []).map((b) => ({
        id: String(b.id ?? ''),
        title: String(b.title ?? ''),
        author: String(b.author ?? ''),
        cover: String(b.cover ?? ''),
        progress: Number(b.progress ?? 0),
        isFinished: b.isFinished ?? b.is_finished,
      }))
      setBooks(list)
    } catch (err) {
      console.warn('加载书籍列表失败:', err)
    } finally {
      setLoadingContext(false)
    }
  }

  // ===== 发送消息 =====
  const handleSend = useCallback(async () => {
    if (!input.trim() || loading || streaming) return
    const question = input.trim()
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = '44px'
    await sendMessage(question)
  }, [input, loading, streaming, sendMessage])

  const handleKeyPress = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleQuickAction = (prompt: string) => {
    if (loading || streaming) return
    sendMessage(prompt)
  }

  const handleNewChat = () => {
    createSession(currentBookId || undefined)
  }

  const handleClearHistory = () => {
    if (sessions.length === 0) {
      toast.info('当前没有可清空的会话')
      return
    }
    // 逐个删除（保留 store 行为一致性）
    Promise.all(sessions.map((s) => deleteSession(s.id)))
      .then(() => toast.success('已清空全部对话历史'))
      .catch((err) => toast.error(`清空失败: ${err instanceof Error ? err.message : String(err)}`))
  }

  const handleDeleteSession = async (id: string) => {
    await deleteSession(id)
    toast.info('对话已删除')
  }

  const handleCopyMessage = (content: string) => {
    navigator.clipboard
      ?.writeText(content)
      .then(() => toast.success('已复制到剪贴板'))
      .catch(() => toast.error('复制失败'))
  }

  // ===== 派生数据 =====
  const currentSession = sessions.find((s) => s.id === currentSessionId)
  const currentBook = books.find((b) => b.id === currentBookId) || null
  const bookProgressPct = currentBook
    ? Math.round(Number(currentBook.progress ?? 0) * 100)
    : 0
  const bookHighlights = highlights.filter((h) => h.bookId === currentBookId)

  const inputDisabled = loading || streaming

  return (
    <>
      <PageHero
        title="AI 对话"
        subtitle="基于你的书库与笔记，与 AI 深度探讨"
        actions={
          <>
            <Button variant="primary" onClick={handleNewChat} data-dom-id="cta-new-chat">
              <Icon name="plus" size={16} /> 新建会话
            </Button>
            <Button variant="ghost" onClick={handleClearHistory} data-dom-id="cta-clear">
              <Icon name="trash" size={16} /> 清空历史
            </Button>
          </>
        }
      >
        {/* ===== 三栏对话工作台 ===== */}
        <div
          className="page-body chat-workspace"
          style={{
            display: 'grid',
            gridTemplateColumns: '240px 1fr 280px',
            gap: 'calc(var(--spacing) * 4)',
            minHeight: 'calc(100vh - 76px - 220px)',
            overflow: 'hidden',
          }}
        >
          {/* ============ 左栏：会话列表 ============ */}
          <aside
            className="chat-sessions"
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'calc(var(--radius) + 4px)',
              background: 'var(--card)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              minHeight: 0,
            }}
          >
            <div
              className="sessions-head"
              style={{
                padding: 'calc(var(--spacing) * 4)',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span
                className="eyebrow"
                style={{
                  fontSize: '0.78rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--muted-foreground)',
                  fontWeight: 600,
                }}
              >
                会话
              </span>
              <IconButtonSmall label="新建会话" onClick={handleNewChat}>
                <Icon name="plus" size={14} />
              </IconButtonSmall>
            </div>
            <div
              className="sessions-list"
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 'calc(var(--spacing) * 2)',
                minHeight: 0,
              }}
            >
              {sessions.length === 0 ? (
                <div
                  style={{
                    padding: 'calc(var(--spacing) * 4)',
                    textAlign: 'center',
                    color: 'var(--muted-foreground)',
                    fontSize: '0.85rem',
                  }}
                >
                  暂无会话
                  <br />
                  点击右上角 + 新建
                </div>
              ) : (
                sessions.map((s) => {
                  const active = s.id === currentSessionId
                  return (
                    <div
                      key={s.id}
                      style={{
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'stretch',
                      }}
                    >
                      <button
                        type="button"
                        data-active={active ? 'true' : undefined}
                        onClick={() => switchSession(s.id)}
                        style={{
                          flex: 1,
                          width: '100%',
                          padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                          textAlign: 'left',
                          border: 'none',
                          background: active ? 'var(--sidebar-accent)' : 'transparent',
                          color: 'var(--foreground)',
                          borderRadius: 'var(--radius)',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '0.3rem',
                          transition: 'background 0.2s ease',
                          font: 'inherit',
                        }}
                        onMouseEnter={(e) => {
                          if (!active) e.currentTarget.style.background = 'var(--sidebar-accent)'
                        }}
                        onMouseLeave={(e) => {
                          if (!active) e.currentTarget.style.background = 'transparent'
                        }}
                      >
                        <span
                          style={{
                            fontSize: '0.88rem',
                            fontWeight: 500,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            color: active ? 'var(--sidebar-accent-foreground)' : 'inherit',
                          }}
                        >
                          {truncate(s.title || '新对话', 18)}
                        </span>
                        <span
                          style={{
                            fontSize: '0.72rem',
                            color: 'var(--muted-foreground)',
                            fontFamily: 'var(--font-mono)',
                          }}
                        >
                          {formatRelativeTime(s.updatedAt || s.createdAt)}
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label="删除会话"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleDeleteSession(s.id)
                        }}
                        style={{
                          position: 'absolute',
                          top: 'calc(var(--spacing) * 2)',
                          right: 'calc(var(--spacing) * 2)',
                          width: 20,
                          height: 20,
                          display: 'grid',
                          placeItems: 'center',
                          border: 'none',
                          background: 'transparent',
                          color: 'var(--muted-foreground)',
                          cursor: 'pointer',
                          borderRadius: 4,
                          opacity: 0.4,
                          transition: 'opacity 0.2s ease, color 0.2s ease',
                          padding: 0,
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.opacity = '1'
                          e.currentTarget.style.color = 'var(--state-error)'
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.opacity = '0.4'
                          e.currentTarget.style.color = 'var(--muted-foreground)'
                        }}
                      >
                        <Icon name="close" size={12} />
                      </button>
                    </div>
                  )
                })
              )}
            </div>
          </aside>

          {/* ============ 中栏：消息流 ============ */}
          <section
            className="chat-messages"
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'calc(var(--radius) + 4px)',
              background: 'var(--card)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              minHeight: 0,
            }}
          >
            <div
              className="messages-head"
              style={{
                padding: 'calc(var(--spacing) * 4) calc(var(--spacing) * 5)',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                gap: 'calc(var(--spacing) * 2)',
                flexWrap: 'wrap',
              }}
            >
              <strong style={{ fontSize: '0.95rem', color: 'var(--foreground)' }}>
                {currentSession?.title || 'AI 阅读助手'}
              </strong>
              <span
                className="tiny"
                style={{
                  fontSize: '0.72rem',
                  color: 'var(--muted-foreground)',
                }}
              >
                {messages.length} 条消息 · 智能对话
              </span>
              {currentBook && (
                <Badge variant="ok" style={{ marginLeft: 'auto' }}>
                  <Icon name="bookshelf" size={12} /> {currentBook.title}
                </Badge>
              )}
            </div>

            {/* 消息流 */}
            <div
              className="messages-stream"
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 'calc(var(--spacing) * 5)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'calc(var(--spacing) * 5)',
                minHeight: 0,
              }}
            >
              {messages.length === 0 && !streaming && !loading ? (
                <EmptyState
                  icon={<Icon name="chat" size={24} />}
                  title="你好！我是 AI 阅读助手"
                  description="我可以帮你理解书籍内容、进行费曼教学、深度提问、跨书关联"
                  style={{ padding: 'calc(var(--spacing) * 6)' }}
                />
              ) : (
                <>
                  {messages.map((message, idx) => (
                    <MessageBubble
                      key={message.id || idx}
                      role={message.role}
                      content={message.content}
                      onCopy={() => handleCopyMessage(message.content)}
                    />
                  ))}
                  {streaming && streamingContent && (
                    <MessageBubble
                      role="assistant"
                      content={streamingContent}
                      isStreaming
                      onCopy={() => handleCopyMessage(streamingContent)}
                    />
                  )}
                  {loading && !streaming && <TypingDots />}
                </>
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* 输入区 */}
            <div
              className="messages-input"
              style={{
                padding: 'calc(var(--spacing) * 4)',
                borderTop: '1px solid var(--border)',
                display: 'flex',
                gap: 'calc(var(--spacing) * 3)',
                alignItems: 'flex-end',
              }}
            >
              <div
                className="input-area"
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'calc(var(--spacing) * 2)',
                }}
              >
                <textarea
                  ref={textareaRef}
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value)
                    // 自适应高度
                    e.target.style.height = '44px'
                    e.target.style.height = Math.min(120, e.target.scrollHeight) + 'px'
                  }}
                  onKeyPress={handleKeyPress}
                  placeholder="输入消息，Enter 发送，Shift+Enter 换行..."
                  rows={1}
                  disabled={inputDisabled}
                  style={{
                    width: '100%',
                    minHeight: 44,
                    maxHeight: 120,
                    resize: 'none',
                    padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                    border: '1px solid var(--input)',
                    borderRadius: 'calc(var(--radius) + 4px)',
                    background: 'var(--popover)',
                    color: 'var(--foreground)',
                    fontFamily: 'var(--font-sans)',
                    fontSize: '0.92rem',
                    outline: 'none',
                    transition: 'border-color 0.2s ease',
                    font: 'inherit',
                  }}
                  onFocus={(e) => {
                    e.currentTarget.style.borderColor = 'var(--ring)'
                  }}
                  onBlur={(e) => {
                    e.currentTarget.style.borderColor = 'var(--input)'
                  }}
                />
                <div
                  className="input-tools"
                  style={{
                    display: 'flex',
                    gap: 'calc(var(--spacing) * 2)',
                    flexWrap: 'wrap',
                  }}
                >
                  {/* 4 个快捷操作 chip */}
                  {QUICK_ACTIONS.map((qa) => (
                    <button
                      key={qa.key}
                      type="button"
                      onClick={() => handleQuickAction(qa.prompt)}
                      disabled={inputDisabled}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '0.3rem',
                        padding: '0.34rem 0.65rem',
                        borderRadius: 999,
                        background: 'var(--secondary)',
                        color: 'var(--secondary-foreground)',
                        fontSize: '0.78rem',
                        border: 'none',
                        cursor: inputDisabled ? 'not-allowed' : 'pointer',
                        transition: 'background 0.2s ease',
                        whiteSpace: 'nowrap',
                        opacity: inputDisabled ? 0.5 : 1,
                        font: 'inherit',
                      }}
                      onMouseEnter={(e) => {
                        if (!inputDisabled) e.currentTarget.style.background = 'var(--sidebar-accent)'
                      }}
                      onMouseLeave={(e) => {
                        if (!inputDisabled) e.currentTarget.style.background = 'var(--secondary)'
                      }}
                    >
                      <Icon name={qa.icon} size={12} />
                      {qa.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* 发送按钮 / 停止按钮 */}
              {streaming || loading ? (
                <Button
                  variant="danger"
                  onClick={() => stopStreaming()}
                  data-dom-id="cta-stop"
                >
                  <Icon name="pause" size={16} /> 停止
                </Button>
              ) : (
                <Button
                  variant="primary"
                  onClick={handleSend}
                  disabled={!input.trim()}
                  data-dom-id="cta-send"
                >
                  <Icon name="send" size={16} /> 发送
                </Button>
              )}
            </div>
          </section>

          {/* ============ 右栏：上下文面板 ============ */}
          <aside
            className="chat-context"
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'calc(var(--radius) + 4px)',
              background: 'var(--card)',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
              minHeight: 0,
            }}
          >
            <div
              className="context-head"
              style={{
                padding: 'calc(var(--spacing) * 4)',
                borderBottom: '1px solid var(--border)',
              }}
            >
              <span
                className="eyebrow"
                style={{
                  fontSize: '0.78rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--muted-foreground)',
                  fontWeight: 600,
                }}
              >
                上下文
              </span>
              <strong
                style={{
                  display: 'block',
                  marginTop: 'calc(var(--spacing) * 1)',
                  fontSize: '0.92rem',
                  color: 'var(--foreground)',
                }}
              >
                关联书籍
              </strong>
            </div>
            <div
              className="context-body"
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 'calc(var(--spacing) * 3)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'calc(var(--spacing) * 3)',
                minHeight: 0,
              }}
            >
              {loadingContext ? (
                <Loading hint="加载上下文..." />
              ) : currentBook ? (
                <>
                  {/* 关联书籍卡片 */}
                  <div
                    className="context-book"
                    style={{
                      padding: 'calc(var(--spacing) * 3)',
                      border: '1px solid var(--border)',
                      borderRadius: 'var(--radius)',
                      background: 'var(--background)',
                    }}
                  >
                    <div
                      className="book-cover-mini"
                      style={{
                        width: '100%',
                        aspectRatio: '3 / 4',
                        borderRadius: 'var(--radius)',
                        background: currentBook.cover
                          ? `url(${currentBook.cover}) center/cover`
                          : 'var(--chart-1)',
                        display: 'grid',
                        placeItems: 'center',
                        color: 'var(--primary-foreground)',
                        fontWeight: 700,
                        marginBottom: 'calc(var(--spacing) * 3)',
                        fontSize: '0.95rem',
                        textAlign: 'center',
                        padding: 'calc(var(--spacing) * 2)',
                        overflow: 'hidden',
                      }}
                    >
                      {!currentBook.cover && currentBook.title}
                    </div>
                    <div
                      className="book-title-mini"
                      style={{
                        fontSize: '0.88rem',
                        fontWeight: 600,
                        color: 'var(--foreground)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {currentBook.title}
                    </div>
                    <div
                      className="book-author-mini"
                      style={{
                        fontSize: '0.72rem',
                        color: 'var(--muted-foreground)',
                        marginTop: '0.2rem',
                      }}
                    >
                      {currentBook.author || '未知作者'}
                    </div>
                    <div
                      className="book-progress-mini"
                      style={{ marginTop: 'calc(var(--spacing) * 2)' }}
                    >
                      <div
                        className="progress-track"
                        style={{
                          height: 4,
                          background: 'var(--muted)',
                          borderRadius: 2,
                          overflow: 'hidden',
                        }}
                      >
                        <div
                          className="progress-fill"
                          style={{
                            height: '100%',
                            width: `${bookProgressPct}%`,
                            background: 'var(--primary)',
                            borderRadius: 2,
                            transition: 'width 0.3s ease',
                          }}
                        />
                      </div>
                      <span
                        className="progress-text"
                        style={{
                          fontSize: '0.72rem',
                          color: 'var(--muted-foreground)',
                          fontFamily: 'var(--font-mono)',
                          marginTop: 'calc(var(--spacing) * 1)',
                          display: 'block',
                        }}
                      >
                        {bookProgressPct}%
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setCurrentBook(null)}
                      style={{
                        width: '100%',
                        marginTop: 'calc(var(--spacing) * 3)',
                        padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 3)',
                        fontSize: '0.78rem',
                        color: 'var(--muted-foreground)',
                        background: 'transparent',
                        border: '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        cursor: 'pointer',
                        transition: 'color 0.2s ease, border-color 0.2s ease',
                        font: 'inherit',
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.color = 'var(--state-error)'
                        e.currentTarget.style.borderColor = 'var(--state-error)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.color = 'var(--muted-foreground)'
                        e.currentTarget.style.borderColor = 'var(--border)'
                      }}
                    >
                      取消关联
                    </button>
                  </div>

                  {/* 引用笔记 */}
                  <div className="context-section">
                    <div
                      className="context-label"
                      style={{
                        fontSize: '0.78rem',
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        color: 'var(--muted-foreground)',
                        fontWeight: 600,
                      }}
                    >
                      引用笔记 ({bookHighlights.length})
                    </div>
                    <div
                      className="context-list"
                      style={{
                        marginTop: 'calc(var(--spacing) * 2)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'calc(var(--spacing) * 2)',
                      }}
                    >
                      {bookHighlights.length === 0 ? (
                        <Tiny>这本书暂无笔记</Tiny>
                      ) : (
                        bookHighlights.slice(0, 5).map((h) => (
                          <div
                            key={h.id}
                            className="context-note"
                            style={{
                              padding: 'calc(var(--spacing) * 2.5)',
                              border: '1px solid var(--border)',
                              borderRadius: 'var(--radius)',
                              fontSize: '0.78rem',
                              lineHeight: 1.5,
                              color: 'var(--card-foreground)',
                              cursor: 'pointer',
                              transition: 'border-color 0.2s ease',
                              background: 'var(--background)',
                              overflow: 'hidden',
                              display: '-webkit-box',
                              WebkitLineClamp: 3,
                              WebkitBoxOrient: 'vertical',
                            }}
                            onMouseEnter={(e) => {
                              e.currentTarget.style.borderColor = 'var(--ring)'
                            }}
                            onMouseLeave={(e) => {
                              e.currentTarget.style.borderColor = 'var(--border)'
                            }}
                            title={h.content}
                          >
                            {h.content}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <EmptyState
                    icon={<Icon name="bookshelf" size={24} />}
                    title="未关联书籍"
                    description="选择一本书以提供 AI 上下文"
                  />
                  {/* 书籍选择列表 */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 'calc(var(--spacing) * 2)',
                    }}
                  >
                    {books.slice(0, 8).map((b) => (
                      <button
                        key={b.id}
                        type="button"
                        onClick={() => setCurrentBook(b.id)}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 'calc(var(--spacing) * 3)',
                          padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 3)',
                          border: '1px solid var(--border)',
                          borderRadius: 'var(--radius)',
                          background: 'var(--background)',
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
                        <div
                          style={{
                            width: 28,
                            height: 36,
                            borderRadius: 4,
                            background: b.cover
                              ? `url(${b.cover}) center/cover`
                              : 'var(--chart-1)',
                            flexShrink: 0,
                            display: b.cover ? 'block' : 'grid',
                            placeItems: 'center',
                            color: 'var(--primary-foreground)',
                            fontSize: '0.55rem',
                            fontWeight: 700,
                            overflow: 'hidden',
                          }}
                        >
                          {!b.cover && b.title.slice(0, 2)}
                        </div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div
                            style={{
                              fontSize: '0.82rem',
                              fontWeight: 600,
                              color: 'var(--foreground)',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {b.title}
                          </div>
                          <Tiny>{b.author || '未知作者'}</Tiny>
                        </div>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          </aside>
        </div>
      </PageHero>
    </>
  )
}

// ===== 子组件：小型图标按钮 =====
function IconButtonSmall({
  children,
  label,
  onClick,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        display: 'grid',
        placeItems: 'center',
        border: '1px solid var(--border)',
        background: 'var(--card)',
        color: 'var(--foreground)',
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
        flexShrink: 0,
        padding: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--sidebar-accent)'
        e.currentTarget.style.color = 'var(--sidebar-accent-foreground)'
        e.currentTarget.style.borderColor = 'var(--sidebar-border)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'var(--card)'
        e.currentTarget.style.color = 'var(--foreground)'
        e.currentTarget.style.borderColor = 'var(--border)'
      }}
    >
      {children}
    </button>
  )
}

// ===== 子组件：消息气泡 =====
interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system'
  content: string
  isStreaming?: boolean
  onCopy: () => void
}

function MessageBubble({ role, content, isStreaming, onCopy }: MessageBubbleProps) {
  const isUser = role === 'user'
  return (
    <div
      className={`msg ${isUser ? 'user' : 'assistant'}${isStreaming ? ' streaming' : ''}`}
      style={{
        display: 'flex',
        gap: 'calc(var(--spacing) * 3)',
        justifyContent: isUser ? 'flex-end' : 'flex-start',
        alignItems: isUser ? 'flex-end' : 'flex-start',
      }}
    >
      {!isUser && (
        <div
          className="msg-avatar"
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            background: 'var(--secondary)',
            color: 'var(--secondary-foreground)',
            display: 'grid',
            placeItems: 'center',
            fontWeight: 700,
            fontSize: '0.82rem',
            flexShrink: 0,
          }}
        >
          AI
        </div>
      )}
      <div
        className="msg-content"
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 'calc(var(--spacing) * 2)',
          alignItems: isUser ? 'flex-end' : 'flex-start',
          minWidth: 0,
        }}
      >
        <div
          className="msg-bubble"
          style={{
            padding: 'calc(var(--spacing) * 3.5) calc(var(--spacing) * 4)',
            borderRadius: 'calc(var(--radius) + 4px)',
            fontSize: '0.92rem',
            lineHeight: 1.6,
            maxWidth: isUser ? '70%' : '90%',
            background: isUser ? 'var(--primary)' : 'var(--background)',
            color: isUser ? 'var(--primary-foreground)' : 'var(--card-foreground)',
            border: isUser ? 'none' : '1px solid var(--border)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
          }}
        >
          {content || (isStreaming ? <TypingDots inline /> : '')}
        </div>
        {!isUser && !isStreaming && content && (
          <div
            className="msg-actions"
            style={{ display: 'flex', gap: 'calc(var(--spacing) * 2)' }}
          >
            <IconButtonSmall label="复制" onClick={onCopy}>
              <Icon name="file" size={14} />
            </IconButtonSmall>
            <IconButtonSmall label="点赞" onClick={() => toast.info('感谢反馈')}>
              <Icon name="thumbs-up" size={14} />
            </IconButtonSmall>
            <IconButtonSmall label="收藏" onClick={() => toast.info('已收藏')}>
              <Icon name="star" size={14} />
            </IconButtonSmall>
          </div>
        )}
      </div>
    </div>
  )
}

// ===== 子组件：打字动画 =====
function TypingDots({ inline = false }: { inline?: boolean }) {
  const wrapperStyle: React.CSSProperties = inline
    ? {
        display: 'inline-flex',
        gap: 4,
        alignItems: 'center',
        padding: 'calc(var(--spacing) * 1)',
      }
    : {
        display: 'inline-flex',
        gap: 4,
        alignItems: 'center',
        padding: 'calc(var(--spacing) * 2)',
      }
  return (
    <div className="typing-dots" style={wrapperStyle} aria-label="AI 正在思考">
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: 'var(--muted-foreground)',
          animation: 'typing-blink 1.4s infinite',
        }}
      />
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: 'var(--muted-foreground)',
          animation: 'typing-blink 1.4s infinite',
          animationDelay: '0.2s',
        }}
      />
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: 'var(--muted-foreground)',
          animation: 'typing-blink 1.4s infinite',
          animationDelay: '0.4s',
        }}
      />
      <style>{`@keyframes typing-blink { 0%, 60%, 100% { opacity: 0.3; } 30% { opacity: 1; } }`}</style>
    </div>
  )
}
