// @vitest-environment happy-dom
/**
 * 画像核验区（StatementReview）的界面行为。
 *
 * 立它的理由：这一块决定"哪些结论算你本人的"。三个形状最容易出错而都不报错：
 *  1) 读失败被演成"你还没有画像结论"（本项目治过第九次的那个形状）；
 *  2) 按下判定后界面报了成功、库里其实没这一条；
 *  3) 「还没判的有几条」被漏掉，只剩一个好看的确认率。
 * 判据照旧：fake 的 `window.electronAPI` 只打在渲染层与主进程之间那一条缝上，
 * 分组、计数、文案与按钮可用态全走组件自己的代码。
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import StatementReview from '../StatementReview'
import type { StatementListView } from '../../../../../shared/profile-statements'

const seams = vi.hoisted(() => ({
  list: vi.fn(),
  importStatements: vi.fn(),
  setVerdict: vi.fn(),
  copy: vi.fn(),
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn() },
}))

vi.mock('../../../stores/toastStore', () => ({ toast: seams.toast }))
vi.mock('../../../utils/clipboard', () => ({ copyToClipboard: seams.copy }))

const EMPTY: StatementListView = { statements: [], evidence: {} }

function viewOf(over: Partial<StatementListView> = {}): StatementListView {
  return { ...EMPTY, ...over }
}

const saidStatement = {
  id: 'nuwa:p1',
  layer: 'said' as const,
  topic: '表达',
  statement: '我写东西短、直白',
  evidenceIds: ['hl_1#note', 'hl_2'],
  verdict: 'pending' as const,
  origin: 'nuwa' as const,
  createdAt: '2026-09-30 00:00:00',
  updatedAt: '2026-09-30 00:00:00',
}

const evidence = {
  'hl_1#note': { text: '向外求求而不得', bookId: 'b1', bookTitle: '当下的力量', highlightId: 'hl_1' },
  hl_2: { text: '请观察你内在的任何一种防卫感', bookId: 'b1', bookTitle: '当下的力量', highlightId: 'hl_2' },
}

function renderIt() {
  return render(
    <MemoryRouter>
      <LocationProbe />
      <StatementReview />
    </MemoryRouter>,
  )
}

/** 记下最后一次落点，断"回原文真的点得到那一处"用 */
function LocationProbe() {
  const { pathname, search } = useLocation()
  ;(globalThis as unknown as Record<string, unknown>).lastPath = `${pathname}${search}`
  return null
}

beforeEach(() => {
  seams.list.mockReset().mockResolvedValue(viewOf())
  seams.importStatements.mockReset()
  seams.setVerdict.mockReset().mockResolvedValue({ recorded: true })
  seams.copy.mockReset().mockResolvedValue(true)
  seams.toast.success.mockReset()
  seams.toast.info.mockReset()
  seams.toast.error.mockReset()
  ;(window as unknown as Record<string, unknown>).electronAPI = {
    profile: { listStatements: seams.list, importStatements: seams.importStatements, setStatementVerdict: seams.setVerdict },
  }
})

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).electronAPI
})

describe('进页面读一次', () => {
  it('一条结论都没有时说的是"还没有"，并给出口', async () => {
    renderIt()
    expect(await screen.findByText(/这里还没有画像结论/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入结论清单' })).toBeInTheDocument()
  })

  it('读失败说的是"这一次没读出来"，不演成"你还没有画像结论"', async () => {
    seams.list.mockRejectedValue(new Error('库文件被占用'))
    renderIt()

    expect(await screen.findByText(/这一次没读出来：库文件被占用/)).toBeInTheDocument()
    expect(screen.queryByText(/这里还没有画像结论/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '再读一次' })).toBeInTheDocument()
  })

  it('点「再读一次」会重新去读', async () => {
    seams.list.mockRejectedValueOnce(new Error('炸了'))
    renderIt()
    await screen.findByText(/这一次没读出来/)

    fireEvent.click(screen.getByRole('button', { name: '再读一次' }))

    await waitFor(() => expect(seams.list).toHaveBeenCalledTimes(2))
    expect(await screen.findByText(/这里还没有画像结论/)).toBeInTheDocument()
  })

  it('没有 electronAPI（preload 没加载成）时不崩、也不假装读到了东西', async () => {
    delete (window as unknown as Record<string, unknown>).electronAPI

    renderIt()

    await waitFor(() => expect(seams.list).not.toHaveBeenCalled())
    expect(document.body.textContent).toContain('正在读你的画像结论')
  })

  it('摆出结论正文、层标签、话题与"还没判"', async () => {
    seams.list.mockResolvedValue(viewOf({ statements: [saidStatement], evidence }))
    renderIt()

    expect(await screen.findByText('我写东西短、直白')).toBeInTheDocument()
    expect(screen.getByText('我说')).toBeInTheDocument()
    expect(screen.getByText('表达')).toBeInTheDocument()
    expect(screen.getByText('还没判')).toBeInTheDocument()
  })
})

describe('按下判定', () => {
  it('点「对」把这条记下来，然后按库里的样子重读（不在本地攒一份副本）', async () => {
    seams.list.mockResolvedValue(viewOf({ statements: [saidStatement], evidence }))
    renderIt()
    await screen.findByText('我写东西短、直白')

    fireEvent.click(screen.getByRole('button', { name: '对' }))

    await waitFor(() => expect(seams.setVerdict).toHaveBeenCalledWith('nuwa:p1', 'confirmed'))
    await waitFor(() => expect(seams.list).toHaveBeenCalledTimes(2))
    expect(seams.toast.success).toHaveBeenCalledWith('记下了：对')
  })

  it('三颗按钮各自按下各的取值，aria-pressed 只亮当前那一颗', async () => {
    seams.list.mockResolvedValue(viewOf({ statements: [{ ...saidStatement, verdict: 'unsure' }], evidence }))
    renderIt()
    await screen.findByText('我写东西短、直白')

    expect(screen.getByRole('button', { name: '不确定' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: '对' })).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: '不对' }))
    await waitFor(() => expect(seams.setVerdict).toHaveBeenCalledWith('nuwa:p1', 'rejected'))
  })

  it('库里已经没有这一条时报"没记上"，不许报成功', async () => {
    seams.list.mockResolvedValue(viewOf({ statements: [saidStatement], evidence }))
    seams.setVerdict.mockResolvedValue({ recorded: false })
    renderIt()
    await screen.findByText('我写东西短、直白')

    fireEvent.click(screen.getByRole('button', { name: '对' }))

    await waitFor(() => expect(seams.toast.info).toHaveBeenCalledWith('这条结论已经不在库里了，所以没记上'))
    expect(seams.toast.success).not.toHaveBeenCalled()
  })

  it('写库报错时报错，不把失败演成已判', async () => {
    seams.list.mockResolvedValue(viewOf({ statements: [saidStatement], evidence }))
    seams.setVerdict.mockRejectedValue(new Error('通道断了'))
    renderIt()
    await screen.findByText('我写东西短、直白')

    fireEvent.click(screen.getByRole('button', { name: '对' }))

    await waitFor(() => expect(seams.toast.error).toHaveBeenCalledWith('没记上：通道断了'))
    expect(seams.toast.success).not.toHaveBeenCalled()
  })
})

describe('支撑它的原句', () => {
  it('证据读得到就摆原句，并给一颗点得回那一处的按钮', async () => {
    seams.list.mockResolvedValue(viewOf({ statements: [saidStatement], evidence }))
    renderIt()
    await screen.findByText('我写东西短、直白')

    expect(screen.getByText(/向外求求而不得/)).toBeInTheDocument()

    fireEvent.click(screen.getAllByRole('button', { name: '跳回这条划线' })[0])
    await waitFor(() =>
      expect((globalThis as unknown as Record<string, unknown>).lastPath).toBe('/bookshelf/b1?tab=highlights&highlight=hl_1'),
    )
  })

  it('库里对不上的那条说的是"已经找不到了"，且不摆点不动的按钮', async () => {
    seams.list.mockResolvedValue(viewOf({ statements: [{ ...saidStatement, evidenceIds: ['hl_1#note', 'hl_gone'] }], evidence }))
    renderIt()
    await screen.findByText('我写东西短、直白')

    expect(await screen.findByText(/这条证据在你的语料里已经找不到了/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: '跳回这条划线' })).toHaveLength(1)
  })

  it('超过三条证据时如实说还有几条没展开', async () => {
    seams.list.mockResolvedValue(
      viewOf({
        statements: [{ ...saidStatement, evidenceIds: ['hl_1#note', 'hl_2', 'hl_3', 'hl_4'] },],
        evidence,
      }),
    )
    renderIt()
    await screen.findByText('我写东西短、直白')

    expect(screen.getByText('另有 1 条证据没展开')).toBeInTheDocument()
  })
})

describe('计数与画像卡', () => {
  it('未核验的条数必须摆在确认数旁边，不许只报一个好看的比数', async () => {
    seams.list.mockResolvedValue(
      viewOf({
        statements: [
          { ...saidStatement, verdict: 'confirmed' },
          { ...saidStatement, id: 'nuwa:p2', statement: '还没人判的那条' },
        ],
        evidence,
      }),
    )
    renderIt()
    await screen.findByText('我写东西短、直白')

    expect(screen.getByText('共 2 条 · 你判过「对」的 1 条 · 还没判的 1 条')).toBeInTheDocument()
  })

  it('一条都没确认时「复制画像卡」不可用（空的画像卡贴出去只会被编）', async () => {
    seams.list.mockResolvedValue(viewOf({ statements: [saidStatement], evidence }))
    renderIt()
    await screen.findByText('我写东西短、直白')

    expect(screen.getByRole('button', { name: '复制画像卡' })).toBeDisabled()
    expect(seams.copy).not.toHaveBeenCalled()
  })

  it('有确认的就能复制，且复制的是只含「对」的那几条', async () => {
    seams.list.mockResolvedValue(
      viewOf({
        statements: [
          { ...saidStatement, verdict: 'confirmed' },
          { ...saidStatement, id: 'nuwa:p2', statement: '没判过的不进卡', verdict: 'pending' },
        ],
        evidence,
      }),
    )
    renderIt()
    await screen.findByText('我写东西短、直白')

    fireEvent.click(screen.getByRole('button', { name: '复制画像卡' }))

    await waitFor(() => expect(seams.copy).toHaveBeenCalledTimes(1))
    const text = String(seams.copy.mock.calls[0][0])
    expect(text).toContain('我写东西短、直白')
    expect(text).not.toContain('没判过的不进卡')
  })

  it('剪贴板用不了时报错，不许静默"已复制"', async () => {
    seams.list.mockResolvedValue(viewOf({ statements: [{ ...saidStatement, verdict: 'confirmed' }], evidence }))
    seams.copy.mockResolvedValue(false)
    renderIt()
    await screen.findByText('我写东西短、直白')

    fireEvent.click(screen.getByRole('button', { name: '复制画像卡' }))

    await waitFor(() => expect(seams.toast.error).toHaveBeenCalledWith('剪贴板用不了，画像卡没复制成功'))
    expect(seams.toast.success).not.toHaveBeenCalled()
  })
})

describe('导入', () => {
  it('已经有结论时也能从表头那颗「导入新的」再导一份', async () => {
    seams.list.mockResolvedValue(viewOf({ statements: [saidStatement], evidence }))
    seams.importStatements.mockResolvedValue({ saved: true, summary: '收下 3 条画像结论', written: 3 })
    renderIt()
    await screen.findByText('我写东西短、直白')

    fireEvent.click(screen.getByRole('button', { name: '导入新的' }))

    await waitFor(() => expect(seams.importStatements).toHaveBeenCalledTimes(1))
    expect(seams.toast.success).toHaveBeenCalledWith('收下 3 条画像结论', 8000)
  })

  it('导入成功后按真实结果提示并重读一次', async () => {
    seams.importStatements.mockResolvedValue({ saved: true, summary: '收下 2 条画像结论', written: 2 })
    renderIt()
    await screen.findByText(/这里还没有画像结论/)

    fireEvent.click(screen.getByRole('button', { name: '导入结论清单' }))

    await waitFor(() => expect(seams.importStatements).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(seams.list).toHaveBeenCalledTimes(2))
    expect(seams.toast.success).toHaveBeenCalledWith('收下 2 条画像结论', 8000)
  })

  it('取消与"一条没过闸"都走 info，不走 success', async () => {
    seams.importStatements.mockResolvedValue({ saved: false, summary: '一条都没收下 · 1 条没动或没收：证据不足两条 1 条', written: 0, reason: 'nothing_accepted' })
    renderIt()
    await screen.findByText(/这里还没有画像结论/)

    fireEvent.click(screen.getByRole('button', { name: '导入结论清单' }))

    await waitFor(() => expect(seams.toast.info).toHaveBeenCalledWith('一条都没收下 · 1 条没动或没收：证据不足两条 1 条', 8000))
    expect(seams.toast.success).not.toHaveBeenCalled()
  })

  it('导入这条路炸了时报错（读文件失败不演成"没有结论"）', async () => {
    seams.importStatements.mockRejectedValue(new Error('这个文件读不了'))
    renderIt()
    await screen.findByText(/这里还没有画像结论/)

    fireEvent.click(screen.getByRole('button', { name: '导入结论清单' }))

    await waitFor(() => expect(seams.toast.error).toHaveBeenCalledWith('导入失败：这个文件读不了'))
  })
})
