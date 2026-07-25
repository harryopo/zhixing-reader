# 过夜循环工程 — 知行读书功能修复

> **启动时间**：2026-07-20 夜  
> **目标**：P0 全修 + 深修 + 循环检测 + UI/能力断链 + 设置/知识卡/生词真接线  
> **约束**：最小改动；不拆 database.ts/ipc.ts；不自动 commit；**不开发本地阅读器**

---

## Wave 状态

| Wave | 状态 |
|------|------|
| A–E 功能修复主线 | **done** |
| F 循环日志/检测 + previewReviewRatings | **done** |
| G UI↔能力断链 | **done** |
| H Settings clearCache + cron 加固 | **done** |
| I 知识卡/生词真接线 | **done** |
| J 集成测试修复 + 书籍详情补字段 | **done**（2026-07-23） |
| K Vercel AI SDK 接入（orchestrator 流式切 SDK） | **done**（2026-07-23） |
| L 过夜自主开发（同步字段补齐 + 调研 + 根因 + 测试） | **done**（2026-07-24） |

## Wave I（2026-07-21 ~14:30）

| ID | 项 | 状态 |
|----|----|------|
| I1 | KnowledgeCards 新建 → `knowledgeCard.create` | **done** |
| I2 | KnowledgeCards 编辑 → `knowledgeCard.update` | **done** |
| I3 | KnowledgeCards 导出 JSON（前端下载） | **done** |
| I4 | 网格/列表视图切换 | **done** |
| I5 | Vocabulary 批量导入 → `createFromLookup` | **done** |
| I6 | 「收藏」→「未掌握」+ `getUnmastered`（无 favorite schema） | **done** |
| I7 | cron 从 1h → **15m** durable | **done** |
| I8 | 门禁 typecheck + test | **done**（173） |

### 有意不修
- 本地 EPUB / 全书阅读器 / 云多设备 / DB 重置 / 关于页文档站点
- 生词「收藏」字段（schema 无 is_favorite on vocabulary）

## 门禁（2026-07-21 ~14:30）

- typecheck **0** · test **173**
- durable cron：`46c4779e` · `*/15 * * * *`（7 日过期）

## 循环工程

```bash
npm run loop:log -- summary
npm run loop:detect
npm run loop:detect:gates
```

## 下一轮（勿空转）
- dogfood；按主题 commit（等用户）
- pending 空 → cron 只复验

---
*每轮更新本表 + NIGHTLY_LOG.md + `npm run loop:log`*
