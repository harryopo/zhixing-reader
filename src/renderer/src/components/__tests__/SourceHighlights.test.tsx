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
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
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

/**
 * 「读不到」与「库里没有」是两件事（2026-09-29 本批修复）
 *
 * 原来 `.catch(() => null)` 与通道交回空合成同一个 null，于是主进程读失败时界面对
 * 用户说「原始划线已经不在了」—— 关于他自己数据的一句假话。这与文章/生词那两路、
 * 划线检索那一路治的是同一个形状，只是这一处在渲染层。
 */
describe('出处读失败要说读失败', () => {
  beforeEach(() => {
    getById.mockReset()
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      highlight: { getById },
    }
  })
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).electronAPI
  })

  it('通道报错 ⇒ 说「没读出来」，绝不写成「已经不在了」', async () => {
    getById.mockRejectedValue(new Error('主进程炸了'))
    renderIt(['h1'])
    expect(await screen.findByText(/1 条出处这一次没读出来/)).toBeInTheDocument()
    expect(screen.queryByText(/已经不在了/)).not.toBeInTheDocument()
  })

  it('库里真的没有 ⇒ 只说「不在了」，不冒充读失败（两句不许互串）', async () => {
    getById.mockResolvedValue(undefined)
    renderIt(['h-gone'])
    expect(await screen.findByText(/1 条原始划线已经不在了/)).toBeInTheDocument()
    expect(screen.queryByText(/没读出来/)).not.toBeInTheDocument()
  })

  it('混合三态：读到的照常摆、丢的与读失败的各报各的数', async () => {
    getById.mockImplementation((id: string) => {
      if (id === 'ok') {
        return Promise.resolve({ id, book_id: 'book-1', content: '读到的一条', chapter_title: '第一章' })
      }
      if (id === 'gone') return Promise.resolve(null)
      return Promise.reject(new Error('读不动'))
    })
    renderIt(['ok', 'gone', 'bad'])
    expect(await screen.findByText(/读到的一条/)).toBeInTheDocument()
    expect(screen.getByText(/1 条原始划线已经不在了/)).toBeInTheDocument()
    expect(screen.getByText(/1 条出处这一次没读出来/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '跳回这条划线' })).toHaveLength(1)
  })

  it('反证：上面那条不是空转 —— 全都能读到时两句都不出现', async () => {
    getById.mockImplementation((id: string) =>
      Promise.resolve({ id, book_id: 'book-1', content: `划线 ${id}`, chapter_title: '' }),
    )
    renderIt(['a', 'b'])
    await screen.findByText('划线 a')
    expect(screen.queryByText(/已经不在了/)).not.toBeInTheDocument()
    expect(screen.queryByText(/没读出来/)).not.toBeInTheDocument()
  })
})

/** 正文的显示口径：压空白、截断、真空串要说人话 */
describe('划线正文的摆法', () => {
  beforeEach(() => {
    getById.mockReset()
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      highlight: { getById },
    }
  })
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).electronAPI
  })

  it('连续的空白与换行压成一个空格', async () => {
    getById.mockResolvedValue({
      id: 'h1',
      book_id: 'book-1',
      content: '  多   空格\n换行  ',
      chapter_title: '',
    })
    renderIt(['h1'])
    expect(await screen.findByText('多 空格 换行')).toBeInTheDocument()
  })

  it('超 96 字截断并加省略号（详情区不该被一条长划线撑开）', async () => {
    getById.mockResolvedValue({
      id: 'h1',
      book_id: 'book-1',
      content: `开${'头'.repeat(200)}`,
      chapter_title: '',
    })
    renderIt(['h1'])
    const shown = await screen.findByText(/^开头/)
    expect(shown.textContent).toBe(`开${'头'.repeat(95)}…`)
    expect(shown.textContent).toHaveLength(97)
  })

  it('库里正文是空串时如实说「没有正文」，不摆一个空气泡', async () => {
    getById.mockResolvedValue({
      id: 'h1',
      book_id: 'book-1',
      content: '',
      chapter_title: '',
    })
    renderIt(['h1'])
    expect(await screen.findByText(/这条划线没有正文/)).toBeInTheDocument()
  })

  it('混进空 id 时不去查它（历史数据里那批 null 不该变成一个空按钮）', async () => {
    getById.mockImplementation((id: string) =>
      Promise.resolve({ id, book_id: 'book-1', content: `划线 ${id}`, chapter_title: '' }),
    )
    renderIt(['', 'h1'])
    expect(await screen.findByText('划线 h1')).toBeInTheDocument()
    expect(getById).toHaveBeenCalledTimes(1)
    expect(getById).toHaveBeenCalledWith('h1')
    expect(screen.queryByText(/前 3 条/)).not.toBeInTheDocument()
  })

  it('卸载之后再到达的响应不报错（这一支的注销此前从没被跑到）', async () => {
    // React 18 起不再对"卸载后 setState"报警告，所以这条量的是"走一遍不抛 + 界面已拆掉"，
    // 不假装证到了 alive 那道闸本身。
    let resolveRow: (v: unknown) => void = () => {}
    getById.mockReturnValue(
      new Promise((resolve) => {
        resolveRow = resolve
      }),
    )
    const { container, unmount } = renderIt(['h1'])
    unmount()
    resolveRow({ id: 'h1', book_id: 'book-1', content: '迟到的一条', chapter_title: '' })
    await new Promise((r) => setTimeout(r, 0))
    expect(container).toBeEmptyDOMElement()
  })
})

/**
 * 「回原文」点下去真的到得了那条划线。
 *
 * 这一支之前从没被点过（量出来 funcs 66.66 缺的就是那颗按钮的 onClick）。
 * 「摆出一条引文 + 一颗按钮」看着像功能，链接参数或那条 id 传错时表现是点了停在原地，
 * 不报错也不会红 —— 深链的约定（source-anchor）与它唯一的调用方之间必须有一次真点击。
 */
describe('点「回原文」', () => {
  beforeEach(() => {
    getById.mockReset()
    ;(window as unknown as Record<string, unknown>).electronAPI = {
      highlight: { getById },
    }
  })
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).electronAPI
  })

  it('点第 2 条的那颗 ⇒ 带的是第 2 条的 id，不是第一条（每颗按钮认自己那一条）', async () => {
    getById.mockImplementation((id: string) =>
      Promise.resolve({ id, book_id: 'book-1', content: `划线 ${id}`, chapter_title: '' }),
    )
    const locations: string[] = []
    function Probe() {
      const loc = useLocation()
      locations.push(`${loc.pathname}${loc.search}`)
      return null
    }
    render(
      <MemoryRouter>
        <SourceHighlights bookId="book-1" highlightIds={['h1', 'h2']} />
        <Probe />
      </MemoryRouter>,
    )
    await screen.findByText('划线 h1')
    expect(locations).toEqual(['/'])
    const buttons = screen.getAllByRole('button', { name: '跳回这条划线' })
    expect(buttons).toHaveLength(2)

    /*
      拆开报而不是整串比：两条链接只差末尾那一个字符（h1 / h2），
      直接比全串时 vitest 会把公共前缀省略成 `…`，红了也看不出差在哪一段。
      路径 + 完整查询参数集一起断，多一个少一个参数照样红。
    */
    const landed = () => {
      const [path, search] = locations[locations.length - 1].split('?')
      return { path, query: Object.fromEntries(new URLSearchParams(search)) }
    }

    fireEvent.click(buttons[1])
    expect(landed()).toEqual({ path: '/bookshelf/book-1', query: { tab: 'highlights', highlight: 'h2' } })

    fireEvent.click(buttons[0])
    expect(landed()).toEqual({ path: '/bookshelf/book-1', query: { tab: 'highlights', highlight: 'h1' } })
  })
})
