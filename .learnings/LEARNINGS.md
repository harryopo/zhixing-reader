# Learnings

知行读书项目开发过程中的学习记录、错误和改进。

---

## [LRN-20260529-001] best_practice

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: config

### Summary
Electron 应用中 IPC 响应格式处理的最佳实践

### Details
在 Electron + electron-vite 项目中，preload.ts 的 `invoke` 函数已经自动解包了 IPC 响应：
- 主进程返回：`{ success: true, data: result }`
- preload 的 invoke 返回：`response.data`（已解包）
- 渲染进程直接使用返回值，无需再次解构

错误做法：`const response = await window.electronAPI.settings.getAll() as { success, data }`
正确做法：`const settings = await window.electronAPI.settings.getAll() as Record<string, unknown>`

### Suggested Action
在所有使用 `window.electronAPI.*` 的地方，直接使用返回值，不要当作 `{ success, data }` 格式处理。

### Metadata
- Source: conversation
- Related Files: src/renderer/src/stores/settingsStore.ts, electron/preload.ts
- Tags: electron, ipc, preload

---

## [LRN-20260529-002] knowledge_gap

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: config

### Summary
微信读书 Agent API Gateway 的正确端点和响应格式

### Details
微信读书 API 使用 Agent API Gateway 模式：
- 端点：`https://i.weread.qq.com/api/agent/gateway`
- 认证：`Authorization: Bearer {API_KEY}`
- 请求格式：`{ api_name: "/shelf/sync", skill_version: "1.0.5" }`

关键发现：
1. `/shelf/sync` 是正确的书架端点（不是 `/shelf/list`）
2. 响应可能不包含 `errcode` 字段，需要检查 `data.errcode !== undefined`
3. Python 参考实现只检查 HTTP 状态码，不检查 errcode

### Suggested Action
使用 Python 参考实现 (weread_client.py) 的端点和参数格式。

### Metadata
- Source: conversation
- Related Files: electron/weread-api.ts, src/weread_client.py
- Tags: weread, api, gateway

---

## [LRN-20260529-003] correction

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: config

### Summary
HTTP 499 错误的根本原因和解决方案

### Details
HTTP 499 是 Nginx 的"客户端断连"状态码，原因：
1. 请求超时（net.fetch 没有设置超时）
2. API 端点不正确导致服务器无响应

解决方案：
- 添加 `fetchWithTimeout` 函数，使用 AbortController 设置 30 秒超时
- 使用正确的 API 端点（参考 Python 实现）
- 添加 499 特定错误提示

### Suggested Action
所有外部 API 调用都应添加超时控制。

### Metadata
- Source: conversation
- Related Files: electron/weread-api.ts, electron/ai-service.ts
- Tags: http, timeout, error-handling

---

## [LRN-20260529-004] best_practice

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: config

### Summary
应用启动时的配置初始化流程

### Details
正确的配置初始化流程：
1. main.ts 启动时从 settings.json 加载配置
2. 调用 `initFromSettings()` 初始化 weread-api 和 ai-service 的内存变量
3. 渲染进程通过 IPC 加载配置到 Zustand store
4. 保存时同步更新文件和内存变量

### Suggested Action
遵循"启动时加载 → 内存缓存 → 修改时同步"的模式。

### Metadata
- Source: conversation
- Related Files: electron/main.ts, electron/weread-api.ts, electron/ai-service.ts
- Tags: initialization, settings, persistence

---

## [LRN-20260601-001] best_practice

**Logged**: 2026-06-01T22:20:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: backend

### Summary
创建统一的设置服务模块，实现单例模式和安全存储

### Details
为 Electron 主进程创建了 SettingsService 类，实现了单例模式、get/set/getAll 方法，并使用 safeStorage API 实现敏感信息加密存储。该模块提供了 getSecureKey() 和 setSecureKey() 方法，用于安全地存储 API 密钥等敏感信息。

### Suggested Action
在需要存储设置或敏感信息的场景中，使用此服务模块。

### Metadata
- Source: conversation
- Related Files: electron/services/settings-service.ts
- Tags: settings, singleton, encryption, safeStorage

---

## [LRN-20260614-001] best_practice

**Logged**: 2026-06-14T20:30:00+08:00
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
RSS 抓取文章必须持久化到数据库，不能仅返回内存数据

### Details
在 ipc.ts 的 ARTICLES.FETCH_RSS handler 中，最初只返回 fetchAllRssSources() 的结果，但没有将文章存入数据库。这导致：
1. 刷新页面后文章丢失
2. 无法进行文章筛选/分类
3. 翻译结果无处保存

正确做法：
1. 遍历抓取的文章，检查数据库是否已存在（标题去重）
2. 调用 articlesDb.create() 存入数据库
3. 异步触发翻译（不阻塞返回）
4. 翻译完成后更新数据库记录

### Suggested Action
所有数据获取操作都应考虑持久化需求，避免"只取不存"的反模式。

### Metadata
- Source: conversation
- Related Files: electron/ipc.ts, electron/database.ts
- Tags: rss, database, persistence

---

## [LRN-20260614-002] correction

**Logged**: 2026-06-14T20:30:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
再次确认 preload.ts 的 invoke() 已解包 IPC 响应，前端不应再次解包

### Details
在 DailyLearning.tsx 中发现多余的 unwrapData() 函数：
```typescript
// 错误做法
const unwrapData = (res: unknown) => (res as { success: boolean; data: unknown })?.data ?? res;
const articles = unwrapData(result);
```

这导致拿到 undefined，因为 preload 的 invoke() 已经返回了 response.data。

正确做法：
```typescript
const result = await window.electronAPI.articles.fetchRss();
const articles = Array.isArray(result) ? result : [];
```

### Suggested Action
在所有使用 window.electronAPI.* 的地方，直接使用返回值，用 Array.isArray() 或可选链做防御性编程。

### Metadata
- Source: conversation
- Related Files: src/renderer/src/pages/DailyLearning.tsx, electron/preload.ts
- Tags: electron, ipc, preload, unwrap

---

## [LRN-20260614-003] knowledge_gap

**Logged**: 2026-06-14T20:30:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: backend

### Summary
database.ts 中使用 require() 动态导入在 ESM 环境中会失败

### Details
在 electron/database.ts 中发现：
```typescript
const { Card, cardFromDb, cardToRow, createCard, reviewCard, reviewVocabulary, Rating, CardState } = require('./fsrs-engine');
```

这在 ESM 构建环境中会报错 "require() of ES Module"。

正确做法：使用静态 import 语句
```typescript
import { Card, cardFromDb, cardToRow, createCard, reviewCard, reviewVocabulary, Rating, CardState } from './fsrs-engine';
```

### Suggested Action
在 TypeScript 项目中，优先使用 import/export 而非 require()，特别是在 electron-vite 构建环境中。

### Metadata
- Source: conversation
- Related Files: electron/database.ts, electron/fsrs-engine.ts
- Tags: esm, require, import, module

---

## [LRN-20260614-004] best_practice

**Logged**: 2026-06-14T20:30:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: backend

### Summary
IPC handler 中使用数据库操作前必须导入 getDatabase

### Details
在 ipc.ts 中添加了 RSS 文章持久化逻辑后，调用 getDatabase() 时报错 "getDatabase is not defined"。

原因：虽然 database.ts 导出了 getDatabase，但 ipc.ts 没有导入。

修复：
```typescript
import { getDatabase, forceSaveDatabase } from './database';
```

### Suggested Action
在 IPC handler 中操作数据库时，确保导入必要的数据库工具函数。

### Metadata
- Source: conversation
- Related Files: electron/ipc.ts, electron/database.ts
- Tags: database, import, ipc

---