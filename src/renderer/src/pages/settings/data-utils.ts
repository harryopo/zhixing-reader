/**
 * 设置页共用的常量、类型与纯工具（原先从 SettingsData.tsx 原样搬出，逻辑未改）。
 *
 * 2026-10-18 起这里同时是**设置页那一排分区导航的唯一一份**：六个子页原先各抄一份
 * `SETTINGS_NAV_ITEMS`，抄到标签（`AI配置` / `AI 配置`）、图标（`user` / `profile`）与
 * 锚点（子页自己那一格的 `domId` 干脆没有）三样都分家 —— 各页只声明"我是哪一格"。
 */
import type { IconName } from '@/components/ui/Icon'

export const FSRS_DEFAULTS = {
  level: 3,
  maxInterval: 365,
} as const

/** FSRS 参数配置里新增的「每日学习量」默认值（与 src/shared/study-limits.ts 保持一致） */
export const DEFAULT_NEW_CARDS_PER_DAY = 15

/**
 * 真实的存储用量（字节）。
 *
 * 2026-09-16 修正：这里原来是 `MOCK_DB_MB = 12.3` / `MOCK_CACHE_MB = 45.2` /
 * `MOCK_VECTOR_MB = 128.5` 三个**写死的常量**，界面上当成真数据显示，旁边还放了个
 * 「刷新用量」按钮 —— 点了永远不变。现在改为向主进程要真实文件大小；
 * 量不出来就显示「—」，**不编数字**。
 */
export interface StorageUsage {
  dbBytes: number | null
  vectorBytes: number | null
  logBytes: number | null
}

/**
 * 字节 → 人看的文本；null 表示量不出来。
 * 小于 0.1 MB 的用 KB 显示 —— 否则向量索引这种"确实有但很小"的目录会显示成 0.0 MB，
 * 看起来像统计坏了。
 */
export function formatSize(bytes: number | null): { value: string; unit: string } {
  if (bytes === null || !Number.isFinite(bytes)) return { value: '—', unit: '' }
  if (bytes < 1024 * 100) return { value: (bytes / 1024).toFixed(1), unit: 'KB' }
  return { value: (bytes / 1024 / 1024).toFixed(1), unit: 'MB' }
}

/** 设置页那一排分区的键（`settingsNav` 的参数；写错一个字母编译不过） */
export type SettingsTabKey = 'account' | 'ai' | 'agent' | 'weread' | 'data' | 'appearance' | 'about'

export interface NavItem {
  key: SettingsTabKey
  label: string
  /** 直接吃 `Icon` 那份名字表：写错一个图标名是编译错误，而不是界面上悄悄少一个图形 */
  icon: IconName
  path: string
  /** 每一格都必须是 `settings-tab-<key>`：少了它，那一页上就没有这个锚点 */
  domId: string
}

/** 设置页那七个分区 —— **这一份就是那份**（六个页面原先各抄一份，抄到标签、图标、锚点三样都分家了） */
export const NAV_ITEMS: NavItem[] = [
  { key: 'account', label: '账户', icon: 'profile', path: '/settings/account', domId: 'settings-tab-account' },
  { key: 'ai', label: 'AI 配置', icon: 'settings', path: '/settings/ai', domId: 'settings-tab-ai' },
  { key: 'agent', label: '智能体编排', icon: 'settings', path: '/settings/agent', domId: 'settings-tab-agent' },
  { key: 'weread', label: '微信读书', icon: 'bookshelf', path: '/settings/weread', domId: 'settings-tab-weread' },
  { key: 'data', label: '数据与存储', icon: 'box', path: '/settings/data', domId: 'settings-tab-data' },
  { key: 'appearance', label: '外观', icon: 'sun', path: '/settings/appearance', domId: 'settings-tab-appearance' },
  { key: 'about', label: '关于', icon: 'question', path: '/settings/about', domId: 'settings-tab-about' },
]

/**
 * 每页只声明"我是哪一格"，其余（标签 / 图标 / 路径 / 锚点）一律交回上面那一份。
 *
 * 原先六份抄件各自漏掉**自己那一格**的 `domId`（About / Account / Appearance 三页如此），
 * 于是 `data-dom-id={item.domId}` 渲染出的是"这个属性不存在" —— 恰恰是你正站着的那一格找不到。
 * `SettingsAgent` 里那句 `item.domId ?? \`settings-tab-${item.key}\`` 就是这个症状的本地止痛药。
 */
export function settingsNav(active: SettingsTabKey): Array<NavItem & { active: boolean }> {
  return NAV_ITEMS.map((item) => ({ ...item, active: item.key === active }))
}

export interface KpiStats {
  totalBooks: number
  totalHighlights: number
  totalCards: number
}

export interface IoItemDef {
  id: string
  title: string
  desc: string
  formatBadge: string
  formatBadgeTone: 'neutral' | 'info'
  statusText: string
  statusTone: 'success' | 'neutral'
  buttonLabel: string
  buttonVariant: 'primary' | 'secondary'
  domId: string
  onClick: () => void
}

// ===== 安全读取辅助 =====

export function asString(v: unknown, fallback: string): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback
}

/**
 * 安全地把后端交回的值读成一个数，读不出（缺、空串、脏、非有限）一律回 fallback。
 *
 * 两道闸门各有各的成因：
 *  - **空串与纯空白**：`Number('')` 是 0 —— 生词的 `ef_factor` 2.5 当年就是这么被刷成 0 的；
 *  - **`Infinity` / `'1e400'`**：这类值能过 `isNaN`，但落进设置项就是把上限撑爆，
 *    与 `formatReadingTime` 那批同一条规矩（用 `Number.isFinite`，不用 `!isNaN`）。
 */
export function asNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number') return Number.isFinite(v) ? v : fallback
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return fallback
}

/** 请求级别 (1-10) → FSRS requestRetention (0.70-0.95) */
export function levelToRetention(level: number): number {
  const clamped = Math.max(1, Math.min(10, level))
  return 0.7 + ((clamped - 1) * (0.95 - 0.7)) / 9
}

/** 触发浏览器下载 */
export function downloadBlob(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 释放 URL，避免内存泄漏
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

/** 格式化"X 天前"；读不出时刻说"未知"，不许画成「NaN 天前」（与 formatReadingTime 那条同一规矩） */
export function formatDaysAgo(isoTs: string): string {
  if (!isoTs) return '尚未导出'
  const at = new Date(isoTs).getTime()
  if (Number.isNaN(at)) return '未知'
  const ms = Date.now() - at
  if (ms < 0) return '刚刚'
  const days = Math.floor(ms / 86400000)
  if (days <= 0) return '今天'
  if (days === 1) return '1 天前'
  return `${days} 天前`
}
