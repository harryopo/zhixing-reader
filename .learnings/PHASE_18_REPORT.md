# Phase 18 报告 — 补测试覆盖率

> 完成时间：2026-07-23
> 前置：Phase 17（lines 81.54% / branches 82.3% / functions 73.79%，11 文件）

## 目标

补充 database.ts 持久化/迁移/生命周期函数测试 + ai-sdk-service.ts 流式/结构化输出测试，提升整体覆盖率。

## 任务清单

| 任务 | 状态 | 说明 |
|------|------|------|
| T1 持久化函数测试 | ✅ | getDatabasePath / forceSaveDatabase / saveDatabase（通过 runTransaction 间接） |
| T2 迁移函数测试 | ✅ | migrateCardsTable / migrateBooksTable / migrateChatMessagesTable（ALTER TABLE 验证 + 幂等） |
| T3 生命周期测试 | ✅ | initDatabase（新库/已有库）/ closeDatabase（关闭+再次关闭不抛错） |
| T4 ai-sdk-service 测试 | ✅ | sdkStreamChat（流式/错误/取消/abort 前一个）/ sdkGenerateObject（结构化/maxTokens/AbortSignal/错误） |
| T5 覆盖率验证 | ✅ | thresholds 提升：lines 80→83 / functions 70→75 / branches 80 |
| T6 报告归档 | ✅ | 本文件 |

## 新增测试文件

| 文件 | 测试数 | 覆盖目标 |
|------|--------|----------|
| tests/database-persistence.test.ts | 13 | database.ts 持久化 + 迁移 + 生命周期 + reset/clear 边界 |
| tests/ai-sdk-service.test.ts（扩展） | 13（原 3 + 新 10） | sdkStreamChat 流式/错误/取消 + sdkGenerateObject 结构化 |

**新增测试总数**：23 个（13 + 10）

## 覆盖率提升

| 指标 | Phase 17 | Phase 18 | 提升 |
|------|----------|----------|------|
| Lines | 81.54% | 84.86% | +3.32% |
| Branches | 82.3% | 81.38% | -0.92% |
| Functions | 73.79% | 77.1% | +3.31% |
| Statements | 81.54% | 84.86% | +3.32% |

### 分文件覆盖率

| 文件 | Phase 17 | Phase 18 | 变化 |
|------|----------|----------|------|
| ai-sdk-service.ts | — | 92.85% lines / 100% funcs | 新增 |
| database.ts | 59.37% lines / 52.05% funcs | 69.24% lines / 57.53% funcs | +9.87% lines |
| 其他文件 | 维持 | 维持 | — |

## Thresholds 提升

| 指标 | Phase 17 | Phase 18 | 缓冲 |
|------|----------|----------|------|
| lines/statements | 80 | 83 | 1.86% |
| functions | 70 | 75 | 2.1% |
| branches | 80 | 80 | 1.38% |

## 门禁验证

- lint: 0 errors / 188 warnings
- typecheck: 0 errors
- test: 496 passed (17 files) — 原 470 + 新增 26（13+13）
- coverage: 全部 thresholds 通过

## 测试技术要点

### database-persistence.test.ts

1. **fs mock 用 importOriginal**：保留 createWriteStream 等实际方法（logger 依赖），只 mock existsSync/writeFileSync/readFileSync/mkdirSync
2. **迁移测试用独立 sql.js 实例**：构造缺列的表，手动执行 ALTER TABLE，验证列存在
3. **initDatabase 测试**：mock fs.existsSync 返回 false/true，验证新库创建 schema、已有库加载数据
4. **closeDatabase 测试**：验证关闭后再次调用不抛错（db 已为 null）

### ai-sdk-service.test.ts

1. **vi.hoisted 注册 mock**：确保 mock 在模块导入前注册，避免 hoisting 问题
2. **mock ai 模块的 streamText/generateObject**：用 async generator 模拟 textStream
3. **取消测试**：构造挂起的流，cancelActiveStream 后验证 safeComplete 触发
4. **abort 前一个流测试**：连续两次 sdkStreamChat，验证第一个流被 abort

## 后续规划（Phase 19）

database.ts 仍有 30.76% lines 未覆盖，主要是：
- 各 Db 模块的边界方法（search 高亮、getStatsByProvider 等）
- IPC handlers（不在 database.ts，在 ipc.ts）
- 错误处理分支

Phase 19 可考虑：
1. 补 database.ts 各 Db 模块边界方法测试
2. 比赛展示打磨（demo.db + seed 脚本 + 安装包重打）
3. MCP Server 集成测试
