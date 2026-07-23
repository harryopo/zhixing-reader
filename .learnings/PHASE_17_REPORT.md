# Phase 17 报告 — sql.js 集成测试套件 + AI SDK 重构 + MCP Server

> 完成时间：2026-07-23
> HEAD：`1bf1c05`（docs learnings 更新）
> 前置：Phase 16（lines 91.99% / branches 84.48% / functions 95.83%）

## 目标

1. 建立 sql.js 集成测试套件，覆盖 13 张表、迁移逻辑、事务和约束
2. 把 Claude 7/22-7/23 完成的工作整理入库
3. 更新 coverage 配置与归档

## 任务清单

| 任务 | 状态 | 说明 |
|------|------|------|
| T1 检查 Claude 工作 | ✅ | 识别 6 大块未提交工作（AI SDK / MCP Server / sql.js 测试 / UI 精简 / dogfood / learnings） |
| T2 建立 sql.js 集成测试套件 | ✅ | 49 个测试覆盖 13 张表 CRUD + 索引 + 约束 + 事务 |
| T3 补充核心表 CRUD + 迁移 + 约束测试 | ✅ | 14 个 Db 模块 CRUD 全覆盖 |
| T4 补充剩余表 + transaction/persistence 测试 | ✅ | runTransaction + resetDatabase + clearConversationsAndMessages |
| T5 更新 coverage 配置与归档 | ✅ | vitest.config.ts v1.4：database.ts 纳入 include，thresholds 重设 |

## Commit 记录

| Commit | Hash | 文件数 | 变更 |
|--------|------|--------|------|
| feat(ai-sdk): 重构流式对话为 Vercel AI SDK | `686e5ea` | 6 | +522/-2 |
| feat(mcp): 新增 MCP Server 子项目 | `5f300fe` | 14 | +5662 |
| test(db): sql.js 集成测试套件 49 用例 | `9db862d` | 4 | +1469/-5 |
| refactor(ui): 精简 Review/KnowledgeCards/Vocabulary 等页面 | `336e4eb` | 30 | +486/-1415 |
| chore(dogfood): 新增真机走查脚本并忽略 installer-final 产物 | `747276f` | 2 | +114 |
| docs(learnings): 更新 PROGRESS.md 记录 commit 整理结果 | `1bf1c05` | 2 | +183/-3 |

## 测试结果

- **470 tests passed (16 files)** — 4.03s
- **Coverage**（11 文件，含 database.ts）：
  - Lines: 81.54% (3924/4812)
  - Branches: 82.3% (837/1017)
  - Functions: 73.79% (214/290)
  - Statements: 81.54% (3924/4812)
- **Thresholds**：lines 80 / functions 70 / branches 80 / statements 80（全部通过）

## database.ts 覆盖率分析

| 指标 | 覆盖率 | 说明 |
|------|--------|------|
| Lines | 59.37% | CRUD 已测，IPC 处理函数 + 磁盘持久化未测 |
| Branches | 73.52% | 错误处理分支部分未测 |
| Functions | 52.05% | 约 140/290 函数未测（主要是 IPC handlers + persistToDisk） |

**未覆盖部分**（留 Phase 18）：
- `registerDatabaseHandlers` 等 IPC 注册函数（需要 Electron 环境模拟）
- `persistToDisk` / `markDirty` / `saveDatabase`（需要 fs 模块 mock）
- `initDatabase`（需要 app.getPath 模拟）
- `forceSaveDatabase` / `getDatabasePath`

## 修复的 bug

1. **orchestrator.ts 第 272 行调用未定义的 `streamChat`**
   - 原因：Claude 切换到 `sdkStreamChat` 时漏改调用点
   - 修复：改为 `sdkStreamChat`，移除 `legacyStreamChat` 导入
   - 影响：lint error（未定义变量）

2. **ai-sdk-service.ts 第 64 行 `options` 参数未使用**
   - 原因：函数签名保留了 `options` 参数（接口兼容），但函数体未使用
   - 修复：改名为 `_options`（符合 ESLint unused vars 规则）

## 清理

- 删除 3 个 debug-articles*.test.ts 调试文件
- 删除临时文件 T10-commit-msg.txt
- .gitignore 新增 installer-final/ 规则

## 门禁验证

- lint: 0 errors / 188 warnings
- typecheck: 0 errors
- test: 470 passed (16 files)
- build: OK (1m 21s)
- coverage: 全部 thresholds 通过

## 后续规划（Phase 18）

1. 补充 database.ts IPC handlers 测试（目标 functions 70%→85%）
2. 补充 database.ts 持久化函数测试（mock fs 模块）
3. ai-sdk-service.ts 加入 coverage include（需先补 sdkStreamChat 测试）
4. MCP Server 集成测试（与主数据库联动）
5. 比赛展示打磨（demo.db + seed 脚本提交 + 安装包重打）
