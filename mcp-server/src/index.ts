#!/usr/bin/env node
/**
 * 知行读书 MCP Server 入口。
 *
 * 通过 stdio transport 暴露知行读书本地数据库的 5 个只读工具，
 * 让 Claude Desktop / Cursor 等 LLM 客户端查询用户的阅读数据。
 *
 * 启动方式：
 *   node dist/index.js
 *
 * 环境变量：
 *   ZHIXING_DB_PATH - 数据库文件路径，默认 ~/.zhixing-reader/zhixing.db
 *
 * 安全原则：
 *   - 仅暴露 SELECT 查询，不提供任何写入/同步/删除操作
 *   - 数据库文件只读打开，不修改原文件
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { initDatabase, getDatabasePath } from './db.js';
import { toToolResult } from './types.js';
import { ListBooksInputSchema, listBooks } from './tools/list-books.js';
import { SearchHighlightsInputSchema, searchHighlights } from './tools/search-highlights.js';
import { GetDueCardsInputSchema, getDueCards } from './tools/get-due-cards.js';
import { GetVocabularyInputSchema, getVocabulary } from './tools/get-vocabulary.js';
import { getReadingStats } from './tools/get-reading-stats.js';

/**
 * 创建并配置 MCP Server 实例。
 * 抽离为函数便于测试时复用。
 */
export function createServer(): McpServer {
  const server = new McpServer({
    name: 'zhixing-reader-mcp-server',
    version: '1.0.0',
  });

  // 1. zhixing_list_books — 列出书架
  server.registerTool(
    'zhixing_list_books',
    {
      title: '列出书架',
      description: `列出知行读书书架上的书籍，按最近阅读时间倒序排列。

返回每本书的：bookId / title / author / cover / readingProgress / totalChapter / isFinished / source / lastReadAt / createdAt / updatedAt / totalHighlights

参数：
  - limit (number, 可选): 返回数量上限，1-200，默认 50

只读操作，不修改任何数据。`,
      inputSchema: ListBooksInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = await listBooks(params);
      return toToolResult(result);
    },
  );

  // 2. zhixing_search_highlights — 搜索划线/笔记
  server.registerTool(
    'zhixing_search_highlights',
    {
      title: '搜索划线/笔记',
      description: `搜索知行读书中的划线和笔记内容。

匹配范围：划线内容（content）+ 用户笔记（note），使用 LIKE 模糊匹配。

返回每条匹配的：id / bookId / bookTitle / content / chapterTitle / note / style / createdAt

参数：
  - keyword (string, 必填): 搜索关键词，1-500 字符
  - bookId (string, 可选): 限定某本书范围内搜索
  - limit (number, 可选): 返回上限，1-100，默认 20

只读操作。`,
      inputSchema: SearchHighlightsInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = await searchHighlights(params);
      return toToolResult(result);
    },
  );

  // 3. zhixing_get_due_cards — 获取待复习知识卡片
  server.registerTool(
    'zhixing_get_due_cards',
    {
      title: '获取待复习知识卡片',
      description: `获取已到期、待复习的知识卡片（FSRS v5 间隔重复算法调度）。

返回每张待复习卡片的：cardId / highlightId / bookTitle / highlightContent / state / stability / difficulty / due / reps / lapses / applicationTag / masteryLevel

按 due 时间升序排列，优先返回最该复习的卡片。

参数：
  - limit (number, 可选): 返回上限，1-100，默认 20

只读操作。`,
      inputSchema: GetDueCardsInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = await getDueCards(params);
      return toToolResult(result);
    },
  );

  // 4. zhixing_get_vocabulary — 获取生词本
  server.registerTool(
    'zhixing_get_vocabulary',
    {
      title: '获取生词本',
      description: `获取知行读书生词本，默认只返回未掌握的单词。

返回每个单词的：id / word / phonetic / partOfSpeech / definition / exampleEn / exampleZh / cefrLevel / source / isMastered / reviewCount / lastReviewAt / nextReviewAt / addedAt

排序：复习次数升序 + 添加时间倒序（新词优先）。

参数：
  - unmasteredOnly (boolean, 可选): 只返回未掌握的词，默认 true
  - limit (number, 可选): 返回上限，1-200，默认 50

只读操作。`,
      inputSchema: GetVocabularyInputSchema.shape,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (params) => {
      const result = await getVocabulary(params);
      return toToolResult(result);
    },
  );

  // 5. zhixing_get_reading_stats — 获取阅读统计
  server.registerTool(
    'zhixing_get_reading_stats',
    {
      title: '获取阅读统计',
      description: `获取知行读书整体阅读统计概览。

返回 JSON 对象：
  - totalBooks: 书架总数
  - totalHighlights: 划线总数
  - totalNotes: 笔记总数
  - totalCards: 知识卡片总数
  - totalVocabulary: 生词总数
  - dueCardsCount: 待复习卡片数
  - totalReadingTimeMinutes: 累计阅读时长（分钟）
  - last7DaysReadingMinutes: 最近 7 天阅读时长（分钟）

无参数。

只读操作。`,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async () => {
      const result = await getReadingStats();
      return toToolResult(result);
    },
  );

  return server;
}

/**
 * 主入口：初始化数据库 + 启动 stdio server。
 *
 * 错误处理：
 *   - 数据库文件不存在时输出友好错误并退出（不启动 server）
 *   - server 运行期间错误由 SDK 内部处理
 */
async function main(): Promise<void> {
  const dbPath = getDatabasePath();

  try {
    await initDatabase();
    // 输出到 stderr，不干扰 stdio JSON-RPC 通信
    console.error(`[zhixing-mcp] 数据库已连接: ${dbPath}`);
  } catch (error) {
    console.error(`[zhixing-mcp] ${error instanceof Error ? error.message : String(error)}`);
    console.error('[zhixing-mcp] MCP Server 未启动。请先启动知行读书应用以初始化数据库。');
    process.exit(1);
  }

  const server = createServer();
  const transport = new StdioServerTransport();

  try {
    await server.connect(transport);
    console.error('[zhixing-mcp] MCP Server 已启动，通过 stdio 通信');
  } catch (error) {
    console.error(`[zhixing-mcp] MCP Server 启动失败: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

// 仅在直接执行时运行主函数（不作为模块导入）
const isDirectRun =
  process.argv[1] && (
    process.argv[1].endsWith('index.js') ||
    process.argv[1].endsWith('index.ts')
  );

if (isDirectRun) {
  main().catch((error) => {
    console.error(`[zhixing-mcp] 致命错误: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
