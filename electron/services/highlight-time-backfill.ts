/**
 * 划线时间一次性回填 —— 修复历史数据
 *
 * ## 背景（2026-09-28 实测）
 * 本机开发库 934 条划线，`created_at` **去重后只剩 9 个值**：《被讨厌的勇气》329 条挤在
 * 同一秒、《当下的力量》196 条挤在另一秒。那不是划线的时刻，是**导入的那一刻**。
 *
 * 根因已在导入侧修掉（`highlights.create` 现在带上 `created_at`，见 `planHighlightRows`），
 * 但那只对**以后**新导入的生效 —— 已经躺在库里的 933 条不会自己变好，
 * 而用户不可能手动重新导入这 8 本书。
 *
 * ## 靠什么对回去
 * `highlights` 表没存微信读书的 `bookmarkId`，唯一可靠的对应关系是**划线原文本身**
 * （导入去重口径也是 `(book_id, content)`，与 `chapter-title-backfill` 同一个道理）。
 * 微信读书那侧仍存着真实的 `createTime`，重新拉一次就能对上。
 *
 * ## 三条自我约束
 *  - **同一句被划两次且时刻不同 ⇒ 跳过**，不挑一个时间（猜错会把这条挪到错误的一天，
 *    而统计页正是按天归集的）；
 *  - **每本书只试一次**（7 天后才重试）：有的书就算修完也仍有两条真划在同一秒，
 *    缺口信号不会消失，没有这个标记就会每轮启动都去重拉一次；
 *  - **已经是对的不再写**：重复执行零副作用。
 *
 * 全程不调 AI、不联网除微信读书内容接口；失败只记警告，不影响启动。
 */

import { fetchAllContent } from '../weread-api';
import { highlightsDb } from '../database';
import { settingsService } from './settings-service';
import { buildContentTimeMap, planHighlightTimeRepairs } from '../../src/shared/weread-content';
import { logger } from '../logger';

/** 每本书记一次"已尝试"，避免对修不完的缺口反复重拉 */
const ATTEMPTED_KEY = 'highlightTimeBackfillBookIds';
const RETRY_MS = 7 * 24 * 60 * 60 * 1000;

export interface HighlightTimeBackfillResult {
  /** 真正重新拉取过并处理的书数 */
  books: number;
  /** 扫描到的库内行数 */
  scanned: number;
  /** 改动了的划线条数 */
  updated: number;
  /** 同一句对应多个时刻、被跳过的条数 */
  ambiguous: number;
  /** 对不上微信读书任何一条的库内行数（含正文为空、以及导入后又改过正文的） */
  unmatched: number;
  /** 拉取失败的书籍数（不中断整体流程） */
  failedBooks: number;
}

/** 读已尝试标记：JSON 串 → Map<bookId, 尝试时刻>。坏数据按"没试过"处理 */
function readAttempts(): Map<string, number> {
  const raw = settingsService.get(ATTEMPTED_KEY);
  const map = new Map<string, number>();
  if (typeof raw !== 'string' || !raw) return map;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return map;
    for (const [id, at] of Object.entries(parsed as Record<string, unknown>)) {
      const value = Number(at);
      if (Number.isFinite(value)) map.set(id, value);
    }
  } catch {
    // 读不回就当没试过来处理，最多多跑一次，不会丢数据
    return map;
  }
  return map;
}

/**
 * 回填划线时间。
 * @param bookId 只处理这一本（跳过"是否试过"的判断）；省略则处理所有仍有缺口的书
 */
export async function backfillHighlightTimes(bookId?: string): Promise<HighlightTimeBackfillResult> {
  const attempts = readAttempts();
  const now = Date.now();
  const all = bookId ? [bookId] : highlightsDb.getBookIdsWithFlatTimestamps();
  const targets = bookId ? all : all.filter((id) => now - (attempts.get(id) ?? 0) >= RETRY_MS);

  const result: HighlightTimeBackfillResult = {
    books: 0,
    scanned: 0,
    updated: 0,
    ambiguous: 0,
    unmatched: 0,
    failedBooks: 0,
  };

  if (targets.length === 0) return result;

  for (const id of targets) {
    try {
      const rows = highlightsDb.getByBookId(id);
      result.scanned += rows.length;
      const content = await fetchAllContent(id);
      const { updates, ambiguous, unmatched } = planHighlightTimeRepairs(
        rows,
        buildContentTimeMap(content),
      );

      result.ambiguous += ambiguous;
      result.unmatched += unmatched;
      // 每本书记一次时间，哪怕这轮没改动 —— 否则永远有缺口的书会被反复重拉
      attempts.set(id, Date.now());
      if (updates.length === 0) continue;

      result.updated += highlightsDb.updateCreatedTimes(updates);
      result.books++;
    } catch (error) {
      result.failedBooks++;
      logger.warn('划线时间回填失败（跳过该书）', { bookId: id, error: String(error) });
    }
  }

  const persisted: Record<string, number> = {};
  for (const [id, at] of attempts) persisted[id] = at;
  settingsService.set(ATTEMPTED_KEY, JSON.stringify(persisted));

  logger.info('划线时间回填完成', { ...result, requested: targets.length });
  return result;
}
