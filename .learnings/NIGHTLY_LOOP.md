# 过夜循环工程 — 知行读书功能修复

> **启动时间**：2026-07-20 夜  
> **目标**：P0 全修 + P1 + 深修 + 真 abort  
> **约束**：最小改动；不拆 database.ts/ipc.ts；不自动 commit

---

## Wave A–D

| Wave | 状态 |
|------|------|
| A P0 Chat/建卡 | **done** |
| B P1 统计/路由/Review | **done** |
| C 加固 + verify | **done** |
| D 会话映射/软停/Admin/toast/due | **done** |

## Wave E — 真 abort（用户继续）

| ID | 项 | 状态 |
|----|----|------|
| E1 | `streamChat` AbortController + cancelActiveStream | **done** |
| E2 | IPC `agent:cancelStream` + preload + renderer.d.ts | **done** |
| E3 | chatStore.stopStreaming 调 cancelStream | **done** |
| E4 | ipc-channels 测试表加 cancelStream | **done** |
| E5 | reviewStore getDue(100) 对齐 | **done** |

## 门禁（2026-07-20 ~23:15）

- typecheck **0**
- test **171 passed**
- 网络闪断已重试通过

## 上下文压缩（给用户）

- 命令：`/compact` 或自然语言「压缩上下文」
- 长会话建议每 30–60 分钟 compact 一次；进度以 `NIGHTLY_*.md` 为磁盘真相

## 下一轮可选

- package:win
- dogfood 手测
- 按主题 commit
- reviewStore 接到 Review 页或标注死代码

---
*每轮更新本表 + NIGHTLY_LOG.md*
