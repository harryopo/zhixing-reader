// @vitest-environment happy-dom
/**
 * 提示条：动作按钮、计时与收起、以及"读屏软件能不能听见这块"。
 *
 * 立它的理由：撤销整条链路的出口只有这颗按钮 —— 主进程留了现场、IPC 也通了，
 * 但界面上只要这颗按钮没渲染出来、或者 4 秒就自己收掉，用户看到的仍然是
 * 「删完没法拉回来」。这种失败不会报错，只会静默变成"没有这个功能"。
 * 同一块对读屏软件也可能是静默的（活动区域必须比内容先存在），那是同一条链的
 * 另一种失败形状，所以计时、关闭、活动区域都在这里钉。
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react'
import ToastContainer from '../Toast'
import { toast, useToastStore } from '../../stores/toastStore'

beforeEach(() => {
  useToastStore.getState().clearAll()
})

afterEach(() => {
  cleanup()
  useToastStore.getState().clearAll()
})

describe('提示条的动作按钮', () => {
  it('带动作的提示会渲染出按钮，点它执行动作且只执行一次', () => {
    const onClick = vi.fn()
    toast.successWithAction('划线已删除', { label: '撤销', onClick })
    render(<ToastContainer />)

    const button = screen.getByRole('button', { name: '撤销' })
    fireEvent.click(button)
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('撤销比常规提示多留几秒：4 秒在读完一句话、伸手去点的路上不够', () => {
    toast.successWithAction('划线已删除', { label: '撤销', onClick: () => {} })
    toast.success('已保存')
    const [undoable, plain] = useToastStore.getState().toasts
    expect(undoable.duration).toBeGreaterThan(plain.duration)
    expect(plain.duration).toBe(4000)
  })

  it('没有动作的提示不渲染按钮（不给界面添一个点了没用的空位）', () => {
    toast.info('普通提示')
    render(<ToastContainer />)
    expect(screen.queryByRole('button', { name: '撤销' })).not.toBeInTheDocument()
    expect(screen.getByText('普通提示')).toBeInTheDocument()
  })

  it('原有三种调用姿势的字段一字不变（动作是加在末尾的可选参数）', () => {
    const id = toast.loading('正在同步…')
    toast.error('删除失败', 9000)
    useToastStore.getState().addToast('普通入队', 'info')
    const toasts = useToastStore.getState().toasts
    expect(toasts.map((t) => [t.type, t.duration, t.action])).toEqual([
      ['loading', 0, undefined],
      ['error', 9000, undefined],
      ['info', 4000, undefined],
    ])
    expect(id).toBeTruthy()
  })
})

/**
 * 提示区必须是一个"先于内容存在"的活动区域（2026-09-29 本批修复）。
 *
 * `aria-live` 有一条已知的坑：**区域要在内容出现之前就已经挂在 DOM 里**，
 * 连同文案一起插入时多数读屏软件不播报。原来这块在清单为空时 `return null`，
 * 于是每一条提示都是"新区域 + 新文案"一起出现 ⇒ 整套提示对辅助技术是静默的，
 * 而「撤销」在界面上只有这一个出口（没有第二个入口可点）。
 */
describe('提示区是一个先于内容存在的活动区域', () => {
  it('一条提示都没有时区域就已经在 DOM 里，且不带任何文案', () => {
    const { getByRole } = render(<ToastContainer />)
    const region = getByRole('log', { name: '提示' })
    expect(region).toHaveAttribute('aria-live', 'polite')
    // aria-atomic=false：来一条只念那一条，而不是每来一条把整块重念一遍
    expect(region).toHaveAttribute('aria-atomic', 'false')
    expect(region).toBeEmptyDOMElement()
  })

  it('后来出现的文案落进的是同一个区域（区域不是每条重建一次）', () => {
    const { getByRole } = render(<ToastContainer />)
    const region = getByRole('log', { name: '提示' })

    act(() => {
      toast.info('第一条')
    })
    expect(within(region).getByText('第一条')).toBeInTheDocument()

    act(() => {
      toast.info('第二条')
    })
    expect(within(region).getByText('第二条')).toBeInTheDocument()
    expect(screen.getAllByRole('log')).toHaveLength(1)
  })
})

describe('关闭键与图标', () => {
  it('关闭键有可及名（图标按钮不给名字，读屏只能播报「按钮」两个字）', () => {
    toast.info('可关的一条')
    render(<ToastContainer />)
    expect(screen.getByRole('button', { name: '关闭这条提示' })).toBeInTheDocument()
  })

  it('反证：loading 那条不摆关闭键、也不摆进度条（它没有"还剩多少"可画）', () => {
    toast.loading('正在同步…')
    const { container } = render(<ToastContainer />)
    expect(screen.queryByRole('button', { name: '关闭这条提示' })).not.toBeInTheDocument()
    expect(screen.getByText('正在同步…')).toBeInTheDocument()
    // 整叠里唯一带行内样式的是进度条的内层，没有它 = 没画进度条
    expect(container.querySelector('div[style]')).toBeNull()
    // loading 的图标是转圈的 div，不是那条 d 为空串的 svg
    expect(container.querySelector('svg')).toBeNull()
  })
})

describe('计时与收起', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  /** 整叠里只有进度条那一层带行内样式（width），用它当句柄 */
  const bar = () => document.querySelector('div[style]')

  it('进度条按真实走过的时间缩短（原来这一段 16ms 一跳，一条判据都没走过）', () => {
    toast.info('会自己收', 4000)
    render(<ToastContainer />)
    expect(bar()?.getAttribute('style')).toContain('width: 100%')

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(bar()?.getAttribute('style')).toContain('width: 50%')

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(bar()?.getAttribute('style')).toContain('width: 0%')
  })

  it('到点先起收起动画，动画走完才把自己从清单里摘掉（提前摘等于看不到收起）', () => {
    toast.info('会自己收', 4000)
    render(<ToastContainer />)

    act(() => {
      vi.advanceTimersByTime(3999)
    })
    expect(useToastStore.getState().toasts).toHaveLength(1)

    // 这一刻只发了收起信号，300ms 动画还在走
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(useToastStore.getState().toasts).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(useToastStore.getState().toasts).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('点关闭键同样是先收起、动画走完再摘掉', () => {
    toast.error('手动关', 9000)
    render(<ToastContainer />)
    fireEvent.click(screen.getByRole('button', { name: '关闭这条提示' }))

    act(() => {
      vi.advanceTimersByTime(299)
    })
    expect(useToastStore.getState().toasts).toHaveLength(1)

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(useToastStore.getState().toasts).toHaveLength(0)
  })

  it('多条并存时点哪条收哪条（不是把整叠一起清掉）', () => {
    toast.info('第一条', 9000)
    toast.error('第二条', 9000)
    render(<ToastContainer />)
    const closes = screen.getAllByRole('button', { name: '关闭这条提示' })
    expect(closes).toHaveLength(2)

    fireEvent.click(closes[0])
    act(() => {
      vi.advanceTimersByTime(300)
    })
    const left = useToastStore.getState().toasts
    expect(left).toHaveLength(1)
    expect(left[0].message).toBe('第二条')
  })

  it('时长填 0 的自定义提示不摆进度条、也不自己收（loading 之外的另一条不走闸）', () => {
    useToastStore.getState().addToast('钉住的一条', 'warning', 0)
    render(<ToastContainer />)
    expect(bar()).toBeNull()
    expect(screen.getByRole('button', { name: '关闭这条提示' })).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(60000)
    })
    expect(useToastStore.getState().toasts).toHaveLength(1)
  })

  it('四种带时长的类型各画一种进度条颜色（严重级别不能长得一模一样）', () => {
    const colors = new Set<string>()
    for (const type of ['success', 'error', 'warning', 'info'] as const) {
      cleanup()
      useToastStore.getState().clearAll()
      useToastStore.getState().addToast(`一条 ${type}`, type, 4000)
      const { unmount } = render(<ToastContainer />)
      const found = bar()
      expect(found?.getAttribute('style')).toContain('width: 100%')
      colors.add(found?.className ?? '')
      unmount()
    }
    expect(colors.size).toBe(4)
  })
})
