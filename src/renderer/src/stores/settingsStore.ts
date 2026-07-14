import { create } from 'zustand'

interface SettingsState {
  wereadApiKey: string
  llmEndpoint: string
  llmKey: string
  llmModel: string

  loading: boolean
  saving: boolean
  testingWeread: boolean
  testingAI: boolean
  error: string | null
  testResult: { type: 'weread' | 'ai'; success: boolean; message: string } | null
  saved: boolean

  loadSettings: () => Promise<void>
  saveSettings: () => Promise<void>
  testWereadConnection: () => Promise<void>
  testAIConnection: () => Promise<void>

  setWereadApiKey: (key: string) => void
  setLlmEndpoint: (endpoint: string) => void
  setLlmKey: (key: string) => void
  setLlmModel: (model: string) => void
  clearTestResult: () => void
  clearError: () => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  wereadApiKey: '',
  llmEndpoint: '',
  llmKey: '',
  llmModel: '',
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
        loading: false
      })
    } catch (error) {
      set({ error: (error as Error).message, loading: false })
    }
  },

  saveSettings: async () => {
    set({ saving: true, error: null, saved: false })
    try {
      const { wereadApiKey, llmEndpoint, llmKey, llmModel } = get()

      await Promise.all([
        window.electronAPI.settings.set('wereadApiKey', wereadApiKey),
        window.electronAPI.settings.set('aiProvider', 'custom'),
        window.electronAPI.settings.set('llmEndpoint', llmEndpoint),
        window.electronAPI.settings.set('llmKey', llmKey),
        window.electronAPI.settings.set('llmModel', llmModel)
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
      set({ testingWeread: false, testResult: { type: 'weread', ...result } })
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
  clearTestResult: () => set({ testResult: null }),
  clearError: () => set({ error: null })
}))
