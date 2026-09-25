/** 数据导入导出（JSON / Markdown / CSV）——从 SettingsData.tsx 整块拆出，逐行未改 */
import { useCallback, useState } from 'react'
import { toast } from '@/stores/toastStore'
import { safeNum } from '@/utils/db-mapper'
import { downloadBlob, type KpiStats } from './data-utils'
import { buildReviewCsv } from '../../../../shared/review-export'

/**
 * 这一坨只碰 IPC、拼装文件和浏览器下载，不碰页面其它状态，所以整块搬走。
 * setKpiStats 由页面传进来：导入完要用主进程返回的真实计数刷新看板。
 */
export function useDataIo(setKpiStats: (stats: KpiStats) => void) {
  const [lastExportAt, setLastExportAt] = useState<string>('')

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
      // 2026-09-16：补齐知识卡片 / 方法论 / 生词。
      // 原来备份里只有 books / highlights / cards（cards 还是 **FSRS 复习卡片**，不是知识卡片），
      // 而导入时连 cards 都不读 —— 界面写着「完整备份」，恢复后卡片全没。
      const [knowledgeCards, methodologies, vocabulary] = await Promise.all([
        api.knowledgeCard?.getAll ? api.knowledgeCard.getAll().catch(() => []) : Promise.resolve([]),
        api.methodology?.getAll ? api.methodology.getAll().catch(() => []) : Promise.resolve([]),
        api.vocabulary?.getAll ? api.vocabulary.getAll().catch(() => []) : Promise.resolve([]),
      ])
      const payload = {
        version: '1.1',
        exportedAt: new Date().toISOString(),
        books,
        highlights,
        cards,
        knowledgeCards,
        methodologies,
        vocabulary,
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
      toast.success(
        `已导出 ${books.length} 本书 / ${highlights.length} 条划线 / ${cards.length} 张复习卡` +
          ` / ${knowledgeCards.length} 张知识卡片 / ${methodologies.length} 条方法论 / ${vocabulary.length} 个生词`,
      )
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
          /** FSRS 复习卡片（备份里保留但恢复时走"按划线重建"，见下） */
          cards?: Array<Record<string, unknown>>
          knowledgeCards?: Array<Record<string, unknown>>
          methodologies?: Array<Record<string, unknown>>
          vocabulary?: Array<Record<string, unknown>>
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
        // 复习卡片：按划线重建（备份里没有复习进度，只能重建为新卡）
        let cardCount = 0
        try {
          const created = (await api.card?.createForExisting?.()) as { created?: number } | undefined
          cardCount = created?.created ?? 0
        } catch {
          /* 非致命 */
        }

        // 知识卡片 / 方法论 / 生词：逐条 create，冲突记录跳过并计数
        let kcCount = 0
        for (const c of data.knowledgeCards ?? []) {
          try {
            await api.knowledgeCard?.create?.(c)
            kcCount++
          } catch {
            /* 跳过冲突记录 */
          }
        }
        let methodCount = 0
        for (const m of data.methodologies ?? []) {
          try {
            await api.methodology?.create?.(m)
            methodCount++
          } catch {
            /* 跳过冲突记录 */
          }
        }
        let vocabCount = 0
        for (const v of data.vocabulary ?? []) {
          try {
            await api.vocabulary?.create?.(v)
            vocabCount++
          } catch {
            /* 跳过冲突记录 */
          }
        }

        toast.remove(tId)
        const restored = bookCount + highlightCount + cardCount + kcCount + methodCount + vocabCount
        const summary =
          `已导入 ${bookCount} 本书 / ${highlightCount} 条划线 / ${cardCount} 张复习卡` +
          ` / ${kcCount} 张知识卡片 / ${methodCount} 条方法论 / ${vocabCount} 个生词`
        // 一条都没进来时必须报 warning —— 原来全部失败也会弹「成功」
        if (restored === 0) {
          toast.warning(`没有导入任何数据：${summary}`)
        } else {
          toast.success(summary)
        }
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

  return {
    handleExportAll,
    handleExportNotes,
    handleExportReview,
    handleImportData,
    lastExportAt,
    setLastExportAt,
  }
}
