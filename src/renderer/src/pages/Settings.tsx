import { useState, useEffect, useCallback } from 'react'
import { useSettingsStore } from '../stores/settingsStore'
import { toast } from '../stores/toastStore'

export default function Settings() {
  const {
    wereadApiKey,
    llmEndpoint,
    llmKey,
    llmModel,
    loading,
    saving,
    testingWeread,
    testingAI,
    error,
    testResult,
    loadSettings,
    saveSettings,
    testWereadConnection,
    testAIConnection,
    setWereadApiKey,
    setLlmEndpoint,
    setLlmKey,
    setLlmModel,
    clearTestResult
  } = useSettingsStore()

  const [activeTab, setActiveTab] = useState<'weread' | 'ai'>('weread')

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  useEffect(() => {
    if (testResult) {
      if (testResult.success) {
        toast.success(testResult.message)
      } else {
        toast.error(testResult.message)
      }
    }
  }, [testResult])

  useEffect(() => {
    if (!saving) {
      const state = useSettingsStore.getState()
      if (state.saved) {
        toast.success('配置保存成功！')
      }
    }
  }, [saving])

  useEffect(() => {
    if (error) {
      toast.error(error)
    }
  }, [error])

  const handleSave = useCallback(async () => {
    clearTestResult()
    const saveToastId = toast.loading('正在保存配置...')
    try {
      await saveSettings()
      toast.remove(saveToastId)
    } catch (err) {
      toast.remove(saveToastId)
      toast.error(`保存失败: ${(err as Error).message}`)
    }
  }, [clearTestResult, saveSettings])

  const handleTestWeread = useCallback(async () => {
    clearTestResult()

    if (!window.electronAPI?.weread?.test) {
      toast.error('API 未正确初始化，请重启应用')
      return
    }

    if (!wereadApiKey) {
      toast.warning('请先输入微信读书 API Key')
      return
    }

    if (!/^[\x20-\x7E]+$/.test(wereadApiKey)) {
      toast.error('API Key 只能包含英文字母、数字和符号')
      return
    }

    const testToastId = toast.loading('正在测试微信读书连接...')
    try {
      await testWereadConnection()
    } catch (err) {
      toast.error('测试失败: ' + (err as Error).message)
    } finally {
      toast.remove(testToastId)
    }
  }, [clearTestResult, wereadApiKey, testWereadConnection])

  const handleTestAI = useCallback(async () => {
    clearTestResult()

    if (!window.electronAPI?.ai?.test) {
      toast.error('API 未正确初始化，请重启应用')
      return
    }

    if (!llmKey) {
      toast.warning('请先输入 API Key')
      return
    }

    if (!/^[\x20-\x7E]+$/.test(llmKey)) {
      toast.error('API Key 只能包含英文字母、数字和符号')
      return
    }

    const testToastId = toast.loading('正在测试 AI 服务连接...')
    try {
      await testAIConnection()
    } catch (err) {
      toast.error('测试失败: ' + (err as Error).message)
    } finally {
      toast.remove(testToastId)
    }
  }, [clearTestResult, llmKey, testAIConnection])

  const isWereadConfigured = wereadApiKey.length > 0
  const isLlmConfigured = llmKey.length > 0

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">设置</h1>
        <p className="text-gray-600 mt-1">配置API参数，连接微信读书和AI服务</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className={`bg-white rounded-xl border-2 p-4 transition-all duration-300 ${
          isWereadConfigured ? 'border-green-200 shadow-sm' : 'border-gray-200'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                isWereadConfigured ? 'bg-green-100' : 'bg-gray-100'
              }`}>
                <svg className={`w-5 h-5 ${isWereadConfigured ? 'text-green-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-gray-900">微信读书 API</h3>
                <p className="text-sm text-gray-500">同步书架和笔记</p>
              </div>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              isWereadConfigured
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-500'
            }`}>
              {isWereadConfigured ? '已配置' : '未配置'}
            </div>
          </div>
        </div>

        <div className={`bg-white rounded-xl border-2 p-4 transition-all duration-300 ${
          isLlmConfigured ? 'border-green-200 shadow-sm' : 'border-gray-200'
        }`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors ${
                isLlmConfigured ? 'bg-green-100' : 'bg-gray-100'
              }`}>
                <svg className={`w-5 h-5 ${isLlmConfigured ? 'text-green-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
              </div>
              <div>
                <h3 className="font-medium text-gray-900">AI 服务 API</h3>
                <p className="text-sm text-gray-500">AI摘要、卡片生成、对话</p>
              </div>
            </div>
            <div className={`px-3 py-1 rounded-full text-xs font-semibold transition-colors ${
              isLlmConfigured
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-100 text-gray-500'
            }`}>
              {isLlmConfigured ? '已配置' : '未配置'}
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="border-b border-gray-200">
          <div className="flex">
            <button
              onClick={() => { setActiveTab('weread'); clearTestResult() }}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-all duration-200 ${
                activeTab === 'weread'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                微信读书配置
              </div>
            </button>
            <button
              onClick={() => { setActiveTab('ai'); clearTestResult() }}
              className={`px-6 py-3 text-sm font-medium border-b-2 transition-all duration-200 ${
                activeTab === 'ai'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                </svg>
                AI 服务配置
              </div>
            </button>
          </div>
        </div>

        <div className="p-6">
          {activeTab === 'weread' ? (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  微信读书 API Key
                </label>
                <input
                  type="password"
                  value={wereadApiKey}
                  onChange={(e) => setWereadApiKey(e.target.value)}
                  placeholder="wrk-xxxxxxxx"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition-shadow"
                />
                <div className="mt-2 space-y-2">
                  <p className="text-xs text-gray-500">
                    用于通过 Agent API Gateway 访问微信读书数据
                  </p>
                  <p className="text-xs text-gray-400">
                    API Key 格式为 <code className="bg-gray-100 px-1 py-0.5 rounded">wrk-xxxxxxxx</code>，需要从微信读书开放平台获取
                  </p>
                </div>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-blue-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="text-sm text-blue-700">
                    <p className="font-medium mb-1">如何获取 API Key？</p>
                    <ol className="list-decimal list-inside space-y-1 text-blue-600">
                      <li>访问微信读书开放平台</li>
                      <li>申请开发者权限</li>
                      <li>在控制台获取 API Key</li>
                      <li>格式为 <code className="bg-blue-100 px-1 rounded">wrk-xxxxxxxx</code></li>
                    </ol>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleTestWeread}
                  disabled={testingWeread || !wereadApiKey}
                  className="px-4 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all duration-200 text-sm font-medium"
                >
                  {testingWeread ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                      测试中...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      测试连接
                    </>
                  )}
                </button>

                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2.5 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all duration-200 text-sm font-medium shadow-sm hover:shadow"
                >
                  {saving ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      保存中...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      保存配置
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  API Endpoint
                </label>
                <input
                  type="text"
                  value={llmEndpoint}
                  onChange={(e) => setLlmEndpoint(e.target.value)}
                  placeholder="https://api.example.com/v1"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition-shadow"
                />
                <p className="text-xs text-gray-500 mt-1">
                  支持任何兼容 OpenAI Chat Completions 的服务，如 DeepSeek、通义千问、Ollama 等
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  API Key
                </label>
                <input
                  type="password"
                  value={llmKey}
                  onChange={(e) => setLlmKey(e.target.value)}
                  placeholder="sk-xxxxxxxxxxxxxxxxxxxxxxxx"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition-shadow"
                />
                <p className="text-xs text-gray-500 mt-1">
                  您的 API Key 仅存储在本地，不会上传到任何服务器
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  模型名称
                </label>
                <input
                  type="text"
                  value={llmModel}
                  onChange={(e) => setLlmModel(e.target.value)}
                  placeholder="gpt-4o / claude-3 / deepseek-chat"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary focus:border-transparent transition-shadow"
                />
                <p className="text-xs text-gray-500 mt-1">
                  输入您要使用的模型名称，如 gpt-4o、claude-3、deepseek-chat 等
                </p>
              </div>

              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-blue-500 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="text-sm text-blue-700">
                    <p className="font-medium mb-1">支持的服务</p>
                    <ul className="list-disc list-inside mt-1 text-blue-600">
                      <li>Ollama (本地)</li>
                      <li>LM Studio (本地)</li>
                      <li>DeepSeek API</li>
                      <li>通义千问 API</li>
                      <li>其他兼容 OpenAI 接口的服务</li>
                    </ul>
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleTestAI}
                  disabled={testingAI || !llmKey}
                  className="px-4 py-2.5 bg-white border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all duration-200 text-sm font-medium"
                >
                  {testingAI ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-gray-600"></div>
                      测试中...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                      测试连接
                    </>
                  )}
                </button>

                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2.5 bg-primary text-white rounded-lg hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 transition-all duration-200 text-sm font-medium shadow-sm hover:shadow"
                >
                  {saving ? (
                    <>
                      <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                      保存中...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                      保存配置
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="bg-gray-50 rounded-xl p-6 border border-gray-200">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">关于</h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-gray-600">应用名称</span>
            <span className="font-medium text-gray-900">知行读书</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600">版本</span>
            <span className="font-medium text-gray-900">v1.0.0</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-gray-600">技术栈</span>
            <span className="font-medium text-gray-900">React + TypeScript + Electron</span>
          </div>
        </div>
        <div className="mt-4 pt-4 border-t border-gray-200">
          <p className="text-sm text-gray-600">
            知行读书是一款基于间隔重复算法的读书笔记管理工具，
            帮助你更好地理解和记忆书籍内容。
          </p>
        </div>
      </div>
    </div>
  )
}
