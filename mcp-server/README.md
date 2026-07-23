# 知行读书 MCP Server

[![MCP](https://img.shields.io/badge/MCP-1.0-blue)](https://modelcontextprotocol.io/)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

让 Claude Desktop / Cursor 等 LLM 客户端通过 MCP (Model Context Protocol) 查询知行读书的本地阅读数据库。

## 功能

暴露 5 个只读工具，让 LLM 查询用户的阅读数据：

| 工具 | 说明 |
|------|------|
| `zhixing_list_books` | 列出书架（含划线总数、阅读进度） |
| `zhixing_search_highlights` | 搜索划线和笔记内容 |
| `zhixing_get_due_cards` | 获取已到期待复习的知识卡片（FSRS v5 调度） |
| `zhixing_get_vocabulary` | 获取生词本（默认只返回未掌握） |
| `zhixing_get_reading_stats` | 获取整体阅读统计概览 |

**安全原则**：本 Server 仅暴露 SELECT 查询，不提供任何写入/同步/删除操作，保证用户数据安全。

## 前置条件

1. **Node.js >= 18**
2. **知行读书应用已运行过**：首次启动会创建 `~/.zhixing-reader/zhixing.db` 数据库文件。如果数据库文件不存在，MCP Server 启动时会输出友好错误提示。

## 安装

```bash
cd zhixing-reader/mcp-server
npm install
npm run build
```

构建产物在 `dist/` 目录，入口为 `dist/index.js`。

## 配置

### Claude Desktop

编辑 Claude Desktop 配置文件：

- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`

添加以下配置：

```json
{
  "mcpServers": {
    "zhixing-reader": {
      "command": "node",
      "args": ["D:\\path\\to\\zhixing-reader\\mcp-server\\dist\\index.js"],
      "env": {
        "ZHIXING_DB_PATH": "C:\\Users\\你的用户名\\.zhixing-reader\\zhixing.db"
      }
    }
  }
}
```

> **路径说明**：
> - `args` 中的路径替换为你本机 `mcp-server/dist/index.js` 的绝对路径
> - `ZHIXING_DB_PATH` 可省略，默认为 `~/.zhixing-reader/zhixing.db`
> - Windows 路径用 `\\` 双反斜杠或 `/` 正斜杠

配置完成后重启 Claude Desktop，在对话中即可让 Claude 查询你的阅读数据。例如：

> "我最近在读什么书？有多少待复习的卡片？"

### Cursor

编辑 Cursor 配置文件 `~/.cursor/mcp.json`（如不存在则创建）：

```json
{
  "mcpServers": {
    "zhixing-reader": {
      "command": "node",
      "args": ["/path/to/zhixing-reader/mcp-server/dist/index.js"],
      "env": {
        "ZHIXING_DB_PATH": "/Users/你的用户名/.zhixing-reader/zhixing.db"
      }
    }
  }
}
```

配置完成后重启 Cursor，在 Chat 模式下即可调用工具。

### 自定义数据库路径

通过环境变量 `ZHIXING_DB_PATH` 指定数据库文件位置：

```bash
# 直接运行
ZHIXING_DB_PATH=/data/my-zhixing.db node dist/index.js

# 或在配置文件 env 字段中指定
```

默认路径：`~/.zhixing-reader/zhixing.db`

## 开发

```bash
# 开发模式（文件变动自动重启）
npm run dev

# 运行测试
npm test

# 测试覆盖率
npm run test: -- --coverage

# 用 MCP Inspector 交互式测试
npm run inspector
```

### MCP Inspector 测试

```bash
npm run inspector
```

这会启动 MCP Inspector Web UI，可在浏览器中：

1. 查看 5 个已注册工具的 schema
2. 交互式调用工具并查看返回结果
3. 验证 stdio 通信是否正常

## 项目结构

```
mcp-server/
├── package.json              # 独立 package.json
├── tsconfig.json             # TypeScript 配置（strict mode）
├── vitest.config.ts          # 测试配置
├── README.md                 # 本文档
├── src/
│   ├── index.ts              # MCP Server 入口（注册 5 个 tool + stdio transport）
│   ├── db.ts                 # sql.js 数据库连接管理（单例 + 环境变量）
│   ├── types.ts              # 共享类型定义
│   └── tools/
│       ├── list-books.ts         # zhixing_list_books
│       ├── search-highlights.ts # zhixing_search_highlights
│       ├── get-due-cards.ts      # zhixing_get_due_cards
│       ├── get-vocabulary.ts     # zhixing_get_vocabulary
│       └── get-reading-stats.ts  # zhixing_get_reading_stats
└── tests/
    └── tools.test.ts         # 14 个测试用例（5 个 smoke + 9 个边界）
```

## 技术栈

- **TypeScript 5.7** (strict mode)
- **@modelcontextprotocol/sdk** 官方 TypeScript SDK
- **sql.js** SQLite WASM（与知行读书主应用一致，无需原生依赖）
- **Zod** 运行时输入校验
- **Vitest** 测试框架
- **stdio transport** 本地进程通信

## 数据库 Schema 参考

本 Server 读取的表结构（与知行读书 `electron/database.ts` 一致）：

| 表 | 关键字段 |
|----|---------|
| `books` | id, title, author, reading_progress, last_read_time, is_finished, source |
| `highlights` | id, book_id, content, note, chapter_title, style, created_at |
| `cards` | id, highlight_id, state, stability, difficulty, due, reps, lapses, application_tag |
| `vocabulary` | id, word, phonetic, meaning_zh, is_mastered, review_count, next_review_at |
| `daily_stats` | date, reading_time (分钟) |

## 工具返回示例

### zhixing_list_books

```json
[
  {
    "bookId": "book_1",
    "title": "深入理解计算机系统",
    "author": "Bryant",
    "cover": null,
    "readingProgress": 0.5,
    "totalChapter": 10,
    "isFinished": false,
    "source": "weread",
    "lastReadAt": "2026-07-20T10:00:00Z",
    "createdAt": "2026-07-01T00:00:00Z",
    "updatedAt": "2026-07-20T10:00:00Z",
    "totalHighlights": 12
  }
]
```

### zhixing_get_reading_stats

```json
{
  "totalBooks": 23,
  "totalHighlights": 487,
  "totalNotes": 89,
  "totalCards": 412,
  "totalVocabulary": 156,
  "dueCardsCount": 23,
  "totalReadingTimeMinutes": 5280,
  "last7DaysReadingMinutes": 320
}
```

## 许可证

MIT
