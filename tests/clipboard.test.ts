// @vitest-environment happy-dom
/**
 * 剪贴板那一层（画像卡与分享文本共用一份）。
 *
 * 判的是"复制没成得说没成"：WebView 里 `navigator.clipboard` 可能被权限拒，
 * 静默报一句"已复制"等于让用户以为外部 AI 那边已经拿到画像卡了。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { copyToClipboard } from '../src/renderer/src/utils/clipboard'

function setClipboard(value: { writeText: (text: string) => Promise<void> } | undefined) {
  Object.defineProperty(window.navigator, 'clipboard', { value, configurable: true })
}

beforeEach(() => {
  setClipboard(undefined)
})

afterEach(() => {
  setClipboard(undefined)
  vi.restoreAllMocks()
})

function setExecCommand(impl: ((command: string) => boolean) | undefined) {
  // happy-dom 根本没有 document.execCommand 这个成员，spyOn 会报"不存在"，
  // 所以手动挂一个可配置的属性（挂了就要在 afterEach 摘掉）
  Object.defineProperty(document, 'execCommand', { value: impl, configurable: true, writable: true })
}

describe('copyToClipboard', () => {
  it('剪贴板可用时走它，且交回 true', async () => {
    const writeText = vi.fn(async () => undefined)
    setClipboard({ writeText })

    expect(await copyToClipboard('画像卡正文')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('画像卡正文')
  })

  it('剪贴板写的时候报错 ⇒ 交回 false，且不去动那条兜底的 textarea（成功与否只说一次）', async () => {
    setClipboard({
      writeText: async () => {
        throw new Error('权限被拒')
      },
    })

    expect(await copyToClipboard('x')).toBe(false)
    expect(document.body.querySelector('textarea')).toBeNull()
  })

  it('没有剪贴板时退到 textarea + execCommand，用完把临时节点摘掉', async () => {
    const execCommand = vi.fn(() => true)
    setExecCommand(execCommand)

    expect(await copyToClipboard('退路也走得通')).toBe(true)
    expect(execCommand).toHaveBeenCalledWith('copy')
    expect(document.body.querySelector('textarea')).toBeNull()
  })

  it('退路说没复制成时交回 false（不报成功）', async () => {
    setExecCommand(() => false)
    expect(await copyToClipboard('两边都不行')).toBe(false)
  })

  it('这个环境连 execCommand 都没有时不崩，交回 false', async () => {
    setExecCommand(undefined)
    expect(await copyToClipboard('老环境')).toBe(false)
  })
})
