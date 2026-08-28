/**
 * SettingsAppearance — 外观设置（T10 精简版）
 * 仅保留 1 张卡片：主题模式（深浅色切换）
 * 已删除（与外观重复 / 无效果 / 无关功能）：
 *   - 字体设置（修改无效果，用户原话 #8）
 *   - 显示密度（无关功能，用户原话 #9）
 *   - 语言与地区 / 首日设置（无关功能，用户原话 #9）
 * 业务逻辑：
 *   - 主题切换：同步 localStorage('zhixing-theme') + documentElement.dark + settings IPC
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Card, { CardHead } from '@/components/ui/Card'
import Icon from '@/components/ui/Icon'
import { Loading } from '@/components/ui/Feedback'

/** 设置分类导航项 */
interface SettingsNavItem {
  key: string
  label: string
  icon: 'profile' | 'settings' | 'bookshelf' | 'box' | 'sun' | 'question'
  path: string
  domId?: string
  active?: boolean
}

const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { key: 'account', label: '账户', icon: 'profile', path: '/settings/account', domId: 'settings-tab-account' },
  { key: 'ai', label: 'AI 配置', icon: 'settings', path: '/settings/ai', domId: 'settings-tab-ai' },
  { key: 'agent', label: '智能体编排', icon: 'settings', path: '/settings/agent', domId: 'settings-tab-agent' },
  { key: 'weread', label: '微信读书', icon: 'bookshelf', path: '/settings/weread', domId: 'settings-tab-weread' },
  { key: 'data', label: '数据与存储', icon: 'box', path: '/settings/data', domId: 'settings-tab-data' },
  { key: 'appearance', label: '外观', icon: 'sun', path: '/settings/appearance', active: true },
  { key: 'about', label: '关于', icon: 'question', path: '/settings/about', domId: 'settings-tab-about' },
]

/** 主题模式 */
type ThemeMode = 'light' | 'dark' | 'system'

interface ThemeOption {
  value: ThemeMode
  label: string
  desc: string
  domId: string
}

const THEME_OPTIONS: ThemeOption[] = [
  { value: 'light', label: '浅色', desc: '明亮的界面主题', domId: 'theme-light' },
  { value: 'dark', label: '深色', desc: '护眼的暗色主题', domId: 'theme-dark' },
  { value: 'system', label: '跟随系统', desc: '自动匹配系统设置', domId: 'theme-system' },
]

/** 应用主题到 documentElement 与 localStorage */
function applyTheme(mode: ThemeMode): void {
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  const isDark = mode === 'dark' || (mode === 'system' && prefersDark)
  document.documentElement.classList.toggle('dark', isDark)
  localStorage.setItem('zhixing-theme', mode)
}

/** 从 localStorage 读取初始主题（无值时默认 light） */
function readInitialTheme(): ThemeMode {
  const stored = localStorage.getItem('zhixing-theme')
  if (stored === 'dark' || stored === 'light' || stored === 'system') return stored
  return 'light'
}

export default function SettingsAppearance() {
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 主题模式
  const [themeMode, setThemeMode] = useState<ThemeMode>('light')

  // ===== 加载主题偏好 =====
  useEffect(() => {
    // 主题模式优先读 localStorage（与 Topbar 行为一致）
    setThemeMode(readInitialTheme())

    const api = window.electronAPI
    if (!api?.settings) {
      setLoading(false)
      return
    }
    const load = async () => {
      try {
        const stored = await api.settings.get('theme')
        if (stored === 'dark' || stored === 'light' || stored === 'system') {
          setThemeMode(stored)
          applyTheme(stored)
        }
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  // ===== 事件处理 =====
  const handleThemeChange = async (mode: ThemeMode) => {
    setThemeMode(mode)
    applyTheme(mode)
    try {
      await window.electronAPI?.settings?.set('theme', mode)
    } catch {
      /* 非致命：localStorage 已写入 */
    }
  }

  const handleNavigate = (path: string) => {
    navigate(path)
  }

  if (loading) {
    return <Loading hint="正在加载外观设置..." />
  }

  return (
    <>
      <PageHero
        title="外观"
        subtitle="个性化应用主题"
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
          {/* ===== 左：设置分类导航 ===== */}
          <aside
            className="settings-nav card"
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
              color: 'var(--card-foreground)',
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
            {SETTINGS_NAV_ITEMS.map((item) => (
              <button
                key={item.key}
                type="button"
                className="settings-nav-item"
                data-dom-id={item.domId}
                data-active={item.active ? 'true' : undefined}
                aria-current={item.active ? 'page' : undefined}
                onClick={() => handleNavigate(item.path)}
                style={{
                  width: '100%',
                  padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                  textAlign: 'left',
                  border: 'none',
                  background: item.active ? 'var(--sidebar-accent)' : 'transparent',
                  borderRadius: 'var(--radius)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'calc(var(--spacing) * 3)',
                  color: item.active ? 'var(--primary)' : 'var(--muted-foreground)',
                  fontWeight: item.active ? 600 : 400,
                  transition: 'background 0.2s ease, color 0.2s ease',
                  fontFamily: 'inherit',
                  fontSize: 'inherit',
                }}
                onMouseEnter={(e) => {
                  if (!item.active) {
                    e.currentTarget.style.background = 'var(--sidebar-accent)'
                    e.currentTarget.style.color = 'var(--foreground)'
                  }
                }}
                onMouseLeave={(e) => {
                  if (!item.active) {
                    e.currentTarget.style.background = 'transparent'
                    e.currentTarget.style.color = 'var(--muted-foreground)'
                  }
                }}
              >
                <span
                  className="nav-glyph"
                  aria-hidden="true"
                  style={{ width: 18, flexShrink: 0, display: 'grid', placeItems: 'center' }}
                >
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
            {/* ===== Card 1: 主题模式 ===== */}
            <Card>
              <CardHead eyebrow="主题" title="主题模式" />

              <div
                className="theme-options"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 'calc(var(--spacing) * 4)',
                }}
              >
                {THEME_OPTIONS.map((opt) => {
                  const selected = themeMode === opt.value
                  const isSystem = opt.value === 'system'
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className="theme-option"
                      data-dom-id={opt.domId}
                      data-selected={selected ? 'true' : undefined}
                      onClick={() => handleThemeChange(opt.value)}
                      style={{
                        border: `2px solid ${selected ? 'var(--ring)' : 'var(--border)'}`,
                        borderRadius: 'calc(var(--radius) + 4px)',
                        padding: 'calc(var(--spacing) * 4)',
                        cursor: 'pointer',
                        transition: 'border-color 0.2s ease, transform 0.16s ease',
                        background: 'var(--card)',
                        textAlign: 'left',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 'calc(var(--spacing) * 3)',
                        fontFamily: 'inherit',
                      }}
                      onMouseEnter={(e) => {
                        if (!selected) e.currentTarget.style.borderColor = 'var(--input)'
                      }}
                      onMouseLeave={(e) => {
                        if (!selected) e.currentTarget.style.borderColor = 'var(--border)'
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.outline = '2px solid var(--ring)'
                        e.currentTarget.style.outlineOffset = '2px'
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.outline = 'none'
                      }}
                    >
                      {isSystem ? (
                        <div
                          className="theme-swatch theme-swatch-split"
                          style={{
                            width: 80,
                            height: 60,
                            borderRadius: 'var(--radius)',
                            border: '1px solid var(--border)',
                            display: 'flex',
                            padding: 0,
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              flex: 1,
                              display: 'grid',
                              placeItems: 'center',
                              background: 'var(--background)',
                              color: 'var(--foreground)',
                              fontSize: '0.8rem',
                              fontWeight: 600,
                            }}
                          >
                            Aa
                          </div>
                          <div
                            style={{
                              flex: 1,
                              display: 'grid',
                              placeItems: 'center',
                              background: 'var(--theme-swatch-dark-bg)',
                              color: 'var(--theme-swatch-dark-fg)',
                              fontSize: '0.8rem',
                              fontWeight: 600,
                            }}
                          >
                            Aa
                          </div>
                        </div>
                      ) : (
                        <div
                          className="theme-swatch"
                          style={{
                            width: 80,
                            height: 60,
                            borderRadius: 'var(--radius)',
                            border: '1px solid var(--border)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.8rem',
                            fontWeight: 600,
                            background: opt.value === 'dark' ? 'var(--theme-swatch-dark-bg)' : 'var(--background)',
                            color: opt.value === 'dark' ? 'var(--theme-swatch-dark-fg)' : 'var(--foreground)',
                          }}
                        >
                          Aa
                        </div>
                      )}
                      <div>
                        <div
                          className="theme-label"
                          style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--foreground)' }}
                        >
                          {opt.label}
                        </div>
                        <div
                          className="theme-desc"
                          style={{
                            fontSize: '0.78rem',
                            color: 'var(--muted-foreground)',
                            lineHeight: 1.4,
                            marginTop: '0.15rem',
                          }}
                        >
                          {opt.desc}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            </Card>

            {error && (
              <div
                style={{
                  padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                  border: '1px solid var(--destructive)',
                  borderRadius: 'var(--radius)',
                  background: 'var(--background)',
                  color: 'var(--destructive)',
                  fontSize: '0.85rem',
                }}
              >
                {error}
              </div>
            )}
          </div>
        </div>
      </PageHero>

      {/* ===== 设计稿专属样式：响应式 ===== */}
      <style>{`
        @media (max-width: 1100px) {
          .settings-body {
            grid-template-columns: 1fr !important;
          }
          .settings-nav {
            position: static !important;
          }
          .theme-options {
            grid-template-columns: 1fr !important;
          }
        }
      `}</style>
    </>
  )
}
