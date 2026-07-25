/**
 * SettingsAbout — 关于（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/settings-about.html
 * 5 张卡片：应用信息 / 版本更新 / 反馈与帮助 / 开源许可 / 法律信息
 * 业务逻辑：版本信息展示、检查更新（预留 IPC）、反馈入口、外部链接
 */

import { useCallback, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Card, { CardHead } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Icon from '@/components/ui/Icon'
import { toast } from '@/stores/toastStore'
import {
  APP_META,
  FEEDBACK_TILES,
  GITHUB_ISSUES_URL,
  GITHUB_RELEASES_API,
  GITHUB_RELEASES_PAGE,
  GITHUB_REPO_URL,
  LICENSE_TYPE,
  LICENSE_URL,
  PRIVACY_POLICY_URL,
} from '../../../../shared/external-links'

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
  { key: 'appearance', label: '外观', icon: 'sun', path: '/settings/appearance', domId: 'settings-tab-appearance' },
  { key: 'about', label: '关于', icon: 'question', path: '/settings/about', active: true },
]

/** 更新历史记录 */
interface HistoryEntry {
  version: string
  date: string
  notes: string
}

const UPDATE_HISTORY: HistoryEntry[] = [
  {
    version: 'v0.9.0',
    date: '2026-06-20',
    notes: '新增 AI 智能复习调度，优化知识卡片生成流程，修复同步冲突问题。',
  },
  {
    version: 'v0.8.0',
    date: '2026-05-18',
    notes: '引入 FSRS 间隔重复算法，新增生词本与笔记联动，改进统计图表。',
  },
  {
    version: 'v0.7.0',
    date: '2026-04-10',
    notes: '首发内测版本，支持微信读书同步、AI 对话、知识卡片核心功能。',
  },
]

/** 开源许可证条目 */
interface LicenseEntry {
  name: string
  version: string
  type: string
}

const LICENSES: LicenseEntry[] = [
  { name: 'Electron', version: '35.0.0', type: 'MIT' },
  { name: 'React', version: '19.0.0', type: 'MIT' },
  { name: 'TypeScript', version: '5.6.0', type: 'Apache-2.0' },
  { name: 'Tailwind CSS', version: '4.0.0', type: 'MIT' },
  { name: 'Zustand', version: '5.0.0', type: 'MIT' },
  { name: 'sql.js', version: '1.12.0', type: 'BSD-3-Clause' },
  { name: 'FSRS.js', version: '2.0.0', type: 'MIT' },
  { name: 'Lucide Icons', version: '1.8.0', type: 'ISC' },
  { name: 'electron-vite', version: '2.3.0', type: 'MIT' },
  { name: 'electron-builder', version: '25.0.0', type: 'MIT' },
]

/** 内联 GitHub 图标（Icon.tsx 未提供） */
function GitHubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
  )
}

/** 内联盾牌图标（Icon.tsx 未提供） */
function ShieldIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      aria-hidden="true"
    >
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  )
}

export default function SettingsAbout() {
  const navigate = useNavigate()
  const [checking, setChecking] = useState(false)

  const handleNavigate = useCallback((path: string) => {
    navigate(path)
  }, [navigate])

  // ===== 检查更新 =====
  const handleCheckUpdate = useCallback(async () => {
    if (checking) return
    setChecking(true)
    const toastId = toast.loading('正在检查更新...')
    try {
      const res = await fetch(GITHUB_RELEASES_API, {
        headers: { Accept: 'application/vnd.github+json' },
      })
      if (res.status === 403 || res.status === 429) {
        throw new Error('GitHub API 速率限制，请稍后再试')
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }
      const data = (await res.json()) as { tag_name?: string }
      toast.remove(toastId)
      const latestTag = (data.tag_name ?? '').trim()
      if (latestTag && latestTag !== APP_META.version) {
        toast.success(`发现新版本 ${latestTag}，即将打开下载页面`)
        await window.electronAPI.system.openExternal(GITHUB_RELEASES_PAGE)
      } else {
        toast.success('当前已是最新版本')
      }
    } catch (err) {
      toast.remove(toastId)
      toast.error(`检查更新失败: ${(err as Error).message}`)
    } finally {
      setChecking(false)
    }
  }, [checking])

  // ===== 反馈 / 文档 / FAQ 入口 =====
  const handleOpenExternal = useCallback(async (url: string) => {
    await window.electronAPI.system.openExternal(url)
  }, [])

  return (
    <>
      <PageHero title="关于" subtitle="了解知行读书">
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

          {/* ===== 右：关于卡片堆叠 ===== */}
          <div
            className="about-cards"
            style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 5)' }}
          >
            {/* ===== Card 1: 应用信息 ===== */}
            <Card>
              <CardHead eyebrow="关于" title="应用信息" />

              <div
                className="app-info-head"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'calc(var(--spacing) * 5)',
                  marginBottom: 'calc(var(--spacing) * 4)',
                }}
              >
                <div
                  className="app-logo"
                  aria-label="知行读书 Logo"
                  style={{
                    width: 64,
                    height: 64,
                    borderRadius: 'calc(var(--radius) + 8px)',
                    display: 'grid',
                    placeItems: 'center',
                    background: 'var(--primary)',
                    color: 'var(--primary-foreground)',
                    fontWeight: 700,
                    fontSize: '1.8rem',
                    flexShrink: 0,
                  }}
                >
                  知
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    className="app-name-row"
                    style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)', flexWrap: 'wrap' }}
                  >
                    <h3
                      className="app-name"
                      style={{
                        fontSize: '1.4rem',
                        fontWeight: 700,
                        color: 'var(--foreground)',
                        margin: 0,
                      }}
                    >
                      {APP_META.name}
                  </h3>
                    <span
                      className="version-badge"
                      style={{
                        background: 'var(--muted)',
                        color: 'var(--foreground)',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '0.82rem',
                        padding: '0.28rem 0.65rem',
                        borderRadius: 'var(--radius)',
                        whiteSpace: 'nowrap',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {APP_META.version}
                    </span>
                  </div>
                  <p
                    className="app-desc"
                    style={{
                      color: 'var(--muted-foreground)',
                      fontSize: '0.92rem',
                      lineHeight: 1.55,
                      margin: 'calc(var(--spacing) * 2) 0 0',
                      maxWidth: '60ch',
                    }}
                  >
                    {APP_META.description}
                  </p>
                </div>
              </div>

              <div
                className="tech-stack"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 'calc(var(--spacing) * 2)',
                  marginTop: 'calc(var(--spacing) * 4)',
                }}
              >
                {APP_META.techStack.map((tech) => (
                  <span
                    key={tech}
                    className="tech-chip"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      padding: '0.32rem 0.7rem',
                      borderRadius: 'var(--radius)',
                      background: 'var(--secondary)',
                      color: 'var(--secondary-foreground)',
                      fontSize: '0.8rem',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {tech}
                  </span>
                ))}
              </div>
            </Card>

            {/* ===== Card 2: 版本更新 ===== */}
            <Card>
              <CardHead eyebrow="更新" title="版本更新" />

              <div
                className="version-current"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: 'calc(var(--spacing) * 4)',
                  background: 'var(--background)',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                  marginBottom: 'calc(var(--spacing) * 4)',
                  gap: 'calc(var(--spacing) * 4)',
                }}
              >
                <div
                  className="version-current-info"
                  style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: 0 }}
                >
                  <strong style={{ fontSize: '1rem', fontWeight: 600, color: 'var(--foreground)' }}>
                    当前版本{' '}
                    <span
                      className="mono"
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {APP_META.version}
                    </span>
                  </strong>
                  <div
                    className="tiny"
                    style={{ marginTop: '0.2rem', color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.4 }}
                  >
                    发布于 {APP_META.releaseDate}
                  </div>
                </div>
                <div
                  className="version-current-actions"
                  style={{ display: 'flex', alignItems: 'center', gap: 'calc(var(--spacing) * 3)', flexShrink: 0 }}
                >
                  <Badge
                    variant="success"
                    style={{
                      background: 'var(--state-success)',
                      color: 'var(--card)',
                      fontSize: '0.78rem',
                      padding: '0.3rem 0.65rem',
                      fontWeight: 600,
                    }}
                  >
                    已是最新版本
                  </Badge>
                  <Button
                    variant="secondary"
                    data-dom-id="cta-check-update"
                    disabled={checking}
                    onClick={handleCheckUpdate}
                  >
                    {checking ? '检查中...' : '检查更新'}
                  </Button>
                </div>
              </div>

              <div
                className="history-label"
                style={{
                  color: 'var(--muted-foreground)',
                  fontSize: '0.78rem',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  marginBottom: 'calc(var(--spacing) * 3)',
                }}
              >
                更新历史
              </div>
              <ul
                className="history-list"
                style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column' }}
              >
                {UPDATE_HISTORY.map((entry) => (
                  <li
                    key={entry.version}
                    className="history-item"
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto 1fr',
                      gap: 'calc(var(--spacing) * 4)',
                      padding: 'calc(var(--spacing) * 4) 0',
                      borderTop: '1px solid var(--border)',
                      alignItems: 'flex-start',
                    }}
                  >
                    <div
                      className="history-meta"
                      style={{ display: 'flex', flexDirection: 'column', gap: '0.2rem', minWidth: 120 }}
                    >
                      <span
                        className="history-ver"
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontVariantNumeric: 'tabular-nums',
                          fontSize: '0.9rem',
                          fontWeight: 600,
                          color: 'var(--foreground)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {entry.version}
                      </span>
                      <span
                        className="history-date"
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontVariantNumeric: 'tabular-nums',
                          fontSize: '0.78rem',
                          color: 'var(--muted-foreground)',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {entry.date}
                      </span>
                    </div>
                    <div
                      className="history-body"
                      style={{
                        fontSize: '0.88rem',
                        color: 'var(--card-foreground)',
                        lineHeight: 1.55,
                        minWidth: 0,
                      }}
                    >
                      {entry.notes}
                    </div>
                  </li>
                ))}
              </ul>
            </Card>

            {/* ===== Card 3: 反馈与帮助 ===== */}
            <Card>
              <CardHead eyebrow="支持" title="反馈与帮助" />

              <div
                className="feedback-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 'calc(var(--spacing) * 3)',
                  marginBottom: 'calc(var(--spacing) * 4)',
                }}
              >
                {FEEDBACK_TILES.map((tile) => {
                  const tileStyle: CSSProperties = {
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    gap: 'calc(var(--spacing) * 2)',
                    padding: 'calc(var(--spacing) * 4)',
                    background: 'var(--background)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius)',
                    cursor: 'pointer',
                    transition: 'border-color 0.2s ease, background 0.2s ease',
                    fontFamily: 'inherit',
                    textAlign: 'left',
                  }
                  return (
                    <button
                      key={tile.domId}
                      type="button"
                      className="feedback-tile"
                      data-dom-id={tile.domId}
                      onClick={() => handleOpenExternal(tile.url)}
                      style={tileStyle}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.borderColor = 'var(--ring)'
                        e.currentTarget.style.background = 'var(--popover)'
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.borderColor = 'var(--border)'
                        e.currentTarget.style.background = 'var(--background)'
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.outline = '2px solid var(--ring)'
                        e.currentTarget.style.outlineOffset = '2px'
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.outline = 'none'
                      }}
                    >
                      <span
                        className="feedback-tile-icon"
                        style={{
                          width: 32,
                          height: 32,
                          display: 'grid',
                          placeItems: 'center',
                          color: 'var(--primary)',
                          flexShrink: 0,
                        }}
                      >
                        <Icon name={tile.icon} size={20} />
                      </span>
                      <strong style={{ fontSize: '0.92rem', fontWeight: 600, color: 'var(--foreground)' }}>
                        {tile.title}
                      </strong>
                      <div
                        className="tiny"
                        style={{ marginTop: '0.1rem', color: 'var(--muted-foreground)', fontSize: '0.78rem', lineHeight: 1.4 }}
                      >
                        {tile.hint}
                      </div>
                    </button>
                  )
                })}
              </div>

              <div
                className="contact-row"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 'calc(var(--spacing) * 4)',
                  paddingTop: 'calc(var(--spacing) * 4)',
                  borderTop: '1px solid var(--border)',
                }}
              >
                <a
                  className="contact-link"
                  data-dom-id="link-github-repo"
                  href={GITHUB_REPO_URL}
                  onClick={(e) => {
                    e.preventDefault()
                    void handleOpenExternal(GITHUB_REPO_URL)
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'calc(var(--spacing) * 2)',
                    color: 'var(--primary)',
                    fontSize: '0.88rem',
                    textDecoration: 'none',
                    fontWeight: 500,
                    transition: 'color 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--ring)'
                    e.currentTarget.style.textDecoration = 'underline'
                    e.currentTarget.style.textUnderlineOffset = '3px'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--primary)'
                    e.currentTarget.style.textDecoration = 'none'
                  }}
                >
                  <GitHubIcon size={16} />
                  在 GitHub 上查看源码
                </a>
                <a
                  className="contact-link"
                  data-dom-id="link-github-issues"
                  href={GITHUB_ISSUES_URL}
                  onClick={(e) => {
                    e.preventDefault()
                    void handleOpenExternal(GITHUB_ISSUES_URL)
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'calc(var(--spacing) * 2)',
                    color: 'var(--primary)',
                    fontSize: '0.88rem',
                    textDecoration: 'none',
                    fontWeight: 500,
                    transition: 'color 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--ring)'
                    e.currentTarget.style.textDecoration = 'underline'
                    e.currentTarget.style.textUnderlineOffset = '3px'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--primary)'
                    e.currentTarget.style.textDecoration = 'none'
                  }}
                >
                  <GitHubIcon size={16} />
                  在 GitHub Issues 反馈
                </a>
              </div>
            </Card>

            {/* ===== Card 4: 开源许可 ===== */}
            <Card>
              <CardHead eyebrow="许可" title="开源许可" />

              <p
                className="license-intro"
                style={{
                  color: 'var(--muted-foreground)',
                  fontSize: '0.88rem',
                  lineHeight: 1.55,
                  margin: '0 0 calc(var(--spacing) * 4)',
                  maxWidth: '60ch',
                }}
              >
                知行读书本身使用 {LICENSE_TYPE} 开源许可证。以下是我们使用的主要开源依赖：
              </p>
              <div
                className="license-table-wrap"
                style={{
                  overflowX: 'auto',
                  border: '1px solid var(--border)',
                  borderRadius: 'var(--radius)',
                }}
              >
                <table
                  className="license-table"
                  style={{ width: '100%', borderCollapse: 'collapse', minWidth: 480 }}
                >
                  <thead>
                    <tr>
                      {['项目', '版本', '许可证'].map((th) => (
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
                    {LICENSES.map((license, idx) => (
                      <tr key={license.name}>
                        <td
                          className="license-name"
                          style={{
                            padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                            fontSize: '0.9rem',
                            color: 'var(--foreground)',
                            borderBottom: idx === LICENSES.length - 1 ? 'none' : '1px solid var(--border)',
                            verticalAlign: 'middle',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {license.name}
                        </td>
                        <td
                          className="license-ver"
                          style={{
                            padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                            fontSize: '0.84rem',
                            color: 'var(--muted-foreground)',
                            borderBottom: idx === LICENSES.length - 1 ? 'none' : '1px solid var(--border)',
                            verticalAlign: 'middle',
                            fontFamily: 'var(--font-mono)',
                            fontVariantNumeric: 'tabular-nums',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {license.version}
                        </td>
                        <td
                          className="license-type"
                          style={{
                            padding: 'calc(var(--spacing) * 3) calc(var(--spacing) * 4)',
                            fontSize: '0.84rem',
                            color: 'var(--card-foreground)',
                            borderBottom: idx === LICENSES.length - 1 ? 'none' : '1px solid var(--border)',
                            verticalAlign: 'middle',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {license.type}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* ===== Card 5: 法律信息 ===== */}
            <Card>
              <CardHead eyebrow="法律" title="法律信息" />

              <div
                className="legal-row"
                style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 'calc(var(--spacing) * 5)',
                  alignItems: 'center',
                  marginBottom: 'calc(var(--spacing) * 4)',
                }}
              >
                <a
                  className="legal-link"
                  data-dom-id="link-privacy"
                  href={PRIVACY_POLICY_URL}
                  onClick={(e) => {
                    e.preventDefault()
                    void handleOpenExternal(PRIVACY_POLICY_URL)
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'calc(var(--spacing) * 2)',
                    color: 'var(--primary)',
                    fontSize: '0.9rem',
                    textDecoration: 'none',
                    fontWeight: 500,
                    transition: 'color 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--ring)'
                    e.currentTarget.style.textDecoration = 'underline'
                    e.currentTarget.style.textUnderlineOffset = '3px'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--primary)'
                    e.currentTarget.style.textDecoration = 'none'
                  }}
                >
                  <ShieldIcon size={16} />
                  隐私政策
                </a>
                <a
                  className="legal-link"
                  data-dom-id="link-license"
                  href={LICENSE_URL}
                  onClick={(e) => {
                    e.preventDefault()
                    void handleOpenExternal(LICENSE_URL)
                  }}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 'calc(var(--spacing) * 2)',
                    color: 'var(--primary)',
                    fontSize: '0.9rem',
                    textDecoration: 'none',
                    fontWeight: 500,
                    transition: 'color 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--ring)'
                    e.currentTarget.style.textDecoration = 'underline'
                    e.currentTarget.style.textUnderlineOffset = '3px'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--primary)'
                    e.currentTarget.style.textDecoration = 'none'
                  }}
                >
                  <Icon name="file" size={16} />
                  开源许可证
                </a>
              </div>
              <div
                className="copyright"
                style={{
                  color: 'var(--muted-foreground)',
                  fontSize: '0.82rem',
                  fontFamily: 'var(--font-mono)',
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                &copy; 2026 {APP_META.author} · {LICENSE_TYPE} License
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
          .feedback-grid {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 760px) {
          .app-info-head {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: calc(var(--spacing) * 3) !important;
          }
          .version-current {
            flex-direction: column !important;
            align-items: flex-start !important;
            gap: calc(var(--spacing) * 3) !important;
          }
          .version-current-actions {
            width: 100% !important;
            justify-content: flex-start !important;
          }
          .history-item {
            grid-template-columns: 1fr !important;
            gap: calc(var(--spacing) * 2) !important;
          }
        }
      `}</style>
    </>
  )
}
