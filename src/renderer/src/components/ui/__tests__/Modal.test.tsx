// Modal 弹层原语行为测试
//
// 钉住原语承诺：dialog 语义、ESC/遮罩关闭、面板内点击不冒泡关闭、
// 焦点陷阱、进入聚焦、卸载回焦、抽屉变体。

import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import Modal from '../Modal'

describe('ui/Modal', () => {
  it('渲染 dialog 语义与标题', () => {
    render(
      <Modal onClose={() => {}} title="编辑资料">
        <button type="button">保存</button>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAccessibleName('编辑资料')
  })

  it('ESC 触发 onClose', () => {
    const onClose = vi.fn()
    render(
      <Modal onClose={onClose} title="t">
        <button type="button">x</button>
      </Modal>,
    )
    fireEvent.keyDown(window.document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('点击遮罩关闭，点击面板内部不关闭', () => {
    const onClose = vi.fn()
    const { container } = render(
      <Modal onClose={onClose} title="t">
        <button type="button">inner</button>
      </Modal>,
    )
    const overlay = container.firstElementChild as HTMLElement
    fireEvent.click(screen.getByRole('button', { name: 'inner' }))
    expect(onClose).not.toHaveBeenCalled()
    fireEvent.click(overlay)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('头部关闭按钮触发 onClose', () => {
    const onClose = vi.fn()
    render(
      <Modal onClose={onClose} title="t">
        <span>body</span>
      </Modal>,
    )
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('进入时聚焦第一个可聚焦元素', async () => {
    render(
      <Modal onClose={() => {}} title="t">
        <button type="button">first</button>
        <button type="button">second</button>
      </Modal>,
    )
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus()
    })
  })

  it('卸载时把焦点还给打开前的元素', async () => {
    const trigger = document.createElement('button')
    document.body.appendChild(trigger)
    trigger.focus()
    const { unmount } = render(
      <Modal onClose={() => {}} title="t">
        <button type="button">x</button>
      </Modal>,
    )
    // 带标题时首个可聚焦元素 = 头部关闭按钮
    await waitFor(() => expect(screen.getByRole('button', { name: '关闭' })).toHaveFocus())
    unmount()
    expect(trigger).toHaveFocus()
    trigger.remove()
  })

  it('Tab 焦点陷阱：末元素 Tab 回首位，首元素 Shift+Tab 到末位', async () => {
    render(
      <Modal onClose={() => {}} padded={false} ariaLabel="drawer">
        <button type="button">a</button>
        <button type="button">b</button>
      </Modal>,
    )
    const b = screen.getByRole('button', { name: 'b' })
    await waitFor(() => expect(b.parentElement).toHaveTextContent('ab'))
    b.focus()
    fireEvent.keyDown(window.document, { key: 'Tab' })
    expect(screen.getByRole('button', { name: 'a' })).toHaveFocus()
    fireEvent.keyDown(window.document, { key: 'Tab', shiftKey: true })
    expect(b).toHaveFocus()
  })

  it('抽屉变体：面板撑满高度且支持 ariaLabel', () => {
    render(
      <Modal onClose={() => {}} variant="drawer-left" ariaLabel="历史对话" padded={false}>
        <button type="button">x</button>
      </Modal>,
    )
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAccessibleName('历史对话')
    expect(dialog.getAttribute('style')).toContain('height: 100%')
  })
})
