# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-07-25

### Added
- **微信读书同步**：支持拉取书架、划线、笔记、书评，离线缓存到本地 sql.js，自动合并增量更新
- **AI 智能体对话**：5 维上下文构建（书籍 / 知识卡片 / 记忆 / 方法论 / 用户画像）、意图分类、策略选择、编排执行、流式响应、Token 用量统计、提示词模板热更新
- **FSRS v5 间隔重复算法**：基于 `ts-fsrs@5.4.1`（open-spaced-repetition 官方，Anki 23.10+ 同源），完整 DSR 模型，21 个参数，支持 `repeat()` 预览 4 种评分结果
- **知识卡片体系**：自动从划线蒸馏概念卡 / 方法论卡 / 金句卡，反向链接到原文，复习时联动 FSRS 调度
- **英语词汇学习**：词频词典（`resources/dictionary.json`，~8 万词）、上下文例句匹配、SM-2 混合算法独立调度、每日学习、生词本、查词
- **统计与可视化**：基于 Apache ECharts 5.5.1 的 AdminDashboard（6 个图表、按需引入、Canvas 渲染），Token 用量大数字、FSRS 状态分布、稳定性曲线
- **Admin 管理后台**：数据库浏览、知识库管理、提示词中心、会话历史、Token 仪表盘
- **MCP Server 子项目**：暴露 `list-books`、`search-highlights`、`get-due-cards`、`get-vocabulary`、`get-reading-stats` 五个工具
- **Vercel AI SDK 集成**：通过 `@ai-sdk/openai`、`@ai-sdk/anthropic` 等统一接入多家 AI 服务商
- **667 个单元测试**：覆盖率 ≥ 85%，关键模块（fsrs-engine、agent、database）≥ 95%
- **三进程架构**：Main / Preload / Renderer 严格隔离，`contextBridge` 安全暴露 IPC
- **自动检查更新**：通过 GitHub Releases API 检查新版本
- **飞书问卷反馈入口**：在应用内一键跳转反馈问卷
- **完整开源文档**：LICENSE (MIT)、CONTRIBUTING.md、CODE_OF_CONDUCT.md、PRIVACY.md、AGENTS.md、CLAUDE.md

### Security
- 所有用户数据本地存储，不上传任何服务器
- 微信读书 Cookie 加密保存，仅用于调用官方 API
- AI API Key 加密保存，请求直连 AI 服务商
- 不包含任何分析 / 追踪 / 广告 SDK

### Known Issues
- Windows installer 体积约 105MB（主要来自 Electron 运行时 + sql.js WASM + ECharts vendor）
- 部分依赖存在安全漏洞（详见 `npm audit`，均为间接依赖，已跟踪上游修复）
- macOS 与 Linux 版本尚未打包（需手动构建）
- 微信读书 Cookie 会随登录态过期，需定期重新获取

### Dependencies
- Electron 35
- React 19 + React Router 7
- TypeScript 5.6 strict
- Tailwind CSS 4
- Zustand 5
- sql.js 1.14
- ts-fsrs 5.4.1
- Apache ECharts 5.5.1 + echarts-for-react 3.0.2
- Recharts 3.8.1
- Vercel AI SDK
- Vitest 2 + @vitest/coverage-v8
- electron-builder 25

---

## 版本号说明

本项目遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)：

- **MAJOR**：不兼容的 API 变更
- **MINOR**：向后兼容的新功能
- **PATCH**：向后兼容的 Bug 修复

## 链接

[1.0.0]: https://github.com/zhixing-reader/zhixing-reader/releases/tag/v1.0.0

---

*最后更新：2026-07-25*
