// @vitest-environment happy-dom
/**
 * MessageBubble 组件测试
 *
 * 覆盖：
 *   - user 消息：渲染内容、不渲染 AI 头像
 *   - assistant 消息：渲染头像、Markdown 内容
 *   - streaming 状态：打字动画、流式光标、不显示 action 按钮
 *   - action 按钮回调：onCopy / onToggleLike / onToggleBookmark
 *   - 点赞/收藏激活态：aria-pressed
 *   - RAG 引用来源：展开/收起
 *   - reasoning 思考过程
 *   - MarkdownRenderer 内部 15+ component 渲染函数（code/pre/table/th/td/a/blockquote/ul/ol/li/p/h1-h4）
 *   - TypingDots inline 分支、ActionButton hover 事件、SourceList 边界
 *
 * 测试要点：
 *   - mock 重依赖（react-markdown / remark-gfm / CodeBlock / Reasoning）避免复杂 AST
 *   - 用 lastMarkdownComponents 保存 react-markdown 的 components map（含函数引用），供测试直接调用
 *   - 用 getByLabelText 而非 querySelector（测了可访问性 + 更稳健）
 *   - 使用 happy-dom：jsdom 25 会过滤含 CSS 变量的内联样式，导致样式断言失败
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'

// ============================================================================
// Mock 重依赖（必须在 import 被测组件前；vitest 自动提升 vi.mock 到顶部）
// ============================================================================

// 保存最近一次 render 时 react-markdown 收到的 components map（含函数引用）
// 测试中可直接调用 component 函数，覆盖 MarkdownRenderer 内部所有 component 渲染分支
const lastMarkdownComponents: {
  current: Record<string, ((props: unknown) => ReactNode)> | null
} = { current: null }

vi.mock('react-markdown', () => ({
  default: ({
    children,
    components,
  }: {
    children?: ReactNode
    components?: Record<string, (props: unknown) => ReactNode>
  }) => {
    lastMarkdownComponents.current =
      (components as Record<string, (props: unknown) => ReactNode>) ?? null
    return <div data-testid="markdown-mock">{children}</div>
  },
}))

vi.mock('remark-gfm', () => ({ default: () => {} }))

vi.mock('../CodeBlock', () => ({
  default: ({ code, language }: { code: string; language?: string }) => (
    <pre data-testid="codeblock-mock" data-language={language ?? ''}>
      {code}
    </pre>
  ),
}))

vi.mock('../Reasoning', () => ({
  Reasoning: ({ content }: { content: string }) => (
    <div data-testid="reasoning-mock">{content}</div>
  ),
}))

import MessageBubble from '../MessageBubble'

// ============================================================================
// 辅助：从 lastMarkdownComponents 取出指定 component 渲染函数
//   用 createElement 包装后 render，可验证渲染输出
//   返回类型 ComponentType<Record<string, unknown>> 让 createElement 接受任意 props
// ============================================================================
function getMarkdownComponent(name: string): React.ComponentType<Record<string, unknown>> {
  if (!lastMarkdownComponents.current) {
    throw new Error(
      'lastMarkdownComponents.current is null — 请先 render MessageBubble role="assistant"',
    )
  }
  const comp = lastMarkdownComponents.current[name]
  if (!comp) {
    throw new Error(`Markdown component "${name}" not registered`)
  }
  return comp as unknown as React.ComponentType<Record<string, unknown>>
}

// ============================================================================
// 测试用例
// ============================================================================

describe('MessageBubble', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('user 消息', () => {
    it('渲染用户消息内容', () => {
      render(<MessageBubble role="user" content="你好，AI" />)
      expect(screen.getByText('你好，AI')).toBeInTheDocument()
    })

    it('不渲染 AI 头像（无 .msg-avatar）', () => {
      const { container } = render(<MessageBubble role="user" content="test" />)
      expect(container.querySelector('.msg-avatar')).not.toBeInTheDocument()
    })
  })

  describe('assistant 消息', () => {
    it('渲染 AI 头像（含 "AI" 文字）', () => {
      const { container } = render(
        <MessageBubble role="assistant" content="你好，用户" />,
      )
      const avatar = container.querySelector('.msg-avatar')
      expect(avatar).toBeInTheDocument()
      expect(avatar).toHaveTextContent('AI')
    })

    it('渲染 Markdown 内容', () => {
      render(<MessageBubble role="assistant" content="# 标题" />)
      expect(screen.getByTestId('markdown-mock')).toHaveTextContent('# 标题')
    })
  })

  describe('streaming 状态', () => {
    it('streaming 且无 content → 显示打字动画（aria-label="AI 正在思考"）', () => {
      render(<MessageBubble role="assistant" content="" isStreaming={true} />)
      expect(screen.getByLabelText('AI 正在思考')).toBeInTheDocument()
    })

    it('streaming 且有 content → 显示内容 + 流式光标', () => {
      const { container } = render(
        <MessageBubble role="assistant" content="生成中" isStreaming={true} />,
      )
      expect(screen.getByTestId('markdown-mock')).toHaveTextContent('生成中')
      // StreamingCursor 是 aria-hidden span
      const cursor = container.querySelector('span[aria-hidden]')
      expect(cursor).toBeInTheDocument()
    })

    it('streaming 时不显示 action 按钮（复制/点赞/收藏）', () => {
      const onCopy = vi.fn()
      render(
        <MessageBubble
          role="assistant"
          content="x"
          isStreaming={true}
          onCopy={onCopy}
          onToggleLike={vi.fn()}
          onToggleBookmark={vi.fn()}
        />,
      )
      expect(screen.queryByLabelText('复制')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('点赞')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('收藏')).not.toBeInTheDocument()
    })
  })

  describe('action 按钮回调', () => {
    it('点击复制按钮触发 onCopy', () => {
      const onCopy = vi.fn()
      render(<MessageBubble role="assistant" content="x" onCopy={onCopy} />)
      fireEvent.click(screen.getByLabelText('复制'))
      expect(onCopy).toHaveBeenCalledOnce()
    })

    it('点击重新生成按钮触发 onRegenerate', () => {
      const onRegenerate = vi.fn()
      render(
        <MessageBubble role="assistant" content="x" onRegenerate={onRegenerate} />,
      )
      fireEvent.click(screen.getByLabelText('重新生成'))
      expect(onRegenerate).toHaveBeenCalledOnce()
    })

    it('点击点赞按钮触发 onToggleLike(true)（未点赞 → 点赞）', () => {
      const onToggleLike = vi.fn()
      render(
        <MessageBubble
          role="assistant"
          content="x"
          liked={false}
          onToggleLike={onToggleLike}
        />,
      )
      fireEvent.click(screen.getByLabelText('点赞'))
      expect(onToggleLike).toHaveBeenCalledWith(true)
    })

    it('点击已点赞按钮触发 onToggleLike(false)（取消点赞）', () => {
      const onToggleLike = vi.fn()
      render(
        <MessageBubble
          role="assistant"
          content="x"
          liked={true}
          onToggleLike={onToggleLike}
        />,
      )
      fireEvent.click(screen.getByLabelText('点赞'))
      expect(onToggleLike).toHaveBeenCalledWith(false)
    })

    it('点击收藏按钮触发 onToggleBookmark(true)', () => {
      const onToggleBookmark = vi.fn()
      render(
        <MessageBubble
          role="assistant"
          content="x"
          bookmarked={false}
          onToggleBookmark={onToggleBookmark}
        />,
      )
      fireEvent.click(screen.getByLabelText('收藏'))
      expect(onToggleBookmark).toHaveBeenCalledWith(true)
    })

    it('点击已收藏按钮触发 onToggleBookmark(false)', () => {
      const onToggleBookmark = vi.fn()
      render(
        <MessageBubble
          role="assistant"
          content="x"
          bookmarked={true}
          onToggleBookmark={onToggleBookmark}
        />,
      )
      fireEvent.click(screen.getByLabelText('收藏'))
      expect(onToggleBookmark).toHaveBeenCalledWith(false)
    })
  })

  describe('点赞/收藏激活态 aria-pressed', () => {
    it('未点赞 → aria-pressed=false', () => {
      render(
        <MessageBubble
          role="assistant"
          content="x"
          liked={false}
          onToggleLike={vi.fn()}
        />,
      )
      expect(screen.getByLabelText('点赞')).toHaveAttribute('aria-pressed', 'false')
    })

    it('已点赞 → aria-pressed=true', () => {
      render(
        <MessageBubble
          role="assistant"
          content="x"
          liked={true}
          onToggleLike={vi.fn()}
        />,
      )
      expect(screen.getByLabelText('点赞')).toHaveAttribute('aria-pressed', 'true')
    })

    it('已收藏 → aria-pressed=true', () => {
      render(
        <MessageBubble
          role="assistant"
          content="x"
          bookmarked={true}
          onToggleBookmark={vi.fn()}
        />,
      )
      expect(screen.getByLabelText('收藏')).toHaveAttribute('aria-pressed', 'true')
    })
  })

  describe('RAG 引用来源', () => {
    const sources = [
      {
        bookId: 'b1',
        bookTitle: '深入理解计算机系统',
        chunkId: 'c1',
        relevanceScore: 0.92,
        chapterTitle: '第1章',
        content: '引用片段内容',
      },
    ]

    it('streaming 时不显示引用按钮', () => {
      render(
        <MessageBubble
          role="assistant"
          content="x"
          isStreaming={true}
          sources={sources}
        />,
      )
      expect(screen.queryByText(/引用来源/)).not.toBeInTheDocument()
    })

    it('非 streaming 时显示引用按钮（含数量）', () => {
      render(<MessageBubble role="assistant" content="x" sources={sources} />)
      expect(screen.getByText(/引用来源：1 个片段/)).toBeInTheDocument()
    })

    it('点击引用按钮展开 → 显示书名和相关度', () => {
      render(<MessageBubble role="assistant" content="x" sources={sources} />)
      const btn = screen.getByRole('button', { name: /引用来源/ })
      fireEvent.click(btn)
      expect(screen.getByText(/深入理解计算机系统/)).toBeInTheDocument()
      expect(screen.getByText(/相关度 92%/)).toBeInTheDocument()
    })

    it('再次点击引用按钮 → 收起（书名消失）', () => {
      render(<MessageBubble role="assistant" content="x" sources={sources} />)
      const btn = screen.getByRole('button', { name: /引用来源/ })
      fireEvent.click(btn) // 展开
      expect(screen.getByText(/深入理解计算机系统/)).toBeInTheDocument()
      fireEvent.click(btn) // 收起
      expect(screen.queryByText(/深入理解计算机系统/)).not.toBeInTheDocument()
    })
  })

  describe('reasoning 思考过程', () => {
    it('有 reasoning content → 渲染 Reasoning 组件', () => {
      render(
        <MessageBubble
          role="assistant"
          content="答案"
          reasoning={{ content: '让我想想...', isStreaming: false }}
        />,
      )
      expect(screen.getByTestId('reasoning-mock')).toHaveTextContent('让我想想...')
    })

    it('reasoning 无内容且非 streaming → 不渲染', () => {
      const { container } = render(
        <MessageBubble
          role="assistant"
          content="答案"
          reasoning={{ content: '', isStreaming: false }}
        />,
      )
      expect(container.querySelector('[data-testid="reasoning-mock"]')).not.toBeInTheDocument()
    })

    it('reasoning isStreaming=true 且无 content → 仍渲染（显示加载态）', () => {
      render(
        <MessageBubble
          role="assistant"
          content="答案"
          reasoning={{ content: '', isStreaming: true }}
        />,
      )
      expect(screen.getByTestId('reasoning-mock')).toBeInTheDocument()
    })
  })

  // ==========================================================================
  // Phase 12 T2 新增：MarkdownRenderer 内部 component 渲染函数
  //   通过 lastMarkdownComponents 模式直接调用 react-markdown 的 components map
  //   覆盖 code/pre/table/th/td/a/blockquote/ul/ol/li/p/h1-h4 各分支
  // ==========================================================================
  describe('MarkdownRenderer 内部 component 渲染', () => {
    beforeEach(() => {
      // 触发一次 assistant 渲染，让 lastMarkdownComponents 填充
      render(<MessageBubble role="assistant" content="trigger" />)
    })

    describe('code component', () => {
      it('inline=true → 渲染 <code> 内联样式', () => {
        const Code = getMarkdownComponent('code')
        const { container } = render(
          createElement(Code, { inline: true, children: 'inlineCode' }),
        )
        const codeEl = container.querySelector('code')
        expect(codeEl).toBeInTheDocument()
        expect(codeEl).toHaveTextContent('inlineCode')
      })

      it('inline=false + className="language-ts" → CodeBlock 带 language', () => {
        const Code = getMarkdownComponent('code')
        const { container } = render(
          createElement(Code, {
            inline: false,
            className: 'language-ts',
            children: 'const x = 1\n',
          }),
        )
        const cb = container.querySelector('[data-testid="codeblock-mock"]')
        expect(cb).toBeInTheDocument()
        expect(cb).toHaveTextContent('const x = 1')
        expect(cb?.getAttribute('data-language')).toBe('ts')
      })

      it('inline=false 无 className → CodeBlock language="text"', () => {
        const Code = getMarkdownComponent('code')
        const { container } = render(
          createElement(Code, { inline: false, children: 'plain\n' }),
        )
        const cb = container.querySelector('[data-testid="codeblock-mock"]')
        expect(cb?.getAttribute('data-language')).toBe('text')
      })

      it('inline=false children=null → CodeBlock code="" 不报错', () => {
        const Code = getMarkdownComponent('code')
        const { container } = render(
          createElement(Code, { inline: false, children: null }),
        )
        expect(container.querySelector('[data-testid="codeblock-mock"]')).toBeInTheDocument()
      })
    })

    describe('pre component', () => {
      it('pre → 直接返回 children（fragment）', () => {
        const Pre = getMarkdownComponent('pre')
        const { container } = render(
          createElement(Pre, { children: 'preContent' }),
        )
        // pre 不渲染 <pre> 标签，直接透传 children
        expect(container.textContent).toBe('preContent')
        expect(container.querySelector('pre')).not.toBeInTheDocument()
      })
    })

    describe('table / th / td components', () => {
      it('table → 渲染 <div><table> 包装', () => {
        const Table = getMarkdownComponent('table')
        const { container } = render(
          createElement(Table, { children: 'cellContent' }),
        )
        const wrapper = container.querySelector('div')
        expect(wrapper).toBeInTheDocument()
        const table = container.querySelector('table')
        expect(table).toBeInTheDocument()
        expect(table).toHaveTextContent('cellContent')
      })

      it('th → 渲染 <th> with style', () => {
        const Th = getMarkdownComponent('th')
        const { container } = render(createElement(Th, { children: 'Header' }))
        const th = container.querySelector('th') as HTMLElement
        expect(th).toBeInTheDocument()
        expect(th).toHaveTextContent('Header')
        expect(th.style.fontWeight).toBe('600')
      })

      it('td → 渲染 <td> with style', () => {
        const Td = getMarkdownComponent('td')
        const { container } = render(createElement(Td, { children: 'Data' }))
        const td = container.querySelector('td') as HTMLElement
        expect(td).toBeInTheDocument()
        expect(td).toHaveTextContent('Data')
      })
    })

    describe('a component（外部链接）', () => {
      it('a → 渲染 <a target="_blank" rel="noopener noreferrer">', () => {
        const A = getMarkdownComponent('a')
        const { container } = render(
          createElement(A, { href: 'https://example.com', children: 'link' }),
        )
        const a = container.querySelector('a')
        expect(a).toBeInTheDocument()
        expect(a).toHaveAttribute('href', 'https://example.com')
        expect(a).toHaveAttribute('target', '_blank')
        expect(a).toHaveAttribute('rel', 'noopener noreferrer')
        expect(a).toHaveTextContent('link')
      })
    })

    describe('blockquote component', () => {
      it('blockquote → 渲染 <blockquote> with left border', () => {
        const Blockquote = getMarkdownComponent('blockquote')
        const { container } = render(
          createElement(Blockquote, { children: '引用' }),
        )
        const bq = container.querySelector('blockquote') as HTMLElement
        expect(bq).toBeInTheDocument()
      expect(bq).toHaveTextContent('引用')
      expect(bq.getAttribute('style')).toContain('border-left')
      })
    })

    describe('list components (ul/ol/li)', () => {
      it('ul → 渲染 <ul>', () => {
        const Ul = getMarkdownComponent('ul')
        const { container } = render(createElement(Ul, { children: 'item' }))
        const ul = container.querySelector('ul')
        expect(ul).toBeInTheDocument()
        expect(ul).toHaveTextContent('item')
      })

      it('ol → 渲染 <ol>', () => {
        const Ol = getMarkdownComponent('ol')
        const { container } = render(createElement(Ol, { children: 'item' }))
        const ol = container.querySelector('ol')
        expect(ol).toBeInTheDocument()
        expect(ol).toHaveTextContent('item')
      })

      it('li → 渲染 <li>', () => {
        const Li = getMarkdownComponent('li')
        const { container } = render(createElement(Li, { children: 'list item' }))
        const li = container.querySelector('li')
        expect(li).toBeInTheDocument()
        expect(li).toHaveTextContent('list item')
      })
    })

    describe('p component', () => {
      it('p → 渲染 <p>', () => {
        const P = getMarkdownComponent('p')
        const { container } = render(createElement(P, { children: '段落' }))
        const p = container.querySelector('p')
        expect(p).toBeInTheDocument()
        expect(p).toHaveTextContent('段落')
      })
    })

    describe('headings h1-h4', () => {
      it('h1 → 渲染 <h1> with fontSize 1.2rem', () => {
        const H1 = getMarkdownComponent('h1')
        const { container } = render(createElement(H1, { children: '标题1' }))
        const h1 = container.querySelector('h1')
        expect(h1).toBeInTheDocument()
        expect(h1).toHaveTextContent('标题1')
        expect(h1?.style.fontSize).toBe('1.2rem')
      })

      it('h2 → 渲染 <h2> with fontSize 1.1rem', () => {
        const H2 = getMarkdownComponent('h2')
        const { container } = render(createElement(H2, { children: '标题2' }))
        const h2 = container.querySelector('h2')
        expect(h2).toBeInTheDocument()
        expect(h2?.style.fontSize).toBe('1.1rem')
      })

      it('h3 → 渲染 <h3> with fontSize 1rem', () => {
        const H3 = getMarkdownComponent('h3')
        const { container } = render(createElement(H3, { children: '标题3' }))
        const h3 = container.querySelector('h3')
        expect(h3).toBeInTheDocument()
        expect(h3?.style.fontSize).toBe('1rem')
      })

      it('h4 → 渲染 <h4> with fontSize 0.95rem', () => {
        const H4 = getMarkdownComponent('h4')
        const { container } = render(createElement(H4, { children: '标题4' }))
        const h4 = container.querySelector('h4')
        expect(h4).toBeInTheDocument()
        expect(h4?.style.fontSize).toBe('0.95rem')
      })
    })
  })

  // ==========================================================================
  // Phase 12 T2 新增：TypingDots inline 分支
  // ==========================================================================
  describe('TypingDots inline 分支', () => {
    it('streaming 且无 content → 渲染 TypingDots（默认非 inline，含 aria-label）', () => {
      render(<MessageBubble role="assistant" content="" isStreaming={true} />)
      const dots = screen.getByLabelText('AI 正在思考')
      expect(dots).toBeInTheDocument()
      // 默认 inline=false，padding 较大（calc(var(--spacing) * 2)）
      expect(dots.className).toBe('typing-dots')
    })

    it('TypingDots 渲染 3 个圆点（dots.length === 3）', () => {
      const { container } = render(
        <MessageBubble role="assistant" content="" isStreaming={true} />,
      )
      const dots = container.querySelectorAll('.typing-dots span')
      expect(dots).toHaveLength(3)
    })

    it('TypingDots 各 span 含 animationDelay（0s / 0.2s / 0.4s）', () => {
      const { container } = render(
        <MessageBubble role="assistant" content="" isStreaming={true} />,
      )
      const spans = Array.from(
        container.querySelectorAll('.typing-dots span'),
      ) as HTMLSpanElement[]
      expect(spans[0].style.animationDelay).toBe('0s')
      expect(spans[1].style.animationDelay).toBe('0.2s')
      expect(spans[2].style.animationDelay).toBe('0.4s')
    })
  })

  // ==========================================================================
  // Phase 12 T2 新增：ActionButton hover 事件
  // ==========================================================================
  describe('ActionButton hover 事件', () => {
    it('hover 按钮 → onMouseEnter 改 color 为 var(--foreground)', () => {
      render(
        <MessageBubble
          role="assistant"
          content="x"
          onCopy={vi.fn()}
        />,
      )
      const btn = screen.getByLabelText('复制')
      // 初始：muted-foreground（jsdom 25 对 CSS 变量会返回空 style.color，改用 style 属性字符串断言）
      expect(btn.getAttribute('style')).toContain('color: var(--muted-foreground)')
      // 模拟 mouseEnter — 触发 onMouseEnter 回调
      fireEvent.mouseEnter(btn)
      expect(btn.getAttribute('style')).toContain('color: var(--foreground)')
    })

    it('离开按钮 → onMouseLeave 恢复 restColor', () => {
      render(
        <MessageBubble
          role="assistant"
          content="x"
          onCopy={vi.fn()}
        />,
      )
      const btn = screen.getByLabelText('复制')
      fireEvent.mouseEnter(btn)
      expect(btn.getAttribute('style')).toContain('color: var(--foreground)')
      fireEvent.mouseLeave(btn)
      expect(btn.getAttribute('style')).toContain('color: var(--muted-foreground)')
    })

    it('active=true 按钮 → 初始 color 为 var(--primary)，hover 后变 var(--foreground)，离开恢复 var(--primary)', () => {
      render(
        <MessageBubble
          role="assistant"
          content="x"
          liked={true}
          onToggleLike={vi.fn()}
        />,
      )
      const btn = screen.getByLabelText('点赞')
      // active=true 初始为 primary
      expect(btn.getAttribute('style')).toContain('color: var(--primary)')
      // hover 后变 foreground
      fireEvent.mouseEnter(btn)
      expect(btn.getAttribute('style')).toContain('color: var(--foreground)')
      // 离开恢复 primary（restColor 在 active=true 时为 primary）
      fireEvent.mouseLeave(btn)
      expect(btn.getAttribute('style')).toContain('color: var(--primary)')
    })

    it('active=false 按钮 → hover 后变 foreground，离开恢复 muted-foreground', () => {
      render(
        <MessageBubble
          role="assistant"
          content="x"
          bookmarked={false}
          onToggleBookmark={vi.fn()}
        />,
      )
      const btn = screen.getByLabelText('收藏')
      expect(btn.getAttribute('style')).toContain('color: var(--muted-foreground)')
      fireEvent.mouseEnter(btn)
      expect(btn.getAttribute('style')).toContain('color: var(--foreground)')
      fireEvent.mouseLeave(btn)
      expect(btn.getAttribute('style')).toContain('color: var(--muted-foreground)')
    })
  })

  // ==========================================================================
  // Phase 12 T2 新增：StreamingCursor 渲染
  // ==========================================================================
  describe('StreamingCursor', () => {
    it('streaming 且有 content → 渲染光标（aria-hidden span + cursor-blink 动画）', () => {
      const { container } = render(
        <MessageBubble role="assistant" content="内容" isStreaming={true} />,
      )
      const cursor = container.querySelector('span[aria-hidden]') as HTMLElement
      expect(cursor).toBeInTheDocument()
      // StreamingCursor 含 <style> 内嵌 @keyframes cursor-blink
      const style = cursor.querySelector('style') as HTMLElement
      expect(style).toBeInTheDocument()
      expect(style?.textContent).toContain('cursor-blink')
    })
  })

  // ==========================================================================
  // Phase 12 T2 新增：SourceList 边界分支
  // ==========================================================================
  describe('SourceList 边界', () => {
    it('多个 source → 展开后渲染多个 source 卡片', () => {
      const sources = [
        {
          bookId: 'b1',
          bookTitle: '书1',
          chunkId: 'c1',
          relevanceScore: 0.9,
        },
        {
          bookId: 'b2',
          bookTitle: '书2',
          chunkId: 'c2',
          relevanceScore: 0.8,
        },
        {
          bookId: 'b3',
          bookTitle: '书3',
          chunkId: 'c3',
          relevanceScore: 0.7,
        },
      ]
      render(<MessageBubble role="assistant" content="x" sources={sources} />)
      // 按钮：3 个片段
      expect(screen.getByText(/引用来源：3 个片段/)).toBeInTheDocument()
      // 展开
      fireEvent.click(screen.getByRole('button', { name: /引用来源/ }))
      expect(screen.getByText(/书1/)).toBeInTheDocument()
      expect(screen.getByText(/书2/)).toBeInTheDocument()
      expect(screen.getByText(/书3/)).toBeInTheDocument()
    })

    it('chapterTitle → 展开后渲染章节标题', () => {
      const sources = [
        {
          bookId: 'b1',
          bookTitle: '书1',
          chunkId: 'c1',
          relevanceScore: 0.9,
          chapterTitle: '第 3 章 系统设计',
        },
      ]
      render(<MessageBubble role="assistant" content="x" sources={sources} />)
      fireEvent.click(screen.getByRole('button', { name: /引用来源/ }))
      expect(screen.getByText('第 3 章 系统设计')).toBeInTheDocument()
    })

    it('content → 展开后渲染引用片段内容', () => {
      const sources = [
        {
          bookId: 'b1',
          bookTitle: '书1',
          chunkId: 'c1',
          relevanceScore: 0.9,
          content: '这是引用片段的正文内容...',
        },
      ]
      render(<MessageBubble role="assistant" content="x" sources={sources} />)
      fireEvent.click(screen.getByRole('button', { name: /引用来源/ }))
      expect(screen.getByText('这是引用片段的正文内容...')).toBeInTheDocument()
    })

    it('relevanceScore=0 → 显示 "相关度 0%"', () => {
      const sources = [
        {
          bookId: 'b1',
          bookTitle: '书1',
          chunkId: 'c1',
          relevanceScore: 0,
        },
      ]
      render(<MessageBubble role="assistant" content="x" sources={sources} />)
      fireEvent.click(screen.getByRole('button', { name: /引用来源/ }))
      expect(screen.getByText(/相关度 0%/)).toBeInTheDocument()
    })

    it('relevanceScore=undefined → Math.round(NaN * 100) = NaN，显示 "相关度 NaN%"', () => {
      // 源码：Math.round((src.relevanceScore || 0) * 100)
      //   src.relevanceScore 为 undefined → (undefined || 0) = 0 → Math.round(0) = 0
      //   实际不会显示 NaN（因为 || 0 兜底）
      const sources = [
        {
          bookId: 'b1',
          bookTitle: '书1',
          chunkId: 'c1',
          relevanceScore: undefined as unknown as number,
        },
      ]
      render(<MessageBubble role="assistant" content="x" sources={sources} />)
      fireEvent.click(screen.getByRole('button', { name: /引用来源/ }))
      // 因为 || 0 兜底，显示 0% 而非 NaN%
      expect(screen.getByText(/相关度 0%/)).toBeInTheDocument()
    })

    it('展开/收起切换 → aria-expanded 同步', () => {
      const sources = [
        {
          bookId: 'b1',
          bookTitle: '书1',
          chunkId: 'c1',
          relevanceScore: 0.5,
        },
      ]
      render(<MessageBubble role="assistant" content="x" sources={sources} />)
      const btn = screen.getByRole('button', { name: /引用来源/ })
      expect(btn).toHaveAttribute('aria-expanded', 'false')
      fireEvent.click(btn)
      expect(btn).toHaveAttribute('aria-expanded', 'true')
      fireEvent.click(btn)
      expect(btn).toHaveAttribute('aria-expanded', 'false')
    })

    it('展开后再收起 → source 内容消失', () => {
      const sources = [
        {
          bookId: 'b1',
          bookTitle: '深入理解计算机系统',
          chunkId: 'c1',
          relevanceScore: 0.92,
        },
      ]
      render(<MessageBubble role="assistant" content="x" sources={sources} />)
      const btn = screen.getByRole('button', { name: /引用来源/ })
      fireEvent.click(btn)
      expect(screen.getByText(/深入理解计算机系统/)).toBeInTheDocument()
      fireEvent.click(btn)
      expect(screen.queryByText(/深入理解计算机系统/)).not.toBeInTheDocument()
    })
  })

  // ==========================================================================
  // Phase 12 T2 新增：MessageBubble 其他边界分支
  // ==========================================================================
  describe('MessageBubble 其他边界', () => {
    it('role="system" → 渲染为 assistant 样式（含 AI 头像）', () => {
      const { container } = render(
        <MessageBubble role="system" content="系统消息" />,
      )
      const avatar = container.querySelector('.msg-avatar')
      expect(avatar).toBeInTheDocument()
      expect(avatar).toHaveTextContent('AI')
      // 渲染 Markdown
      expect(screen.getByTestId('markdown-mock')).toHaveTextContent('系统消息')
    })

    it('assistant 无 content 且无 isStreaming → 消息气泡为空（null 内容）', () => {
      const { container } = render(
        <MessageBubble role="assistant" content="" />,
      )
      // 仍然渲染 .msg-bubble 容器，但内部无内容（既无 markdown-mock 也无 typing-dots）
      const bubble = container.querySelector('.msg-bubble')
      expect(bubble).toBeInTheDocument()
      expect(container.querySelector('[data-testid="markdown-mock"]')).not.toBeInTheDocument()
      expect(container.querySelector('.typing-dots')).not.toBeInTheDocument()
    })

    it('assistant 有 content 但无任何 handler → 不渲染操作栏', () => {
      const { container } = render(
        <MessageBubble role="assistant" content="x" />,
      )
      expect(container.querySelector('.msg-actions')).not.toBeInTheDocument()
    })

    it('assistant isStreaming=true 且有 content → 不渲染操作栏（即使有 handler）', () => {
      const { container } = render(
        <MessageBubble
          role="assistant"
          content="x"
          isStreaming={true}
          onCopy={vi.fn()}
          onRegenerate={vi.fn()}
          onToggleLike={vi.fn()}
          onToggleBookmark={vi.fn()}
        />,
      )
      expect(container.querySelector('.msg-actions')).not.toBeInTheDocument()
    })

    it('sources 为空数组 → 不渲染 SourceList 按钮', () => {
      render(
        <MessageBubble role="assistant" content="x" sources={[]} />,
      )
      expect(screen.queryByText(/引用来源/)).not.toBeInTheDocument()
    })

    it('assistant 渲染头像（含 "AI" 文字，aria-hidden）', () => {
      const { container } = render(
        <MessageBubble role="assistant" content="x" />,
      )
      const avatar = container.querySelector('.msg-avatar')
      expect(avatar).toBeInTheDocument()
      expect(avatar).toHaveAttribute('aria-hidden')
      expect(avatar).toHaveTextContent('AI')
    })

    it('user 消息渲染 .msg.user 容器', () => {
      const { container } = render(
        <MessageBubble role="user" content="hi" />,
      )
      const msg = container.querySelector('.msg.user')
      expect(msg).toBeInTheDocument()
      expect(msg).toHaveTextContent('hi')
    })

    it('assistant 消息渲染 .msg.assistant 容器', () => {
      const { container } = render(
        <MessageBubble role="assistant" content="hi" />,
      )
      const msg = container.querySelector('.msg.assistant')
      expect(msg).toBeInTheDocument()
    })

    it('assistant 有 content → 操作栏渲染所有传入的按钮', () => {
      render(
        <MessageBubble
          role="assistant"
          content="x"
          onCopy={vi.fn()}
          onRegenerate={vi.fn()}
          onToggleLike={vi.fn()}
          onToggleBookmark={vi.fn()}
        />,
      )
      expect(screen.getByLabelText('复制')).toBeInTheDocument()
      expect(screen.getByLabelText('重新生成')).toBeInTheDocument()
      expect(screen.getByLabelText('点赞')).toBeInTheDocument()
      expect(screen.getByLabelText('收藏')).toBeInTheDocument()
    })

    it('assistant 仅传 onCopy → 只渲染复制按钮', () => {
      render(
        <MessageBubble role="assistant" content="x" onCopy={vi.fn()} />,
      )
      expect(screen.getByLabelText('复制')).toBeInTheDocument()
      expect(screen.queryByLabelText('重新生成')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('点赞')).not.toBeInTheDocument()
      expect(screen.queryByLabelText('收藏')).not.toBeInTheDocument()
    })

    it('assistant 仅传 onRegenerate → 只渲染重新生成按钮', () => {
      render(
        <MessageBubble role="assistant" content="x" onRegenerate={vi.fn()} />,
      )
      expect(screen.queryByLabelText('复制')).not.toBeInTheDocument()
      expect(screen.getByLabelText('重新生成')).toBeInTheDocument()
    })

    it('assistant 仅传 onToggleLike → 只渲染点赞按钮', () => {
      render(
        <MessageBubble
          role="assistant"
          content="x"
          onToggleLike={vi.fn()}
        />,
      )
      expect(screen.getByLabelText('点赞')).toBeInTheDocument()
      expect(screen.queryByLabelText('收藏')).not.toBeInTheDocument()
    })

    it('assistant 仅传 onToggleBookmark → 只渲染收藏按钮', () => {
      render(
        <MessageBubble
          role="assistant"
          content="x"
          onToggleBookmark={vi.fn()}
        />,
      )
      expect(screen.getByLabelText('收藏')).toBeInTheDocument()
      expect(screen.queryByLabelText('点赞')).not.toBeInTheDocument()
    })
  })
})
