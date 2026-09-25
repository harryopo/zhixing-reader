/**
 * 备份与恢复（主进程一处）
 *
 * 表清单与顺序只在 `src/shared/backup.ts` 那一份里；这里只负责"按那份清单取全、
 * 按那份清单换掉"。恢复走一个事务：**半套备份盖上去比不恢复更糟**（书回来了、
 * 划线没回来，界面上就是一本空书）。
 *
 * 插回用 `INSERT OR REPLACE`：清空之后本来没有同主键行，但同一份备份连点两次导入
 * 不该把第二次变成报错。列名先过 `assertRealColumns`（值一律走 `?` 占位符）。
 */
import { getDatabase, runTransaction } from '../database/connection';
import type { Database } from 'sql.js';
import { rowsToObjects } from '../utils/db';
import { assertRealColumns } from '../database/updatable-columns';
import { logger } from '../logger';
import {
  BACKUP_TABLES,
  BACKUP_VERSION,
  type BackupCounts,
  type BackupExport,
  type BackupImportResult,
  type BackupPayload,
} from '../../src/shared/backup';

const TABLE_NAMES = BACKUP_TABLES.map((s) => s.table);

type Rows = Array<Record<string, unknown>>;

/** 2026-09-25 之前的备份是渲染层拼的形状（驼峰分组、没有 cards 之外的复习数据） */
const LEGACY_KEY_BY_TABLE: Record<string, string> = {
  books: 'books',
  highlights: 'highlights',
  cards: 'cards',
  knowledge_cards: 'knowledgeCards',
  methodologies: 'methodologies',
  vocabulary: 'vocabulary',
};

function isRowArray(value: unknown): value is Rows {
  return Array.isArray(value) && value.every((r) => r !== null && typeof r === 'object')
}

/**
 * 老备份（v1.1）里没有 `tables` 这一层。认它，但只认到"能读出来的那些表"，
 * 读不出来的按空处理 —— 不静默把整份文件当有效备份。
 */
function toTableMap(payload: Record<string, unknown>): { tables: Record<string, Rows>; legacy: boolean } {
  if (payload.tables && typeof payload.tables === 'object' && !Array.isArray(payload.tables)) {
    const out: Record<string, Rows> = {}
    const raw = payload.tables as Record<string, unknown>
    for (const table of TABLE_NAMES) {
      const rows = raw[table]
      if (rows === undefined) {
        out[table] = []
        continue
      }
      if (!isRowArray(rows)) throw new Error(`备份里 ${table} 不是一组行，无法恢复`)
      out[table] = rows
    }
    const unknown = Object.keys(raw).filter((k) => !TABLE_NAMES.includes(k))
    if (unknown.length > 0) throw new Error(`备份里有清单外的表：${unknown.join(', ')}`)
    return { tables: out, legacy: false }
  }

  const tables: Record<string, Rows> = {}
  for (const table of TABLE_NAMES) {
    const key = LEGACY_KEY_BY_TABLE[table]
    const rows = key ? payload[key] : undefined
    if (rows === undefined) tables[table] = []
    else if (isRowArray(rows)) tables[table] = rows
    else throw new Error(`旧备份里 ${key} 不是一组行，无法恢复`)
  }
  return { tables, legacy: true }
}

/** 取全：清单里每张表整表读出（行就是库里那一行，不做任何加工） */
export function exportBackup(): BackupExport {
  const db = getDatabase();
  const tables: Record<string, Rows> = {}
  const counts: BackupCounts = {}
  for (const table of TABLE_NAMES) {
    const rows = rowsToObjects(db.exec(`SELECT * FROM ${table}`));
    tables[table] = rows;
    counts[table] = rows.length;
  }
  const payload: BackupPayload = {
    app: 'zhixing-reader',
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    tables,
  };
  return { payload, counts };
}

/** 同一张表、同一套列只查一次库（一份备份几万行，别每行都跑一遍 PRAGMA） */
function createColumnGuard() {
  const seen = new Set<string>();
  return (table: string, columns: string[]): void => {
    const key = `${table}|${columns.join(',')}`;
    if (seen.has(key)) return;
    seen.add(key);
    assertRealColumns(table, columns);
  };
}

function replaceRow(db: Database, table: string, row: Record<string, unknown>, guard: (t: string, c: string[]) => void): void {
  const columns = Object.keys(row);
  if (columns.length === 0) throw new Error(`${table} 里有一行一个字段都没有，无法恢复`);
  guard(table, columns);
  db.run(
    `INSERT OR REPLACE INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
    columns.map((c) => row[c] as never)
  );
}

/**
 * 换掉：先按依赖反序清空，再按正序插回，整批在一个事务里。
 * 备份文件里少一张表就当那张表是空的 —— 不做"部分恢复"，因为清单一件事只有一份口径。
 */
export function importBackup(input: unknown): BackupImportResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('备份文件不是一份数据，无法恢复')
  }
  const payload = input as Record<string, unknown>;
  const version = typeof payload.version === 'string' ? payload.version : '';
  // 旧格式（2026-09-25 之前由渲染层拼的 v1.1）没有 app 字段 —— 认它的形状，
  // 但不去猜一个既没形状也没标记的文件。
  const legacyShape = version.startsWith('1.') && Array.isArray(payload.books);
  if (payload.app !== 'zhixing-reader' && !legacyShape) {
    throw new Error('这个文件不是知行读书的备份');
  }
  if (version > BACKUP_VERSION) {
    throw new Error(`备份来自更新的版本（${version}），请先升级应用再恢复`);
  }

  const { tables, legacy } = toTableMap(payload);
  const counts: Record<string, number> = {};
  const guard = createColumnGuard();

  runTransaction((db) => {
    for (const table of [...TABLE_NAMES].reverse()) db.run(`DELETE FROM ${table}`);
    for (const table of TABLE_NAMES) {
      const rows = tables[table];
      for (const row of rows) replaceRow(db, table, row, guard);
      counts[table] = rows.length;
    }
  });

  logger.info('Backup imported', {
    version,
    legacy,
    books: counts.books,
    highlights: counts.highlights,
    cards: counts.cards,
    batches: counts.ai_generation_batches,
  });
  return { counts, legacy, version };
}
