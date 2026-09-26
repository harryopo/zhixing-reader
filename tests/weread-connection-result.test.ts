// @vitest-environment happy-dom
// firstBookTitle 这条路要有人真的走到界面上（2026-09-26）
//
// 这个字段在服务接口、preload、renderer.d.ts 里**声明了三处**，而 `testConnection`
// 从来不产出它 —— `SettingsWeRead.tsx` 顶上那行注释还写着"结果显示第一本书标题"。
// 补上产出之后，这里钉两件事：
//  1) store 要把它从主进程交回的结果里**带进 state**（这一层以前直接把它丢了，
//     所以就算主进程产出了，界面还是看不见 —— 声明与产出之间断的就是这一环）；
//  2) 页面那句提示要真的用上它（最后一英里用源码形状钉，不是只验"名字出现过"）。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { useSettingsStore } from '../src/renderer/src/stores/settingsStore'

type TestResult = Awaited<ReturnType<typeof window.electronAPI.weread.test>>

const testMock = vi.fn<(key: string) => Promise<TestResult>>()

beforeEach(() => {
  testMock.mockReset()
  // 渲染层别的通道这条用例不碰，给一个会大声失败的兜底：漏了就报错而不是静默 undefined
  ;(window as unknown as { electronAPI: Record<string, unknown> }).electronAPI = {
    weread: { test: testMock },
  }
  useSettingsStore.setState({ wereadApiKeyInput: 'user-key', testResult: null, testingWeread: false })
})

describe('连接测试的结果要一路带到界面上', () => {
  it('主进程交回第一本书标题时，store 里必须还拿着它', async () => {
    testMock.mockResolvedValue({ success: true, message: '连接成功', firstBookTitle: '思考，快与慢' } as TestResult)
    await useSettingsStore.getState().testWereadConnection()
    const result = useSettingsStore.getState().testResult
    expect(result?.type).toBe('weread')
    expect(result?.success).toBe(true)
    expect(result?.firstBookTitle).toBe('思考，快与慢')
    // 传出去的是界面上那串输入，不是别的
    expect(testMock).toHaveBeenCalledWith('user-key')
  })

  it('书架是空的时候不许凭空有个标题', async () => {
    testMock.mockResolvedValue({ success: true, message: '连接成功' } as TestResult)
    await useSettingsStore.getState().testWereadConnection()
    expect(useSettingsStore.getState().testResult?.firstBookTitle).toBeUndefined()
  })

  it('失败时把主进程那句原因原样交出去（不自己改写成"测试失败"）', async () => {
    testMock.mockResolvedValue({ success: false, message: '认证失败：API Key 无效或已过期' } as TestResult)
    await useSettingsStore.getState().testWereadConnection()
    expect(useSettingsStore.getState().testResult).toMatchObject({
      type: 'weread',
      success: false,
      message: '认证失败：API Key 无效或已过期',
    })
  })

  it('页面的提示语确实用到了这个字段（最后一英里）', () => {
    const page = readFileSync('src/renderer/src/pages/settings/SettingsWeRead.tsx', 'utf8')
    // 断的是数据形状：标题被拼进「已拉到《…》」这句话里，而不是"文件里出现过 firstBookTitle"
    expect(page).toMatch(/已拉到《\$\{testResult\.firstBookTitle\}》/)
  })
})
