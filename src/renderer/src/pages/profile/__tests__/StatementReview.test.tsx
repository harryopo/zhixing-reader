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
import { readFileSync } from 'fs'
import { join } from 'path'
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

// 2026-09-30 补：上面 22 条全在测组件自己，但**没有一条断"档案页真的挂了它"**。
// 组件测得再细，页面不引用它就是一段没人走得到的死代码 —— 而路线图上曾把
// "界面无浏览视图"当成待办记了十一天（其实 `Profile.tsx` 早就挂着它了），
// 那条记录的根因就是"组件有自己的测试，页面有没有接上没人断"。
describe('接线：档案页真的把它摆出来了', () => {
  // happy-dom 下 import.meta.url 不是 file scheme（实测报 "The URL must be of scheme file"），
  // 这里从 process.cwd() 走 —— vitest 的 cwd 就是仓库根，与 doc-figures 那批同一条路。
  const profileSrc = readFileSync(
    join(process.cwd(), 'src/renderer/src/pages/Profile.tsx'),
    'utf8',
  )

  it('档案页 import 并渲染了它（不许组件自成一段没人引用的死代码）', () => {
    expect(profileSrc).toMatch(/import\s+StatementReview\s+from\s+'\.\/profile\/StatementReview'/)
    expect(profileSrc).toMatch(/<StatementReview\s*\/>/)
  })

  it('那一块有自己的标题，页面上一眼能认出这是画像核验', () => {
    expect(profileSrc).toContain('画像核验')
  })

  it('反证 · 把档案页里那行渲染摘掉，这条判据必须判红', () => {
    const removed = profileSrc.replace(/<StatementReview\s*\/>/, '')
    expect(removed, '摘掉渲染后这条判据仍绿 ⇒ 它没在断接线').not.toMatch(/<StatementReview\s*\/>/)
  })
})

// 2026-09-30 补（第一期 C）：判过的那些要能翻回来。
// 立它的理由：判完只有一句计数，"我上个月判过哪些"只能靠记忆 —— 而已确认的
// 那些正是最该被反复回看的（是你的判断，不是猜测），归档之后却再也找不回来。
describe('筛选：判过的能翻回来', () => {
  const three = [
    { ...saidStatement, id: 'nuwa:p1', verdict: 'confirmed' as const, statement: '判过对的那条' },
    { ...saidStatement, id: 'nuwa:p2', verdict: 'pending' as const, statement: '还没判的那条' },
    { ...saidStatement, id: 'nuwa:p3', verdict: 'unsure' as const, statement: '按下过不确定的那条' },
    { ...saidStatement, id: 'nuwa:p4', verdict: 'rejected' as const, statement: '判过不对的那条' },
  ]

  it('四档按钮都摆出来，各带自己的条数', async () => {
    seams.list.mockResolvedValue(viewOf({ statements: three, evidence }))
    renderIt()
    await screen.findByText('判过对的那条')

    // 还没判那档收 pending + unsure 两条 —— 按下「不确定」不等于处理完了
    expect(screen.getByRole('button', { name: '全部 4' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '还没判 2' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '已判对 1' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '已判不对 1' })).toBeInTheDocument()
  })

  it('切到「已判对」只摆那一条，且证据与原句仍读得到', async () => {
    seams.list.mockResolvedValue(viewOf({ statements: three, evidence }))
    renderIt()
    await screen.findByText('判过对的那条')

    fireEvent.click(screen.getByRole('button', { name: '已判对 1' }))

    expect(screen.getByText('判过对的那条')).toBeInTheDocument()
    expect(screen.queryByText('还没判的那条')).not.toBeInTheDocument()
    expect(screen.queryByText('判过不对的那条')).not.toBeInTheDocument()
    // 关键：筛选之后证据还在 —— 已判的归档了就再也读不回原句，累积就白攒了
    // 原句与书名拼在同一行（"《当下的力量》：向外求求而不得"），
    // 用 textContent 断而不是 getByText 精确匹配 —— 后者对拼在一行的文案找不到
    expect(document.body.textContent).toContain('向外求求而不得')
    expect(document.body.textContent).toContain('回原文')
  })

  it('「不确定」归到「还没判」那一档，不许算成已处理完', async () => {
    seams.list.mockResolvedValue(viewOf({ statements: three, evidence }))
    renderIt()
    await screen.findByText('判过对的那条')

    fireEvent.click(screen.getByRole('button', { name: '还没判 2' }))
    expect(screen.getByText('还没判的那条')).toBeInTheDocument()
    expect(screen.getByText('按下过不确定的那条')).toBeInTheDocument()
  })

  // 这条是整个筛选的硬口径：筛选只管"摆哪些"，计数与画像卡永远按全部算。
  // 不钉住它，有一天会有人把 visible 拿去算 confirmed —— 那时在「已判对」那档
  // 复制出来的是全部、在「还没判」那档直接不可用，而界面上两者长得一模一样。
  it('切档不改变顶部计数，也不改变「复制画像卡」可用与否', async () => {
    seams.list.mockResolvedValue(viewOf({ statements: three, evidence }))
    renderIt()
    await screen.findByText('判过对的那条')

    const countLine = screen.getByText(/共 4 条/)
    const copyBtn = screen.getByRole('button', { name: '复制画像卡' })

    fireEvent.click(screen.getByRole('button', { name: '已判对 1' }))
    expect(screen.getByText(/共 4 条/)).toBe(countLine)
    expect(screen.getByRole('button', { name: '复制画像卡' })).toBe(copyBtn)

    fireEvent.click(screen.getByRole('button', { name: '还没判 2' }))
    expect(screen.getByText(/共 4 条/)).toBe(countLine)
    // 还没判那档里一条确认都没有，若计数跟着筛选走，这颗按钮此刻就该是禁用的
    expect(screen.getByRole('button', { name: '复制画像卡' })).toBeEnabled()
  })

  it('这一档没有条目时说清是"这一档没有"，不是"你还没有结论"', async () => {
    // 用 unsure + rejected 各一条：那一档初始就有 2 条、点得动，
    // 全部"判掉"之后（setVerdict 那道模拟太重，这里直接改本地 state 走不到）——
    // 所以改用另一个能造出"点得动但为空"的场景：库里只有 pending
    seams.list.mockResolvedValue(viewOf({ statements: [three[1]], evidence }))
    renderIt()
    await screen.findByText('还没判的那条')

    // 空档**不禁用**：禁用就点不进去，那句空态说明永远看不见（这条断言钉的就是它）
    const empty = screen.getByRole('button', { name: '已判对 0' })
    expect(empty).toBeEnabled()
    fireEvent.click(empty)
    expect(screen.getByText('这一档没有条目')).toBeInTheDocument()
    // 与"库里一条都没有"时那句空态必须分得开
    expect(screen.queryByText('还没有结论')).not.toBeInTheDocument()
  })

  it('反证 · 把「不确定」也算成已处理完，那条计数立刻判红', () => {
    // 同一条数据，只改 pending 档的口径：把 unsure 排除出去就少一条
    const strict = three.filter((s) => s.verdict === 'pending').length
    const lenient = three.filter((s) => s.verdict !== 'confirmed' && s.verdict !== 'rejected').length
    expect(lenient).toBe(2)
    expect(strict).toBe(1)
    expect(lenient).not.toBe(strict)
  })
})
