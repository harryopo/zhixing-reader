/**
 * database/cards — FSRS 复习卡片表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 *
 * 一张复习卡有三种来源（划线 / 知识卡片 / 方法论），各占一个可空外键列，
 * 每行有且只有一个非空（schema 的 CHECK 钉住）。来源的读法、正背面文案的口径
 * 全在 src/shared/review-sources.ts，这里不重复定义。
 */
import { getDatabase, saveDatabase, runTransaction } from './connection';
import { rowsToObjects } from '../utils/db';
import { Card, cardFromDb, cardToRow, createCard, CardState } from '../fsrs-engine';
import { ReviewStats } from '../../src/shared/types';
import {
  DEFAULT_NEW_CARDS_PER_DAY,
  computeNewCardAllowance,
  normalizeNewCardsPerDay,
} from '../../src/shared/study-limits';
import {
  REVIEW_SOURCE_COLUMNS,
  buildReviewCardView,
  cardSourceOf,
  formatStepList,
  type DueReviewCardView,
  type ReviewSourceKind,
  type ReviewSourceRef,
} from '../../src/shared/review-sources';

/**
 * 写入 cards 的列清单 —— 只有一份。
 * 原来 create / createBatch / update / updateBatch 各手写一遍列名与占位符，
 * 加一列要改四处，漏一处就是"某列静默写不进去"。
 */
const CARD_COLUMNS = [
  'id', 'highlight_id', 'knowledge_card_id', 'methodology_id',
  'state', 'step', 'stability', 'difficulty', 'due', 'last_review',
  'elapsed_days', 'scheduled_days', 'reps', 'lapses',
] as const;

/** UPDATE 不改 id（它是 WHERE 条件） */
const CARD_UPDATABLE_COLUMNS = CARD_COLUMNS.filter((col) => col !== 'id');

const CARD_INSERT_SQL = `INSERT INTO cards (${CARD_COLUMNS.join(', ')}) VALUES (${CARD_COLUMNS.map(() => '?').join(', ')})`;
const CARD_UPDATE_SQL = `UPDATE cards SET ${CARD_UPDATABLE_COLUMNS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`;

function insertValues(card: Card): never[] {
  const row = cardToRow(card);
  return CARD_COLUMNS.map((col) => row[col] as never) as never[];
}

function updateValues(card: Card): never[] {
  const row = cardToRow(card);
  return [...CARD_UPDATABLE_COLUMNS.map((col) => row[col] as never), card.id] as never[];
}

/**
 * cards 的读取底座：三种来源都能反查出"这张卡属于哪本书"。
 *
 * cards 表没有 book_id 这一列，它只能从来源反查（划线 → highlights.book_id、
 * 知识卡片 → knowledge_cards.book_id、方法论 → methodologies.book_id）。
 * 所有对外返回 Card 的查询都走这一段 —— 漏掉 book_id 的代价是界面上
 * 书名恒为「未关联书籍」（2026-09-22 实测过的那条断链），不要再各写一份 SELECT。
 */
const CARD_WITH_BOOK_SQL = `
  SELECT c.*, COALESCE(h.book_id, kc.book_id, m.book_id) AS book_id
  FROM cards c
  LEFT JOIN highlights h ON c.highlight_id = h.id
  LEFT JOIN knowledge_cards kc ON c.knowledge_card_id = kc.id
  LEFT JOIN methodologies m ON c.methodology_id = m.id
`;

const CARD_BOOK_FILTER = 'COALESCE(h.book_id, kc.book_id, m.book_id)';

/** JOIN 出来的一行 → 展示视图；查不到来源内容时如实给空文本，不编 */
function toDueView(card: Card, row: Record<string, unknown>): DueReviewCardView {
  const source = cardSourceOf(card);
  const kind = source?.kind ?? 'highlight';
  const text = (key: string): string => ((row[key] as string | null) ?? '');
  const view = buildReviewCardView({
    kind,
    content:
      kind === 'knowledge_card' ? text('_kc_content') : kind === 'methodology' ? text('_m_content') : text('_highlight_content'),
    title: kind === 'knowledge_card' ? text('_kc_title') : kind === 'methodology' ? text('_m_title') : null,
    extra:
      kind === 'knowledge_card'
        ? text('_kc_interpretation')
        : kind === 'methodology'
          ? formatStepList(text('_m_steps'))
          : text('_highlight_note'),
    context: kind === 'methodology' ? text('_m_trigger') : kind === 'highlight' ? text('_chapter_title') : null,
    bookTitle: (row._book_title as string | null) ?? null,
  });
  return {
    ...card,
    ...view,
    sourceKind: kind,
    sourceId: source?.id ?? '',
    bookId: (row._book_id as string) ?? '',
    bookTitle: (row._book_title as string | null) ?? null,
  };
}

export const cardsDb = {
  /** 按来源查已入队的卡（划线卡沿用旧列名，另两种查各自的列） */
  findBySource(source: ReviewSourceRef): Card | undefined {
    const result = getDatabase().exec(
      `SELECT * FROM cards WHERE ${REVIEW_SOURCE_COLUMNS[source.kind]} = ?`,
      [source.id]
    );
    const rows = rowsToObjects(result);
    return rows[0] ? cardFromDb(rows[0]) : undefined;
  },

  getByHighlightId(highlightId: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec(
      'SELECT * FROM cards WHERE highlight_id = ?',
      [highlightId]
    );
    const rows = rowsToObjects(result);
    return rows[0];
  },

  getById(id: string): Card | null {
    const result = getDatabase().exec('SELECT * FROM cards WHERE id = ?', [id]);
    const rows = rowsToObjects(result);
    return rows[0] ? cardFromDb(rows[0]) : null;
  },

  /**
   * 把一条来源放进复习队列。已经在了就返回那张卡本尊（`created: false`），
   * 不新建第二张 —— 点两次「加入复习」不该多出两张卡、把复习进度拆成两半。
   */
  enroll(source: ReviewSourceRef): { card: Card; created: boolean } {
    const existing = this.findBySource(source);
    if (existing) return { card: existing, created: false };
    const card = createCard(source);
    getDatabase().run(CARD_INSERT_SQL, insertValues(card));
    saveDatabase();
    return { card, created: true };
  },

  /** 批量入队（界面上的"把这 N 张都加入复习"）：一个事务，返回各多少 */
  enrollMany(sources: ReviewSourceRef[]): { created: number; skipped: number } {
    const pending = sources.filter((source) => !this.findBySource(source));
    if (pending.length === 0) return { created: 0, skipped: sources.length };
    runTransaction((database) => {
      const stmt = database.prepare(CARD_INSERT_SQL);
      for (const source of pending) {
        stmt.run(insertValues(createCard(source)));
      }
      stmt.free();
    });
    return { created: pending.length, skipped: sources.length - pending.length };
  },

  /** 某一类来源里已经入队的 id（界面的「已在复习队列」标记就来自这里，不做本地猜测） */
  enrolledIds(kind: ReviewSourceKind): string[] {
    const column = REVIEW_SOURCE_COLUMNS[kind];
    const result = getDatabase().exec(
      `SELECT ${column} AS source_id FROM cards WHERE ${column} IS NOT NULL`,
    );
    return rowsToObjects(result)
      .map((row) => row.source_id as string)
      .filter((id) => Boolean(id));
  },

  /** 移出队列：删掉这张来源对应的复习卡，来源本身留着 */
  unenroll(source: ReviewSourceRef): boolean {
    return this.deleteBySource(source) > 0;
  },

  /** 旧入口：给一条划线建卡（等价于 enroll({kind:'highlight'})，不再重复建） */
  create(highlightId: string): Card {
    return this.enroll({ kind: 'highlight', id: highlightId }).card;
  },

  createBatch(highlightIds: string[]): Card[] {
    this.enrollMany(highlightIds.map((id): ReviewSourceRef => ({ kind: 'highlight', id })));
    return this.findByManySources(highlightIds.map((id): ReviewSourceRef => ({ kind: 'highlight', id })));
  },

  /** 一批来源各自的卡（没入队的缺席） */
  findByManySources(sources: ReviewSourceRef[]): Card[] {
    const cards: Card[] = [];
    for (const source of sources) {
      const card = this.findBySource(source);
      if (card) cards.push(card);
    }
    return cards;
  },

  update(card: Card): void {
    getDatabase().run(CARD_UPDATE_SQL, updateValues(card));
    saveDatabase();
  },

  updateBatch(cards: Card[]): void {
    runTransaction((database) => {
      const stmt = database.prepare(CARD_UPDATE_SQL);
      for (const card of cards) {
        stmt.run(updateValues(card));
      }
      stmt.free();
    });
  },

  deleteBatch(ids: string[]): void {
    runTransaction((database) => {
      const stmt = database.prepare('DELETE FROM cards WHERE id = ?');
      for (const id of ids) {
        stmt.run([id]);
      }
      stmt.free();
    });
  },

  deleteByHighlightId(highlightId: string): void {
    getDatabase().run('DELETE FROM cards WHERE highlight_id = ?', [highlightId]);
    saveDatabase();
  },

  /** 来源被删除时收回它的复习卡（知识卡片/方法论没有外键级联可用，见 deleted-archive） */
  deleteBySource(source: ReviewSourceRef): number {
    const before = this.findBySource(source);
    if (!before) return 0;
    getDatabase().run(
      `DELETE FROM cards WHERE ${REVIEW_SOURCE_COLUMNS[source.kind]} = ?`,
      [source.id]
    );
    saveDatabase();
    return 1;
  },

  createForExistingHighlights(): { created: number; skipped: number } {
    const result = getDatabase().exec(`
      SELECT h.id FROM highlights h
      LEFT JOIN cards c ON h.id = c.highlight_id
      WHERE c.id IS NULL
    `);
    const rows = rowsToObjects(result);
    const highlightIds = rows.map(r => r.id as string);

    if (highlightIds.length === 0) {
      return { created: 0, skipped: 0 };
    }

    return this.enrollMany(highlightIds.map((id): ReviewSourceRef => ({ kind: 'highlight', id })));
  },

  /**
   * 今天已经引入的新卡数 —— 即**首次复习发生在今天**的卡片数。
   *
   * 为什么用 reviews 而不是 cards：一张卡只要评过一次分，state 就不再是 0，
   * 但它当天可能又被复习了好几次；只有"首次复习在今天的卡"才等于"今天新放出的卡"。
   * 时区口径与 daily-stats 保持一致（UTC 日期，见 daily-stats.ts）。
   */
  countNewIntroducedToday(): number {
    const today = new Date().toISOString().split('T')[0];
    const result = getDatabase().exec(
      `SELECT COUNT(*) FROM reviews r
       WHERE date(r.review_time) = ?
         AND r.review_time = (SELECT MIN(r2.review_time) FROM reviews r2 WHERE r2.card_id = r.card_id)`,
      [today]
    );
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },

  /** 新卡池剩余量（state = 0，从未复习过） */
  countAvailableNewCards(): number {
    const result = getDatabase().exec('SELECT COUNT(*) FROM cards WHERE state = 0');
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },

  /** 已学过且已到期的卡片数（真正的"复习卡"，不含新卡） */
  countDueReviewCards(): number {
    // 比较口径必须和 getDueCards 一致：cards.due 由 fsrs-engine 写成
    // toISOString()（含 'T' 与 'Z'），而 datetime('now') 是空格分隔的
    // "YYYY-MM-DD HH:MM:SS"。两者直接比是字符串比较，'T'(0x54) > ' '(0x20)，
    // 于是"今天到期"永远不成立 —— 顶栏与统计页的待复习数会整天少算。
    const result = getDatabase().exec(
      'SELECT COUNT(*) FROM cards WHERE state != 0 AND due <= ?',
      [new Date().toISOString()]
    );
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },

  /**
   * 今日队列的构成。
   *
   * 2026-09-15 新增：此前界面只显示一个"待复习总数"，
   * 而那个数把 900+ 张从未学过的划线也算成了"你欠下的复习"——
   * 用户看到的是永远做不完的清单。现在拆成两块，各自有各自的语义。
   */
  getDueQueueStats(newCardsPerDay: unknown = DEFAULT_NEW_CARDS_PER_DAY): {
    reviewDue: number;
    newAvailable: number;
    newIntroducedToday: number;
    newPerDay: number;
    newAllowance: number;
    actionable: number;
  } {
    const quota = computeNewCardAllowance({
      perDay: normalizeNewCardsPerDay(newCardsPerDay),
      introducedToday: this.countNewIntroducedToday(),
      available: this.countAvailableNewCards(),
    });
    const reviewDue = this.countDueReviewCards();
    return {
      reviewDue,
      newAvailable: quota.available,
      newIntroducedToday: quota.introducedToday,
      newPerDay: quota.perDay,
      newAllowance: quota.allowance,
      actionable: reviewDue + quota.allowance,
    };
  },

  /**
   * 今日实际要复习的卡片。
   *
   * 顺序：**先到期的复习卡，后新卡**——复习卡是时间敏感的（正在遗忘），
   * 新卡早一天晚一天没有区别。
   * 新卡每天最多放 `newCardsPerDay` 张（默认 15），剩余排队等明天。
   *
   * 不再 JOIN highlights：三种来源共用这一条查询。指向已删来源的卡由外键级联负责清掉
   * （见 schema.ts 的三个 ON DELETE CASCADE），所以不需要在这里再挡一层。
   */
  getDueCards(limit: number = 100, newCardsPerDay: unknown = DEFAULT_NEW_CARDS_PER_DAY): Card[] {
    const now = new Date().toISOString();
    const reviewResult = getDatabase().exec(CARD_WITH_BOOK_SQL + ' WHERE state != 0 AND due <= ? ORDER BY due ASC LIMIT ?', [now, limit]);
    const reviewCards = rowsToObjects(reviewResult).map(cardFromDb);

    const remaining = limit - reviewCards.length;
    if (remaining <= 0) return reviewCards;

    const quota = computeNewCardAllowance({
      perDay: normalizeNewCardsPerDay(newCardsPerDay),
      introducedToday: this.countNewIntroducedToday(),
      available: this.countAvailableNewCards(),
    });
    const newTake = Math.min(remaining, quota.allowance);
    if (newTake <= 0) return reviewCards;

    const newResult = getDatabase().exec(
      CARD_WITH_BOOK_SQL + ' WHERE state = 0 ORDER BY created_at ASC, id ASC LIMIT ?',
      [newTake]
    );
    return [...reviewCards, ...rowsToObjects(newResult).map(cardFromDb)];
  },

  /**
   * 到期卡片（含复习内容）— 供间隔复习页面展示。
   * 三种来源各自的正文/标题/补充都 JOIN 出来，正背面文案交给 buildReviewCardView。
   */
  getDueCardsWithContent(limit: number = 100, newCardsPerDay: unknown = DEFAULT_NEW_CARDS_PER_DAY): DueReviewCardView[] {
    // 先取 id 队列（复习卡优先，新卡按每日上限放行），再补上展示所需的内容字段
    const queue = this.getDueCards(limit, newCardsPerDay);
    if (queue.length === 0) return [];

    const placeholders = queue.map(() => '?').join(',');
    const result = getDatabase().exec(
      `SELECT c.*,
              COALESCE(h.book_id, kc.book_id, m.book_id) AS _book_id,
              COALESCE(b.title, kb.title, mb.title) AS _book_title,
              h.content AS _highlight_content, h.note AS _highlight_note,
              h.chapter_title AS _chapter_title,
              kc.title AS _kc_title, kc.content AS _kc_content,
              kc.interpretation AS _kc_interpretation,
              m.name AS _m_title, m.description AS _m_content,
              m.steps AS _m_steps, m.trigger_scenario AS _m_trigger
       FROM cards c
       LEFT JOIN highlights h ON c.highlight_id = h.id
       LEFT JOIN books b ON b.id = h.book_id
       LEFT JOIN knowledge_cards kc ON c.knowledge_card_id = kc.id
       LEFT JOIN books kb ON kb.id = kc.book_id
       LEFT JOIN methodologies m ON c.methodology_id = m.id
       LEFT JOIN books mb ON mb.id = m.book_id
       WHERE c.id IN (${placeholders})`,
      queue.map((card) => card.id)
    );
    const byId = new Map<string, Record<string, unknown>>();
    for (const row of rowsToObjects(result)) byId.set(row.id as string, row);

    // 按队列顺序输出，保持"复习卡在前、新卡在后"
    return queue.map((card) => toDueView(card, byId.get(card.id) ?? {}));
  },

  /**
   * 某本书的复习卡。三种来源都能按书查 —— 以前只 JOIN highlights，
   * 于是知识卡片与方法论的卡在哪本书的详情里恒为 0。
   */
  getByBookId(bookId: string): Card[] {
    const result = getDatabase().exec(
      `SELECT c.*, COALESCE(h.book_id, kc.book_id, m.book_id) AS book_id
       FROM cards c
       LEFT JOIN highlights h ON c.highlight_id = h.id
       LEFT JOIN knowledge_cards kc ON c.knowledge_card_id = kc.id
       LEFT JOIN methodologies m ON c.methodology_id = m.id
       WHERE ${CARD_BOOK_FILTER} = ?`,
      [bookId],
    );
    return rowsToObjects(result).map(cardFromDb);
  },

  getReviewStats(): ReviewStats {
    const execScalar = (sql: string, params: unknown[] = []): number => {
      const result = getDatabase().exec(sql, params as never[]);
      return result.length > 0 ? (result[0].values[0][0] as number) : 0;
    };

    const total = execScalar('SELECT COUNT(*) FROM cards');
    // ⚠️ due 的语义已修正：只统计**已学过且到期**的复习卡。
    // 原先是 "WHERE due <= now"，把所有从未学过的划线也算成"到期"，
    // 让统计页显示 900+ 的待复习量。新卡归入 new 字段，不再混入 due。
    // 口径与 countDueReviewCards 同一份（走 ? 传 ISO 串，不许再引入 datetime('now')）。
    const due = execScalar(
      'SELECT COUNT(*) FROM cards WHERE state != 0 AND due <= ?',
      [new Date().toISOString()]
    );
    const newCards = execScalar('SELECT COUNT(*) FROM cards WHERE state = 0');
    const learning = execScalar('SELECT COUNT(*) FROM cards WHERE state = 1 OR state = 3');
    const review = execScalar('SELECT COUNT(*) FROM cards WHERE state = 2');

    return { total, due, new: newCards, learning, review };
  },

  getByState(state: CardState, limit?: number): Card[] {
    let sql = 'SELECT * FROM cards WHERE state = ? ORDER BY due ASC';
    const params: unknown[] = [state];

    if (limit) {
      sql += ' LIMIT ?';
      params.push(limit);
    }

    const result = getDatabase().exec(sql, params);
    return rowsToObjects(result).map(cardFromDb);
  },

  getNewCards(limit: number = 20): Card[] {
    return this.getByState(CardState.New, limit);
  },

  getLearningCards(limit: number = 20): Card[] {
    const result = getDatabase().exec(
      'SELECT * FROM cards WHERE state = ? OR state = ? ORDER BY due ASC LIMIT ?',
      [CardState.Learning, CardState.Relearning, limit]
    );
    return rowsToObjects(result).map(cardFromDb);
  },

  count(): number {
    const result = getDatabase().exec('SELECT COUNT(*) FROM cards');
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },
};
