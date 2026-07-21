/**
 * MessageBubble — AI 对话消息气泡（T13 重构）
 *
 * 借鉴 Vercel AI Chatbot 组件思路，结合本项目 CSS 变量风格：
 *   - Markdown 渲染：react-markdown + remark-gfm
 *   - 代码块高亮：react-shiki
 *   - 流式光标：闪烁竖条
 *   - 思考过程：可折叠面板（借鉴 vercel/chatbot components/ai-elements/reasoning.tsx）
 *
 * 安全：react-markdown 默认不渲染 raw HTML，防 XSS。
 */
import { memo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import CodeBlock from './CodeBlock'
import { Reasoning } from './Reasoning'

export interface RAGSource {
  bookId: string
  bookTitle: string
  chunkId: string
  content?: string
  relevanceScore: number
  chapterTitle?: string
}

export interface ReasoningBlock {
  content: string
  isStreaming: boolean
  duration?: number
}

interface MessageBubbleProps {
  role: 'user' | 'assistant' | 'system'
  content: string
  reasoning?: ReasoningBlock
  sources?: RAGSource[]
  isStreaming?: boolean
  onCopy?: () => void
  onRegenerate?: () => void
}

function MessageBubble({
  role,
  content,
  reasoning,
  sources,
  isStreaming,
  onCopy,
  onRegenerate,
}: MessageBubbleProps) {
  const isUser = role === 'user'

  if (isUser) {
    return (
      <div
        className="msg user"
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          alignItems: 'flex-end',
        }}
      >
        <div
          className="msg-bubble"
          style={{
            maxWidth: '70%',
            padding: 'calc(var(--spacing) * 3.5) calc(var(--spacing) * 4)',
            borderRadius: 'calc(var(--radius) + 4px)',
            borderBottomRightRadius: 4,
            background: 'var(--primary)',
            color: 'var(--primary-foreground)',
            fontSize: '0.92rem',
            lineHeight: 1.6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
          }}
        >
          {content}
        </div>
      </div>
    )
  }

  return (
    <div
      className="msg assistant"
      style={{
        display: 'flex',
        gap: 'calc(var(--spacing) * 3)',
        alignItems: 'flex-start',
      }}
    >
      {/* AI 头像 */}
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
        aria-hidden
      >
        AI
      </div>

      <div
        className="msg-content"
        style={{
          flex: 1,
          minWidth: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 'calc(var(--spacing) * 2)',
          alignItems: 'flex-start',
        }}
      >
        {/* 思考过程（aboveMessage 槽位，借鉴 LobeChat） */}
        {reasoning && (reasoning.content || reasoning.isStreaming) && (
          <Reasoning
            content={reasoning.content}
            isStreaming={reasoning.isStreaming}
            duration={reasoning.duration}
          />
        )}

        {/* 消息内容（Markdown 渲染） */}
        <div
          className="msg-bubble"
          style={{
            maxWidth: '90%',
            padding: 'calc(var(--spacing) * 3.5) calc(var(--spacing) * 4)',
            borderRadius: 'calc(var(--radius) + 4px)',
            borderBottomLeftRadius: 4,
            background: 'var(--background)',
            color: 'var(--card-foreground)',
            border: '1px solid var(--border)',
            fontSize: '0.92rem',
            lineHeight: 1.6,
            overflowWrap: 'anywhere',
          }}
        >
          {content ? (
            <MarkdownRenderer content={content} />
          ) : isStreaming ? (
            <TypingDots inline />
          ) : null}
          {isStreaming && content && <StreamingCursor />}
        </div>

        {/* RAG 引用（belowMessage 槽位） */}
        {sources && sources.length > 0 && !isStreaming && (
          <SourceList sources={sources} />
        )}

        {/* 操作栏 */}
        {!isStreaming && content && (onCopy || onRegenerate) && (
          <div
            className="msg-actions"
            style={{ display: 'flex', gap: 'calc(var(--spacing) * 2)' }}
          >
            {onCopy && (
              <ActionButton label="复制" onClick={onCopy}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                </svg>
              </ActionButton>
            )}
            {onRegenerate && (
              <ActionButton label="重新生成" onClick={onRegenerate}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <polyline points="23 4 23 10 17 10" />
                  <polyline points="1 20 1 14 7 14" />
                  <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
                </svg>
              </ActionButton>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default memo(MessageBubble)

// ===== 子组件：Markdown 渲染 =====
function MarkdownRenderer({ content }: { content: string }) {
  return (
    <div className="markdown-body" style={{ fontSize: '0.92rem', lineHeight: 1.6 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // 代码块：block code 用 CodeBlock 高亮；inline code 用样式化 <code>
          code: ({ inline, className, children, ...props }: {
            inline?: boolean
            className?: string
            children?: React.ReactNode
          }) => {
            if (inline) {
              return (
                <code
                  style={{
                    padding: '0.1rem 0.35rem',
                    borderRadius: 4,
                    background: 'var(--secondary)',
                    color: 'var(--secondary-foreground)',
                    fontSize: '0.85em',
                    fontFamily: 'var(--font-mono)',
                  }}
                  {...props}
                >
                  {children}
                </code>
              )
            }
            const match = /language-(\w+)/.exec(className || '')
            const codeStr = String(children ?? '').replace(/\n$/, '')
            return <CodeBlock code={codeStr} language={match?.[1] || 'text'} />
          },
          // CodeBlock 自带 <pre>，外层 <pre> 不再渲染
          pre: ({ children }) => <>{children}</>,
          // 表格样式
          table: ({ children }) => (
            <div style={{ overflowX: 'auto', margin: '0.75rem 0' }}>
              <table
                style={{
                  borderCollapse: 'collapse',
                  width: '100%',
                  fontSize: '0.85rem',
                }}
              >
                {children}
              </table>
            </div>
          ),
          th: ({ children }) => (
            <th
              style={{
                padding: '0.4rem 0.6rem',
                border: '1px solid var(--border)',
                background: 'var(--secondary)',
                textAlign: 'left',
                fontWeight: 600,
              }}
            >
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td
              style={{
                padding: '0.4rem 0.6rem',
                border: '1px solid var(--border)',
              }}
            >
              {children}
            </td>
          ),
          // 链接：外部链接安全打开
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              style={{ color: 'var(--primary)', textDecoration: 'underline' }}
            >
              {children}
            </a>
          ),
          // 引用块
          blockquote: ({ children }) => (
            <blockquote
              style={{
                margin: '0.5rem 0',
                padding: '0.25rem 0.9rem',
                borderLeft: '3px solid var(--border)',
                color: 'var(--muted-foreground)',
              }}
            >
              {children}
            </blockquote>
          ),
          // 列表
          ul: ({ children }) => (
            <ul style={{ margin: '0.4rem 0', paddingLeft: '1.4rem' }}>{children}</ul>
          ),
          ol: ({ children }) => (
            <ol style={{ margin: '0.4rem 0', paddingLeft: '1.4rem' }}>{children}</ol>
          ),
          li: ({ children }) => <li style={{ margin: '0.15rem 0' }}>{children}</li>,
          p: ({ children }) => <p style={{ margin: '0.4rem 0' }}>{children}</p>,
          h1: ({ children }) => (
            <h1 style={{ fontSize: '1.2rem', margin: '0.6rem 0 0.4rem', fontWeight: 700 }}>{children}</h1>
          ),
          h2: ({ children }) => (
            <h2 style={{ fontSize: '1.1rem', margin: '0.6rem 0 0.4rem', fontWeight: 700 }}>{children}</h2>
          ),
          h3: ({ children }) => (
            <h3 style={{ fontSize: '1rem', margin: '0.5rem 0 0.3rem', fontWeight: 600 }}>{children}</h3>
          ),
          h4: ({ children }) => (
            <h4 style={{ fontSize: '0.95rem', margin: '0.5rem 0 0.3rem', fontWeight: 600 }}>{children}</h4>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}

// ===== 子组件：流式光标 =====
function StreamingCursor() {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 8,
        height: 16,
        background: 'var(--primary)',
        marginLeft: 2,
        verticalAlign: 'text-bottom',
        animation: 'cursor-blink 1s infinite',
      }}
    >
      <style>{`@keyframes cursor-blink { 0%, 50% { opacity: 1; } 51%, 100% { opacity: 0; } }`}</style>
    </span>
  )
}

// ===== 子组件：打字动画 =====
function TypingDots({ inline = false }: { inline?: boolean }) {
  const wrapperStyle: React.CSSProperties = inline
    ? { display: 'inline-flex', gap: 4, alignItems: 'center', padding: 'calc(var(--spacing) * 1)' }
    : { display: 'inline-flex', gap: 4, alignItems: 'center', padding: 'calc(var(--spacing) * 2)' }
  return (
    <div className="typing-dots" style={wrapperStyle} aria-label="AI 正在思考">
      {[0, 0.2, 0.4].map((delay, i) => (
        <span
          key={i}
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            background: 'var(--muted-foreground)',
            animation: 'typing-blink 1.4s infinite',
            animationDelay: `${delay}s`,
          }}
        />
      ))}
      <style>{`@keyframes typing-blink { 0%, 60%, 100% { opacity: 0.3; } 30% { opacity: 1; } }`}</style>
    </div>
  )
}

// ===== 子组件：操作按钮 =====
function ActionButton({
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
      title={label}
      onClick={onClick}
      style={{
        width: 28,
        height: 28,
        display: 'grid',
        placeItems: 'center',
        border: '1px solid var(--border)',
        background: 'var(--card)',
        color: 'var(--muted-foreground)',
        borderRadius: 'var(--radius)',
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        padding: 0,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--foreground)'
        e.currentTarget.style.borderColor = 'var(--ring)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--muted-foreground)'
        e.currentTarget.style.borderColor = 'var(--border)'
      }}
    >
      {children}
    </button>
  )
}

// ===== 子组件：RAG 引用列表 =====
function SourceList({ sources }: { sources: RAGSource[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ width: '100%', maxWidth: '90%' }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.4rem 0.7rem',
          background: 'var(--secondary)',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius)',
          fontSize: '0.78rem',
          color: 'var(--muted-foreground)',
          cursor: 'pointer',
          width: '100%',
          font: 'inherit',
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z" />
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" />
        </svg>
        <span>引用来源：{sources.length} 个片段</span>
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
          style={{
            marginLeft: 'auto',
            transform: open ? 'rotate(180deg)' : 'rotate(0)',
            transition: 'transform 0.2s ease',
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>
      {open && (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.4rem',
            marginTop: '0.4rem',
          }}
        >
          {sources.map((src, i) => (
            <div
              key={`${src.bookId}-${src.chunkId}-${i}`}
              style={{
                padding: '0.5rem 0.7rem',
                background: 'var(--background)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius)',
                fontSize: '0.78rem',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginBottom: '0.2rem',
                  gap: '0.5rem',
                }}
              >
                <strong style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  📖 {src.bookTitle}
                </strong>
                <span style={{ color: 'var(--muted-foreground)', flexShrink: 0 }}>
                  相关度 {Math.round((src.relevanceScore || 0) * 100)}%
                </span>
              </div>
              {src.chapterTitle && (
                <div style={{ color: 'var(--muted-foreground)', fontSize: '0.72rem' }}>
                  {src.chapterTitle}
                </div>
              )}
              {src.content && (
                <div
                  style={{
                    marginTop: '0.25rem',
                    color: 'var(--card-foreground)',
                    display: '-webkit-box',
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: 'vertical',
                    overflow: 'hidden',
                  }}
                >
                  {src.content}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
