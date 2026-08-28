/**
 * database/reviews — 复习记录表操作（FSRS 评分调度入口）
 * 从原 database.ts 拆分而来，逻辑保持不变。
 * 依赖 cards（读写卡片调度状态）与 daily-stats（喂每日统计数据）。
 */
import { getDatabase, saveDatabase } from './connection';
import { rowsToObjects } from '../utils/db';
import { Card, reviewCard, Rating } from '../fsrs-engine';
import { cardsDb } from './cards';
import { dailyStatsDb } from './daily-stats';

export const reviewsDb = {
  create(cardId: string, rating: Rating): { reviewId: string; card: Card } {
    const card = cardsDb.getById(cardId);
    if (!card) throw new Error('Card not found');

    const newCard = reviewCard(card, rating);
    cardsDb.update(newCard);

    const reviewId = `review_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    getDatabase().run(
      `INSERT INTO reviews (id, card_id, rating, elapsed_days, scheduled_days)
       VALUES (?, ?, ?, ?, ?)`,
      [reviewId, cardId, rating, newCard.elapsedDays, newCard.scheduledDays]
    );
    // Feed daily_stats so streak / profile reading data is not empty
    try {
      dailyStatsDb.incrementCardsReviewed(1);
    } catch {
      // ignore if daily_stats unavailable
    }
    saveDatabase();

    return { reviewId, card: newCard };
  },

  getByCardId(cardId: string): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM reviews WHERE card_id = ? ORDER BY review_time DESC',
      [cardId]
    );
    return rowsToObjects(result);
  },

  getRecent(limit: number = 50): Record<string, unknown>[] {
    const result = getDatabase().exec(
      'SELECT * FROM reviews ORDER BY review_time DESC LIMIT ?',
      [limit]
    );
    return rowsToObjects(result);
  },
};
