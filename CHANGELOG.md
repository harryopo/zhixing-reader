# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-08-28

### Added
- **间隔复习闭环**：新增复习页（`/review`），划线原文做卡面、四级评分带 FSRS 间隔预览、键盘快捷键（空格 + 1-4）、侧边栏与首页入口
- **Token 用量实时统计**：AI 对话用量实时落库，侧边栏与 Token 页通过事件即时刷新，0 用量（中断）不记录
- **档案资料注入 AI 画像**：个人档案自述资料（昵称/所在地/简介）优先注入对话上下文，叠加行为推导画像；空白资料不注入、单字段截断 200 字防垃圾上下文
- **首页行动入口重构**：继续阅读（最近 3 本封面进度卡）+ 最新划线/笔记 + 复习队列，统计展示收敛到统计页
- **书籍详情最近动态**：右栏展示本书最新划线/笔记真实预览
- **智能体编排真实化**：意图关键词、策略映射、难度规则直连后端运行时真实数据

### Changed
- 智能体编排从独立页迁入设置壳层（`/settings/agent`），与其他设置子页交互一致
- 主进程 database.ts（2415 行）/ ipc.ts（950 行）拆分为按领域组织的 `database/`（16 文件）与 `ipc/`（12 文件）目录，对外 API 不变
- 管理后台移出前端（无 UI 入口，开发期 URL 直达 `/admin`）
- 各页假数据治理：统计评分列、书籍难度、演示档案、编造规则等删除或替换为真实数据

### Fixed
- 侧边栏 /review 死链（菜单 Ctrl+2 现指向间隔复习页）
- 首页柱状图满刻度写死、头像未接昵称等展示问题

## [1.0.0] - 2026-07-25

### Added
- **微信读书同步**：支持拉取书架、划线、笔记、书评，离线缓存到本地 sql.js，自动合并增量更新
- **AI 智能体对话**：5 维上下文构建（书籍 / 知识卡片 / 记忆 / 方法论 / 用户画像）、意图分类、策略选择、编排执行、流式响应、Token 用量统计、提示词模板热更新
- **FSRS v5 间隔重复算法**：基于 `ts-fsrs@5.4.1`（open-spaced-repetition 官方，Anki 23.10+ 同源），完整 DSR 模型，19 组标准权重，支持 `repeat()` 预览 4 种评分结果
- **知识卡片体系**：自动从划线蒸馏概念卡 / 方法论卡 / 金句卡，反向链接到原文，复习时联动 FSRS 调度
- **英语词汇学习**：词频词典（`resources/dictionary.json`，~8 万词）、上下文例句匹配、SM-2 混合算法独立调度、每日学习、生词本、查词
- **统计与可视化**：基于 Apache ECharts 5.5.1 的 AdminDashboard（6 个图表、按需引入、Canvas 渲染），Token 用量大数字、FSRS 状态分布、稳定性曲线
- **智能体编排中枢**：六步流水线可视化、四种意图配置展示、策略矩阵热力图、系统提示词模板（6 变量注入），与后端 agent 实现同源
- **Vercel AI SDK 集成**：通过 `@ai-sdk/openai`、`@ai-sdk/anthropic` 等统一接入多家 AI 服务商
- **667 个单元测试**：覆盖率 ≥ 85%，关键模块（fsrs-engine、agent、database）≥ 95%
- **三进程架构**：Main / Preload / Renderer 严格隔离，`contextBridge` 安全暴露 IPC
- **自动检查更新**：通过 GitHub Releases API 检查新版本
- **GitHub Issues 反馈入口**：在应用内一键跳转 GitHub Issues
- **完整开源文档**：LICENSE (MIT)、CONTRIBUTING.md、CODE_OF_CONDUCT.md、PRIVACY.md、AGENTS.md、CLAUDE.md

### Security
- 所有用户数据本地存储，不上传任何服务器
- 微信读书 Cookie 加密保存，仅用于调用官方 API
- AI API Key 加密保存，请求直连 AI 服务商
- 不包含任何分析 / 追踪 / 广告 SDK

### Known Issues
- Windows installer 体积约 125MB（主要来自 Electron 运行时 + sql.js WASM + ECharts vendor）
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

[1.0.0]: https://github.com/harryopo/zhixing-reader/releases/tag/v1.0.0

---

*最后更新：2026-07-27*
