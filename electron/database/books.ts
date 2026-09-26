/**
 * database/books — 书籍表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 */
import { getDatabase, saveDatabase } from './connection';
import { rowsToObjects } from '../utils/db';
import { assertRealColumns } from './updatable-columns';

export const booksDb = {
  getAll(): Record<string, unknown>[] {
    const result = getDatabase().exec('SELECT * FROM books ORDER BY last_read_time DESC NULLS LAST, updated_at DESC');
    return rowsToObjects(result);
  },

  getById(id: string): Record<string, unknown> | undefined {
    const result = getDatabase().exec('SELECT * FROM books WHERE id = ?', [id]);
    const rows = rowsToObjects(result);
    return rows[0];
  },

  create(book: Record<string, unknown>): void {
    getDatabase().run(
      `INSERT INTO books (id, title, author, cover, isbn, publisher, publish_date, description, category, reading_progress, total_chapter, last_read_time, is_finished)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        book.id,
        book.title,
        book.author ?? null,
        book.cover ?? null,
        book.isbn ?? null,
        book.publisher ?? null,
        book.publish_date ?? null,
        book.description ?? null,
        book.category ?? null,
        book.reading_progress ?? book.progress ?? 0,
        book.total_chapter ?? book.totalChapter ?? 0,
        book.last_read_time ?? book.lastReadTime ?? null,
        book.is_finished ?? book.finishReading ?? 0,
      ]
    );
    saveDatabase();
  },

  update(id: string, book: Record<string, unknown>): void {
    const updatableKeys = assertRealColumns(
      'books',
      Object.keys(book).filter((k) => k !== 'id')
    );
    if (updatableKeys.length === 0) return;
    const setClauses = updatableKeys.map(k => `${k} = ?`).join(', ');
    const values = updatableKeys.map(k => book[k]);
    getDatabase().run(
      `UPDATE books SET ${setClauses}, updated_at = datetime('now') WHERE id = ?`,
      [...values, id]
    );
    saveDatabase();
  },

  delete(id: string): void {
    getDatabase().run('DELETE FROM books WHERE id = ?', [id]);
    saveDatabase();
  },

  updateProgress(id: string, progress: number): void {
    getDatabase().run(
      "UPDATE books SET reading_progress = ?, updated_at = datetime('now') WHERE id = ?",
      [progress, id]
    );
    saveDatabase();
  },

  search(keyword: string): Record<string, unknown>[] {
    const pattern = `%${keyword}%`;
    const result = getDatabase().exec(
      'SELECT * FROM books WHERE title LIKE ? OR author LIKE ?',
      [pattern, pattern]
    );
    return rowsToObjects(result);
  },
};
