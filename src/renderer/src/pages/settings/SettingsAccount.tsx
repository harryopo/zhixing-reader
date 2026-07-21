/**
 * SettingsAccount — 账户设置（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/settings-account.html
 * 2 张卡片：个人信息 / 功能模块
 * 业务逻辑：通过 window.electronAPI.settings 读写账户信息与功能开关
 *
 * T10 重构说明：
 *   - Card「会员状态」已删除（续费/升级按钮无真实 IPC，属占位死代码，违反用户原话 #10）
 *   - Card「登录管理」已删除（设备表格 logoutDomId 无真实 IPC，属占位死代码，违反用户原话 #10）
 *   - Card「数据同步」已删除（云同步/自动备份/备份频率/立即备份均无对应 IPC 实现，属占位死代码，违反用户原话 #10）
 *   - Card「个人信息」新增「继承微信读书信息」开关：开启后禁用本地输入并提示已继承（用户原话 #5）
 *     后端 weread-api 暂无 user profile API，开关仅作 UI 状态持久化（settings.inheritWereadProfile），
 *     文案已诚实化（标注「当前版本暂未实现」）
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Card, { CardHead } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { Loading } from '@/components/ui/Feedback'
import { safeStr } from '@/utils/db-mapper'
import { useShallow } from 'zustand/react/shallow'
import { useSettingsStore } from '@/stores/settingsStore'

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
  { key: 'account', label: '账户', icon: 'profile', path: '/settings/account', active: true },
  { key: 'ai', label: 'AI 配置', icon: 'settings', path: '/settings/ai', domId: 'settings-tab-ai' },
  { key: 'agent', label: '智能体编排', icon: 'settings', path: '/agent-orchestration', domId: 'settings-tab-agent' },
  { key: 'weread', label: '微信读书', icon: 'bookshelf', path: '/settings/weread', domId: 'settings-tab-weread' },
  { key: 'data', label: '数据与存储', icon: 'box', path: '/settings/data', domId: 'settings-tab-data' },
  { key: 'appearance', label: '外观', icon: 'sun', path: '/settings/appearance', domId: 'settings-tab-appearance' },
  { key: 'about', label: '关于', icon: 'question', path: '/settings/about', domId: 'settings-tab-about' },
]

export default function SettingsAccount() {
  const navigate = useNavigate()

  // 复习模块开关（来自 settingsStore，与 Sidebar/App 共享状态）
  // 使用 useShallow selector 避免整体订阅 12 个字段导致的无关重渲染
  const { reviewEnabled, loadSettings, setReviewEnabled } = useSettingsStore(
    useShallow((s) => ({
      reviewEnabled: s.reviewEnabled,
      loadSettings: s.loadSettings,
      setReviewEnabled: s.setReviewEnabled,
    }))
  )

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 个人信息表单
  const [nickname, setNickname] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')

  // 继承微信读书信息开关（默认开启：继承微信读书的官方信息，本地信息无需展示）
  const [inheritWereadProfile, setInheritWereadProfile] = useState(true)

  // ===== 加载账户设置 =====
  useEffect(() => {
    const load = async () => {
      const api = window.electronAPI
      if (!api?.settings) {
        setLoading(false)
        return
      }
      try {
        const [nick, mail, tel, inherit] = await Promise.all([
          api.settings.get('userNickname'),
          api.settings.get('userEmail'),
          api.settings.get('userPhone'),
          api.settings.get('inheritWereadProfile'),
        ])
        if (safeStr(nick)) setNickname(safeStr(nick))
        if (safeStr(mail)) setEmail(safeStr(mail))
        if (safeStr(tel)) setPhone(safeStr(tel))
        // inheritWereadProfile 默认 true；仅当显式存储为 false 时才视为关闭
        setInheritWereadProfile(inherit !== false)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setLoading(false)
      }
    }
    load()
    // 同步加载全局设置（含 reviewEnabled），供侧栏与路由共享
    void loadSettings()
  }, [loadSettings])

  // ===== 派生值 =====
  const avatarInitial = useMemo(() => (nickname || '知').charAt(0), [nickname])

  // ===== 切换「继承微信读书信息」开关 =====
  const handleToggleInherit = async () => {
    const next = !inheritWereadProfile
    setInheritWereadProfile(next)
    try {
      await window.electronAPI?.settings?.set('inheritWereadProfile', next)
    } catch {
      /* 非致命：回滚状态 */
      setInheritWereadProfile(!next)
    }
  }

  // ===== 事件处理 =====
  const handleSaveProfile = async () => {
    const api = window.electronAPI
    if (!api?.settings) return
    setSaving(true)
    setError(null)
    try {
      await Promise.all([
        api.settings.set('userNickname', nickname),
        api.settings.set('userEmail', email),
        api.settings.set('userPhone', phone),
        api.settings.set('inheritWereadProfile', inheritWereadProfile),
      ])
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 3000)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleNavigate = (path: string) => {
    navigate(path)
  }

  if (loading) {
    return <Loading hint="正在加载账户设置..." />
  }

  return (
    <>
      <PageHero
        title="账户设置"
        subtitle="管理个人信息与账户安全"
        actions={
          savedFlash ? (
            <Badge variant="success">
              <Icon name="check" size={14} /> 已保存
            </Badge>
          ) : null
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
            {/* ===== Card 1: 个人信息 ===== */}
            <Card>
              <CardHead eyebrow="账户" title="个人信息" />

              {/* 继承微信读书信息开关 */}
              <div
                className="form-row inherit-toggle-row"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 'calc(var(--spacing) * 4)',
                  background: 'var(--background)',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  marginBottom: 'calc(var(--spacing) * 5)',
                  gap: 'calc(var(--spacing) * 4)',
                }}
              >
                <div className="form-row-info" style={{ minWidth: 0, flex: 1 }}>
                  <strong style={{ display: 'block', fontSize: '0.92rem', fontWeight: 600, color: 'var(--foreground)' }}>
                    继承微信读书信息
                  </strong>
                  <div
                    className="tiny"
                    style={{ marginTop: '0.2rem', color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.4 }}
                  >
                    开启后将在后续版本中自动从微信读书同步个人信息（当前版本暂未实现）
                  </div>
                </div>
                <button
                  type="button"
                  className="toggle"
                  data-dom-id="toggle-inherit-weread-profile"
                  data-on={inheritWereadProfile ? 'true' : 'false'}
                  aria-label="继承微信读书信息"
                  aria-pressed={inheritWereadProfile}
                  onClick={handleToggleInherit}
                  style={{
                    width: 44,
                    height: 24,
                    borderRadius: 999,
                    background: inheritWereadProfile ? 'var(--primary)' : 'var(--muted)',
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
                      left: inheritWereadProfile ? 'auto' : 2,
                      right: inheritWereadProfile ? 2 : 'auto',
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: 'var(--card)',
                      transition: 'transform 0.2s ease',
                    }}
                  />
                </button>
              </div>

              {inheritWereadProfile ? (
                /* 继承模式：提示信息已从微信读书同步 */
                <div
                  className="inherit-notice"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'calc(var(--spacing) * 3)',
                    padding: 'calc(var(--spacing) * 4)',
                    background: 'var(--background)',
                    borderRadius: 'var(--radius)',
                    border: '1px dashed var(--border)',
                    color: 'var(--muted-foreground)',
                    fontSize: '0.9rem',
                  }}
                >
                  <span
                    className="inherit-notice-icon"
                    aria-hidden="true"
                    style={{ display: 'grid', placeItems: 'center', color: 'var(--primary)' }}
                  >
                    <Icon name="check" size={18} />
                  </span>
                  <span>
                    已开启继承：将在后续版本中自动从微信读书同步个人信息（当前版本暂未实现）。
                  </span>
                </div>
              ) : (
                /* 手动模式：显示头像 + 表单 */
                <>
                  <div
                    className="profile-avatar-row"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'calc(var(--spacing) * 4)',
                      marginBottom: 'calc(var(--spacing) * 5)',
                    }}
                  >
                    <div
                      className="profile-avatar"
                      aria-label="用户头像"
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        background: 'var(--primary)',
                        color: 'var(--primary-foreground)',
                        display: 'grid',
                        placeItems: 'center',
                        fontWeight: 700,
                        fontSize: '0.95rem',
                        flexShrink: 0,
                      }}
                    >
                      {avatarInitial}
                    </div>
                    <Button variant="ghost" data-dom-id="cta-change-avatar">更换头像</Button>
                  </div>

                  <div
                    className="form-grid"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 'calc(var(--spacing) * 4)',
                    }}
                  >
                    <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
                      <label className="form-label" htmlFor="account-nickname" style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--card-foreground)' }}>
                        昵称
                      </label>
                      <input
                        id="account-nickname"
                        type="text"
                        className="form-input"
                        value={nickname}
                        placeholder="请输入昵称"
                        onChange={(e) => setNickname(e.target.value)}
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
                        }}
                        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input)' }}
                      />
                    </div>
                    <div className="form-field" style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}>
                      <label className="form-label" htmlFor="account-email" style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--card-foreground)' }}>
                        邮箱
                      </label>
                      <input
                        id="account-email"
                        type="email"
                        className="form-input"
                        value={email}
                        placeholder="reader@zhixing.com"
                        onChange={(e) => setEmail(e.target.value)}
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
                        }}
                        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input)' }}
                      />
                    </div>
                    <div
                      className="form-field form-field-full"
                      style={{ gridColumn: '1 / -1', display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 2)' }}
                    >
                      <label className="form-label" htmlFor="account-phone" style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--card-foreground)' }}>
                        手机
                      </label>
                      <input
                        id="account-phone"
                        type="text"
                        className="form-input"
                        value={phone}
                        placeholder="138****8888"
                        onChange={(e) => setPhone(e.target.value)}
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
                        }}
                        onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--ring)' }}
                        onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--input)' }}
                      />
                    </div>
                  </div>

                  {error && (
                    <div
                      style={{
                        marginTop: 'calc(var(--spacing) * 4)',
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

                  <div
                    className="form-actions"
                    style={{ marginTop: 'calc(var(--spacing) * 5)', display: 'flex', gap: 'calc(var(--spacing) * 3)', flexWrap: 'wrap' }}
                  >
                    <Button
                      variant="primary"
                      data-dom-id="cta-save-profile"
                      disabled={saving}
                      onClick={handleSaveProfile}
                    >
                      {saving ? '保存中...' : '保存修改'}
                    </Button>
                  </div>
                </>
              )}
            </Card>

            {/* ===== Card 2: 功能模块 ===== */}
            <Card>
              <CardHead eyebrow="功能" title="功能模块" />

              {/* 复习模块开关 */}
              <div
                className="form-row"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 'calc(var(--spacing) * 3) 0',
                  borderTop: '1px solid var(--border)',
                  marginTop: 'calc(var(--spacing) * 4)',
                  gap: 'calc(var(--spacing) * 4)',
                }}
              >
                <div className="form-row-info" style={{ minWidth: 0, flex: 1 }}>
                  <strong style={{ display: 'block', fontSize: '0.92rem', fontWeight: 600, color: 'var(--foreground)' }}>
                    复习模块
                  </strong>
                  <div
                    className="tiny"
                    style={{ marginTop: '0.2rem', color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.4 }}
                  >
                    关闭后侧栏隐藏复习入口，/review 路由重定向到首页（FSRS 卡片数据保留）
                  </div>
                </div>
                <button
                  type="button"
                  className="toggle"
                  data-dom-id="toggle-review-enabled"
                  data-on={reviewEnabled ? 'true' : 'false'}
                  aria-label="复习模块开关"
                  aria-pressed={reviewEnabled}
                  onClick={() => void setReviewEnabled(!reviewEnabled)}
                  style={{
                    width: 44,
                    height: 24,
                    borderRadius: 999,
                    background: reviewEnabled ? 'var(--primary)' : 'var(--muted)',
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
                      left: reviewEnabled ? 'auto' : 2,
                      right: reviewEnabled ? 2 : 'auto',
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: 'var(--card)',
                      transition: 'transform 0.2s ease',
                    }}
                  />
                </button>
              </div>
            </Card>
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
          .form-grid {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 760px) {
          .form-row {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: calc(var(--spacing) * 3) !important;
          }
          .inherit-toggle-row {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: calc(var(--spacing) * 3) !important;
          }
        }
      `}</style>
    </>
  )
}
