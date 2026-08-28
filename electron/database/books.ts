/**
 * database/books — 书籍表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 */
import { getDatabase, saveDatabase, runTransaction } from './connection';
import { rowsToObjects } from '../utils/db';

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

  createBatch(books: Array<Record<string, unknown>>): void {
    runTransaction((database) => {
      const stmt = database.prepare(
        `INSERT OR REPLACE INTO books (id, title, author, cover, isbn, publisher, publish_date, description, category, reading_progress, total_chapter, last_read_time, is_finished)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const book of books) {
        stmt.run([
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
        ]);
      }

      stmt.free();
    });
  },

  update(id: string, book: Record<string, unknown>): void {
    const updatableKeys = Object.keys(book).filter(k => k !== 'id');
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

  deleteBatch(ids: string[]): void {
    runTransaction((database) => {
      const stmt = database.prepare('DELETE FROM books WHERE id = ?');
      for (const id of ids) {
        stmt.run([id]);
      }
      stmt.free();
    });
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

  getByStatus(status: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM books WHERE status = ? ORDER BY updated_at DESC',
      [status]
    );
    return rowsToObjects(result);
  },

  getRecent(limit: number = 10): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM books ORDER BY last_read_time DESC LIMIT ?',
      [limit]
    );
    return rowsToObjects(result);
  },

  count(): number {
    const result = getDatabase().exec('SELECT COUNT(*) FROM books');
    return result.length > 0 ? (result[0].values[0][0] as number) : 0;
  },
};
