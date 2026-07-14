# Errors

知行读书项目开发过程中的错误记录。

---

## [ERR-20260529-001] ipc-format

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
Cannot read properties of undefined (reading 'ai')

### Error
```
TypeError: Cannot read properties of undefined (reading 'ai')
```

### Context
- 操作：点击测试连接按钮
- 原因：preload 脚本未正确加载，window.electronAPI 未定义
- 根本原因：preload 路径配置错误 + sandbox 限制

### Suggested Fix
1. 添加 `getPreloadPath()` 函数动态查找 preload 路径
2. 设置 `sandbox: false` 允许 preload 访问 Node.js API

### Metadata
- Reproducible: yes
- Related Files: electron/main.ts
- Resolution: 已修复

---

## [ERR-20260529-002] ipc-import

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
Cannot read properties of undefined (reading 'settings')

### Error
```
TypeError: Cannot read properties of undefined (reading 'settings')
```

### Context
- 操作：加载设置页面
- 原因：preload.ts 导入了 ipc.ts（主进程模块），导致 preload 构建失败
- 根本原因：IPC_CHANNELS 定义在 ipc.ts 中，preload 无法导入

### Suggested Fix
创建 `src/shared/ipc-channels.ts` 共享文件，preload 和 ipc 都从该文件导入。

### Metadata
- Reproducible: yes
- Related Files: src/shared/ipc-channels.ts, electron/preload.ts, electron/ipc.ts
- Resolution: 已修复

---

## [ERR-20260529-003] api-format

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
API错误: undefined

### Error
```
API错误: undefined
```

### Context
- 操作：测试微信读书连接
- 原因：`data.errcode !== 0` 判断逻辑错误
- 根本原因：API 响应可能不包含 errcode 字段，`undefined !== 0` 为 true

### Suggested Fix
改为 `data.errcode !== undefined && data.errcode !== 0`

### Metadata
- Reproducible: yes
- Related Files: electron/weread-api.ts
- Resolution: 已修复

---

## [ERR-20260529-004] byte-string

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: backend

### Summary
Cannot convert argument to a ByteString

### Error
```
TypeError: Cannot convert argument to a ByteString because the character at index 7 has a value of 35831 which is greater than 255.
```

### Context
- 操作：测试连接
- 原因：API Key 输入了中文字符
- 根本原因：HTTP 请求头只支持 ASCII 字符

### Suggested Fix
添加输入验证：`/^[\x20-\x7E]+$/.test(apiKey)`

### Metadata
- Reproducible: yes
- Related Files: src/renderer/src/pages/Settings.tsx
- Resolution: 已修复

---

## [ERR-20260529-005] settings-persistence

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
同步失败: 请先设置微信读书 API Key

### Error
```
同步失败: 请先设置微信读书 API Key
```

### Context
- 操作：同步书架
- 原因：保存配置后，重启应用配置未加载到内存
- 根本原因：main.ts 启动时没有调用 initFromSettings()

### Suggested Fix
在 main.ts 的 app.whenReady() 中加载配置并初始化。

### Metadata
- Reproducible: yes
- Related Files: electron/main.ts
- Resolution: 已修复

---

## [ERR-20260614-001] rss-not-persisted

**Logged**: 2026-06-14T20:30:00+08:00
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
RSS 抓取的文章未存入数据库，刷新后丢失

### Error
```
页面刷新后文章列表为空
```

### Context
- 操作：每日学习模块加载文章
- 原因：ipc.ts 的 ARTICLES.FETCH_RSS handler 只返回 fetchAllRssSources() 结果，未调用 articlesDb.create()
- 根本原因：缺少持久化逻辑

### Suggested Fix
遍历抓取的文章，检查数据库存在性后存入，并异步触发翻译。

### Metadata
- Reproducible: yes
- Related Files: electron/ipc.ts, electron/database.ts
- Resolution: 已修复，添加了文章去重和持久化逻辑

---

## [ERR-20260614-002] require-esm-conflict

**Logged**: 2026-06-14T20:30:00+08:00
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
require() of ES Module 错误

### Error
```
Error [ERR_REQUIRE_ESM]: require() of ES Module d:\ai\claude code\微信读书\zhixing-reader\electron\fsrs-engine.js is not supported.
```

### Context
- 操作：构建或运行应用
- 原因：database.ts 使用 require() 动态导入 fsrs-engine.ts，而 fsrs-engine 是 ESM 模块
- 根本原因：electron-vite 构建环境不支持 require() 导入 ESM

### Suggested Fix
将 require() 改为静态 import 语句。

### Metadata
- Reproducible: yes
- Related Files: electron/database.ts, electron/fsrs-engine.ts
- Resolution: 已修复，改用 import 语句

---

## [ERR-20260614-003] getDatabase-not-defined

**Logged**: 2026-06-14T20:30:00+08:00
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
getDatabase is not defined

### Error
```
ReferenceError: getDatabase is not defined
```

### Context
- 操作：在 ipc.ts 中调用 getDatabase() 保存翻译结果
- 原因：ipc.ts 没有从 database.ts 导入 getDatabase 和 forceSaveDatabase
- 根本原因：添加数据库操作代码时遗漏了导入

### Suggested Fix
在 ipc.ts 顶部添加：
```typescript
import { getDatabase, forceSaveDatabase } from './database';
```

### Metadata
- Reproducible: yes
- Related Files: electron/ipc.ts, electron/database.ts
- Resolution: 已修复，添加了必要的导入

---
