/** 数据与存储页的常量、类型与纯工具（从 SettingsData.tsx 原样搬出，逻辑未改） */
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

export interface NavItem {
  key: string
  label: string
  icon: 'user' | 'settings' | 'bookshelf' | 'box' | 'sun' | 'question'
  path: string
  domId: string
}

export const NAV_ITEMS: NavItem[] = [
  { key: 'account', label: '账户', icon: 'user', path: '/settings/account', domId: 'settings-tab-account' },
  { key: 'ai', label: 'AI配置', icon: 'settings', path: '/settings/ai', domId: 'settings-tab-ai' },
  { key: 'agent', label: '智能体编排', icon: 'settings', path: '/settings/agent', domId: 'settings-tab-agent' },
  { key: 'weread', label: '微信读书', icon: 'bookshelf', path: '/settings/weread', domId: 'settings-tab-weread' },
  { key: 'data', label: '数据与存储', icon: 'box', path: '/settings/data', domId: 'settings-tab-data' },
  { key: 'appearance', label: '外观', icon: 'sun', path: '/settings/appearance', domId: 'settings-tab-appearance' },
  { key: 'about', label: '关于', icon: 'question', path: '/settings/about', domId: 'settings-tab-about' },
]

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

export function asNumber(v: unknown, fallback: number): number {
  if (typeof v === 'number' && !Number.isNaN(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    if (!Number.isNaN(n)) return n
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

/** 格式化"X 天前" */
export function formatDaysAgo(isoTs: string): string {
  if (!isoTs) return '尚未导出'
  const ms = Date.now() - new Date(isoTs).getTime()
  if (ms < 0) return '刚刚'
  const days = Math.floor(ms / 86400000)
  if (days <= 0) return '今天'
  if (days === 1) return '1 天前'
  return `${days} 天前`
}
