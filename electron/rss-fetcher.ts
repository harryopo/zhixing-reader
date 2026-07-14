import { net } from 'electron';
import { logger } from './logger';

// RSS源配置
export interface RssSource {
  name: string;
  url: string;
  website: string;
  description: string;
  category: string;
  difficulty: string;
  language: string;
}

// 预设的RSS源列表（含文章来源信息）
export const RSS_SOURCES: RssSource[] = [
  // 心理学 - 四级难度
  {
    name: 'Simply Psychology',
    url: 'https://www.simplypsychology.org/feed',
    website: 'https://www.simplypsychology.org',
    description: '专门为学生设计的心理学科普网站，语言简单易懂，学术性强',
    category: 'psychology',
    difficulty: 'cet4',
    language: 'en',
  },
  {
    name: 'Verywell Mind',
    url: 'https://www.verywellmind.com/feed',
    website: 'https://www.verywellmind.com',
    description: '心理健康科普平台，内容通俗易懂，四六级水平友好',
    category: 'psychology',
    difficulty: 'cet4',
    language: 'en',
  },
  {
    name: 'Greater Good Science Center',
    url: 'https://greatergood.berkeley.edu/feed',
    website: 'https://greatergood.berkeley.edu',
    description: '伯克利大学积极心理学中心，关注幸福感、感恩、同理心等主题',
    category: 'positive_psychology',
    difficulty: 'cet4',
    language: 'en',
  },
  {
    name: 'James Clear',
    url: 'https://jamesclear.com/feed',
    website: 'https://jamesclear.com',
    description: '《原子习惯》作者博客，关于习惯养成、生产力和自我提升',
    category: 'habits',
    difficulty: 'cet4',
    language: 'en',
  },
  // 心理学 - 六级难度
  {
    name: 'BPS Research Digest',
    url: 'https://www.bps.org.uk/feed',
    website: 'https://www.bps.org.uk',
    description: '英国心理学会官方研究摘要，学术权威，语言规范',
    category: 'psychology',
    difficulty: 'cet6',
    language: 'en',
  },
  {
    name: 'PsyPost',
    url: 'https://www.psypost.org/feed',
    website: 'https://www.psypost.org',
    description: '心理学研究新闻解读，涵盖最新研究成果',
    category: 'psychology',
    difficulty: 'cet6',
    language: 'en',
  },
  // 认知科学 - 六级难度
  {
    name: 'Scientific American Mind',
    url: 'https://www.scientificamerican.com/feed/',
    website: 'https://www.scientificamerican.com/mind',
    description: '科学美国人·心智版，四六级阅读真题题源，认知科学权威',
    category: 'cognitive_science',
    difficulty: 'cet6',
    language: 'en',
  },
  {
    name: 'Farnam Street',
    url: 'https://fs.blog/feed',
    website: 'https://fs.blog',
    description: '思维模型、决策科学、终身学习，提升认知深度',
    category: 'thinking',
    difficulty: 'cet6',
    language: 'en',
  },
  {
    name: 'Brain Pickings',
    url: 'https://www.themarginalian.org/feed/',
    website: 'https://www.themarginalian.org',
    description: '深度思考、人文心理学、哲学与创造力的交汇',
    category: 'humanities',
    difficulty: 'cet6',
    language: 'en',
  },
  // 神经科学 - 考研难度
  {
    name: 'Neuroscience News',
    url: 'https://neurosciencenews.com/feed/',
    website: 'https://neurosciencenews.com',
    description: '神经科学最新研究，涵盖大脑、认知、行为等领域',
    category: 'neuroscience',
    difficulty: 'graduate',
    language: 'en',
  },
];

// RSS文章接口
export interface RssArticle {
  title: string;
  link: string;
  description: string;
  content: string;
  pubDate: string;
  source: string;
  sourceWebsite: string;
  sourceDescription: string;
  category: string;
  difficulty: string;
}

// 解析RSS XML
function parseRssXml(xml: string, source: RssSource): RssArticle[] {
  const articles: RssArticle[] = [];

  try {
    // 简单的XML解析 - 提取item标签
    const itemRegex = /<item>([\s\S]*?)<\/item>/gi;
    let match;

    while ((match = itemRegex.exec(xml)) !== null) {
      const itemContent = match[1];

      const title = extractTag(itemContent, 'title');
      const link = extractTag(itemContent, 'link');
      const description = extractTag(itemContent, 'description');
      const content = extractTag(itemContent, 'content:encoded') || description;
      const pubDate = extractTag(itemContent, 'pubDate');

      if (title && link) {
        articles.push({
          title: cleanHtml(title),
          link: cleanHtml(link),
          description: cleanHtml(description),
          content: cleanHtml(content),
          pubDate: pubDate || new Date().toISOString(),
          source: source.name,
          sourceWebsite: source.website,
          sourceDescription: source.description,
          category: source.category,
          difficulty: source.difficulty,
        });
      }
    }
  } catch (error) {
    logger.error('Failed to parse RSS XML', { source: source.name, error: String(error) });
  }

  return articles;
}

// 提取XML标签内容
function extractTag(xml: string, tag: string): string {
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = xml.match(regex);
  return match ? match[1].trim() : '';
}

// 清理HTML标签
function cleanHtml(html: string): string {
  return html
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

// 抓取单个RSS源
async function fetchSingleRss(source: RssSource): Promise<RssArticle[]> {
  try {
    logger.info(`Fetching RSS from ${source.name}`, { url: source.url });

    const response = await net.fetch(source.url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const xml = await response.text();
    const articles = parseRssXml(xml, source);

    logger.info(`Fetched ${articles.length} articles from ${source.name}`);
    return articles;
  } catch (error) {
    logger.error(`Failed to fetch RSS from ${source.name}`, { error: String(error) });
    return [];
  }
}

// 批量抓取所有RSS源
export async function fetchAllRssSources(): Promise<RssArticle[]> {
  const allArticles: RssArticle[] = [];

  // 并行抓取所有源
  const promises = RSS_SOURCES.map(source => fetchSingleRss(source));
  const results = await Promise.allSettled(promises);

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allArticles.push(...result.value);
    }
  }

  // 按发布时间排序
  allArticles.sort((a, b) => new Date(b.pubDate).getTime() - new Date(a.pubDate).getTime());

  logger.info(`Total fetched articles: ${allArticles.length}`);
  return allArticles;
}

// 获取今日推荐文章（去重后取最新的）
export async function getTodayRecommendations(count: number = 5): Promise<RssArticle[]> {
  const articles = await fetchAllRssSources();

  // 去重（基于标题）
  const seen = new Set<string>();
  const uniqueArticles = articles.filter(article => {
    const key = article.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return uniqueArticles.slice(0, count);
}

// 生成文章ID
export function generateArticleId(source: string, title: string): string {
  const hash = Buffer.from(`${source}:${title}`).toString('base64').slice(0, 16);
  return `article_${Date.now()}_${hash}`;
}
