# Errors

知行读书项目开发过程中的错误记录。

> **最近更新**：2026-07-20 — 追加 7 条 ai-dev-workflow 落地相关错误（ERR-20260720-001 ~ 007）
> **历史归档**：2026-05-29 ~ 2026-06-14 共 8 条原始错误（ERR-20260529-001 ~ ERR-20260614-003）
> **复盘原则**：所有错误必须记录，复盘后升级到 `.learnings/STANDARDS.md` 防止重复

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

## [ERR-20260720-001] eslint-legacy-70-errors

**Logged**: 2026-07-20T17:30:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tooling

### Summary
启用 ESLint 严格规则后，legacy 文件触发 70+ errors 阻塞门禁

### Error
```
70+ errors found:
- complexity > 15: 12 处（database.ts 9 / ipc.ts 3）
- no-unused-vars: 34 处
- max-lines: 6 处（database.ts 1967 / ipc.ts 657 / ...）
```

### Context
- 操作：执行 `chore(lint): 收紧 ESLint 严格模式` (commit 888df01)
- 原因：直接应用 R6-R10 全部规则未做 grandfather
- 根本原因：legacy 文件（数据库/IPC 层）历史上没遵守新规则，一刀切导致大量 errors

### Suggested Fix
1. 在 `eslint.config.js` 为 legacy 文件添加豁免：
   ```javascript
   {
     files: ['electron/database.ts', 'electron/ipc.ts', 'electron/weread-api.ts', 'electron/services/rag-service.ts'],
     rules: { complexity: 'off' }
   }
   ```
2. 其他规则继续生效（仅关 complexity 避免一刀切）
3. 用 `fix-unused-vars.mjs` 批量处理 27/33 个 unused vars
4. 手动处理 6 个解构类型

最终结果：errors 70+ → 0，warnings 126（max-lines-per-function + any + non-null）

### Metadata
- Reproducible: yes
- Related Files: eslint.config.js, electron/database.ts, electron/ipc.ts
- Resolution: 已修复，commit 888df01 + .learnings/STANDARDS.md 已记录规则分级策略

---

## [ERR-20260720-002] fix-unused-vars-syntax-break

**Logged**: 2026-07-20T17:35:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tooling

### Summary
fix-unused-vars.mjs 错误处理解构类型，生成 `function Foo({ x as _x, y }: ...)` 破坏语法

### Error
```
SyntaxError: Unexpected token, expected ","
  at KnowledgeCards.tsx, TokenUsage.tsx, VocabularyPage.tsx
```

### Context
- 操作：运行 `node scripts/fix-unused-vars.mjs` 自动修复 unused vars
- 原因：脚本对 `function Foo({ x, y }: { x: string; y: string })` 类型解构生成 `function Foo({ x as _x, y }: { x: string; y: string })`（语法错误）
- 根本原因：脚本无法区分"变量名"和"类型字段名"

### Suggested Fix
1. `git checkout -- KnowledgeCards.tsx TokenUsage.tsx VocabularyPage.tsx` 回滚
2. 手动用 `x: _x` 重命名（保留类型字段名）
3. 修复脚本增加解构类型检测，遇到时跳过
4. 剩余 6/33 个手动处理

### Metadata
- Reproducible: yes
- Related Files: scripts/fix-unused-vars.mjs, src/renderer/src/components/KnowledgeCards.tsx
- Resolution: 已修复，27/33 自动 + 6/33 手动；脚本限制已记入 LEARNINGS-20260720-003

---

## [ERR-20260720-003] powershell-pipe-exit-code

**Logged**: 2026-07-20T17:40:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tooling

### Summary
PowerShell 中 `|| true` 不是合法操作符

### Error
```
The token '||' is not a valid statement separator in this version.
'true' is not recognized as a cmdlet, function, script file, or executable program.
```

### Context
- 操作：在 fix-unused-vars.mjs 脚本中用 `npx eslint ... || true` 防止 ESLint 退出码非 0 中断
- 原因：`||` 是 bash 操作符，PowerShell 不支持
- 根本原因：跨平台 shell 兼容性未考虑

### Suggested Fix
1. 脚本改用 `execSync` 的 `stdio` 配置（不让 stderr 干扰）
2. PowerShell 中显式查看退出码：`npx eslint ...; "EXIT:$LASTEXITCODE"`
3. 或在 `package.json` 的 scripts 中用 `cross-env` 兼容

### Metadata
- Reproducible: yes
- Related Files: scripts/fix-unused-vars.mjs
- Resolution: 已修复，脚本改用 `cmd.exe` shell + `stdio: ['ignore', 'pipe', 'pipe']` 避免问题

---

## [ERR-20260720-004] edit-tool-duplicate-char

**Logged**: 2026-07-20T17:45:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tooling

### Summary
Edit 工具因字符串边界字符相同产生重复字符

### Error
```typescript
// 期望
function foo() {}

// 实际
function foo() {{}  // 多了一个 {
```

### Context
- 操作：用 Edit 工具修改 `function foo() {` 为 `function foo() { console.log() }`
- 原因：old_string 末尾是 `{`，new_string 末尾也是 `{`（函数体开括号），工具字符串匹配出错
- 根本原因：Edit 工具的实现 bug（Claude/IDE 通病）

### Suggested Fix
1. 立即 Read 文件验证修改
2. 扩大 old_string 范围到 1-2 行上下文
3. 不要相信"替换成功"提示
4. 重要修改后跑 `npm run verify` 兜底

### Metadata
- Reproducible: yes
- Related Files: N/A（任意文件）
- Resolution: 已记录到 LEARNINGS-20260720-005；后续所有 Edit 后必 Read 验证

---

## [ERR-20260720-005] eslint-type-aware-required

**Logged**: 2026-07-20T17:50:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary
启用 @typescript-eslint/no-unnecessary-condition 规则时报错"requires type information"

### Error
```
The rule "@typescript-eslint/no-unnecessary-condition" requires type information.
```

### Context
- 操作：想启用更严格的 TS 规则提升代码质量
- 原因：规则需要 TypeScript 类型推断
- 根本原因：ESLint 配置未启用 type-aware linting

### Suggested Fix
1. 暂时不启用该规则（保持 lint 速度）
2. 如需启用，在 `eslint.config.js` 添加：
   ```javascript
   parserOptions: {
     project: './tsconfig.json',
     tsconfigRootDir: import.meta.dirname,
   }
   ```
3. 注意：启用后 lint 速度慢 5-10 倍

### Metadata
- Reproducible: yes
- Related Files: eslint.config.js
- Resolution: 已决定不启用，权衡后保留快速 lint 体验；记录在 LEARNINGS-20260720-006

---

## [ERR-20260720-006] vitest-import-path

**Logged**: 2026-07-20T17:55:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tooling

### Summary
Vitest 测试文件用 `../../electron/xxx` 路径解析失败

### Error
```
Error: Failed to resolve import "../../electron/fsrs-engine" from "tests/fsrs-engine.test.ts"
```

### Context
- 操作：编写 `tests/fsrs-engine.test.ts` 引用 `electron/fsrs-engine.ts`
- 原因：用错相对路径层级（`../../` 多了一层）
- 根本原因：测试在 `tests/`（不是 `tests/integration/`），只需向上一级

### Suggested Fix
1. 改用 `'../electron/fsrs-engine'`（一层 ../）
2. 规范：`tests/*.test.ts` → `electron/*.ts` 用 `'../electron/xxx'`
3. `tests/integration/*.test.ts` → `electron/*.ts` 用 `'../../electron/xxx'`

### Metadata
- Reproducible: yes
- Related Files: tests/fsrs-engine.test.ts
- Resolution: 已修复，规范记录在 LEARNINGS-20260720-004

---

## [ERR-20260720-007] gitignore-codegraph

**Logged**: 2026-07-20T18:00:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary
CodeGraph 索引目录 `.codegraph/` 被错误提交到 git

### Error
```
git status
On branch master
Untracked files:
  .codegraph/
```

### Context
- 操作：建 CodeGraph 知识图谱后未更新 `.gitignore`
- 原因：CodeGraph 生成的索引是本地缓存，不应提交
- 根本原因：忽略规则缺失

### Suggested Fix
1. 在 `.gitignore` 添加：
   ```
   # CodeGraph (本地代码知识图谱索引)
   .codegraph/
   ```
2. 验证：`git status` 不再列出 `.codegraph/`

### Metadata
- Reproducible: yes
- Related Files: .gitignore
- Resolution: 已修复，`.codegraph/` 已忽略

---
