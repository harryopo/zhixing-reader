# 知行读书 v1.0.0 — 首个正式版本

> **发布日期**：2026-07-25  
> **License**：MIT  
> **运行平台**：Windows 10/11 (x64)

知行读书是一款面向阅读成长场景的桌面应用，把「**微信读书同步 → AI 智能体理解 → 科学间隔复习 → 知识卡片体系化 → 英语学习**」完整闭环装进本地优先的 Electron 容器。

---

## 🎯 核心功能

### 1. 微信读书同步
- 拉取书架、划线、笔记、书评
- 离线缓存到本地 sql.js（SQLite WASM）
- 自动合并增量更新
- 1d / 3d / 7d 三档自动同步调度

### 2. AI 智能体对话
- 5 维上下文构建：书籍 / 知识卡片 / 记忆 / 方法论 / 用户画像
- 意图分类 → 策略选择 → 编排执行
- 流式响应 + Token 用量统计
- Vercel AI SDK 统一接入多家服务商
- 真正的 AbortController 中断支持

### 3. FSRS v5 间隔重复算法 ⭐
基于 `ts-fsrs@5.4.1`（open-spaced-repetition 官方，Anki 23.10+ 同源）：
- 完整 DSR 模型（Difficulty / Stability / Retrievability）
- 21 个参数（含 decay / factor）
- `repeat()` 一次预览 4 种评分结果
- 完整遗忘曲线公式 `(1 + factor·t/9S)^decay`
- 与 Anki 数据互通（同 schema）

### 4. 知识卡片体系
- 自动从划线蒸馏概念卡 / 方法论卡 / 金句卡
- 反向链接到原文
- 复习时联动 FSRS 调度
- 1-5 掌握度评估

### 5. 英语词汇学习
- 词频词典（`resources/dictionary.json`，~8 万词）
- 上下文例句匹配
- SM-2 混合算法独立调度
- 每日学习（RSS 抓取 + 中英对照 + 悬停查词）

### 6. 统计与可视化
- 基于 Apache ECharts 5.5.1 的 AdminDashboard（6 个图表、按需引入、Canvas 渲染）
- Token 用量大数字（CCS-CSwitch 风格）
- FSRS 状态分布 + 稳定性曲线
- 阅读趋势 + 一周趋势 mini 柱状图

### 7. Admin 管理后台
- Dashboard / AgentConfig / KnowledgeBase / SessionHistory 四 Tab
- 数据库浏览、知识库管理、提示词中心、会话历史

### 8. MCP Server 子项目
独立 npm 包，支持 Claude Desktop / Cursor 通过 stdio transport 查询本地阅读数据库：
- `zhixing_list_books` — 列出书架
- `zhixing_search_highlights` — 搜索划线
- `zhixing_get_due_cards` — 获取到期卡片
- `zhixing_get_vocabulary` — 获取生词本
- `zhixing_get_reading_stats` — 获取阅读统计

---

## 🏗️ 技术架构

| 层 | 选型 |
|----|------|
| 桌面壳 | Electron 35（三进程：Main / Preload / Renderer）|
| 构建 | electron-vite 2 + Vite 5 + HMR |
| UI | React 19 + React Router 7 + Tailwind CSS 4 |
| 类型 | TypeScript 5.6 strict（0 `any` 原则）|
| 状态 | Zustand 5 |
| 数据库 | sql.js 1.14（WASM，无原生依赖）|
| 间隔重复 | ts-fsrs 5.4.1（FSRS v5 DSR）|
| 图表 | Apache ECharts 5.5.1 + echarts-for-react 3.0.2 |
| AI SDK | Vercel AI SDK（@ai-sdk/openai、@ai-sdk/anthropic 等）|
| 向量库 | Qdrant（可选 RAG 增强）|
| 测试 | Vitest 2 + @vitest/coverage-v8（667 用例 / 覆盖率 ≥ 85%）|
| 打包 | electron-builder 25 → Windows NSIS |

---

## 🔒 安全与隐私

- 所有用户数据本地存储，不上传任何服务器
- 微信读书 Cookie 加密保存（safeStorage），仅用于调用官方 API
- AI API Key 加密保存，请求直连 AI 服务商
- 不包含任何分析 / 追踪 / 广告 SDK
- 三进程严格隔离，`contextBridge` 安全暴露 IPC

---

## 📦 安装

### Windows
1. 下载下方 `知行读书 Setup 1.0.0.exe`（约 125 MB）
2. 双击运行安装程序
3. 安装完成后从开始菜单启动「知行读书」

### 系统要求
- Windows 10 64位 或更高
- 至少 500 MB 可用磁盘空间
- 网络连接（用于微信读书同步与 AI 对话）

---

## 🧪 质量保障

| 门禁项 | 结果 |
|--------|------|
| ESLint | 0 errors / 191 warnings |
| TypeScript strict | 0 errors |
| Vitest | 667 passed（28 文件）|
| Build | OK |
| 测试覆盖率（ai-service） | lines 91.99% / branches 84.48% / functions 95.83% |

---

## 📚 开源文档

- [LICENSE](https://github.com/harryopo/zhixing-reader/blob/master/LICENSE) (MIT)
- [CONTRIBUTING.md](https://github.com/harryopo/zhixing-reader/blob/master/CONTRIBUTING.md)
- [CODE_OF_CONDUCT.md](https://github.com/harryopo/zhixing-reader/blob/master/CODE_OF_CONDUCT.md)
- [PRIVACY.md](https://github.com/harryopo/zhixing-reader/blob/master/PRIVACY.md)
- [CHANGELOG.md](https://github.com/harryopo/zhixing-reader/blob/master/CHANGELOG.md)

---

## ⚠️ 已知问题

- Windows installer 体积约 125 MB（主要来自 Electron 运行时 + sql.js WASM + ECharts vendor）
- 部分依赖存在安全漏洞（详见 `npm audit`，均为间接依赖，已跟踪上游修复）
- macOS 与 Linux 版本尚未打包（需手动构建）
- 微信读书 Cookie 会随登录态过期，需定期重新获取

---

## 🙏 致谢

- [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) — FSRS v5 算法
- [Electron](https://www.electronjs.org/) — 跨平台桌面应用框架
- [React](https://react.dev/) — UI 框架
- [Apache ECharts](https://echarts.apache.org/) — 数据可视化
- [Vercel AI SDK](https://sdk.vercel.ai/) — AI 服务集成
- [sql.js](https://sql.js.org/) — SQLite WASM

---

**License**: MIT © 2026 知行读书
