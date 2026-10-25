# 真实可用的功能（知行读书 v1.3.5）

> **这份文档只写"代码里真接通、界面上点得到"的东西**，每条都标出入口和"验到哪一层"。
> 与 README 的分工：README 讲产品主张，`docs/wiki/REPO_WIKI.md`（本地文件）讲可复用件给开发者，**这份讲使用者能做什么、以及我们敢为哪一句背书**。
> "验到哪一层"只有三种说法，别混淆：
> ① **有判据** = 下面点名的测试文件真的存在（`tests/doc-figures.test.ts` 逐个核对，写错一个文件名就判红）；
> ② **只到真机** = 2026-09-26 那轮装机前实跑留过运行期证据，之后没重跑；
> ③ **没验** = 只证到"代码在、编译过"，没有执行体，也没人点过。
>
> 最后核对：2026-10-19。路由与判据文件名由 `tests/doc-figures.test.ts` 对仓库现算。

## 一、界面能做的事（22 个可达路由 + 1 个仅开发版直达）

| 能做什么 | 入口 | 验到哪一层 |
|---|---|---|
| 书架管理、同步微信读书书架与阅读时长 | 侧栏「书架」；顶栏同步按钮 | 有判据：`weread-sync-manager.test.ts` `weread-book-sync-plan.test.ts` `weread-api-network.test.ts` `reading-time-sync.test.ts` `weread-content.test.ts` |
| 看单本书的划线 / 卡片 / 方法论 | 书架点进任一本书 | 有判据：`card-book-id.test.ts` `highlight-upsert-real-db.test.ts` `chapter-summaries.test.ts` `summary-freshness.test.ts` |
| 划线与笔记：改、删、撤销、按书与整库导出 Markdown | 侧栏「笔记」；设置 → 数据 | 有判据：`notes-export.test.ts` `undo-delete.test.ts` `cascade-delete.test.ts` `highlight-time-backfill.test.ts` |
| 复习队列（知识卡片与方法论一起排进来） | 侧栏「复习」；顶栏通知面板「今日复习」 | 有判据：`fsrs-engine.test.ts` `review-queue-sources.test.ts` `review-enroll-channel.test.ts` `review-store.test.ts` `review-export.test.ts` |
| AI 对话：意图分类 → 上下文编排 → 流式回答，可中途停止 | 侧栏「对话」 | 有判据：`orchestrator.test.ts` `intent-classifier.test.ts` `strategy-selector.test.ts` `context-manager.test.ts` `state-tracker.test.ts` `chat-store-state.test.ts` |
| 引用来源点得回原划线（深链定位） | 对话回答下方出处区 | 有判据：`source-anchor.test.ts` `ipc-search-handlers.test.ts`；**真机没复核过定位准不准** |
| 全局搜索五类内容（划线 / 卡片 / 方法论 / 文章 / 生词），多词 AND、按相关度排 | 顶栏搜索框（唯一入口，侧栏没有这一格） | 有判据：`global-search.test.ts` `global-search-channel.test.ts` `retrieval.test.ts` `search-filter-parity.test.ts` `relevance-display.test.ts` |
| 知识卡片：全书分批生成、显示来源、进复习 | 侧栏「知识卡片」 | 有判据：`knowledge-card-service.test.ts` `knowledge-card-service-real-db.test.ts` `ai-batches.test.ts` `ai-coverage.test.ts`；**生成质量没验**（要真调模型） |
| 方法论：生成 +「练习」有真记录、掌握度可推 | 侧栏「方法论」 | 有判据：`methodology-practice.test.ts` `knowledge-methodology-builders.test.ts` `fsrs-metrics.test.ts` |
| 每日学习：任务、文章、生词、语音到期 | 侧栏「每日学习」 | 有判据：`daily-tasks.test.ts` `daily-stats-day-key.test.ts` `fsrs-voice.test.ts` `vocabulary-day.test.ts`；**RSS 抓取本身没有测试覆盖** |
| 生词本：ECDICT 查询（15.0MB / 59,118 词条离线）、学习阶段、CSV / Anki **导出** | 侧栏「生词本」 | 有判据：`vocabulary-model.test.ts` `vocabulary-schedule.test.ts` `dictionary-service.test.ts` |
| 阅读统计（窗口跟着档位变）与年度书单 | 侧栏「统计」 | 有判据：`stats-window.test.ts` `reading-trend.test.ts` `usage-tokens.test.ts` |
| AI 用量：token 明细、按本地日归集、可停流 | 侧栏「用量」 | 有判据（部分）：`usage-tokens.test.ts` `ai-coverage-channel.test.ts`；**`tokenUsage:*` 那几条通道没有专项测试文件** |
| 个人画像：语料包导出、结论逐条判定回读、画像卡复制 | 侧栏「档案」 | 有判据：`profile-corpus.test.ts` `profile-statements.test.ts` `profile-verified.test.ts` `profile-card.test.ts` `profile-stats.test.ts` `profile-handoff.test.ts` |
| 设置七个分区（账户 / AI / 智能体 / 微信读书 / 数据 / 外观 / 关于） | 侧栏「设置」 | 有判据：`settings-nav-single-source.test.ts`（导航只有一份）`ai-service-config.test.ts` `secret-storage.test.ts` `secret-ipc-boundary.test.ts` |
| 完整备份 / 恢复 / 重置数据库，删书删划线可撤销 | 设置 → 数据 | 有判据：`backup-roundtrip.test.ts` `data-io-import.test.ts` `sqljs-export-keeps-foreign-keys.test.ts` `startup-repair.test.ts` `undo-delete.test.ts` |
| 浅色 / 暗色主题切换 | 设置 → 外观；顶栏快捷按钮 | 有判据：`design-tokens.test.ts` `color-token-single-source.test.ts` `typography-assets.test.ts`；**观感没有肉眼复核** |
| 应用内检查更新 +「重启安装」 | 设置 → 关于；顶栏新版本提示 | 有判据：`install-exit-path.test.ts` `shutdown-behavior.test.ts` `update-notice.test.ts` `version-sync.test.ts`；**装机版没跑通过一轮真人验证**（[#1](https://github.com/harryopo/zhixing-reader/issues/1)） |
| 管理后台（仪表盘 / 提示词中心 / 数据库浏览 / 会话历史） | **只有开发版 URL 直达 `/admin`**，界面上没有入口；安装版这部分代码不进产物 | 有判据：`admin-not-in-bundle.test.ts` `admin-ipc-dev-only.test.ts` `admin-real-db.test.ts` `admin-charts.test.tsx` |

**路由对照**（判据按这行对账，多一条少一条都判红）：
`/` `/admin` `/bookshelf` `/bookshelf/:id` `/chat` `/daily-learning` `/knowledge-cards` `/methodologies` `/notes` `/profile` `/review` `/search` `/settings` `/settings/about` `/settings/account` `/settings/agent` `/settings/ai` `/settings/appearance` `/settings/data` `/settings/weread` `/stats` `/token-usage` `/vocabulary`

## 二、明说「不做」的（不是遗漏，是不背书）

| 常被误以为有的 | 实情 |
|---|---|
| 与 Anki 互导复习卡片（`.apkg`） | **没有**。全仓零 `.apkg` 读写。算法与 Anki 同源（ts-fsrs / FSRS-6.0），数据不互通；只有生词本能导出 Anki 认得的 TSV |
| 向量 / 语义检索、知识图谱 | **没有**。v1.2.0 起把向量链路整条撤了，现在只有本地 BM25（`electron/services/rag-service.ts`） |
| 云端同步、多设备同步、Web / PWA | **没有**。数据全在本机 `%APPDATA%\zhixing-reader` |
| EPUB / PDF 阅读、OCR、TTS 朗读、插件系统 | **没有** |
| macOS / Linux 安装包 | **没有**，只配了 Windows NSIS（[#5](https://github.com/harryopo/zhixing-reader/issues/5)） |
| 界面访问口令 / 多人共用防护 | **没有**（[#2](https://github.com/harryopo/zhixing-reader/issues/2) 在定方向） |
| 「复习 N 次」「费用」这类指标 | **已删**。没有写入方的字段不再显示，由 `no-fake-controls.test.ts` 钉住 |

## 三、现在还欠着的

跨进程通道声明 **148** 条，渲染层真调用 **142** 条。判定走两跳：先看 `preload.ts` 有没有把这条通道接过来，接了再看界面有没有真引用那个转发名 —— 只在渲染层源码里搜通道字符串是错的，`cards:getDue` 就是这么被冤枉过一次（界面写的是 `electronAPI.card.getDue`）。剩下 **6** 条分两种：5 条连 preload 都没接，界面跨不过这条边界（`dailyStats:incrementBooks/Highlights/Cards`、`weread:fetchAllContentBatch`，以及 `menu:about` —— 主进程 send 了但 preload 没人在听）；1 条接了却没人点（`books:search`，全局搜索走的是 `search:global`）。
另有 13 条依赖安全告警、159 个从未定义的类名、语义状态色在浅档当文字用不达标 —— 分档记在 [ROADMAP.md](ROADMAP.md)，能对外的都在 [Issues](https://github.com/harryopo/zhixing-reader/issues)。
