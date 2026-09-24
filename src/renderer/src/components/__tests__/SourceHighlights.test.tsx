// @vitest-environment happy-dom
/**
 * 出处区块（SourceHighlights）：卡片/方法论详情里"凭哪条划线"这一栏的行为。
 *
 * 立它的理由：source_highlight_id(s) 存在库里很久，但界面从没读过；
 * 一旦读法写错（读一个不存在的列、或把没有的说成有），表现是"这栏永远空着"
 * 或"摆一段假的引文" —— 两种都没人会发现。
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { SourceHighlights } from '../SourceHighlights'

const getById = vi.fn()

beforeEach(() => {
  getById.mockReset()
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    highlight: { getById },
  }
})

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).electronAPI
})

function renderIt(highlightIds: string[]) {
  return render(
    <MemoryRouter>
      <SourceHighlights bookId="book-1" highlightIds={highlightIds} />
    </MemoryRouter>,
  )
}

describe('出处区块', () => {
  it('没有出处 id 时整栏不渲染（不摆一个"来源不明"占位）', async () => {
    renderIt([])
    expect(screen.queryByText(/出自你的划线/)).not.toBeInTheDocument()
    expect(getById).not.toHaveBeenCalled()
    await Promise.resolve()
  })

  it('有出处时摆出划线正文与章节，并给一条回原文的按钮', async () => {
    getById.mockResolvedValue({
      id: 'h1',
      book_id: 'book-1',
      content: '一切烦恼都来自人际关系',
      chapter_title: '第二夜',
      created_at: '2026-09-01 10:00:00',
    })
    renderIt(['h1'])
    expect(await screen.findByText(/一切烦恼都来自人际关系/)).toBeInTheDocument()
    expect(screen.getByText('第二夜')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '跳回这条划线' })).toBeInTheDocument()
    // 章节名来自 chapter_title 这一真实列，读错列名这里就会空掉
    await waitFor(() => expect(getById).toHaveBeenCalledWith('h1'))
  })

  it('划线已被删除时如实说少了几条，而不是静默少摆', async () => {
    getById.mockResolvedValue(null)
    renderIt(['h-gone'])
    expect(await screen.findByText(/1 条原始划线已经不在了/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '跳回这条划线' })).not.toBeInTheDocument()
  })

  it('一次最多摆 3 条（方法论的来源可能几十条，不能铺成一屏按钮）', async () => {
    getById.mockImplementation((id: string) =>
      Promise.resolve({ id, book_id: 'book-1', content: `划线 ${id}`, chapter_title: '' }),
    )
    renderIt(['a', 'b', 'c', 'd', 'e'])
    await screen.findByText('划线 a')
    expect(screen.getAllByRole('button', { name: '跳回这条划线' })).toHaveLength(3)
    expect(screen.getByText(/前 3 条/)).toBeInTheDocument()
  })
})
