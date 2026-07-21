/**
 * Settings — 设置总页（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/settings.html
 * 左侧 1fr 分类导航（sticky）+ 右侧 2fr 6 张表单卡片
 * 业务逻辑：loadSettings / saveSettings / testWereadConnection / 路由跳转 6 子页 / toast 通知
 */

import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Card, { CardHead } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { Tiny } from '@/components/ui/Feedback'
import { useSettingsStore } from '../stores/settingsStore'
import { toast } from '../stores/toastStore'

type SettingsTab = 'account' | 'ai' | 'weread' | 'data' | 'appearance' | 'about'
type ThemeMode = 'light' | 'dark' | 'system'
type FontSize = 'small' | 'medium' | 'large'

interface NavItemDef {
  key: SettingsTab
  label: string
  icon: ReactNode
  path: string
}

const NAV_ITEMS: NavItemDef[] = [
  { key: 'account', label: '账户', icon: <Icon name="user" size={18} />, path: '/settings/account' },
  { key: 'ai', label: 'AI 配置', icon: <Icon name="agent" size={18} />, path: '/settings/ai' },
  { key: 'weread', label: '微信读书', icon: <Icon name="bookshelf" size={18} />, path: '/settings/weread' },
  { key: 'data', label: '数据与存储', icon: <Icon name="box" size={18} />, path: '/settings/data' },
  { key: 'appearance', label: '外观', icon: <Icon name="sun" size={18} />, path: '/settings/appearance' },
  { key: 'about', label: '关于', icon: <Icon name="question" size={18} />, path: '/settings/about' },
]

const EYEBROW_STYLE: CSSProperties = {
  color: 'var(--muted-foreground)',
  fontSize: '0.78rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}

const FORM_LABEL_STYLE: CSSProperties = {
  fontSize: '0.82rem',
  fontWeight: 500,
  color: 'var(--card-foreground)',
}

const FORM_FIELD_STYLE: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'calc(var(--spacing) * 2)',
}

const FORM_INPUT_STYLE: CSSProperties = {
  padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
  border: '1px solid var(--input)',
  borderRadius: 'var(--radius)',
  background: 'var(--popover)',
  color: 'var(--foreground)',
  fontSize: '0.92rem',
  fontFamily: 'inherit',
  outline: 'none',
  transition: 'border-color 0.2s ease',
  width: '100%',
}

const FORM_ROW_STYLE: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: 'calc(var(--spacing) * 3) 0',
  borderTop: '1px solid var(--border)',
  marginTop: 'calc(var(--spacing) * 4)',
  gap: 'calc(var(--spacing) * 4)',
}

const STORAGE_ITEM_STYLE: CSSProperties = {
  padding: 'calc(var(--spacing) * 4)',
  background: 'var(--background)',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
}

const STORAGE_VALUE_STYLE: CSSProperties = {
  display: 'block',
  fontSize: '1.4rem',
  fontWeight: 700,
  color: 'var(--foreground)',
  margin: '0.4rem 0 0.2rem',
  fontFamily: 'var(--font-mono)',
  fontVariantNumeric: 'tabular-nums',
}

const FORM_ROW_INFO_TITLE_STYLE: CSSProperties = {
  display: 'block',
  fontSize: '0.92rem',
  fontWeight: 600,
  color: 'var(--foreground)',
}

/** Toggle 开关（与设计稿 .toggle 1:1） */
function Toggle({
  on,
  onChange,
  ariaLabel,
  domId,
}: {
  on: boolean
  onChange: (next: boolean) => void
  ariaLabel: string
  domId?: string
}) {
  return (
    <button
      type="button"
      data-dom-id={domId}
      data-on={on}
      aria-label={ariaLabel}
      aria-pressed={on}
      onClick={() => onChange(!on)}
      style={{
        width: 44,
        height: 24,
        borderRadius: 999,
        background: on ? 'var(--primary)' : 'var(--muted)',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background 0.2s ease',
        flexShrink: 0,
        border: 'none',
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: on ? 'auto' : 2,
          right: on ? 2 : 'auto',
          width: 20,
          height: 20,
          borderRadius: '50%',
          background: 'var(--card)',
          transition: 'transform 0.2s ease',
          display: 'block',
        }}
      />
    </button>
  )
}

export default function Settings() {
  const navigate = useNavigate()
  const {
    wereadApiKey,
    llmKey,
    llmModel,
    loading,
    saving,
    testingWeread,
    error,
    testResult,
    loadSettings,
    saveSettings,
    testWereadConnection,
    setWereadApiKey,
    setLlmKey,
    setLlmModel,
    clearTestResult,
  } = useSettingsStore()

  const [activeTab, setActiveTab] = useState<SettingsTab>('account')
  const [reminder, setReminder] = useState(true)
  const [stream, setStream] = useState(true)
  const [context, setContext] = useState(true)
  const [autoSync, setAutoSync] = useState(true)
  const [syncShelf, setSyncShelf] = useState(true)
  const [theme, setTheme] = useState<ThemeMode>('light')
  const [fontSize, setFontSize] = useState<FontSize>('medium')

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

  const handleSyncNow = useCallback(async () => {
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
    const testToastId = toast.loading('正在同步微信读书...')
    try {
      await testWereadConnection()
    } catch (err) {
      toast.error('同步失败: ' + (err as Error).message)
    } finally {
      toast.remove(testToastId)
    }
  }, [clearTestResult, wereadApiKey, testWereadConnection])

  const handleReset = useCallback(() => {
    setWereadApiKey('')
    setLlmKey('')
    setLlmModel('')
    clearTestResult()
    toast.info('已重置所有配置，请点击保存生效')
  }, [setWereadApiKey, setLlmKey, setLlmModel, clearTestResult])

  const handleNavClick = useCallback(
    (item: NavItemDef) => {
      setActiveTab(item.key)
      navigate(item.path)
    },
    [navigate],
  )

  if (loading) {
    return (
      <div
        style={{
          padding: 'calc(var(--spacing) * 12)',
          textAlign: 'center',
          color: 'var(--muted-foreground)',
          fontSize: '0.9rem',
        }}
      >
        正在加载设置...
      </div>
    )
  }

  const isWereadConnected = wereadApiKey.length > 0

  return (
    <PageHero
      title="设置"
      subtitle="管理你的账户、AI、数据与外观"
      actions={
        <>
          <Button variant="primary" onClick={handleSave} disabled={saving} data-dom-id="cta-save">
            {saving ? '保存中...' : '保存更改'}
          </Button>
          <Button variant="ghost" onClick={handleReset} data-dom-id="cta-reset">
            重置
          </Button>
        </>
      }
    >
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
          className="settings-nav"
          style={{
            position: 'sticky',
            top: 'calc(var(--spacing) * 4)',
            padding: 'calc(var(--spacing) * 4)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'calc(var(--spacing) * 2)',
            background: 'var(--card)',
            border: '1px solid var(--border)',
            borderRadius: 'calc(var(--radius) + 6px)',
          }}
        >
          <div className="nav-label" style={{ ...EYEBROW_STYLE, padding: '0 calc(var(--spacing) * 3) calc(var(--spacing) * 2)' }}>
            设置分类
          </div>
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.key
            return (
              <button
                key={item.key}
                type="button"
                data-active={isActive}
                onClick={() => handleNavClick(item)}
                style={{
                  width: '100%',
                  padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                  textAlign: 'left',
                  border: 'none',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'calc(var(--spacing) * 3)',
                  color: isActive ? 'var(--primary)' : 'var(--muted-foreground)',
                  fontWeight: isActive ? 600 : 400,
                  background: isActive ? 'var(--sidebar-accent)' : 'transparent',
                  transition: 'background 0.2s ease, color 0.2s ease',
                  fontFamily: 'inherit',
                  fontSize: '0.88rem',
                }}
                onMouseEnter={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'var(--sidebar-accent)'
                    e.currentTarget.style.color = 'var(--foreground)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isActive) {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = 'var(--muted-foreground)'
                  }
                }}
              >
                <span style={{ width: 18, flexShrink: 0, display: 'grid', placeItems: 'center' }}>
                  {item.icon}
                </span>
                <span>{item.label}</span>
              </button>
            )
          })}
        </aside>

        {/* ===== 右：6 张表单卡片堆叠 ===== */}
        <div
          className="settings-forms"
          style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 5)' }}
        >
          {/* ===== Card 1：账户 / 个人信息 ===== */}
          <Card>
            <CardHead eyebrow="账户" title="个人信息" />
            <div
              className="form-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 'calc(var(--spacing) * 4)',
              }}
            >
              <div style={FORM_FIELD_STYLE}>
                <label style={FORM_LABEL_STYLE} htmlFor="setting-nickname">昵称</label>
                <input id="setting-nickname" type="text" defaultValue="读书人" style={FORM_INPUT_STYLE} />
              </div>
              <div style={FORM_FIELD_STYLE}>
                <label style={FORM_LABEL_STYLE} htmlFor="setting-email">邮箱</label>
                <input id="setting-email" type="email" defaultValue="reader@zhixing.com" style={FORM_INPUT_STYLE} />
              </div>
              <div style={FORM_FIELD_STYLE}>
                <label style={FORM_LABEL_STYLE} htmlFor="setting-city">所在城市</label>
                <input id="setting-city" type="text" defaultValue="北京" style={FORM_INPUT_STYLE} />
              </div>
              <div style={FORM_FIELD_STYLE}>
                <label style={FORM_LABEL_STYLE} htmlFor="setting-goal">阅读目标</label>
                <input id="setting-goal" type="text" defaultValue="15 本/年" style={FORM_INPUT_STYLE} />
              </div>
            </div>
            <div style={FORM_ROW_STYLE}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong style={FORM_ROW_INFO_TITLE_STYLE}>每日学习提醒</strong>
                <Tiny>每天 20:00 提醒完成今日任务</Tiny>
              </div>
              <Toggle on={reminder} onChange={setReminder} ariaLabel="每日学习提醒" domId="toggle-reminder" />
            </div>
          </Card>

          {/* ===== Card 2：AI 配置 / 模型与 API ===== */}
          <Card>
            <CardHead eyebrow="AI 配置" title="模型与 API" />
            <div style={{ ...FORM_FIELD_STYLE, marginBottom: 'calc(var(--spacing) * 4)' }}>
              <label style={FORM_LABEL_STYLE} htmlFor="setting-model">默认模型</label>
              <select
                id="setting-model"
                value={llmModel || 'GPT-4o'}
                onChange={(e) => setLlmModel(e.target.value)}
                style={FORM_INPUT_STYLE}
              >
                <option value="GPT-4o">GPT-4o</option>
                <option value="Claude 3.5 Sonnet">Claude 3.5 Sonnet</option>
                <option value="GPT-4o-mini">GPT-4o-mini</option>
              </select>
            </div>
            <div style={FORM_FIELD_STYLE}>
              <label style={FORM_LABEL_STYLE} htmlFor="setting-apikey">API Key</label>
              <input
                id="setting-apikey"
                type="password"
                value={llmKey}
                onChange={(e) => setLlmKey(e.target.value)}
                placeholder="sk-****...****"
                style={{ ...FORM_INPUT_STYLE, fontFamily: 'var(--font-mono)' }}
              />
            </div>
            <div style={FORM_ROW_STYLE}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong style={FORM_ROW_INFO_TITLE_STYLE}>流式输出</strong>
                <Tiny>实时显示 AI 回复</Tiny>
              </div>
              <Toggle on={stream} onChange={setStream} ariaLabel="流式输出" domId="toggle-stream" />
            </div>
            <div style={FORM_ROW_STYLE}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong style={FORM_ROW_INFO_TITLE_STYLE}>引用上下文</strong>
                <Tiny>对话时自动关联相关书籍与笔记</Tiny>
              </div>
              <Toggle on={context} onChange={setContext} ariaLabel="引用上下文" domId="toggle-context" />
            </div>
          </Card>

          {/* ===== Card 3：微信读书 / 同步配置 ===== */}
          <Card>
            <CardHead eyebrow="微信读书" title="同步配置" />
            <div
              className="sync-status"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 'calc(var(--spacing) * 3)',
                padding: 'calc(var(--spacing) * 4)',
                background: 'var(--background)',
                borderRadius: 'var(--radius)',
                border: '1px solid var(--border)',
                marginBottom: 'calc(var(--spacing) * 4)',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  background: isWereadConnected ? 'var(--state-success)' : 'var(--muted-foreground)',
                  flexShrink: 0,
                }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong style={FORM_ROW_INFO_TITLE_STYLE}>
                  {isWereadConnected ? '已连接' : '未连接'}
                </strong>
                <Tiny>{isWereadConnected ? '上次同步 2 小时前' : '请配置微信读书 API Key'}</Tiny>
              </div>
              <Button
                variant="secondary"
                onClick={handleSyncNow}
                disabled={testingWeread || !wereadApiKey}
                data-dom-id="cta-sync-now"
              >
                {testingWeread ? '同步中...' : '立即同步'}
              </Button>
            </div>
            <div style={FORM_ROW_STYLE}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong style={FORM_ROW_INFO_TITLE_STYLE}>自动同步</strong>
                <Tiny>每小时自动同步划线与笔记</Tiny>
              </div>
              <Toggle on={autoSync} onChange={setAutoSync} ariaLabel="自动同步" domId="toggle-autosync" />
            </div>
            <div style={FORM_ROW_STYLE}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <strong style={FORM_ROW_INFO_TITLE_STYLE}>同步书架</strong>
                <Tiny>同步微信读书书架到本地</Tiny>
              </div>
              <Toggle on={syncShelf} onChange={setSyncShelf} ariaLabel="同步书架" domId="toggle-sync-shelf" />
            </div>
          </Card>

          {/* ===== Card 4：数据与存储 / 本地数据库 ===== */}
          <Card>
            <CardHead eyebrow="数据与存储" title="本地数据库" />
            <div
              className="storage-info"
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 'calc(var(--spacing) * 4)',
                marginBottom: 'calc(var(--spacing) * 4)',
              }}
            >
              <div className="storage-item" style={STORAGE_ITEM_STYLE}>
                <div style={EYEBROW_STYLE}>数据库大小</div>
                <strong style={STORAGE_VALUE_STYLE}>24.6 MB</strong>
                <Tiny>SQLite · 1,847 条记录</Tiny>
              </div>
              <div className="storage-item" style={STORAGE_ITEM_STYLE}>
                <div style={EYEBROW_STYLE}>向量索引</div>
                <strong style={STORAGE_VALUE_STYLE}>186 MB</strong>
                <Tiny>Qdrant · 312 个向量</Tiny>
              </div>
            </div>
            <div
              className="form-actions"
              style={{ display: 'flex', gap: 'calc(var(--spacing) * 3)', flexWrap: 'wrap' }}
            >
              <Button variant="secondary" data-dom-id="cta-export-data">导出数据</Button>
              <Button variant="ghost" data-dom-id="cta-clear-cache">清理缓存</Button>
              <Button
                variant="ghost"
                data-dom-id="cta-reset-db"
                style={{ color: 'var(--state-error)', borderColor: 'var(--state-error)' }}
              >
                重置数据库
              </Button>
            </div>
          </Card>

          {/* ===== Card 5：外观 / 主题与字体 ===== */}
          <Card>
            <CardHead eyebrow="外观" title="主题与字体" />
            <div style={{ ...FORM_FIELD_STYLE, marginBottom: 'calc(var(--spacing) * 4)' }}>
              <label style={FORM_LABEL_STYLE}>主题模式</label>
              <div
                className="theme-options"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 'calc(var(--spacing) * 3)',
                }}
              >
                {(
                  [
                    { key: 'light' as const, label: '浅色', domId: 'theme-light' },
                    { key: 'dark' as const, label: '深色', domId: 'theme-dark' },
                    { key: 'system' as const, label: '跟随系统', domId: 'theme-system' },
                  ]
                ).map((opt) => {
                  const isActive = theme === opt.key
                  const previewBg =
                    opt.key === 'light'
                      ? 'var(--background)'
                      : opt.key === 'dark'
                        ? '#1a1a1a'
                        : 'linear-gradient(90deg, var(--background) 0%, var(--background) 50%, #1a1a1a 50%, #1a1a1a 100%)'
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      data-dom-id={opt.domId}
                      onClick={() => setTheme(opt.key)}
                      style={{
                        padding: isActive
                          ? 'calc(var(--spacing) * 4 - 1px)'
                          : 'calc(var(--spacing) * 4)',
                        border: isActive ? '2px solid var(--primary)' : '1px solid var(--border)',
                        borderRadius: 'var(--radius)',
                        cursor: 'pointer',
                        textAlign: 'center',
                        transition: 'border-color 0.2s ease',
                        background: 'var(--card)',
                        fontFamily: 'inherit',
                      }}
                    >
                      <div
                        className="theme-preview"
                        style={{
                          width: '100%',
                          height: 48,
                          borderRadius: 'var(--radius)',
                          marginBottom: 'calc(var(--spacing) * 2)',
                          position: 'relative',
                          overflow: 'hidden',
                          background: previewBg,
                          border: opt.key === 'light' ? '1px solid var(--border)' : 'none',
                        }}
                      >
                        <span
                          style={{
                            position: 'absolute',
                            left: 8,
                            bottom: 8,
                            width: 24,
                            height: 6,
                            borderRadius: 3,
                            background: 'var(--primary)',
                          }}
                        />
                      </div>
                      <div style={{ fontSize: '0.82rem', color: 'var(--card-foreground)' }}>{opt.label}</div>
                    </button>
                  )
                })}
              </div>
            </div>
            <div style={FORM_FIELD_STYLE}>
              <label style={FORM_LABEL_STYLE}>字体大小</label>
              <div
                className="font-size-options"
                style={{ display: 'flex', gap: 'calc(var(--spacing) * 3)', alignItems: 'center' }}
              >
                {(
                  [
                    { key: 'small' as const, label: '小', domId: 'size-small' },
                    { key: 'medium' as const, label: '中', domId: 'size-medium' },
                    { key: 'large' as const, label: '大', domId: 'size-large' },
                  ]
                ).map((opt) => {
                  const isActive = fontSize === opt.key
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      data-dom-id={opt.domId}
                      onClick={() => setFontSize(opt.key)}
                      style={{
                        padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 4)',
                        border: '1px solid',
                        borderColor: isActive ? 'var(--primary)' : 'var(--border)',
                        borderRadius: 'var(--radius)',
                        background: isActive ? 'var(--primary)' : 'var(--card)',
                        color: isActive ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                        cursor: 'pointer',
                        fontSize: '0.82rem',
                        transition: 'background 0.2s ease, color 0.2s ease, border-color 0.2s ease',
                        fontFamily: 'inherit',
                      }}
                    >
                      {opt.label}
                    </button>
                  )
                })}
                <span
                  style={{
                    fontSize: '0.92rem',
                    color: 'var(--muted-foreground)',
                    marginLeft: 'calc(var(--spacing) * 3)',
                  }}
                >
                  预览：知行读书让你爱上阅读
                </span>
              </div>
            </div>
          </Card>

          {/* ===== Card 6：关于 ===== */}
          <Card>
            <div style={{ textAlign: 'center' }}>
              <div
                className="about-logo"
                style={{
                  width: 64,
                  height: 64,
                  borderRadius: 'calc(var(--radius) + 8px)',
                  background: 'var(--primary)',
                  color: 'var(--primary-foreground)',
                  display: 'grid',
                  placeItems: 'center',
                  fontSize: '1.5rem',
                  fontWeight: 700,
                  margin: '0 auto calc(var(--spacing) * 4)',
                }}
              >
                知
              </div>
              <h3
                style={{
                  fontSize: '1.25rem',
                  fontWeight: 700,
                  margin: 0,
                  color: 'var(--foreground)',
                }}
              >
                知行读书
              </h3>
              <div
                className="about-version"
                style={{
                  fontSize: '0.88rem',
                  color: 'var(--muted-foreground)',
                  fontFamily: 'var(--font-mono)',
                  marginTop: '0.4rem',
                }}
              >
                v2.4.1 · 2026-07-20
              </div>
              <p
                className="about-desc"
                style={{
                  fontSize: '0.92rem',
                  lineHeight: 1.7,
                  color: 'var(--muted-foreground)',
                  maxWidth: 400,
                  margin: 'calc(var(--spacing) * 4) auto',
                }}
              >
                知行读书是一款基于 Electron 的桌面阅读成长应用，整合微信读书同步、FSRS 间隔复习、AI 对话与知识管理。
              </p>
              <div
                className="about-links"
                style={{
                  display: 'flex',
                  gap: 'calc(var(--spacing) * 4)',
                  justifyContent: 'center',
                  marginTop: 'calc(var(--spacing) * 4)',
                }}
              >
                {(
                  [
                    { label: '用户协议', domId: 'link-terms' },
                    { label: '隐私政策', domId: 'link-privacy' },
                    { label: '反馈建议', domId: 'link-feedback' },
                  ]
                ).map((link) => (
                  <button
                    key={link.domId}
                    type="button"
                    data-dom-id={link.domId}
                    style={{
                      fontSize: '0.82rem',
                      color: 'var(--primary)',
                      cursor: 'pointer',
                      background: 'none',
                      border: 'none',
                      padding: 0,
                      transition: 'opacity 0.2s ease',
                      fontFamily: 'inherit',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.opacity = '0.8'
                      e.currentTarget.style.textDecoration = 'underline'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.opacity = '1'
                      e.currentTarget.style.textDecoration = 'none'
                    }}
                  >
                    {link.label}
                  </button>
                ))}
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* ===== 响应式样式（与设计稿 @media 一致） ===== */}
      <style>{`
        @media (max-width: 1100px) {
          .settings-body { grid-template-columns: 1fr !important; }
          .settings-nav { position: static !important; }
          .form-grid { grid-template-columns: 1fr !important; }
          .storage-info { grid-template-columns: 1fr !important; }
          .theme-options { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 760px) {
          .form-row {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: calc(var(--spacing) * 3) !important;
          }
          .font-size-options { flex-wrap: wrap !important; }
        }
      `}</style>
    </PageHero>
  )
}
