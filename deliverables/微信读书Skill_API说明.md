# 微信读书 Skill API — 功能与集成说明

> **说明**：本文档梳理微信读书开放网关 Skill API 的既有能力，以及知行读书基于这些能力所做的具体集成。
> **版本**：v1.0.0 | **最后更新**：2026-07-25

---

## 一、微信读书 Skill API 是什么

微信读书开放网关提供了一个 **Skill API** 能力，允许第三方应用通过 **API Key** 鉴权，调用 `/shelf/sync` 等接口拉取用户的阅读数据。

**网关地址**：`https://i.weread.qq.com/api/agent/gateway`

**鉴权方式**：`Authorization: Bearer {apiKey}`，其中 API Key 通常以 `wrk-` 开头。

**请求格式**：
```json
{
  "api_name": "/shelf/sync",
  "skill_version": "1.0.5"
}
```

**响应格式**：
```json
{
  "errcode": 0,
  "errmsg": "success",
  ...
}
```

---

## 二、Skill API 已有能力

根据代码实现，当前可调用的接口包括：

### 2.1 书架同步

**接口**：`/shelf/sync`

**功能**：拉取用户书架上的所有书籍。

**返回字段**：
- `bookId` — 书籍 ID
- `title` — 书名
- `author` — 作者
- `cover` — 封面 URL
- `isbn` — ISBN
- `publisher` — 出版社
- `publishTime` — 出版时间
- `intro` — 简介
- `category` — 分类
- `finishReading` — 是否读完（0/1）
- `progress` — 阅读进度
- `readUpdateTime` — 最近阅读时间（时间戳）
- `isTop` — 是否置顶
- `secret` — 是否私密

**用途**：获取用户书架全量书籍列表，支持增量同步。

### 2.2 划线/笔记列表

**接口**：`/book/bookmarklist`

**功能**：拉取某本书的所有划线（高亮）。

**参数**：`bookId`

**返回字段**：
- `bookmarkId` — 划线 ID
- `bookId` — 书籍 ID
- `chapterUid` — 章节 UID
- `chapterTitle` — 章节标题
- `markText` — 划线内容
- `style` — 划线样式（0=普通，1=想法等）
- `range` — 位置范围
- `createTime` — 创建时间

**用途**：获取用户在某本书中的所有高亮内容，用于知识卡片蒸馏。

### 2.3 笔记/书评列表

**接口**：`/review/list/mine`

**功能**：拉取用户在某本书中的所有笔记和书评。

**参数**：
- `bookid` — 书籍 ID
- `count` — 数量限制（默认 100）

**返回字段**：
- `reviewId` — 笔记 ID
- `bookId` — 书籍 ID
- `chapterUid` — 章节 UID
- `chapterTitle` — 章节标题
- `abstract` — 摘要
- `content` — 笔记内容
- `range` — 位置范围
- `createTime` — 创建时间

**用途**：获取用户的个人笔记和公开书评，用于 AI 对话上下文和知识蒸馏。

### 2.4 章节信息

**接口**：`/book/chapterinfo`

**功能**：拉取某本书的章节列表。

**参数**：`bookId`

**返回字段**：
- `chapterUid` — 章节 UID
- `title` — 章节标题
- `level` — 章节级别

**用途**：获取书籍的章节结构，用于展示和定位划线位置。

### 2.5 批量内容获取

**组合能力**：`fetchAllContentBatch`

**功能**：批量获取多本书的划线、笔记、章节信息。

**实现方式**：并发调用 `/book/bookmarklist`、`/review/list/mine`、`/book/chapterinfo`，每批最多 3 本书，批次间隔 500ms。

**用途**：批量蒸馏知识卡片时，一次性拉取多本书的全部内容。

---

## 三、知行读书基于 Skill API 做了什么

### 3.1 书架同步

**功能**：一键同步微信读书书架到本地。

**实现细节**：
- 调用 `/shelf/sync` 拉取书架列表
- 按书名去重，新书创建记录，已读书籍更新阅读进度
- 支持按最近阅读时间排序
- 自动合并，不重复导入

**代码位置**：
- `electron/weread-api.ts` — `getBookshelf()`
- `src/renderer/src/utils/sync-bookshelf.ts` — `syncBookshelfToDb()`

### 3.2 划线抓取

**功能**：获取用户在某本书中的所有划线。

**实现细节**：
- 调用 `/book/bookmarklist` 拉取划线
- 结构化存储：`highlights` 表记录 `book_id`、`content`、`chapter`、`position`
- 用于知识卡片蒸馏、AI 对话上下文

**代码位置**：
- `electron/weread-api.ts` — `fetchBookmarks()`
- `electron/weread-api.ts` — `fetchAllContent()`

### 3.3 笔记/书评同步

**功能**：获取用户的个人笔记和公开书评。

**实现细节**：
- 调用 `/review/list/mine` 拉取笔记和书评
- 结构化存储：`notes` 表记录 `book_id`、`content`、`created_at`
- 用于 AI 对话上下文、知识蒸馏

**代码位置**：
- `electron/weread-api.ts` — `fetchNotes()`
- `electron/weread-api.ts` — `fetchAllContent()`

### 3.4 章节信息获取

**功能**：获取书籍的章节结构。

**实现细节**：
- 调用 `/book/chapterinfo` 拉取章节列表
- 存储章节 UID 和标题，用于定位划线位置

**代码位置**：
- `electron/weread-api.ts` — `fetchChapters()`
- `electron/weread-api.ts` — `fetchAllContent()`

### 3.5 自动同步

**功能**：后台定时自动同步书架。

**实现细节**：
- 支持 1 天 / 3 天 / 7 天三种同步频率
- 基于 `setTimeout` 调度，避免长时间占用内存
- 每小时兜底检查一次，防止系统时间调整导致错过执行
- 增量同步：基于 `readUpdateTime` / `lastReadTime` 判断变更
- 新导入 + 更新计数，防重复

**代码位置**：
- `electron/weread-sync-manager.ts` — 自动同步定时器
- `electron/weread-sync-manager.ts` — `syncWereadBookshelfBackground()`

### 3.6 连接测试

**功能**：验证 API Key 是否有效。

**实现细节**：
- 调用 `/shelf/sync` 测试连接
- 返回第一本书书名，用于 UI 反馈"真的拉到了一本书"
- 区分 401 认证失败、499 超时、500 服务器错误

**代码位置**：
- `electron/weread-api.ts` — `testConnection()`

---

## 四、技术实现细节

### 4.1 鉴权与加密

- API Key 通过 Electron `safeStorage.encryptString()` 加密存储
- 即使拿到用户目录也无法直接读取密钥
- 请求时通过 `Authorization: Bearer {apiKey}` 传递

### 4.2 缓存机制

- 内存缓存，TTL 5 分钟
- 缓存 Key 为 `api_name + JSON.stringify(params)`
- 减少重复请求，提升响应速度

### 4.3 重试机制

- 最大重试次数：3 次
- 指数退避：`baseDelay * attempt`
- 401/403 错误不重试，直接抛出
- 其他错误自动重试

### 4.4 错误处理

| 错误码 | 含义 | 处理方式 |
|--------|------|---------|
| 401 | API Key 无效或过期 | 提示用户重新输入 |
| 403 | 无权限 | 提示用户检查权限 |
| 499 | 连接超时 | 提示用户检查网络 |
| 500 | 服务器错误 | 自动重试后提示 |

### 4.5 批量处理

- 批量获取书籍内容时，每批最多 3 本书
- 批次间隔 500ms，避免请求过于频繁
- 单本失败不影响其他本，记录错误日志

---

## 五、基于 Skill API 的业务价值

### 5.1 数据归属用户

通过 Skill API 拉取的书籍、划线、笔记、书评全部存储在本地 SQLite（sql.js WASM），用户完全拥有自己的数据，可随时导出（JSON / Markdown / CSV）。

### 5.2 增量同步

基于 `readUpdateTime` / `lastReadTime` 判断变更，只拉取更新部分，减少 API 调用和数据处理量，提升同步速度。

### 5.3 自动合并

新导入 + 更新计数，防重复导入。例如同一本书再次同步时，只更新阅读进度和新增划线，不重复创建书籍记录。

### 5.4 离线可用

除 AI 对话需联网外，书架浏览、复习、知识卡片、英语学习等功能均可离线使用，因为数据已全部本地化。

---

## 六、接口调用示例

### 6.1 拉取书架

```typescript
const books = await getBookshelf();
// 返回 WereadBook[]，包含书名、作者、封面、进度等
```

### 6.2 拉取划线

```typescript
const bookmarks = await fetchBookmarks(bookId);
// 返回 WereadBookmark[]，包含划线内容、章节、位置等
```

### 6.3 拉取笔记

```typescript
const notes = await fetchNotes(bookId);
// 返回 WereadReview[]，包含笔记内容、摘要、创建时间等
```

### 6.4 拉取章节

```typescript
const chapters = await fetchChapters(bookId);
// 返回 WereadChapter[]，包含章节标题、级别等
```

### 6.5 批量拉取

```typescript
const results = await fetchAllContentBatch(bookIds);
// 返回 Map<bookId, {bookmarks, notes, chapters}>
```

---

## 七、已知限制

| 限制 | 说明 |
|------|------|
| 接口数量 | 当前仅实现了 4 个核心接口，微信读书 Skill API 可能还有更多未开放接口 |
| 同步频率 | 自动同步最低 1 天一次，无法实时同步 |
| 数据范围 | 仅能获取用户自己的数据，无法获取公开数据 |
| 网络依赖 | 同步功能需要联网，无法离线同步 |

---

*文档版本：v1.0.0 | 最后更新：2026-07-25*
*作者：张子涵 · 深圳信息职业技术大学*
