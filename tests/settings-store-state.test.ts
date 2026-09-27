// @vitest-environment happy-dom
//
// settingsStore 状态与通路测试 —— 读设置、保存、连接测试、清除密钥、各项开关
//
// 为什么单独一个文件：`settingsStore.ts` 有 20 个函数，既有用例只走过
// `testWereadConnection` 那一个（`weread-connection-result.test.ts`），实测 21.43 / 40 / 5。
// 这里最容易出事的两类：**输入框留空被当成"把 key 清掉"**（用户配了半年的微信读书 key
// 一次保存就没了），以及**乐观更新失败不回滚**（界面亮着"已开启"，库里根本没写进去）。
// 判据照旧：mock 只打在 `window.electronAPI` 这条渲染层与主进程之间唯一的缝上。

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useSettingsStore } from '../src/renderer/src/stores/settingsStore'
import type { WeReadSyncFrequency } from '../src/renderer/src/stores/settingsStore'

type SettingsMap = Record<string, unknown>

/** 按字段名读 state：那批「先改本地再写库 / 失败回滚」的用例要逐字段对账 */
function peek(state: object, field: string): unknown {
  return (state as SettingsMap)[field]
}

interface Api {
  getAll: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
  setConfig: ReturnType<typeof vi.fn>
  aiTest: ReturnType<typeof vi.fn>
  wereadTest: ReturnType<typeof vi.fn>
  getUserProfile: ReturnType<typeof vi.fn>
  /** 写过的 (key, value)，按调用顺序 */
  writes: () => Array<[string, unknown]>
  wrote: (key: string) => Array<[string, unknown]>
}

function installApi(
  over: {
    stored?: SettingsMap
    setFailsFor?: string[]
    getAllFails?: boolean
    setConfigFails?: boolean
    aiTestResult?: { success: boolean; message: string }
    aiTestFails?: boolean
    wereadTestResult?: { success: boolean; message: string; firstBookTitle?: string }
    profileResult?: { success: boolean; message: string; profile?: { nickname: string; avatarUrl: string } }
    profileFails?: boolean
  } = {},
): Api {
  const getAll = vi.fn(async () => {
    if (over.getAllFails) throw new Error('读不到设置')
    return over.stored ?? {}
  })
  const set = vi.fn(async (key: string, value: unknown) => {
    if (over.setFailsFor?.includes(key)) throw new Error(`${key} 写不进去`)
  })
  const setConfig = vi.fn(async (_config: Record<string, unknown>) => {
    if (over.setConfigFails) throw new Error('AI 配置下发失败')
  })
  const aiTest = vi.fn(async (_config: Record<string, unknown>) => {
    if (over.aiTestFails) throw new Error('端点连不上')
    return over.aiTestResult ?? { success: true, message: '连接成功' }
  })
  const wereadTest = vi.fn(async (_key: string) => over.wereadTestResult ?? { success: true, message: 'ok' })
  const getUserProfile = vi.fn(async () => {
    if (over.profileFails) throw new Error('书架接口没响应')
    return over.profileResult ?? { success: true, message: '已同步', profile: { nickname: '知行', avatarUrl: 'https://x/a.png' } }
  })

  Object.defineProperty(window, 'electronAPI', {
    value: {
      settings: { getAll, set },
      ai: { setConfig, test: aiTest },
      weread: { test: wereadTest, getUserProfile },
    } as never,
    writable: true,
    configurable: true,
  })

  const callsOf = (mock: ReturnType<typeof vi.fn>) =>
    mock.mock.calls.map(c => [c[0] as string, c[1]] as [string, unknown])
  return {
    getAll,
    set,
    setConfig,
    aiTest,
    wereadTest,
    getUserProfile,
    writes: () => callsOf(set),
    wrote: (key: string) => callsOf(set).filter(([k]) => k === key),
  }
}

/** 每次重新 import：store 是模块单例，用例之间必须从默认值开始 */
async function freshStore() {
  vi.resetModules()
  const mod = await import('../src/renderer/src/stores/settingsStore')
  return mod.useSettingsStore
}

describe('settingsStore — 读设置', () => {
  it('库里存什么就读什么，密钥只以"配没配"的布尔进来了', async () => {
    const store = await freshStore()
    const api = installApi({
      stored: {
        wereadApiKeySet: true,
        llmKeySet: true,
        llmEndpoint: 'https://my.example/v1',
        llmModel: 'my-model',
        llmModelFast: 'my-cheap-model',
        wereadAutoSync: true,
        wereadSyncFrequency: '7d',
        profileBadgesEnabled: false,
        userAvatarUrl: 'https://x/a.png',
        userNickname: '知行',
      },
    })
    await store.getState().loadSettings()
    expect(api.getAll).toHaveBeenCalledTimes(1)
    const s = store.getState()
    expect(s).toMatchObject({
      wereadApiKeySet: true,
      llmKeySet: true,
      llmEndpoint: 'https://my.example/v1',
      llmModel: 'my-model',
      llmModelFast: 'my-cheap-model',
      wereadAutoSync: true,
      wereadSyncFrequency: '7d',
      profileBadgesEnabled: false,
      userAvatarUrl: 'https://x/a.png',
      userNickname: '知行',
      loading: false,
      error: null,
    })
    // 界面那份 state 里只许有"配没配"的布尔与用户自己打的输入，不许出现密钥原值那种字段名
    expect(Object.keys(s)).toContain('llmKeySet')
    expect(Object.keys(s)).not.toContain('llmKey')
    expect(Object.keys(s)).not.toContain('wereadApiKey')
  })

  it('新用户（库里什么都没存）拿到的是默认端点与默认模型，不是空串', async () => {
    const store = await freshStore()
    installApi({ stored: {} })
    await store.getState().loadSettings()
    const s = store.getState()
    expect(s.llmEndpoint).toBe('https://api.deepseek.com')
    expect(s.llmModel).toBe('deepseek-v4-flash')
    expect(s.llmModelFast).toBe('')
    // 没配过就是没配过：不能因为字段缺失被读成"已连接"
    expect(s.wereadApiKeySet).toBe(false)
    expect(s.llmKeySet).toBe(false)
    expect(s.wereadAutoSync).toBe(false)
  })

  it('勋章开关只有显式存成 false 才算关闭（缺省=开，别把新装用户看成关了）', async () => {
    const store = await freshStore()
    installApi({ stored: {} })
    await store.getState().loadSettings()
    expect(store.getState().profileBadgesEnabled).toBe(true)

    const off = await freshStore()
    installApi({ stored: { profileBadgesEnabled: false } })
    await off.getState().loadSettings()
    expect(off.getState().profileBadgesEnabled).toBe(false)
  })

  it('自动同步频率：认 1d/3d/7d，脏值一律回落到 1d', async () => {
    const cases: Array<[unknown, WeReadSyncFrequency]> = [
      ['1d', '1d'],
      ['3d', '3d'],
      ['7d', '7d'],
      ['每小时', '1d'],
      [undefined, '1d'],
      [42, '1d'],
    ]
    for (const [stored, want] of cases) {
      const store = await freshStore()
      installApi({ stored: { wereadSyncFrequency: stored } })
      await store.getState().loadSettings()
      expect(store.getState().wereadSyncFrequency, `wereadSyncFrequency=${String(stored)}`).toBe(want)
    }
  })

  it('老版本存的是分钟数，按同一把尺换算成 1d/3d/7d', async () => {
    const cases: Array<[number, WeReadSyncFrequency]> = [
      [100, '1d'],
      [3000, '3d'],
      [10000, '7d'],
    ]
    for (const [minutes, want] of cases) {
      const store = await freshStore()
      // 新版键不存在、只有旧的 wereadAutoSyncInterval
      installApi({ stored: { wereadAutoSyncInterval: minutes } })
      await store.getState().loadSettings()
      expect(store.getState().wereadSyncFrequency, `${minutes} 分钟`).toBe(want)
    }
  })

  it('读库失败：把原因写出来、loading 归位（不许转成永远转圈的加载态）', async () => {
    const store = await freshStore()
    installApi({ getAllFails: true })
    await store.getState().loadSettings()
    const s = store.getState()
    expect(s.error).toBe('读不到设置')
    expect(s.loading).toBe(false)
  })

  it('正在输入框里打的 key 不会被一次刷新冲掉', async () => {
    const store = await freshStore()
    installApi({ stored: { llmEndpoint: 'https://other.example' } })
    store.getState().setWereadApiKeyInput('刚敲了一半的 key')
    store.getState().setLlmKeyInput('刚敲了一半的 AI key')
    await store.getState().loadSettings()
    expect(store.getState().wereadApiKeyInput).toBe('刚敲了一半的 key')
    expect(store.getState().llmKeyInput).toBe('刚敲了一半的 AI key')
  })
})

describe('settingsStore — 保存', () => {
  it('输入框留空 = 不动已保存的密钥：一次都不往 wereadApiKey / llmKey 写', async () => {
    const store = await freshStore()
    const api = installApi()
    store.setState({ wereadApiKeyInput: '', llmKeyInput: '' })
    await store.getState().saveSettings()
    expect(api.wrote('wereadApiKey')).toHaveLength(0)
    expect(api.wrote('llmKey')).toHaveLength(0)
    // 其余常规项照常写
    expect(api.writes().map(([k]) => k)).toEqual([
      'aiProvider',
      'llmEndpoint',
      'llmModel',
      'llmModelFast',
      'wereadAutoSync',
      'wereadSyncFrequency',
      'userAvatarUrl',
      'userNickname',
    ])
  })

  it('填了新 key 才写，并且"已配置"当场翻成 true、输入框收回去', async () => {
    const store = await freshStore()
    const api = installApi()
    store.setState({ wereadApiKeyInput: '新微信读书key', llmKeyInput: '新AIkey', wereadApiKeySet: false, llmKeySet: false })
    await store.getState().saveSettings()
    expect(api.wrote('wereadApiKey')).toEqual([['wereadApiKey', '新微信读书key']])
    expect(api.wrote('llmKey')).toEqual([['llmKey', '新AIkey']])
    const s = store.getState()
    expect(s.wereadApiKeySet).toBe(true)
    expect(s.llmKeySet).toBe(true)
    // 原值不再留在渲染层
    expect(s.wereadApiKeyInput).toBe('')
    expect(s.llmKeyInput).toBe('')
  })

  it('只改端点与模型、不重填 key：AI 服务照样收到新配置（这条不接就得重启才生效）', async () => {
    const store = await freshStore()
    const api = installApi()
    store.setState({
      wereadApiKeyInput: '',
      llmKeyInput: '',
      llmEndpoint: 'https://new.example',
      llmModel: 'new-model',
      llmModelFast: '  ',
    })
    await store.getState().saveSettings()
    expect(api.setConfig).toHaveBeenCalledTimes(1)
    expect(api.setConfig.mock.calls[0][0]).toEqual({
      provider: 'custom',
      apiKey: '',
      baseUrl: 'https://new.example',
      model: 'new-model',
      // 经济档填的是空白 ⇒ 下发 undefined，等于关掉分流而不是传一串空格
      modelFast: undefined,
    })
    expect(api.wrote('llmEndpoint')).toEqual([['llmEndpoint', 'https://new.example']])
  })

  it('自动同步的开关与频率各写一次库（主进程靠这两个 key 换定时器）', async () => {
    const store = await freshStore()
    const api = installApi()
    store.setState({ wereadAutoSync: true, wereadSyncFrequency: '3d' })
    await store.getState().saveSettings()
    expect(api.wrote('wereadAutoSync')).toEqual([['wereadAutoSync', true]])
    expect(api.wrote('wereadSyncFrequency')).toEqual([['wereadSyncFrequency', '3d']])
  })

  it('端点与模型留空时不下发空串（主进程按"没给"处理，而不是拿空串去覆盖默认值）', async () => {
    const store = await freshStore()
    const api = installApi()
    store.setState({ llmEndpoint: '', llmModel: '', llmModelFast: '' })
    await store.getState().saveSettings()
    expect(api.setConfig.mock.calls[0][0]).toMatchObject({ baseUrl: undefined, model: undefined, modelFast: undefined })
  })

  it('保存失败：写出原因、saving 归位、不亮"已保存"', async () => {
    const store = await freshStore()
    installApi({ setFailsFor: ['llmModel'] })
    await store.getState().saveSettings()
    const s = store.getState()
    expect(s.error).toBe('llmModel 写不进去')
    expect(s.saving).toBe(false)
    expect(s.saved).toBe(false)
  })

  it('"已保存"三秒后自己收回去', async () => {
    vi.useFakeTimers()
    try {
      const store = await freshStore()
      installApi()
      await store.getState().saveSettings()
      expect(store.getState().saved).toBe(true)
      vi.advanceTimersByTime(2999)
      expect(store.getState().saved).toBe(true)
      vi.advanceTimersByTime(1)
      expect(store.getState().saved).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('settingsStore — 连接测试', () => {
  it('AI：既没填也没存过时直接提示，不发探测请求（不打无谓的远端调用）', async () => {
    const store = await freshStore()
    const api = installApi()
    store.setState({ llmKeyInput: '', llmKeySet: false })
    await store.getState().testAIConnection()
    expect(api.aiTest).not.toHaveBeenCalled()
    expect(store.getState().testResult).toMatchObject({ type: 'ai', success: false, message: '请先输入API Key' })
    expect(store.getState().testingAI).toBe(false)
  })

  it('AI：输入框空但有已存 key 时传空串，让主进程用它已存的那把去测', async () => {
    const store = await freshStore()
    const api = installApi({ aiTestResult: { success: true, message: '连接成功' } })
    store.setState({ llmKeyInput: '', llmKeySet: true, llmEndpoint: 'https://e.example', llmModel: 'm1' })
    await store.getState().testAIConnection()
    expect(api.aiTest.mock.calls[0][0]).toEqual({
      provider: 'custom',
      apiKey: '',
      baseUrl: 'https://e.example',
      model: 'm1',
    })
    expect(store.getState().testResult).toMatchObject({ type: 'ai', success: true })
  })

  it('AI：端点与模型留空时不把空串当配置发出去', async () => {
    const store = await freshStore()
    const api = installApi()
    store.setState({ llmKeySet: true, llmEndpoint: '', llmModel: '' })
    await store.getState().testAIConnection()
    expect(api.aiTest.mock.calls[0][0]).toEqual({ provider: 'custom', apiKey: '', baseUrl: undefined, model: undefined })
  })

  it('AI：主进程报的原因原样交给界面，失败也算一次正常结束', async () => {
    const store = await freshStore()
    installApi({ aiTestResult: { success: false, message: '认证失败：key 无效' } })
    store.setState({ llmKeySet: true })
    await store.getState().testAIConnection()
    expect(store.getState().testResult).toMatchObject({ type: 'ai', success: false, message: '认证失败：key 无效' })
    expect(store.getState().testingAI).toBe(false)
  })

  it('AI：通道抛错时包成「测试失败: 原因」，testingAI 一定归位', async () => {
    const store = await freshStore()
    installApi({ aiTestFails: true })
    store.setState({ llmKeySet: true })
    await store.getState().testAIConnection()
    expect(store.getState().testResult).toMatchObject({ type: 'ai', success: false, message: '测试失败: 端点连不上' })
    expect(store.getState().testingAI).toBe(false)
  })

  it('微信读书：没填也没存过时直接提示，不打远端接口', async () => {
    const store = await freshStore()
    const api = installApi()
    store.setState({ wereadApiKeyInput: '', wereadApiKeySet: false })
    await store.getState().testWereadConnection()
    expect(api.wereadTest).not.toHaveBeenCalled()
    expect(store.getState().testResult).toMatchObject({
      type: 'weread',
      success: false,
      message: '请先输入微信读书 API Key',
    })
    expect(store.getState().testingWeread).toBe(false)
  })

  it('微信读书：通道抛错也包成「测试失败: 原因」，测试中状态一定归位', async () => {
    const store = await freshStore()
    Object.defineProperty(window, 'electronAPI', {
      value: { weread: { test: vi.fn(async () => { throw new Error('网络断了') }) } },
      writable: true,
      configurable: true,
    })
    store.setState({ wereadApiKeySet: true })
    await store.getState().testWereadConnection()
    expect(store.getState().testResult).toMatchObject({ type: 'weread', success: false, message: '测试失败: 网络断了' })
    expect(store.getState().testingWeread).toBe(false)
  })

  it('微信读书：一次新的测试会收掉上一条结果（换 key 重测不许留着旧结论）', async () => {
    const store = await freshStore()
    installApi({ wereadTestResult: { success: true, message: '连接成功' } })
    store.setState({ wereadApiKeyInput: 'k', testResult: { type: 'ai', success: true, message: '上一条' } })
    await store.getState().testWereadConnection()
    expect(store.getState().testResult).toMatchObject({ type: 'weread', message: '连接成功' })
  })
})

describe('settingsStore — 清除已保存的密钥', () => {
  it('清除微信读书 key 发的是空串（主进程那侧空串就是删除），并把"已连接"当场变灰', async () => {
    const store = await freshStore()
    const api = installApi()
    store.setState({ wereadApiKeySet: true, wereadApiKeyInput: '残留的输入' })
    await store.getState().clearWereadApiKey()
    expect(api.wrote('wereadApiKey')).toEqual([['wereadApiKey', '']])
    const s = store.getState()
    expect(s.wereadApiKeySet).toBe(false)
    expect(s.wereadApiKeyInput).toBe('')
  })

  it('清除失败：把"已连接"回滚回去（不能让用户以为 key 没了，下一次保存反而把它清掉）', async () => {
    const store = await freshStore()
    installApi({ setFailsFor: ['wereadApiKey'] })
    store.setState({ wereadApiKeySet: true })
    await store.getState().clearWereadApiKey()
    const s = store.getState()
    expect(s.wereadApiKeySet).toBe(true)
    expect(s.error).toBe('wereadApiKey 写不进去')
  })

  it('清除 AI key：先清设置再下发配置（顺序反了 withStoredKey 会把刚清的 key 又补回内存）', async () => {
    const store = await freshStore()
    const api = installApi()
    const order: string[] = []
    api.set.mockImplementation(async () => {
      order.push('settings.set')
    })
    api.setConfig.mockImplementation(async () => {
      order.push('ai.setConfig')
    })
    store.setState({ llmKeySet: true, llmKeyInput: '残留', llmEndpoint: 'https://e', llmModel: 'm', llmModelFast: 'fast' })
    await store.getState().clearLlmKey()
    expect(order).toEqual(['settings.set', 'ai.setConfig'])
    expect(api.wrote('llmKey')).toEqual([['llmKey', '']])
    expect(api.setConfig.mock.calls[0][0]).toEqual({
      provider: 'custom',
      apiKey: '',
      baseUrl: 'https://e',
      model: 'm',
      modelFast: 'fast',
    })
    expect(store.getState().llmKeySet).toBe(false)
  })

  it('清除 AI key 也是"没给就不下发"：端点/模型/经济档留空时全是 undefined', async () => {
    const store = await freshStore()
    const api = installApi()
    store.setState({ llmKeySet: true, llmEndpoint: '', llmModel: '', llmModelFast: '   ' })
    await store.getState().clearLlmKey()
    expect(api.setConfig.mock.calls[0][0]).toEqual({
      provider: 'custom',
      apiKey: '',
      baseUrl: undefined,
      model: undefined,
      modelFast: undefined,
    })
  })

  it('清除 AI key 失败：回滚"已配置"，并且不再下发配置', async () => {
    const store = await freshStore()
    const api = installApi({ setFailsFor: ['llmKey'] })
    store.setState({ llmKeySet: true })
    await store.getState().clearLlmKey()
    expect(store.getState().llmKeySet).toBe(true)
    expect(store.getState().error).toBe('llmKey 写不进去')
    expect(api.setConfig).not.toHaveBeenCalled()
  })
})

describe('settingsStore — 五个开关与资料的乐观更新', () => {
  const cases: Array<{
    name: string
    run: (s: Awaited<ReturnType<typeof freshStore>>) => Promise<void>
    key: string
    value: unknown
    field: string
    before: unknown
    after: unknown
  }> = [
    { name: '自动同步开关', run: s => s.getState().setWereadAutoSync(true), key: 'wereadAutoSync', value: true, field: 'wereadAutoSync', before: false, after: true },
    {
      name: '自动同步频率',
      run: s => s.getState().setWereadSyncFrequency('7d'),
      key: 'wereadSyncFrequency',
      value: '7d',
      field: 'wereadSyncFrequency',
      before: '1d',
      after: '7d',
    },
    { name: '勋章显示', run: s => s.getState().setProfileBadgesEnabled(false), key: 'profileBadgesEnabled', value: false, field: 'profileBadgesEnabled', before: true, after: false },
    { name: '头像', run: s => s.getState().setUserAvatarUrl('https://x/new.png'), key: 'userAvatarUrl', value: 'https://x/new.png', field: 'userAvatarUrl', before: '', after: 'https://x/new.png' },
    { name: '昵称', run: s => s.getState().setUserNickname('知行'), key: 'userNickname', value: '知行', field: 'userNickname', before: '', after: '知行' },
  ]

  for (const c of cases) {
    it(`${c.name}：先改本地再写库`, async () => {
      const store = await freshStore()
      const api = installApi()
      await c.run(store)
      expect(api.writes().map(([k, v]) => [k, v])).toContainEqual([c.key, c.value])
      expect(peek(store.getState(), c.field)).toEqual(c.after)
    })

    it(`${c.name}：写库失败要回滚，不许界面亮着"开了"而库里没变`, async () => {
      const store = await freshStore()
      installApi({ setFailsFor: [c.key] })
      await c.run(store)
      expect(peek(store.getState(), c.field)).toEqual(c.before)
      expect(store.getState().error).toBe(`${c.key} 写不进去`)
    })
  }

  it('频率只认三个合法值，脏值落成 1d 再写库（不把任意字符串塞进设置）', async () => {
    const store = await freshStore()
    const api = installApi()
    await store.getState().setWereadSyncFrequency('每月' as WeReadSyncFrequency)
    expect(api.wrote('wereadSyncFrequency')).toEqual([['wereadSyncFrequency', '1d']])
    expect(store.getState().wereadSyncFrequency).toBe('1d')
  })
})

describe('settingsStore — 从微信读书同步头像与昵称', () => {
  it('拿到资料就同时写本地与库，并回报成功', async () => {
    const store = await freshStore()
    const api = installApi()
    const res = await store.getState().syncWeReadUserProfile()
    expect(res).toEqual({ success: true, message: '已同步' })
    expect(api.wrote('userAvatarUrl')).toEqual([['userAvatarUrl', 'https://x/a.png']])
    expect(api.wrote('userNickname')).toEqual([['userNickname', '知行']])
    const s = store.getState()
    expect(s.userAvatarUrl).toBe('https://x/a.png')
    expect(s.userNickname).toBe('知行')
    expect(s.syncingProfile).toBe(false)
  })

  it('资料只给一半时另一半保持原值（不许把已有头像或昵称清成空串）', async () => {
    const noNickname = await freshStore()
    installApi({
      profileResult: { success: true, message: '已同步', profile: { nickname: '', avatarUrl: 'https://x/new.png' } },
    })
    noNickname.setState({ userNickname: '老名字', userAvatarUrl: '' })
    await noNickname.getState().syncWeReadUserProfile()
    expect(noNickname.getState()).toMatchObject({ userNickname: '老名字', userAvatarUrl: 'https://x/new.png' })

    const noAvatar = await freshStore()
    installApi({
      profileResult: { success: true, message: '已同步', profile: { nickname: '新名字', avatarUrl: '' } },
    })
    noAvatar.setState({ userNickname: '', userAvatarUrl: 'https://old.png' })
    await noAvatar.getState().syncWeReadUserProfile()
    expect(noAvatar.getState()).toMatchObject({ userNickname: '新名字', userAvatarUrl: 'https://old.png' })
  })

  it('微信读书说没拿到：原因交出去，本地一个字都不动', async () => {
    const store = await freshStore()
    installApi({ profileResult: { success: false, message: '请先设置 API Key' } })
    store.setState({ userAvatarUrl: 'https://old.png', userNickname: '老名字' })
    const res = await store.getState().syncWeReadUserProfile()
    expect(res).toEqual({ success: false, message: '请先设置 API Key' })
    const s = store.getState()
    expect(s.userAvatarUrl).toBe('https://old.png')
    expect(s.userNickname).toBe('老名字')
    expect(s.syncingProfile).toBe(false)
  })

  it('写库失败：本地回滚成原样，并把「保存失败」报给调用方', async () => {
    const store = await freshStore()
    installApi({ setFailsFor: ['userNickname'] })
    store.setState({ userAvatarUrl: 'https://old.png', userNickname: '老名字' })
    const res = await store.getState().syncWeReadUserProfile()
    expect(res.success).toBe(false)
    expect(res.message).toBe('保存失败: userNickname 写不进去')
    const s = store.getState()
    expect(s.userAvatarUrl).toBe('https://old.png')
    expect(s.userNickname).toBe('老名字')
    expect(s.syncingProfile).toBe(false)
  })

  it('通道抛错也走同一条收尾：syncingProfile 一定归位（否则按钮永远转圈）', async () => {
    const store = await freshStore()
    installApi({ profileFails: true })
    const res = await store.getState().syncWeReadUserProfile()
    expect(res).toEqual({ success: false, message: '同步失败: 书架接口没响应' })
    expect(store.getState().syncingProfile).toBe(false)
  })
})

describe('settingsStore — 纯 setter 与清理', () => {
  it('五个纯赋值各改各的字段', async () => {
    const store = await freshStore()
    const s = () => store.getState()
    s().setWereadApiKeyInput('w-in')
    s().setLlmKeyInput('k-in')
    s().setLlmEndpoint('https://typed.example')
    s().setLlmModel('typed-model')
    s().setLlmModelFast('typed-fast')
    expect(s()).toMatchObject({
      wereadApiKeyInput: 'w-in',
      llmKeyInput: 'k-in',
      llmEndpoint: 'https://typed.example',
      llmModel: 'typed-model',
      llmModelFast: 'typed-fast',
    })
    // 纯赋值不该顺手写库
    expect(s().error).toBeNull()
  })

  it('clearTestResult 只收结果、clearError 只收错误', async () => {
    const store = await freshStore()
    store.setState({ testResult: { type: 'ai', success: false, message: '旧结果' }, error: '旧错误' })
    store.getState().clearTestResult()
    expect(store.getState().testResult).toBeNull()
    expect(store.getState().error).toBe('旧错误')
    store.getState().clearError()
    expect(store.getState().error).toBeNull()
  })
})
