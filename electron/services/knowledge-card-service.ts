import { BrowserWindow } from 'electron'
import { knowledgeCardsDb, highlightsDb } from '../database'
import { fetchAllContent } from '../weread-api'
import { distillKnowledgeCards, DistillOptions, DistilledKnowledgeCard } from '../ai-service'
import { logger } from '../logger'
import { IPC_CHANNELS } from '../../src/shared/ipc-channels'

export interface DistillTaskProgress {
  bookId: string
  bookTitle: string
  stage: 'fetch' | 'batch' | 'parse' | 'save' | 'done' | 'error'
  current: number
  total: number
  message?: string
  error?: string
}

interface ActiveTask {
  bookId: string
  bookTitle: string
  controller: AbortController
  startedAt: number
}

class KnowledgeCardService {
  private static instance: KnowledgeCardService | null = null
  private activeTasks: Map<string, ActiveTask> = new Map()
  private cleanupTimer: NodeJS.Timeout | null = null
  private readonly TASK_TTL_MS = 30 * 60 * 1000

  static getInstance(): KnowledgeCardService {
    if (!KnowledgeCardService.instance) {
      KnowledgeCardService.instance = new KnowledgeCardService()
    }
    return KnowledgeCardService.instance
  }

  private constructor() {
    this.cleanupTimer = setInterval(() => this.cleanupStaleTasks(), 5 * 60 * 1000)
    this.cleanupTimer.unref()
  }

  /** 应用退出时调用：中止所有进行中的蒸馏任务并清理定时器 */
  shutdown(): void {
    for (const [bookId, task] of this.activeTasks.entries()) {
      try {
        task.controller.abort()
      } catch {
        // 中止失败不影响退出流程
      }
      this.activeTasks.delete(bookId)
    }
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    logger.info('Knowledge card distill service shut down')
  }

  private cleanupStaleTasks(): void {
    const now = Date.now()
    for (const [bookId, task] of this.activeTasks.entries()) {
      if (now - task.startedAt > this.TASK_TTL_MS) {
        try {
          task.controller.abort()
        } catch {
        }
        this.activeTasks.delete(bookId)
        logger.warn(`Cleaned up stale distill task for book ${bookId}`)
      }
    }
  }

  isDistilling(bookId: string): boolean {
    return this.activeTasks.has(bookId)
  }

  cancelDistill(bookId: string): boolean {
    const task = this.activeTasks.get(bookId)
    if (!task) return false
    try {
      task.controller.abort()
    } catch (e) {
      logger.error(`Failed to abort distill task for ${bookId}`, e)
    }
    return true
  }

  getActiveBookIds(): string[] {
    return Array.from(this.activeTasks.keys())
  }

  private emitProgress(progress: DistillTaskProgress): void {
    try {
      const windows = BrowserWindow.getAllWindows()
      for (const win of windows) {
        if (!win.isDestroyed()) {
          win.webContents.send(IPC_CHANNELS.KNOWLEDGE_CARDS.DISTILL_PROGRESS, progress)
        }
      }
    } catch (e) {
      logger.error('Failed to emit distill progress', e)
    }
  }

  private async importHighlightsFromWeRead(
    bookId: string,
    bookTitle: string
  ): Promise<Record<string, unknown>[]> {
    logger.info(`No highlights found for book "${bookTitle}", attempting to fetch from WeRead...`)
    const content = (await fetchAllContent(bookId)) as {
      bookmarks: Array<{ bookmarkId: string; chapterTitle: string; markText: string; chapterUid: number; createTime: number }>
      notes: Array<{ reviewId: string; chapterTitle: string; abstract: string; content: string; chapterUid: number; createTime: number }>
    }

    let importedCount = 0
    if (content.bookmarks && content.bookmarks.length > 0) {
      for (const bm of content.bookmarks) {
        try {
          highlightsDb.create({
            book_id: bookId,
            content: bm.markText,
            chapter_title: bm.chapterTitle,
            chapter_uid: bm.chapterUid,
            type: 'highlight',
            source: 'weread',
            created_at: new Date(bm.createTime * 1000).toISOString(),
          })
          importedCount++
        } catch (e) {
          logger.error('导入划线失败:', e)
        }
      }
    }
    if (content.notes && content.notes.length > 0) {
      for (const note of content.notes) {
        try {
          highlightsDb.create({
            book_id: bookId,
            content: note.abstract,
            note: note.content,
            chapter_title: note.chapterTitle,
            chapter_uid: note.chapterUid,
            type: 'note',
            source: 'weread',
            created_at: new Date(note.createTime * 1000).toISOString(),
          })
          importedCount++
        } catch (e) {
          logger.error('导入笔记失败:', e)
        }
      }
    }
    logger.info(`Imported ${importedCount} highlights from WeRead for "${bookTitle}"`)
    return highlightsDb.getByBookId(bookId)
  }

  async distillBook(
    bookId: string,
    bookTitle: string,
    options: { force?: boolean } = {}
  ): Promise<Array<{ id: string } & DistilledKnowledgeCard>> {
    if (this.activeTasks.has(bookId)) {
      throw new Error(`该书正在蒸馏中，请等待完成或先取消`)
    }

    const controller = new AbortController()
    const task: ActiveTask = { bookId, bookTitle, controller, startedAt: Date.now() }
    this.activeTasks.set(bookId, task)

    try {
      let highlights = highlightsDb.getByBookId(bookId)
      if (!highlights || highlights.length === 0) {
        if (options.force) {
          throw new Error('该书没有笔记，无法蒸馏')
        }
        try {
          highlights = await this.importHighlightsFromWeRead(bookId, bookTitle)
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error)
          throw new Error(`自动导入笔记失败: ${msg}`)
        }
        if (!highlights || highlights.length === 0) {
          throw new Error('该书在微信读书中也没有笔记，无法蒸馏知识卡片')
        }
      }

      const mappedHighlights = highlights.map(h => ({
        content: String(h.content || ''),
        note: h.note ? String(h.note) : undefined,
        chapterTitle: h.chapter_title ? String(h.chapter_title) : undefined,
      }))

      const distillOpts: DistillOptions = {
        signal: controller.signal,
        batchSize: 20,
        onProgress: (info) => {
          this.emitProgress({
            bookId,
            bookTitle,
            stage: info.stage,
            current: info.current,
            total: info.total,
            message: info.message,
          })
        },
      }

      const cards = await distillKnowledgeCards(mappedHighlights, bookTitle, distillOpts)

      this.emitProgress({
        bookId,
        bookTitle,
        stage: 'save',
        current: cards.length,
        total: cards.length,
        message: `正在保存 ${cards.length} 张知识卡片...`,
      })

      const results: Array<{ id: string } & DistilledKnowledgeCard> = []
      for (const c of cards) {
        const id = `kc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
        knowledgeCardsDb.create({
          id,
          book_id: bookId,
          type: c.type,
          title: c.title,
          content: c.content,
          interpretation: c.interpretation,
          application: c.application,
          related_card_ids: [],
          tags: c.tags,
          source_highlight_id: null,
          review_count: 0,
          mastery_level: 0,
        })
        results.push({ id, ...c })
      }

      this.emitProgress({
        bookId,
        bookTitle,
        stage: 'done',
        current: results.length,
        total: results.length,
        message: `蒸馏完成，共生成 ${results.length} 张知识卡片`,
      })

      return results
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      this.emitProgress({
        bookId,
        bookTitle,
        stage: 'error',
        current: 0,
        total: 0,
        message: '蒸馏失败',
        error: msg,
      })
      throw error
    } finally {
      this.activeTasks.delete(bookId)
    }
  }
}

export const knowledgeCardService = KnowledgeCardService.getInstance()
export default knowledgeCardService
