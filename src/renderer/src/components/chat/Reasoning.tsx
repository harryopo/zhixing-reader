/**
 * Reasoning — AI 思考过程可折叠面板（T13 新增）
 *
 * 借鉴 vercel/chatbot/components/ai-elements/reasoning.tsx：
 *   - 流式开始时自动展开
 *   - 流式结束后延迟 1s 自动折叠
 *   - 显示思考耗时 "已思考 X 秒"
 *   - 内容用 Markdown 渲染（含代码块）
 *   - max-height 200px，超出滚动，隐藏滚动条
 *
 * 不依赖 @radix-ui/react-collapsible，自实现折叠以减少包体积。
 */
import { memo, useState, useEffect, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

interface ReasoningProps {
  content: string
  isStreaming: boolean
  duration?: number
}

function ReasoningBase({ content, isStreaming, duration }: ReasoningProps) {
  const [isOpen, setIsOpen] = useState(true)
  const [hasAutoClosed, setHasAutoClosed] = useState(false)
  const [computedDuration, setComputedDuration] = useState<number | undefined>(duration)
  const scrollRef = useRef<HTMLDivElement>(null)
  const startTimeRef = useRef<number | null>(null)

  // 流式开始时自动展开
  useEffect(() => {
    if (isStreaming && !isOpen) setIsOpen(true)
  }, [isStreaming, isOpen])

  // 计算耗时（若外部未传 duration）
  useEffect(() => {
    if (isStreaming) {
      if (startTimeRef.current === null) startTimeRef.current = Date.now()
    } else if (startTimeRef.current !== null) {
      const dur = Math.max(1, Math.ceil((Date.now() - startTimeRef.current) / 1000))
      setComputedDuration((prev) => prev ?? dur)
      startTimeRef.current = null
    }
  }, [isStreaming])

  // 流式结束后延迟 1s 自动折叠（仅一次）
  useEffect(() => {
    if (!isStreaming && isOpen && !hasAutoClosed && content) {
      const timer = setTimeout(() => {
        setIsOpen(false)
        setHasAutoClosed(true)
      }, 1000)
      return () => clearTimeout(timer)
    }
  }, [isStreaming, isOpen, hasAutoClosed, content])

  // 流式时自动滚到底部
  useEffect(() => {
    if (isStreaming && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [content, isStreaming])

  const triggerText = isStreaming
    ? '思考中...'
    : computedDuration
      ? `已思考 ${computedDuration} 秒`
      : '思考过程'

  return (
    <div
      className="reasoning"
      style={{
        width: '100%',
        maxWidth: '90%',
      }}
    >
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        aria-expanded={isOpen}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.4rem 0',
          fontSize: '0.78rem',
          color: 'var(--muted-foreground)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          font: 'inherit',
        }}
      >
        {/* 大脑图标 */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z" />
          <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z" />
        </svg>
        <span>{triggerText}</span>
        {isStreaming && (
          <span
            aria-hidden
            style={{
              display: 'inline-block',
              width: 6,
              height: 6,
              borderRadius: '50%',
              background: 'var(--primary)',
              animation: 'thinking-pulse 1.4s infinite',
            }}
          />
        )}
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
            transform: isOpen ? 'rotate(180deg)' : 'rotate(0)',
            transition: 'transform 0.2s ease',
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <style>{`@keyframes thinking-pulse { 0%, 60%, 100% { opacity: 0.3; } 30% { opacity: 1; } }`}</style>
      </button>
      {isOpen && (
        <div
          ref={scrollRef}
          style={{
            maxHeight: 200,
            overflowY: 'auto',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            padding: '0.75rem 1rem',
            margin: '0.4rem 0',
            background: 'var(--secondary)',
            borderRadius: 'calc(var(--radius) + 4px)',
            fontSize: '0.82rem',
            lineHeight: 1.6,
            color: 'var(--muted-foreground)',
            border: '1px solid var(--border)',
            wordBreak: 'break-word',
            overflowWrap: 'anywhere',
          }}
        >
          {content ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: ({ children }) => <p style={{ margin: '0.3rem 0' }}>{children}</p>,
                code: ({ children }: { children?: React.ReactNode }) => (
                  <code
                    style={{
                      padding: '0.1rem 0.3rem',
                      borderRadius: 4,
                      background: 'var(--background)',
                      fontSize: '0.85em',
                      fontFamily: 'var(--font-mono)',
                    }}
                  >
                    {children}
                  </code>
                ),
                pre: ({ children }) => <>{children}</>,
                ul: ({ children }) => <ul style={{ margin: '0.3rem 0', paddingLeft: '1.3rem' }}>{children}</ul>,
                ol: ({ children }) => <ol style={{ margin: '0.3rem 0', paddingLeft: '1.3rem' }}>{children}</ol>,
                li: ({ children }) => <li style={{ margin: '0.1rem 0' }}>{children}</li>,
                h1: ({ children }) => <h3 style={{ fontSize: '0.95rem', margin: '0.4rem 0 0.2rem' }}>{children}</h3>,
                h2: ({ children }) => <h4 style={{ fontSize: '0.9rem', margin: '0.4rem 0 0.2rem' }}>{children}</h4>,
                h3: ({ children }) => <h5 style={{ fontSize: '0.85rem', margin: '0.4rem 0 0.2rem' }}>{children}</h5>,
              }}
            >
              {content}
            </ReactMarkdown>
          ) : (
            <span style={{ color: 'var(--muted-foreground)' }}>等待思考内容...</span>
          )}
        </div>
      )}
    </div>
  )
}

export const Reasoning = memo(ReasoningBase)
