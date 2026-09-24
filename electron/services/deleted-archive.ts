/**
 * deleted-archive — 删除现场留一份，给界面一次撤销的机会
 *
 * 为什么要这一层：界面上「删除」下去的是物理 DELETE，划线条数不多时一次误点
 * 就把自己读过的东西连同复习进度（cards 的 FSRS 状态、reviews 的历史）一起没了。
 * 撤销不需要回收站那么重的方案——把被这一刀带走的行原样留着，用户点撤销就插回去。
 *
 * 边界（刻意如此，不是没做完）：
 * - **只在内存**：应用重启即清空，所以撤销的出口只有删除后那条 8 秒的提示，
 *   不做「回收站」页面（那需要落盘的删除标记 + 每张表的查询过滤，是另一件事）。
 * - **只留 20 份**：再多没有意义，超出按先进先出丢掉。
 * - **表名走白名单**：`ARCHIVE_SPECS` 的键 + 每项里写死的表名是 SQL 里唯一的
 *   标识符来源；被删的 id 一律走 `?` 占位符。
 */
import { randomUUID } from 'crypto';
import {
  getDatabase,
  runTransaction,
  highlightsDb,
  knowledgeCardsDb,
  methodologiesDb,
  vocabularyDb,
} from '../database';
import { rowsToObjects } from '../utils/db';
import { logger } from '../logger';
import type {
  ArchiveResult,
  RestoreResult,
  UndoableDeleteKind,
} from '../../src/shared/types';

type Row = Record<string, unknown>;

/** 一次删除的现场：按插入顺序排列（父表在前，否则外键会挡） */
interface CapturedTables {
  table: string;
  rows: Row[];
}

const MAX_ARCHIVES = 20;

function selectAll(sql: string, params: unknown[] = []): Row[] {
  return rowsToObjects(getDatabase().exec(sql, params as never[]));
}

/**
 * 每种可撤销删除：怎么把现场捞出来 + 怎么删。
 * 删除复用 database 层的方法，避免绕开它们的落盘与写计数。
 */
const ARCHIVE_SPECS: Record<
  UndoableDeleteKind,
  { capture: (id: string) => CapturedTables[]; remove: (id: string) => void }
> = {
  highlight: {
    // 现场按查询一张张捞（划线 → cards → reviews），**不按外键级联捞**：
    // schema 里这三层都声明了 ON DELETE CASCADE，测试也绿，但 2026-09-24 在跑着的
    // 开发版上实测：删一本书、删一条划线之后，子表行仍然留在库里（外键没起作用）。
    // 所以这里以「查出来的子行」为准 —— 撤销回来的东西才和当初被带走的一致。
    // 删除侧不再依赖级联这件事单独跟（否则每次删除都在库里留孤儿行）。
    capture: (id) => {
      const highlights = selectAll('SELECT * FROM highlights WHERE id = ?', [id]);
      const cards = selectAll('SELECT * FROM cards WHERE highlight_id = ?', [id]);
      const tables: CapturedTables[] = [
        { table: 'highlights', rows: highlights },
        { table: 'cards', rows: cards },
      ];
      if (cards.length > 0) {
        const cardIds = cards.map((c) => String(c.id));
        const placeholders = cardIds.map(() => '?').join(', ');
        tables.push({
          table: 'reviews',
          rows: selectAll(
            `SELECT * FROM reviews WHERE card_id IN (${placeholders})`,
            cardIds,
          ),
        });
      }
      return tables;
    },
    remove: (id) => highlightsDb.delete(id),
  },
  knowledge_card: {
    capture: (id) => [
      { table: 'knowledge_cards', rows: selectAll('SELECT * FROM knowledge_cards WHERE id = ?', [id]) },
    ],
    remove: (id) => knowledgeCardsDb.delete(id),
  },
  methodology: {
    capture: (id) => [
      { table: 'methodologies', rows: selectAll('SELECT * FROM methodologies WHERE id = ?', [id]) },
    ],
    remove: (id) => methodologiesDb.delete(id),
  },
  vocabulary: {
    capture: (id) => [
      { table: 'vocabulary', rows: selectAll('SELECT * FROM vocabulary WHERE id = ?', [id]) },
    ],
    remove: (id) => vocabularyDb.delete(id),
  },
};

const archives = new Map<string, { kind: UndoableDeleteKind; tables: CapturedTables[] }>();

/**
 * 这份清单的运行时真值就是上面的白名单。
 * tests/undo-delete.test.ts 拿它和 src/shared/types.ts 里的 UndoableDeleteKind
 * 联合类型对账 —— 两边漂一个，界面上就会出现一个「删了但没留现场」的类型。
 */
export const SUPPORTED_DELETE_KINDS = Object.keys(ARCHIVE_SPECS) as UndoableDeleteKind[];

/** 拼进 SQL 的标识符只允许来自我们自己的表名/列名，别的一律不当字符串用 */
function assertSafeIdentifier(name: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
    throw new Error(`非法的表名或列名：${name}`);
  }
  return name;
}

/**
 * 先留现场再删。找不到那一行（列表是旧的、别处已经删过）时返回 null 且什么都不删，
 * 由界面去刷新列表——不能假装删掉了还给出一个点了没用的撤销。
 */
export function archiveAndDelete(kind: UndoableDeleteKind, id: string): ArchiveResult | null {
  const spec = ARCHIVE_SPECS[kind];
  if (!spec) throw new Error(`不支持撤销的删除类型：${String(kind)}`);
  if (typeof id !== 'string' || id === '') throw new Error('缺少要删除的记录 id');

  const tables = spec.capture(id).filter((t) => t.rows.length > 0);
  const rowCount = tables.reduce((sum, t) => sum + t.rows.length, 0);
  if (rowCount === 0) return null;

  spec.remove(id);

  const token = randomUUID();
  archives.set(token, { kind, tables });
  while (archives.size > MAX_ARCHIVES) {
    const oldest = archives.keys().next().value;
    if (oldest === undefined) break;
    archives.delete(oldest);
  }

  // 只记类型与行数：正文是用户读过的东西，不进日志
  logger.info('Deleted and archived', { kind, rowCount, pending: archives.size });
  return { token, kind, rowCount };
}

/**
 * 按 token 撤销一次删除。整批插回一个事务：只恢复了一半的现场（划线回来了、
 * 卡片没回来）比不撤销更糟。INSERT OR REPLACE 让重复撤销不至于主键冲突。
 */
export function restoreDeleted(token: string): RestoreResult {
  const entry = archives.get(token);
  if (!entry) return { ok: false, kind: null, rowCount: 0 };
  archives.delete(token);

  let rowCount = 0;
  runTransaction((database) => {
    for (const { table, rows } of entry.tables) {
      for (const row of rows) {
        const cols = Object.keys(row).map(assertSafeIdentifier);
        database.run(
          `INSERT OR REPLACE INTO ${assertSafeIdentifier(table)} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
          cols.map((c) => row[c] as never),
        );
        rowCount += 1;
      }
    }
  });

  logger.info('Restore from archive', { kind: entry.kind, rowCount });
  return { ok: true, kind: entry.kind, rowCount };
}

/** 测试用例之间隔离现场用；生产路径不调（应用重启本身就是清空） */
export function clearArchives(): void {
  archives.clear();
}
