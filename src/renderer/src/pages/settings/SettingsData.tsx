/**
 * SettingsData — 数据与存储（Google Design Library 1:1 重构）
 * 基于设计稿 zhixing-reader-redesign/pages/settings-data.html
 * 5 张卡片：存储用量看板 / 缓存管理 / 数据导入导出 / FSRS 参数配置 / 危险操作
 * 业务逻辑：
 *   - FSRS 参数：fsrs.getParameters / setParameters / resetParameters（IPC 已暴露）
 *   - FSRS UI 值（level/decay/maxInterval）：settings.get / set 持久化
 *   - KPI 计数：admin.getStats 拉取 totalBooks/totalHighlights/totalCards
 *   - 数据导出：本地拼装 JSON/Markdown/CSV 并触发浏览器下载
 *   - 数据导入：文件选择器 + JSON 解析 + 逐条 create
 *   - 清理缓存：system.clearCache（清微信读书 API 内存缓存）
 *   - 历史/向量索引/重置 DB：无安全全量接口，保留诚实 toast
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHero from '@/components/layout/PageHero'
import Card, { CardHead } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Icon from '@/components/ui/Icon'
import { Loading, Tiny } from '@/components/ui/Feedback'
import { toast } from '@/stores/toastStore'
import { safeNum } from '@/utils/db-mapper'

// ===== 常量 =====

const FSRS_DEFAULTS = {
  level: 3,
  decay: 0.2,
  maxInterval: 365,
} as const

const STORAGE_CAP_MB = 512
const MOCK_DB_MB = 12.3
const MOCK_CACHE_MB = 45.2
const MOCK_VECTOR_MB = 128.5

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
  { key: 'weread', label: '微信读书', icon: 'bookshelf', path: '/settings/weread', domId: 'settings-tab-weread' },
  { key: 'data', label: '数据与存储', icon: 'box', path: '/settings/data', domId: 'settings-tab-data' },
  { key: 'appearance', label: '外观', icon: 'sun', path: '/settings/appearance', domId: 'settings-tab-appearance' },
  { key: 'about', label: '关于', icon: 'question', path: '/settings/about', domId: 'settings-tab-about' },
]

interface KpiStats {
  totalBooks: number
  totalHighlights: number
  totalCards: number
}

interface IoItemDef {
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

/** 请求级别 (1-10) → FSRS requestRetention (0.70-0.95) */
function levelToRetention(level: number): number {
  const clamped = Math.max(1, Math.min(10, level))
  return 0.7 + ((clamped - 1) * (0.95 - 0.7)) / 9
}

/** 触发浏览器下载 */
function downloadBlob(filename: string, content: string, mime: string): void {
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
function formatDaysAgo(isoTs: string): string {
  if (!isoTs) return '尚未导出'
  const ms = Date.now() - new Date(isoTs).getTime()
  if (ms < 0) return '刚刚'
  const days = Math.floor(ms / 86400000)
  if (days <= 0) return '今天'
  if (days === 1) return '1 天前'
  return `${days} 天前`
}

/** CSV 字段转义 */
function csvEscape(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v)
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

// ===== 组件 =====

export default function SettingsData() {
  const navigate = useNavigate()

  // ===== FSRS UI 参数 =====
  const [fsrsLevel, setFsrsLevel] = useState<number>(FSRS_DEFAULTS.level)
  const [fsrsDecay, setFsrsDecay] = useState<number>(FSRS_DEFAULTS.decay)
  const [fsrsMaxInterval, setFsrsMaxInterval] = useState<number>(FSRS_DEFAULTS.maxInterval)
  const [fsrsDirty, setFsrsDirty] = useState<boolean>(false)
  const [fsrsSaving, setFsrsSaving] = useState<boolean>(false)

  // ===== KPI 与用量数据 =====
  const [loading, setLoading] = useState<boolean>(true)
  const [kpiStats, setKpiStats] = useState<KpiStats>({ totalBooks: 0, totalHighlights: 0, totalCards: 0 })
  const [lastExportAt, setLastExportAt] = useState<string>('')

  // ===== 拉取 FSRS 参数 + UI 值 =====
  useEffect(() => {
    const loadFsrs = async () => {
      const api = window.electronAPI
      if (!api) return
      try {
        // 1. UI 值（settings.get）
        const [lv, dc, mi, lastExp] = await Promise.all([
          api.settings.get('fsrsRequestLevel'),
          api.settings.get('fsrsDifficultyDecay'),
          api.settings.get('fsrsMaxInterval'),
          api.settings.get('lastDataExportAt'),
        ])
        const level = asNumber(lv, FSRS_DEFAULTS.level)
        const decay = asNumber(dc, FSRS_DEFAULTS.decay)
        const maxInterval = asNumber(mi, FSRS_DEFAULTS.maxInterval)
        setFsrsLevel(level)
        setFsrsDecay(decay)
        setFsrsMaxInterval(maxInterval)
        setLastExportAt(asString(lastExp, ''))
        // 2. 引擎实际状态（fsrs.getParameters）— 校准 maxInterval 与引擎一致
        try {
          const params = (await api.fsrs.getParameters()) as Record<string, unknown>
          const engineMax = asNumber(params.maximumInterval, maxInterval)
          if (engineMax !== maxInterval) {
            setFsrsMaxInterval(engineMax)
          }
        } catch {
          /* 静默：保持 UI 值 */
        }
      } catch {
        /* 静默：保持默认值 */
      }
    }
    loadFsrs()
  }, [])

  // ===== 拉取 KPI 统计 =====
  useEffect(() => {
    const loadStats = async () => {
      const api = window.electronAPI
      if (!api?.admin?.getStats) {
        setLoading(false)
        return
      }
      try {
        const result = (await api.admin.getStats()) as { stats?: Record<string, unknown> }
        const s = result.stats ?? {}
        setKpiStats({
          totalBooks: safeNum(s.totalBooks),
          totalHighlights: safeNum(s.totalHighlights),
          totalCards: safeNum(s.totalCards),
        })
      } catch {
        /* 静默：保持 0 */
      } finally {
        setLoading(false)
      }
    }
    loadStats()
  }, [])

  // ===== 刷新用量 =====
  const handleRefreshUsage = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.admin?.getStats) {
      toast.error('API 未正确初始化，请重启应用')
      return
    }
    const tId = toast.loading('正在刷新用量数据...')
    try {
      const result = (await api.admin.getStats()) as { stats?: Record<string, unknown> }
      const s = result.stats ?? {}
      setKpiStats({
        totalBooks: safeNum(s.totalBooks),
        totalHighlights: safeNum(s.totalHighlights),
        totalCards: safeNum(s.totalCards),
      })
      toast.remove(tId)
      toast.success('用量数据已刷新')
    } catch (err) {
      toast.remove(tId)
      toast.error(`刷新失败: ${(err as Error).message}`)
    }
  }, [])

  // ===== FSRS 字段变更（标记 dirty） =====
  const handleChangeLevel = useCallback((v: number) => {
    setFsrsLevel(v)
    setFsrsDirty(true)
  }, [])
  const handleChangeDecay = useCallback((v: number) => {
    setFsrsDecay(v)
    setFsrsDirty(true)
  }, [])
  const handleChangeMaxInterval = useCallback((v: number) => {
    setFsrsMaxInterval(v)
    setFsrsDirty(true)
  }, [])

  // ===== 保存 FSRS 参数 =====
  const handleSaveFsrs = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.fsrs?.setParameters || !api?.settings?.set) {
      toast.error('API 未正确初始化，请重启应用')
      return
    }
    setFsrsSaving(true)
    const tId = toast.loading('正在保存 FSRS 参数...')
    try {
      await Promise.all([
        api.settings.set('fsrsRequestLevel', fsrsLevel),
        api.settings.set('fsrsDifficultyDecay', fsrsDecay),
        api.settings.set('fsrsMaxInterval', fsrsMaxInterval),
        api.fsrs.setParameters({
          requestRetention: levelToRetention(fsrsLevel),
          maximumInterval: fsrsMaxInterval,
        }),
      ])
      setFsrsDirty(false)
      toast.remove(tId)
      toast.success('FSRS 参数已保存')
    } catch (err) {
      toast.remove(tId)
      toast.error(`保存失败: ${(err as Error).message}`)
    } finally {
      setFsrsSaving(false)
    }
  }, [fsrsLevel, fsrsDecay, fsrsMaxInterval])

  // ===== 重置 FSRS 参数 =====
  const handleResetFsrs = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.fsrs?.resetParameters) {
      toast.error('API 未正确初始化，请重启应用')
      return
    }
    const tId = toast.loading('正在重置 FSRS 参数...')
    try {
      await api.fsrs.resetParameters()
      setFsrsLevel(FSRS_DEFAULTS.level)
      setFsrsDecay(FSRS_DEFAULTS.decay)
      setFsrsMaxInterval(FSRS_DEFAULTS.maxInterval)
      setFsrsDirty(false)
      toast.remove(tId)
      toast.success('已恢复 FSRS 默认参数')
    } catch (err) {
      toast.remove(tId)
      toast.error(`重置失败: ${(err as Error).message}`)
    }
  }, [])

  // ===== 导出全部数据（JSON） =====
  const handleExportAll = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.book?.getAll || !api?.highlight?.getAll || !api?.card?.getDue) {
      toast.error('API 未正确初始化，请重启应用')
      return
    }
    const tId = toast.loading('正在导出全部数据...')
    try {
      const [books, highlights] = await Promise.all([
        api.book.getAll(),
        api.highlight.getAll(),
      ])
      // 卡片按书聚合（无 getAll 接口，按 books 收集）
      const cardsPerBook = await Promise.all(
        (books as Array<{ id: string }>).map((b) =>
          api.card.getByBook(b.id).catch(() => []),
        ),
      )
      const cards = cardsPerBook.flat()
      const payload = {
        version: '1.0',
        exportedAt: new Date().toISOString(),
        books,
        highlights,
        cards,
      }
      const filename = `zhixing-backup-${new Date().toISOString().split('T')[0]}.json`
      downloadBlob(filename, JSON.stringify(payload, null, 2), 'application/json')
      // 记录导出时间
      const nowIso = new Date().toISOString()
      setLastExportAt(nowIso)
      try {
        await api.settings.set('lastDataExportAt', nowIso)
      } catch {
        /* 非致命 */
      }
      toast.remove(tId)
      toast.success(`已导出 ${books.length} 本书 / ${highlights.length} 条划线 / ${cards.length} 张卡片`)
    } catch (err) {
      toast.remove(tId)
      toast.error(`导出失败: ${(err as Error).message}`)
    }
  }, [])

  // ===== 导出笔记（Markdown，兼容 Obsidian） =====
  const handleExportNotes = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.book?.getAll || !api?.highlight?.getAll) {
      toast.error('API 未正确初始化，请重启应用')
      return
    }
    const tId = toast.loading('正在导出笔记...')
    try {
      const [books, highlights] = await Promise.all([
        api.book.getAll(),
        api.highlight.getAll(),
      ])
      const bookMap = new Map<string, { title: string; author: string }>(
        (books as Array<{ id: string; title: string; author: string }>).map((b) => [b.id, { title: b.title, author: b.author }]),
      )
      // 按书分组
      const grouped = new Map<string, Array<{ content: string; note?: string; createdAt?: unknown }>>()
      for (const h of (highlights as Array<{ bookId: string; content: string; note?: string; createdAt?: unknown }>) ?? []) {
        const list = grouped.get(h.bookId) ?? []
        list.push(h)
        grouped.set(h.bookId, list)
      }
      const lines: string[] = ['# 知行读书笔记导出', '']
      for (const [bookId, hs] of grouped.entries()) {
        const book = bookMap.get(bookId)
        lines.push(`## ${book?.title ?? '未知书名'}`)
        if (book?.author) lines.push(`*作者：${book.author}*`)
        lines.push('')
        for (const h of hs) {
          lines.push(`> ${h.content}`)
          if (h.note) lines.push('', `**笔记：** ${h.note}`)
          lines.push('')
        }
        lines.push('---', '')
      }
      const filename = `zhixing-notes-${new Date().toISOString().split('T')[0]}.md`
      downloadBlob(filename, lines.join('\n'), 'text/markdown')
      toast.remove(tId)
      toast.success(`已导出 ${grouped.size} 本书 / ${highlights.length} 条笔记`)
    } catch (err) {
      toast.remove(tId)
      toast.error(`导出失败: ${(err as Error).message}`)
    }
  }, [])

  // ===== 导出复习数据（CSV） =====
  const handleExportReview = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.review?.getRecent) {
      toast.error('API 未正确初始化，请重启应用')
      return
    }
    const tId = toast.loading('正在导出复习数据...')
    try {
      // 拉取最近 1000 条复习记录（够分析用）
      // 注：先转 unknown 再断言为 Record<string, unknown>[]，TS 官方推荐的 double assertion 模式
      const reviews = (await api.review.getRecent(1000)) as unknown as Array<Record<string, unknown>>
      const header = ['review_id', 'card_id', 'quality', 'ease_factor', 'interval', 'reviewed_at']
      const rows = reviews.map((r) => [
        r.id,
        r.cardId,
        r.quality,
        r.easeFactor,
        r.interval,
        r.reviewedAt,
      ].map(csvEscape).join(','))
      const csv = [header.join(','), ...rows].join('\n')
      const filename = `zhixing-reviews-${new Date().toISOString().split('T')[0]}.csv`
      // 加 BOM 让 Excel 正确识别 UTF-8
      downloadBlob(filename, '\uFEFF' + csv, 'text/csv')
      toast.remove(tId)
      toast.success(`已导出 ${reviews.length} 条复习记录`)
    } catch (err) {
      toast.remove(tId)
      toast.error(`导出失败: ${(err as Error).message}`)
    }
  }, [])

  // ===== 导入数据（JSON 文件选择 + 逐条 create） =====
  const handleImportData = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.book?.create || !api?.highlight?.create) {
      toast.error('API 未正确初始化，请重启应用')
      return
    }
    // 创建隐藏的 file input 触发选择
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json,application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const tId = toast.loading(`正在导入 ${file.name}...`)
      try {
        const text = await file.text()
        const data = JSON.parse(text) as {
          books?: Array<Record<string, unknown>>
          highlights?: Array<Record<string, unknown>>
          cards?: Array<Record<string, unknown>>
        }
        let bookCount = 0
        let highlightCount = 0
        // 逐条创建书籍
        for (const b of data.books ?? []) {
          try {
            await api.book.create(b)
            bookCount++
          } catch {
            /* 跳过冲突记录 */
          }
        }
        // 逐条创建划线
        for (const h of data.highlights ?? []) {
          try {
            await api.highlight.create(h)
            highlightCount++
          } catch {
            /* 跳过冲突记录 */
          }
        }
        toast.remove(tId)
        toast.success(`已导入 ${bookCount} 本书 / ${highlightCount} 条划线`)
        // 触发 KPI 刷新
        try {
          const result = (await api.admin.getStats()) as { stats?: Record<string, unknown> }
          const s = result.stats ?? {}
          setKpiStats({
            totalBooks: safeNum(s.totalBooks),
            totalHighlights: safeNum(s.totalHighlights),
            totalCards: safeNum(s.totalCards),
          })
        } catch {
          /* 非致命 */
        }
      } catch (err) {
        toast.remove(tId)
        toast.error(`导入失败: ${(err as Error).message}`)
      }
    }
    input.click()
  }, [])

  // ===== 清理缓存（真实 IPC）/ 历史·向量·重置（无安全全量接口） =====
  const handleClearCache = useCallback(async () => {
    if (!window.electronAPI?.system?.clearCache) {
      toast.error('清理缓存接口不可用')
      return
    }
    try {
      await window.electronAPI.system.clearCache()
      // 顺带落盘，避免用户误以为“清缓存=丢数据”
      try {
        await window.electronAPI.system.forceSaveDatabase?.()
      } catch {
        /* 非致命 */
      }
      toast.success('已清理微信读书 API 内存缓存')
    } catch (err) {
      toast.error(`清理缓存失败: ${(err as Error).message}`)
    }
  }, [])

  // ===== 清理历史记录（二次确认 + 调 system.clearHistory） =====
  const handleClearHistory = useCallback(async () => {
    if (!window.electronAPI?.system?.clearHistory) {
      toast.error('清理历史记录接口不可用')
      return
    }
    // 二次确认：第一次确认（按钮已点击）→ 第二次确认（confirm 弹窗）
    if (!window.confirm('确定清理所有对话历史记录？此操作将删除全部 conversations 和 chat_messages，且不可撤销。')) {
      return
    }
    const tId = toast.loading('正在清理历史记录...')
    try {
      await window.electronAPI.system.clearHistory()
      toast.remove(tId)
      toast.success('已清理全部对话历史记录')
      // 刷新 KPI（虽然历史记录不进 KPI，但保持数据一致性）
      try {
        const result = (await window.electronAPI.admin.getStats()) as { stats?: Record<string, unknown> }
        const s = result.stats ?? {}
        setKpiStats({
          totalBooks: safeNum(s.totalBooks),
          totalHighlights: safeNum(s.totalHighlights),
          totalCards: safeNum(s.totalCards),
        })
      } catch {
        /* 非致命 */
      }
    } catch (err) {
      toast.remove(tId)
      toast.error(`清理失败: ${(err as Error).message}`)
    }
  }, [])

  // ===== 清理向量索引：跳转到管理面板手动配置 Qdrant =====
  const handleClearVector = useCallback(() => {
    navigate('/admin')
  }, [navigate])

  // ===== 重置数据库（三次确认 + 调 system.resetDatabase，主进程会自动重启 app） =====
  const handleResetDb = useCallback(async () => {
    if (!window.electronAPI?.system?.resetDatabase) {
      toast.error('数据库重置接口不可用')
      return
    }
    // 三次确认：第 1 次 — 警告数据将丢失
    if (!window.confirm('⚠️ 危险操作：此操作将清空本地数据库的全部业务表（书籍、笔记、卡片、对话、记忆等），且不可撤销。\n\n是否继续？')) {
      return
    }
    // 三次确认：第 2 次 — 要求确认已导出备份
    if (!window.confirm('请确认您已导出数据备份。重置后所有本地数据将永久丢失。\n\n点击"确定"表示您已备份或确认无需备份。')) {
      return
    }
    // 三次确认：第 3 次 — 最终确认
    if (!window.confirm('最后一次确认：立即重置数据库？应用将在重置后自动重启。')) {
      return
    }
    const tId = toast.loading('正在重置数据库，应用即将重启...')
    try {
      await window.electronAPI.system.resetDatabase()
      // 主进程会在 500ms 后 app.relaunch() + app.exit(0)，前端无需额外处理
      // 此处 toast 不 remove，让用户看到"正在重启"提示直至进程退出
    } catch (err) {
      toast.remove(tId)
      toast.error(`重置失败: ${(err as Error).message}`)
    }
  }, [])

  // ===== 派生值 =====
  const totalUsageMb = useMemo(
    () => MOCK_DB_MB + MOCK_CACHE_MB + MOCK_VECTOR_MB,
    [],
  )
  const usagePct = useMemo(
    () => Math.min(100, Math.round((totalUsageMb / STORAGE_CAP_MB) * 100)),
    [totalUsageMb],
  )
  const totalRecords = useMemo(
    () => kpiStats.totalBooks + kpiStats.totalHighlights + kpiStats.totalCards,
    [kpiStats],
  )
  const exportBadgeText = useMemo(() => formatDaysAgo(lastExportAt), [lastExportAt])

  // io-grid 4 项定义
  const ioItems: IoItemDef[] = useMemo(
    () => [
      {
        id: 'export-all',
        title: '导出全部数据',
        desc: '完整备份 · 含书架、笔记、卡片',
        formatBadge: 'JSON',
        formatBadgeTone: 'neutral',
        statusText: '就绪',
        statusTone: 'success',
        buttonLabel: '导出全部',
        buttonVariant: 'primary',
        domId: 'cta-export-all',
        onClick: handleExportAll,
      },
      {
        id: 'export-notes',
        title: '导出笔记',
        desc: '划线与笔记 · 兼容 Obsidian',
        formatBadge: 'Markdown',
        formatBadgeTone: 'neutral',
        statusText: '就绪',
        statusTone: 'success',
        buttonLabel: '导出笔记',
        buttonVariant: 'secondary',
        domId: 'cta-export-notes',
        onClick: handleExportNotes,
      },
      {
        id: 'export-review',
        title: '导出复习数据',
        desc: 'FSRS 调度记录 · 可表格分析',
        formatBadge: 'CSV',
        formatBadgeTone: 'neutral',
        statusText: '就绪',
        statusTone: 'success',
        buttonLabel: '导出复习',
        buttonVariant: 'secondary',
        domId: 'cta-export-review',
        onClick: handleExportReview,
      },
      {
        id: 'import-data',
        title: '导入数据',
        desc: '从 JSON 备份恢复 · 自动合并',
        formatBadge: '文件选择',
        formatBadgeTone: 'info',
        statusText: '待选择',
        statusTone: 'neutral',
        buttonLabel: '选择文件',
        buttonVariant: 'secondary',
        domId: 'cta-import-data',
        onClick: handleImportData,
      },
    ],
    [handleExportAll, handleExportNotes, handleExportReview, handleImportData],
  )

  if (loading) {
    return <Loading hint="正在加载数据与存储信息..." />
  }

  return (
    <>
      <PageHero
        title="数据与存储"
        subtitle="管理本地数据库、缓存与复习算法参数"
        actions={
          <Button variant="ghost" onClick={handleRefreshUsage} data-dom-id="cta-refresh-usage">
            <Icon name="refresh" size={16} />
            刷新用量
          </Button>
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
                data-active={item.key === 'data'}
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
            {/* ===== Card A: 存储用量看板 ===== */}
            <Card>
              <CardHead
                eyebrow="数据与存储"
                title="存储用量看板"
                action={
                  <span className="status-badge info" role="status">
                    已占用 {usagePct}%
                  </span>
                }
              />
              <div
                className="usage-note"
                role="note"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 'calc(var(--spacing) * 2.5)',
                  padding: 'calc(var(--spacing) * 3.5)',
                  background: 'color-mix(in srgb, var(--state-info) 8%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--state-info) 28%, transparent)',
                  borderRadius: 'var(--radius)',
                  marginBottom: 'calc(var(--spacing) * 4)',
                  color: 'var(--foreground)',
                  fontSize: '0.82rem',
                  lineHeight: 1.6,
                }}
              >
                <span aria-hidden="true" style={{ color: 'var(--state-info)', flexShrink: 0, marginTop: 2 }}>
                  <Icon name="info" size={16} />
                </span>
                <span>
                  <strong>用途说明：</strong>
                  展示本地存储的三类占用：<strong>SQLite 数据库</strong>（书籍/笔记/卡片/对话等业务数据，运行于 sql.js WASM）/
                  <strong>缓存</strong>（微信读书 API 内存缓存与图片/网页临时文件）/<strong>向量库</strong>（Qdrant 索引，可选）。
                  KPI 计数通过 <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>admin.getStats</code> 实时拉取；
                  容量上限为设计稿默认值 512MB，仅作可视化参考，无硬性配额。
                </span>
              </div>
              <div
                className="kpi-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: 'calc(var(--spacing) * 4)',
                  marginBottom: 'calc(var(--spacing) * 5)',
                }}
              >
                <div className="kpi-card" data-accent="1">
                  <span className="kpi-accent" aria-hidden="true"></span>
                  <div className="eyebrow">数据库大小</div>
                  <span className="kpi-value">
                    {MOCK_DB_MB.toFixed(1)}
                    <span className="unit">MB</span>
                  </span>
                  <div className="tiny">SQLite · {totalRecords.toLocaleString('zh-CN')} 条记录</div>
                </div>
                <div className="kpi-card" data-accent="2">
                  <span className="kpi-accent" aria-hidden="true"></span>
                  <div className="eyebrow">缓存大小</div>
                  <span className="kpi-value">
                    {MOCK_CACHE_MB.toFixed(1)}
                    <span className="unit">MB</span>
                  </span>
                  <div className="tiny">图片 · 网页 · 临时文件</div>
                </div>
                <div className="kpi-card" data-accent="3">
                  <span className="kpi-accent" aria-hidden="true"></span>
                  <div className="eyebrow">向量库大小</div>
                  <span className="kpi-value">
                    {MOCK_VECTOR_MB.toFixed(1)}
                    <span className="unit">MB</span>
                  </span>
                  <div className="tiny">Qdrant · 索引尚未统计</div>
                </div>
              </div>
              <div className="usage-bar-wrap" style={{ marginTop: 'calc(var(--spacing) * 3)' }}>
                <div
                  className="usage-bar-head"
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 'calc(var(--spacing) * 3)',
                    marginBottom: 'calc(var(--spacing) * 2)',
                  }}
                >
                  <strong style={{ fontSize: '0.88rem', fontWeight: 600, color: 'var(--foreground)' }}>
                    总用量 / 容量上限
                  </strong>
                  <span
                    className="tiny"
                    style={{
                      fontFamily: 'var(--font-mono)',
                      color: 'var(--muted-foreground)',
                      fontSize: '0.78rem',
                    }}
                  >
                    {totalUsageMb.toFixed(1)} MB / {STORAGE_CAP_MB} MB
                  </span>
                </div>
                <div
                  className="usage-bar"
                  role="progressbar"
                  aria-valuenow={usagePct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="存储总用量"
                  style={{
                    width: '100%',
                    height: 8,
                    borderRadius: 999,
                    background: 'var(--muted)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    className="usage-bar-fill"
                    style={{
                      height: '100%',
                      width: `${usagePct}%`,
                      borderRadius: 999,
                      background: 'var(--chart-1)',
                      transition: 'width 0.3s ease',
                    }}
                  />
                </div>
              </div>
            </Card>

            {/* ===== Card B: 缓存管理 ===== */}
            <Card>
              <CardHead eyebrow="数据与存储" title="缓存管理" />
              <div
                className="usage-note"
                role="note"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 'calc(var(--spacing) * 2.5)',
                  padding: 'calc(var(--spacing) * 3.5)',
                  background: 'color-mix(in srgb, var(--state-info) 8%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--state-info) 28%, transparent)',
                  borderRadius: 'var(--radius)',
                  marginBottom: 'calc(var(--spacing) * 4)',
                  color: 'var(--foreground)',
                  fontSize: '0.82rem',
                  lineHeight: 1.6,
                }}
              >
                <span aria-hidden="true" style={{ color: 'var(--state-info)', flexShrink: 0, marginTop: 2 }}>
                  <Icon name="info" size={16} />
                </span>
                <span>
                  <strong>用途说明：</strong>
                  三类清理操作的差异化用途：<strong>清理缓存</strong>仅清除微信读书 API 内存缓存（请求结果），不删除本地数据，安全可常用；
                  <strong>清理历史记录</strong>删除全部对话记录（conversations + chat_messages 表），影响 AI 对话上下文，需二次确认；
                  <strong>清理向量索引</strong>跳转至管理面板手动操作 Qdrant，重建索引将临时影响 AI 检索能力。
                </span>
              </div>
              <div
                className="cache-rows"
                style={{ display: 'flex', flexDirection: 'column' }}
              >
                <div className="cache-row">
                  <div className="cache-row-info">
                    <strong>清理缓存</strong>
                    <Tiny>清除微信读书 API 内存缓存（请求结果），不删除本地书籍/笔记</Tiny>
                  </div>
                  <Button variant="secondary" onClick={handleClearCache} data-dom-id="cta-clear-cache">
                    清理缓存
                  </Button>
                </div>
                <div className="cache-row">
                  <div className="cache-row-info">
                    <strong>清理历史记录</strong>
                    <Tiny>操作日志与同步记录 · 共 1,284 条</Tiny>
                  </div>
                  <Button variant="secondary" onClick={handleClearHistory} data-dom-id="cta-clear-history">
                    清理历史
                  </Button>
                </div>
                <div className="cache-row">
                  <div className="cache-row-info">
                    <strong>清理向量索引</strong>
                    <Tiny>重建 Qdrant 索引将影响 AI 检索</Tiny>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'calc(var(--spacing) * 2)',
                      flexShrink: 0,
                    }}
                  >
                    <span className="status-badge warning">需重建</span>
                    <Button variant="ghost" onClick={handleClearVector} data-dom-id="cta-clear-vector">
                      清理向量
                    </Button>
                  </div>
                </div>
              </div>
            </Card>

            {/* ===== Card C: 数据导入导出 ===== */}
            <Card>
              <CardHead
                eyebrow="数据与存储"
                title="数据导入导出"
                action={
                  <span className="status-badge success" role="status">
                    最近导出 {exportBadgeText}
                  </span>
                }
              />
              <div
                className="usage-note"
                role="note"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 'calc(var(--spacing) * 2.5)',
                  padding: 'calc(var(--spacing) * 3.5)',
                  background: 'color-mix(in srgb, var(--state-info) 8%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--state-info) 28%, transparent)',
                  borderRadius: 'var(--radius)',
                  marginBottom: 'calc(var(--spacing) * 4)',
                  color: 'var(--foreground)',
                  fontSize: '0.82rem',
                  lineHeight: 1.6,
                }}
              >
                <span aria-hidden="true" style={{ color: 'var(--state-info)', flexShrink: 0, marginTop: 2 }}>
                  <Icon name="info" size={16} />
                </span>
                <span>
                  <strong>用途说明：</strong>
                  四种导入导出格式的差异化用途：<strong>导出全部数据</strong>（JSON）= 完整备份书架/笔记/卡片，可用于跨设备迁移或归档；
                  <strong>导出笔记</strong>（Markdown）= 兼容 Obsidian/Logseq 等双链笔记软件，仅划线+笔记不含卡片；
                  <strong>导出复习数据</strong>（CSV）= FSRS 调度记录，可用 Excel/Numbers 做复习行为分析；
                  <strong>导入数据</strong>（JSON）= 从备份恢复，自动合并（冲突记录跳过，不覆盖现有数据）。
                </span>
              </div>
              <div
                className="io-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 'calc(var(--spacing) * 4)',
                }}
              >
                {ioItems.map((item) => (
                  <div className="io-item" key={item.id}>
                    <div className="io-item-head">
                      <div className="io-title">
                        <strong>{item.title}</strong>
                        <Tiny>{item.desc}</Tiny>
                      </div>
                      <span className={`status-badge ${item.formatBadgeTone}`}>{item.formatBadge}</span>
                    </div>
                    <div className="io-item-foot">
                      <span className={`status-badge ${item.statusTone}`}>{item.statusText}</span>
                      <Button
                        variant={item.buttonVariant}
                        onClick={item.onClick}
                        data-dom-id={item.domId}
                      >
                        {item.buttonLabel}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>

            {/* ===== Card D: FSRS 参数配置 ===== */}
            <Card>
              <CardHead
                eyebrow="数据与存储"
                title="FSRS 参数配置"
                action={
                  <Button variant="ghost" onClick={handleResetFsrs} data-dom-id="cta-reset-fsrs">
                    重置参数
                  </Button>
                }
              />
              <div
                className="usage-note"
                role="note"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 'calc(var(--spacing) * 2.5)',
                  padding: 'calc(var(--spacing) * 3.5)',
                  background: 'color-mix(in srgb, var(--state-info) 8%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--state-info) 28%, transparent)',
                  borderRadius: 'var(--radius)',
                  marginBottom: 'calc(var(--spacing) * 4)',
                  color: 'var(--foreground)',
                  fontSize: '0.82rem',
                  lineHeight: 1.6,
                }}
              >
                <span aria-hidden="true" style={{ color: 'var(--state-info)', flexShrink: 0, marginTop: 2 }}>
                  <Icon name="info" size={16} />
                </span>
                <span>
                  <strong>用途说明：</strong>
                  FSRS（Free Spaced Repetition Scheduler）是间隔重复算法，决定每张卡片的下次复习时间。
                  三个参数的用途：<strong>请求级别</strong>（1-10）越高复习越频繁，默认 3 适合多数读者；
                  <strong>难度衰减</strong>（0-1）控制记忆衰减速度，默认 0.2；
                  <strong>最大间隔</strong>（天）限制单张卡片最长复习周期，默认 365 天。
                  参数保存路径：<code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>settings.set</code> 持久化 UI 值 +
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>fsrs.setParameters</code> 同步到引擎，立即影响后续复习调度。
                </span>
              </div>
              <div
                className="form-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 'calc(var(--spacing) * 4)',
                }}
              >
                {/* 请求级别 */}
                <div className="form-field">
                  <label className="form-label" htmlFor="fsrs-level">
                    请求级别
                    <span
                      className="info-tip"
                      title="请求级别 (1-10)：数值越大，复习频率越高。默认 3 适合多数读者。"
                      aria-label="请求级别说明"
                    >
                      i
                    </span>
                  </label>
                  <select
                    className="form-select"
                    id="fsrs-level"
                    value={fsrsLevel}
                    onChange={(e) => handleChangeLevel(Number(e.target.value))}
                    data-dom-id="select-fsrs-level"
                  >
                    {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
                {/* 难度衰减 */}
                <div className="form-field">
                  <label className="form-label" htmlFor="fsrs-decay">
                    难度衰减
                    <span
                      className="info-tip"
                      title="难度衰减系数：控制记忆衰减速度，建议 0.1-0.5 之间。默认 0.2。"
                      aria-label="难度衰减说明"
                    >
                      i
                    </span>
                  </label>
                  <input
                    className="form-input mono"
                    id="fsrs-decay"
                    type="number"
                    step={0.05}
                    min={0}
                    max={1}
                    value={fsrsDecay}
                    onChange={(e) => handleChangeDecay(Number(e.target.value) || 0)}
                    data-dom-id="input-fsrs-decay"
                  />
                </div>
                {/* 最大间隔（full width） */}
                <div className="form-field full">
                  <label className="form-label" htmlFor="fsrs-max-interval">
                    最大间隔 (天)
                    <span
                      className="info-tip"
                      title="最大复习间隔天数：单张卡片最长可延迟到的复习周期上限。默认 365 天。"
                      aria-label="最大间隔说明"
                    >
                      i
                    </span>
                  </label>
                  <input
                    className="form-input mono"
                    id="fsrs-max-interval"
                    type="number"
                    min={1}
                    value={fsrsMaxInterval}
                    onChange={(e) => handleChangeMaxInterval(Number(e.target.value) || 1)}
                    data-dom-id="input-fsrs-max-interval"
                  />
                </div>
              </div>
              <div className="form-row">
                <div className="form-row-info">
                  <strong>{fsrsDirty ? '参数已自定义' : '参数已保存'}</strong>
                  <Tiny>
                    调整后将影响全部卡片的复习调度，重置可恢复 FSRS 推荐默认值
                  </Tiny>
                </div>
                <div style={{ display: 'flex', gap: 'calc(var(--spacing) * 3)', flexWrap: 'wrap', alignItems: 'center' }}>
                  <span className={`status-badge ${fsrsDirty ? 'warning' : 'success'}`}>
                    {fsrsDirty ? '未保存' : '已保存'}
                  </span>
                  <Button
                    variant="primary"
                    onClick={handleSaveFsrs}
                    disabled={!fsrsDirty || fsrsSaving}
                    data-dom-id="cta-save-fsrs"
                  >
                    {fsrsSaving ? '保存中...' : '保存参数'}
                  </Button>
                </div>
              </div>
            </Card>

            {/* ===== Card E: 危险操作（重置数据库） ===== */}
            <Card
              style={{
                borderColor: 'var(--state-error)',
              }}
            >
              <CardHead
                eyebrow="危险操作"
                title="重置数据库"
              />
              <div
                className="usage-note"
                role="note"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 'calc(var(--spacing) * 2.5)',
                  padding: 'calc(var(--spacing) * 3.5)',
                  background: 'color-mix(in srgb, var(--state-error) 10%, transparent)',
                  border: '1px solid color-mix(in srgb, var(--state-error) 30%, transparent)',
                  borderRadius: 'var(--radius)',
                  marginBottom: 'calc(var(--spacing) * 4)',
                  color: 'var(--foreground)',
                  fontSize: '0.82rem',
                  lineHeight: 1.6,
                }}
              >
                <span aria-hidden="true" style={{ color: 'var(--state-error)', flexShrink: 0, marginTop: 2 }}>
                  <Icon name="alert" size={16} />
                </span>
                <span>
                  <strong>用途说明：</strong>
                  本操作将清空本地 SQLite 数据库的全部业务表（书籍、笔记、卡片、对话、记忆、复习记录等）并重启应用。
                  调用 <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>system.resetDatabase</code>，主进程 500ms 后
                  <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>app.relaunch()</code> + <code style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem' }}>app.exit(0)</code>。
                  <strong style={{ color: 'var(--state-error)' }}>不可撤销</strong>，请务必先在「数据导入导出」卡片中导出 JSON 备份。
                  三次确认机制：第 1 次警告数据丢失 → 第 2 次确认已备份 → 第 3 次最终确认。
                </span>
              </div>
              <div
                className="danger-body"
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 'calc(var(--spacing) * 4)',
                  flexWrap: 'wrap',
                }}
              >
                <div
                  className="danger-warn"
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 'calc(var(--spacing) * 3)',
                    minWidth: 0,
                    flex: 1,
                  }}
                >
                  <span
                    className="warn-glyph"
                    style={{
                      width: 22,
                      height: 22,
                      flexShrink: 0,
                      color: 'var(--state-error)',
                      display: 'grid',
                      placeItems: 'center',
                      marginTop: '0.05rem',
                    }}
                  >
                    <Icon name="alert" size={22} />
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: '0.92rem', fontWeight: 600, color: 'var(--foreground)' }}>
                      此操作将删除所有数据且不可恢复
                    </strong>
                    <Tiny style={{ color: 'var(--state-error)' }}>
                      将清空本地 SQLite 数据库、向量索引与全部缓存，且无法撤销。请务必先导出备份。
                    </Tiny>
                  </div>
                </div>
                <Button variant="danger" onClick={handleResetDb} data-dom-id="cta-reset-db">
                  重置数据库
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </PageHero>

      {/* ===== 设计稿专属样式：form / kpi / usage-bar / status-badge / cache-row / io-grid / danger / info-tip / settings-nav ===== */}
      <style>{`
        .form-field { display: flex; flex-direction: column; gap: calc(var(--spacing) * 2); }
        .form-field-full { grid-column: 1 / -1; }
        .form-label {
          font-size: 0.82rem;
          font-weight: 500;
          color: var(--card-foreground);
          display: flex;
          align-items: center;
          gap: calc(var(--spacing) * 2);
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
        .form-input.mono { font-family: var(--font-mono); }

        /* Form row (info + action) */
        .form-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: calc(var(--spacing) * 3) 0;
          border-top: 1px solid var(--border);
          margin-top: calc(var(--spacing) * 4);
          gap: calc(var(--spacing) * 4);
        }
        .form-row-info { min-width: 0; flex: 1; }
        .form-row-info strong {
          display: block;
          font-size: 0.92rem;
          font-weight: 600;
          color: var(--foreground);
        }

        /* KPI mini-cards */
        .kpi-card {
          padding: calc(var(--spacing) * 4) calc(var(--spacing) * 4) calc(var(--spacing) * 4) calc(var(--spacing) * 5);
          background: var(--background);
          border-radius: var(--radius);
          border: 1px solid var(--border);
          position: relative;
          overflow: hidden;
          min-width: 0;
        }
        .kpi-accent { position: absolute; left: 0; top: 0; bottom: 0; width: 3px; }
        .kpi-card[data-accent="1"] .kpi-accent { background: var(--chart-1); }
        .kpi-card[data-accent="2"] .kpi-accent { background: var(--chart-2); }
        .kpi-card[data-accent="3"] .kpi-accent { background: var(--chart-3); }
        .kpi-card .eyebrow {
          color: var(--muted-foreground);
          font-size: 0.78rem;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          margin-bottom: calc(var(--spacing) * 2);
        }
        .kpi-value {
          font-family: var(--font-mono);
          font-variant-numeric: tabular-nums;
          font-size: 1.55rem;
          font-weight: 700;
          color: var(--foreground);
          display: block;
          white-space: nowrap;
        }
        .kpi-value .unit {
          font-size: 0.82rem;
          font-weight: 500;
          color: var(--muted-foreground);
          margin-left: 0.25rem;
        }
        .kpi-card .tiny { margin-top: calc(var(--spacing) * 2); }

        /* Status badge variants */
        .status-badge {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
          padding: 0.3rem 0.65rem;
          border-radius: 999px;
          font-size: 0.76rem;
          white-space: nowrap;
          font-weight: 500;
        }
        .status-badge.success {
          background: color-mix(in srgb, var(--state-success) 14%, transparent);
          color: var(--state-success);
        }
        .status-badge.warning {
          background: color-mix(in srgb, var(--state-warning) 20%, transparent);
          color: var(--state-warning);
        }
        .status-badge.info {
          background: color-mix(in srgb, var(--state-info) 14%, transparent);
          color: var(--state-info);
        }
        .status-badge.neutral {
          background: var(--secondary);
          color: var(--secondary-foreground);
        }

        /* Info tooltip */
        .info-tip {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 15px;
          height: 15px;
          border-radius: 50%;
          background: var(--muted);
          color: var(--muted-foreground);
          cursor: help;
          flex-shrink: 0;
          font-size: 0.68rem;
          font-weight: 700;
          transition: background 0.2s ease, color 0.2s ease;
        }
        .info-tip:hover {
          background: var(--sidebar-accent);
          color: var(--primary);
        }

        /* Cache rows */
        .cache-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: calc(var(--spacing) * 4);
          padding: calc(var(--spacing) * 4) 0;
          border-top: 1px solid var(--border);
        }
        .cache-row:first-of-type { border-top: none; padding-top: 0; }
        .cache-row-info { min-width: 0; flex: 1; }
        .cache-row-info strong {
          display: block;
          font-size: 0.92rem;
          font-weight: 600;
          color: var(--foreground);
        }
        .cache-row-info .tiny { margin-top: 0.2rem; }

        /* Import/export grid */
        .io-item {
          padding: calc(var(--spacing) * 4);
          background: var(--background);
          border: 1px solid var(--border);
          border-radius: var(--radius);
          display: flex;
          flex-direction: column;
          gap: calc(var(--spacing) * 3);
        }
        .io-item-head {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: calc(var(--spacing) * 2);
          min-width: 0;
        }
        .io-item-head .io-title { min-width: 0; }
        .io-item-head strong {
          font-size: 0.92rem;
          font-weight: 600;
          color: var(--foreground);
          display: block;
        }
        .io-item-head .tiny { margin-top: 0.2rem; }
        .io-item-foot {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: calc(var(--spacing) * 2);
        }

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
          .kpi-grid { grid-template-columns: 1fr !important; }
          .io-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 760px) {
          .form-row { flex-direction: column; align-items: flex-start; gap: calc(var(--spacing) * 3); }
          .cache-row { flex-direction: column; align-items: flex-start; gap: calc(var(--spacing) * 3); }
          .danger-body { flex-direction: column; align-items: flex-start; }
        }
      `}</style>
    </>
  )
}
