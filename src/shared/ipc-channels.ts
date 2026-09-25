export const IPC_CHANNELS = {
  BOOKS: {
    GET_ALL: 'books:getAll',
    GET_BY_ID: 'books:getById',
    CREATE: 'books:create',
    UPDATE: 'books:update',
    DELETE: 'books:delete',
    SEARCH: 'books:search',
  },
  HIGHLIGHTS: {
    GET_BY_BOOK: 'highlights:getByBook',
    GET_BY_ID: 'highlights:getById',
    CREATE: 'highlights:create',
    UPDATE: 'highlights:update',
    // 注：划线 / 复习卡片 / 知识卡片 / 方法论 / 生词的 DELETE 通道已一并移除，
    // 删除只走 SYSTEM.ARCHIVE_DELETE 那一条路 —— 它会先把被删的行（划线含它的
    // 复习卡片与复习记录）留一份现场，界面才给得出「撤销」。别再单独加回物理删除。
    GET_ALL: 'highlights:getAll',
    SEARCH: 'highlights:search',
    EXPORT: 'highlights:export',
    /** 一次性补全历史划线的章节名（2026-09-16：实测 934 条全空） */
    BACKFILL_CHAPTER_TITLES: 'highlights:backfillChapterTitles',
  },
  CARDS: {
    GET_BY_ID: 'cards:getById',
    CREATE: 'cards:create',
    CREATE_FOR_EXISTING: 'cards:createForExisting',
    UPDATE: 'cards:update',
    // 注：原 UPDATE_APPLICATION_TAG / UPDATE_MASTERY_LEVEL 已于 2026-09-15 移除。
    // 两者在 renderer 中零引用（不可达），且 cards.mastery_level 与"由 FSRS 状态推导的
    // 掌握度"语义重复 —— 掌握度现在统一由 src/shared/fsrs-metrics.ts 计算，不再手写。
    GET_DUE: 'cards:getDue',
    GET_DUE_WITH_CONTENT: 'cards:getDueWithContent',
    GET_BY_BOOK: 'cards:getByBook',
    GET_STATS: 'cards:getStats',
    /** 今日队列构成：复习卡 / 新卡额度，避免界面把 900+ 张划线显示成"你欠的复习" */
    GET_QUEUE_STATS: 'cards:getQueueStats',
    /** 把知识卡片 / 方法论放进复习队列（已入队的原样返回，不新建第二张） */
    ENROLL: 'cards:enroll',
    /** 移出队列：只删这张复习卡，来源本身（卡片/方法论）留着 */
    UNENROLL: 'cards:unenroll',
    /** 某一类来源里已经入队的那些 id，界面据此标「已在复习队列」 */
    ENROLLED_SOURCES: 'cards:enrolledSources',
  },
  REVIEWS: {
    CREATE: 'reviews:create',
    GET_RECENT: 'reviews:getRecent',
  },
  SUMMARIES: {
    GET_BY_BOOK: 'summaries:getByBook',
    CREATE: 'summaries:create',
    DELETE: 'summaries:delete',
    /** 层级摘要 L1 列表（一章一条，含基于多少条划线） */
    GET_CHAPTERS: 'summaries:getChapters',
    /** 生成/增量补齐层级摘要（L1 章节 + L2 全书），烧 AI，前端要防连点 */
    GENERATE: 'summaries:generate',
    /** 哪些书的章节摘要欠更新（纯本地计算，不花 AI 钱） */
    FRESHNESS: 'summaries:freshness',
  },
  DAILY_STATS: {
    GET_TODAY: 'dailyStats:getToday',
    GET_RANGE: 'dailyStats:getRange',
    INCREMENT_BOOKS: 'dailyStats:incrementBooks',
    INCREMENT_HIGHLIGHTS: 'dailyStats:incrementHighlights',
    INCREMENT_CARDS: 'dailyStats:incrementCards',
    // 注：原 ADD_READING_TIME（累加阅读时长）已于 2026-09-16 移除。
    // 阅读时长的唯一真值来源是微信读书的阅读统计，由主进程在取阅读数据时
    // 用 upsertReadingTime 覆盖写入；累加语义会与它冲突，且该通道从未被调用过。
  },
  WEREAD: {
    GET_BOOKSHELF: 'weread:getBookshelf',
    FETCH_ALL_CONTENT: 'weread:fetchAllContent',
    FETCH_ALL_CONTENT_BATCH: 'weread:fetchAllContentBatch',
    FETCH_RECOMMENDATIONS: 'weread:fetchRecommendations',
    GET_USER_PROFILE: 'weread:getUserProfile',
    // 单本阅读进度（/shelf/sync 不返回，需按 bookId 单独查询）
    GET_BOOK_PROGRESS: 'weread:getBookProgress',
    TEST: 'weread:test',
    // 主→渲染事件：后台自动同步结果（成功/失败），渲染层据此提示或更新状态
    AUTO_SYNC_STATUS: 'weread:autoSyncStatus',
  },
  READING_DATA: {
    FETCH: 'readingData:fetch',
  },
  AI: {
    SET_CONFIG: 'ai:setConfig',
    TEST: 'ai:test',
  },
  CONVERSATIONS: {
    CREATE: 'conversations:create',
    GET_ALL: 'conversations:getAll',
    GET_BY_ID: 'conversations:getById',
    UPDATE: 'conversations:update',
    DELETE: 'conversations:delete',
    ADD_MESSAGE: 'conversations:addMessage',
    DELETE_MESSAGE: 'conversations:deleteMessage',
    GET_MESSAGES: 'conversations:getMessages',
    SEARCH: 'conversations:search',
    GET_BOOKMARKED: 'conversations:getBookmarked',
  },
  CHAT: {
    TOGGLE_LIKE: 'chat:toggleLike',
    TOGGLE_BOOKMARK: 'chat:toggleBookmark',
  },
  AGENT: {
    STREAM_CHAT_WITH_CONTEXT: 'agent:streamChatWithContext',
    CANCEL_STREAM: 'agent:cancelStream',
    GET_PIPELINE_INFO: 'agent:getPipelineInfo',
    // 主→渲染事件：agent 调取知识库过程（start 开始 / done 各路检索结果），用于对话页可视化
    RETRIEVAL_STATUS: 'agent:retrievalStatus',
  },
  // 流式事件 channel（主进程 -> 渲染进程，由主进程 send 触发）
  STREAM: {
    CHUNK: 'ai:streamChunk',
    REASONING_CHUNK: 'ai:streamReasoningChunk',
    COMPLETE: 'ai:streamComplete',
    ERROR: 'ai:streamError',
  },
  ADMIN: {
    GET_STATS: 'admin:getStats',
    GET_AGENT_CONFIG: 'admin:getAgentConfig',
    GET_BOOKS_WITH_COUNTS: 'admin:getBooksWithCounts',
    GET_HIGHLIGHTS_BY_BOOK: 'admin:getHighlightsByBook',
    GET_CARDS_BY_BOOK: 'admin:getCardsByBook',
    GET_SESSIONS: 'admin:getSessions',
    GET_SESSION_MESSAGES: 'admin:getSessionMessages',
    GET_PROMPTS: 'admin:getPrompts',
    SAVE_PROMPT: 'admin:savePrompt',
    RESET_PROMPT: 'admin:resetPrompt',
    RESET_ALL_PROMPTS: 'admin:resetAllPrompts',
    EXPORT_PROMPTS: 'admin:exportPrompts',
    IMPORT_PROMPTS: 'admin:importPrompts',
    GET_DATABASE_SCHEMA: 'admin:getDatabaseSchema',
    GET_TABLE_DATA: 'admin:getTableData',
    CREATE_CUSTOM_PROMPT: 'admin:createCustomPrompt',
    UPDATE_CUSTOM_PROMPT: 'admin:updateCustomPrompt',
    DELETE_CUSTOM_PROMPT: 'admin:deleteCustomPrompt',
    GET_CUSTOM_PROMPTS: 'admin:getCustomPrompts',
  },
  SETTINGS: {
    GET: 'settings:get',
    SET: 'settings:set',
    GET_ALL: 'settings:getAll',
  },
  TOKEN_USAGE: {
    GET_RECENT: 'tokenUsage:getRecent',
    GET_BY_DATE_RANGE: 'tokenUsage:getByDateRange',
    GET_STATS_BY_PROVIDER: 'tokenUsage:getStatsByProvider',
    GET_STATS_BY_FEATURE: 'tokenUsage:getStatsByFeature',
    GET_DAILY_STATS: 'tokenUsage:getDailyStats',
    GET_TOTAL_STATS: 'tokenUsage:getTotalStats',
    CLEAR_ALL: 'tokenUsage:clearAll',
  },
  METHODOLOGIES: {
    GET_ALL: 'methodologies:getAll',
    GET_BY_ID: 'methodologies:getById',
    GET_BY_BOOK: 'methodologies:getByBook',
    CREATE: 'methodologies:create',
    UPDATE: 'methodologies:update',
    SEARCH: 'methodologies:search',
    EXTRACT: 'methodologies:extract',
    /** 每本书的方法论生成进度（已处理 / 共多少条划线），列表页一次取全 */
    COVERAGE: 'methodologies:coverage',
  },
  KNOWLEDGE_CARDS: {
    GET_ALL: 'knowledgeCards:getAll',
    GET_BY_ID: 'knowledgeCards:getById',
    GET_BY_BOOK: 'knowledgeCards:getByBook',
    CREATE: 'knowledgeCards:create',
    UPDATE: 'knowledgeCards:update',
    SEARCH: 'knowledgeCards:search',
    DISTILL: 'knowledgeCards:distill',
    CANCEL_DISTILL: 'knowledgeCards:cancelDistill',
    // 知识卡片蒸馏进度事件（主进程 -> 渲染进程）
    DISTILL_PROGRESS: 'knowledgeCard:distillProgress',
    GENERATE_INTERPRETATION: 'knowledgeCards:generateInterpretation',
    GENERATE_APPLICATION: 'knowledgeCards:generateApplication',
    /** 一次性找回历史卡片的来源划线（2026-09-16：实测 90 张来源全空） */
    BACKFILL_SOURCE: 'knowledgeCards:backfillSource',
    /** 每本书的知识卡片生成进度（已处理 / 共多少条划线），列表页一次取全 */
    COVERAGE: 'knowledgeCards:coverage',
  },
  ARTICLES: {
    GET_ALL: 'articles:getAll',
    GET_BY_ID: 'articles:getById',
    CREATE: 'articles:create',
    MARK_AS_READ: 'articles:markAsRead',
    TOGGLE_FAVORITE: 'articles:toggleFavorite',
    DELETE: 'articles:delete',
    GET_STATS: 'articles:getStats',
    FETCH_RSS: 'articles:fetchRss',
    TRANSLATE: 'articles:translate',
  },
  VOCABULARY: {
    GET_ALL: 'vocabulary:getAll',
    GET_BY_ID: 'vocabulary:getById',
    GET_UNMASTERED: 'vocabulary:getUnmastered',
    GET_DUE_FOR_REVIEW: 'vocabulary:getDueForReview',
    CREATE: 'vocabulary:create',
    CREATE_FROM_LOOKUP: 'vocabulary:createFromLookup',
    MARK_AS_MASTERED: 'vocabulary:markAsMastered',
    /** 加入复习队列：只排队，不提交评分（与 updateReviewData 的区别见 DB 层注释） */
    SCHEDULE_FOR_REVIEW: 'vocabulary:scheduleForReview',
    UPDATE_REVIEW_DATA: 'vocabulary:updateReviewData',
    GET_STATS: 'vocabulary:getStats',
    SEARCH: 'vocabulary:search',
    EXPORT: 'vocabulary:export',
  },
  DICTIONARY: {
    LOOKUP: 'dictionary:lookup',
    LOOKUP_BATCH: 'dictionary:lookupBatch',
  },
  SYSTEM: {
    FORCE_SAVE_DATABASE: 'system:forceSaveDatabase',
    CLEAR_CACHE: 'system:clearCache',
    OPEN_EXTERNAL: 'system:openExternal',
    CLEAR_HISTORY: 'system:clearHistory',
    // 真实存储用量（数据库文件 / 向量索引 / 日志）：设置页原来显示的是写死的假数字
    GET_STORAGE_USAGE: 'system:getStorageUsage',
    RESET_DATABASE: 'system:resetDatabase',
    /** 留一份现场再删：返回撤销 token（null = 那行本来就不在，什么都没删） */
    ARCHIVE_DELETE: 'system:archiveDelete',
    /** 按 token 把上一次删除的行原样插回去（现场只在内存，应用重启即失效） */
    RESTORE_DELETE: 'system:restoreDelete',
    /** 备份：按 src/shared/backup.ts 那一份表清单整表取全（含 AI 生成物与生成台账） */
    EXPORT_BACKUP: 'system:exportBackup',
    /** 恢复：清空后按同一份清单换回，整个动作在一个事务里，半套不落库 */
    IMPORT_BACKUP: 'system:importBackup',
    // 主→渲染事件：数据库落盘失败（磁盘满/权限/被占用），渲染层据此提示用户，避免静默丢数据
    PERSIST_ERROR: 'system:persistError',
  },
  UPDATE: {
    /** 手动检查更新（渲染 → 主进程） */
    CHECK: 'update:check',
    /** 开始下载已发现的更新 */
    DOWNLOAD: 'update:download',
    /** 退出并安装已下载的更新 */
    INSTALL: 'update:install',
    /** 主→渲染事件：更新状态机变化（checking/available/progress/downloaded/not-available/error） */
    STATUS: 'update:status',
    /** 回读最后一次更新状态：STATUS 是单向推送，页面挂载晚于启动检查时需要补一次 */
    GET_STATUS: 'update:getStatus',
  },
  FSRS: {
    SET_PARAMETERS: 'fsrs:setParameters',
    RESET_PARAMETERS: 'fsrs:resetParameters',
    GET_PARAMETERS: 'fsrs:getParameters',
    PREVIEW_REVIEW_RATINGS: 'fsrs:previewReviewRatings',
  },
  SKILL: {
    GENERATE: 'skill:generate',
    // 生成 + 弹保存对话框写盘（方法论详情页「导出为 Skill」）
    EXPORT_FILE: 'skill:exportFile',
  },
  // 主进程菜单事件（主进程 -> 渲染进程，由 Menu 点击触发）
  MENU: {
    NAVIGATE: 'menu:navigate',
    ABOUT: 'menu:about',
    SYNC_BOOKSHELF: 'menu:syncBookshelf',
  },
} as const;
