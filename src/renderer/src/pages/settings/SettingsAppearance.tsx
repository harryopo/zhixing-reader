/**
 * SettingsAppearance — 外观设置（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/settings-appearance.html
 * 4 张卡片：主题模式 / 字体设置 / 显示密度 / 语言与地区
 * 业务逻辑：
 *   - 主题切换：同步 localStorage('zhixing-theme') + documentElement.dark + settings IPC
 *   - 字体设置：fontUi / fontBodySize / fontHeadingSize / fontCode 通过 settings IPC 持久化
 *   - 显示密度：density / spacing / radius 通过 settings IPC 持久化（仅作偏好存储，不影响全局 token）
 *   - 语言与地区：langUi / dateFormat / firstDay 通过 settings IPC 持久化
 */

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Card, { CardHead } from '@/components/ui/Card'
import Icon from '@/components/ui/Icon'
import { Loading } from '@/components/ui/Feedback'
import { safeStr } from '@/utils/db-mapper'

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

/** 字体选项 */
const FONT_UI_OPTIONS = ['DM Sans', '系统默认', '思源黑体'] as const
const FONT_BODY_SIZE_OPTIONS = ['12px', '13px', '14px', '16px'] as const
const FONT_HEADING_SIZE_OPTIONS = ['16px', '18px', '20px', '24px'] as const
const FONT_CODE_OPTIONS = ['JetBrains Mono', 'Fira Code', 'Consolas'] as const

/** 显示密度 */
type Density = 'compact' | 'standard' | 'comfortable'

interface DensityOption {
  value: Density
  label: string
  domId: string
}

const DENSITY_OPTIONS: DensityOption[] = [
  { value: 'compact', label: '紧凑', domId: 'density-compact' },
  { value: 'standard', label: '标准', domId: 'density-standard' },
  { value: 'comfortable', label: '宽松', domId: 'density-comfortable' },
]

/** 语言与地区选项 */
const LANG_UI_OPTIONS = ['简体中文', 'English', '繁體中文'] as const
const DATE_FORMAT_OPTIONS = ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY'] as const
const FIRST_DAY_OPTIONS = ['周一', '周日'] as const

/** 间距 / 圆角滑块范围 */
const SPACING_MIN = 0.2
const SPACING_MAX = 0.3
const SPACING_STEP = 0.02
const SPACING_DEFAULT = 0.24

const RADIUS_MIN = 4
const RADIUS_MAX = 12
const RADIUS_STEP = 1
const RADIUS_DEFAULT = 8

/** 格式化间距数值（rem） */
function formatSpacing(val: number): string {
  return `${val.toFixed(2)}rem`
}

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

/** 间距滑块原生 input 样式（兼容 webkit / moz） */
const SPACING_SLIDER_STYLE: React.CSSProperties = {
  width: '100%',
  height: 6,
  borderRadius: 999,
  background: 'var(--muted)',
  outline: 'none',
  appearance: 'none',
  WebkitAppearance: 'none',
  cursor: 'pointer',
}

/** 滑块拇指样式（通过 <style> 注入伪元素，避免行内样式限制） */
const SLIDER_THUMB_CSS = `
  .sa-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--primary);
    cursor: pointer;
    border: 2px solid var(--card);
    box-shadow: 0 1px 3px rgba(0,0,0,.2);
  }
  .sa-slider::-moz-range-thumb {
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--primary);
    cursor: pointer;
    border: 2px solid var(--card);
  }
  .sa-slider:focus-visible {
    outline: 2px solid var(--ring);
    outline-offset: 4px;
  }
`

export default function SettingsAppearance() {
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 主题模式
  const [themeMode, setThemeMode] = useState<ThemeMode>('light')

  // 字体设置
  const [fontUi, setFontUi] = useState<string>(FONT_UI_OPTIONS[0])
  const [fontBodySize, setFontBodySize] = useState<string>(FONT_BODY_SIZE_OPTIONS[2])
  const [fontHeadingSize, setFontHeadingSize] = useState<string>(FONT_HEADING_SIZE_OPTIONS[1])
  const [fontCode, setFontCode] = useState<string>(FONT_CODE_OPTIONS[0])

  // 显示密度
  const [density, setDensity] = useState<Density>('standard')
  const [spacing, setSpacing] = useState<number>(SPACING_DEFAULT)
  const [radius, setRadius] = useState<number>(RADIUS_DEFAULT)

  // 语言与地区
  const [langUi, setLangUi] = useState<string>(LANG_UI_OPTIONS[0])
  const [dateFormat, setDateFormat] = useState<string>(DATE_FORMAT_OPTIONS[0])
  const [firstDay, setFirstDay] = useState<string>(FIRST_DAY_OPTIONS[0])

  // ===== 加载外观偏好 =====
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
        const [
          fUi, fBody, fHead, fCode,
          dens, sp, rad,
          lUi, dFmt, fDay,
        ] = await Promise.all([
          api.settings.get('fontUi'),
          api.settings.get('fontBodySize'),
          api.settings.get('fontHeadingSize'),
          api.settings.get('fontCode'),
          api.settings.get('density'),
          api.settings.get('spacing'),
          api.settings.get('radius'),
          api.settings.get('langUi'),
          api.settings.get('dateFormat'),
          api.settings.get('firstDay'),
        ])
        if (safeStr(fUi)) setFontUi(safeStr(fUi))
        if (safeStr(fBody)) setFontBodySize(safeStr(fBody))
        if (safeStr(fHead)) setFontHeadingSize(safeStr(fHead))
        if (safeStr(fCode)) setFontCode(safeStr(fCode))
        if (safeStr(dens) && DENSITY_OPTIONS.some((o) => o.value === dens)) {
          setDensity(dens as Density)
        }
        if (typeof sp === 'number' && sp >= SPACING_MIN && sp <= SPACING_MAX) {
          setSpacing(sp)
        }
        if (typeof rad === 'number' && rad >= RADIUS_MIN && rad <= RADIUS_MAX) {
          setRadius(rad)
        }
        if (safeStr(lUi)) setLangUi(safeStr(lUi))
        if (safeStr(dFmt)) setDateFormat(safeStr(dFmt))
        if (safeStr(fDay)) setFirstDay(safeStr(fDay))
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

  const handleFontUiChange = async (value: string) => {
    setFontUi(value)
    try {
      await window.electronAPI?.settings?.set('fontUi', value)
    } catch {
      /* 非致命 */
    }
  }

  const handleFontBodySizeChange = async (value: string) => {
    setFontBodySize(value)
    try {
      await window.electronAPI?.settings?.set('fontBodySize', value)
    } catch {
      /* 非致命 */
    }
  }

  const handleFontHeadingSizeChange = async (value: string) => {
    setFontHeadingSize(value)
    try {
      await window.electronAPI?.settings?.set('fontHeadingSize', value)
    } catch {
      /* 非致命 */
    }
  }

  const handleFontCodeChange = async (value: string) => {
    setFontCode(value)
    try {
      await window.electronAPI?.settings?.set('fontCode', value)
    } catch {
      /* 非致命 */
    }
  }

  const handleDensityChange = async (value: Density) => {
    setDensity(value)
    try {
      await window.electronAPI?.settings?.set('density', value)
    } catch {
      /* 非致命 */
    }
  }

  const handleSpacingChange = async (value: number) => {
    setSpacing(value)
    try {
      await window.electronAPI?.settings?.set('spacing', value)
    } catch {
      /* 非致命 */
    }
  }

  const handleRadiusChange = async (value: number) => {
    setRadius(value)
    try {
      await window.electronAPI?.settings?.set('radius', value)
    } catch {
      /* 非致命 */
    }
  }

  const handleLangUiChange = async (value: string) => {
    setLangUi(value)
    try {
      await window.electronAPI?.settings?.set('langUi', value)
    } catch {
      /* 非致命 */
    }
  }

  const handleDateFormatChange = async (value: string) => {
    setDateFormat(value)
    try {
      await window.electronAPI?.settings?.set('dateFormat', value)
    } catch {
      /* 非致命 */
    }
  }

  const handleFirstDayChange = async (value: string) => {
    setFirstDay(value)
    try {
      await window.electronAPI?.settings?.set('firstDay', value)
    } catch {
      /* 非致命 */
    }
  }

  const handleNavigate = (path: string) => {
    navigate(path)
  }

  if (loading) {
    return <Loading hint="正在加载外观设置..." />
  }

  // 间距/圆角预览样式（基于当前数值实时反馈）
  const densityPreviewStyle: React.CSSProperties = {
    padding: `calc(var(--spacing) * 4)`,
    background: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: `${radius}px`,
    display: 'flex',
    flexDirection: 'column',
    gap: 'calc(var(--spacing) * 2)',
  }

  return (
    <>
      <PageHero
        title="外观"
        subtitle="个性化应用主题与显示偏好"
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

            {/* ===== Card 2: 字体设置 ===== */}
            <Card>
              <CardHead eyebrow="字体" title="字体设置" />

              <div
                className="form-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 'calc(var(--spacing) * 4)',
                }}
              >
                {/* 界面字体 */}
                <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
                  <label className="form-label" htmlFor="font-ui" style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--card-foreground)' }}>
                    界面字体
                  </label>
                  <select
                    id="font-ui"
                    className="form-select"
                    data-dom-id="select-font-ui"
                    value={fontUi}
                    onChange={(e) => handleFontUiChange(e.target.value)}
                    style={{
                      padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                      border: '1px solid var(--input)',
                      borderRadius: 'var(--radius)',
                      background: 'var(--popover)',
                      color: 'var(--foreground)',
                      fontSize: '0.92rem',
                      fontFamily: 'var(--font-sans)',
                      outline: 'none',
                      transition: 'border-color 0.2s ease',
                      width: '100%',
                      cursor: 'pointer',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input)' }}
                  >
                    {FONT_UI_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                {/* 正文字号 */}
                <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
                  <label className="form-label" htmlFor="font-body-size" style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--card-foreground)' }}>
                    正文字号
                  </label>
                  <select
                    id="font-body-size"
                    className="form-select"
                    data-dom-id="select-font-body-size"
                    value={fontBodySize}
                    onChange={(e) => handleFontBodySizeChange(e.target.value)}
                    style={{
                      padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                      border: '1px solid var(--input)',
                      borderRadius: 'var(--radius)',
                      background: 'var(--popover)',
                      color: 'var(--foreground)',
                      fontSize: '0.92rem',
                      fontFamily: 'var(--font-sans)',
                      outline: 'none',
                      transition: 'border-color 0.2s ease',
                      width: '100%',
                      cursor: 'pointer',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input)' }}
                  >
                    {FONT_BODY_SIZE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                {/* 标题字号 */}
                <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
                  <label className="form-label" htmlFor="font-heading-size" style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--card-foreground)' }}>
                    标题字号
                  </label>
                  <select
                    id="font-heading-size"
                    className="form-select"
                    data-dom-id="select-font-heading-size"
                    value={fontHeadingSize}
                    onChange={(e) => handleFontHeadingSizeChange(e.target.value)}
                    style={{
                      padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                      border: '1px solid var(--input)',
                      borderRadius: 'var(--radius)',
                      background: 'var(--popover)',
                      color: 'var(--foreground)',
                      fontSize: '0.92rem',
                      fontFamily: 'var(--font-sans)',
                      outline: 'none',
                      transition: 'border-color 0.2s ease',
                      width: '100%',
                      cursor: 'pointer',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input)' }}
                  >
                    {FONT_HEADING_SIZE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                {/* 代码字体 */}
                <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
                  <label className="form-label" htmlFor="font-code" style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--card-foreground)' }}>
                    代码字体
                  </label>
                  <select
                    id="font-code"
                    className="form-select"
                    data-dom-id="select-font-code"
                    value={fontCode}
                    onChange={(e) => handleFontCodeChange(e.target.value)}
                    style={{
                      padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                      border: '1px solid var(--input)',
                      borderRadius: 'var(--radius)',
                      background: 'var(--popover)',
                      color: 'var(--foreground)',
                      fontSize: '0.92rem',
                      fontFamily: 'var(--font-sans)',
                      outline: 'none',
                      transition: 'border-color 0.2s ease',
                      width: '100%',
                      cursor: 'pointer',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input)' }}
                  >
                    {FONT_CODE_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 字体预览 */}
              <div
                className="font-preview"
                style={{
                  padding: 'calc(var(--spacing) * 5)',
                  background: 'var(--background)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  marginTop: 'calc(var(--spacing) * 4)',
                }}
              >
                <div
                  className="font-preview-title"
                  style={{
                    fontSize: '1.1rem',
                    fontWeight: 600,
                    color: 'var(--foreground)',
                    marginBottom: 'calc(var(--spacing) * 2)',
                  }}
                >
                  阅读是心灵的旅行
                </div>
                <p
                  className="font-preview-body"
                  style={{
                    fontSize: '0.92rem',
                    color: 'var(--card-foreground)',
                    lineHeight: 1.6,
                    margin: 0,
                  }}
                >
                  每一页都是新的风景。在知行读书中，让知识沉淀为成长的足迹，让阅读成为一种习惯。
                </p>
                <code
                  className="font-preview-code"
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: '0.85rem',
                    color: 'var(--primary)',
                    background: 'var(--muted)',
                    padding: 'calc(var(--spacing) * 2) calc(var(--spacing) * 3)',
                    borderRadius: 'var(--radius)',
                    marginTop: 'calc(var(--spacing) * 3)',
                    display: 'block',
                    whiteSpace: 'pre',
                  }}
                >
                  const reader = new ZhixingReader();
                </code>
              </div>
            </Card>

            {/* ===== Card 3: 显示密度 ===== */}
            <Card>
              <CardHead eyebrow="密度" title="显示密度" />

              {/* 布局密度 */}
              <div
                className="form-row"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 'calc(var(--spacing) * 3) 0',
                  borderTop: '1px solid var(--border)',
                  gap: 'calc(var(--spacing) * 4)',
                }}
              >
                <div className="form-row-info" style={{ minWidth: 0, flex: 1 }}>
                  <strong style={{ display: 'block', fontSize: '0.92rem', fontWeight: 600, color: 'var(--foreground)' }}>
                    布局密度
                  </strong>
                  <div
                    className="tiny"
                    style={{ marginTop: '0.2rem', color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.4 }}
                  >
                    控制界面元素的疏密程度
                  </div>
                </div>
                <div
                  className="segmented"
                  role="group"
                  aria-label="显示密度"
                  style={{
                    display: 'inline-flex',
                    background: 'var(--muted)',
                    borderRadius: 'var(--radius)',
                    padding: 3,
                    gap: 2,
                  }}
                >
                  {DENSITY_OPTIONS.map((opt) => {
                    const active = density === opt.value
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        className="segmented-btn"
                        data-dom-id={opt.domId}
                        data-active={active ? 'true' : undefined}
                        onClick={() => handleDensityChange(opt.value)}
                        style={{
                          padding: 'calc(var(--spacing) * 2.5) calc(var(--spacing) * 5)',
                          border: 'none',
                          background: active ? 'var(--primary)' : 'transparent',
                          color: active ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                          borderRadius: 'calc(var(--radius) - 2px)',
                          cursor: 'pointer',
                          fontSize: '0.85rem',
                          fontWeight: 500,
                          transition: 'background 0.2s ease, color 0.2s ease',
                          fontFamily: 'inherit',
                        }}
                        onMouseEnter={(e) => {
                          if (!active) e.currentTarget.style.color = 'var(--foreground)'
                        }}
                        onMouseLeave={(e) => {
                          if (!active) e.currentTarget.style.color = 'var(--muted-foreground)'
                        }}
                        onFocus={(e) => {
                          e.currentTarget.style.outline = '2px solid var(--ring)'
                          e.currentTarget.style.outlineOffset = '2px'
                        }}
                        onBlur={(e) => {
                          e.currentTarget.style.outline = 'none'
                        }}
                      >
                        {opt.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* 间距基数 */}
              <div
                className="form-row"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 'calc(var(--spacing) * 3) 0',
                  borderTop: '1px solid var(--border)',
                  gap: 'calc(var(--spacing) * 4)',
                }}
              >
                <div className="form-row-info" style={{ flex: 1 }}>
                  <strong style={{ display: 'block', fontSize: '0.92rem', fontWeight: 600, color: 'var(--foreground)' }}>
                    间距基数
                  </strong>
                  <div
                    className="tiny"
                    style={{ marginTop: '0.2rem', color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.4 }}
                  >
                    基础间距变量，影响全局元素间距
                  </div>
                </div>
                <div className="slider-row" style={{ flex: 1, maxWidth: 280, display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
                  <div className="slider-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="slider-label" style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--foreground)' }}>
                      间距
                    </span>
                    <span
                      className="slider-value"
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.82rem',
                        color: 'var(--muted-foreground)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatSpacing(spacing)}
                    </span>
                  </div>
                  <input
                    className="slider sa-slider"
                    type="range"
                    min={SPACING_MIN}
                    max={SPACING_MAX}
                    step={SPACING_STEP}
                    value={spacing}
                    data-dom-id="slider-spacing"
                    aria-label="间距基数"
                    onChange={(e) => handleSpacingChange(parseFloat(e.target.value))}
                    style={SPACING_SLIDER_STYLE}
                  />
                </div>
              </div>

              {/* 圆角基数 */}
              <div
                className="form-row"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 'calc(var(--spacing) * 3) 0',
                  borderTop: '1px solid var(--border)',
                  gap: 'calc(var(--spacing) * 4)',
                }}
              >
                <div className="form-row-info" style={{ flex: 1 }}>
                  <strong style={{ display: 'block', fontSize: '0.92rem', fontWeight: 600, color: 'var(--foreground)' }}>
                    圆角基数
                  </strong>
                  <div
                    className="tiny"
                    style={{ marginTop: '0.2rem', color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.4 }}
                  >
                    基础圆角变量，影响卡片和控件外观
                  </div>
                </div>
                <div className="slider-row" style={{ flex: 1, maxWidth: 280, display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
                  <div className="slider-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="slider-label" style={{ fontSize: '0.85rem', fontWeight: 500, color: 'var(--foreground)' }}>
                      圆角
                    </span>
                    <span
                      className="slider-value"
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.82rem',
                        color: 'var(--muted-foreground)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {radius}px
                    </span>
                  </div>
                  <input
                    className="slider sa-slider"
                    type="range"
                    min={RADIUS_MIN}
                    max={RADIUS_MAX}
                    step={RADIUS_STEP}
                    value={radius}
                    data-dom-id="slider-radius"
                    aria-label="圆角基数"
                    onChange={(e) => handleRadiusChange(parseInt(e.target.value, 10))}
                    style={SPACING_SLIDER_STYLE}
                  />
                </div>
              </div>

              {/* 密度预览 */}
              <div
                className="density-preview"
                style={{
                  padding: 'calc(var(--spacing) * 4)',
                  background: 'var(--background)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  marginTop: 'calc(var(--spacing) * 4)',
                }}
              >
                <div className="density-preview-card" style={densityPreviewStyle}>
                  <div
                    className="density-preview-title"
                    style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--foreground)' }}
                  >
                    预览卡片
                  </div>
                  <div
                    className="density-preview-text"
                    style={{ fontSize: '0.8rem', color: 'var(--muted-foreground)', lineHeight: 1.5 }}
                  >
                    当前的间距与圆角设置将应用于此卡片。标准密度适合大多数场景，提供舒适的视觉节奏。
                  </div>
                </div>
              </div>
            </Card>

            {/* ===== Card 4: 语言与地区 ===== */}
            <Card>
              <CardHead eyebrow="语言" title="语言与地区" />

              <div
                className="form-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 'calc(var(--spacing) * 4)',
                }}
              >
                {/* 界面语言 */}
                <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
                  <label className="form-label" htmlFor="lang-ui" style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--card-foreground)' }}>
                    界面语言
                  </label>
                  <select
                    id="lang-ui"
                    className="form-select"
                    data-dom-id="select-lang-ui"
                    value={langUi}
                    onChange={(e) => handleLangUiChange(e.target.value)}
                    style={{
                      padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                      border: '1px solid var(--input)',
                      borderRadius: 'var(--radius)',
                      background: 'var(--popover)',
                      color: 'var(--foreground)',
                      fontSize: '0.92rem',
                      fontFamily: 'var(--font-sans)',
                      outline: 'none',
                      transition: 'border-color 0.2s ease',
                      width: '100%',
                      cursor: 'pointer',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input)' }}
                  >
                    {LANG_UI_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                {/* 日期格式 */}
                <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
                  <label className="form-label" htmlFor="lang-date-format" style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--card-foreground)' }}>
                    日期格式
                  </label>
                  <select
                    id="lang-date-format"
                    className="form-select"
                    data-dom-id="select-date-format"
                    value={dateFormat}
                    onChange={(e) => handleDateFormatChange(e.target.value)}
                    style={{
                      padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                      border: '1px solid var(--input)',
                      borderRadius: 'var(--radius)',
                      background: 'var(--popover)',
                      color: 'var(--foreground)',
                      fontSize: '0.92rem',
                      fontFamily: 'var(--font-sans)',
                      outline: 'none',
                      transition: 'border-color 0.2s ease',
                      width: '100%',
                      cursor: 'pointer',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input)' }}
                  >
                    {DATE_FORMAT_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>

                {/* 首日（占满整行） */}
                <div
                  className="form-field form-field-full"
                  style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}
                >
                  <label className="form-label" htmlFor="lang-first-day" style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--card-foreground)' }}>
                    首日
                  </label>
                  <select
                    id="lang-first-day"
                    className="form-select"
                    data-dom-id="select-first-day"
                    value={firstDay}
                    onChange={(e) => handleFirstDayChange(e.target.value)}
                    style={{
                      padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                      border: '1px solid var(--input)',
                      borderRadius: 'var(--radius)',
                      background: 'var(--popover)',
                      color: 'var(--foreground)',
                      fontSize: '0.92rem',
                      fontFamily: 'var(--font-sans)',
                      outline: 'none',
                      transition: 'border-color 0.2s ease',
                      width: '100%',
                      cursor: 'pointer',
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input)' }}
                  >
                    {FIRST_DAY_OPTIONS.map((opt) => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
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

      {/* ===== 设计稿专属样式：滑块拇指 + 响应式 ===== */}
      <style>{SLIDER_THUMB_CSS}</style>
      <style>{`
        @media (max-width: 1100px) {
          .settings-body {
            grid-template-columns: 1fr !important;
          }
          .settings-nav {
            position: static !important;
          }
          .form-grid {
            grid-template-columns: 1fr !important;
          }
          .theme-options {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 760px) {
          .form-row {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: calc(var(--spacing) * 3) !important;
          }
          .segmented {
            width: 100% !important;
          }
          .segmented-btn {
            flex: 1;
          }
        }
      `}</style>
    </>
  )
}
