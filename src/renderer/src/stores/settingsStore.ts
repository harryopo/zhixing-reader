import { create } from 'zustand'

interface SettingsState {
  wereadApiKey: string
  llmEndpoint: string
  llmKey: string
  llmModel: string
  /** 微信读书自动同步开关（默认 false）。开启后 main 进程按 wereadAutoSyncInterval 自动调 syncBookshelf */
  wereadAutoSync: boolean
  /** 微信读书自动同步间隔（分钟，默认 30）。常用值：15 / 30 / 60 / 180 / 360 */
  wereadAutoSyncInterval: number
  /** 个人档案成绩勋章显示开关（默认 true）。关闭后 Profile 页面隐藏成就徽章区域 */
  profileBadgesEnabled: boolean

  loading: boolean
  saving: boolean
  testingWeread: boolean
  testingAI: boolean
  error: string | null
  testResult: { type: 'weread' | 'ai'; success: boolean; message: string; firstBookTitle?: string } | null
  saved: boolean

  loadSettings: () => Promise<void>
  saveSettings: () => Promise<void>
  testWereadConnection: () => Promise<void>
  testAIConnection: () => Promise<void>

  setWereadApiKey: (key: string) => void
  setLlmEndpoint: (endpoint: string) => void
  setLlmKey: (key: string) => void
  setLlmModel: (model: string) => void
  /** 切换微信读书自动同步开关并持久化（main 进程会监听 settings.set 自动更新定时器） */
  setWereadAutoSync: (enabled: boolean) => Promise<void>
  /** 切换微信读书自动同步间隔（分钟）并持久化 */
  setWereadAutoSyncInterval: (minutes: number) => Promise<void>
  /** 切换个人档案成绩勋章显示开关并持久化 */
  setProfileBadgesEnabled: (enabled: boolean) => Promise<void>
  clearTestResult: () => void
  clearError: () => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  wereadApiKey: '',
  llmEndpoint: '',
  llmKey: '',
  llmModel: '',
  // 默认 false：用户必须显式开启自动同步，避免无 API Key 时空跑定时器
  wereadAutoSync: false,
  wereadAutoSyncInterval: 30,
  // 默认 true：成绩勋章默认显示，用户可在 Profile 页面关闭
  profileBadgesEnabled: true,
  loading: false,
  saving: false,
  testingWeread: false,
  testingAI: false,
  error: null,
  testResult: null,
  saved: false,

  loadSettings: async () => {
    set({ loading: true, error: null })
    try {
      const settings = await window.electronAPI.settings.getAll() as Record<string, unknown>
      set({
        wereadApiKey: (settings.wereadApiKey as string) || '',
        llmEndpoint: (settings.llmEndpoint as string) || '',
        llmKey: (settings.llmKey as string) || '',
        llmModel: (settings.llmModel as string) || '',
        wereadAutoSync: settings.wereadAutoSync === true,
        wereadAutoSyncInterval: typeof settings.wereadAutoSyncInterval === 'number'
          && settings.wereadAutoSyncInterval > 0
          ? settings.wereadAutoSyncInterval
          : 30,
        // profileBadgesEnabled 默认 true；仅当显式存储为 false 时才视为关闭
        profileBadgesEnabled: settings.profileBadgesEnabled !== false,
        loading: false
      })
    } catch (error) {
      set({ error: (error as Error).message, loading: false })
    }
  },

  saveSettings: async () => {
    set({ saving: true, error: null, saved: false })
    try {
      const { wereadApiKey, llmEndpoint, llmKey, llmModel, wereadAutoSync, wereadAutoSyncInterval } = get()

      await Promise.all([
        window.electronAPI.settings.set('wereadApiKey', wereadApiKey),
        window.electronAPI.settings.set('aiProvider', 'custom'),
        window.electronAPI.settings.set('llmEndpoint', llmEndpoint),
        window.electronAPI.settings.set('llmKey', llmKey),
        window.electronAPI.settings.set('llmModel', llmModel),
        // 自动同步开关与间隔单独写库：SETTINGS.SET handler 检测到这两个 key 时会触发 main 进程更新定时器
        window.electronAPI.settings.set('wereadAutoSync', wereadAutoSync),
        window.electronAPI.settings.set('wereadAutoSyncInterval', wereadAutoSyncInterval)
      ])

      if (llmKey) {
        await window.electronAPI.ai.setConfig({
          provider: 'custom',
          apiKey: llmKey,
          baseUrl: llmEndpoint || undefined,
          model: llmModel || undefined
        })
      }

      if (wereadApiKey) {
        await window.electronAPI.weread.setApiKey(wereadApiKey)
      }

      set({ saving: false, saved: true })
      setTimeout(() => set({ saved: false }), 3000)
    } catch (error) {
      set({ error: (error as Error).message, saving: false })
    }
  },

  testWereadConnection: async () => {
    set({ testingWeread: true, error: null, testResult: null })
    try {
      const { wereadApiKey } = get()
      if (!wereadApiKey) {
        set({
          testingWeread: false,
          testResult: { type: 'weread', success: false, message: '请先输入微信读书 API Key' }
        })
        return
      }

      const result = await window.electronAPI.weread.test(wereadApiKey)
      set({
        testingWeread: false,
        testResult: {
          type: 'weread',
          success: result.success,
          message: result.message,
          firstBookTitle: result.firstBookTitle
        }
      })
    } catch (error) {
      set({
        testingWeread: false,
        testResult: {
          type: 'weread',
          success: false,
          message: `测试失败: ${(error as Error).message}`
        }
      })
    }
  },

  testAIConnection: async () => {
    set({ testingAI: true, error: null, testResult: null })
    try {
      const { llmEndpoint, llmKey, llmModel } = get()
      if (!llmKey) {
        set({
          testingAI: false,
          testResult: { type: 'ai', success: false, message: '请先输入API Key' }
        })
        return
      }

      const result = await window.electronAPI.ai.test({
        provider: 'custom',
        apiKey: llmKey,
        baseUrl: llmEndpoint || undefined,
        model: llmModel || undefined
      })
      set({ testingAI: false, testResult: { type: 'ai', ...result } })
    } catch (error) {
      set({
        testingAI: false,
        testResult: {
          type: 'ai',
          success: false,
          message: `测试失败: ${(error as Error).message}`
        }
      })
    }
  },

  setWereadApiKey: (key: string) => set({ wereadApiKey: key }),
  setLlmEndpoint: (endpoint: string) => set({ llmEndpoint: endpoint }),
  setLlmKey: (key: string) => set({ llmKey: key }),
  setLlmModel: (model: string) => set({ llmModel: model }),
  setWereadAutoSync: async (enabled: boolean) => {
    const prev = get().wereadAutoSync
    set({ wereadAutoSync: enabled })
    try {
      await window.electronAPI?.settings?.set('wereadAutoSync', enabled)
    } catch (error) {
      set({ wereadAutoSync: prev, error: (error as Error).message })
    }
  },
  setWereadAutoSyncInterval: async (minutes: number) => {
    // 限定到 5 - 1440 分钟（5 分钟 - 24 小时），避免过短打爆 API 或过长无意义
    const safe = Math.max(5, Math.min(1440, Math.floor(minutes)))
    const prev = get().wereadAutoSyncInterval
    set({ wereadAutoSyncInterval: safe })
    try {
      await window.electronAPI?.settings?.set('wereadAutoSyncInterval', safe)
    } catch (error) {
      set({ wereadAutoSyncInterval: prev, error: (error as Error).message })
    }
  },
  setProfileBadgesEnabled: async (enabled: boolean) => {
    // 乐观更新：先改 state，再持久化；失败时回滚
    const prev = get().profileBadgesEnabled
    set({ profileBadgesEnabled: enabled })
    try {
      await window.electronAPI?.settings?.set('profileBadgesEnabled', enabled)
    } catch (error) {
      set({ profileBadgesEnabled: prev, error: (error as Error).message })
    }
  },
  clearTestResult: () => set({ testResult: null }),
  clearError: () => set({ error: null })
}))
