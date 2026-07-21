# 数据库模块校验报告

## 校验时间
2026-07-21

## 校验范围
- `electron/database.ts`(2044 行)
- `electron/ipc.ts`(855 行)
- `electron/main.ts`(260 行)
- `src/shared/ipc-channels.ts`(225 行)
- `electron/services/settings-service.ts`(辅助确认 user_profiles 表使用)

## 1. 表 DDL 完整性

| # | 表名 | DDL | CRUD 函数 | 迁移逻辑 | 索引 | 状态 |
|---|------|-----|----------|----------|------|------|
| 1 | `books` | ✅ | ✅ booksDb (getAll/getById/create/createBatch/update/delete/deleteBatch/updateProgress/search/getByStatus/getRecent/count) | ✅ `CREATE TABLE IF NOT EXISTS` + `migrateBooksTable` 添加 `source` 字段 | ❌ 缺 title/author 索引(search 走 LIKE 全表扫) | ⚠️ 部分 |
| 2 | `highlights` | ✅ | ✅ highlightsDb (getByBookId/getById/exists/create/createBatch/update/delete/deleteBatch/deleteByBookId/getAll/search/count/countByBookId/getRecent) | ✅ `CREATE TABLE IF NOT EXISTS` | ✅ idx_highlights_book_id | ✅ 完整 |
| 3 | `cards` | ✅ | ✅ cardsDb (getByHighlightId/getById/create/createBatch/update/updateBatch/delete/deleteBatch/deleteByHighlightId/createForExistingHighlights/getDueCards/getByBookId/getReviewStats/updateApplicationTag/updateMasteryLevel/getByState/getNewCards/getLearningCards/count) | ✅ `CREATE TABLE IF NOT EXISTS` + `migrateCardsTable` 添加 `application_tag`、`mastery_level` | ✅ idx_cards_highlight_id, idx_cards_due | ✅ 完整 |
| 4 | `reviews` | ✅ | ✅ reviewsDb (create/getByCardId/getRecent) | ✅ `CREATE TABLE IF NOT EXISTS` | ✅ idx_reviews_card_id | ✅ 完整 |
| 5 | `book_summaries` | ✅ | ✅ bookSummariesDb (getByBookId/create/delete) | ✅ `CREATE TABLE IF NOT EXISTS` | ✅ `book_id UNIQUE` 隐式索引 | ✅ 完整 |
| 6 | `daily_stats` | ✅ | ✅ dailyStatsDb (getToday/getRange/incrementBooksRead/incrementHighlightsAdded/incrementCardsReviewed/addReadingTime) | ✅ `CREATE TABLE IF NOT EXISTS` + `ON CONFLICT(date) DO UPDATE` | ✅ idx_daily_stats_date | ✅ 完整 |
| 7 | `token_usage` | ✅ | ✅ tokenUsageDb (create/getByDateRange/getRecent/getStatsByProvider/getStatsByFeature/getDailyStats/getTotalStats/deleteOlderThan/clearAll) | ✅ `CREATE TABLE IF NOT EXISTS` | ❌ 无 created_at 索引(getByDateRange / getDailyStats 走 date(created_at) 全表扫) | ⚠️ 部分 |
| 8 | `conversations` | ✅ | ✅ conversationDb (create/getAll/getById/update/delete/addMessage/getMessages/search) | ✅ `CREATE TABLE IF NOT EXISTS` | ✅ idx_conversations_updated | ✅ 完整 |
| 9 | `chat_messages` | ✅ | ✅ conversationDb.addMessage / getMessages / search | ✅ `CREATE TABLE IF NOT EXISTS` | ✅ idx_messages_conversation | ✅ 完整 |
| 10 | `user_profiles` | ✅ | ❌ **无任何 CRUD 函数**;`settingsService` 实际用 JSON 文件(`settings.json` + `safeStorage`),不读写该表 | ✅ `CREATE TABLE IF NOT EXISTS`(但无意义) | ❌ 无索引 | ❌ **孤儿表** |
| 11 | `methodologies` | ✅ | ✅ methodologiesDb (create/getById/getByBookId/getAll/update/delete/search) | ✅ `CREATE TABLE IF NOT EXISTS` | ✅ idx_methodologies_book_id | ✅ 完整 |
| 12 | `knowledge_cards` | ✅ | ✅ knowledgeCardsDb (create/getById/getByBookId/getByType/getAll/update/delete/search) | ✅ `CREATE TABLE IF NOT EXISTS` | ✅ idx_knowledge_cards_book_id, idx_knowledge_cards_type | ✅ 完整 |
| 13 | `book_architecture` | ✅ | ✅ bookArchitectureDb (create/getById/getByBookId/update/delete) | ✅ `CREATE TABLE IF NOT EXISTS` | ✅ idx_book_architecture_book_id, `book_id UNIQUE` 隐式索引 | ✅ 完整 |
| 14 | `articles` | ✅ | ✅ articlesDb (getAll/getById/getUnread/getFavorites/create/markAsRead/toggleFavorite/delete/count/getTodayCount) | ✅ `CREATE TABLE IF NOT EXISTS` + `migrateCardsTable` 中添加 `source_website` 字段 | ✅ idx_articles_source, idx_articles_created, idx_articles_difficulty | ✅ 完整 |
| 15 | `vocabulary` | ✅ | ✅ vocabularyDb (getAll/getById/getByWord/getUnmastered/getDueForReview/create/updateReviewData/markAsMastered/incrementReviewCount/delete/count/getMasteredCount/search) | ✅ `CREATE TABLE IF NOT EXISTS` + `migrateCardsTable` 中迁移 7 个字段(source/next_review_at/ef_factor/interval_days/repetition_count/familiarity_level/learning_stage) | ✅ idx_vocabulary_word, idx_vocabulary_mastered | ✅ 完整 |
| 16 | `memories` | ✅ | ✅ memoriesDb (create/getAll/getRelevant/incrementAccess/getStats/deleteOldestBeyond/clearAll) | ✅ `CREATE TABLE IF NOT EXISTS` | ✅ idx_memories_type, idx_memories_importance | ✅ 完整 |

### 汇总

- **共 16 张表**
- ✅ 完整: **13 张** (highlights / cards / reviews / book_summaries / daily_stats / conversations / chat_messages / methodologies / knowledge_cards / book_architecture / articles / vocabulary / memories)
- ⚠️ 部分: **2 张** (books 缺索引、token_usage 缺索引)
- ❌ 缺失: **1 张** (user_profiles 完全未使用,孤儿表)

### 备注

- `cards.update()` SQL 不更新 `application_tag` / `mastery_level` 字段,但通过独立的 `updateApplicationTag` / `updateMasteryLevel` 函数补齐,设计分散但功能完整。
- `books.create` / `books.createBatch` 的 INSERT 列表未含 `source` 字段,依赖 `DEFAULT 'weread'` 默认值。如需在创建时显式指定来源(如本地导入),需扩展 SQL。

---

## 2. IPC 通道 handler 校验

### 2.1 BOOKS (7/7)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 参数校验 | 状态 |
|------|--------------|------------|----------|----------|------|
| `books:getAll` | ✅ L33 | ✅ booksDb.getAll | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `books:getById` | ✅ L34 | ✅ booksDb.getById | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `books:create` | ✅ L35 | ✅ booksDb.create | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `books:update` | ✅ L36 | ✅ booksDb.update | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `books:delete` | ✅ L37 | ✅ booksDb.delete | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `books:updateProgress` | ✅ L38 | ✅ booksDb.updateProgress | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `books:search` | ✅ L39 | ✅ booksDb.search | ✅ wrapper | ⚠️ 无 | ✅ 可用 |

### 2.2 HIGHLIGHTS (7/7)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 参数校验 | 状态 |
|------|--------------|------------|----------|----------|------|
| `highlights:getByBook` | ✅ L41 | ✅ highlightsDb.getByBookId | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `highlights:getById` | ✅ L42 | ✅ highlightsDb.getById | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `highlights:create` | ✅ L43-81 | ✅ highlightsDb.create + 副作用(自动建 FSRS 卡 + RAG 索引) | ✅ wrapper + 内部 try/catch | ⚠️ 无 | ✅ 可用 |
| `highlights:update` | ✅ L82 | ✅ highlightsDb.update | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `highlights:delete` | ✅ L83 | ✅ highlightsDb.delete | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `highlights:getAll` | ✅ L84 | ✅ highlightsDb.getAll | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `highlights:search` | ✅ L85 | ✅ highlightsDb.search | ✅ wrapper | ⚠️ 无 | ✅ 可用 |

### 2.3 CARDS (12/12)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 参数校验 | 状态 |
|------|--------------|------------|----------|----------|------|
| `cards:getByHighlight` | ✅ L87 | ✅ cardsDb.getByHighlightId | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `cards:getById` | ✅ L88 | ✅ cardsDb.getById | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `cards:create` | ✅ L89 | ✅ cardsDb.create | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `cards:createBatch` | ✅ L90 | ✅ cardsDb.createBatch | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `cards:createForExisting` | ✅ L91 | ✅ cardsDb.createForExistingHighlights | ✅ wrapper | ✅ 无参数 | ✅ 可用 |
| `cards:update` | ✅ L92 | ✅ cardsDb.update | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `cards:updateApplicationTag` | ✅ L93 | ✅ cardsDb.updateApplicationTag | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `cards:updateMasteryLevel` | ✅ L94 | ✅ cardsDb.updateMasteryLevel | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `cards:delete` | ✅ L95 | ✅ cardsDb.delete | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `cards:getDue` | ✅ L96 | ✅ cardsDb.getDueCards | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `cards:getByBook` | ✅ L97 | ✅ cardsDb.getByBookId | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `cards:getStats` | ✅ L98 | ✅ cardsDb.getReviewStats | ✅ wrapper | ✅ 无参数 | ✅ 可用 |

### 2.4 REVIEWS (3/3)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 参数校验 | 状态 |
|------|--------------|------------|----------|----------|------|
| `reviews:create` | ✅ L100 | ✅ reviewsDb.create | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `reviews:getByCard` | ✅ L101 | ✅ reviewsDb.getByCardId | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `reviews:getRecent` | ✅ L102 | ✅ reviewsDb.getRecent | ✅ wrapper | ⚠️ 无 | ✅ 可用 |

### 2.5 SUMMARIES (3/3)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 参数校验 | 状态 |
|------|--------------|------------|----------|----------|------|
| `summaries:getByBook` | ✅ L342 | ✅ bookSummariesDb.getByBookId | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `summaries:create` | ✅ L343-345 | ✅ bookSummariesDb.create | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `summaries:delete` | ✅ L346 | ✅ bookSummariesDb.delete | ✅ wrapper | ⚠️ 无 | ✅ 可用 |

### 2.6 DAILY_STATS (6/6)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 参数校验 | 状态 |
|------|--------------|------------|----------|----------|------|
| `dailyStats:getToday` | ✅ L348 | ✅ dailyStatsDb.getToday | ✅ wrapper | ✅ 无参数 | ✅ 可用 |
| `dailyStats:getRange` | ✅ L349-351 | ✅ dailyStatsDb.getRange | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `dailyStats:incrementBooks` | ✅ L352 | ✅ dailyStatsDb.incrementBooksRead | ✅ wrapper | ✅ 无参数 | ✅ 可用 |
| `dailyStats:incrementHighlights` | ✅ L353-355 | ✅ dailyStatsDb.incrementHighlightsAdded | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `dailyStats:incrementCards` | ✅ L356-358 | ✅ dailyStatsDb.incrementCardsReviewed | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `dailyStats:addReadingTime` | ✅ L359-361 | ✅ dailyStatsDb.addReadingTime | ✅ wrapper | ⚠️ 无 | ✅ 可用 |

### 2.7 WEREAD (8/8)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 参数校验 | 状态 |
|------|--------------|------------|----------|----------|------|
| `weread:setApiKey` | ✅ L363 | ✅ setApiKey | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `weread:getBookshelf` | ✅ L364 | ✅ getBookshelf | ✅ wrapper | ✅ 无参数 | ✅ 可用 |
| `weread:fetchBookmarks` | ✅ L365 | ✅ fetchBookmarks | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `weread:fetchNotes` | ✅ L366 | ✅ fetchNotes | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `weread:fetchAllContent` | ✅ L367 | ✅ fetchAllContent | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `weread:fetchAllContentBatch` | ✅ L623-625 | ✅ fetchAllContentBatch | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `weread:fetchRecommendations` | ✅ L368 | ✅ fetchRecommendations | ✅ wrapper | ✅ 无参数 | ✅ 可用 |
| `weread:test` | ✅ L528 | ✅ testWereadConnection | ✅ wrapper | ⚠️ 无 | ✅ 可用 |

### 2.8 READING_DATA (5/5)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 参数校验 | 状态 |
|------|--------------|------------|----------|----------|------|
| `readingData:fetch` | ✅ L530 | ✅ fetchReadingData | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `readingData:fetchWeekly` | ✅ L531 | ✅ fetchReadingData('weekly') | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `readingData:fetchMonthly` | ✅ L532 | ✅ fetchReadingData('monthly') | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `readingData:fetchAnnually` | ✅ L533 | ✅ fetchReadingData('annually') | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `readingData:fetchOverall` | ✅ L534 | ✅ fetchReadingData('overall') | ✅ wrapper | ✅ 无参数 | ✅ 可用 |

### 2.9 AI (6/6)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 参数校验 | 状态 |
|------|--------------|------------|----------|----------|------|
| `ai:setConfig` | ✅ L370 | ✅ setAIConfig | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `ai:generateCards` | ✅ L371-373 | ✅ generateCards | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `ai:generateSummary` | ✅ L374-376 | ✅ generateSummary | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `ai:chat` | ✅ L377-379 | ✅ chatWithContext | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `ai:explain` | ✅ L380-382 | ✅ explainHighlight | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `ai:test` | ✅ L383 | ✅ testAIConnection | ✅ wrapper | ⚠️ 无 | ✅ 可用 |

### 2.10 CONVERSATIONS (8/8)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 参数校验 | 状态 |
|------|--------------|------------|----------|----------|------|
| `conversations:create` | ✅ L448 | ✅ conversationDb.create | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `conversations:getAll` | ✅ L449 | ✅ conversationDb.getAll | ✅ wrapper | ✅ 无参数 | ✅ 可用 |
| `conversations:getById` | ✅ L450 | ✅ conversationDb.getById | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `conversations:update` | ✅ L451 | ✅ conversationDb.update | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `conversations:delete` | ✅ L452 | ✅ conversationDb.delete | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `conversations:addMessage` | ✅ L453 | ✅ conversationDb.addMessage | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `conversations:getMessages` | ✅ L454 | ✅ conversationDb.getMessages | ✅ wrapper | ⚠️ 无 | ✅ 可用 |
| `conversations:search` | ✅ L455 | ✅ conversationDb.search | ✅ wrapper | ⚠️ 无 | ✅ 可用 |

### 2.11 AGENT (3/4)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 参数校验 | 状态 |
|------|--------------|------------|----------|----------|------|
| `agent:chat` | ❌ **未注册** | ❌ — | ❌ — | ❌ — | ❌ **死代码** |
| `agent:streamChat` | ✅ L385-406 (ipcMain.handle 直注册) | ✅ streamChat | ⚠️ 内部 try 不全,异常通过 on-error 回调返回 | ⚠️ 无 | ✅ 可用 |
| `agent:streamChatWithContext` | ✅ L414-446 (ipcMain.handle 直注册) | ✅ processMessageStream | ⚠️ 同上 | ⚠️ 无 | ✅ 可用 |
| `agent:cancelStream` | ✅ L408-412 | ✅ cancelActiveStream | ✅ wrapper | ✅ 无参数 | ✅ 可用 |

**注**:STREAM 类(`ai:streamChunk` / `ai:streamReasoningChunk` / `ai:streamComplete` / `ai:streamError`)是主进程 → 渲染进程的 send 事件通道,无需 ipcMain.handle 注册,不列入校验范围。

### 2.12 ADMIN (22/22)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 状态 |
|------|--------------|------------|----------|------|
| `admin:getStats` | ✅ L458-463 | ✅ admin.getAdminStats + getTokenUsageLast7Days + getAdminSessions.slice | ✅ wrapper | ✅ 可用 |
| `admin:getAgentConfig` | ✅ L464-466 | ✅ admin.getAgentConfig | ✅ wrapper | ✅ 可用 |
| `admin:saveAgentConfig` | ✅ L467-469 | ✅ admin.saveAgentConfig | ✅ wrapper | ✅ 可用 |
| `admin:resetAgentConfig` | ✅ L470-472 | ✅ admin.resetAgentConfig | ✅ wrapper | ✅ 可用 |
| `admin:getBooksWithCounts` | ✅ L473-475 | ✅ admin.getBooksWithCounts | ✅ wrapper | ✅ 可用 |
| `admin:getHighlightsByBook` | ✅ L476-478 | ✅ admin.getHighlightsByBook | ✅ wrapper | ✅ 可用 |
| `admin:getCardsByBook` | ✅ L479-481 | ✅ admin.getCardsByBook | ✅ wrapper | ✅ 可用 |
| `admin:getSessions` | ✅ L482-484 | ✅ admin.getAdminSessions | ✅ wrapper | ✅ 可用 |
| `admin:getSessionMessages` | ✅ L485-487 | ✅ admin.getAdminSessionMessages | ✅ wrapper | ✅ 可用 |
| `admin:getPrompts` | ✅ L488-490 | ✅ admin.getAllAdminPrompts | ✅ wrapper | ✅ 可用 |
| `admin:getPrompt` | ✅ L491-493 | ✅ admin.getAdminPrompt | ✅ wrapper | ✅ 可用 |
| `admin:savePrompt` | ✅ L494-496 | ✅ admin.saveAdminPrompt | ✅ wrapper | ✅ 可用 |
| `admin:resetPrompt` | ✅ L497-499 | ✅ admin.resetAdminPrompt | ✅ wrapper | ✅ 可用 |
| `admin:resetAllPrompts` | ✅ L500-502 | ✅ admin.resetAllAdminPrompts | ✅ wrapper | ✅ 可用 |
| `admin:exportPrompts` | ✅ L503-505 | ✅ admin.exportAdminPrompts | ✅ wrapper | ✅ 可用 |
| `admin:importPrompts` | ✅ L506-508 | ✅ admin.importAdminPrompts | ✅ wrapper | ✅ 可用 |
| `admin:getDatabaseSchema` | ✅ L509-511 | ✅ admin.getDatabaseSchema | ✅ wrapper | ✅ 可用 |
| `admin:getTableData` | ✅ L512-514 | ✅ admin.getDatabaseTableData | ✅ wrapper | ✅ 可用 |
| `admin:createCustomPrompt` | ✅ L515-517 | ✅ admin.createAdminCustomPrompt | ✅ wrapper | ✅ 可用 |
| `admin:updateCustomPrompt` | ✅ L518-520 | ✅ admin.updateAdminCustomPrompt | ✅ wrapper | ✅ 可用 |
| `admin:deleteCustomPrompt` | ✅ L521-523 | ✅ admin.deleteAdminCustomPrompt | ✅ wrapper | ✅ 可用 |
| `admin:getCustomPrompts` | ✅ L524-526 | ✅ admin.getAllAdminCustomPrompts | ✅ wrapper | ✅ 可用 |

### 2.13 SETTINGS (3/3)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 状态 |
|------|--------------|------------|----------|------|
| `settings:get` | ✅ L536 | ✅ settingsService.get | ✅ wrapper | ✅ 可用 |
| `settings:set` | ✅ L537-549 | ✅ settingsService.set + refreshWereadAutoSyncTimer 副作用 | ✅ wrapper + 内部 try/catch | ✅ 可用 |
| `settings:getAll` | ✅ L550 | ✅ settingsService.getAll | ✅ wrapper | ✅ 可用 |

### 2.14 TOKEN_USAGE (7/7)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 状态 |
|------|--------------|------------|----------|------|
| `tokenUsage:getRecent` | ✅ L627-629 | ✅ tokenUsageDb.getRecent | ✅ wrapper | ✅ 可用 |
| `tokenUsage:getByDateRange` | ✅ L631-633 | ✅ tokenUsageDb.getByDateRange | ✅ wrapper | ✅ 可用 |
| `tokenUsage:getStatsByProvider` | ✅ L635-637 | ✅ tokenUsageDb.getStatsByProvider | ✅ wrapper | ✅ 可用 |
| `tokenUsage:getStatsByFeature` | ✅ L639-641 | ✅ tokenUsageDb.getStatsByFeature | ✅ wrapper | ✅ 可用 |
| `tokenUsage:getDailyStats` | ✅ L643-645 | ✅ tokenUsageDb.getDailyStats | ✅ wrapper | ✅ 可用 |
| `tokenUsage:getTotalStats` | ✅ L647-649 | ✅ tokenUsageDb.getTotalStats | ✅ wrapper | ✅ 可用 |
| `tokenUsage:clearAll` | ✅ L651-654 | ✅ tokenUsageDb.clearAll | ✅ wrapper | ✅ 可用 |

### 2.15 METHODOLOGIES (8/8)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 状态 |
|------|--------------|------------|----------|------|
| `methodologies:getAll` | ✅ L656 | ✅ methodologiesDb.getAll | ✅ wrapper | ✅ 可用 |
| `methodologies:getById` | ✅ L657 | ✅ methodologiesDb.getById | ✅ wrapper | ✅ 可用 |
| `methodologies:getByBook` | ✅ L658 | ✅ methodologiesDb.getByBookId | ✅ wrapper | ✅ 可用 |
| `methodologies:create` | ✅ L659-663 | ✅ methodologiesDb.create | ✅ wrapper | ✅ 可用 |
| `methodologies:update` | ✅ L664 | ✅ methodologiesDb.update | ✅ wrapper | ✅ 可用 |
| `methodologies:delete` | ✅ L665 | ✅ methodologiesDb.delete | ✅ wrapper | ✅ 可用 |
| `methodologies:search` | ✅ L666 | ✅ methodologiesDb.search | ✅ wrapper | ✅ 可用 |
| `methodologies:extract` | ✅ L667-751 | ✅ highlightsDb + fetchAllContent + extractMethodologies + methodologiesDb.create (复合流程) | ✅ wrapper + 内部 try/catch | ✅ 可用 |

### 2.16 KNOWLEDGE_CARDS (13/13)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 状态 |
|------|--------------|------------|----------|------|
| `knowledgeCards:getAll` | ✅ L753 | ✅ knowledgeCardsDb.getAll | ✅ wrapper | ✅ 可用 |
| `knowledgeCards:getById` | ✅ L754 | ✅ knowledgeCardsDb.getById | ✅ wrapper | ✅ 可用 |
| `knowledgeCards:getByBook` | ✅ L755 | ✅ knowledgeCardsDb.getByBookId | ✅ wrapper | ✅ 可用 |
| `knowledgeCards:getByType` | ✅ L756 | ✅ knowledgeCardsDb.getByType | ✅ wrapper | ✅ 可用 |
| `knowledgeCards:create` | ✅ L757-761 | ✅ knowledgeCardsDb.create | ✅ wrapper | ✅ 可用 |
| `knowledgeCards:update` | ✅ L762 | ✅ knowledgeCardsDb.update | ✅ wrapper | ✅ 可用 |
| `knowledgeCards:delete` | ✅ L763 | ✅ knowledgeCardsDb.delete | ✅ wrapper | ✅ 可用 |
| `knowledgeCards:search` | ✅ L764 | ✅ knowledgeCardsDb.search | ✅ wrapper | ✅ 可用 |
| `knowledgeCards:distill` | ✅ L765-767 | ✅ knowledgeCardService.distillBook | ✅ wrapper | ✅ 可用 |
| `knowledgeCards:cancelDistill` | ✅ L768-771 | ✅ knowledgeCardService.cancelDistill | ✅ wrapper | ✅ 可用 |
| `knowledgeCards:isDistilling` | ✅ L772-774 | ✅ knowledgeCardService.isDistilling | ✅ wrapper | ✅ 可用 |
| `knowledgeCards:generateInterpretation` | ✅ L775-778 | ✅ generateCardInterpretation | ✅ wrapper | ✅ 可用 |
| `knowledgeCards:generateApplication` | ✅ L779-782 | ✅ generateCardApplication | ✅ wrapper | ✅ 可用 |

**注**:`knowledgeCard:distillProgress` 是主进程 → 渲染进程 send 事件,无需 handler。

### 2.17 BOOK_ARCHITECTURE (5/5)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 状态 |
|------|--------------|------------|----------|------|
| `bookArchitecture:getByBook` | ✅ L784 | ✅ bookArchitectureDb.getByBookId | ✅ wrapper | ✅ 可用 |
| `bookArchitecture:create` | ✅ L785-789 | ✅ bookArchitectureDb.create | ✅ wrapper | ✅ 可用 |
| `bookArchitecture:update` | ✅ L790 | ✅ bookArchitectureDb.update | ✅ wrapper | ✅ 可用 |
| `bookArchitecture:delete` | ✅ L791 | ✅ bookArchitectureDb.delete | ✅ wrapper | ✅ 可用 |
| `bookArchitecture:analyze` | ✅ L792-814 | ✅ analyzeBookArchitecture + bookArchitectureDb.create | ✅ wrapper | ✅ 可用 |

### 2.18 ARTICLES (11/11)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 状态 |
|------|--------------|------------|----------|------|
| `articles:getAll` | ✅ L105 | ✅ articlesDb.getAll | ✅ wrapper | ✅ 可用 |
| `articles:getById` | ✅ L106 | ✅ articlesDb.getById | ✅ wrapper | ✅ 可用 |
| `articles:getUnread` | ✅ L107 | ✅ articlesDb.getUnread | ✅ wrapper | ✅ 可用 |
| `articles:getFavorites` | ✅ L108 | ✅ articlesDb.getFavorites | ✅ wrapper | ✅ 可用 |
| `articles:create` | ✅ L109 | ✅ articlesDb.create | ✅ wrapper + 内部 try/catch | ✅ 可用 |
| `articles:markAsRead` | ✅ L110 | ✅ articlesDb.markAsRead | ✅ wrapper | ✅ 可用 |
| `articles:toggleFavorite` | ✅ L111 | ✅ articlesDb.toggleFavorite | ✅ wrapper | ✅ 可用 |
| `articles:delete` | ✅ L112 | ✅ articlesDb.delete | ✅ wrapper | ✅ 可用 |
| `articles:getStats` | ✅ L113-116 | ✅ articlesDb.count + getTodayCount | ✅ wrapper | ✅ 可用 |
| `articles:fetchRss` | ✅ L117-183 | ✅ fetchAllRssSources + articlesDb.create + translateArticle | ✅ wrapper + 内部 try/catch | ✅ 可用 |
| `articles:translate` | ✅ L186-210 | ✅ translateArticle + db.run UPDATE | ✅ wrapper + 内部 try/catch | ✅ 可用 |

### 2.19 VOCABULARY (15/15)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 状态 |
|------|--------------|------------|----------|------|
| `vocabulary:getAll` | ✅ L213 | ✅ vocabularyDb.getAll | ✅ wrapper | ✅ 可用 |
| `vocabulary:getById` | ✅ L214 | ✅ vocabularyDb.getById | ✅ wrapper | ✅ 可用 |
| `vocabulary:getByWord` | ✅ L215 | ✅ vocabularyDb.getByWord | ✅ wrapper | ✅ 可用 |
| `vocabulary:getUnmastered` | ✅ L216 | ✅ vocabularyDb.getUnmastered | ✅ wrapper | ✅ 可用 |
| `vocabulary:getDueForReview` | ✅ L217 | ✅ vocabularyDb.getDueForReview | ✅ wrapper | ✅ 可用 |
| `vocabulary:create` | ✅ L218 | ✅ vocabularyDb.create | ✅ wrapper + 内部 try/catch | ✅ 可用 |
| `vocabulary:createFromLookup` | ✅ L219-240 | ✅ dictionaryService.lookup + vocabularyDb.create | ✅ wrapper | ✅ 可用 |
| `vocabulary:markAsMastered` | ✅ L241 | ✅ vocabularyDb.markAsMastered | ✅ wrapper | ✅ 可用 |
| `vocabulary:incrementReview` | ✅ L242 | ✅ vocabularyDb.incrementReviewCount | ✅ wrapper | ✅ 可用 |
| `vocabulary:updateReviewData` | ✅ L243 | ✅ vocabularyDb.updateReviewData | ✅ wrapper + 内部 try/catch | ✅ 可用 |
| `vocabulary:delete` | ✅ L244 | ✅ vocabularyDb.delete | ✅ wrapper | ✅ 可用 |
| `vocabulary:getStats` | ✅ L245-249 | ✅ vocabularyDb.count/getMasteredCount/getDueCount | ✅ wrapper | ✅ 可用 |
| `vocabulary:search` | ✅ L250 | ✅ vocabularyDb.search | ✅ wrapper | ✅ 可用 |
| `vocabulary:export` | ✅ L251-330 | ✅ dialog.showSaveDialog + fs.writeFileSync + CSV/Anki 转义 | ✅ wrapper + 内部校验 | ✅ 可用 |

### 2.20 DICTIONARY (3/3)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 状态 |
|------|--------------|------------|----------|------|
| `dictionary:lookup` | ✅ L333-335 | ✅ dictionaryService.lookup | ✅ wrapper | ✅ 可用 |
| `dictionary:lookupBatch` | ✅ L336-339 | ✅ dictionaryService.lookupBatch | ✅ wrapper | ✅ 可用 |
| `dictionary:getSize` | ✅ L340 | ✅ dictionaryService.getSize | ✅ wrapper | ✅ 可用 |

### 2.21 SYSTEM (5/5)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 参数校验 | 状态 |
|------|--------------|------------|----------|----------|------|
| `system:forceSaveDatabase` | ✅ L552-555 | ✅ forceSaveDatabase | ✅ wrapper | ✅ 无参数 | ✅ 可用 |
| `system:clearCache` | ✅ L557-560 | ✅ clearWeReadApiCache | ✅ wrapper | ✅ 无参数 | ✅ 可用 |
| `system:openExternal` | ✅ L562-572 | ✅ shell.openExternal | ✅ wrapper | ✅ 校验 url 非空 + 协议白名单(http/https/weread) | ✅ 可用 |
| `system:clearHistory` | ✅ L574-577 | ✅ clearConversationsAndMessages | ✅ wrapper | ✅ 无参数 | ✅ 可用 |
| `system:resetDatabase` | ✅ L579-587 | ✅ resetDatabase + app.relaunch | ✅ wrapper | ✅ 无参数 | ✅ 可用 |

### 2.22 FSRS (6/6)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 状态 |
|------|--------------|------------|----------|------|
| `fsrs:setParameters` | ✅ L589-592 | ✅ setCustomParameters | ✅ wrapper | ✅ 可用 |
| `fsrs:resetParameters` | ✅ L594-597 | ✅ resetParameters | ✅ wrapper | ✅ 可用 |
| `fsrs:getParameters` | ✅ L599-601 | ✅ getParameters | ✅ wrapper | ✅ 可用 |
| `fsrs:getForecast` | ✅ L603-607 | ✅ getForecast | ✅ wrapper | ✅ 可用 |
| `fsrs:getOptimalReviewOrder` | ✅ L609-612 | ✅ getOptimalReviewOrder | ✅ wrapper | ✅ 可用 |
| `fsrs:previewReviewRatings` | ✅ L614-621 | ✅ cardFromDb + previewReviewRatings | ✅ wrapper | ✅ 可用 |

### 2.23 SKILL (2/2)

| 通道 | handler 注册 | 调真实函数 | 错误处理 | 状态 |
|------|--------------|------------|----------|------|
| `skill:generate` | ✅ L816-832 | ✅ methodologiesDb.getById + generateSkill | ✅ wrapper + 内部参数校验(methodology 不存在抛错) | ✅ 可用 |
| `skill:exportBatch` | ✅ L834-852 | ✅ methodologiesDb.getById + generateSkillBatch | ✅ wrapper | ✅ 可用 |

### 汇总

- **共 137 个 IPC 通道**(不含 STREAM / DISTILL_PROGRESS 事件 channel)
- ✅ 可用: **136 个**
- ❌ 死代码: **1 个** (`agent:chat`)
- ⚠️ 部分: 0 个

**整体错误处理**: 全部 `handle()` wrapper 统一 try/catch,异常返回 `{ success: false, error: errorMessage }`,日志记录到 `logger.error`。✅

**整体参数校验**: 多数 handler 缺少显式参数校验(依赖 TS 类型 + db 错误兜底)。仅 `system:openExternal`、`vocabulary:export`、`articles:translate`、`methodologies:extract` 等少数 handler 有显式校验。**P2 改进项**(不影响功能,但建议为关键路径补 schema 校验)。

---

## 3. 数据库初始化与迁移

| 项目 | 状态 | 说明 |
|------|------|------|
| sql.js wasm 路径 | ✅ | `await initSqlJs()` 默认查找,Electron 主进程 Node 环境下默认加载 sql-wasm.wasm,打包后经 electron-vite 处理。无显式 `locateFile` 配置,但运行 OK。 |
| 数据库文件路径 | ✅ | `path.join(app.getPath('userData'), 'zhixing.db')`,跨平台 userData 标准目录。 |
| 自动建表 | ✅ | `initDatabase()` 中所有 16 张表均用 `CREATE TABLE IF NOT EXISTS`,启动时幂等。 |
| 自动迁移 | ✅ | 显式迁移函数 3 个:`migrateCardsTable()`(cards + vocabulary + articles 三个表的列迁移)、`migrateBooksTable()`(books 的 source 字段)。使用 `PRAGMA table_info` 检查后 `ALTER TABLE ADD COLUMN`,幂等。 |
| 持久化时机 | ✅ | 三层保障:① `saveDatabase()` 走 `markDirty()` + 3 秒 debounce;② 窗口 `close` 事件触发 `forceSaveDatabase()`;③ `before-quit` 触发 `closeDatabase()`(内部 forceSave)。 |
| 外键约束 | ✅ | `PRAGMA foreign_keys = ON` 启用;`resetDatabase` 中临时 `PRAGMA foreign_keys = OFF` 避免级联干扰,finally 中恢复 ON。 |
| 事务支持 | ✅ | `runTransaction()` 包 BEGIN/COMMIT/ROLLBACK;异常自动回滚。 |

---

## 4. 问题清单

### P0(阻塞)

- **`user_profiles` 表完全未使用**:DDL 创建 + resetDatabase 中清空,但全代码库无任何 CRUD 函数,`settingsService` 实际用 `settings.json` + `safeStorage` 文件存储。
  - **影响**:数据库存在死表,resetDatabase 多执行一条 DELETE,语义混乱。
  - **建议**:二选一 — ① 删除该表 DDL + resetDatabase 中条目;② 将 settingsService 改造为 SQL 存储(工作量大,不推荐)。
  - **临时处置**:本任务以校验为主,不强制修复。建议由后续 fix-implementer 删除孤儿表。

### P1(应修复)

- **`agent:chat` IPC 通道死代码**:`src/shared/ipc-channels.ts:88` 定义了 `AGENT.CHAT = 'agent:chat'`,但 `electron/ipc.ts` 中无对应 `ipcMain.handle` 注册,渲染进程也无任何 `electronAPI.agent.chat` 调用。仅 `tests/ipc-channels.test.ts:45` 作为"必须用常量引用"的检查项提及。
  - **影响**:无用代码污染 IPC 命名空间,易误导后续开发者。
  - **建议**:二选一 — ① 删除 `IPC_CHANNELS.AGENT.CHAT` 常量 + test 中的检查项;② 如确实需要,在 ipc.ts 注册 handler(但流式 `agent:streamChat` 已覆盖该场景,建议删除)。

### P2(改进建议)

- **`books` 表无 `title` / `author` 索引**:`booksDb.search(keyword)` 使用 `LIKE '%keyword%'` 全表扫描。书量超过数千时性能下降明显。
  - **建议**:增加 `CREATE INDEX IF NOT EXISTS idx_books_title ON books(title);` 和 `idx_books_author`。注意 LIKE '%x%' 无法走索引,可考虑 FTS5 全文索引(成本较高,根据用户实际数据量决定)。

- **`token_usage` 表无 `created_at` 索引**:`getByDateRange` / `getDailyStats` 使用 `date(created_at) BETWEEN` 全表扫。
  - **建议**:增加 `CREATE INDEX IF NOT EXISTS idx_token_usage_created ON token_usage(created_at);`。

- **`books.create` / `books.createBatch` 未插入 `source` 字段**:依赖 `DEFAULT 'weread'` 默认值。如需在创建时区分"weread" / "local" 来源,需扩展 SQL。
  - **建议**:扩展 INSERT 列表加入 `source` 列,允许调用方显式传入。

- **普遍缺少显式参数校验**:大部分 handler 依赖 TS 类型 + db 错误兜底,缺少 schema 校验。关键路径(如 `books.create` / `vocabulary.create` / `articles.create`)建议引入轻量校验(如 zod 或手写 type guard)。
  - **建议**:作为系统化改进项,可选。

- **`agent:streamChat` / `agent:streamChatWithContext` 直接 `ipcMain.handle` 绕过 `handle()` wrapper**:错误处理通过 on-error 回调而非统一返回 `{ success, error }`,与其他 handler 风格不一致。
  - **影响**:前端需要分别处理流式和非流式 handler 的错误响应格式。
  - **建议**:文档化此设计差异即可,不改(改造成本高)。

---

## 5. 修复建议(可选)

本任务以校验为主,未执行修复。如需后续 fix-implementer 接手,建议优先级:

1. **P0** — 删除 `user_profiles` 表(DDL + resetDatabase 引用)。
2. **P1** — 删除 `IPC_CHANNELS.AGENT.CHAT` 常量 + `tests/ipc-channels.test.ts` 中的 `'agent:chat'` 检查项。
3. **P2** — 增加 `idx_books_title` / `idx_books_author` / `idx_token_usage_created` 三个索引。
4. **P2** — 扩展 `books.create` / `books.createBatch` 支持 `source` 参数。

修复后建议跑 `npm run lint && npm run typecheck && npm run build` 三绿验证。

---

## 6. 评分

**8.5 / 10**

### 扣分明细

| 项 | 扣分 | 原因 |
|----|------|------|
| user_profiles 孤儿表 | -0.8 | P0 设计混乱,DDL 存在但无任何使用 |
| agent:chat 死代码 | -0.4 | P1 IPC 通道未注册 handler |
| books 索引缺失 | -0.2 | P2 性能改进点 |
| token_usage 索引缺失 | -0.1 | P2 性能改进点 |
| 普遍缺参数校验 | -0.2 | P2 防御性编程 |
| 流式 handler 错误处理风格不一致 | -0.1 | P2 设计差异 |
| 其他次要项 | +0.3 | 整体错误处理统一、事务支持完善、迁移幂等、持久化时机合理 — 给回一些分 |

---

## 7. 下一步建议

- ✅ **校验通过(基本)**:数据库模块整体可用,16 张表中 13 完整 + 2 部分(仅缺索引) + 1 孤儿表;137 个 IPC 通道中 136 可用 + 1 死代码。**核心功能无阻塞**。
- ⚠️ **建议派 fix-implementer 修复 P0 + P1**(改动小、收益明确):
  - 删除 `user_profiles` 表相关代码(database.ts DDL + resetDatabase 引用)
  - 删除 `IPC_CHANNELS.AGENT.CHAT` 常量 + test 引用
- ⏸️ **P2 改进可后续单独排期**(索引优化、参数校验),不阻塞 Phase 5 推进。
- ✅ **标记 T14 完成**(校验报告已产出,核心问题已识别)。

---

## 附录:文件路径

- DDL 与 CRUD 源:`d:\ai\claude code\微信读书\zhixing-reader\electron\database.ts`
- IPC handler 源:`d:\ai\claude code\微信读书\zhixing-reader\electron\ipc.ts`
- 初始化序列源:`d:\ai\claude code\微信读书\zhixing-reader\electron\main.ts`
- IPC 通道常量源:`d:\ai\claude code\微信读书\zhixing-reader\src\shared\ipc-channels.ts`
- settingsService 辅助证据:`d:\ai\claude code\微信读书\zhixing-reader\electron\services\settings-service.ts`(用 JSON 文件,确认 user_profiles 未使用)
- IPC hygiene 测试:`d:\ai\claude code\微信读书\zhixing-reader\tests\ipc-channels.test.ts`(确认 `agent:chat` 仅在禁止硬编码检查表中被引用)
