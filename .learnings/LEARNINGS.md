# Learnings

知行读书项目开发过程中的学习记录、错误和改进。

> **最近更新**：2026-07-20 夜 — 追加 LRN-20260720-011 功能契约审查与夜间修复

---

## [LRN-20260720-011] correction

**Logged**: 2026-07-20T22:25:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
AI 对话 / 统计 / 导入建卡等多处「功能看起来有、运行时断」来自契约漂移，不是算法本身坏了。

### Details
1. **chatStore** 用 `conversationId/question/context`，preload/ipc 要 `sessionId/userMessage/conversationHistory` → 主功能空转。
2. 流式 `onStreamError` 不 settle Promise → 发送流程挂死。
3. `highlight.create` 单条路径不建 FSRS 卡，只有 batch 建 → 导入后复习空。
4. Home/Bookshelf 用 `getDue()` 当「总卡片」；Profile 读不存在的 `totalCards/masteredCards` 与 camelCase daily_stats。
5. 生产 `file://` + BrowserRouter 风险；Review 写死间隔 + 把 rating 当 mastery。

### Suggested Action
- 改 API 时同步：ipc-channels / preload / renderer.d.ts / store 调用四处。
- 统计字段以 `database.ts` 返回值为 SSOT，前端不要猜字段名。
- 导入路径与 batch 路径行为对齐（建卡、daily_stats）。

### Metadata
- Source: conversation
- Related Files: chatStore.ts, preload.ts, ipc.ts, Home.tsx, profileStore.ts, Review.tsx
- Tags: ipc, contract, fsrs, stats
> **历史归档**：2026-05-29 ~ 2026-06-14 共 7 条原始教训（LRN-20260529-001 ~ LRN-20260614-004）
> **归档策略**：同类型问题出现 ≥3 次时升级到 `.learnings/STANDARDS.md` 硬规则

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

## [LRN-20260720-001] best_practice

**Logged**: 2026-07-20T18:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tooling

### Summary
ai-dev-workflow 6 阶段规范化已嵌入项目，新功能开发必须按此流程

### Details
2026-07-20 完成 ai-dev-workflow skill 在本项目的落地，确立 6 阶段流程：

1. **需求澄清**：输出 `docs/plans/YYYY-MM-DD-{feature}.md`，含功能/非功能/验收
2. **架构设计**：ADR + 目录树 + API Spec + DB Schema
3. **项目脚手架**：完整骨架 + AGENTS.md + CLAUDE.md
4. **编码实现**：代码 + 单测
5. **质量门禁**：lint + typecheck + test + build + audit 全绿
6. **知识沉淀**：更新 `.learnings/STANDARDS.md` 和 `.learnings/*.md`

每阶段有闸门（不做不前进）。已有项目从阶段三（结构检查）+ 阶段五（门禁检查）切入。

### Suggested Action
后续新功能开发（包括 bug 修复）必须按 6 阶段走；小修改可以简化为"阶段四+五"。

### Metadata
- Source: ai-dev-workflow skill
- Related Files: .learnings/STANDARDS.md, AGENTS.md, .claude/ownership.yaml
- Tags: workflow, ai-dev-workflow, standardization

---

## [LRN-20260720-002] best_practice

**Logged**: 2026-07-20T18:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tooling

### Summary
ESLint 规则分级策略：硬约束 vs 软约束

### Details
对 15 条硬性规则中的质量规则（R6-R10）采用分级策略：

**Error（硬约束，违反即阻塞）**：
- `complexity` ≤ 15（圈复杂度）
- `max-params` ≤ 6（函数参数）
- `prefer-const`
- `eqeqeq`（必须 `===`）

**Warn（软约束，长期优化）**：
- `max-lines` ≤ 500（单文件行数）
- `max-lines-per-function` ≤ 80（单函数行数）
- `max-depth` ≤ 4（嵌套深度）

**Grandfather（针对 legacy 文件豁免）**：
- `database.ts` 1967 行
- `ipc.ts` 657 行
- `weread-api.ts`
- `rag-service.ts`

只对 legacy 文件关闭 `complexity`（避免一刀切），其他规则继续生效。

### Suggested Action
新代码必须满足所有 error 规则；warn 规则可暂时不满足但要在 TODO 注释中标记。Legacy 文件不重新设计，比赛后拆分。

### Metadata
- Source: ai-dev-workflow 第 4-5 阶段
- Related Files: eslint.config.js
- Tags: eslint, quality-rules, grandfather

---

## [LRN-20260720-003] knowledge_gap

**Logged**: 2026-07-20T18:10:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tooling

### Summary
fix-unused-vars.mjs 自动化脚本的限制：不能处理解构类型定义

### Details
编写了 `scripts/fix-unused-vars.mjs` 自动修复 ESLint `no-unused-vars` 错误，方法是用 ESLint AST 把未使用变量加 `_` 前缀。

**问题**：对解构类型定义会破坏语法：
```typescript
// 原始
function Foo({ x, y }: { x: string; y: string }) {}

// 错误转换
function Foo({ x as _x, y }: { x: string; y: string }) {}  // 语法错误！
```

脚本无法识别 `{ x, y }: { x: string; y: string }` 中的 `x, y` 是类型字段名而不是变量名。

**已修复 27/33**，剩余 6 个解构类型需要手动用 `x: _x` 重命名。

### Suggested Action
不要尝试自动处理解构类型。脚本遇到解构类型应直接跳过并报告，由人工处理。

### Metadata
- Source: ai-dev-workflow 第 4 阶段
- Related Files: scripts/fix-unused-vars.mjs
- Tags: eslint, automation, ast, limitation

---

## [LRN-20260720-004] best_practice

**Logged**: 2026-07-20T18:15:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tooling

### Summary
Vitest 测试文件 import 路径：tests/ 引用 electron/ 用相对路径 `../`

### Details
测试文件位于 `tests/` 目录（如 `tests/fsrs-engine.test.ts`），引用 `electron/` 下的源文件时：

**错误**：
```typescript
import { createCard } from '../../electron/fsrs-engine'  // ❌ 解析失败
```

**正确**：
```typescript
import { createCard } from '../electron/fsrs-engine'  // ✅ Vite 正确解析
```

Vite 解析 import 路径时，相对路径基于当前测试文件位置向上找到 `electron/`，正确层级是 `../`（不是 `../../`）。

### Suggested Action
统一规范：`tests/*.test.ts` → `electron/*.ts` 用 `'../electron/xxx'`；`tests/integration/*.test.ts` → `electron/*.ts` 用 `'../../electron/xxx'`。

### Metadata
- Source: ai-dev-workflow 第 3 阶段
- Related Files: tests/fsrs-engine.test.ts
- Tags: vitest, import-path, vite, relative-path

---

## [LRN-20260720-005] correction

**Logged**: 2026-07-20T18:20:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tooling

### Summary
Edit 工具的怪癖：old_string 末尾字符 + new_string 末尾字符相同时可能产生重复字符

### Details
在使用 IDE/Agent 的 Edit 工具修改文件时，如果：
- `old_string` 末尾字符 = `(`、`{`、`[` 等
- `new_string` 末尾字符 = 相同字符

工具的字符串匹配可能产生重复字符：

```typescript
// 期望
function foo() {}

// 实际
function foo() {{}  // 多了一个 {
```

**修复策略**：
1. 修改后立即用 Read 工具验证
2. 把替换范围扩大到 1-2 行上下文
3. 确保 `old_string` 在文件中唯一
4. 确保 `old_string` 与 `new_string` 不重叠

### Suggested Action
每次 Edit 操作后必须 Read 验证；不要相信"已替换成功"。

### Metadata
- Source: ai-dev-workflow 第 4 阶段
- Related Files: N/A
- Tags: edit-tool, string-replace, verification

---

## [LRN-20260720-006] knowledge_gap

**Logged**: 2026-07-20T18:25:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tooling

### Summary
@typescript-eslint/no-unnecessary-condition 规则需要 type-aware linting

### Details
启用 `@typescript-eslint/no-unnecessary-condition` 这类需要类型信息的规则时，ESLint 抛：

```
The rule "@typescript-eslint/no-unnecessary-condition" requires type information.
```

**原因**：规则需要 TypeScript 类型推断，必须启用 type-aware linting。

**修复**：在 `eslint.config.js` 添加：
```javascript
parserOptions: {
  project: './tsconfig.json',
  tsconfigRootDir: import.meta.dirname,
}
```

**权衡**：启用 type-aware linting 会让 lint 速度慢 5-10 倍（需运行 TS 编译器）。

**当前决策**：默认**不启用**这条规则以保持 lint 速度。如果后续需要严格度可考虑加 `@typescript-eslint/strict` 预设。

### Suggested Action
需要 type-aware 规则时评估性能成本；本项目暂时不启用以保证开发体验。

### Metadata
- Source: ai-dev-workflow 第 4 阶段
- Related Files: eslint.config.js
- Tags: eslint, typescript, type-aware, performance

---

## [LRN-20260720-007] correction

**Logged**: 2026-07-20T18:30:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tooling

### Summary
PowerShell 管道中 ESLint 退出码 2 不一定是错误

### Details
在 PowerShell 中跑：
```powershell
npx eslint src electron | Tee-Object | Select-Object
```

PowerShell 把 ESLint 的 stderr warning（输出到 stderr 的 lint 警告）通过管道传递给 `Select-Object` 时，会把退出码 2 当作"命令失败"。

**正确做法**：直接跑 ESLint 看真实退出码：
```powershell
npx eslint src electron; "EXIT:$LASTEXITCODE"
```

如果只是看 warning（不阻塞 commit），用 `|| true` 在 bash 没问题，但 PowerShell 必须用 `; "EXIT:$LASTEXITCODE"` 显式查看。

### Suggested Action
PowerShell 中评估命令是否成功，看 `$LASTEXITCODE` 而不是依赖管道行为。

### Metadata
- Source: ai-dev-workflow 第 5 阶段
- Related Files: scripts/fix-unused-vars.mjs
- Tags: powershell, eslint, exit-code, pipe

---

## [LRN-20260720-008] best_practice

**Logged**: 2026-07-20T18:35:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary
CodeGraph 知识图谱 auto-sync：文件改动 2s 防抖后增量更新

### Details
为项目建了 CodeGraph 知识图谱（100 文件 / 1,451 节点 / 4,645 边，建图 1.3s）。

**配置**：
- 默认 auto-sync 开启
- 文件改动 2s 防抖后触发增量更新
- `.codegraph/` 已加入 `.gitignore`（不提交生成的索引）

**使用**：
- `codegraph_search` / `codegraph_context` / `codegraph_trace` / `codegraph_callers` / `codegraph_callees` / `codegraph_impact` / `codegraph_node` / `codegraph_explore` / `codegraph_files` / `codegraph_status`
- SubAgent 启动时首选 `codegraph_context` 构建入口点+相关符号上下文

**好处**：
- 新增/修改文件后无需手动跑 sync
- 索引始终保持新鲜
- SubAgent 启动时能快速拿到代码上下文

### Suggested Action
日常开发无需再跑 sync；需要快速探索代码结构时直接用 CodeGraph 工具。

### Metadata
- Source: ai-dev-workflow 第 1 阶段（需求调研）
- Related Files: .codegraph/
- Tags: codegraph, knowledge-graph, auto-sync, subagent

---

## [LRN-20260720-009] correction

**Logged**: 2026-07-20T22:10:00+08:00
**Priority**: high
**Status**: resolved
**Area**: backend
**Project**: zhixing-reader

### Summary
ts-fsrs 没有 Mastered 状态，STATE_DISTRIBUTION 数组的 state=4 会被 ts-fsrs 真实算法覆盖

### Details
`scripts/seed-demo-data.ts` 中演示数据生成脚本设计了 `STATE_DISTRIBUTION` 数组，希望把 45 张卡片设置为 Mastered（state=4）。但调用 `simulateMatureCard()` 模拟 6 次连续 Good 后，`card.state` 仍返回 `FsrsState.Review=2`（ts-fsrs 库没有 Mastered 状态，最稳定的卡也是 Review=2）。

**症状**：
```sql
SELECT state, COUNT(*) FROM cards GROUP BY state;
-- state=0: 3 (New)
-- state=1: 5 (Learning)
-- state=2: 57 (Review)  ← 应该是 12，剩下 45 张是 Mastered
-- state=3: 3 (Relearning)
-- state=4: 0 (Mastered)  ← 实际为 0
```

**修复**：
```typescript
// scripts/seed-demo-data.ts insertHighlight() 末尾
const row = fsrsCardToRow(fsrsCard, h.id, cardId, DEMO_TODAY_ISO);
const finalState = targetState; // 覆盖 row.state，使用 STATE_DISTRIBUTION
db.run(`INSERT OR REPLACE INTO cards (id, ..., state, ...) VALUES (?, ..., ?, ...)`,
       [..., finalState, ...]);  // ← 用 finalState 而非 row.state
```

**附加优化**：Mastered 卡附 `stability≥90, difficulty≤4.5, scheduled_days≥30` 三参数微调，让 FSRS UI 显示更真实。

### Suggested Action
**当 ts-fsrs 缺少业务层状态时，必须在 `fsrsCardToRow` 之后强制覆盖 state 字段写入 DB**。不要相信 ts-fsrs 默认返回的状态符合业务需求。

### Metadata
- Source: demo.db 验证
- Related Files: zhixing-reader/scripts/seed-demo-data.ts (行 960-983)
- Tags: ts-fsrs, fsrs-engine, state-override, demo-data, idempotent-seed

---

## [LRN-20260720-010] best_practice

**Logged**: 2026-07-20T22:20:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: backend
**Project**: zhixing-reader

### Summary
PowerShell 环境调 Node 参数：用 mjs 脚本避免命令行转义问题

### Details
调试 `seed-demo-data.ts` Token 参数时，需要快速查询数据库验证。直接用 `node -e "..."` 内嵌代码在 PowerShell 中常遇到：
- 反引号（`）转义错误
- 中文 Unicode 字符处理异常
- 多行字符串语法错

**正确做法**：用 `node scripts/analyze-states.mjs` 独立脚本：
```javascript
// scripts/analyze-states.mjs
import initSqlJs from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmDir = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist');
const SQL = await initSqlJs({ locateFile: (f) => path.join(wasmDir, f) });
const db = new SQL.Database(new Uint8Array(fs.readFileSync('resources/demo.db')));
// ... SQL 查询
```

**好处**：
- 用 `await initSqlJs(...)` top-level await，避免回调地狱
- 中文模板字符串可正常输出
- 可重复运行、版本控制
- 与 verify-demo-data.mjs 风格一致

### Suggested Action
调试 sql.js / 数据库 / AI 集成时，**优先写独立 .mjs 脚本**，避免 PowerShell 命令行内嵌代码的转义陷阱。

### Metadata
- Source: demo.db 验证
- Related Files: zhixing-reader/scripts/analyze-states.mjs, verify-demo-data.mjs
- Tags: powershell, mjs-script, sql.js, top-level-await, debugging-tool

---