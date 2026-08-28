/**
 * database/book-architecture — 书籍架构表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 */
import { getDatabase, saveDatabase } from './connection';
import { rowsToObjects } from '../utils/db';

export const bookArchitectureDb = {
  create(architecture: Record<string, unknown>): void {
    getDatabase().run(
      `INSERT INTO book_architecture (id, book_id, core_proposition, cognitive_framework, methodology_architecture, knowledge_hierarchy, target_audience)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        architecture.id,
        architecture.book_id ?? architecture.bookId,
        architecture.core_proposition ?? architecture.coreProposition ?? null,
        architecture.cognitive_framework ?? architecture.cognitiveFramework ? JSON.stringify(architecture.cognitive_framework ?? architecture.cognitiveFramework) : null,
        architecture.methodology_architecture ?? architecture.methodologyArchitecture ? JSON.stringify(architecture.methodology_architecture ?? architecture.methodologyArchitecture) : null,
        architecture.knowledge_hierarchy ?? architecture.knowledgeHierarchy ? JSON.stringify(architecture.knowledge_hierarchy ?? architecture.knowledgeHierarchy) : null,
        architecture.target_audience ?? architecture.targetAudience ?? null,
      ]
    );
    saveDatabase();
  },

  getById(id: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec('SELECT * FROM book_architecture WHERE id = ?', [id]);
    const rows = rowsToObjects(result);
    return rows[0];
  },

  getByBookId(bookId: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec(
      'SELECT * FROM book_architecture WHERE book_id = ?',
      [bookId]
    );
    const rows = rowsToObjects(result);
    return rows[0];
  },

  update(id: string, architecture: Record<string, unknown>): void {
    const updatableKeys = Object.keys(architecture).filter(k => k !== 'id');
    const setClauses = updatableKeys.map(k => `${k} = ?`).join(', ');
    const values = updatableKeys.map(k => {
      const val = architecture[k];
      if (typeof val === 'object' && val !== null) return JSON.stringify(val);
      return val;
    });
    getDatabase().run(
      `UPDATE book_architecture SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    );
    saveDatabase();
  },

  delete(id: string): void {
    getDatabase().run('DELETE FROM book_architecture WHERE id = ?', [id]);
    saveDatabase();
  },
};
