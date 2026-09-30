// @vitest-environment happy-dom
/**
 * 顶栏通知面板的四路读数。
 *
 * 立它的理由：这块是本项目反复治的「把失败演成没有数据」最后落着的地方 ——
 * 面板那两句「暂无新笔记」「（不摆）摘要待更新」在原写法里与"这一次没读出来"
 * 交出同一个形状：划线读失败时 `catch(() => [])` ⇒ 计数 0 ⇒ 界面替用户断言
 * "你没有新笔记"。一张关于他自己数据库的假陈述，不报错也不红。
 *
 * 判据照旧：fake 的 `window.electronAPI` 只打在渲染层与主进程之间那一条缝上，
 * 计数、文案、红点与"哪一层坏了"全走组件自己的代码。
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import Topbar from '../Topbar'

const seams = vi.hoisted(() => ({
  getAllHighlights: vi.fn(),
  queueStats: vi.fn(),
  pendingSummaries: vi.fn(),
  settingsGet: vi.fn(),
}))

/** 一条划线只需要 createdAt（映射之后的形状）参与未读判定 */
function highlight(createdOffsetMs: number) {
  return {
    id: `h${createdOffsetMs}`,
    book_id: 'b1',
    content: '正文',
    created_at: new Date(Date.now() + createdOffsetMs).toISOString(),
  }
}

function installApi() {
  Object.defineProperty(window, 'electronAPI', {
    configurable: true,
    value: {
      update: { getStatus: vi.fn().mockResolvedValue({ status: 'not-available', version: '1.3.4' }) },
      onUpdateStatus: vi.fn().mockReturnValue(() => {}),
      onSyncBookshelf: vi.fn().mockReturnValue(() => {}),
      onWereadAutoSyncStatus: vi.fn().mockReturnValue(() => {}),
      onPersistError: vi.fn().mockReturnValue(() => {}),
      highlight: { getAll: seams.getAllHighlights },
      card: { getQueueStats: seams.queueStats },
      summary: { pending: seams.pendingSummaries },
      settings: { get: seams.settingsGet },
    },
  })
}

async function openPanel() {
  fireEvent.click(screen.getByRole('button', { name: '通知' }))
  await waitFor(() => expect(screen.getByRole('dialog', { name: '通知' })).toBeInTheDocument())
}

beforeEach(() => {
  localStorage.clear()
  installApi()
  seams.getAllHighlights.mockReset().mockResolvedValue([])
  seams.queueStats.mockReset().mockResolvedValue({ actionable: 0 })
  seams.pendingSummaries.mockReset().mockResolvedValue([])
  seams.settingsGet.mockReset().mockResolvedValue('')
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('未读笔记那一句', () => {
  it('划线读失败时说「这一次没读出来」，不替用户断言他没有新笔记', async () => {
    seams.getAllHighlights.mockRejectedValue(new Error('db down'))
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    )
    await openPanel()

    await waitFor(() =>
      expect(document.body.textContent).toContain('笔记列表这一次没读出来'),
    )
    expect(document.body.textContent).not.toContain('暂无新笔记')
  })

  it('正向对照：读成功且确实没有新笔记时，照旧说「暂无新笔记」', async () => {
    seams.getAllHighlights.mockResolvedValue([])
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    )
    await openPanel()

    await waitFor(() => expect(document.body.textContent).toContain('暂无新笔记'))
    expect(document.body.textContent).not.toContain('没读出来')
  })

  it('读成功且有一条新笔记时报数，也不带失败那句', async () => {
    seams.getAllHighlights.mockResolvedValue([highlight(60_000)])
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    )
    await openPanel()

    await waitFor(() => expect(document.body.textContent).toContain('1 条新笔记待查看'))
    expect(document.body.textContent).not.toContain('没读出来')
  })
})

describe('摘要待更新那一句', () => {
  it('读失败时明说没读出来，而不是整块不摆（不摆 = 界面在说"没有书欠更新"）', async () => {
    seams.pendingSummaries.mockRejectedValue(new Error('db down'))
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    )
    await openPanel()

    await waitFor(() => expect(document.body.textContent).toContain('摘要新鲜度这一次没读出来'))
  })

  it('正向对照：读成功且为空时不摆那句', async () => {
    seams.pendingSummaries.mockResolvedValue([])
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    )
    await openPanel()

    await waitFor(() => expect(seams.pendingSummaries).toHaveBeenCalled())
    expect(document.body.textContent).not.toContain('摘要新鲜度这一次没读出来')
  })

  it('读成功且有欠更新的书时照常报数，不带失败那句', async () => {
    seams.pendingSummaries.mockResolvedValue([
      { bookId: 'b1', title: '当下的力量', pendingChapters: 2 },
    ])
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    )
    await openPanel()

    await waitFor(() =>
      expect(document.body.textContent).toContain('1 本书划线有变化，摘要待更新'),
    )
    expect(document.body.textContent).not.toContain('摘要新鲜度这一次没读出来')
  })
})

describe('一层坏了不许把另一层带走', () => {
  it('划线炸了，复习卡数照常显示', async () => {
    seams.getAllHighlights.mockRejectedValue(new Error('db down'))
    seams.queueStats.mockResolvedValue({ actionable: 3 })
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    )
    await openPanel()

    await waitFor(() => expect(document.body.textContent).toContain('3 张卡片待复习'))
  })

  it('摘要炸了，未读笔记照常报数', async () => {
    seams.getAllHighlights.mockResolvedValue([highlight(60_000)])
    seams.pendingSummaries.mockRejectedValue(new Error('db down'))
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    )
    await openPanel()

    await waitFor(() => expect(document.body.textContent).toContain('1 条新笔记待查看'))
  })
})

describe('复习队列与备份提醒同一条口径', () => {
  it('队列读失败时说「复习队列这一次没读出来」，不说「今日无待复习卡片」', async () => {
    seams.queueStats.mockRejectedValue(new Error('db down'))
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    )
    await openPanel()

    await waitFor(() => expect(document.body.textContent).toContain('复习队列这一次没读出来'))
    expect(document.body.textContent).not.toContain('今日无待复习卡片')
  })

  it('正向对照：队列读到 0 时照旧说「今日无待复习卡片」', async () => {
    seams.queueStats.mockResolvedValue({ actionable: 0 })
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    )
    await openPanel()

    await waitFor(() => expect(document.body.textContent).toContain('今日无待复习卡片'))
    expect(document.body.textContent).not.toContain('复习队列这一次没读出来')
  })

  it('备份时间读失败时不断言「还没有导出过备份」', async () => {
    seams.settingsGet.mockRejectedValue(new Error('db down'))
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    )
    await openPanel()

    await waitFor(() => expect(document.body.textContent).toContain('备份时间这一次没读出来'))
    expect(document.body.textContent).not.toContain('还没有导出过备份')
  })

  it('正向对照：备份时间读到空串时照旧说「还没有导出过备份」', async () => {
    seams.settingsGet.mockResolvedValue('')
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    )
    await openPanel()

    await waitFor(() => expect(document.body.textContent).toContain('还没有导出过备份'))
    expect(document.body.textContent).not.toContain('备份时间这一次没读出来')
  })
})

describe('红点徽标只表示"有新东西"', () => {
  it('只有读失败、没有任何新东西时不亮红点', async () => {
    seams.getAllHighlights.mockRejectedValue(new Error('db down'))
    seams.pendingSummaries.mockRejectedValue(new Error('db down'))
    const { container } = render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    )
    // 红点只在面板收起时摆，而读数只在打开面板时跑一轮 ⇒ 先开一次让它读到东西
    await openPanel()
    await waitFor(() => expect(seams.getAllHighlights).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '通知' }))
    expect(container.querySelector('[data-dom-id="notify-dot"]')).toBeNull()
  })

  it('正向对照：真有 3 张待复习时亮红点', async () => {
    seams.queueStats.mockResolvedValue({ actionable: 3 })
    const { container } = render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    )
    await openPanel()
    await waitFor(() => expect(seams.queueStats).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: '通知' }))
    expect(container.querySelector('[data-dom-id="notify-dot"]')).not.toBeNull()
  })
})

describe('失败态不留在屏上', () => {
  it('这一次读成功了，上一次那句「没读出来」要收回去', async () => {
    seams.getAllHighlights.mockRejectedValueOnce(new Error('db down'))
    render(
      <MemoryRouter>
        <Topbar />
      </MemoryRouter>,
    )
    await openPanel()
    await waitFor(() => expect(document.body.textContent).toContain('没读出来'))

    seams.getAllHighlights.mockResolvedValue([])
    // 关面板再开一次 = 重读一轮
    fireEvent.click(screen.getByRole('button', { name: '通知' }))
    await openPanel()

    await waitFor(() => expect(document.body.textContent).toContain('暂无新笔记'))
    expect(document.body.textContent).not.toContain('没读出来')
  })
})
