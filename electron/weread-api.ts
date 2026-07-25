import { logger } from './logger';
import { sleep, fetchWithTimeout, RETRY_CONFIGS } from './http-client';
import type { RecommendationItem } from '../src/shared/types';

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

export interface TestConnectionResult {
  success: boolean;
  message: string;
  /** 测试 /shelf/sync 拉到的第一本书标题，用于在 UI 反馈"真的拉到了一本书" */
  firstBookTitle?: string;
}

export async function testConnection(key: string): Promise<TestConnectionResult> {
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

    const data = await response.json() as GatewayResponse & { books?: Array<{ title?: string }> };

    if (data.errcode !== undefined && data.errcode !== 0) {
      logger.error('WeRead API error:', data);
      return { success: false, message: data.errmsg || `API错误: errcode=${data.errcode}` };
    }

    logger.info('WeRead test connection successful');
    const books = Array.isArray(data.books) ? data.books : [];
    const firstBookTitle = books[0]?.title && books[0].title.trim().length > 0
      ? books[0].title.trim()
      : undefined;
    const message = firstBookTitle
      ? `连接成功！已拉取到第 1 本书：${firstBookTitle}`
      : '连接成功！书架为空或暂无可同步书籍';
    return { success: true, message, firstBookTitle };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error('WeRead test connection failed', error);

    if (errorMessage.includes('abort') || errorMessage.includes('timeout')) {
      return { success: false, message: '连接超时：请求超过30秒未响应，请检查网络连接或 API Key 是否正确' };
    }

    return { success: false, message: `连接失败: ${errorMessage}` };
  }
}

export interface WeReadUserProfile {
  nickname: string;
  avatarUrl: string;
  vid?: string;
}

export interface UserProfileResult {
  success: boolean;
  profile?: WeReadUserProfile;
  message: string;
}

/**
 * 获取微信读书用户资料（头像 + 昵称）。
 *
 * 说明：微信读书 Agent API Gateway 未在公开文档中暴露用户资料接口，
 * 这里先尝试常见的 /user/info；如不可用，返回失败并由调用方降级到本地设置。
 */
export async function fetchUserProfile(): Promise<UserProfileResult> {
  if (!apiKey) {
    return { success: false, message: '请先设置微信读书 API Key' };
  }

  const candidateApiNames = ['/user/info', '/user/profile'];

  for (const apiName of candidateApiNames) {
    try {
      const data = await gatewayRequest<{
        nickname?: string;
        name?: string;
        nickName?: string;
        avatar?: string;
        avatarUrl?: string;
        headImgUrl?: string;
        vid?: string;
        userVid?: string;
      }>({
        api_name: apiName,
      }, false);

      const nickname = data.nickname || data.name || data.nickName || '';
      const avatarUrl = data.avatar || data.avatarUrl || data.headImgUrl || '';

      if (nickname || avatarUrl) {
        return {
          success: true,
          profile: {
            nickname,
            avatarUrl,
            vid: data.vid || data.userVid,
          },
          message: '已同步微信读书资料',
        };
      }
    } catch (error) {
      logger.warn(`fetchUserProfile ${apiName} failed`, { error: String(error) });
      // 继续尝试下一个候选接口
    }
  }

  return {
    success: false,
    message: '微信读书 API 暂不支持获取头像/昵称，请手动填写',
  };
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

// ===== 推荐好书 =====

export type { RecommendationItem } from '../src/shared/types';

interface GatewayRecommendBook {
  bookId: string;
  title?: string;
  author?: string;
  cover?: string;
  intro?: string;
  category?: string;
  reason?: string;
  newRating?: number;
  newRatingCount?: number;
  newRatingDetail?: { title?: string };
  readingCount?: number;
  searchIdx?: number;
  [key: string]: unknown;
}

/**
 * 推荐好书 — 优先调用 gateway 官方推荐接口，失败/空时降级为衍生推荐。
 *
 * 优先策略：POST /book/recommend（个性化推荐，与 App 首页「为你推荐」一致）
 * 降级策略：基于阅读统计 preferCategory + preferAuthor，调用 searchBooks 搜索同类/同作者书
 */
export async function fetchRecommendations(): Promise<RecommendationItem[]> {
  try {
    const data = await gatewayRequest<{ books?: GatewayRecommendBook[] }>({
      api_name: '/book/recommend',
      count: 20,
    }, false);

    const books = data.books || [];
    if (books.length > 0) {
      return books.map((b) => ({
        bookId: b.bookId,
        title: b.title || '',
        author: b.author || '',
        cover: b.cover || '',
        intro: b.intro || '',
        category: b.category || '',
        rating: typeof b.newRating === 'number' ? b.newRating : undefined,
        reason: b.reason || '基于您的阅读偏好',
      }));
    }

    logger.info('Gateway recommend API returned empty, falling back to derived recommendations');
    return await generateDerivedRecommendations();
  } catch (error) {
    logger.warn('Gateway recommend API failed, falling back to derived recommendations', { error: String(error) });
    return await generateDerivedRecommendations();
  }
}

/**
 * 衍生推荐 — 基于阅读统计的偏好生成推荐。
 *
 * 算法：
 * 1. 调 fetchReadingData('overall') 获取 preferCategory + preferAuthor
 * 2. 对每个 preferCategory（按 readingTime 排序，取 Top 3）调 searchBooks(categoryTitle) 搜索同类书
 * 3. 对每个 preferAuthor（按 count 排序，取 Top 3）调 searchBooks(authorName) 搜索同作者书
 * 4. 去重：过滤已在书架中的书（调 getBookshelf 获取已有 bookId）
 * 5. 返回 Top 20，每本书带 reason 字段说明推荐理由
 */
async function generateDerivedRecommendations(): Promise<RecommendationItem[]> {
  const recommendations = new Map<string, RecommendationItem>();

  // 并行获取阅读偏好与书架（用于去重）
  const [readingData, shelfBooks] = await Promise.all([
    fetchReadingData('overall').catch((err) => {
      logger.warn('Failed to fetch reading data for derived recommendations', { error: String(err) });
      return null;
    }),
    getBookshelf().catch((err) => {
      logger.warn('Failed to fetch bookshelf for dedup', { error: String(err) });
      return [] as WereadBook[];
    }),
  ]);

  const shelfBookIds = new Set(shelfBooks.map((b) => b.bookId));

  // 处理 preferCategory（按 readingTime 倒序，取 Top 3）
  const topCategories = (readingData?.preferCategory || [])
    .slice()
    .sort((a, b) => b.readingTime - a.readingTime)
    .slice(0, 3);

  // 处理 preferAuthor（按 count 倒序，取 Top 3）
  const topAuthors = (readingData?.preferAuthor || [])
    .slice()
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  // 并行搜索各类别/作者
  const searchTasks: Array<Promise<void>> = [];

  for (const cat of topCategories) {
    if (!cat.categoryTitle) continue;
    searchTasks.push(
      (async () => {
        try {
          const results = await searchBooks(cat.categoryTitle, 8);
          for (const book of results) {
            if (shelfBookIds.has(book.bookId)) continue;
            if (recommendations.has(book.bookId)) continue;
            recommendations.set(book.bookId, {
              bookId: book.bookId,
              title: book.title,
              author: book.author,
              cover: book.cover,
              intro: book.intro,
              category: book.category || cat.categoryTitle,
              rating: undefined,
              reason: `基于您阅读的「${cat.categoryTitle}」类别`,
            });
          }
        } catch (err) {
          logger.warn(`Derived recommend: search category failed: ${cat.categoryTitle}`, { error: String(err) });
        }
      })(),
    );
  }

  for (const author of topAuthors) {
    if (!author.name) continue;
    searchTasks.push(
      (async () => {
        try {
          const results = await searchBooks(author.name, 5);
          for (const book of results) {
            if (shelfBookIds.has(book.bookId)) continue;
            if (recommendations.has(book.bookId)) continue;
            recommendations.set(book.bookId, {
              bookId: book.bookId,
              title: book.title,
              author: book.author,
              cover: book.cover,
              intro: book.intro,
              category: book.category,
              rating: undefined,
              reason: `基于您喜欢的作者「${author.name}」`,
            });
          }
        } catch (err) {
          logger.warn(`Derived recommend: search author failed: ${author.name}`, { error: String(err) });
        }
      })(),
    );
  }

  await Promise.all(searchTasks);

  // 衍生推荐也可能为空（如用户无阅读统计或搜索全部失败），返回空数组让 UI 显示 EmptyState
  return Array.from(recommendations.values()).slice(0, 20);
}
