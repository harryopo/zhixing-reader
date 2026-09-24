/**
 * Chat — AI 对话页（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/chat.html
 *
 * 三栏布局：240px sessions list + 1fr messages stream + 280px context panel
 *
 * 业务逻辑全部保留：
 *   - useChatStore: sessions / currentSessionId / messages / streaming / streamingContent
 *   - sendMessage / stopStreaming / createSession / switchSession / deleteSession
 *   - 3 个快捷操作（费曼教学 / 深度提问 / 考考我）+ 深度思考模式开关
 *   - Enter 发送 / Shift+Enter 换行
 *   - 自动滚动到底部 + error toast
 *   - 流式响应（onStreamChunk / onStreamComplete / onStreamError / onStreamReasoningChunk）
 *   - Markdown 渲染 + 代码高亮 + 思考过程面板（components/chat/MessageBubble）
 */

import { useState, useRef, useEffect, useCallback, Fragment } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { EmptyState } from '@/components/ui/Feedback'
import MessageBubble, { RAGSource } from '@/components/chat/MessageBubble'
import { sourceHighlightLink } from '../../../shared/source-anchor'
import RetrievalPanel from '@/components/chat/RetrievalPanel'
import SessionDrawer from '@/components/chat/SessionDrawer'
import BookChip from '@/components/chat/BookChip'
import { useChatStore } from '../stores/chatStore'
import { toast } from '../stores/toastStore'
import { mapBooks, type BookRow } from '../utils/db-mapper'

// ===== 常量 =====

/** 3 个快捷操作（T13 删除"全书问答"，保留费曼教学 / 深度提问 / 考考我） */
const QUICK_ACTIONS = [
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

// ===== 主组件 =====
export default function Chat() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const {
    sessions,
    currentSessionId,
    messages,
    loading,
    streaming,
    streamingContent,
    streamingReasoning,
    retrieval,
    enableReasoning,
    error,
    currentBookId,
    loadSessions,
    createSession,
    switchSession,
    deleteSession,
    clearAllSessions,
    sendMessage,
    regenerate,
    stopStreaming,
    setCurrentBook,
    clearError,
    setEnableReasoning,
    toggleLike,
    toggleBookmark,
  } = useChatStore()

  const [input, setInput] = useState('')
  const [books, setBooks] = useState<BookRow[]>([])
  /** 历史会话抽屉开关（原 240px 常驻左栏已收编为 overlay 抽屉） */
  const [drawerOpen, setDrawerOpen] = useState(false)

  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const bookIdFromUrlApplied = useRef(false)

  // ===== 初次加载：会话列表 + 书籍/笔记上下文 =====
  useEffect(() => {
    loadSessions()
    loadContextData()
  }, [loadSessions])

  // ===== 从 BookDetail「AI 对话此书」带 bookId 进入：绑定当前书并开新会话 =====
  useEffect(() => {
    const bookId = searchParams.get('bookId')
    if (!bookId || bookIdFromUrlApplied.current) return
    bookIdFromUrlApplied.current = true
    setCurrentBook(bookId)
    void createSession(bookId).catch((err) => {
      console.warn('按书籍创建会话失败:', err)
    })
  }, [searchParams, setCurrentBook, createSession])

  // ===== 自动滚动到底部（只滚对话区，不滚整页） =====
  const messagesContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // 仅流式输出时跟随滚动；回复完成后不再强制跳底（用户可能正在回看知识库面板）
    if (!streaming) return
    const container = messagesContainerRef.current
    if (!container) return

    // 如果用户手动向上滚看过历史，流式输出时不再强制拉回底部
    const isUserScrolledUp =
      container.scrollHeight - container.scrollTop - container.clientHeight > 120

    if (!isUserScrolledUp) {
      container.scrollTo({
        top: container.scrollHeight,
        behavior: 'smooth',
      })
    }
  }, [streaming, streamingContent])

  // ===== error toast =====
  useEffect(() => {
    if (error) {
      toast.error(error)
      clearError()
    }
  }, [error, clearError])

  const loadContextData = async () => {
    if (!window.electronAPI?.book) return
    try {
      setBooks(mapBooks((await window.electronAPI.book.getAll()) as unknown[]))
    } catch (err) {
      console.warn('加载书籍列表失败:', err)
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
    // 清空是不可逆的（主进程会把整个会话表清掉），必须先问一句。
    // 全项目只有生词本删除和设置页的重置问了，这里之前是直接删。
    if (!window.confirm(`确定清空全部 ${sessions.length} 个对话？（不可恢复）`)) return
    // 走主进程单事务通道一次清空（替代逐会话 Promise.all 删除的 N 次 IPC + N 次重渲染）
    clearAllSessions()
      .then(() => toast.success('已清空全部对话历史'))
      .catch((err) => toast.error(`清空失败: ${err instanceof Error ? err.message : String(err)}`))
  }

  const handleDeleteSession = async (id: string) => {
    // 删除单个会话同样不可恢复 —— 抽屉里那个 ✕ 就在卡片角上，很容易误点
    if (!window.confirm('确定删除这个对话？（不可恢复）')) return
    await deleteSession(id)
    toast.info('对话已删除')
  }

  /** 最后一条 AI 回复的 id：只有它才能"重新生成"（见 handleRegenerate 的说明） */
  const lastAssistantId = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i].id
    }
    return undefined
  })()

  const handleCopyMessage = (content: string) => {
    navigator.clipboard
      ?.writeText(content)
      .then(() => toast.success('已复制到剪贴板'))
      .catch(() => toast.error('复制失败'))
  }

  /**
   * 重新生成：复用**最后一条** user 消息，移除其后的 assistant 回复后重跑
   * （不新增 user 消息，避免重复问答对）。
   *
   * 注意：这个实现只认"最后一条提问"，跟点的是哪条回复无关 ——
   * 所以按钮**只能出现在最后一条 AI 回复上**（见下面 lastAssistantId 的用法）。
   * 之前每条回复下面都有这个按钮，点历史回复会偷偷把最新那条回复删掉重写。
   */
  const handleRegenerate = useCallback(() => {
    if (loading || streaming) return
    const hasUser = messages.some((m) => m.role === 'user')
    if (!hasUser) {
      toast.info('没有可重新生成的消息')
      return
    }
    void regenerate()
  }, [messages, loading, streaming, regenerate])

  // 切换深度思考模式
  const handleToggleReasoning = useCallback(() => {
    setEnableReasoning(!enableReasoning)
  }, [enableReasoning, setEnableReasoning])

  // ===== 派生数据 =====
  const currentSession = sessions.find((s) => s.id === currentSessionId)
  const currentBook = books.find((b) => b.id === currentBookId) || null

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
      />
      {/* ===== 单栏对话工作台：flex 吃满 Hero 以下全部高度，仅消息流内部滚动 ===== */}
      <div
        className="chat-workspace"
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
        }}
      >
        {/* 隐藏输入框自适应高度时的滚动条（内容超限时仍可滚，仅去掉视觉滚动条） */}
        <style>{`
          .messages-input textarea { scrollbar-width: none; }
          .messages-input textarea::-webkit-scrollbar { display: none; }
        `}</style>

          {/* ============ 中栏：消息流 ============ */}
          <section
            className="chat-messages"
            style={{
              border: '1px solid var(--border)',
              borderRadius: 'calc(var(--radius) + 4px)',
              background: 'var(--card)',
              display: 'flex',
              flexDirection: 'column',
              /* 工作区内唯一子元素，撑满全部高度（原三栏 grid 自动拉伸，单栏需显式声明） */
              flex: 1,
              overflow: 'hidden',
              minHeight: 0,
            }}
          >
            <div
              className="messages-head"
              style={{
                padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 4)',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                gap: 'calc(var(--spacing) * 2)',
                flexShrink: 0,
              }}
            >
              <button
                type="button"
                aria-label="打开历史对话"
                aria-expanded={drawerOpen}
                title="历史对话"
                onClick={() => setDrawerOpen(true)}
                style={{
                  width: 30,
                  height: 30,
                  display: 'grid',
                  placeItems: 'center',
                  border: '1px solid var(--border)',
                  background: 'var(--card)',
                  color: 'var(--foreground)',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  flexShrink: 0,
                  padding: 0,
                }}
              >
                <Icon name="menu" size={15} />
              </button>
              <strong
                style={{
                  fontSize: '0.95rem',
                  color: 'var(--foreground)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {currentSession?.title || 'AI 阅读助手'}
              </strong>
              <span
                className="tiny"
                style={{ fontSize: '0.72rem', color: 'var(--muted-foreground)', flexShrink: 0 }}
              >
                {messages.length} 条消息
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                {/* 关联书籍芯片（原底部 ContextBar 上移头部，下拉切换） */}
                <BookChip
                  currentBook={currentBook}
                  books={books}
                  onSelect={(id) => setCurrentBook(id)}
                  onClear={() => setCurrentBook(null)}
                />
                {/* 这里原来还有一个「＋ 新建会话」，和页头的「新建会话」是同一个函数、同一屏可见。
                    抽屉里也还有一个「新对话」。留页头那一个（最显眼）+ 抽屉里那一个（会话列表旁）。 */}
              </span>
            </div>

            {/* 消息流 */}
            <div
              ref={messagesContainerRef}
              className="messages-stream"
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: 'calc(var(--spacing) * 5)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'calc(var(--spacing) * 5)',
                minHeight: 0,
                width: '100%',
                maxWidth: 900,
                margin: '0 auto',
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
                  {messages.map((message, idx) => {
                    const msgId = message.id
                    // 最后一条用户提问：其回复前展示调取知识库面板（完成后不跳位）
                    const isLastUser =
                      message.role === 'user' &&
                      !messages.slice(idx + 1).some((m) => m.role === 'user')
                    return (
                    <Fragment key={msgId || idx}>
                    <MessageBubble
                      key={msgId || idx}
                      role={message.role}
                      content={message.content}
                      reasoning={
                        message.reasoning
                          ? {
                              content: message.reasoning.content,
                              isStreaming: false,
                              duration: message.reasoning.duration,
                            }
                          : undefined
                      }
                      sources={message.sources as RAGSource[] | undefined}
                      onOpenSource={(src) => navigate(sourceHighlightLink(src))}
                      liked={message.liked}
                      bookmarked={message.bookmarked}
                      onCopy={() => handleCopyMessage(message.content)}
                      // 只有最后一条 AI 回复能重新生成（实现上只会重跑最后一条提问）
                      onRegenerate={
                        message.role === 'assistant' && message.id === lastAssistantId
                          ? handleRegenerate
                          : undefined
                      }
                      onToggleLike={
                        msgId && message.role === 'assistant'
                          ? (liked) => toggleLike(msgId, liked)
                          : undefined
                      }
                      onToggleBookmark={
                        msgId && message.role === 'assistant'
                          ? (bookmarked) => toggleBookmark(msgId, bookmarked)
                          : undefined
                      }
                    />
                    {/* Agent 调取知识库可视化：紧跟最后一条提问，位于回复之前 */}
                    {isLastUser && <RetrievalPanel retrieval={retrieval} />}
                    </Fragment>
                    )
                  })}
                  {streaming && (
                    <MessageBubble
                      role="assistant"
                      content={streamingContent}
                      isStreaming
                      reasoning={
                        streamingReasoning
                          ? { content: streamingReasoning, isStreaming: true }
                          : undefined
                      }
                      onCopy={() => handleCopyMessage(streamingContent)}
                    />
                  )}
                  {loading && !streaming && (
                    <MessageBubble role="assistant" content="" isStreaming />
                  )}
                </>
              )}
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
                flexShrink: 0,
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
                  onKeyDown={handleKeyDown}
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
                    gap: 'calc(var(--spacing) * 3)',
                    flexWrap: 'wrap',
                    alignItems: 'center',
                  }}
                >
                  {/* 深度思考模式开关（DeepSeek R1 reasoning_content / Claude thinking / OpenAI o-series） */}
                  <button
                    type="button"
                    onClick={handleToggleReasoning}
                    aria-pressed={enableReasoning}
                    title={enableReasoning ? '已开启深度思考：AI 会先展示思考过程再回答（消耗更多 Token）' : '开启深度思考：AI 会先展示思考过程再回答'}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      padding: '0.34rem 0.7rem',
                      borderRadius: 999,
                      background: enableReasoning ? 'var(--primary)' : 'var(--secondary)',
                      color: enableReasoning ? 'var(--primary-foreground)' : 'var(--secondary-foreground)',
                      fontSize: '0.78rem',
                      border: enableReasoning ? '1px solid var(--primary)' : '1px solid var(--border)',
                      cursor: 'pointer',
                      transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
                      whiteSpace: 'nowrap',
                      font: 'inherit',
                      fontWeight: enableReasoning ? 600 : 400,
                    }}
                  >
                    {/* 大脑图标（与 Reasoning.tsx 一致） */}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
                      <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
                    </svg>
                    深度思考
                  </button>
                  {/* 3 个快捷操作 chip */}
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
      </div>

      {/* 历史会话抽屉（overlay，替代原 240px 左栏） */}
      <SessionDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        sessions={sessions}
        currentSessionId={currentSessionId}
        onSwitch={(id) => {
          void switchSession(id)
          setDrawerOpen(false)
        }}
        onDelete={handleDeleteSession}
        onCreate={() => {
          handleNewChat()
          setDrawerOpen(false)
        }}
      />
    </>
  )
}

// （原来的 IconButtonSmall 只被那个重复的「＋ 新建会话」按钮使用，随它一起删除）
