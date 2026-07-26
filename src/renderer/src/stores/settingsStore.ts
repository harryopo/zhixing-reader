import { create } from 'zustand'

export type WeReadSyncFrequency = '1d' | '3d' | '7d'

interface SettingsState {
  wereadApiKey: string
  llmEndpoint: string
  llmKey: string
  llmModel: string
  /** 微信读书自动同步开关（默认 false）。开启后 main 进程按 wereadSyncFrequency 自动调 syncBookshelf */
  wereadAutoSync: boolean
  /** 微信读书自动同步频率（默认 1d）。可选：1d / 3d / 7d */
  wereadSyncFrequency: WeReadSyncFrequency
  /** 个人档案成绩勋章显示开关（默认 true）。关闭后 Profile 页面隐藏成就徽章区域 */
  profileBadgesEnabled: boolean
  /** 个人档案头像 URL（可来自微信读书同步或手动填写） */
  userAvatarUrl: string
  /** 个人档案昵称（可来自微信读书同步或手动填写） */
  userNickname: string

  loading: boolean
  saving: boolean
  testingWeread: boolean
  testingAI: boolean
  syncingProfile: boolean
  error: string | null
  testResult: { type: 'weread' | 'ai'; success: boolean; message: string } | null
  saved: boolean

  loadSettings: () => Promise<void>
  saveSettings: () => Promise<void>
  testWereadConnection: () => Promise<void>
  testAIConnection: () => Promise<void>
  /** 尝试从微信读书同步头像/昵称到本地设置 */
  syncWeReadUserProfile: () => Promise<{ success: boolean; message: string }>

  setWereadApiKey: (key: string) => void
  setLlmEndpoint: (endpoint: string) => void
  setLlmKey: (key: string) => void
  setLlmModel: (model: string) => void
  /** 切换微信读书自动同步开关并持久化（main 进程会监听 settings.set 自动更新定时器） */
  setWereadAutoSync: (enabled: boolean) => Promise<void>
  /** 切换微信读书自动同步频率并持久化 */
  setWereadSyncFrequency: (frequency: WeReadSyncFrequency) => Promise<void>
  /** 切换个人档案成绩勋章显示开关并持久化 */
  setProfileBadgesEnabled: (enabled: boolean) => Promise<void>
  /** 设置个人档案头像 URL */
  setUserAvatarUrl: (url: string) => Promise<void>
  /** 设置个人档案昵称 */
  setUserNickname: (nickname: string) => Promise<void>
  clearTestResult: () => void
  clearError: () => void
}

function parseWeReadSyncFrequency(
  value: unknown,
  legacyInterval?: unknown
): WeReadSyncFrequency {
  if (value === '1d' || value === '3d' || value === '7d') {
    return value
  }

  // 向后兼容：旧版本使用 wereadAutoSyncInterval（分钟）
  if (typeof legacyInterval === 'number' && legacyInterval > 0) {
    const days = legacyInterval / 60 / 24
    if (days < 2) return '1d'
    if (days < 5) return '3d'
    return '7d'
  }

  return '1d'
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  wereadApiKey: '',
  llmEndpoint: '',
  llmKey: '',
  llmModel: '',
  // 默认 false：用户必须显式开启自动同步，避免无 API Key 时空跑定时器
  wereadAutoSync: false,
  // 默认 1d：按天维度自动同步，避免过于频繁调用 API
  wereadSyncFrequency: '1d',
  // 默认 true：成绩勋章默认显示，用户可在 Profile 页面关闭
  profileBadgesEnabled: true,
  // 个人档案头像/昵称默认空，由用户手动填写或从微信读书同步
  userAvatarUrl: '',
  userNickname: '',
  loading: false,
  saving: false,
  testingWeread: false,
  testingAI: false,
  syncingProfile: false,
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
        wereadSyncFrequency: parseWeReadSyncFrequency(
          settings.wereadSyncFrequency,
          settings.wereadAutoSyncInterval
        ),
        // profileBadgesEnabled 默认 true；仅当显式存储为 false 时才视为关闭
        profileBadgesEnabled: settings.profileBadgesEnabled !== false,
        userAvatarUrl: (settings.userAvatarUrl as string) || '',
        userNickname: (settings.userNickname as string) || '',
        loading: false
      })
    } catch (error) {
      set({ error: (error as Error).message, loading: false })
    }
  },

  saveSettings: async () => {
    set({ saving: true, error: null, saved: false })
    try {
      const { wereadApiKey, llmEndpoint, llmKey, llmModel, wereadAutoSync, wereadSyncFrequency, userAvatarUrl, userNickname } = get()

      await Promise.all([
        window.electronAPI.settings.set('wereadApiKey', wereadApiKey),
        window.electronAPI.settings.set('aiProvider', 'custom'),
        window.electronAPI.settings.set('llmEndpoint', llmEndpoint),
        window.electronAPI.settings.set('llmKey', llmKey),
        window.electronAPI.settings.set('llmModel', llmModel),
        // 自动同步开关与频率单独写库：SETTINGS.SET handler 检测到这两个 key 时会触发 main 进程更新定时器
        window.electronAPI.settings.set('wereadAutoSync', wereadAutoSync),
        window.electronAPI.settings.set('wereadSyncFrequency', wereadSyncFrequency),
        window.electronAPI.settings.set('userAvatarUrl', userAvatarUrl),
        window.electronAPI.settings.set('userNickname', userNickname)
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
          message: result.message
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
  setWereadSyncFrequency: async (frequency: WeReadSyncFrequency) => {
    const safe: WeReadSyncFrequency = frequency === '1d' || frequency === '3d' || frequency === '7d'
      ? frequency
      : '1d'
    const prev = get().wereadSyncFrequency
    set({ wereadSyncFrequency: safe })
    try {
      await window.electronAPI?.settings?.set('wereadSyncFrequency', safe)
    } catch (error) {
      set({ wereadSyncFrequency: prev, error: (error as Error).message })
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
  setUserAvatarUrl: async (url: string) => {
    const prev = get().userAvatarUrl
    set({ userAvatarUrl: url })
    try {
      await window.electronAPI?.settings?.set('userAvatarUrl', url)
    } catch (error) {
      set({ userAvatarUrl: prev, error: (error as Error).message })
    }
  },
  setUserNickname: async (nickname: string) => {
    const prev = get().userNickname
    set({ userNickname: nickname })
    try {
      await window.electronAPI?.settings?.set('userNickname', nickname)
    } catch (error) {
      set({ userNickname: prev, error: (error as Error).message })
    }
  },
  syncWeReadUserProfile: async () => {
    set({ syncingProfile: true, error: null })
    try {
      const result = await window.electronAPI.weread.getUserProfile()
      if (result.success && result.profile) {
        const { profile } = result
        const prevAvatar = get().userAvatarUrl
        const prevNickname = get().userNickname
        set({
          userAvatarUrl: profile.avatarUrl || prevAvatar,
          userNickname: profile.nickname || prevNickname,
        })
        try {
          await Promise.all([
            window.electronAPI?.settings?.set('userAvatarUrl', profile.avatarUrl || prevAvatar),
            window.electronAPI?.settings?.set('userNickname', profile.nickname || prevNickname),
          ])
        } catch (error) {
          set({ userAvatarUrl: prevAvatar, userNickname: prevNickname, error: (error as Error).message })
          return { success: false, message: `保存失败: ${(error as Error).message}` }
        }
        return { success: true, message: result.message }
      }
      return { success: false, message: result.message }
    } catch (error) {
      const message = `同步失败: ${(error as Error).message}`
      set({ error: message })
      return { success: false, message }
    } finally {
      set({ syncingProfile: false })
    }
  },
  clearTestResult: () => set({ testResult: null }),
  clearError: () => set({ error: null })
}))
