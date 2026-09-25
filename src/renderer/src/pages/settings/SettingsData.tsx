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


import {
  DEFAULT_NEW_CARDS_PER_DAY,
  FSRS_DEFAULTS,
  NAV_ITEMS,
  asNumber,
  asString,
  formatDaysAgo,
  formatSize,
  levelToRetention,
  type IoItemDef,
  type KpiStats,
  type StorageUsage,
} from './data-utils'
import { useDataIo } from './use-data-io'

// ===== 组件 =====

export default function SettingsData() {
  const navigate = useNavigate()

  // ===== FSRS UI 参数 =====
  const [fsrsLevel, setFsrsLevel] = useState<number>(FSRS_DEFAULTS.level)
  const [fsrsMaxInterval, setFsrsMaxInterval] = useState<number>(FSRS_DEFAULTS.maxInterval)
  const [fsrsDirty, setFsrsDirty] = useState<boolean>(false)
  const [fsrsSaving, setFsrsSaving] = useState<boolean>(false)
  /** 每日新卡上限：0 = 暂停新卡（只复习已学过的） */
  const [newCardsPerDay, setNewCardsPerDay] = useState<number>(DEFAULT_NEW_CARDS_PER_DAY)
  /** 历史数据修复的执行状态（两件事各自独立，避免互相锁住） */
  const [backfilling, setBackfilling] = useState<boolean>(false)
  const [backfillingCards, setBackfillingCards] = useState<boolean>(false)

  // ===== KPI 与用量数据 =====
  const [loading, setLoading] = useState<boolean>(true)
  const [kpiStats, setKpiStats] = useState<KpiStats>({ totalBooks: 0, totalHighlights: 0, totalCards: 0 })

  /** 真实存储用量（向主进程要文件大小）；null = 还没取到，量不出来则为 '—' */
  const [storageUsage, setStorageUsage] = useState<StorageUsage | null>(null)

  // ===== 导出 / 导入：整块拆在 ./use-data-io.ts，页面只取用 =====
  const {
    handleExportAll,
    handleExportNotes,
    handleExportReview,
    handleImportData,
    lastExportAt,
    setLastExportAt,
  } = useDataIo()

  // 首次进入就量一次真实存储用量（不点「刷新用量」也该看到数字）
  useEffect(() => {
    const api = window.electronAPI
    if (!api?.system?.getStorageUsage) return
    void api.system
      .getStorageUsage()
      .then((usage) => setStorageUsage(usage as StorageUsage))
      .catch(() => {
        /* 量不出来就显示「—」，不编数字 */
      })
  }, [])

  // ===== 拉取 FSRS 参数 + UI 值 =====
  useEffect(() => {
    const loadFsrs = async () => {
      const api = window.electronAPI
      if (!api) return
      try {
        // 1. UI 值（settings.get）
        const [lv, mi, lastExp, ncpd] = await Promise.all([
          api.settings.get('fsrsRequestLevel'),
          api.settings.get('fsrsMaxInterval'),
          api.settings.get('lastDataExportAt'),
          api.settings.get('newCardsPerDay'),
        ])
        const maxInterval = asNumber(mi, FSRS_DEFAULTS.maxInterval)
        setFsrsLevel(asNumber(lv, FSRS_DEFAULTS.level))
        setFsrsMaxInterval(maxInterval)
        setLastExportAt(asString(lastExp, ''))
        setNewCardsPerDay(asNumber(ncpd, DEFAULT_NEW_CARDS_PER_DAY))
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
      const [result, usage] = await Promise.all([
        api.admin.getStats() as Promise<{ stats?: Record<string, unknown> }>,
        api.system?.getStorageUsage ? api.system.getStorageUsage() : Promise.resolve(null),
      ])
      const s = result.stats ?? {}
      setKpiStats({
        totalBooks: safeNum(s.totalBooks),
        totalHighlights: safeNum(s.totalHighlights),
        totalCards: safeNum(s.totalCards),
      })
      if (usage) setStorageUsage(usage as StorageUsage)
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
  const handleChangeMaxInterval = useCallback((v: number) => {
    setFsrsMaxInterval(v)
    setFsrsDirty(true)
  }, [])

  // ===== 补全历史划线的章节名（2026-09-16 新增） =====
  const handleBackfillChapterTitles = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.highlight?.backfillChapterTitles) {
      toast.error('API 未正确初始化，请重启应用')
      return
    }
    setBackfilling(true)
    const tId = toast.loading('正在修复章节名，请稍候...')
    try {
      const result = await api.highlight.backfillChapterTitles()
      toast.remove(tId)
      if (result.updated > 0) {
        toast.success(`修复完成：${result.books} 本书，补全 ${result.updated} 条章节名`)
      } else if (result.failedBooks > 0) {
        toast.error(`${result.failedBooks} 本书拉取失败，请检查微信读书连接后重试`)
      } else {
        toast.info('没有需要修复的划线，章节名都是完整的')
      }
    } catch (err) {
      toast.remove(tId)
      toast.error(`修复失败: ${(err as Error).message}`)
    } finally {
      setBackfilling(false)
    }
  }, [])

  // ===== 找回历史知识卡片的来源划线（2026-09-16 新增） =====
  const handleBackfillCardSource = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.knowledgeCard?.backfillSource) {
      toast.error('API 未正确初始化，请重启应用')
      return
    }
    setBackfillingCards(true)
    const tId = toast.loading('正在找回卡片来源...')
    try {
      const result = await api.knowledgeCard.backfillSource()
      toast.remove(tId)
      if (result.updated > 0) {
        toast.success(`找回 ${result.updated} 张卡片的来源划线`)
      } else {
        toast.info('没有可以确定来源的卡片（对不上的保持空着，不做猜测）')
      }
    } catch (err) {
      toast.remove(tId)
      toast.error(`修复失败: ${(err as Error).message}`)
    } finally {
      setBackfillingCards(false)
    }
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
        api.settings.set('fsrsMaxInterval', fsrsMaxInterval),
        api.settings.set('newCardsPerDay', newCardsPerDay),
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
  }, [fsrsLevel, fsrsMaxInterval, newCardsPerDay])

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
      setFsrsMaxInterval(FSRS_DEFAULTS.maxInterval)
      setNewCardsPerDay(DEFAULT_NEW_CARDS_PER_DAY)
      setFsrsDirty(false)
      toast.remove(tId)
      toast.success('已恢复 FSRS 默认参数')
    } catch (err) {
      toast.remove(tId)
      toast.error(`重置失败: ${(err as Error).message}`)
    }
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
  const totalUsageMb = useMemo(() => {
    if (!storageUsage) return null
    // 只统计真正会被应用继续写入的部分（向量库目录已废弃，不再计入总量）
    const parts = [storageUsage.dbBytes, storageUsage.logBytes]
    if (parts.some((p) => p === null)) return null
    return (parts as number[]).reduce((s, p) => s + p, 0) / 1024 / 1024
  }, [storageUsage])
  const usageTotalText = totalUsageMb === null ? '—' : `合计 ${totalUsageMb.toFixed(1)} MB`
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
        // 说清楚到底备份了什么：原来写「完整备份 · 含书架、笔记、卡片」，
        // 实际只有书架/划线/复习卡片，知识卡片与方法论根本没进文件
        desc: '含书架、划线、复习卡、知识卡片、方法论、生词（不含复习进度与对话）',
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
        desc: '从 JSON 备份恢复 · 重复记录自动跳过',
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
                    {usageTotalText}
                  </span>
                }
              />
              <div
                className="kpi-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(2, 1fr)',
                  gap: 'calc(var(--spacing) * 4)',
                  marginBottom: 'calc(var(--spacing) * 5)',
                }}
              >
                <div className="kpi-card" data-accent="1">
                  <span className="kpi-accent" aria-hidden="true"></span>
                  <div className="eyebrow">数据库大小</div>
                  <span className="kpi-value">
                    {formatSize(storageUsage?.dbBytes ?? null).value}
                    <span className="unit">{formatSize(storageUsage?.dbBytes ?? null).unit}</span>
                  </span>
                  <div className="tiny">SQLite · {totalRecords.toLocaleString('zh-CN')} 条记录</div>
                </div>
                <div className="kpi-card" data-accent="2">
                  <span className="kpi-accent" aria-hidden="true"></span>
                  {/* 这一格原来写「缓存大小 45.2MB · 图片·网页·临时文件」—— 那个数字是编的，
                      而且应用根本没有磁盘缓存目录（微信读书接口缓存只在内存里）。改成日志目录的真实大小。 */}
                  <div className="eyebrow">日志大小</div>
                  <span className="kpi-value">
                    {formatSize(storageUsage?.logBytes ?? null).value}
                    <span className="unit">{formatSize(storageUsage?.logBytes ?? null).unit}</span>
                  </span>
                  <div className="tiny">运行日志 · 每天一个文件，放在应用数据目录的 logs/ 下</div>
                </div>
                {/* 「向量库大小」这一格已删除：Vectra 语义检索 2026-09-16 整套移除，
                    那个目录不会再增长，继续显示只会让人以为还有这个功能。 */}              </div>
              {/* 「总用量 / 容量上限 512 MB」进度条已删除：那个 512 MB 是编的，
                  应用从来没有容量上限，也没有配额可言 —— 磁盘是系统的，不是我们的。
                  现在只报实测到的两个文件有多大。 */}
              <div className="tiny" style={{ marginTop: 'calc(var(--spacing) * 3)' }}>
                {totalUsageMb === null
                  ? '还没量到本地文件大小'
                  : `数据库 + 运行日志实测 ${totalUsageMb.toFixed(1)} MB，没有容量上限这个概念`}
              </div>
            </Card>

            {/* ===== Card B: 缓存管理 ===== */}
            <Card>
              <CardHead eyebrow="数据与存储" title="缓存管理" />
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
                    {/* 原来的说明是「操作日志与同步记录 · 共 1,284 条」—— 两处都不实：
                        它删的是**全部 AI 对话历史**（conversations + chat_messages），
                        「1,284 条」是写在 JSX 里的固定数字。改成说清楚到底删什么。 */}
                    <strong>清空 AI 对话历史</strong>
                    <Tiny>删除全部对话与消息记录（不可恢复）</Tiny>
                  </div>
                  <Button variant="secondary" onClick={handleClearHistory} data-dom-id="cta-clear-history">
                    清理历史
                  </Button>
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

            {/* ===== 历史数据修复 =====
                2026-09-16 实测发现两处历史数据缺口，两个入口本身都已修好，
                但只对以后生效 —— 这里是给已有数据用的一次性修复。
                两项都**幂等**、都**只填空值不覆盖**，重复点安全。 */}
            <Card>
              <CardHead eyebrow="数据与存储" title="历史数据修复" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'calc(var(--spacing) * 4)' }}>
                <div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'calc(var(--spacing) * 3)' }}>
                    <strong style={{ fontSize: '0.9rem' }}>划线章节名</strong>
                    <Button
                      variant="ghost"
                      onClick={handleBackfillChapterTitles}
                      disabled={backfilling || backfillingCards}
                      data-dom-id="cta-backfill-chapter-titles"
                    >
                      {backfilling ? '正在修复...' : '开始修复'}
                    </Button>
                  </div>
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--muted-foreground)', lineHeight: 1.7 }}>
                    微信读书的划线接口不给章节名，要靠另一次「章节列表」请求补上。
                    早期版本的导入漏了这一步，导致已有划线的章节名都是空的。
                  </p>
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 'calc(var(--spacing) * 4)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'calc(var(--spacing) * 3)' }}>
                    <strong style={{ fontSize: '0.9rem' }}>知识卡片来源</strong>
                    <Button
                      variant="ghost"
                      onClick={handleBackfillCardSource}
                      disabled={backfilling || backfillingCards}
                      data-dom-id="cta-backfill-card-source"
                    >
                      {backfillingCards ? '正在修复...' : '开始修复'}
                    </Button>
                  </div>
                  <p style={{ margin: '0.35rem 0 0', fontSize: '0.82rem', color: 'var(--muted-foreground)', lineHeight: 1.7 }}>
                    让每张知识卡片能点回它来源的那条划线。只有卡片正文与划线原文
                    <strong>完全一致</strong>时才会建立关联 —— 对不上的保持空着，不会猜。
                  </p>
                </div>
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
                className="form-grid"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 'calc(var(--spacing) * 4)',
                }}
              >
                {/* 每日新卡上限 —— 2026-09-15 新增：解决"900+ 张划线一次性全到期"造成的放弃感 */}
                <div className="form-field">
                  <label className="form-label" htmlFor="new-cards-per-day">
                    每日新卡上限
                    <span
                      className="info-tip"
                      title="每天最多放出多少张从未学过的卡片。微信读书同步会把所有划线一次性导入，若不限量，待复习会瞬间变成几百张、永远做不完。设为 0 则暂停新卡、只复习已学过的。"
                      aria-label="每日新卡上限说明"
                    >
                      i
                    </span>
                  </label>
                  <input
                    className="form-input mono"
                    id="new-cards-per-day"
                    type="number"
                    min={0}
                    max={200}
                    step={1}
                    value={newCardsPerDay}
                    onChange={(e) => {
                      setNewCardsPerDay(Number(e.target.value))
                      setFsrsDirty(true)
                    }}
                    data-dom-id="input-new-cards-per-day"
                  />
                </div>
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
                {/* 「难度衰减」输入框已删除：FSRS-6.0 的 decay 是算法常数（0.1542），
                    引擎从来不接受这个值，改了不会影响任何排期 —— 假控件。 */}
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
                      将清空本地 SQLite 数据库与全部缓存，且无法撤销。请务必先导出备份。
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
