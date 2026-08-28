/**
 * database/token-usage — Token 用量表操作
 * 从原 database.ts 拆分而来，逻辑保持不变。
 */
import { getDatabase, saveDatabase, forceSaveDatabase } from './connection';
import { rowsToObjects } from '../utils/db';
import { logger } from '../logger';

export const tokenUsageDb = {
  create(usage: {
    provider: string;
    model: string;
    feature: string;
    inputTokens: number;
    outputTokens: number;
    durationMs?: number;
  }): void {
    const id = `token_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const totalTokens = usage.inputTokens + usage.outputTokens;
    getDatabase().run(
      `INSERT INTO token_usage (id, provider, model, feature, input_tokens, output_tokens, total_tokens, duration_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        usage.provider,
        usage.model,
        usage.feature,
        usage.inputTokens,
        usage.outputTokens,
        totalTokens,
        usage.durationMs || 0,
      ]
    );
    saveDatabase();
  },

  getByDateRange(startDate: string, endDate: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      `SELECT * FROM token_usage
       WHERE date(created_at) BETWEEN ? AND ?
       ORDER BY created_at DESC`,
      [startDate, endDate]
    );
    return rowsToObjects(result);
  },

  getRecent(limit: number = 100): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM token_usage ORDER BY created_at DESC LIMIT ?',
      [limit]
    );
    return rowsToObjects(result);
  },

  getStatsByProvider(): Record<string, unknown>[] {
    const result = getDatabase().exec(`
      SELECT
        provider,
        model,
        COUNT(*) as request_count,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(total_tokens) as total_tokens,
        SUM(duration_ms) as total_duration_ms
      FROM token_usage
      GROUP BY provider, model
      ORDER BY total_tokens DESC
    `);
    return rowsToObjects(result);
  },

  getStatsByFeature(): Record<string, unknown>[] {
    const result = getDatabase().exec(`
      SELECT
        feature,
        COUNT(*) as request_count,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(total_tokens) as total_tokens,
        SUM(duration_ms) as total_duration_ms,
        AVG(duration_ms) as avg_duration_ms
      FROM token_usage
      GROUP BY feature
      ORDER BY total_tokens DESC
    `);
    return rowsToObjects(result);
  },

  getDailyStats(days: number = 7): Record<string, unknown>[] {
    const result = getDatabase().exec(`
      SELECT
        date(created_at) as date,
        COUNT(*) as request_count,
        SUM(input_tokens) as total_input_tokens,
        SUM(output_tokens) as total_output_tokens,
        SUM(total_tokens) as total_tokens
      FROM token_usage
      WHERE created_at >= datetime('now', '-${days} days')
      GROUP BY date(created_at)
      ORDER BY date DESC
    `);
    return rowsToObjects(result);
  },

  getTotalStats(): {
    totalRequests: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalTokens: number;
  } {
    const execScalar = (sql: string): number => {
      const result = getDatabase().exec(sql);
      return result.length > 0 ? (result[0].values[0][0] as number) : 0;
    };

    return {
      totalRequests: execScalar('SELECT COUNT(*) FROM token_usage'),
      totalInputTokens: execScalar('SELECT COALESCE(SUM(input_tokens), 0) FROM token_usage'),
      totalOutputTokens: execScalar('SELECT COALESCE(SUM(output_tokens), 0) FROM token_usage'),
      totalTokens: execScalar('SELECT COALESCE(SUM(total_tokens), 0) FROM token_usage'),
    };
  },

  deleteOlderThan(days: number): void {
    getDatabase().run(
      `DELETE FROM token_usage WHERE created_at < datetime('now', '-${days} days')`
    );
    saveDatabase();
  },

  clearAll(): void {
    getDatabase().run('DELETE FROM token_usage');
    forceSaveDatabase();
    logger.info('All token usage records cleared');
  },
};
