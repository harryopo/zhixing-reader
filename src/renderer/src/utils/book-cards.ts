/**
 * 书架那一批「逐本取复习卡片」的读法。
 *
 * 一本读失败与这本书真的有 0 张卡片是两件事：前者要交出去让界面说"没读到"，
 * 后者才是那个 0。原先写法 `.catch(() => [])` 把两件事合成一件，
 * 「待复习」筛选还会跟着把失败那本悄悄排除掉。
 */
import type { Card } from '../../../shared/types'

export interface BookCardRead {
  /** 读到的那些卡片（映射交给调用方，与其余读口同一口径） */
  cards: Card[]
  /** 这一次没读到的书：界面上它们的卡片数与「待复习」都不可信 */
  failedBookIds: string[]
}

export async function readBookCards(bookIds: string[]): Promise<BookCardRead> {
  const reads = await Promise.all(
    bookIds.map((bookId) =>
      window.electronAPI.card
        .getByBook(bookId)
        .then((rows) => ({ bookId, rows, ok: true as const }))
        .catch(() => ({ bookId, rows: [] as Card[], ok: false as const })),
    ),
  )
  return {
    cards: reads.flatMap((read) => read.rows),
    failedBookIds: reads.filter((read) => !read.ok).map((read) => read.bookId),
  }
}
