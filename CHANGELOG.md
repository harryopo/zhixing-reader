# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.0] - 2026-09-17

### Added
- **应用内自动更新**：接入 `electron-updater` + GitHub Releases。启动时静默检查，「设置 → 关于」可手动检查、一键下载（含进度条）、重启安装；下载完成后即便不点安装，下次正常退出也会自动装上。开发环境自动降级为 GitHub API 比对 + 打开下载页
- **本地 BM25 检索**：书籍划线检索从「向量语义检索（Vectra + embeddings API）」换成本地 BM25 + 中文 bigram（`src/shared/retrieval.ts`），零 API 依赖、不会静默失败；原向量链路整套移除
- **检索可视化**：对话页「调取知识库」面板实时展示 5 路检索结果、意图分类与命中原文；意图分类结果落库 `chat_messages.intent`，引用来源片段（`ragSources`）随消息持久化
- **对话深度思考流式展示**：思考内容流式下发前端，面板默认折叠
- **历史滚动摘要（Token 优化 Step 3）**：wire 历史超阈值时最老轮次增量折叠进持久化摘要，长会话输入 token 不再线性膨胀，跨重启保留早期上下文
- **前缀缓存友好化（Token 优化 P0）**：system prompt 逐字节稳定 + wire 历史视图 + 缓存命中率观测（`cached_tokens`）
- **微信读书后台自动同步**：定时器驱动全量同步，结果事件推送前端；失败告警不静默
- **每日新卡上限**：新卡与复习卡分桶展示，修复「934 条划线一次性全到期」的放弃感
- **卡片掌握度**：由 FSRS 状态推导，全应用共用一套「人话」表述；复习页可连续复习、评分防连点
- **启动自动修复**：卡片来源划线 / 划线章节名 / 阅读时长三类历史数据缺口启动后自动补齐（后台执行，不拖慢窗口）
- **数据导出补全**：备份导出纳入知识卡片 / 方法论 / 生词，导入真实恢复它们与复习卡片
- **存储用量真实化**：设置页显示数据库 / 日志真实字节数，小于 0.1MB 用 KB 显示

### Changed
- **每日学习重做**：只留系统能判定的事项，砍掉 4 项纯形式任务
- **词汇复习改用 ts-fsrs**：修复间隔恒为 1 天、评分档位错位、毕业丢状态三处问题；「加入复习」只排队不偷记评分
- **「重新蒸馏 / 重新提取」改为真替换**：先清旧数据再生成，不再新旧混杂
- **测试基线**：885 用例 / 42 文件全绿；fixture 复用生产的 `applySchemaAndMigrations()`，消除双份 schema

### Fixed
- 对话默认不选书时三路上下文全被跳过（意图为「提问」也检索）
- 书籍上下文恒为空、对话静默无响应（Repository 工厂从未初始化）
- 中文提问检索恒为 0 条（切词整句当一词、空索引误判、空结果不回退）
- 934 条划线章节名丢失、知识卡片 / 方法论来源划线丢失、阅读时长恒为 0、引用来源不落库——数据血缘四处断点全部修复
- 数据库持久化失败加指数退避重试与用户通知；`RESET_DATABASE` 退出前强制落盘
- 系统加密不可用时如实告知 API 密钥为明文存储（不再假装安全）
- 死代码治理：`book_architecture` 全链路、30+ 处假按钮 / 假数字 / 无人消费的开关清理
- 结构化 AI 任务（蒸馏 / 方法论 / 翻译）默认关思考 + 输出预算取用户配置 + JSON 截断抢救

### Security
- `getDatabaseTableData` 拒绝 `sqlite_` 内部表（纵深防御）

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
- **FSRS-6.0 间隔重复算法**：基于 `ts-fsrs@5.4.1`（open-spaced-repetition 官方，Anki 24.06+ 同源），完整 DSR 模型，21 组标准权重，支持 `repeat()` 预览 4 种评分结果
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

[1.2.0]: https://github.com/harryopo/zhixing-reader/releases/tag/v1.2.0
[1.1.0]: https://github.com/harryopo/zhixing-reader/releases/tag/v1.1.0
[1.0.0]: https://github.com/harryopo/zhixing-reader/releases/tag/v1.0.0

---

*最后更新：2026-09-17*
