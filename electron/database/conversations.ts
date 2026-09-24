/**
 * database/conversations — AI 对话与会话消息表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 */
import { getDatabase, saveDatabase, runTransaction } from './connection';
import { rowsToObjects } from '../utils/db';

/** update() 允许写入的列白名单（列名会拼入 SQL，必须过滤） */
const UPDATABLE_COLUMNS = new Set(['title', 'book_id', 'message_count', 'updated_at']);

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
    const updatableKeys = Object.keys(data).filter(k => k !== 'id' && UPDATABLE_COLUMNS.has(k));
    if (updatableKeys.length === 0) return;
    const setClauses = updatableKeys.map(k => `${k} = ?`).join(', ');
    const values = updatableKeys.map(k => data[k]);
    getDatabase().run(
      `UPDATE conversations SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    );
    saveDatabase();
  },

  delete(id: string): void {
    // 两条 DELETE 需原子执行：先删消息再删会话，中途失败整体回滚
    runTransaction((database) => {
      database.run('DELETE FROM chat_messages WHERE conversation_id = ?', [id]);
      database.run('DELETE FROM conversations WHERE id = ?', [id]);
    });
  },

  addMessage(conversationId: string, message: Record<string, unknown>): string {
    const id = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    // INSERT 消息与 UPDATE 会话计数需原子执行，避免计数与实际消息数漂移
    runTransaction((database) => {
      database.run(
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
      database.run(
        "UPDATE conversations SET message_count = message_count + 1, updated_at = datetime('now') WHERE id = ?",
        [conversationId]
      );
    });
    return id;
  },

  // 删除单条消息（「重新生成」移除旧 assistant 回复用）：
  // DELETE 消息与回退会话计数需原子执行，避免 message_count 与实际漂移（B12）
  deleteMessage(messageId: string): void {
    runTransaction((database) => {
      const rows = database.exec(
        'SELECT conversation_id FROM chat_messages WHERE id = ?', [messageId]
      );
      const convId = rows[0]?.values[0]?.[0] as string | undefined;
      database.run('DELETE FROM chat_messages WHERE id = ?', [messageId]);
      if (convId) {
        database.run(
          "UPDATE conversations SET message_count = MAX(message_count - 1, 0), updated_at = datetime('now') WHERE id = ?",
          [convId]
        );
      }
    });
  },

  getMessages(conversationId: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM chat_messages WHERE conversation_id = ? ORDER BY created_at ASC',
      [conversationId]
    );
    return rowsToObjects(result);
  },

  // 滚动摘要（Token 优化 Step 3）：读取会话历史摘要（跨重启持久）
  getHistorySummary(conversationId: string): string | null {
    const rows = rowsToObjects(getDatabase().exec(
      'SELECT history_summary FROM conversations WHERE id = ?', [conversationId]
    ));
    const val = rows[0]?.history_summary;
    return val != null ? String(val) : null;
  },

  // 滚动摘要：写入/更新会话历史摘要（增量更新，非每次重算）
  setHistorySummary(conversationId: string, summary: string): void {
    getDatabase().run(
      'UPDATE conversations SET history_summary = ? WHERE id = ?',
      [summary, conversationId]
    );
    saveDatabase();
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

  /**
   * 跨会话取出被收藏的 AI 回复（最新的在前）。
   *
   * 会话标题一起带出来：收藏列表必须说清"这条出自哪次对话"，
   * 否则用户看到一堆片段还是找不到回去的路。
   */
  getBookmarked(limit: number = 200): Record<string, unknown>[] {
    const result = getDatabase().exec(
      `SELECT m.id, m.conversation_id, m.content, m.created_at,
              c.title AS conversation_title
       FROM chat_messages m
       JOIN conversations c ON m.conversation_id = c.id
       WHERE m.bookmarked = 1
       ORDER BY m.created_at DESC LIMIT ?`,
      [limit]
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
