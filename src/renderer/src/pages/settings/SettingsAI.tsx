/**
 * SettingsAI — AI 配置（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/settings-ai.html
 * 3 张卡片：LLM 服务配置 / RAG 配置 / 提示词模板管理
 * 业务逻辑：复用 settingsStore（llmEndpoint/llmKey/llmModel + testAIConnection），
 *           扩展字段（maxTokens/temperature/rag/templates）通过 settings.set 持久化。
 * 注：智能体编排已独立为 /agent-orchestration，相关参数由该页面管理（T10/T12）。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Card, { CardHead } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { Loading, Tiny } from '@/components/ui/Feedback'
import { useSettingsStore } from '@/stores/settingsStore'
import { toast } from '@/stores/toastStore'

// ===== 常量 =====

const DEFAULTS = {
  llmEndpoint: 'https://api.openai.com/v1',
  llmModel: 'gpt-4o',
  llmMaxTokens: 4096,
  llmTemperature: 0.7,
  ragCollection: 'zhixing_books',
  embeddingModel: 'text-embedding-3-small',
}

interface TemplateRow {
  id: string
  name: string
  desc: string
  enabled: boolean
  isCustom?: boolean
}

const DEFAULT_TEMPLATES: TemplateRow[] = [
  { id: 'general', name: '通用对话', desc: '默认对话场景，平衡知识性与互动性', enabled: true },
  { id: 'knowledge', name: '知识查询', desc: '基于 RAG 检索的精准知识问答场景', enabled: true },
  { id: 'practice', name: '教学练习', desc: '苏格拉底式提问与费曼教学法练习场景', enabled: true },
  { id: 'discussion', name: '深度讨论', desc: '多轮深度探讨与批判性思维训练场景', enabled: false },
]

interface NavItem {
  key: string
  label: string
  icon: 'user' | 'settings' | 'bookshelf' | 'box' | 'sun' | 'question'
  path: string
  domId: string
}

const NAV_ITEMS: NavItem[] = [
  { key: 'account', label: '账户', icon: 'user', path: '/settings/account', domId: 'settings-tab-account' },
  { key: 'ai', label: 'AI配置', icon: 'settings', path: '/settings/ai', domId: 'settings-tab-ai' },
  { key: 'agent', label: '智能体编排', icon: 'settings', path: '/agent-orchestration', domId: 'settings-tab-agent' },
  { key: 'weread', label: '微信读书', icon: 'bookshelf', path: '/settings/weread', domId: 'settings-tab-weread' },
  { key: 'data', label: '数据与存储', icon: 'box', path: '/settings/data', domId: 'settings-tab-data' },
  { key: 'appearance', label: '外观', icon: 'sun', path: '/settings/appearance', domId: 'settings-tab-appearance' },
  { key: 'about', label: '关于', icon: 'question', path: '/settings/about', domId: 'settings-tab-about' },
]

// LLM 连接测试状态
type ConnStatus = 'idle' | 'testing' | 'ok' | 'fail'

// ===== 安全读取辅助：把后端返回值强制成期望类型，缺失时回退到 fallback =====
function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback
}
function asNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (!Number.isNaN(n)) return n
  }
  return fallback
}

// ===== 组件 =====

export default function SettingsAI() {
  const navigate = useNavigate()
  const {
    llmEndpoint,
    llmKey,
    llmModel,
    loading,
    saving,
    testingAI,
    loadSettings,
    saveSettings,
    testAIConnection,
    setLlmEndpoint,
    setLlmKey,
    setLlmModel,
  } = useSettingsStore()

  // ===== 扩展字段（本地 state，挂载时通过 settings.get 加载） =====
  const [maxTokens, setMaxTokens] = useState<number>(DEFAULTS.llmMaxTokens)
  const [temperature, setTemperature] = useState<number>(DEFAULTS.llmTemperature)
  const [collection, setCollection] = useState<string>(DEFAULTS.ragCollection)
  const [embeddingModel, setEmbeddingModel] = useState<string>(DEFAULTS.embeddingModel)
  const [templates, setTemplates] = useState<TemplateRow[]>(DEFAULT_TEMPLATES)

  // ===== UI 状态 =====
  const [showApiKey, setShowApiKey] = useState(false)
  const [connStatus, setConnStatus] = useState<ConnStatus>('idle')

  // ===== 自定义模板状态 =====
  const [customTemplates, setCustomTemplates] = useState<TemplateRow[]>([])
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)
  const [newTemplateName, setNewTemplateName] = useState('')
  const [newTemplateContent, setNewTemplateContent] = useState('')
  const [savingTemplate, setSavingTemplate] = useState(false)

  // ===== 加载基础设置（settingsStore：llmEndpoint/llmKey/llmModel） =====
  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // ===== 加载扩展字段（settings.get） =====
  useEffect(() => {
    const loadExtras = async () => {
      const api = window.electronAPI
      if (!api?.settings?.get) return
      try {
        const [
          mt, tp, col, em,
          tg, tk, tp2, td,
        ] = await Promise.all([
          api.settings.get('llmMaxTokens'),
          api.settings.get('llmTemperature'),
          api.settings.get('ragCollection'),
          api.settings.get('embeddingModel'),
          api.settings.get('promptTemplateGeneralEnabled'),
          api.settings.get('promptTemplateKnowledgeEnabled'),
          api.settings.get('promptTemplatePracticeEnabled'),
          api.settings.get('promptTemplateDiscussionEnabled'),
        ])
        setMaxTokens(asNumber(mt, DEFAULTS.llmMaxTokens))
        setTemperature(asNumber(tp, DEFAULTS.llmTemperature))
        setCollection(asString(col, DEFAULTS.ragCollection))
        setEmbeddingModel(asString(em, DEFAULTS.embeddingModel))
        setTemplates((prev) =>
          prev.map((t) => {
            const flagMap: Record<string, unknown> = {
              general: tg,
              knowledge: tk,
              practice: tp2,
              discussion: td,
            }
            const flag = flagMap[t.id]
            if (flag === true || flag === 'true') return { ...t, enabled: true }
            if (flag === false || flag === 'false') return { ...t, enabled: false }
            return t
          }),
        )
      } catch {
        /* 静默：保持默认值 */
      }
    }
    loadExtras()
  }, [])

  // ===== 监听 store 测试结果，同步连接状态 =====
  useEffect(() => {
    const unsub = useSettingsStore.subscribe((state) => {
      const r = state.testResult
      if (r?.type === 'ai') {
        setConnStatus(r.success ? 'ok' : 'fail')
      }
    })
    return unsub
  }, [])

  // ===== 测试 AI 连接 =====
  const handleTestConnection = useCallback(async () => {
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
    setConnStatus('testing')
    const tId = toast.loading('正在测试 AI 服务连接...')
    try {
      await testAIConnection()
      toast.remove(tId)
      // 从 store 读取测试结果并显示对应 toast
      const result = useSettingsStore.getState().testResult
      if (result?.type === 'ai') {
        if (result.success) {
          toast.success(`连接正常 · ${result.message || '测试通过'}`, 3000)
        } else {
          toast.error(`连接失败 · ${result.message || '测试未通过'}`, 4000)
        }
      }
    } catch (err) {
      toast.remove(tId)
      setConnStatus('fail')
      toast.error(`测试失败: ${(err as Error).message}`, 4000)
    }
  }, [llmKey, testAIConnection])

  // ===== 保存全部配置 =====
  const handleSave = useCallback(async () => {
    if (!window.electronAPI?.settings?.set) {
      toast.error('API 未正确初始化，请重启应用')
      return
    }
    const tId = toast.loading('正在保存配置...')
    try {
      // 1. 持久化扩展字段
      await Promise.all([
        window.electronAPI.settings.set('llmMaxTokens', maxTokens),
        window.electronAPI.settings.set('llmTemperature', temperature),
        window.electronAPI.settings.set('ragCollection', collection),
        window.electronAPI.settings.set('embeddingModel', embeddingModel),
        window.electronAPI.settings.set('promptTemplateGeneralEnabled', templates[0].enabled),
        window.electronAPI.settings.set('promptTemplateKnowledgeEnabled', templates[1].enabled),
        window.electronAPI.settings.set('promptTemplatePracticeEnabled', templates[2].enabled),
        window.electronAPI.settings.set('promptTemplateDiscussionEnabled', templates[3].enabled),
      ])
      // 2. 调 store.saveSettings（含 llmEndpoint/llmKey/llmModel + ai.setConfig + weread.setApiKey）
      await saveSettings()
      toast.remove(tId)
      toast.success('配置保存成功！')
    } catch (err) {
      toast.remove(tId)
      toast.error(`保存失败: ${(err as Error).message}`)
    }
  }, [
    maxTokens,
    temperature,
    collection,
    embeddingModel,
    templates,
    saveSettings,
  ])

  // ===== 重置默认 =====
  const handleReset = useCallback(() => {
    setLlmEndpoint(DEFAULTS.llmEndpoint)
    setLlmKey('')
    setLlmModel(DEFAULTS.llmModel)
    setMaxTokens(DEFAULTS.llmMaxTokens)
    setTemperature(DEFAULTS.llmTemperature)
    setCollection(DEFAULTS.ragCollection)
    setEmbeddingModel(DEFAULTS.embeddingModel)
    setTemplates(DEFAULT_TEMPLATES)
    setConnStatus('idle')
    setShowApiKey(false)
    toast.info('已恢复默认值，请点击「保存配置」生效')
  }, [
    setLlmEndpoint,
    setLlmKey,
    setLlmModel,
  ])

  // ===== 模板 toggle =====
  const toggleTemplate = useCallback((id: string) => {
    setTemplates((prev) => prev.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)))
  }, [])

  // ===== 编辑内置模板（跳转到 /admin 提示词管理面板） =====
  const handleEditTemplate = useCallback((id: string) => {
    void id
    navigate('/admin')
  }, [navigate])

  // ===== 加载自定义模板列表 =====
  const loadCustomTemplates = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.admin?.getCustomPrompts) return
    try {
      const list = await api.admin.getCustomPrompts()
      setCustomTemplates(
        (list ?? []).map((p) => ({
          id: p.id,
          name: p.name,
          desc: `自定义模板 · 创建于 ${new Date(p.createdAt).toLocaleString('zh-CN')}`,
          enabled: true,
          isCustom: true,
        })),
      )
    } catch {
      /* 静默：列表保持空 */
    }
  }, [])

  useEffect(() => {
    loadCustomTemplates()
  }, [loadCustomTemplates])

  // ===== 新建模板：打开 Modal（重置表单） =====
  const handleNewTemplate = useCallback(() => {
    setEditingTemplateId(null)
    setNewTemplateName('')
    setNewTemplateContent('')
    setShowCreateModal(true)
  }, [])

  // ===== 保存模板（新建或更新） =====
  const handleSaveTemplate = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.admin?.createCustomPrompt || !api?.admin?.updateCustomPrompt) {
      toast.error('API 未正确初始化，请重启应用')
      return
    }
    const name = newTemplateName.trim()
    const content = newTemplateContent.trim()
    if (!name) {
      toast.warning('请输入模板名称')
      return
    }
    if (!content) {
      toast.warning('请输入模板内容')
      return
    }
    setSavingTemplate(true)
    const tId = toast.loading(editingTemplateId ? '正在更新模板...' : '正在创建模板...')
    try {
      if (editingTemplateId) {
        await api.admin.updateCustomPrompt(editingTemplateId, name, content)
        toast.remove(tId)
        toast.success('模板已更新')
      } else {
        await api.admin.createCustomPrompt(name, content)
        toast.remove(tId)
        toast.success('模板已创建')
      }
      setShowCreateModal(false)
      setEditingTemplateId(null)
      setNewTemplateName('')
      setNewTemplateContent('')
      await loadCustomTemplates()
    } catch (err) {
      toast.remove(tId)
      toast.error(`保存失败: ${(err as Error).message}`)
    } finally {
      setSavingTemplate(false)
    }
  }, [editingTemplateId, newTemplateName, newTemplateContent, loadCustomTemplates])

  // ===== 编辑自定义模板：拉取最新内容，填充表单并打开 Modal =====
  const handleEditCustom = useCallback(async (id: string) => {
    const api = window.electronAPI
    if (!api?.admin?.getCustomPrompts) return
    try {
      const list = await api.admin.getCustomPrompts()
      const target = (list ?? []).find((p) => p.id === id)
      if (!target) {
        toast.error('模板不存在或已被删除')
        return
      }
      setEditingTemplateId(target.id)
      setNewTemplateName(target.name)
      setNewTemplateContent(target.content)
      setShowCreateModal(true)
    } catch (err) {
      toast.error(`加载模板失败: ${(err as Error).message}`)
    }
  }, [])

  // ===== 删除自定义模板 =====
  const handleDeleteCustom = useCallback(async (id: string) => {
    const api = window.electronAPI
    if (!api?.admin?.deleteCustomPrompt) {
      toast.error('API 未正确初始化，请重启应用')
      return
    }
    if (!window.confirm('确定删除该自定义模板？此操作不可撤销。')) return
    const tId = toast.loading('正在删除模板...')
    try {
      await api.admin.deleteCustomPrompt(id)
      toast.remove(tId)
      toast.success('模板已删除')
      await loadCustomTemplates()
    } catch (err) {
      toast.remove(tId)
      toast.error(`删除失败: ${(err as Error).message}`)
    }
  }, [loadCustomTemplates])

  // ===== 取消 Modal =====
  const handleCancelModal = useCallback(() => {
    setShowCreateModal(false)
    setEditingTemplateId(null)
    setNewTemplateName('')
    setNewTemplateContent('')
  }, [])

  // ===== Modal 无障碍：ESC 关闭 + 打开时聚焦首个输入框 =====
  const firstInputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!showCreateModal) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancelModal()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    const focusTimer = setTimeout(() => firstInputRef.current?.focus(), 0)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      clearTimeout(focusTimer)
    }
  }, [showCreateModal, handleCancelModal])

  if (loading) {
    return <Loading hint="正在加载 AI 配置..." />
  }

  // ===== 派生：连接状态徽章内容 =====
  const connBadge = (() => {
    switch (connStatus) {
      case 'testing':
        return { text: '测试中...', dotClass: 'badge-dot-warning', wrapClass: 'badge-warning' }
      case 'ok':
        return { text: '连接正常', dotClass: 'badge-dot-success', wrapClass: 'badge-success' }
      case 'fail':
        return { text: '连接失败', dotClass: 'badge-dot-error', wrapClass: 'badge-error' }
      default:
        return { text: '未测试', dotClass: 'badge-dot-muted', wrapClass: 'badge-muted' }
    }
  })()

  return (
    <>
      <PageHero
        title="AI配置"
        subtitle="配置大语言模型服务与智能体参数"
        actions={
          <>
            <Button
              variant="primary"
              onClick={handleSave}
              disabled={saving}
              data-dom-id="cta-save-ai"
            >
              {saving ? '保存中...' : '保存配置'}
            </Button>
            <Button
              variant="ghost"
              onClick={handleReset}
              disabled={saving}
              data-dom-id="cta-reset-ai"
            >
              重置默认
            </Button>
          </>
        }
      >
        {/* ===== Settings body：1fr 左导航 + 2fr 右表单卡片 ===== */}
        <div
          className="settings-body"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 2fr',
            gap: 'calc(var(--spacing) * 5)',
            alignItems: 'flex-start',
          }}
        >
          {/* ===== 左：设置分类导航（sticky） ===== */}
          <aside
            className="card settings-nav"
            style={{
              position: 'sticky',
              top: 'calc(var(--spacing) * 4)',
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 'calc(var(--radius) + 6px)',
              padding: 'calc(var(--spacing) * 4)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'calc(var(--spacing) * 2)',
              boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div
              className="nav-label"
              style={{
                padding: '0 calc(var(--spacing) * 3) calc(var(--spacing) * 2)',
                color: 'var(--muted-foreground)',
                fontSize: '0.78rem',
                textTransform: 'uppercase',
                letterSpacing: '0.08em',
              }}
            >
              设置分类
            </div>
            {NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                className="settings-nav-item"
                data-active={item.key === 'ai'}
                aria-current={item.key === 'ai' ? 'page' : undefined}
                data-dom-id={item.domId}
                onClick={() => navigate(item.path)}
              >
                <span className="nav-glyph" style={{ width: 18, flexShrink: 0, display: 'grid', placeItems: 'center' }}>
                  <Icon name={item.icon} size={18} />
                </span>
                <span className="nav-text" style={{ fontSize: '0.88rem' }}>{item.label}</span>
              </button>
            ))}
          </aside>

          {/* ===== 右：表单卡片堆叠 ===== */}
          <div
            className="settings-forms"
            style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 5)' }}
          >
            {/* ===== Card 1: LLM 服务配置 ===== */}
            <Card>
              <CardHead eyebrow="LLM 服务" title="模型与 API 配置" />
              <div
                className="form-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 'calc(var(--spacing) * 4)',
                }}
              >
                {/* API Endpoint */}
                <div className="form-field form-field-full">
                  <label className="form-label" htmlFor="llm-endpoint">API Endpoint</label>
                  <input
                    className="form-input"
                    id="llm-endpoint"
                    type="text"
                    placeholder="https://api.openai.com/v1"
                    value={llmEndpoint}
                    onChange={(e) => setLlmEndpoint(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                </div>
                {/* API Key + 显隐切换 */}
                <div className="form-field form-field-full">
                  <label className="form-label" htmlFor="llm-apikey">API Key</label>
                  <div className="input-with-action" style={{ position: 'relative' }}>
                    <input
                      className="form-input"
                      id="llm-apikey"
                      type={showApiKey ? 'text' : 'password'}
                      value={llmKey}
                      onChange={(e) => setLlmKey(e.target.value)}
                      placeholder="sk-xxxxxxxx"
                      style={{ fontFamily: 'var(--font-mono)', paddingRight: 'calc(var(--spacing) * 10)' }}
                    />
                    <button
                      className="input-action"
                      type="button"
                      onClick={() => setShowApiKey((v) => !v)}
                      data-dom-id="toggle-apikey-visibility"
                      aria-label="显示或隐藏 API Key"
                    >
                      {showApiKey ? (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={18} height={18} aria-hidden="true">
                          <path d="M9.88 9.88a3 3 0 1 0 4.24 4.24" />
                          <path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68" />
                          <path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61" />
                          <line x1="2" x2="22" y1="2" y2="22" />
                        </svg>
                      ) : (
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={18} height={18} aria-hidden="true">
                          <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
                          <circle cx="12" cy="12" r="3" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>
                {/* 模型 */}
                <div className="form-field">
                  <label className="form-label" htmlFor="llm-model">模型</label>
                  <input
                    className="form-input"
                    id="llm-model"
                    type="text"
                    placeholder="如 deepseek-chat / deepseek-reasoner / gpt-4o"
                    value={llmModel}
                    onChange={(e) => setLlmModel(e.target.value)}
                    style={{ fontFamily: 'var(--font-mono)' }}
                  />
                  <div className="form-hint">支持自定义输入模型名，需与 API 厂商文档一致</div>
                </div>
                {/* Max Tokens */}
                <div className="form-field">
                  <label className="form-label" htmlFor="llm-max-tokens">Max Tokens</label>
                  <input
                    className="form-input"
                    id="llm-max-tokens"
                    type="number"
                    min={1}
                    max={128000}
                    value={maxTokens}
                    onChange={(e) => setMaxTokens(Number(e.target.value) || 0)}
                    style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                  />
                </div>
                {/* Temperature slider */}
                <div className="form-field form-field-full">
                  <label className="form-label" htmlFor="llm-temperature">Temperature</label>
                  <div
                    className="slider-row"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'calc(var(--spacing) * 4)',
                      width: '100%',
                    }}
                  >
                    <input
                      className="slider"
                      id="llm-temperature"
                      type="range"
                      min={0}
                      max={2}
                      step={0.1}
                      value={temperature}
                      onChange={(e) => setTemperature(Number(e.target.value))}
                      aria-label="Temperature 滑块"
                    />
                    <span
                      className="slider-value"
                      style={{
                        minWidth: 52,
                        textAlign: 'right',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.88rem',
                        color: 'var(--foreground)',
                        fontVariantNumeric: 'tabular-nums',
                        flexShrink: 0,
                      }}
                    >
                      {temperature.toFixed(1)}
                    </span>
                  </div>
                  <div className="form-hint">值越低输出越确定，值越高输出越有创造性（范围 0.0 - 2.0）</div>
                </div>
              </div>
              {/* 测试连接行 */}
              <div
                className="test-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'calc(var(--spacing) * 3)',
                  marginTop: 'calc(var(--spacing) * 4)',
                  paddingTop: 'calc(var(--spacing) * 4)',
                  borderTop: '1px solid var(--border)',
                  flexWrap: 'wrap',
                }}
              >
                <Button
                  variant="secondary"
                  onClick={handleTestConnection}
                  disabled={testingAI || saving}
                  data-dom-id="cta-test-connection"
                >
                  {testingAI ? '测试中...' : '测试连接'}
                </Button>
                <span className={`badge ${connBadge.wrapClass}`} id="llm-connection-status">
                  <span className={`badge-dot ${connBadge.dotClass}`} aria-hidden="true"></span>
                  {connBadge.text}
                </span>
              </div>
            </Card>

            {/* ===== Card 2: RAG 配置（已隐藏：用户无需配置本地向量检索） ===== */}

            {/* ===== Card 3: 提示词模板管理 =====
                 注：原 Card 3「Agent 参数」已迁移至 /agent-orchestration（独立智能体编排分类，T10/T12）。
                  */}
            <Card>
              <CardHead
                eyebrow="提示词模板"
                title="模板管理"
                action={
                  <Button
                    variant="secondary"
                    onClick={handleNewTemplate}
                    data-dom-id="cta-new-template"
                  >
                    <Icon name="plus" size={16} />
                    新建模板
                  </Button>
                }
              />
              {templates.map((t, idx) => (
                <div
                  key={t.id}
                  className="template-row"
                  title={`【${t.name}】${t.desc}。点击编辑修改模板内容，点击开关启用/禁用该模板。`}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: idx === 0 ? '0 0 calc(var(--spacing) * 3)' : 'calc(var(--spacing) * 3) 0',
                    borderTop: idx === 0 ? 'none' : '1px solid var(--border)',
                    gap: 'calc(var(--spacing) * 3)',
                    flexWrap: 'wrap',
                  }}
                >
                  <div className="template-info" style={{ minWidth: 0, flex: 1 }}>
                    <strong style={{ display: 'block', fontSize: '0.92rem', fontWeight: 600, color: 'var(--foreground)' }}>
                      {t.name}
                    </strong>
                    <Tiny>{t.desc}</Tiny>
                  </div>
                  <div
                    className="template-actions"
                    style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)', flexShrink: 0 }}
                  >
                    <button
                      className="icon-btn-sm"
                      type="button"
                      onClick={() => handleEditTemplate(t.id)}
                      data-dom-id={`edit-template-${t.id}`}
                      aria-label={`编辑${t.name}模板`}
                      title="编辑模板内容（跳转至管理面板）"
                    >
                      <Icon name="edit" size={16} />
                    </button>
                    <button
                      className="toggle"
                      type="button"
                      data-on={t.enabled}
                      onClick={() => toggleTemplate(t.id)}
                      data-dom-id={`toggle-template-${t.id}`}
                      aria-label={`启用${t.name}模板`}
                      aria-pressed={t.enabled}
                      title={t.enabled ? `当前已启用，点击禁用「${t.name}」` : `当前已禁用，点击启用「${t.name}」`}
                    />
                  </div>
                </div>
              ))}
              {customTemplates.map((t) => (
                <div
                  key={t.id}
                  className="template-row"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: 'calc(var(--spacing) * 3) 0',
                    borderTop: '1px solid var(--border)',
                    gap: 'calc(var(--spacing) * 3)',
                    flexWrap: 'wrap',
                  }}
                >
                  <div className="template-info" style={{ minWidth: 0, flex: 1 }}>
                    <strong
                      style={{
                        display: 'block',
                        fontSize: '0.92rem',
                        fontWeight: 600,
                        color: 'var(--foreground)',
                      }}
                    >
                      {t.name}
                      <span
                        style={{
                          marginLeft: 'calc(var(--spacing) * 2)',
                          fontSize: '0.72rem',
                          color: 'var(--primary)',
                          fontWeight: 500,
                        }}
                      >
                        自定义
                      </span>
                    </strong>
                    <Tiny>{t.desc}</Tiny>
                  </div>
                  <div
                    className="template-actions"
                    style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)', flexShrink: 0 }}
                  >
                    <button
                      className="icon-btn-sm"
                      type="button"
                      onClick={() => handleEditCustom(t.id)}
                      data-dom-id={`edit-custom-template-${t.id}`}
                      aria-label={`编辑自定义模板${t.name}`}
                    >
                      <Icon name="edit" size={16} />
                    </button>
                    <button
                      className="icon-btn-sm"
                      type="button"
                      onClick={() => handleDeleteCustom(t.id)}
                      data-dom-id={`delete-custom-template-${t.id}`}
                      aria-label={`删除自定义模板${t.name}`}
                      style={{ color: 'var(--state-error)' }}
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                </div>
              ))}
            </Card>
          </div>
        </div>
      </PageHero>

      {/* ===== 新建/编辑模板 Modal ===== */}
      {showCreateModal && (
        <div
          className="modal-overlay"
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 1000,
            padding: 'calc(var(--spacing) * 4)',
          }}
          onClick={handleCancelModal}
        >
          <div
            className="modal-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-modal-title"
            style={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 'calc(var(--radius) + 6px)',
              padding: 'calc(var(--spacing) * 6)',
              width: '100%',
              maxWidth: 640,
              maxHeight: '90vh',
              overflow: 'auto',
              boxShadow: 'var(--shadow-lg)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ marginBottom: 'calc(var(--spacing) * 4)' }}>
              <strong
                id="template-modal-title"
                style={{
                  display: 'block',
                  fontSize: '1.05rem',
                  fontWeight: 600,
                  color: 'var(--foreground)',
                }}
              >
                {editingTemplateId ? '编辑模板' : '新建模板'}
              </strong>
              <Tiny>自定义模板保存在本地 settings.json，可在管理面板查看</Tiny>
            </div>
            <div className="form-field" style={{ marginBottom: 'calc(var(--spacing) * 4)' }}>
              <label className="form-label" htmlFor="new-template-name">
                模板名称
              </label>
              <input
                ref={firstInputRef}
                className="form-input"
                id="new-template-name"
                type="text"
                placeholder="例如：写作辅助"
                value={newTemplateName}
                onChange={(e) => setNewTemplateName(e.target.value)}
                maxLength={50}
                data-dom-id="input-template-name"
              />
            </div>
            <div className="form-field" style={{ marginBottom: 'calc(var(--spacing) * 5)' }}>
              <label className="form-label" htmlFor="new-template-content">
                模板内容
              </label>
              <textarea
                className="form-input"
                id="new-template-content"
                placeholder="请输入提示词模板内容，支持变量占位符 {{varName}}"
                value={newTemplateContent}
                onChange={(e) => setNewTemplateContent(e.target.value)}
                rows={8}
                style={{
                  resize: 'vertical',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.85rem',
                  lineHeight: 1.5,
                  minHeight: 200,
                }}
                data-dom-id="input-template-content"
              />
            </div>
            <div
              className="modal-actions"
              style={{
                display: 'flex',
                justifyContent: 'flex-end',
                gap: 'calc(var(--spacing) * 3)',
              }}
            >
              <Button variant="ghost" onClick={handleCancelModal} disabled={savingTemplate}>
                取消
              </Button>
              <Button
                variant="primary"
                onClick={handleSaveTemplate}
                disabled={savingTemplate}
                data-dom-id="cta-save-template"
              >
                {savingTemplate ? '保存中...' : editingTemplateId ? '保存修改' : '创建模板'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* ===== 设计稿专属样式（form / slider / toggle / icon-btn-sm / settings-nav） ===== */}
      <style>{`
        .form-field { display: flex; flex-direction: column; gap: calc(var(--spacing) * 2); }
        .form-field-full { grid-column: 1 / -1; }
        .form-label {
          font-size: 0.82rem;
          font-weight: 500;
          color: var(--card-foreground);
        }
        .form-input, .form-select {
          padding: calc(var(--spacing) * 3) calc(var(--spacing) * 4);
          border: 1px solid var(--input);
          border-radius: var(--radius);
          background: var(--popover);
          color: var(--foreground);
          font-size: 0.92rem;
          font-family: inherit;
          outline: none;
          transition: border-color 0.2s ease;
          width: 100%;
        }
        .form-input:focus, .form-select:focus { border-color: var(--ring); }
        .form-input::placeholder { color: var(--muted-foreground); }
        .form-hint {
          font-size: 0.76rem;
          color: var(--muted-foreground);
          line-height: 1.4;
        }

        /* Slider */
        .slider {
          flex: 1;
          -webkit-appearance: none;
          appearance: none;
          height: 4px;
          border-radius: 999px;
          background: var(--muted);
          outline: none;
          cursor: pointer;
          min-width: 0;
        }
        .slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--primary);
          cursor: pointer;
          border: 2px solid var(--card);
          transition: transform 0.16s ease;
        }
        .slider::-webkit-slider-thumb:hover { transform: scale(1.15); }
        .slider::-moz-range-thumb {
          width: 18px;
          height: 18px;
          border-radius: 50%;
          background: var(--primary);
          cursor: pointer;
          border: 2px solid var(--card);
        }
        .slider:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 4px;
          border-radius: 999px;
        }

        /* Input action (show/hide API Key) */
        .input-action {
          position: absolute;
          right: calc(var(--spacing) * 3);
          top: 50%;
          transform: translateY(-50%);
          background: none;
          border: none;
          cursor: pointer;
          color: var(--muted-foreground);
          padding: calc(var(--spacing) * 1);
          display: grid;
          place-items: center;
          border-radius: var(--radius);
          transition: color 0.2s ease;
        }
        .input-action:hover { color: var(--foreground); }
        .input-action:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }

        /* Badge dot & wrap (语义状态) */
        .badge {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.34rem 0.65rem;
          border-radius: 999px;
          font-size: 0.8rem;
          white-space: nowrap;
        }
        .badge-success { background: var(--muted); color: var(--state-success); }
        .badge-error { background: var(--muted); color: var(--state-error); }
        .badge-warning { background: var(--muted); color: var(--state-warning); }
        .badge-muted { background: var(--muted); color: var(--muted-foreground); }
        .badge-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
          background: var(--muted-foreground);
        }
        .badge-dot-success { background: var(--state-success); }
        .badge-dot-error { background: var(--state-error); }
        .badge-dot-warning { background: var(--state-warning); }
        .badge-dot-muted { background: var(--muted-foreground); }

        /* Toggle switch */
        .toggle {
          width: 44px;
          height: 24px;
          border-radius: 999px;
          background: var(--primary);
          position: relative;
          cursor: pointer;
          transition: background 0.2s ease;
          flex-shrink: 0;
          border: none;
        }
        .toggle::after {
          content: "";
          position: absolute;
          top: 2px;
          right: 2px;
          width: 20px;
          height: 20px;
          border-radius: 50%;
          background: var(--card);
          transition: transform 0.2s ease;
        }
        .toggle[data-on="false"] { background: var(--muted); }
        .toggle[data-on="false"]::after { right: auto; left: 2px; }
        .toggle:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }

        /* Small icon button (template edit) */
        .icon-btn-sm {
          width: 32px;
          height: 32px;
          display: grid;
          place-items: center;
          border: 1px solid var(--border);
          background: var(--card);
          color: var(--muted-foreground);
          border-radius: var(--radius);
          cursor: pointer;
          transition: background 0.2s ease, color 0.2s ease, border-color 0.2s ease;
          flex-shrink: 0;
        }
        .icon-btn-sm:hover {
          background: var(--sidebar-accent);
          color: var(--sidebar-accent-foreground);
          border-color: var(--sidebar-border);
        }
        .icon-btn-sm:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }

        /* Link button removed: agent config CTA 已迁移到设置导航（T10） */

        /* Settings nav items */
        .settings-nav-item {
          width: 100%;
          padding: calc(var(--spacing) * 3) calc(var(--spacing) * 4);
          text-align: left;
          border: none;
          background: transparent;
          border-radius: var(--radius);
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: calc(var(--spacing) * 3);
          color: var(--muted-foreground);
          transition: background 0.2s ease, color 0.2s ease;
          font-family: inherit;
          font-size: 0.88rem;
        }
        .settings-nav-item:hover {
          background: var(--sidebar-accent);
          color: var(--foreground);
        }
        .settings-nav-item[data-active="true"] {
          background: var(--sidebar-accent);
          color: var(--primary);
          font-weight: 600;
        }
        .settings-nav-item:focus-visible {
          outline: 2px solid var(--ring);
          outline-offset: 2px;
        }

        /* Responsive */
        @media (max-width: 1100px) {
          .settings-body { grid-template-columns: 1fr !important; }
          .settings-nav { position: static !important; }
          .form-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 760px) {
          .test-row { flex-direction: column; align-items: flex-start; gap: calc(var(--spacing) * 3); }
          .template-row { flex-direction: column; align-items: flex-start; gap: calc(var(--spacing) * 3); }
          .template-actions { width: 100%; justify-content: space-between; }
        }
      `}</style>
    </>
  )
}
