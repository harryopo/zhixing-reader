// @vitest-environment happy-dom
/**
 * 提示条上的动作按钮（现在的唯一用法是删除后的「撤销」）。
 *
 * 立它的理由：撤销整条链路的出口只有这颗按钮 —— 主进程留了现场、IPC 也通了，
 * 但界面上只要这颗按钮没渲染出来、或者 4 秒就自己收掉，用户看到的仍然是
 * 「删完没法拉回来」。这种失败不会报错，只会静默变成"没有这个功能"。
 */
import '@testing-library/jest-dom/vitest'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
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
