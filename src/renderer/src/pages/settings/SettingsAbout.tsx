/**
 * SettingsAbout — 关于（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/settings-about.html
 * 5 张卡片：应用信息 / 版本更新 / 反馈与帮助 / 开源许可 / 法律信息
 * 业务逻辑：版本信息展示、自动更新（electron-updater + GitHub Releases）、反馈入口、外部链接
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Card, { CardHead } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import BrandMark from '@/components/ui/BrandMark'
import Icon from '@/components/ui/Icon'
import { toast } from '@/stores/toastStore'
import type { UpdateStatusView } from '../../../../types/renderer'
import { describeUpdateError } from '../../../../shared/update-notice'
import {
  APP_META,
  FEEDBACK_TILES,
  GITHUB_RELEASES_API,
  GITHUB_RELEASES_PAGE,
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
  { key: 'agent', label: '智能体编排', icon: 'settings', path: '/settings/agent', domId: 'settings-tab-agent' },
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
  details?: string[]
}

const UPDATE_HISTORY: HistoryEntry[] = [
  {
    version: 'v1.3.4',
    date: '2026-09-23',
    notes: '应用内更新更稳：重启安装不再弹「无法关闭」，复习计数口径统一。',
    details: [
      '「重启安装」先写完数据再结束进程，安装器不再等不到退出',
      '复习「今日到期」只算已学过且到期的卡片',
      '书籍详情的「笔记」页签可按是否写了笔记筛出',
      '检查更新、下载、安装的入口不变',
    ],
  },
  {
    version: 'v1.3.3',
    date: '2026-09-21',
    notes: '检查更新失败的提示改为中文说明，同一次失败只提示一次。',
    details: [
      '网络不通、证书异常、访问受限各给一句可行动的说明',
      '不再显示网络错误码',
      '进页面回读状态时不再重复弹提示',
      '本页更新历史改为短句分条',
    ],
  },
  {
    version: 'v1.3.2',
    date: '2026-09-21',
    notes: '统计页数据口径修正：时间范围、图表与角标说的是同一个数。',
    details: [
      '趋势图与所选时间范围对齐',
      '本年改为按月聚合，标注 1—12 月',
      '复习热力图改用本地日期统计',
      '卡片总数与近 12 周复习次数分开标注',
      'AI 调用日志移除「费用」列',
    ],
  },
  {
    version: 'v1.3.1',
    date: '2026-09-21',
    notes: '修复应用内更新提示：查到的新版本能正常显示出来了。',
    details: [
      '顶栏通知出现「新版本 vX」，点击直达本页',
      '查到已是最新时自动收回提示',
      '应用连着开也每 6 小时重查一次',
      '进入本页自动补查，不必手点',
    ],
  },
  {
    version: 'v1.3.0',
    date: '2026-09-21',
    notes: '书籍层级摘要上线，字体离线化，界面数据接到真实存储。',
    details: [
      '逐章摘要汇总成全书摘要，一并注入对话',
      '书籍详情新增「摘要」页签',
      '划线变更只提醒，不自动调用 AI',
      'AI 用量分档：闲聊类可走经济档模型',
      '中文字体随包分发，离线可用',
      '新徽标「玉璧」，色值收进单一真值',
    ],
  },
  {
    version: 'v1.2.0',
    date: '2026-09-17',
    notes: '应用内自动更新上线，检索链路换成本地 BM25。',
    details: [
      '启动静默检查，本页可下载与重启安装',
      '本地 BM25 检索，无需向量服务',
      '中文提问可检索到自己的划线',
      '对话页展示检索过程与命中原文',
      '每日新卡上限，避免复习队列堆积',
      '章节名、卡片来源等历史数据自动补齐',
    ],
  },
  {
    version: 'v1.1.0',
    date: '2026-08-28',
    notes: '复习闭环落地，画像注入 AI，界面数据接到真实存储。',
    details: [
      '新增复习页：划线原文做卡面，四级评分',
      '键盘快捷键评分',
      'AI 用量实时统计',
      '个人画像注入对话上下文',
      '首页重构，统计内容收敛到统计页',
    ],
  },
  {
    version: 'v1.0.0',
    date: '2026-07-25',
    notes: '首个正式版本，核心功能完整。',
    details: [
      '微信读书同步：书架、划线、笔记、书评',
      'AI 智能体对话',
      'FSRS-6.0 间隔重复',
      '知识卡片体系：概念 / 方法论 / 金句',
      '英语词汇学习',
      'ECharts 统计仪表盘',
      'MCP Server 子项目',
    ],
  },
  {
    version: 'v0.9.0',
    date: '2026-06-20',
    notes: '新增智能复习调度，优化卡片生成流程。',
    details: [
      '按遗忘曲线自动安排复习计划',
      '知识卡片蒸馏流程优化',
      '修复微信读书同步的数据冲突',
      '新增 Token 用量统计页',
    ],
  },
  {
    version: 'v0.8.0',
    date: '2026-06-15',
    notes: '引入 FSRS 间隔重复，新增生词本。',
    details: [
      'FSRS 算法替代 SM-2',
      '生词本：约 8 万词频词典',
      '生词本与笔记联动，阅读中自动收集',
      '统计图表新增阅读趋势与类型占比',
    ],
  },
  {
    version: 'v0.7.0',
    date: '2026-06-05',
    notes: '首发内测版本。',
    details: [
      '微信读书账号绑定与书架同步',
      '三栏 AI 对话，支持流式输出',
      '知识卡片自动蒸馏',
      '本地数据库存储，离线可用',
      '深色 / 浅色主题切换',
    ],
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
  { name: 'sql.js', version: '1.14.1', type: 'BSD-3-Clause' },
  { name: 'FSRS.js', version: '2.0.0', type: 'MIT' },
  { name: 'Lucide Icons', version: '1.8.0', type: 'ISC' },
  { name: 'electron-vite', version: '2.3.0', type: 'MIT' },
  { name: 'electron-builder', version: '25.0.0', type: 'MIT' },
  { name: 'Noto Sans SC（思源黑体，界面中文）', version: '5.3.0', type: 'OFL-1.1' },
  { name: 'DM Sans（界面拉丁与数字）', version: '5.3.0', type: 'OFL-1.1' },
  { name: 'JetBrains Mono（等宽）', version: '5.3.0', type: 'OFL-1.1' },
]

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
  /**
   * 更新状态机：
   * unknown 尚未检查 / latest 已是最新 / available 有新版本（可下载） /
   * downloading 下载中 / downloaded 已下载（可重启安装） / outdated 仅 dev 环境降级检查用
   *
   * 打包环境走 electron-updater 真实链路（检查 → 下载 → 重启安装）；
   * 开发环境 autoUpdater 不可用，降级为 GitHub Releases API 比对 + 打开下载页。
   */
  const [updateState, setUpdateState] = useState<
    'unknown' | 'latest' | 'available' | 'downloading' | 'downloaded' | 'outdated'
  >('unknown')
  const [latestVersion, setLatestVersion] = useState('')
  const [progress, setProgress] = useState<{ percent: number; transferredMb: number; totalMb: number } | null>(null)
  const [updaterSupported, setUpdaterSupported] = useState(true)
  const downloadingRef = useRef(false)

  const handleNavigate = useCallback((path: string) => {
    navigate(path)
  }, [navigate])

  /** 主进程状态 → 本页状态机。事件推送和本页回读缓存走同一个函数，避免两套口径 */
  const applyUpdateStatus = useCallback((status: UpdateStatusView, fromCache = false) => {
    switch (status.stage) {
      case 'checking':
        setChecking(true)
        break
      case 'available':
        setChecking(false)
        setUpdateState('available')
        setLatestVersion(status.version ?? '')
        break
      case 'not-available':
        setChecking(false)
        setUpdateState('latest')
        break
      case 'downloading':
        setUpdateState('downloading')
        setProgress({
          percent: status.percent ?? 0,
          transferredMb: status.transferredMb ?? 0,
          totalMb: status.totalMb ?? 0,
        })
        break
      case 'downloaded':
        downloadingRef.current = false
        setProgress(null)
        setUpdateState('downloaded')
        setLatestVersion((v) => status.version ?? v)
        // 回读缓存只铺状态，按钮本身就是「重启安装」，不必再弹一次
        if (!fromCache) toast.success(`新版本 ${status.version ?? ''} 已下载完成，可重启安装`)
        break
      case 'error':
        downloadingRef.current = false
        setChecking(false)
        setProgress(null)
        setUpdateState('unknown')
        // 启动/后台那几次静默检查失败不该在进页时补一刀，只有刚点过的动作才报
        if (!fromCache) toast.error(describeUpdateError(status.message))
        break
    }
  }, [])

  // ===== 订阅主进程更新状态事件 =====
  useEffect(() => {
    const dispose = window.electronAPI?.onUpdateStatus?.(applyUpdateStatus)
    return () => dispose?.()
  }, [applyUpdateStatus])

  // ===== 检查更新 =====
  const handleCheckUpdate = useCallback(async () => {
    if (checking) return
    setChecking(true)
    try {
      const result = await window.electronAPI.update.check()
      if (!result.supported) {
        // dev 环境降级：GitHub Releases API 比对 + 打开下载页
        setUpdaterSupported(false)
        try {
          const res = await fetch(GITHUB_RELEASES_API, {
            headers: { Accept: 'application/vnd.github+json' },
          })
          if (res.status === 403 || res.status === 429) {
            throw new Error('GitHub API 速率限制，请稍后再试')
          }
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = (await res.json()) as { tag_name?: string }
          const latestTag = (data.tag_name ?? '').trim()
          if (latestTag && latestTag !== APP_META.version) {
            setUpdateState('outdated')
            setLatestVersion(latestTag)
            toast.success(`发现新版本 ${latestTag}，即将打开下载页面`)
            await window.electronAPI.system.openExternal(GITHUB_RELEASES_PAGE)
          } else {
            setUpdateState('latest')
            toast.success('当前已是最新版本')
          }
        } catch (err) {
          toast.error(describeUpdateError((err as Error).message))
        } finally {
          setChecking(false)
        }
        return
      }
      // 打包环境的失败由 onUpdateStatus 的 error 事件报（electron-updater 先 emit 再 reject），
      // 这里只收尾状态 —— 两处都弹同一个错会叠成两条提示。
      if (result.error) {
        setChecking(false)
        return
      }
      // 正常路径：结果以 onUpdateStatus 事件为准（checking → available / not-available）
      if (result.updateAvailable === false) {
        setChecking(false)
        setUpdateState('latest')
        toast.success('当前已是最新版本')
      }
      // updateAvailable=true 时等 available 事件落地，checking 由事件关闭
    } catch (err) {
      setChecking(false)
      toast.error(describeUpdateError((err as Error).message))
    }
  }, [checking])

  // ===== 进页补一次检查 =====
  /**
   * 主进程启动时静默查过一次，但那时本页还没挂载、事件推过来没人接（错过不补）。
   * 所以：缓存里有结果就直接呈现；没有再自动查一次。
   * 开发环境不自动查 —— 那里的降级通路会直接打开浏览器下载页，不该由页面挂载触发。
   */
  const didAutoCheckRef = useRef(false)
  useEffect(() => {
    if (didAutoCheckRef.current) return
    didAutoCheckRef.current = true
    void (async () => {
      const cached = await window.electronAPI?.update?.getStatus?.().catch(() => null)
      if (!cached) return
      if (cached.status) {
        applyUpdateStatus(cached.status, true)
        return
      }
      if (cached.supported) void handleCheckUpdate()
    })()
  }, [applyUpdateStatus, handleCheckUpdate])

  // ===== 下载更新 =====
  const handleDownloadUpdate = useCallback(async () => {
    if (downloadingRef.current) return
    downloadingRef.current = true
    setUpdateState('downloading')
    setProgress({ percent: 0, transferredMb: 0, totalMb: 0 })
    // 失败提示统一由 onUpdateStatus 的 error 事件给（electron-updater 先 emit 再 reject），
    // 这里只把界面退回「有新版本」让用户能重试，不重复弹一条
    try {
      const result = await window.electronAPI.update.download()
      if (result.error) {
        downloadingRef.current = false
        setUpdateState('available')
        setProgress(null)
      }
      // 成功路径由 onUpdateStatus 的 downloading/downloaded 事件推进
    } catch (err) {
      downloadingRef.current = false
      setUpdateState('available')
      setProgress(null)
      toast.error(describeUpdateError((err as Error).message))
    }
  }, [])

  // ===== 重启安装 =====
  const handleInstallUpdate = useCallback(async () => {
    try {
      const result = await window.electronAPI.update.install()
      if (result.error) {
        toast.error(`安装失败: ${result.error}`)
      }
      // 成功则应用立即退出进入安装，无需后续处理
    } catch (err) {
      toast.error(`安装失败: ${(err as Error).message}`)
    }
  }, [])

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
                <BrandMark size={64} />
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
                    variant={updateState === 'available' || updateState === 'outdated' ? 'alert' : updateState === 'latest' || updateState === 'downloaded' ? 'success' : 'default'}
                    style={{
                      background:
                        updateState === 'latest' || updateState === 'downloaded'
                          ? 'var(--state-success)'
                          : updateState === 'available' || updateState === 'outdated'
                            ? 'var(--chart-2, #ef4444)'
                            : 'var(--muted)',
                      color: updateState === 'latest' || updateState === 'downloaded' || updateState === 'available' || updateState === 'outdated' ? 'var(--card)' : 'var(--muted-foreground)',
                      fontSize: '0.78rem',
                      padding: '0.3rem 0.65rem',
                      fontWeight: 600,
                    }}
                  >
                    {updateState === 'latest'
                      ? '已是最新版本'
                      : updateState === 'available' || updateState === 'outdated'
                        ? `有新版本 ${latestVersion}`
                        : updateState === 'downloading'
                          ? `下载中 ${progress?.percent ?? 0}%`
                          : updateState === 'downloaded'
                            ? '已下载，待安装'
                            : '尚未检查'}
                  </Badge>
                  {updateState === 'available' ? (
                    <Button variant="primary" data-dom-id="cta-download-update" onClick={handleDownloadUpdate}>
                      下载更新
                    </Button>
                  ) : updateState === 'downloaded' ? (
                    <Button variant="primary" data-dom-id="cta-install-update" onClick={handleInstallUpdate}>
                      重启安装
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      data-dom-id="cta-check-update"
                      disabled={checking || updateState === 'downloading'}
                      onClick={handleCheckUpdate}
                    >
                      {checking ? '检查中...' : updateState === 'downloading' ? '下载中...' : '检查更新'}
                    </Button>
                  )}
                </div>
              </div>

              {/* 下载进度条（仅下载中显示） */}
              {updateState === 'downloading' && progress && (
                <div
                  className="update-progress"
                  style={{
                    marginTop: 'calc(var(--spacing) * -2)',
                    marginBottom: 'calc(var(--spacing) * 4)',
                  }}
                >
                  <div
                    role="progressbar"
                    aria-valuenow={progress.percent}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    style={{
                      height: 6,
                      borderRadius: 999,
                      background: 'var(--muted)',
                      overflow: 'hidden',
                    }}
                  >
                    <div
                      style={{
                        width: `${progress.percent}%`,
                        height: '100%',
                        background: 'var(--primary)',
                        transition: 'width 0.3s ease',
                      }}
                    />
                  </div>
                  <div
                    style={{
                      marginTop: '0.35rem',
                      fontSize: '0.78rem',
                      color: 'var(--muted-foreground)',
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    {progress.transferredMb} MB / {progress.totalMb} MB（{progress.percent}%）
                  </div>
                </div>
              )}

              {!updaterSupported && (
                <div
                  style={{
                    marginTop: 'calc(var(--spacing) * -2)',
                    marginBottom: 'calc(var(--spacing) * 4)',
                    fontSize: '0.78rem',
                    color: 'var(--muted-foreground)',
                  }}
                >
                  开发环境不支持应用内更新，已降级为网页比对；打包安装版可在应用内一键更新。
                </div>
              )}

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
                      <div style={{ marginBottom: '0.5rem' }}>{entry.notes}</div>
                      {entry.details && entry.details.length > 0 && (
                        <ul
                          style={{
                            margin: 0,
                            paddingLeft: '1.1rem',
                            // Tailwind preflight 把 ul 的 list-style 清了，圆点得自己写回来
                            listStyleType: 'disc',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '0.3rem',
                          }}
                        >
                          {entry.details.map((detail, idx) => (
                            <li key={idx} style={{ lineHeight: 1.6 }}>{detail}</li>
                          ))}
                        </ul>
                      )}
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
