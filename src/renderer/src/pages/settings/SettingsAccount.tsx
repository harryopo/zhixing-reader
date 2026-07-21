/**
 * SettingsAccount — 账户设置（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/settings-account.html
 * 4 张卡片：个人信息 / 会员状态 / 登录管理 / 数据同步
 * 业务逻辑：通过 window.electronAPI.settings 读写账户信息、同步开关、备份频率
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
  { key: 'weread', label: '微信读书', icon: 'bookshelf', path: '/settings/weread', domId: 'settings-tab-weread' },
  { key: 'data', label: '数据与存储', icon: 'box', path: '/settings/data', domId: 'settings-tab-data' },
  { key: 'appearance', label: '外观', icon: 'sun', path: '/settings/appearance', domId: 'settings-tab-appearance' },
  { key: 'about', label: '关于', icon: 'question', path: '/settings/about', domId: 'settings-tab-about' },
]

/** 备份频率选项 */
const BACKUP_FREQ_OPTIONS = [
  { value: 'daily', label: '每日' },
  { value: 'weekly', label: '每周' },
  { value: 'manual', label: '手动' },
] as const

type BackupFreq = (typeof BACKUP_FREQ_OPTIONS)[number]['value']

/** 设备记录（设计稿静态数据；后端暂无对应 API） */
interface DeviceRecord {
  name: string
  lastLogin: string
  location: string
  isCurrent?: boolean
  logoutDomId?: string
}

const DEFAULT_DEVICES: DeviceRecord[] = [
  { name: 'Windows 11 PC', lastLogin: '2026-07-21 09:15', location: '北京', isCurrent: true },
  { name: 'iPhone 15 Pro', lastLogin: '2026-07-20 22:30', location: '上海', logoutDomId: 'logout-iphone' },
  { name: 'iPad Air', lastLogin: '2026-07-18 14:20', location: '杭州', logoutDomId: 'logout-ipad' },
]

/** 会员权益列表 */
const MEMBERSHIP_BENEFITS = ['无限 AI 对话', '全部知识卡片', '优先客服']

/** 默认会员到期日（与设计稿一致） */
const DEFAULT_MEMBERSHIP_EXPIRY = '2026-12-31'

/** 计算剩余天数 */
function daysUntil(dateStr: string): number {
  const target = new Date(dateStr)
  if (isNaN(target.getTime())) return 0
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  target.setHours(0, 0, 0, 0)
  return Math.max(0, Math.floor((target.getTime() - today.getTime()) / 86400000))
}

/** 格式化备份时间：YYYY-MM-DD HH:mm */
function formatBackupTime(iso: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const mi = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${mi}`
}

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

  // 会员信息
  const [membershipExpiry, setMembershipExpiry] = useState(DEFAULT_MEMBERSHIP_EXPIRY)

  // 同步设置
  const [cloudSync, setCloudSync] = useState(true)
  const [autoBackup, setAutoBackup] = useState(true)
  const [backupFreq, setBackupFreq] = useState<BackupFreq>('daily')
  const [lastBackupAt, setLastBackupAt] = useState<string>('')

  // ===== 加载账户设置 =====
  useEffect(() => {
    const load = async () => {
      const api = window.electronAPI
      if (!api?.settings) {
        setLoading(false)
        return
      }
      try {
        const [nick, mail, tel, expiry, sync, backup, freq, lastBackup] = await Promise.all([
          api.settings.get('userNickname'),
          api.settings.get('userEmail'),
          api.settings.get('userPhone'),
          api.settings.get('membershipExpiry'),
          api.settings.get('cloudSync'),
          api.settings.get('autoBackup'),
          api.settings.get('backupFreq'),
          api.settings.get('lastBackupAt'),
        ])
        if (safeStr(nick)) setNickname(safeStr(nick))
        if (safeStr(mail)) setEmail(safeStr(mail))
        if (safeStr(tel)) setPhone(safeStr(tel))
        if (safeStr(expiry)) setMembershipExpiry(safeStr(expiry))
        if (typeof sync === 'boolean') setCloudSync(sync)
        if (typeof backup === 'boolean') setAutoBackup(backup)
        if (typeof freq === 'string' && BACKUP_FREQ_OPTIONS.some((o) => o.value === freq)) {
          setBackupFreq(freq as BackupFreq)
        }
        if (safeStr(lastBackup)) setLastBackupAt(safeStr(lastBackup))
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
  const remainingDays = useMemo(() => daysUntil(membershipExpiry), [membershipExpiry])
  const avatarInitial = useMemo(() => (nickname || '知').charAt(0), [nickname])

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
      ])
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 3000)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleToggleCloudSync = async () => {
    const next = !cloudSync
    setCloudSync(next)
    try {
      await window.electronAPI?.settings?.set('cloudSync', next)
    } catch {
      /* 非致命：回滚状态 */
      setCloudSync(!next)
    }
  }

  const handleToggleAutoBackup = async () => {
    const next = !autoBackup
    setAutoBackup(next)
    try {
      await window.electronAPI?.settings?.set('autoBackup', next)
    } catch {
      /* 非致命：回滚状态 */
      setAutoBackup(!next)
    }
  }

  const handleBackupFreqChange = async (value: BackupFreq) => {
    setBackupFreq(value)
    try {
      await window.electronAPI?.settings?.set('backupFreq', value)
    } catch {
      /* 非致命：保留前端状态 */
    }
  }

  const handleBackupNow = async () => {
    const now = new Date().toISOString()
    setLastBackupAt(now)
    try {
      await window.electronAPI?.settings?.set('lastBackupAt', now)
    } catch {
      /* 非致命：保留前端状态 */
    }
  }

  const handleLogoutDevice = async (domId?: string) => {
    // 业务占位：当前后端无登出 IPC，仅记录最后一次退出时间
    if (!domId) return
    try {
      await window.electronAPI?.settings?.set('lastLogoutAt', new Date().toISOString())
    } catch {
      /* 非致命 */
    }
  }

  const handleLogoutAll = async () => {
    try {
      await window.electronAPI?.settings?.set('lastLogoutAt', new Date().toISOString())
    } catch {
      /* 非致命 */
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
            </Card>

            {/* ===== Card 2: 会员状态 ===== */}
            <Card>
              <CardHead
                eyebrow="会员"
                title="会员状态"
                action={
                  <Badge
                    variant="warning"
                    style={{ background: 'var(--state-warning)', color: 'var(--foreground)', fontWeight: 600 }}
                  >
                    高级会员
                  </Badge>
                }
              />

              <div
                className="membership-info"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'calc(var(--spacing) * 5)',
                  padding: 'calc(var(--spacing) * 4)',
                  background: 'var(--background)',
                  borderRadius: 'var(--radius)',
                  border: '1px solid var(--border)',
                  marginBottom: 'calc(var(--spacing) * 4)',
                }}
              >
                <div className="membership-info-block" style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <span
                    className="tiny"
                    style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.4 }}
                  >
                    到期时间
                  </span>
                  <strong
                    className="mono"
                    style={{
                      fontSize: '1.1rem',
                      fontWeight: 700,
                      color: 'var(--foreground)',
                      fontFamily: 'var(--font-mono)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {membershipExpiry}
                  </strong>
                </div>
                <div className="membership-info-block" style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem' }}>
                  <span
                    className="tiny"
                    style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.4 }}
                  >
                    剩余天数
                  </span>
                  <strong
                    className="mono"
                    style={{
                      fontSize: '1.1rem',
                      fontWeight: 700,
                      color: 'var(--foreground)',
                      fontFamily: 'var(--font-mono)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {remainingDays} 天
                  </strong>
                </div>
              </div>

              <ul
                className="benefit-list"
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: '0 0 calc(var(--spacing) * 5)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'calc(var(--spacing) * 3)',
                }}
              >
                {MEMBERSHIP_BENEFITS.map((benefit) => (
                  <li
                    key={benefit}
                    className="benefit-item"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'calc(var(--spacing) * 3)',
                      fontSize: '0.92rem',
                      color: 'var(--foreground)',
                    }}
                  >
                    <span
                      className="benefit-check"
                      aria-hidden="true"
                      style={{
                        width: 20,
                        height: 20,
                        flexShrink: 0,
                        display: 'grid',
                        placeItems: 'center',
                        color: 'var(--state-success)',
                      }}
                    >
                      <Icon name="check" size={16} />
                    </span>
                    {benefit}
                  </li>
                ))}
              </ul>

              <div
                className="form-actions"
                style={{ display: 'flex', gap: 'calc(var(--spacing) * 3)', flexWrap: 'wrap' }}
              >
                <Button variant="primary" data-dom-id="cta-renew">续费</Button>
                <Button variant="secondary" data-dom-id="cta-upgrade">升级</Button>
              </div>
            </Card>

            {/* ===== Card 3: 登录管理 ===== */}
            <Card>
              <CardHead eyebrow="安全" title="登录管理" />

              <div
                className="device-table-wrap"
                style={{
                  overflowX: 'auto',
                  marginBottom: 'calc(var(--spacing) * 4)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                }}
              >
                <table
                  className="device-table"
                  style={{
                    width: '100%',
                    borderCollapse: 'collapse',
                    minWidth: 560,
                  }}
                >
                  <thead>
                    <tr>
                      {['设备', '最近登录', '位置', '操作'].map((th) => (
                        <th
                          key={th}
                          style={{
                            padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                            textAlign: 'left',
                            fontSize: '0.78rem',
                            fontWeight: 600,
                            color: 'var(--muted-foreground)',
                            textTransform: 'uppercase',
                            letterSpacing: '0.06em',
                            borderBottom: '1px solid var(--border)',
                            background: 'var(--muted)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {th}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {DEFAULT_DEVICES.map((device) => (
                      <tr key={device.name}>
                        <td
                          style={{
                            padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                            fontSize: '0.9rem',
                            color: 'var(--foreground)',
                            borderBottom: '1px solid var(--border)',
                            verticalAlign: 'middle',
                          }}
                        >
                          <div className="device-name" style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 2)', whiteSpace: 'nowrap' }}>
                            <span>{device.name}</span>
                            {device.isCurrent && (
                              <span
                                className="this-device-badge"
                                style={{
                                  background: 'var(--secondary)',
                                  color: 'var(--primary)',
                                  fontSize: '0.72rem',
                                  padding: '0.15rem 0.5rem',
                                  borderRadius: 999,
                                  whiteSpace: 'nowrap',
                                  fontWeight: 600,
                                }}
                              >
                                本机
                              </span>
                            )}
                          </div>
                        </td>
                        <td
                          style={{
                            padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                            fontSize: '0.9rem',
                            color: 'var(--foreground)',
                            borderBottom: '1px solid var(--border)',
                            verticalAlign: 'middle',
                          }}
                        >
                          <span
                            className="device-time"
                            style={{
                              fontFamily: 'var(--font-mono)',
                              fontVariantNumeric: 'tabular-nums',
                              fontSize: '0.84rem',
                              color: 'var(--muted-foreground)',
                              whiteSpace: 'nowrap',
                            }}
                          >
                            {device.lastLogin}
                          </span>
                        </td>
                        <td
                          style={{
                            padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                            fontSize: '0.9rem',
                            color: 'var(--foreground)',
                            borderBottom: '1px solid var(--border)',
                            verticalAlign: 'middle',
                          }}
                        >
                          {device.location}
                        </td>
                        <td
                          style={{
                            padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                            fontSize: '0.9rem',
                            color: 'var(--foreground)',
                            borderBottom: '1px solid var(--border)',
                            verticalAlign: 'middle',
                          }}
                        >
                          {device.isCurrent ? (
                            <span
                              className="tiny"
                              style={{ color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.4 }}
                            >
                              当前设备
                            </span>
                          ) : (
                            <Button
                              variant="ghost"
                              data-dom-id={device.logoutDomId}
                              onClick={() => handleLogoutDevice(device.logoutDomId)}
                            >
                              退出
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div
                className="form-actions"
                style={{ display: 'flex', gap: 'calc(var(--spacing) * 3)', flexWrap: 'wrap' }}
              >
                <Button variant="danger" data-dom-id="cta-logout-all" onClick={handleLogoutAll}>
                  退出所有设备
                </Button>
              </div>
            </Card>

            {/* ===== Card 4: 功能模块 ===== */}
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

            {/* ===== Card 5: 数据同步 ===== */}
            <Card>
              <CardHead eyebrow="同步" title="数据同步" />

              {/* 云同步 */}
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
                    云同步
                  </strong>
                  <div
                    className="tiny"
                    style={{ marginTop: '0.2rem', color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.4 }}
                  >
                    将阅读数据同步到云端，多设备共享
                  </div>
                </div>
                <button
                  type="button"
                  className="toggle"
                  data-dom-id="toggle-cloud-sync"
                  data-on={cloudSync ? 'true' : 'false'}
                  aria-label="云同步"
                  aria-pressed={cloudSync}
                  onClick={handleToggleCloudSync}
                  style={{
                    width: 44,
                    height: 24,
                    borderRadius: 999,
                    background: cloudSync ? 'var(--primary)' : 'var(--muted)',
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
                      left: cloudSync ? 'auto' : 2,
                      right: cloudSync ? 2 : 'auto',
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: 'var(--card)',
                      transition: 'transform 0.2s ease',
                    }}
                  />
                </button>
              </div>

              {/* 自动备份 */}
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
                    自动备份
                  </strong>
                  <div
                    className="tiny"
                    style={{ marginTop: '0.2rem', color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.4 }}
                  >
                    定期备份本地数据库，防止数据丢失
                  </div>
                </div>
                <button
                  type="button"
                  className="toggle"
                  data-dom-id="toggle-auto-backup"
                  data-on={autoBackup ? 'true' : 'false'}
                  aria-label="自动备份"
                  aria-pressed={autoBackup}
                  onClick={handleToggleAutoBackup}
                  style={{
                    width: 44,
                    height: 24,
                    borderRadius: 999,
                    background: autoBackup ? 'var(--primary)' : 'var(--muted)',
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
                      left: autoBackup ? 'auto' : 2,
                      right: autoBackup ? 2 : 'auto',
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      background: 'var(--card)',
                      transition: 'transform 0.2s ease',
                    }}
                  />
                </button>
              </div>

              {/* 备份频率 */}
              <div
                className="form-field"
                style={{
                  marginTop: 'calc(var(--spacing) * 5)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 'calc(var(--spacing) * 2)',
                }}
              >
                <label
                  className="form-label"
                  htmlFor="backup-freq"
                  style={{ fontSize: '0.82rem', fontWeight: 500, color: 'var(--card-foreground)' }}
                >
                  备份频率
                </label>
                <select
                  id="backup-freq"
                  className="form-select"
                  data-dom-id="select-backup-freq"
                  value={backupFreq}
                  onChange={(e) => handleBackupFreqChange(e.target.value as BackupFreq)}
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
                  {BACKUP_FREQ_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>

              {/* 上次备份状态 */}
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
                  marginTop: 'calc(var(--spacing) * 4)',
                }}
              >
                <span
                  className="status-dot"
                  aria-hidden="true"
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: 'var(--state-success)',
                    flexShrink: 0,
                  }}
                />
                <div className="status-text" style={{ minWidth: 0, flex: 1 }}>
                  <strong style={{ display: 'block', fontSize: '0.92rem', fontWeight: 600, color: 'var(--foreground)' }}>
                    上次备份
                  </strong>
                  <div
                    className="tiny"
                    style={{ marginTop: '0.2rem', color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.4 }}
                  >
                    {lastBackupAt
                      ? `${formatBackupTime(lastBackupAt)} ${backupFreq === 'daily' ? '自动备份' : backupFreq === 'weekly' ? '自动备份' : '手动备份'}`
                      : '尚未备份'}
                  </div>
                </div>
                <Button
                  variant="secondary"
                  data-dom-id="cta-backup-now"
                  onClick={handleBackupNow}
                >
                  立即备份
                </Button>
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
          .membership-info {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: calc(var(--spacing) * 3) !important;
          }
          .sync-status {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: calc(var(--spacing) * 3) !important;
          }
        }
      `}</style>
    </>
  )
}
