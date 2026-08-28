/**
 * database/conversations — AI 对话与会话消息表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 */
import { getDatabase, saveDatabase } from './connection';
import { rowsToObjects } from '../utils/db';

export const conversationDb = {
  create(title?: string, bookId?: string): Record<string, unknown> {
    const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const defaultTitle = title || '新对话';
    getDatabase().run(
      'INSERT INTO conversations (id, title, book_id) VALUES (?, ?, ?)',
      [id, defaultTitle, bookId ?? null]
    );
    saveDatabase();
    return { id, title: defaultTitle, book_id: bookId ?? null, message_count: 0, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  },

  getAll(): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM conversations ORDER BY updated_at DESC'
    );
    return rowsToObjects(result);
  },

  getById(id: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec(
      'SELECT * FROM conversations WHERE id = ?', [id]
    );
    const rows = rowsToObjects(result);
    return rows[0];
  },

  update(id: string, data: Record<string, unknown>): void {
    const updatableKeys = Object.keys(data).filter(k => k !== 'id');
    const setClauses = updatableKeys.map(k => `${k} = ?`).join(', ');
    const values = updatableKeys.map(k => data[k]);
    getDatabase().run(
      `UPDATE conversations SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    );
    saveDatabase();
  },

  delete(id: string): void {
    getDatabase().run('DELETE FROM chat_messages WHERE conversation_id = ?', [id]);
    getDatabase().run('DELETE FROM conversations WHERE id = ?', [id]);
    saveDatabase();
  },

  addMessage(conversationId: string, message: Record<string, unknown>): string {
    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    getDatabase().run(
      `INSERT INTO chat_messages (id, conversation_id, role, content, intent, tools_used, bloom_level, mastery_assessment, sources)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        conversationId,
        message.role,
        message.content,
        message.intent ?? null,
        message.tools_used ? JSON.stringify(message.tools_used) : null,
        message.bloom_level ?? null,
        message.mastery_assessment ? JSON.stringify(message.mastery_assessment) : null,
        message.sources ? JSON.stringify(message.sources) : null,
      ]
    );
    getDatabase().run(
      "UPDATE conversations SET message_count = message_count + 1, updated_at = datetime('now') WHERE id = ?",
      [conversationId]
    );
    saveDatabase();
    return id;
  },

  getMessages(conversationId: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversationId]
    );
    return rowsToObjects(result);
  },

  search(keyword: string): Record<string, unknown>[] {
    const pattern = `%${keyword}%`;
    const result = getDatabase().exec(
      `SELECT DISTINCT c.* FROM conversations c
       JOIN chat_messages m ON c.id = m.conversation_id
       WHERE c.title LIKE ? OR m.content LIKE ?
       ORDER BY c.updated_at DESC`,
      [pattern, pattern]
    );
    return rowsToObjects(result);
  },

  // 点赞：liked 用 INTEGER 0/1 存储（SQLite 无原生 BOOLEAN）
  setLike(messageId: string, liked: boolean): void {
    getDatabase().run(
      'UPDATE chat_messages SET liked = ? WHERE id = ?',
      [liked ? 1 : 0, messageId]
    );
    saveDatabase();
  },

  // 收藏：bookmarked 用 INTEGER 0/1 存储
  setBookmark(messageId: string, bookmarked: boolean): void {
    getDatabase().run(
      'UPDATE chat_messages SET bookmarked = ? WHERE id = ?',
      [bookmarked ? 1 : 0, messageId]
    );
    saveDatabase();
  },
};
