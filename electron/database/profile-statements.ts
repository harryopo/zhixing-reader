/**
 * database/profile-statements — 画像结论与你本人的判定（profile_statements）
 *
 * 这一层只管两件事：把行读出来（`evidence_ids` 那一列在这里解析成数组）、
 * 按主键写进去。**「哪一条能进库」不在这儿判** —— 那是 `src/shared/profile-statements.ts`
 * 那一道闸，判一次漂一次，所以只在导入那一步走。
 *
 * `upsertMany` 用的是 SQLite 的 upsert：`INSERT OR REPLACE` 会把 `created_at` 一起顶掉，
 * 而这一列说的是"这条结论什么时候第一次进来"，重导入不该把它改成此刻。
 */
import { getDatabase, runTransaction, saveDatabase } from './connection'
import { rowsToObjects } from '../utils/db'
import { logger } from '../logger'
import type { DraftStatement, ProfileStatement, StatementLayer, StatementOrigin, StatementVerdict } from '../../src/shared/profile-statements'

/** 库里那一列是 TEXT；NULL 只可能来自 created_at / updated_at 这种可空列，一律读成空串 */
function text(val: unknown): string {
  return typeof val === 'string' ? val : ''
}

/**
 * 坏 JSON 的证据列按空数组处理并记一句 —— 结论本身留着。
 * 解出数组以外的东西（数字 / 字符串 / 对象）同样按无证据处理：
 * 那一列只可能是 `JSON.stringify(string[])` 写进去的，别的形状就是被改坏了。
 */
function parseEvidenceIds(raw: unknown, id: string): string[] {
  if (typeof raw !== 'string' || !raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    logger.warn(`profile_statements.evidence_ids 不是合法 JSON，按无证据处理: ${id}`)
    return []
  }
  if (!Array.isArray(parsed)) {
    logger.warn(`profile_statements.evidence_ids 解出来不是数组，按无证据处理: ${id}`)
    return []
  }
  return parsed.filter((item): item is string => typeof item === 'string' && item !== '')
}

function toStatement(row: Record<string, unknown>): ProfileStatement {
  const id = text(row.id)
  return {
    id,
    layer: text(row.layer) as StatementLayer,
    topic: text(row.topic),
    statement: text(row.statement),
    evidenceIds: parseEvidenceIds(row.evidence_ids, id),
    // verdict / origin 是 NOT NULL + CHECK 的列，库里那一行一定是四个/三个取值之一
    verdict: text(row.verdict) as StatementVerdict,
    origin: text(row.origin) as StatementOrigin,
    // 这两列可空（DEFAULT 只挡自动写入），显式插 NULL 时读成空串而不是 'null'
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
  }
}

export const profileStatementsDb = {
  /** 核验区一次读全：条数是个位数到几十的量，不翻页也不按话题筛（筛在界面本地做） */
  getAll(): ProfileStatement[] {
    const result = getDatabase().exec('SELECT * FROM profile_statements ORDER BY topic ASC, created_at ASC')
    return rowsToObjects(result).map(toStatement)
  },

  /**
   * 按主键写：新的插入，已有的只换正文与证据，`created_at` 与 `verdict` 都不动 ——
   * 后者由调用方在合并那一步保证（已判过的那几条根本不会到这里来）。
   * 一次写一整批只落盘一次（sql.js 是整文件写回，逐条 save 会把一次导入变成 N 次写盘）。
   */
  upsertMany(rows: readonly DraftStatement[]): number {
    if (rows.length === 0) return 0
    runTransaction((database) => {
      for (const row of rows) {
        database.run(
          `INSERT INTO profile_statements (id, layer, topic, statement, evidence_ids, verdict, origin)
           VALUES (?, ?, ?, ?, ?, 'pending', ?)
           ON CONFLICT(id) DO UPDATE SET
             layer = excluded.layer,
             topic = excluded.topic,
             statement = excluded.statement,
             evidence_ids = excluded.evidence_ids,
             updated_at = datetime('now')`,
          [row.id, row.layer, row.topic, row.statement, JSON.stringify(row.evidenceIds), row.origin],
        )
      }
    })
    return rows.length
  },

  /**
   * 按下「对 / 不对 / 不确定」。交回 `false` 表示库里没有这一条 ——
   * 界面据此说得准"记下了"还是"这条已经不在库里了"，而不是两者都报成功。
   */
  setVerdict(id: string, verdict: StatementVerdict): boolean {
    const database = getDatabase()
    database.run("UPDATE profile_statements SET verdict = ?, updated_at = datetime('now') WHERE id = ?", [verdict, id])
    // SELECT changes() 必返一行，不写"取不到就 0"那种永远走不到的兜底（与 admin.ts 同一口径）
    const changed = Number(database.exec('SELECT changes() AS n')[0].values[0][0])
    saveDatabase()
    return changed > 0
  },
}
