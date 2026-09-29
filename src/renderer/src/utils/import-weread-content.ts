/**
 * 从微信读书导入划线 / 笔记 —— 单一实现
 *
 * ## 为什么要有这个文件
 * 2026-09-16 排查发现：`Bookshelf.tsx` 与 `BookDetail.tsx` 各有一份
 * **逻辑一字不差**（只有变量名不同）的导入循环，而且两份**错得一模一样** ——
 * 都只读 `bookmarks` / `notes`，把 `fetchAllContent` 一起取回来的
 * `chapters`（章节对照表）丢掉，导致 934 条划线的章节名全空。
 *
 * 同一定义存在多份，是本项目反复栽跟头的地方（schema、评分档位、这里的导入）。
 * 所以导入逻辑只留这一份，两个页面都调它。
 *
 * ## 2026-09-29 收掉这里的第二份判重
 * 这一层原来会先 `highlight.getByBook` 取回整本、按 content 建一张索引，
 * 命中已有那一行时**只补章节名、从不补想法**，然后 `continue` —— 于是
 * 「库里已有那句原文、这轮带回用户写的想法」这一支被永久堵死，用户写的想法进不了库。
 * 而"什么算同一行"这条规则在 `highlightsDb.create` 里已经有一份
 * （`(book_id, content)`，正文为空时连 note 一起判）。两条通路迟早各漂一次，
 * 这里已经是第三份。
 *
 * 现在判重与补写只有数据库那一处；本层只做三件事：把行规划交给主进程、
 * 把主进程交回的三种计数如实汇总、以及最后那句给用户看的人话。
 */

import { planHighlightRows } from '../../../shared/weread-content'

export interface ImportResult {
  /** 本轮扫描到的划线 + 笔记总数 */
  total: number
  /** 库里新起了一行的条数 */
  created: number
  /** 命中已有那一行、并补到了东西的条数（一行只算一条，哪怕同时补了两样） */
  merged: number
  /** 其中补上了用户想法的条数（merged 的子集） */
  noteFilled: number
  /** 其中补上了章节名的条数（merged 的子集） */
  chapterFilled: number
  /** 已存在且这轮什么都没补上的条数 */
  skipped: number
  /** 导入过程中单条失败次数（不中断整体导入） */
  failed: number
}

/**
 * 导入一本书的微信读书划线 / 笔记。
 *
 * 失败单条只记数不抛出：整体导入不该因为一条脏数据全废。
 */
export async function importWereadContentForBook(bookId: string): Promise<ImportResult> {
  const api = window.electronAPI
  if (!api?.weread?.fetchAllContent || !api?.highlight?.create) {
    throw new Error('API 未正确初始化，请重启应用')
  }

  const content = await api.weread.fetchAllContent(bookId)
  const rows = planHighlightRows(content as Parameters<typeof planHighlightRows>[0])

  const result: ImportResult = {
    total: 0, created: 0, merged: 0, noteFilled: 0, chapterFilled: 0, skipped: 0, failed: 0,
  }

  for (const row of rows) {
    result.total++
    try {
      // 字段名与库里那一列逐字相同（planHighlightRows 保证），主进程只认两种写法
      const outcome = await api.highlight.create({ bookId, ...row })
      if (outcome.created) result.created++
      else if (outcome.noteFilled || outcome.chapterFilled) {
        result.merged++
        if (outcome.noteFilled) result.noteFilled++
        if (outcome.chapterFilled) result.chapterFilled++
      } else result.skipped++
    } catch (e) {
      result.failed++
      console.error('导入条目失败:', e)
    }
  }

  return result
}

/** 把导入结果压成一句人话（两个页面共用同一套说法） */
export function describeImportResult(r: ImportResult): { kind: 'success' | 'info'; text: string } {
  if (r.total === 0) return { kind: 'info', text: '没有找到笔记' }

  const parts: string[] = []
  if (r.created > 0) parts.push(`新增 ${r.created} 条`)
  // 想法与章节名分开说：前者是用户自己写的字，后者只是补齐出处，
  // 混成一句"补全 N 条"会让人以为想法回来了其实只补了章节名
  if (r.noteFilled > 0) parts.push(`补全 ${r.noteFilled} 条想法`)
  if (r.chapterFilled > 0) parts.push(`补全 ${r.chapterFilled} 条章节名`)
  if (r.failed > 0) parts.push(`${r.failed} 条失败`)

  if (parts.length === 0) return { kind: 'info', text: '笔记已是最新，无需重复导入' }
  return { kind: 'success', text: `导入完成！${parts.join(' · ')}` }
}
