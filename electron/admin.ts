import { getDatabase } from './database'
import { rowsToObjects } from './utils/db'
import {
  getAllPrompts,
  getPromptTemplate,
  savePrompt,
  resetPrompt,
  resetAllPrompts,
  exportPrompts,
  importPrompts,
  PromptWithOverride,
  CustomPrompt,
  createCustomPrompt,
  getAllCustomPrompts,
  updateCustomPrompt,
  deleteCustomPrompt,
} from './services/prompt-storage'
import { getIntentKeywords } from './agent/intent-classifier'

/**
 * 聚合查询（COUNT / SUM）取单个数。
 *
 * 这类 SQL 一定返回一行一列，所以取不到就是 SQL 写错了 —— 直接让它抛，
 * 而不是 `?? 0` 报一个看着正常的零：查询失败在界面上演成"数据就是没有"过一次。
 */
function aggregateNumber(sql: string, column: string): number {
  return Number(rowsToObjects(getDatabase().exec(sql))[0][column])
}

export function getAdminStats(): Record<string, unknown> {
  const count = (table: string): number => aggregateNumber(`SELECT COUNT(*) as count FROM ${table}`, 'count')

  return {
    totalConversations: count('conversations'),
    totalMessages: count('chat_messages'),
    // 全时段累计：概览那张卡写的是「总 Token」，不跟着下面那张 7 天图的时间窗走
    totalTokens: aggregateNumber(
      'SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as total FROM token_usage',
      'total',
    ),
    totalBooks: count('books'),
    totalHighlights: count('highlights'),
    // 「知识卡片」数的是 knowledge_cards，不是复习队列里的 cards —— 两张表别混
    totalCards: count('knowledge_cards'),
  }
}

export function getTokenUsageLast7Days(): Array<{ date: string; inputTokens: number; outputTokens: number; totalTokens: number }> {
  const db = getDatabase()
  const rows = rowsToObjects(db.exec(`
    SELECT 
      DATE(created_at) as date,
      COALESCE(SUM(input_tokens), 0) as inputTokens,
      COALESCE(SUM(output_tokens), 0) as outputTokens,
      COALESCE(SUM(input_tokens + output_tokens), 0) as totalTokens
    FROM token_usage
    WHERE created_at >= DATE('now', '-7 days')
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `))
  return rows as Array<{ date: string; inputTokens: number; outputTokens: number; totalTokens: number }>
}

/** 运行时真实生效值：系统提示词来自 prompt-storage（agent.system），意图关键词来自 intent-classifier */
export function getAgentConfig(): Record<string, unknown> {
  return {
    systemPrompt: getPromptTemplate('agent.system') || null,
    intentKeywords: getIntentKeywords(),
  }
}

export function getBooksWithCounts(): Array<Record<string, unknown>> {
  const db = getDatabase()
  return rowsToObjects(db.exec(`
    SELECT b.*, COALESCE(hl.highlight_count, 0) as highlight_count
    FROM books b
    LEFT JOIN (
      SELECT book_id, COUNT(*) as highlight_count
      FROM highlights
      GROUP BY book_id
    ) hl ON b.id = hl.book_id
    ORDER BY b.updated_at DESC
  `))
}

export function getHighlightsByBook(bookId: string): Array<Record<string, unknown>> {
  const db = getDatabase()
  return rowsToObjects(db.exec(
    'SELECT * FROM highlights WHERE book_id = ? ORDER BY created_at DESC',
    [bookId]
  ))
}

export function getCardsByBook(bookId: string): Array<Record<string, unknown>> {
  const db = getDatabase()
  // knowledge_cards 自带 book_id，直接查。
  // 旧写法 JOIN highlights ON kc.highlight_id = h.id —— 这张表没有 highlight_id 列
  // （只有 source_highlight_id），SQL 一执行就抛错，后台的卡片区因此永远是空的。
  return rowsToObjects(db.exec(
    `SELECT id, book_id, type, title, content, interpretation, application,
            source_highlight_id, review_count, mastery_level, created_at
     FROM knowledge_cards
     WHERE book_id = ?
     ORDER BY created_at DESC`,
    [bookId]
  ))
}

export function getAdminSessions(): Array<Record<string, unknown>> {
  const db = getDatabase()
  return rowsToObjects(db.exec(`
    SELECT c.*, COALESCE(mc.message_count, 0) as message_count, b.title as book_title
    FROM conversations c
    LEFT JOIN (
      SELECT conversation_id, COUNT(*) as message_count
      FROM chat_messages
      GROUP BY conversation_id
    ) mc ON c.id = mc.conversation_id
    LEFT JOIN books b ON c.book_id = b.id
    ORDER BY c.updated_at DESC
  `))
}

export function getAdminSessionMessages(sessionId: string): Array<Record<string, unknown>> {
  const db = getDatabase()
  return rowsToObjects(db.exec(
    'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
    [sessionId]
  ))
}

export function getAllAdminPrompts(): PromptWithOverride[] {
  return getAllPrompts()
}


export function saveAdminPrompt(id: string, template: string): { success: boolean; error?: string } {
  return savePrompt(id, template)
}

export function resetAdminPrompt(id: string): { success: boolean; error?: string } {
  return resetPrompt(id)
}

export function resetAllAdminPrompts(): { success: boolean; count: number } {
  const before = getAllPrompts().filter(p => p.isCustom).length
  resetAllPrompts()
  return { success: true, count: before }
}

export function exportAdminPrompts(): string {
  return exportPrompts()
}

export function importAdminPrompts(json: string): { success: boolean; imported: number; error?: string } {
  return importPrompts(json)
}

export function getDatabaseSchema(): Array<{ name: string; sql: string }> {
  const db = getDatabase()
  const tables = rowsToObjects(db.exec(
    "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ))
  return tables.map(t => ({ name: String(t.name), sql: String(t.sql || '') }))
}

export function getDatabaseTableData(
  tableName: string,
  limit: number = 50,
  offset: number = 0
): { columns: string[]; rows: Record<string, unknown>[]; total: number } {
  const db = getDatabase()
  const safeName = tableName.replace(/[^a-zA-Z0-9_]/g, '')
  if (!safeName || safeName !== tableName) {
    throw new Error('Invalid table name')
  }
  // 纵深防御：拒绝 SQLite 内部表（sqlite_*），与 getDatabaseSchema 的过滤保持一致
  if (safeName.startsWith('sqlite_')) {
    throw new Error('Invalid table name')
  }
  const total = aggregateNumber(`SELECT COUNT(*) as count FROM "${safeName}"`, 'count')
  const data = rowsToObjects(db.exec(`SELECT * FROM "${safeName}" LIMIT ? OFFSET ?`, [limit, offset]))
  return { columns: data.length > 0 ? Object.keys(data[0]) : [], rows: data, total }
}

// ===== 自定义模板管理 =====

export function createAdminCustomPrompt(name: string, content: string): CustomPrompt {
  return createCustomPrompt(name, content)
}

export function getAllAdminCustomPrompts(): CustomPrompt[] {
  return getAllCustomPrompts()
}

export function updateAdminCustomPrompt(id: string, name: string, content: string): { success: boolean; error?: string } {
  return updateCustomPrompt(id, name, content)
}

export function deleteAdminCustomPrompt(id: string): { success: boolean; error?: string } {
  return deleteCustomPrompt(id)
}
