/**
 * 备份与恢复的唯一清单。
 *
 * 为什么要有这一份：备份的取数原先写在渲染层（六次 IPC 拼一个 payload），
 * 恢复又是另一套循环，两边各自记着"备份里有什么"。于是三件事同时发生 ——
 * ① 备份里有 `cards`，恢复方从不读它（只按划线重建），知识卡片与方法论
 *    "加入复习队列"的登记在恢复后全丢；② AI 生成的层级摘要与
 *    `ai_generation_batches`（"这本书已处理 60/329 条划线"）根本不在清单里，
 *    恢复后台账归零、按钮变成"重新蒸馏"，用户为同一批划线再花一次钱；
 * ③ 界面上写着"完整备份"。
 *
 * 现在取数与恢复都在主进程一处，表清单只有这一份，**顺序就是依赖顺序**
 * （父表在前才能插子表，倒序删除才能清空）。`tests/backup-roundtrip.test.ts`
 * 拿库里的真实外键关系钉住这个顺序，也钉住"每张表都有恢复方"。
 */

export const BACKUP_VERSION = '1.2'

export interface BackupTableSpec {
  /** 库里真实的表名 */
  table: string
  /** 界面上报数时用的量词 + 名字，如「条划线」 */
  label: string
}

/** 恢复顺序：被引用的表在前（cards 依赖 highlights / knowledge_cards / methodologies） */
export const BACKUP_TABLES: BackupTableSpec[] = [
  { table: 'books', label: '本书' },
  { table: 'conversations', label: '个会话' },
  { table: 'articles', label: '篇文章' },
  { table: 'daily_stats', label: '天活动记录' },
  { table: 'memories', label: '条记忆' },
  { table: 'highlights', label: '条划线' },
  { table: 'knowledge_cards', label: '张知识卡片' },
  { table: 'methodologies', label: '条方法论' },
  { table: 'cards', label: '张复习卡片' },
  { table: 'reviews', label: '条复习记录' },
  { table: 'chat_messages', label: '条对话消息' },
  { table: 'vocabulary', label: '个生词' },
  { table: 'book_summaries', label: '份全书摘要' },
  { table: 'chapter_summaries', label: '章层级摘要' },
  { table: 'ai_generation_batches', label: '条生成台账' },
]

/**
 * 有意不带进备份的表，理由写在这儿而不是散在代码注释里。
 * 新增一张表时若既不进清单也不在这儿说明，测试直接判红 —— 免得清单悄悄漏东西。
 */
export const EXCLUDED_TABLES: Record<string, string> = {
  token_usage: 'AI 调用用量日志：不是用户内容，且会把调用明细写进明文备份文件',
  book_architecture: '整条链路已于 2026-09-18 砍掉，表留着只是历史空壳',
}

export interface BackupPayload {
  app: 'zhixing-reader'
  version: string
  exportedAt: string
  tables: Record<string, Array<Record<string, unknown>>>
}

export type BackupCounts = Record<string, number>

/** system:exportBackup 的返回 */
export interface BackupExport {
  payload: BackupPayload
  counts: BackupCounts
}

/** system:importBackup 的返回 */
export interface BackupImportResult {
  counts: BackupCounts
  /** 恢复的是旧格式备份：清单外的数据本来就没在里面，界面要如实说明 */
  legacy: boolean
  version: string
}

/** 导入完如实报数：只报清单里的表，顺序与清单一致（不多报也不少报） */
export function describeImportedCounts(counts: BackupCounts): string {
  return BACKUP_TABLES.filter((spec) => (counts[spec.table] ?? 0) > 0)
    .map((spec) => `${counts[spec.table]} ${spec.label}`)
    .join(' / ')
}
