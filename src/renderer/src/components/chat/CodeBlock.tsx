/**
 * CodeBlock — 代码块组件（T13 新增）
 *
 * 借鉴 vercel/chatbot components/ai-elements/code-block.tsx 思路：
 *   - Shiki 语法高亮（react-shiki）
 *   - 语言标签 + 复制按钮
 *
 * 降级策略：react-shiki 加载失败时回退到纯文本 + monospace 样式（不阻塞流程）
 */
import { memo, useState, useEffect, ReactNode } from 'react'

interface CodeBlockProps {
  code: string
  language: string
}

interface ShikiRendererProps {
  code: string
  language: string
}

// ShikiHighlighter 组件的 props 形状（仅声明我们用到的字段）
// 完整类型见 react-shiki/dist/component-B-gutZRK.d.mts 的 ShikiHighlighterProps
interface ShikiHighlighterComponentProps {
  children: string
  language: string
  theme: string
  addDefaultStyles?: boolean
}

// 动态加载 react-shiki，避免在依赖缺失或 SSR 时崩溃
function ShikiRenderer({ code, language }: ShikiRendererProps) {
  const [highlighted, setHighlighted] = useState<ReactNode | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    // 动态 import，避免 react-shiki 在打包阶段对 ESM 的强依赖导致构建失败
    // react-shiki 导出 ShikiHighlighter（也是默认导出），接收 children/language/theme
    import('react-shiki')
      .then((mod) => {
        const Comp = (mod as { ShikiHighlighter?: React.ComponentType<ShikiHighlighterComponentProps>; default?: React.ComponentType<ShikiHighlighterComponentProps> }).ShikiHighlighter
          ?? (mod as { default?: React.ComponentType<ShikiHighlighterComponentProps> }).default
        if (cancelled || !Comp) {
          setFailed(true)
          return
        }
        // ShikiHighlighter 接收 children (代码内容) + language + theme
        setHighlighted(<Comp language={language} theme="github-dark" addDefaultStyles={false}>{code}</Comp>)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
    }
  }, [code, language])

  if (failed) {
    // 降级：纯文本 + monospace 样式
    return (
      <pre
        style={{
          margin: 0,
          padding: '0.75rem 1rem',
          background: 'var(--secondary)',
          color: 'var(--card-foreground)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.82rem',
          lineHeight: 1.5,
          overflowX: 'auto',
        }}
      >
        <code>{code}</code>
      </pre>
    )
  }

  if (!highlighted) {
    // 加载中：先显示纯文本，避免空白闪烁
    return (
      <pre
        style={{
          margin: 0,
          padding: '0.75rem 1rem',
          background: 'var(--secondary)',
          color: 'var(--card-foreground)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.82rem',
          lineHeight: 1.5,
          overflowX: 'auto',
          opacity: 0.7,
        }}
      >
        <code>{code}</code>
      </pre>
    )
  }

  return <>{highlighted}</>
}

function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard?.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      // 剪贴板失败时静默；不阻塞 UI
    })
  }

  return (
    <div
      style={{
        position: 'relative',
        margin: '0.75rem 0',
        borderRadius: 'var(--radius)',
        overflow: 'hidden',
        border: '1px solid var(--border)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '0.4rem 0.75rem',
          background: 'var(--secondary)',
          fontSize: '0.72rem',
          color: 'var(--muted-foreground)',
          fontFamily: 'var(--font-mono)',
        }}
      >
        <span>{language}</span>
        <button
          type="button"
          onClick={handleCopy}
          aria-label={copied ? '已复制' : '复制代码'}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--muted-foreground)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.25rem',
            font: 'inherit',
            padding: 0,
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--foreground)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--muted-foreground)'
          }}
        >
          {copied ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
            </svg>
          )}
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <ShikiRenderer code={code} language={language} />
    </div>
  )
}

export default memo(CodeBlock)
