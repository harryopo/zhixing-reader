import { logger } from './logger';
import { sleep, fetchWithTimeout, RETRY_CONFIGS } from './http-client';

const GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway';
const SKILL_VERSION = '1.0.5';
const { timeout: REQUEST_TIMEOUT, maxRetries: MAX_RETRIES, baseDelay: RETRY_DELAY } = RETRY_CONFIGS.WEREAD_API;
const CACHE_TTL = 5 * 60 * 1000;

interface GatewayRequest {
  api_name: string;
  skill_version?: string;
  [key: string]: unknown;
}

interface GatewayResponse {
  errcode: number;
  errmsg?: string;
  [key: string]: unknown;
}

interface WereadBook {
  bookId: string;
  title: string;
  author: string;
  cover: string;
  isbn: string;
  publisher: string;
  publishTime: string;
  intro: string;
  category: string;
  finishReading: number;
  progress: number;
  totalChapter: number;
  lastReadTime: number;
  readUpdateTime?: number;
  isTop?: number;
  secret?: number;
  updateTime?: number;
}

interface WereadBookmark {
  bookmarkId: string;
  bookId: string;
  chapterUid: number;
  chapterTitle: string;
  markText: string;
  style: number;
  range: string;
  createTime: number;
}

interface WereadReview {
  reviewId: string;
  bookId: string;
  chapterUid: number;
  chapterTitle: string;
  abstract: string;
  content: string;
  range: string;
  createTime: number;
}

interface WereadChapter {
  chapterUid: number;
  title: string;
  level: number;
}

export interface ReadLongestItem {
  book?: {
    bookId: string;
    title: string;
    author: string;
    cover: string;
    [key: string]: unknown;
  };
  albumInfo?: Record<string, unknown>;
  readTime: number;
  recordReadingTime?: number;
  tags?: string[];
}

export interface ReadingDataBook {
  bookId: string;
  title: string;
  author: string;
  cover: string;
  readTime: number;
  recordReadingTime?: number;
  tags?: string[];
}

export interface ReadingStatItem {
  stat: string;
  counts: string;
  scheme?: string;
}

export interface PreferCategory {
  categoryId: string;
  categoryTitle: string;
  parentCategoryId?: string;
  parentCategoryTitle?: string;
  val: number;
  readingTime: number;
  readingCount: number;
  categoryType?: number;
}

export interface PreferAuthor {
  authorId: string;
  name: string;
  count: number;
  readTime: string;
}

export interface ReadingDataResponse {
  baseTime: number;
  readTimes?: Record<string, number>;
  dailyReadTimes?: Record<string, number>;
  readDays: number;
  totalReadTime: number;
  dayAverageReadTime: number;
  compare?: number;
  readLongest?: ReadLongestItem[];
  readStat?: ReadingStatItem[];
  preferCategory?: PreferCategory[];
  preferCategoryWord?: string;
  preferTime?: number[];
  preferTimeWord?: string;
  preferAuthor?: PreferAuthor[];
  authorCount?: number;
  readRate?: number;
  wrReadTime?: number;
  wrListenTime?: number;
  rank?: { text: string; scheme?: string };
  registTime?: number;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

let apiKey: string = '';
const cache = new Map<string, CacheEntry<unknown>>();

function getCacheKey(apiName: string, params: Record<string, unknown> = {}): string {
  return `${apiName}:${JSON.stringify(params)}`;
}

function getFromCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  
  if (Date.now() - entry.timestamp > CACHE_TTL) {
    cache.delete(key);
    return null;
  }
  
  return entry.data as T;
}

function setCache<T>(key: string, data: T): void {
  cache.set(key, {
    data,
    timestamp: Date.now(),
  });
}

export function clearCache(): void {
  cache.clear();
  logger.info('WeRead API cache cleared');
}

export function setApiKey(key: string): void {
  apiKey = key;
  clearCache();
  logger.info('WeRead API Key updated');
}

export function getApiKey(): string {
  return apiKey;
}

export function initFromSettings(settings: Record<string, unknown>): void {
  if (settings.wereadApiKey) {
    apiKey = settings.wereadApiKey as string;
    logger.info('WeRead API Key loaded from settings');
  }
}

async function gatewayRequest<T>(request: GatewayRequest, useCache: boolean = true): Promise<T> {
  if (!apiKey) {
    throw new Error('请先设置微信读书 API Key');
  }

  const cacheKey = getCacheKey(request.api_name, request);
  
  if (useCache) {
    const cached = getFromCache<T>(cacheKey);
    if (cached) {
      logger.debug(`Cache hit for ${request.api_name}`);
      return cached;
    }
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`,
  };

  const body = JSON.stringify({
    ...request,
    skill_version: SKILL_VERSION,
  });

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      logger.info(`Gateway request: ${request.api_name} (attempt ${attempt}/${MAX_RETRIES})`, { body });
      
      const response = await fetchWithTimeout(GATEWAY_URL, {
        method: 'POST',
        headers,
        body,
      }, REQUEST_TIMEOUT);

      if (!response.ok) {
        const errorText = await response.text();
        const error = new Error(`HTTP ${response.status}: ${response.statusText} - ${errorText}`);
        
        if (response.status === 401 || response.status === 403) {
          throw error;
        }
        
        if (attempt < MAX_RETRIES) {
          logger.warn(`Request failed, retrying in ${RETRY_DELAY}ms...`, { error: error.message });
          await sleep(RETRY_DELAY * attempt);
          lastError = error;
          continue;
        }
        
        throw error;
      }

      const data = await response.json() as GatewayResponse;

      if (data.errcode !== undefined && data.errcode !== 0) {
        const error = new Error(data.errmsg || `API错误: ${data.errcode}`);
        
        if (data.errcode === 401 || data.errcode === 403) {
          throw error;
        }
        
        if (attempt < MAX_RETRIES) {
          logger.warn(`API error, retrying in ${RETRY_DELAY}ms...`, { error: error.message });
          await sleep(RETRY_DELAY * attempt);
          lastError = error;
          continue;
        }
        
        throw error;
      }

      const result = data as unknown as T;
      
      if (useCache) {
        setCache(cacheKey, result);
      }
      
      return result;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < MAX_RETRIES && !lastError.message.includes('401') && !lastError.message.includes('403')) {
        logger.warn(`Request failed, retrying in ${RETRY_DELAY}ms...`, { error: lastError.message });
        await sleep(RETRY_DELAY * attempt);
        continue;
      }
      
      break;
    }
  }

  logger.error(`Gateway request failed after ${MAX_RETRIES} attempts: ${request.api_name}`, lastError);
  throw lastError || new Error(`Gateway request failed: ${request.api_name}`);
}

export async function getBookshelf(): Promise<WereadBook[]> {
  try {
    const data = await gatewayRequest<{
      books: Array<{
        bookId: string;
        title?: string;
        author?: string;
        cover?: string;
        isbn?: string;
        publisher?: string;
        publishTime?: string;
        intro?: string;
        category?: string;
        finishReading?: number;
        progress?: number;
        readUpdateTime?: number;
        isTop?: number;
        secret?: number;
        updateTime?: number;
        [key: string]: unknown;
      }>;
    }>({
      api_name: '/shelf/sync',
    }, true);

    return (data.books || []).map(item => ({
      bookId: item.bookId,
      title: item.title || '',
      author: item.author || '',
      cover: item.cover || '',
      isbn: item.isbn || '',
      publisher: item.publisher || '',
      publishTime: item.publishTime || '',
      intro: item.intro || '',
      category: item.category || '',
      finishReading: item.finishReading || 0,
      progress: item.progress || 0,
      totalChapter: 0,
      lastReadTime: item.readUpdateTime || 0,
      readUpdateTime: item.readUpdateTime || 0,
      isTop: item.isTop || 0,
      secret: item.secret || 0,
      updateTime: item.updateTime || 0,
    }));
  } catch (error) {
    logger.error('Failed to get bookshelf', error);
    throw error;
  }
}

export async function getBookshelfWithRetry(): Promise<WereadBook[]> {
  return getBookshelf();
}

export async function fetchBookmarks(bookId: string): Promise<WereadBookmark[]> {
  try {
    const data = await gatewayRequest<{
      updated: Array<{
        bookmarkId: string;
        bookId: string;
        chapterUid: number;
        chapterTitle?: string;
        markText: string;
        style: number;
        range: string;
        createTime: number;
      }>;
      chapters?: Array<{
        chapterUid: number;
        title: string;
      }>;
    }>({
      api_name: '/book/bookmarklist',
      bookId,
    });

    return (data.updated || []).map(item => ({
      bookmarkId: item.bookmarkId,
      bookId: item.bookId,
      chapterUid: item.chapterUid,
      chapterTitle: item.chapterTitle || '',
      markText: item.markText,
      style: item.style,
      range: item.range,
      createTime: item.createTime,
    }));
  } catch (error) {
    logger.error(`Failed to fetch bookmarks for book ${bookId}`, error);
    throw error;
  }
}

export async function fetchNotes(bookId: string): Promise<WereadReview[]> {
  try {
    const data = await gatewayRequest<{
      reviews: Array<{
        reviewId: string;
        bookId: string;
        chapterUid?: number;
        chapterTitle?: string;
        abstract: string;
        content: string;
        range: string;
        createTime: number;
      }>;
    }>({
      api_name: '/review/list/mine',
      bookid: bookId,
      count: 100,
    });

    return (data.reviews || []).map(item => ({
      reviewId: item.reviewId,
      bookId: item.bookId,
      chapterUid: item.chapterUid || 0,
      chapterTitle: item.chapterTitle || '',
      abstract: item.abstract || '',
      content: item.content || '',
      range: item.range,
      createTime: item.createTime,
    }));
  } catch (error) {
    logger.error(`Failed to fetch notes for book ${bookId}`, error);
    throw error;
  }
}

export async function fetchChapters(bookId: string): Promise<WereadChapter[]> {
  try {
    const data = await gatewayRequest<{
      chapters: Array<{
        chapterUid: number;
        title: string;
        level: number;
        chapterIdx?: number;
      }>;
    }>({
      api_name: '/book/chapterinfo',
      bookId,
    });

    return (data.chapters || []).map(item => ({
      chapterUid: item.chapterUid,
      title: item.title,
      level: item.level,
    }));
  } catch (error) {
    logger.error(`Failed to fetch chapters for book ${bookId}`, error);
    throw error;
  }
}

export async function fetchAllContent(bookId: string): Promise<{
  bookmarks: WereadBookmark[];
  notes: WereadReview[];
  chapters: WereadChapter[];
}> {
  try {
    const [bookmarks, notes, chapters] = await Promise.all([
      fetchBookmarks(bookId),
      fetchNotes(bookId),
      fetchChapters(bookId),
    ]);

    return { bookmarks, notes, chapters };
  } catch (error) {
    logger.error(`Failed to fetch all content for book ${bookId}`, error);
    throw error;
  }
}

export async function fetchAllContentBatch(bookIds: string[]): Promise<Map<string, {
  bookmarks: WereadBookmark[];
  notes: WereadReview[];
  chapters: WereadChapter[];
}>> {
  const results = new Map<string, {
    bookmarks: WereadBookmark[];
    notes: WereadReview[];
    chapters: WereadChapter[];
  }>();

  const batchSize = 3;
  for (let i = 0; i < bookIds.length; i += batchSize) {
    const batch = bookIds.slice(i, i + batchSize);
    const batchResults = await Promise.allSettled(
      batch.map(async (bookId) => {
        const content = await fetchAllContent(bookId);
        return { bookId, content };
      })
    );

    for (const result of batchResults) {
      if (result.status === 'fulfilled') {
        results.set(result.value.bookId, result.value.content);
      } else {
        logger.error('Failed to fetch content in batch', { error: result.reason });
      }
    }

    if (i + batchSize < bookIds.length) {
      await sleep(500);
    }
  }

  return results;
}

export async function getRecentBooks(): Promise<WereadBook[]> {
  try {
    const data = await gatewayRequest<{
      books: Array<{
        bookId: string;
        title: string;
        author: string;
        cover: string;
        lastReadTime: number;
      }>;
    }>({
      api_name: '/shelf/sync',
    });

    return (data.books || []).slice(0, 10).map(item => ({
      bookId: item.bookId,
      title: item.title,
      author: item.author,
      cover: item.cover,
      isbn: '',
      publisher: '',
      publishTime: '',
      intro: '',
      category: '',
      finishReading: 0,
      progress: 0,
      totalChapter: 0,
      lastReadTime: item.lastReadTime || 0,
    }));
  } catch (error) {
    logger.error('Failed to get recent books', error);
    throw error;
  }
}

export async function searchBooks(keyword: string, count: number = 10): Promise<WereadBook[]> {
  try {
    const data = await gatewayRequest<{
      results?: Array<{
        books: Array<{
          bookInfo: {
            bookId: string;
            title: string;
            author: string;
            cover: string;
            isbn?: string;
            publisher?: string;
            publishTime?: string;
            intro?: string;
            category?: string;
          };
        }>;
      }>;
    }>({
      api_name: '/store/search',
      keyword,
      count,
    });

    const results: WereadBook[] = [];
    for (const section of data.results || []) {
      for (const b of section.books || []) {
        const info = b.bookInfo;
        if (info?.bookId) {
          results.push({
            bookId: info.bookId,
            title: info.title || '',
            author: info.author || '',
            cover: info.cover || '',
            isbn: info.isbn || '',
            publisher: info.publisher || '',
            publishTime: info.publishTime || '',
            intro: info.intro || '',
            category: info.category || '',
            finishReading: 0,
            progress: 0,
            totalChapter: 0,
            lastReadTime: 0,
          });
        }
      }
    }
    return results.slice(0, count);
  } catch (error) {
    logger.error(`Failed to search books: ${keyword}`, error);
    throw error;
  }
}

export async function testConnection(key: string): Promise<{ success: boolean; message: string }> {
  try {
    const testKey = key || apiKey;
    if (!testKey) {
      return { success: false, message: '请先设置微信读书 API Key' };
    }

    logger.info('Testing WeRead connection...');

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${testKey}`,
    };

    const body = JSON.stringify({
      api_name: '/shelf/sync',
      skill_version: SKILL_VERSION,
    });

    const response = await fetchWithTimeout(GATEWAY_URL, {
      method: 'POST',
      headers,
      body,
    }, REQUEST_TIMEOUT);

    if (!response.ok) {
      const errorText = await response.text();
      logger.error(`WeRead test failed: ${response.status}`, errorText);
      if (response.status === 401) {
        return { success: false, message: '认证失败：API Key 无效或已过期' };
      }
      if (response.status === 499) {
        return { success: false, message: '连接超时：服务器未及时响应，请检查 API Key 是否正确或网络连接是否正常' };
      }
      return { success: false, message: `请求失败: HTTP ${response.status}${errorText ? ` - ${errorText.slice(0, 100)}` : ''}` };
    }

    const data = await response.json() as GatewayResponse;

    if (data.errcode !== undefined && data.errcode !== 0) {
      logger.error('WeRead API error:', data);
      return { success: false, message: data.errmsg || `API错误: errcode=${data.errcode}` };
    }

    logger.info('WeRead test connection successful');
    return {
      success: true,
      message: '连接成功！'
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('WeRead test connection failed', error);

    if (errorMessage.includes('abort') || errorMessage.includes('timeout')) {
      return { success: false, message: '连接超时：请求超过30秒未响应，请检查网络连接或 API Key 是否正确' };
    }

    return { success: false, message: `连接失败: ${errorMessage}` };
  }
}

export type ReadingMode = 'weekly' | 'monthly' | 'annually' | 'overall';

export async function fetchReadingData(mode: ReadingMode = 'monthly', baseTime?: number): Promise<ReadingDataResponse> {
  try {
    const params: Record<string, unknown> = {
      api_name: '/readdata/detail',
      mode,
    };
    if (baseTime !== undefined && baseTime !== null) {
      params.baseTime = baseTime;
    }
    const data = await gatewayRequest<ReadingDataResponse>(params as GatewayRequest, true);
    return data;
  } catch (error) {
    logger.error(`Failed to fetch reading data (mode=${mode})`, error);
    throw error;
  }
}
