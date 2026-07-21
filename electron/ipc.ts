import { ipcMain, IpcMainInvokeEvent, shell, app } from 'electron';
import { booksDb, highlightsDb, cardsDb, reviewsDb, bookSummariesDb, dailyStatsDb, tokenUsageDb, conversationDb, methodologiesDb, knowledgeCardsDb, bookArchitectureDb, articlesDb, vocabularyDb, forceSaveDatabase, getDatabase, clearConversationsAndMessages, resetDatabase } from './database';
import { setApiKey, getBookshelf, fetchBookmarks, fetchNotes, fetchAllContent, fetchAllContentBatch, testConnection as testWereadConnection, clearCache as clearWeReadApiCache, fetchReadingData, ReadingMode } from './weread-api';
import { setAIConfig, generateCards, generateSummary, chatWithContext, explainHighlight, testConnection as testAIConnection, extractMethodologies, analyzeBookArchitecture, distillKnowledgeCards as _distillKnowledgeCards, generateCardInterpretation, generateCardApplication, generateSkill, generateSkillBatch, streamChat, cancelActiveStream, translateArticle } from './ai-service';
import { Rating, setCustomParameters, resetParameters, getParameters, calculateStats as _calculateStats, getForecast, getOptimalReviewOrder, previewReviewRatings, cardFromDb } from './fsrs-engine';
import { logger } from './logger';
import { IPC_CHANNELS } from '../src/shared/ipc-channels';
import { settingsService } from './services/settings-service';
import { knowledgeCardService } from './services/knowledge-card-service';
import { fetchAllRssSources, generateArticleId } from './rss-fetcher';
import { dictionaryService } from './dictionary-service';
import * as admin from './admin';
import { processMessageStream } from './agent/orchestrator';
import { indexHighlight as indexHighlightRAG } from './services/rag-service';

function handle(channel: string, handler: (...args: any[]) => Promise<unknown> | unknown): void {
  ipcMain.handle(channel, async (_event: IpcMainInvokeEvent, ...args: unknown[]) => {
    try {
      logger.debug(`IPC: ${channel}`, { args });
      const result = await handler(...args);
      return { success: true, data: result };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`IPC Error: ${channel}`, { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  });
}

export function registerIpcHandlers(): void {
  handle(IPC_CHANNELS.BOOKS.GET_ALL, () => booksDb.getAll());
  handle(IPC_CHANNELS.BOOKS.GET_BY_ID, (id: string) => booksDb.getById(id));
  handle(IPC_CHANNELS.BOOKS.CREATE, (book: Record<string, unknown>) => booksDb.create(book));
  handle(IPC_CHANNELS.BOOKS.UPDATE, (id: string, book: Record<string, unknown>) => booksDb.update(id, book));
  handle(IPC_CHANNELS.BOOKS.DELETE, (id: string) => booksDb.delete(id));
  handle(IPC_CHANNELS.BOOKS.UPDATE_PROGRESS, (id: string, progress: number) => booksDb.updateProgress(id, progress));
  handle(IPC_CHANNELS.BOOKS.SEARCH, (keyword: string) => booksDb.search(keyword));

  handle(IPC_CHANNELS.HIGHLIGHTS.GET_BY_BOOK, (bookId: string) => highlightsDb.getByBookId(bookId));
  handle(IPC_CHANNELS.HIGHLIGHTS.GET_BY_ID, (id: string) => highlightsDb.getById(id));
  handle(IPC_CHANNELS.HIGHLIGHTS.CREATE, (highlight: Record<string, unknown>) => {
    const id = (highlight.id as string) || `hl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const bookId = highlight.book_id ?? highlight.bookId;
    const created = highlightsDb.create({
      id,
      book_id: bookId,
      chapter_title: highlight.chapter_title ?? highlight.chapterTitle ?? null,
      content: highlight.content,
      note: highlight.note ?? null,
      style: highlight.style ?? 0,
      range_start: highlight.range_start ?? highlight.rangeStart ?? null,
      range_end: highlight.range_end ?? highlight.rangeEnd ?? null,
    });

    // Auto-index to vector DB in background (fire-and-forget)
    if (created) {
      // Single-create path used by bookshelf import — also create FSRS card (batch path already does)
      try {
        if (!cardsDb.getByHighlightId(id)) {
          cardsDb.create(id);
        }
      } catch (cardErr) {
        logger.error('Auto-create FSRS card failed', { highlightId: id, error: String(cardErr) });
      }

      const books = booksDb.getAll();
      const book = books.find(b => b.id === bookId);
      indexHighlightRAG({
        id,
        bookId: bookId as string,
        bookTitle: (book?.title as string) || 'Unknown',
        content: highlight.content as string,
        chapterTitle: (highlight.chapter_title ?? highlight.chapterTitle) as string | undefined,
        createdAt: new Date().toISOString(),
      }).catch(() => {})
    }

    return created;
  });
  handle(IPC_CHANNELS.HIGHLIGHTS.UPDATE, (id: string, highlight: Record<string, unknown>) => highlightsDb.update(id, highlight));
  handle(IPC_CHANNELS.HIGHLIGHTS.DELETE, (id: string) => highlightsDb.delete(id));
  handle(IPC_CHANNELS.HIGHLIGHTS.GET_ALL, () => highlightsDb.getAll());
  handle(IPC_CHANNELS.HIGHLIGHTS.SEARCH, (keyword: string) => highlightsDb.search(keyword));

  handle(IPC_CHANNELS.CARDS.GET_BY_HIGHLIGHT, (highlightId: string) => cardsDb.getByHighlightId(highlightId));
  handle(IPC_CHANNELS.CARDS.GET_BY_ID, (id: string) => cardsDb.getById(id));
  handle(IPC_CHANNELS.CARDS.CREATE, (highlightId: string) => cardsDb.create(highlightId));
  handle(IPC_CHANNELS.CARDS.CREATE_BATCH, (highlightIds: string[]) => cardsDb.createBatch(highlightIds));
  handle(IPC_CHANNELS.CARDS.CREATE_FOR_EXISTING, () => cardsDb.createForExistingHighlights());
  handle(IPC_CHANNELS.CARDS.UPDATE, (card: Record<string, unknown>) => cardsDb.update(card as unknown as Parameters<typeof cardsDb.update>[0]));
  handle(IPC_CHANNELS.CARDS.UPDATE_APPLICATION_TAG, (id: string, tag: string) => cardsDb.updateApplicationTag(id, tag));
  handle(IPC_CHANNELS.CARDS.UPDATE_MASTERY_LEVEL, (id: string, level: number) => cardsDb.updateMasteryLevel(id, level));
  handle(IPC_CHANNELS.CARDS.DELETE, (id: string) => cardsDb.delete(id));
  handle(IPC_CHANNELS.CARDS.GET_DUE, (limit?: number) => cardsDb.getDueCards(limit));
  handle(IPC_CHANNELS.CARDS.GET_BY_BOOK, (bookId: string) => cardsDb.getByBookId(bookId));
  handle(IPC_CHANNELS.CARDS.GET_STATS, () => cardsDb.getReviewStats());

  handle(IPC_CHANNELS.REVIEWS.CREATE, (cardId: string, rating: Rating) => reviewsDb.create(cardId, rating));
  handle(IPC_CHANNELS.REVIEWS.GET_BY_CARD, (cardId: string) => reviewsDb.getByCardId(cardId));
  handle(IPC_CHANNELS.REVIEWS.GET_RECENT, (limit?: number) => reviewsDb.getRecent(limit));

  // 每日学习文章
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

  // 本地词典查询
  handle(IPC_CHANNELS.DICTIONARY.LOOKUP, (word: string) => {
    return dictionaryService.lookup(word);
  });
  handle(IPC_CHANNELS.DICTIONARY.LOOKUP_BATCH, (words: string[]) => {
    const results = dictionaryService.lookupBatch(words);
    return Object.fromEntries(results);
  });
  handle(IPC_CHANNELS.DICTIONARY.GET_SIZE, () => dictionaryService.getSize());

  handle(IPC_CHANNELS.SUMMARIES.GET_BY_BOOK, (bookId: string) => bookSummariesDb.getByBookId(bookId));
  handle(IPC_CHANNELS.SUMMARIES.CREATE, (bookId: string, summary: string, keyPoints?: string) =>
    bookSummariesDb.create(bookId, summary, keyPoints)
  );
  handle(IPC_CHANNELS.SUMMARIES.DELETE, (bookId: string) => bookSummariesDb.delete(bookId));

  handle(IPC_CHANNELS.DAILY_STATS.GET_TODAY, () => dailyStatsDb.getToday());
  handle(IPC_CHANNELS.DAILY_STATS.GET_RANGE, (startDate: string, endDate: string) =>
    dailyStatsDb.getRange(startDate, endDate)
  );
  handle(IPC_CHANNELS.DAILY_STATS.INCREMENT_BOOKS, () => dailyStatsDb.incrementBooksRead());
  handle(IPC_CHANNELS.DAILY_STATS.INCREMENT_HIGHLIGHTS, (count?: number) =>
    dailyStatsDb.incrementHighlightsAdded(count)
  );
  handle(IPC_CHANNELS.DAILY_STATS.INCREMENT_CARDS, (count?: number) =>
    dailyStatsDb.incrementCardsReviewed(count)
  );
  handle(IPC_CHANNELS.DAILY_STATS.ADD_READING_TIME, (seconds: number) =>
    dailyStatsDb.addReadingTime(seconds)
  );

  handle(IPC_CHANNELS.WEREAD.SET_API_KEY, (apiKey: string) => setApiKey(apiKey));
  handle(IPC_CHANNELS.WEREAD.GET_BOOKSHELF, () => getBookshelf());
  handle(IPC_CHANNELS.WEREAD.FETCH_BOOKMARKS, (bookId: string) => fetchBookmarks(bookId));
  handle(IPC_CHANNELS.WEREAD.FETCH_NOTES, (bookId: string) => fetchNotes(bookId));
  handle(IPC_CHANNELS.WEREAD.FETCH_ALL_CONTENT, (bookId: string) => fetchAllContent(bookId));

  handle(IPC_CHANNELS.AI.SET_CONFIG, (config: Record<string, unknown>) => setAIConfig(config as unknown as Parameters<typeof setAIConfig>[0]));
  handle(IPC_CHANNELS.AI.GENERATE_CARDS, (highlights: Array<{ content: string; note?: string }>, bookTitle: string) =>
    generateCards(highlights, bookTitle)
  );
  handle(IPC_CHANNELS.AI.GENERATE_SUMMARY, (highlights: Array<{ content: string; chapterTitle?: string }>, bookTitle: string) =>
    generateSummary(highlights, bookTitle)
  );
  handle(IPC_CHANNELS.AI.CHAT, (question: string, context: Array<{ content: string; bookTitle?: string }>) =>
    chatWithContext(question, context)
  );
  handle(IPC_CHANNELS.AI.EXPLAIN, (content: string, bookTitle: string, chapterTitle?: string) =>
    explainHighlight(content, bookTitle, chapterTitle)
  );
  handle(IPC_CHANNELS.AI.TEST, (config: Record<string, unknown>) => testAIConnection(config as unknown as Parameters<typeof testAIConnection>[0]));

  ipcMain.handle(IPC_CHANNELS.AGENT.STREAM_CHAT, async (event, params: { messages: Array<{role: string; content: string}> }) => {
    await streamChat(
      params.messages as Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
      (chunk: string) => {
        event.sender.send(IPC_CHANNELS.STREAM.CHUNK, { chunk });
      },
      (usage) => {
        event.sender.send(IPC_CHANNELS.STREAM.COMPLETE, { usage });
      },
      (error: Error) => {
        event.sender.send(IPC_CHANNELS.STREAM.ERROR, { error: error.message });
      }
    );

    return { success: true };
  });

  handle(IPC_CHANNELS.AGENT.CANCEL_STREAM, () => {
    const aborted = cancelActiveStream()
    logger.info('Stream cancel requested', { aborted })
    return { aborted }
  })

  ipcMain.handle(IPC_CHANNELS.AGENT.STREAM_CHAT_WITH_CONTEXT, async (event, params: {
    sessionId: string
    bookId?: string
    userMessage: string
    conversationHistory: Array<{ role: string; content: string }>
  }) => {
    await processMessageStream(
      {
        sessionId: params.sessionId,
        bookId: params.bookId,
        conversationHistory: params.conversationHistory,
      },
      params.userMessage,
      (chunk: string) => {
        event.sender.send(IPC_CHANNELS.STREAM.CHUNK, { chunk })
      },
      (usage) => {
        event.sender.send(IPC_CHANNELS.STREAM.COMPLETE, { usage })
      },
      (error: Error) => {
        event.sender.send(IPC_CHANNELS.STREAM.ERROR, { error: error.message })
      }
    )

    return { success: true }
  });

  handle(IPC_CHANNELS.CONVERSATIONS.CREATE, (title?: string, bookId?: string) => conversationDb.create(title, bookId));
  handle(IPC_CHANNELS.CONVERSATIONS.GET_ALL, () => conversationDb.getAll());
  handle(IPC_CHANNELS.CONVERSATIONS.GET_BY_ID, (id: string) => conversationDb.getById(id));
  handle(IPC_CHANNELS.CONVERSATIONS.UPDATE, (id: string, data: Record<string, unknown>) => conversationDb.update(id, data));
  handle(IPC_CHANNELS.CONVERSATIONS.DELETE, (id: string) => conversationDb.delete(id));
  handle(IPC_CHANNELS.CONVERSATIONS.ADD_MESSAGE, (conversationId: string, message: Record<string, unknown>) => conversationDb.addMessage(conversationId, message));
  handle(IPC_CHANNELS.CONVERSATIONS.GET_MESSAGES, (conversationId: string) => conversationDb.getMessages(conversationId));
  handle(IPC_CHANNELS.CONVERSATIONS.SEARCH, (keyword: string) => conversationDb.search(keyword));

  // Admin handlers
  handle(IPC_CHANNELS.ADMIN.GET_STATS, () => {
    const stats = admin.getAdminStats()
    const tokenTrend = admin.getTokenUsageLast7Days()
    const recentSessions = admin.getAdminSessions().slice(0, 5)
    return { stats, tokenTrend, recentSessions }
  })
  handle(IPC_CHANNELS.ADMIN.GET_AGENT_CONFIG, () => {
    return admin.getAgentConfig()
  })
  handle(IPC_CHANNELS.ADMIN.SAVE_AGENT_CONFIG, (key: string, value: unknown) => {
    return admin.saveAgentConfig(key, value)
  })
  handle(IPC_CHANNELS.ADMIN.RESET_AGENT_CONFIG, (key: string) => {
    return admin.resetAgentConfig(key)
  })
  handle(IPC_CHANNELS.ADMIN.GET_BOOKS_WITH_COUNTS, () => {
    return admin.getBooksWithCounts()
  })
  handle(IPC_CHANNELS.ADMIN.GET_HIGHLIGHTS_BY_BOOK, (bookId: string) => {
    return admin.getHighlightsByBook(bookId)
  })
  handle(IPC_CHANNELS.ADMIN.GET_CARDS_BY_BOOK, (bookId: string) => {
    return admin.getCardsByBook(bookId)
  })
  handle(IPC_CHANNELS.ADMIN.GET_SESSIONS, () => {
    return admin.getAdminSessions()
  })
  handle(IPC_CHANNELS.ADMIN.GET_SESSION_MESSAGES, (sessionId: string) => {
    return admin.getAdminSessionMessages(sessionId)
  })
  handle(IPC_CHANNELS.ADMIN.GET_PROMPTS, () => {
    return admin.getAllAdminPrompts()
  })
  handle(IPC_CHANNELS.ADMIN.GET_PROMPT, (id: string) => {
    return admin.getAdminPrompt(id)
  })
  handle(IPC_CHANNELS.ADMIN.SAVE_PROMPT, (id: string, template: string) => {
    return admin.saveAdminPrompt(id, template)
  })
  handle(IPC_CHANNELS.ADMIN.RESET_PROMPT, (id: string) => {
    return admin.resetAdminPrompt(id)
  })
  handle(IPC_CHANNELS.ADMIN.RESET_ALL_PROMPTS, () => {
    return admin.resetAllAdminPrompts()
  })
  handle(IPC_CHANNELS.ADMIN.EXPORT_PROMPTS, () => {
    return admin.exportAdminPrompts()
  })
  handle(IPC_CHANNELS.ADMIN.IMPORT_PROMPTS, (json: string) => {
    return admin.importAdminPrompts(json)
  })
  handle(IPC_CHANNELS.ADMIN.GET_DATABASE_SCHEMA, () => {
    return admin.getDatabaseSchema()
  })
  handle(IPC_CHANNELS.ADMIN.GET_TABLE_DATA, (tableName: string, limit?: number, offset?: number) => {
    return admin.getDatabaseTableData(tableName, limit, offset)
  })
  handle(IPC_CHANNELS.ADMIN.CREATE_CUSTOM_PROMPT, (name: string, content: string) => {
    return admin.createAdminCustomPrompt(name, content)
  })
  handle(IPC_CHANNELS.ADMIN.UPDATE_CUSTOM_PROMPT, (id: string, name: string, content: string) => {
    return admin.updateAdminCustomPrompt(id, name, content)
  })
  handle(IPC_CHANNELS.ADMIN.DELETE_CUSTOM_PROMPT, (id: string) => {
    return admin.deleteAdminCustomPrompt(id)
  })
  handle(IPC_CHANNELS.ADMIN.GET_CUSTOM_PROMPTS, () => {
    return admin.getAllAdminCustomPrompts()
  })

  handle(IPC_CHANNELS.WEREAD.TEST, (cookies: string) => testWereadConnection(cookies));

  handle(IPC_CHANNELS.READING_DATA.FETCH, (mode: ReadingMode, baseTime?: number) => fetchReadingData(mode, baseTime));
  handle(IPC_CHANNELS.READING_DATA.FETCH_WEEKLY, (baseTime?: number) => fetchReadingData('weekly', baseTime));
  handle(IPC_CHANNELS.READING_DATA.FETCH_MONTHLY, (baseTime?: number) => fetchReadingData('monthly', baseTime));
  handle(IPC_CHANNELS.READING_DATA.FETCH_ANNUALLY, (baseTime?: number) => fetchReadingData('annually', baseTime));
  handle(IPC_CHANNELS.READING_DATA.FETCH_OVERALL, () => fetchReadingData('overall'));

  handle(IPC_CHANNELS.SETTINGS.GET, (key: string) => settingsService.get(key));
  handle(IPC_CHANNELS.SETTINGS.SET, (key: string, value: unknown) => settingsService.set(key, value));
  handle(IPC_CHANNELS.SETTINGS.GET_ALL, () => settingsService.getAll());

  handle(IPC_CHANNELS.SYSTEM.FORCE_SAVE_DATABASE, () => {
    forceSaveDatabase();
    return { success: true };
  });

  handle(IPC_CHANNELS.SYSTEM.CLEAR_CACHE, () => {
    clearWeReadApiCache();
    return { success: true };
  });

  handle(IPC_CHANNELS.SYSTEM.OPEN_EXTERNAL, async (url: string) => {
    if (typeof url !== 'string' || url.length === 0) {
      throw new Error('Invalid URL');
    }
    // Only allow http(s) / weread deep links — no file:// or arbitrary protocols
    if (!/^(https?:|weread:)/i.test(url)) {
      throw new Error('Only http(s) or weread: URLs allowed');
    }
    await shell.openExternal(url);
    return { opened: true };
  });

  handle(IPC_CHANNELS.SYSTEM.CLEAR_HISTORY, () => {
    clearConversationsAndMessages();
    return { success: true };
  });

  handle(IPC_CHANNELS.SYSTEM.RESET_DATABASE, () => {
    resetDatabase();
    // 给前端一点时间收到响应后再重启
    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 500);
    return { success: true };
  });

  handle(IPC_CHANNELS.FSRS.SET_PARAMETERS, (params: Record<string, unknown>) => {
    setCustomParameters(params as Partial<import('./fsrs-engine').FSRSParameters>);
    return { success: true };
  });

  handle(IPC_CHANNELS.FSRS.RESET_PARAMETERS, () => {
    resetParameters();
    return { success: true };
  });

  handle(IPC_CHANNELS.FSRS.GET_PARAMETERS, () => {
    return getParameters();
  });

  handle(IPC_CHANNELS.FSRS.GET_FORECAST, (cards: Array<Record<string, unknown>>, days?: number) => {
    const typedCards = cards as unknown as import('./fsrs-engine').Card[];
    const forecast = getForecast(typedCards, days);
    return Object.fromEntries(forecast);
  });

  handle(IPC_CHANNELS.FSRS.GET_OPTIMAL_REVIEW_ORDER, (cards: Array<Record<string, unknown>>, limit?: number) => {
    const typedCards = cards as unknown as import('./fsrs-engine').Card[];
    return getOptimalReviewOrder(typedCards, limit);
  });

  handle(IPC_CHANNELS.FSRS.PREVIEW_REVIEW_RATINGS, (card: Record<string, unknown>) => {
    // Accept either DB snake_case rows or renderer camelCase cards
    const hasSnake = 'highlight_id' in card || 'scheduled_days' in card
    const typed = hasSnake
      ? cardFromDb(card)
      : (card as unknown as import('./fsrs-engine').Card)
    return previewReviewRatings(typed)
  });

  handle(IPC_CHANNELS.WEREAD.FETCH_ALL_CONTENT_BATCH, (bookIds: string[]) => {
    return fetchAllContentBatch(bookIds);
  });

  handle(IPC_CHANNELS.TOKEN_USAGE.GET_RECENT, (limit?: number) => {
    return tokenUsageDb.getRecent(limit);
  });

  handle(IPC_CHANNELS.TOKEN_USAGE.GET_BY_DATE_RANGE, (startDate: string, endDate: string) => {
    return tokenUsageDb.getByDateRange(startDate, endDate);
  });

  handle(IPC_CHANNELS.TOKEN_USAGE.GET_STATS_BY_PROVIDER, () => {
    return tokenUsageDb.getStatsByProvider();
  });

  handle(IPC_CHANNELS.TOKEN_USAGE.GET_STATS_BY_FEATURE, () => {
    return tokenUsageDb.getStatsByFeature();
  });

  handle(IPC_CHANNELS.TOKEN_USAGE.GET_DAILY_STATS, (days?: number) => {
    return tokenUsageDb.getDailyStats(days);
  });

  handle(IPC_CHANNELS.TOKEN_USAGE.GET_TOTAL_STATS, () => {
    return tokenUsageDb.getTotalStats();
  });

  handle(IPC_CHANNELS.TOKEN_USAGE.CLEAR_ALL, () => {
    tokenUsageDb.clearAll();
    return { success: true };
  });

  handle(IPC_CHANNELS.METHODOLOGIES.GET_ALL, () => methodologiesDb.getAll());
  handle(IPC_CHANNELS.METHODOLOGIES.GET_BY_ID, (id: string) => methodologiesDb.getById(id));
  handle(IPC_CHANNELS.METHODOLOGIES.GET_BY_BOOK, (bookId: string) => methodologiesDb.getByBookId(bookId));
  handle(IPC_CHANNELS.METHODOLOGIES.CREATE, (methodology: Record<string, unknown>) => {
    const id = (methodology.id as string) || `meth_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    methodologiesDb.create({ ...methodology, id });
    return { id };
  });
  handle(IPC_CHANNELS.METHODOLOGIES.UPDATE, (id: string, methodology: Record<string, unknown>) => methodologiesDb.update(id, methodology));
  handle(IPC_CHANNELS.METHODOLOGIES.DELETE, (id: string) => methodologiesDb.delete(id));
  handle(IPC_CHANNELS.METHODOLOGIES.SEARCH, (keyword: string) => methodologiesDb.search(keyword));
  handle(IPC_CHANNELS.METHODOLOGIES.EXTRACT, async (bookId: string, bookTitle: string) => {
    let highlights = highlightsDb.getByBookId(bookId);

    if (!highlights || highlights.length === 0) {
      logger.info(`No highlights found for book "${bookTitle}", attempting to fetch from WeRead...`);
      try {
        const content = await fetchAllContent(bookId) as {
          bookmarks: Array<{ bookmarkId: string; chapterTitle: string; markText: string; chapterUid: number; createTime: number }>;
          notes: Array<{ reviewId: string; chapterTitle: string; abstract: string; content: string; chapterUid: number; createTime: number }>;
        };

        let _importedCount = 0;
        if (content.bookmarks && content.bookmarks.length > 0) {
          for (const bm of content.bookmarks) {
            try {
              highlightsDb.create({
                book_id: bookId,
                content: bm.markText,
                chapter_title: bm.chapterTitle,
                chapter_uid: bm.chapterUid,
                type: 'highlight',
                source: 'weread',
                created_at: new Date(bm.createTime * 1000).toISOString(),
              });
              _importedCount++;
            } catch (e) { logger.error('导入划线失败:', e); }
          }
        }
        if (content.notes && content.notes.length > 0) {
          for (const note of content.notes) {
            try {
              highlightsDb.create({
                book_id: bookId,
                content: note.abstract,
                note: note.content,
                chapter_title: note.chapterTitle,
                chapter_uid: note.chapterUid,
                type: 'note',
                source: 'weread',
                created_at: new Date(note.createTime * 1000).toISOString(),
              });
              _importedCount++;
            } catch (e) { logger.error('导入笔记失败:', e); }
          }
        }

        highlights = highlightsDb.getByBookId(bookId);

        if (!highlights || highlights.length === 0) {
          throw new Error('该书在微信读书中也没有笔记，无法提取方法论');
        }
      } catch (error) {
        logger.error('自动导入笔记失败:', error);
        throw new Error(`自动导入笔记失败: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    const mappedHighlights = highlights.map(h => ({
      content: String(h.content || ''),
      note: h.note ? String(h.note) : undefined,
      chapterTitle: h.chapter_title ? String(h.chapter_title) : undefined,
    }));
    const methodologies = await extractMethodologies(mappedHighlights, bookTitle);
    const results = [];
    for (const m of methodologies) {
      const id = `meth_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
      methodologiesDb.create({
        id,
        book_id: bookId,
        name: m.name,
        name_en: m.nameEn,
        trigger_scenario: m.triggerScenario,
        description: m.description,
        steps: m.steps,
        output_format: m.outputFormat,
        examples: m.examples,
        tags: [],
        source_highlight_ids: [],
        mastery_level: 0,
        practice_count: 0,
      });
      results.push({ id, ...m });
    }
    return results;
  });

  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.GET_ALL, () => knowledgeCardsDb.getAll());
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.GET_BY_ID, (id: string) => knowledgeCardsDb.getById(id));
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.GET_BY_BOOK, (bookId: string) => knowledgeCardsDb.getByBookId(bookId));
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.GET_BY_TYPE, (type: string) => knowledgeCardsDb.getByType(type));
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.CREATE, (card: Record<string, unknown>) => {
    const id = (card.id as string) || `kc_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    knowledgeCardsDb.create({ ...card, id });
    return { id };
  });
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.UPDATE, (id: string, card: Record<string, unknown>) => knowledgeCardsDb.update(id, card));
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.DELETE, (id: string) => knowledgeCardsDb.delete(id));
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.SEARCH, (keyword: string) => knowledgeCardsDb.search(keyword));
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.DISTILL, (bookId: string, bookTitle: string) =>
    knowledgeCardService.distillBook(bookId, bookTitle)
  );
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.CANCEL_DISTILL, (bookId: string) => {
    const cancelled = knowledgeCardService.cancelDistill(bookId);
    return { success: cancelled };
  });
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.IS_DISTILLING, (bookId: string) =>
    knowledgeCardService.isDistilling(bookId)
  );
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.GENERATE_INTERPRETATION, async (bookTitle: string, cardTitle: string, cardContent: string, cardType: string) => {
    const text = await generateCardInterpretation(bookTitle, cardTitle, cardContent, cardType);
    return { text };
  });
  handle(IPC_CHANNELS.KNOWLEDGE_CARDS.GENERATE_APPLICATION, async (bookTitle: string, cardTitle: string, cardContent: string, cardType: string) => {
    const text = await generateCardApplication(bookTitle, cardTitle, cardContent, cardType);
    return { text };
  });

  handle(IPC_CHANNELS.BOOK_ARCHITECTURE.GET_BY_BOOK, (bookId: string) => bookArchitectureDb.getByBookId(bookId));
  handle(IPC_CHANNELS.BOOK_ARCHITECTURE.CREATE, (architecture: Record<string, unknown>) => {
    const id = (architecture.id as string) || `arch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    bookArchitectureDb.create({ ...architecture, id });
    return { id };
  });
  handle(IPC_CHANNELS.BOOK_ARCHITECTURE.UPDATE, (id: string, architecture: Record<string, unknown>) => bookArchitectureDb.update(id, architecture));
  handle(IPC_CHANNELS.BOOK_ARCHITECTURE.DELETE, (id: string) => bookArchitectureDb.delete(id));
  handle(IPC_CHANNELS.BOOK_ARCHITECTURE.ANALYZE, async (bookId: string, bookTitle: string) => {
    const highlights = highlightsDb.getByBookId(bookId);
    if (!highlights || highlights.length === 0) {
      throw new Error('该书没有笔记，无法分析架构');
    }
    const mappedHighlights = highlights.map(h => ({
      content: String(h.content || ''),
      note: h.note ? String(h.note) : undefined,
      chapterTitle: h.chapter_title ? String(h.chapter_title) : undefined,
    }));
    const architecture = await analyzeBookArchitecture(mappedHighlights, bookTitle);
    const id = `arch_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    bookArchitectureDb.create({
      id,
      book_id: bookId,
      core_proposition: architecture.coreProposition,
      cognitive_framework: architecture.cognitiveFramework,
      methodology_architecture: architecture.methodologyArchitecture,
      knowledge_hierarchy: architecture.knowledgeHierarchy,
      target_audience: architecture.targetAudience,
    });
    return { id, ...architecture };
  });

  handle(IPC_CHANNELS.SKILL.GENERATE, async (methodologyId: string, bookTitle: string, _author?: string) => {
    const methodology = methodologiesDb.getById(methodologyId);
    if (!methodology) {
      throw new Error('方法论不存在');
    }
    const skillContent = await generateSkill({
      name: String(methodology.name || ''),
      nameEn: methodology.name_en ? String(methodology.name_en) : undefined,
      triggerScenario: String(methodology.trigger_scenario || ''),
      description: String(methodology.description || ''),
      steps: methodology.steps ? JSON.parse(String(methodology.steps)) : [],
      outputFormat: String(methodology.output_format || ''),
      examples: String(methodology.examples || ''),
      bookTitle: bookTitle,
    });
    return { content: skillContent };
  });

  handle(IPC_CHANNELS.SKILL.EXPORT_BATCH, async (methodologyIds: string[], bookTitle: string, _author?: string) => {
    const methodologies = [];
    for (const id of methodologyIds) {
      const m = methodologiesDb.getById(id);
      if (m) methodologies.push(m);
    }
    const mapped = methodologies.map(m => ({
      name: String(m.name || ''),
      nameEn: m.name_en ? String(m.name_en) : undefined,
      triggerScenario: String(m.trigger_scenario || ''),
      description: String(m.description || ''),
      steps: m.steps ? JSON.parse(String(m.steps)) : [],
      outputFormat: String(m.output_format || ''),
      examples: String(m.examples || ''),
      bookTitle: bookTitle,
    }));
    const skills = await generateSkillBatch(mapped);
    return skills;
  });

  logger.info('IPC handlers registered');
}
