import { getDatabase } from './database'
import { rowsToObjects } from './utils/db'
import { logger } from './logger'
import { settingsService } from './services/settings-service'
import {
  getAllPrompts,
  getPrompt,
  savePrompt,
  resetPrompt,
  resetAllPrompts,
  exportPrompts,
  importPrompts,
  PromptWithOverride,
} from './services/prompt-storage'

export function getAdminStats(): Record<string, unknown> {
  const db = getDatabase()

  const totalConversations = rowsToObjects(db.exec('SELECT COUNT(*) as count FROM conversations'))
  const totalMessages = rowsToObjects(db.exec('SELECT COUNT(*) as count FROM chat_messages'))
  const totalTokens = rowsToObjects(db.exec('SELECT COALESCE(SUM(input_tokens + output_tokens), 0) as total FROM token_usage'))
  const totalBooks = rowsToObjects(db.exec('SELECT COUNT(*) as count FROM books'))
  const totalHighlights = rowsToObjects(db.exec('SELECT COUNT(*) as count FROM highlights'))
  const totalCards = rowsToObjects(db.exec('SELECT COUNT(*) as count FROM knowledge_cards'))

  return {
    totalConversations: totalConversations[0]?.count ?? 0,
    totalMessages: totalMessages[0]?.count ?? 0,
    totalTokens: totalTokens[0]?.total ?? 0,
    totalBooks: totalBooks[0]?.count ?? 0,
    totalHighlights: totalHighlights[0]?.count ?? 0,
    totalCards: totalCards[0]?.count ?? 0,
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

export function getAgentConfig(): Record<string, unknown> {
  const settings = settingsService.getAll()
  return {
    systemPrompt: settings.admin_system_prompt || null,
    intentKeywords: settings.admin_intent_keywords || null,
  }
}

export function saveAgentConfig(key: string, value: unknown): void {
  settingsService.set(key, value)
  logger.info('Admin config saved', { key })
}

export function resetAgentConfig(key: string): void {
  settingsService.set(key, undefined)
  logger.info('Admin config reset to default', { key })
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
  return rowsToObjects(db.exec(`
    SELECT kc.*, h.content as highlight_content, h.book_id
    FROM knowledge_cards kc
    JOIN highlights h ON kc.highlight_id = h.id
    WHERE h.book_id = ?
    ORDER BY kc.created_at DESC
  `, [bookId]))
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

export function getAdminPrompt(id: string): PromptWithOverride | undefined {
  return getPrompt(id)
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
  const totalRows = rowsToObjects(db.exec(`SELECT COUNT(*) as count FROM "${safeName}"`))
  const total = Number(totalRows[0]?.count ?? 0)
  const data = rowsToObjects(db.exec(`SELECT * FROM "${safeName}" LIMIT ? OFFSET ?`, [limit, offset]))
  const columns = data.length > 0 ? Object.keys(data[0]) : []
  return { columns, rows: data, total }
}
