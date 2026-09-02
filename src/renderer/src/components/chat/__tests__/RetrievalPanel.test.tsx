// @vitest-environment happy-dom
/**
 * RetrievalPanel 组件测试（Agent「调取知识库」可视化）
 *
 * 覆盖：
 *   - retrieval 为 null / done 空来源 → 不渲染
 *   - start 阶段 → "正在调取知识库…"
 *   - done 阶段 → 各路来源 + 命中数 + 检索方式 + 相关度 + 命中统计
 *   - 有预览的来源点击展开片段
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import RetrievalPanel from '../RetrievalPanel'
import type { RetrievalState } from '../../../stores/chatStore'

describe('RetrievalPanel — 调取知识库可视化', () => {
  it('retrieval 为 null 时不渲染', () => {
    const { container } = render(<RetrievalPanel retrieval={null} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('start 阶段显示"正在调取知识库…"', () => {
    render(<RetrievalPanel retrieval={{ stage: 'start' }} />)
    expect(screen.getByText('正在调取知识库…')).toBeInTheDocument()
  })

  it('done 阶段 sources 为空时不渲染', () => {
    const { container } = render(<RetrievalPanel retrieval={{ stage: 'done', sources: [] }} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('done 阶段展示各路来源 + 命中数 + 检索方式 + 相关度', () => {
    const state: RetrievalState = {
      stage: 'done',
      sources: [
        { name: 'book', label: '书籍笔记', source: 'rag', used: true, itemCount: 3, method: 'semantic', topScore: 0.87, buildTime: 12 },
        { name: 'memory', label: '相关记忆', source: 'memory-service', used: false, itemCount: 0, method: 'keyword', buildTime: 3 },
      ],
    }
    render(<RetrievalPanel retrieval={state} />)
    expect(screen.getByText('调取知识库')).toBeInTheDocument()
    expect(screen.getByText('1/2 路命中')).toBeInTheDocument()
    expect(screen.getByText('书籍笔记')).toBeInTheDocument()
    expect(screen.getByText('语义检索')).toBeInTheDocument()
    expect(screen.getByText('3 条命中 · 87%')).toBeInTheDocument()
    expect(screen.getByText('无命中')).toBeInTheDocument()
  })

  it('点击有预览的来源展开片段', () => {
    const state: RetrievalState = {
      stage: 'done',
      sources: [
        {
          name: 'book',
          label: '书籍笔记',
          source: 'rag',
          used: true,
          itemCount: 1,
          method: 'semantic',
          topScore: 0.9,
          buildTime: 10,
          previews: [{ title: '第1章', snippet: '元认知是对思考的思考' }],
        },
      ],
    }
    render(<RetrievalPanel retrieval={state} />)
    // 预览初始不可见
    expect(screen.queryByText('元认知是对思考的思考')).not.toBeInTheDocument()
    // 点击来源行展开
    fireEvent.click(screen.getByText('书籍笔记'))
    expect(screen.getByText('第1章')).toBeInTheDocument()
    expect(screen.getByText('元认知是对思考的思考')).toBeInTheDocument()
  })
})
