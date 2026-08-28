/**
 * ipc/articles — 每日学习文章 / RSS / 翻译 / 词典 / 生词本 handlers
 * 从原 ipc.ts 拆分而来，逻辑保持不变。
 */
import * as fs from 'fs';
import { dialog, BrowserWindow } from 'electron';
import { articlesDb, vocabularyDb, getDatabase, forceSaveDatabase } from '../database';
import { logger } from '../logger';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';
import { fetchAllRssSources, generateArticleId } from '../rss-fetcher';
import { dictionaryService } from '../dictionary-service';
import { translateArticle } from '../ai-service';
import type { HandleFn } from './types';

export function registerArticleHandlers(handle: HandleFn): void {
  handle(IPC_CHANNELS.ARTICLES.GET_ALL, (limit?: number) => articlesDb.getAll(limit));
  handle(IPC_CHANNELS.ARTICLES.GET_BY_ID, (id: string) => articlesDb.getById(id));
  handle(IPC_CHANNELS.ARTICLES.GET_UNREAD, (limit?: number) => articlesDb.getUnread(limit));
  handle(IPC_CHANNELS.ARTICLES.GET_FAVORITES, (limit?: number) => articlesDb.getFavorites(limit));
  handle(IPC_CHANNELS.ARTICLES.CREATE, (article: Parameters<typeof articlesDb.create>[0]) => articlesDb.create(article));
  handle(IPC_CHANNELS.ARTICLES.MARK_AS_READ, (id: string) => articlesDb.markAsRead(id));
  handle(IPC_CHANNELS.ARTICLES.TOGGLE_FAVORITE, (id: string) => articlesDb.toggleFavorite(id));
  handle(IPC_CHANNELS.ARTICLES.DELETE, (id: string) => articlesDb.delete(id));
  handle(IPC_CHANNELS.ARTICLES.GET_STATS, () => ({
    total: articlesDb.count(),
    today: articlesDb.getTodayCount(),
  }));
  handle(IPC_CHANNELS.ARTICLES.FETCH_RSS, async () => {
    logger.info('Starting RSS fetch...');
    const rssArticles = await fetchAllRssSources();
    logger.info(`Fetched ${rssArticles.length} articles from RSS sources`);
    const savedArticles = [];
    const seenTitles = new Set<string>();
    let duplicateCount = 0;

    for (const article of rssArticles) {
      // 基于标题去重
      const titleKey = article.title.toLowerCase().trim();
      if (seenTitles.has(titleKey)) continue;
      seenTitles.add(titleKey);

      // 检查数据库是否已存在
      const existing = articlesDb.getAll(1000).find(
        (a: Record<string, unknown>) =>
          String(a.title_en || '').toLowerCase().trim() === titleKey
      );
      if (existing) {
        duplicateCount++;
        continue;
      }

      // 生成文章 ID
      const id = generateArticleId(article.source, article.title);

      // 存入数据库
      const created = articlesDb.create({
        id,
        title_en: article.title,
        content_en: article.content || article.description,
        source: article.source,
        source_url: article.link,
        source_website: article.sourceWebsite,
        category: article.category,
        difficulty: article.difficulty,
        published_at: article.pubDate,
      });

      if (created) {
        savedArticles.push({ id, title: article.title, source: article.source });
        logger.info(`Saved article: ${article.title}`);

        // 异步翻译（不阻塞返回）
        const content = article.content || article.description;
        if (content) {
          translateArticle(article.title, content)
            .then(({ title_zh, summary_zh, content_zh }) => {
              const db = getDatabase();
              db.run(
                'UPDATE articles SET title_zh = ?, summary_zh = ?, content_zh = ? WHERE id = ?',
                [title_zh, summary_zh, content_zh, id]
              );
              forceSaveDatabase();
              logger.info('Article translated', { id, title: article.title });
            })
            .catch(err => logger.error('Article translation failed', { error: String(err) }));
        }
      } else {
        logger.error(`Failed to save article: ${article.title}`);
      }
    }

    logger.info(`RSS fetch complete: ${savedArticles.length} new, ${duplicateCount} duplicates`);
    return savedArticles;
  });

  // 按需翻译单篇文章（用户点击触发，避免 RSS 拉取时 silent fail 导致无中文）
  handle(IPC_CHANNELS.ARTICLES.TRANSLATE, async (id: string) => {
    const article = articlesDb.getById(id);
    if (!article) throw new Error('文章不存在');
    const titleEn = String(article.title_en || '');
    const contentEn = String(article.content_en || '');
    if (!titleEn || !contentEn) throw new Error('文章内容为空，无法翻译');

    try {
      const { title_zh, summary_zh, content_zh } = await translateArticle(titleEn, contentEn);
      const db = getDatabase();
      db.run(
        'UPDATE articles SET title_zh = ?, summary_zh = ?, content_zh = ? WHERE id = ?',
        [title_zh, summary_zh, content_zh, id]
      );
      forceSaveDatabase();
      logger.info('Article translated on demand', { id });
      return { title_zh, summary_zh, content_zh };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('not configured') || msg.includes('AI service')) {
        throw new Error('AI 服务未配置，请前往「设置 > AI 模型」配置 API Key 后重试');
      }
      throw error;
    }
  });

  // 本地词典查询
  handle(IPC_CHANNELS.DICTIONARY.LOOKUP, (word: string) => {
    return dictionaryService.lookup(word);
  });
  handle(IPC_CHANNELS.DICTIONARY.LOOKUP_BATCH, (words: string[]) => {
    const results = dictionaryService.lookupBatch(words);
    return Object.fromEntries(results);
  });
  handle(IPC_CHANNELS.DICTIONARY.GET_SIZE, () => dictionaryService.getSize());

  // 生词本
  handle(IPC_CHANNELS.VOCABULARY.GET_ALL, (limit?: number) => vocabularyDb.getAll(limit));
  handle(IPC_CHANNELS.VOCABULARY.GET_BY_ID, (id: string) => vocabularyDb.getById(id));
  handle(IPC_CHANNELS.VOCABULARY.GET_BY_WORD, (word: string) => vocabularyDb.getByWord(word));
  handle(IPC_CHANNELS.VOCABULARY.GET_UNMASTERED, (limit?: number) => vocabularyDb.getUnmastered(limit));
  handle(IPC_CHANNELS.VOCABULARY.GET_DUE_FOR_REVIEW, (limit?: number) => vocabularyDb.getDueForReview(limit));
  handle(IPC_CHANNELS.VOCABULARY.CREATE, (vocab: Parameters<typeof vocabularyDb.create>[0]) => vocabularyDb.create(vocab));
  handle(IPC_CHANNELS.VOCABULARY.CREATE_FROM_LOOKUP, (word: string, source?: string) => {
    // 先查词典获取翻译
    const dictEntry = dictionaryService.lookup(word);
    if (!dictEntry) {
      throw new Error('词典未收录该单词');
    }
    // 检查是否已存在
    const existing = vocabularyDb.getByWord(word);
    if (existing) {
      // 返回 null 表示已存在，让前端区分"已存在"和"新添加"
      return null;
    }
    // 创建生词记录
    return vocabularyDb.create({
      word: dictEntry.word,
      meaning_zh: dictEntry.translation,
      translation: dictEntry.translation,
      phonetic: dictEntry.phonetic,
      pos: dictEntry.pos,
      source: source || '手动添加',
    });
  });
  handle(IPC_CHANNELS.VOCABULARY.MARK_AS_MASTERED, (id: string) => vocabularyDb.markAsMastered(id));
  handle(IPC_CHANNELS.VOCABULARY.INCREMENT_REVIEW, (id: string) => vocabularyDb.incrementReviewCount(id));
  handle(IPC_CHANNELS.VOCABULARY.UPDATE_REVIEW_DATA, (id: string, reviewData: Record<string, unknown>) => vocabularyDb.updateReviewData(id, reviewData as { quality: number; efFactor?: number; intervalDays?: number; repetitionCount?: number; isMastered?: boolean }));
  handle(IPC_CHANNELS.VOCABULARY.DELETE, (id: string) => vocabularyDb.delete(id));
  handle(IPC_CHANNELS.VOCABULARY.GET_STATS, () => ({
    total: vocabularyDb.count(),
    mastered: vocabularyDb.getMasteredCount(),
    dueToday: vocabularyDb.getDueCount(),
  }));
  handle(IPC_CHANNELS.VOCABULARY.SEARCH, (keyword: string) => vocabularyDb.search(keyword));
  handle(IPC_CHANNELS.VOCABULARY.EXPORT, async (format: 'csv' | 'anki', items: Array<{
    word: string;
    phonetic?: string;
    part_of_speech?: string;
    meaning_zh: string;
    example_en?: string;
    example_zh?: string;
  }>) => {
    if (format !== 'csv' && format !== 'anki') {
      throw new Error('不支持的导出格式，仅支持 csv 或 anki');
    }
    if (!Array.isArray(items) || items.length === 0) {
      throw new Error('没有可导出的生词');
    }
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const isCsv = format === 'csv';
    const filters = isCsv
      ? [{ name: 'CSV', extensions: ['csv'] }]
      : [{ name: 'Anki TSV', extensions: ['txt'] }];
    const result = await dialog.showSaveDialog(win, {
      title: '导出生词本',
      defaultPath: isCsv ? 'vocabulary.csv' : 'vocabulary.txt',
      filters,
    });
    if (result.canceled || !result.filePath) {
      return { saved: false, count: 0 };
    }

    // 防御 CSV 公式注入：= + - @ 开头的单元格前置单引号
    const sanitize = (val: unknown): string => {
      const s = val == null ? '' : String(val);
      if (s && /^[=+\-@]/.test(s)) {
        return `'${s}`;
      }
      return s;
    };
    // CSV 字段转义：含 " , \n \r 的字段用双引号包裹，内部双引号转义为 ""
    const csvEscape = (val: unknown): string => {
      const s = sanitize(val);
      if (/[",\n\r]/.test(s)) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    // Anki TSV 字段转义：制表符/换行替换为空格
    const tsvEscape = (val: unknown): string => {
      const s = sanitize(val);
      return s.replace(/[\t\n\r]/g, ' ');
    };

    let content: string;
    if (isCsv) {
      // UTF-8 BOM 防止 Excel 乱码
      const bom = '\uFEFF';
      const header = ['单词', '音标', '词性', '释义', '例句', '例句翻译'].map(csvEscape).join(',');
      const rows = items.map((it) =>
        [it.word, it.phonetic ?? '', it.part_of_speech ?? '', it.meaning_zh, it.example_en ?? '', it.example_zh ?? '']
          .map(csvEscape)
          .join(','),
      );
      content = `${bom}${header}\n${rows.join('\n')}\n`;
    } else {
      // Anki TSV: front \t back \t tags
      const rows = items.map((it) => {
        const front = tsvEscape(it.word);
        const back = tsvEscape(
          [it.part_of_speech, it.meaning_zh, it.example_en, it.example_zh]
            .filter((x) => x && String(x).trim().length > 0)
            .join('<br>'),
        );
        const tags = 'zhixing-reader';
        return `${front}\t${back}\t${tags}`;
      });
      content = `# Anki 导入文件（制表符分隔）\n# 标签字段以空格分隔\n${rows.join('\n')}\n`;
    }

    fs.writeFileSync(result.filePath, content, 'utf8');
    logger.info(`Vocabulary exported`, { format, count: items.length, path: result.filePath });
    return { saved: true, count: items.length, path: result.filePath };
  });
}
