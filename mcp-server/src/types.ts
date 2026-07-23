/**
 * MCP Tool 共享类型定义。
 *
 * 所有 Tool 返回值采用 camelCase 命名，对 LLM 客户端更友好。
 * 数据库列名为 snake_case，在 tool 实现中做字段映射。
 */

/**
 * 书架列表项（zhixing_list_books 返回）。
 */
export interface BookListItem {
  /** 书籍唯一 ID */
  bookId: string;
  /** 书名 */
  title: string;
  /** 作者 */
  author: string | null;
  /** 封面 URL */
  cover: string | null;
  /** 阅读进度 0-1 */
  readingProgress: number;
  /** 总章节数 */
  totalChapter: number;
  /** 是否读完 */
  isFinished: boolean;
  /** 来源（weread / local） */
  source: string;
  /** 最近阅读时间 ISO 字符串 */
  lastReadAt: string | null;
  /** 创建时间 ISO 字符串 */
  createdAt: string;
  /** 更新时间 ISO 字符串 */
  updatedAt: string;
  /** 该书的划线总数 */
  totalHighlights: number;
}

/**
 * 划线/笔记搜索结果项（zhixing_search_highlights 返回）。
 */
export interface HighlightSearchItem {
  /** 划线 ID */
  id: string;
  /** 书籍 ID */
  bookId: string;
  /** 书名 */
  bookTitle: string;
  /** 划线内容 */
  content: string;
  /** 章节标题 */
  chapterTitle: string | null;
  /** 用户笔记 */
  note: string | null;
  /** 划线样式（0=下划线 1=背景色 2=删除线等） */
  style: number;
  /** 创建时间 ISO 字符串 */
  createdAt: string;
}

/**
 * 待复习知识卡片项（zhixing_get_due_cards 返回）。
 */
export interface DueCardItem {
  /** 卡片 ID */
  cardId: string;
  /** 关联划线 ID */
  highlightId: string;
  /** 关联书名 */
  bookTitle: string;
  /** 关联划线内容 */
  highlightContent: string;
  /** 卡片状态（0=新 1=学习中 2=复习中 3=重学中） */
  state: number;
  /** 稳定度（FSRS v5） */
  stability: number;
  /** 难度（FSRS v5） */
  difficulty: number;
  /** 到期时间 ISO 字符串 */
  due: string;
  /** 重复次数 */
  reps: number;
  /** 失败次数 */
  lapses: number;
  /** 应用标签 */
  applicationTag: string | null;
  /** 掌握度等级 */
  masteryLevel: number;
}

/**
 * 生词本项（zhixing_get_vocabulary 返回）。
 */
export interface VocabularyItem {
  /** 生词 ID */
  id: string;
  /** 单词 */
  word: string;
  /** 音标 */
  phonetic: string | null;
  /** 词性 */
  partOfSpeech: string | null;
  /** 中文释义 */
  definition: string;
  /** 例句（英文） */
  exampleEn: string | null;
  /** 例句（中文） */
  exampleZh: string | null;
  /** CEFR 等级 */
  cefrLevel: string | null;
  /** 来源 */
  source: string;
  /** 是否已掌握 */
  isMastered: boolean;
  /** 复习次数 */
  reviewCount: number;
  /** 最近复习时间 */
  lastReviewAt: string | null;
  /** 下次复习时间 */
  nextReviewAt: string | null;
  /** 添加时间 */
  addedAt: string;
}

/**
 * 阅读统计（zhixing_get_reading_stats 返回）。
 */
export interface ReadingStats {
  /** 书架总数 */
  totalBooks: number;
  /** 划线总数 */
  totalHighlights: number;
  /** 笔记总数（划线中 note 非空的数量） */
  totalNotes: number;
  /** 知识卡片总数 */
  totalCards: number;
  /** 生词总数 */
  totalVocabulary: number;
  /** 待复习卡片数 */
  dueCardsCount: number;
  /** 累计阅读时长（分钟） */
  totalReadingTimeMinutes: number;
  /** 最近 7 天阅读时长（分钟） */
  last7DaysReadingMinutes: number;
}

/**
 * MCP Tool 标准返回内容。
 * 遵循 MCP 协议的 content 结构。
 *
 * index signature 满足 SDK registerTool handler 返回类型约束
 * （SDK 期望返回类型允许额外字段如 isError / structuredContent）。
 */
export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  [key: string]: unknown;
}

/**
 * 将结果对象包装为 MCP Tool 返回格式。
 */
export function toToolResult(data: unknown): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(data, null, 2) }],
  };
}
