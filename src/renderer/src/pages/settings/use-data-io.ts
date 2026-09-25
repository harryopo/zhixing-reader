/** 数据导入导出（JSON / Markdown / CSV）——从 SettingsData.tsx 整块拆出，逐行未改 */
import { useCallback, useState } from 'react'
import { toast } from '@/stores/toastStore'
import { safeNum } from '@/utils/db-mapper'
import { downloadBlob, type KpiStats } from './data-utils'
import { buildReviewCsv } from '../../../../shared/review-export'
import { describeImportedCounts } from '../../../../shared/backup'

/**
 * 这一坨只碰 IPC、拼装文件和浏览器下载，不碰页面其它状态，所以整块搬走。
 * setKpiStats 由页面传进来：导入完要用主进程返回的真实计数刷新看板。
 */
export function useDataIo(setKpiStats: (stats: KpiStats) => void) {
  const [lastExportAt, setLastExportAt] = useState<string>('')

  // ===== 导出全部数据（JSON） =====
  const handleExportAll = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.system?.exportBackup) {
      toast.error('API 未正确初始化，请重启应用')
      return
    }
    const tId = toast.loading('正在导出全部数据...')
    try {
      // 备份里有什么由主进程那份表清单决定（src/shared/backup.ts）——
      // 以前这里在渲染层拼 payload，AI 生成的摘要与"已处理多少条划线"的台账根本不在里面，
      // 恢复后按钮变成「重新蒸馏」，等于让同一批划线再花一次钱。
      const { payload, counts } = await api.system.exportBackup()
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
      const summary = describeImportedCounts(counts)
      toast.success(summary ? `已导出 ${summary}` : '已导出备份（当前库里没有数据）')
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
      // 列清单与取数都走 REVIEW_CSV_COLUMNS，别再手写一遍字段名 —— 曾经写错过 5 列
      const reviews = await api.review.getRecent(1000)
      const csv = buildReviewCsv(reviews)
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

  // ===== 导入数据（JSON 文件选择 → 主进程按那份清单整批换回） =====
  const handleImportData = useCallback(async () => {
    const api = window.electronAPI
    if (!api?.system?.importBackup) {
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
        // 一次确认：恢复是**整批替换**（不是"缺什么补什么"）。
        // 旧写法逐条 create + 冲突跳过，于是"恢复了"其实什么都没恢复（同名行全被跳过），
        // 而复习进度、生成台账这些必须原样回来的东西反而没回来。
        if (
          !window.confirm(
            '恢复会用备份里的内容整体替换当前库里的数据（书、划线、卡片、对话、摘要、生成台账等）。\n\n' +
              '当前库里没在备份里的内容会消失。建议先导出一份现在的备份。\n\n确定继续？',
          )
        ) {
          toast.remove(tId)
          return
        }
        const result = await api.system.importBackup(JSON.parse(text) as unknown)
        toast.remove(tId)
        const summary = describeImportedCounts(result.counts)
        if (!summary) {
          toast.warning('这份备份里没有任何数据，库里已按它清空')
        } else {
          toast.success(`已恢复 ${summary}`)
          if (result.legacy) {
            toast.warning(
              '这是旧格式备份：当年的清单里没有复习记录、对话历史、AI 摘要与生成台账，这些没有回来',
            )
          }
        }
        // 触发 KPI 刷新
        try {
          const kpi = await api.admin.getStats()
          const s = kpi.stats ?? {}
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

  return {
    handleExportAll,
    handleExportNotes,
    handleExportReview,
    handleImportData,
    lastExportAt,
    setLastExportAt,
  }
}
