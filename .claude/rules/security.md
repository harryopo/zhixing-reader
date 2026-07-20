# Security Rules — 知行读书

> **适用**：所有 Electron 主进程 / 渲染进程 / 数据库 / 网络代码
> **强制级别**：pre-commit secret scan + AI 审查 + 人工 review

---

## 1. 五条不可商量规则（继承自 ai-dev-workflow R1-R5）

### 🔴 R1 — 禁止硬编码密钥

```typescript
// ❌ 绝对禁止
const API_KEY = 'sk-abc123xyz...';
const TOKEN = process.env.HARDCODED;

// ✅ 全部走 settings-service + safeStorage
import { getSecureKey, setSecureKey } from './services/settings-service';
const apiKey = await getSecureKey('weread_api_key');
```

**检测**：
- `trufflehog filesystem .` 在 pre-commit + CI 跑
- AI 审查 grep 任何字符串字面量
- 人工 review PR 时 check

**项目已有**：`electron/services/settings-service.ts` 单例模式 + `safeStorage.encryptString`

---

### 🔴 R2 — 用户输入必须验证

```typescript
// ✅ IPC handler 入口校验（已部分缺失，待 P0-4 修复时统一加 zod）
import { z } from 'zod';

const ReviewInputSchema = z.object({
  cardId: z.string().uuid(),
  rating: z.number().int().min(1).max(4),
});

ipcMain.handle(IPC_CHANNELS.REVIEW.SUBMIT, async (_, input) => {
  const parsed = ReviewInputSchema.parse(input);  // 抛 ZodError
  return reviewService.submit(parsed);
});

// ✅ Renderer 端用 react-hook-form + zod（统一入口）
const { register, handleSubmit } = useForm<SettingsForm>({
  resolver: zodResolver(SettingsSchema),
});

// ✅ API Key 输入必须 ASCII 校验（参见 ERR-20260529-004）
const ASCII_REGEX = /^[\x20-\x7E]+$/;
if (!ASCII_REGEX.test(apiKey)) {
  toast.error('API Key 只能包含 ASCII 字符');
  return;
}

// ✅ 文件路径校验（防路径穿越）
import path from 'node:path';
const safePath = path.resolve(USER_DATA_DIR, userInput);
if (!safePath.startsWith(USER_DATA_DIR)) {
  throw new Error('Invalid path');
}
```

**未通过校验必须**：抛 Error → 触发 toast → 不继续

---

### 🔴 R3 — API 响应不泄露 stack

```typescript
// ❌ 错误：直接返回 Error 对象到 Renderer
catch (error) {
  return { success: false, error };  // error.stack 暴露内部文件路径
}

// ✅ 分类错误，剥离敏感信息
import { HttpNetworkError, HttpAbortError } from './http-client';

catch (error) {
  if (error instanceof HttpAbortError) {
    return { success: false, code: 'cancelled', message: '请求已取消' };
  }
  if (error instanceof HttpNetworkError) {
    return { success: false, code: 'network', message: '网络错误' };
  }
  // 兜底：脱敏
  logger.error('unexpected', error);  // 主进程内部记录完整
  return { success: false, code: 'unknown', message: '操作失败' };
}

// ✅ 主进程 console.error 只在开发模式打印 stack
if (process.env.NODE_ENV === 'development') {
  console.error('[dev-only]', error);
}
logger.error({ code: error.code, msg: error.message }, 'operation failed');
```

**禁止**：
- 把 `error.stack` 序列化进 IPC 响应
- 把 `process.env` 完整对象返回
- 把数据库表结构 / SQL 语句返回

---

### 🔴 R4 — DB 操作必须参数化

```typescript
// ❌ 字符串拼接
db.exec(`SELECT * FROM ${tableName} WHERE id = ${id}`);  // SQL 注入！

// ✅ sql.js 全部用 prepare + bind
const stmt = db.prepare('SELECT * FROM books WHERE id = ?');
const row = stmt.get([id]);  // 参数化
stmt.run([id, title]);       // 参数化

// ✅ IN 子句
const placeholders = ids.map(() => '?').join(',');
const stmt = db.prepare(`SELECT * FROM books WHERE id IN (${placeholders})`);
const rows = stmt.all(ids);
```

**项目已有**：`electron/database.ts` 全量参数化（已验证）

---

### 🔴 R5 — 敏感操作审计日志

```typescript
// TODO（比赛后补）：当前未实现，本规则作为设计意图保留
// 现状：操作日志只在主进程 console 输出
// 应有：结构化审计日志（SQLite audit_log 表）

// 哪些操作需要审计
const AUDIT_OPERATIONS = [
  'book.delete',          // 删除书籍
  'settings.update',      // 修改设置
  'auth.connect',         // 连接微信读书
  'auth.disconnect',      // 断开
  'data.sync',            // 同步数据
  'ai.apiKey.set',        // 修改 API Key
  'data.export',          // 导出数据
];

// 实现位置：electron/utils/audit.ts（待建）
// export function audit(operation: string, meta: Record<string, unknown>) {
//   db.prepare('INSERT INTO audit_log (...) VALUES (...)').run(...);
//   logger.info({ audit: operation, ...meta }, 'audit');
// }
```

**比赛期间**：操作日志写到主进程文件日志（`app.getPath('logs')`），赛后迁移到 audit_log 表。

---

## 2. IPC 安全（Electron 专属）

```typescript
// ✅ contextIsolation + sandbox 配置（已在 main.ts）
webPreferences: {
  contextIsolation: true,    // 默认 true
  nodeIntegration: false,   // 禁止 Renderer 直接 require
  sandbox: false,            // 允许 preload 用 Node API（dev）
}

// ✅ preload 用 contextBridge 暴露
import { contextBridge, ipcRenderer } from 'electron';
contextBridge.exposeInMainWorld('electronAPI', {
  books: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.BOOK.LIST),  // 返回 Promise<T>
  },
});

// ✅ Renderer 只能通过 window.electronAPI 访问
const books = await window.electronAPI.books.list();  // 已解包

// ❌ 禁止在 preload 写业务逻辑
contextBridge.exposeInMainWorld('electronAPI', {
  // ❌ 业务逻辑应在 main 进程
  processBook: (book) => { /* ... */ return ...; },
});
```

**RULE-SEC-IPC-1**：每个 IPC 通道必须在 `shared/ipc-channels.ts` 注册常量
**RULE-SEC-IPC-2**：每个 IPC handler 必须返回 `{ success, data }` 或抛 Error
**RULE-SEC-IPC-3**：每个 Renderer 端 `window.electronAPI.*` 必须在 `preload.ts` 暴露

---

## 3. 数据库安全

```typescript
// ✅ 参数化查询（已在 database.ts 全面使用）
// ✅ 敏感字段加密（API Key 走 safeStorage）
// ✅ 路径限制（userDataDir 白名单）

// ❌ 禁止
// 1. 字符串拼接 SQL
// 2. 拼接文件路径
// 3. 存储明文 API Key
// 4. 用 DELETE 忘记 WHERE
db.exec('DELETE FROM books');  // 删库！

// ✅ 必须有 WHERE + LIMIT
const stmt = db.prepare('DELETE FROM books WHERE id = ? AND user_id = ?');
const result = stmt.run([id, userId]);
if (result.changes === 0) logger.warn('no row deleted', { id, userId });
```

---

## 4. 网络安全

```typescript
// ✅ 外部 API 必走带超时的 fetch
import { fetchWithTimeout } from './http-client';  // 已有
const response = await fetchWithTimeout(url, {
  timeout: 30_000,  // 30s
  signal: abortController.signal,  // 可取消
});

// ✅ HTTPS only
if (!url.startsWith('https://')) {
  throw new Error('Only HTTPS allowed');
}

// ❌ 禁止
// 1. http:// 协议
// 2. eval() / Function() 动态执行
// 3. innerHTML 拼接用户输入（XSS）
// 4. localStorage 存 API Key（应走 safeStorage）
```

---

## 5. 渲染层安全（XSS）

```typescript
// ✅ React 自动转义
<div>{userContent}</div>  // ✅ React 转义

// ❌ 禁止 dangerouslySetInnerHTML 直接用用户输入
<div dangerouslySetInnerHTML={{ __html: userInput }} />  // ❌

// ✅ 如果必须用（高亮内容/笔记渲染），用 react-markdown + DOMPurify
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
<ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>

// ❌ 禁止
// 1. eval
// 2. new Function
// 3. setTimeout/setInterval 字符串形式
// 4. document.write
```

---

## 6. 依赖安全

```bash
# pre-commit 跑 secret scan
npx trufflehog filesystem .

# CI 跑依赖审计
npm audit --audit-level=high

# 锁定版本（package-lock.json 必须提交）
git add package-lock.json
```

**禁止**：
- 引入不再维护的包（> 1 年无更新 + 安全公告）
- 引入 native module（需 node-gyp 编译）
- 引入 vendored 二进制（应通过 npm）

---

## 7. 错误信息分类（防信息泄露）

```typescript
// electron/http-client.ts 已有
export class HttpAbortError extends Error {
  constructor(public cause: 'timeout' | 'cancelled' | 'unknown') {
    super(`Request ${cause}`);
  }
}

export class HttpNetworkError extends Error {
  constructor(message: string) {
    super(message);
  }
}

// 使用：toast 文案按分类
const ERROR_MESSAGES = {
  cancelled: '操作已取消',
  timeout: '请求超时，请检查网络',
  network: '网络错误',
  empty: '没有数据',
  import: '导入失败',
  parse: '数据格式错误',
  config: '请先配置 API Key',
  unknown: '操作失败，请稍后重试',
};
```

---

## 8. 提交前自检

```bash
□ trufflehog filesystem .  # 0 命中
□ npm audit                # 0 high/critical
□ 检查新代码：硬编码字符串？API Key？
□ 检查新代码：string concat SQL？eval？
□ 检查新代码：innerHTML + 用户输入？
□ 检查新代码：fs path 未白名单？
```

---

*最后更新：2026-07-20 | 由 ai-dev-workflow skill 自动生成*
