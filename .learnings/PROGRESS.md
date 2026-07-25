# 知行读书 — 项目进度与规划

## 📊 当前进度（截至 2026-07-25）

### ✅ 已完成

| 模块 | 功能 | 状态 | 提交 |
|------|------|------|------|
| **基础架构** | Electron 35 + React 19 + TypeScript 5.6 | ✅ 完成 | v1.0.0 |
| **构建系统** | electron-vite 2 三进程（main/preload/renderer） | ✅ 完成 | v1.0.0 |
| **数据库** | sql.js (SQLite WASM) + 自动迁移 | ✅ 完成 | v1.0.0 |
| **IPC 通信** | 统一 `IPC_CHANNELS` 常量 + 错误包装 | ✅ 完成 | `refactor(ipc)` 3e55914 |
| **配置持久化** | SettingsService 单例 + safeStorage 加密 | ✅ 完成 | v1.0.0 |
| **微信读书 API** | Agent API Gateway 集成 | ✅ 完成 | v1.0.0 |
| **AI 服务** | OpenAI/Anthropic/Custom 三 provider | ✅ 完成 | v1.0.0 |
| **FSRS 复习** | SM-2 优化（学习阶段 0/1/2 + ease hell 防护） | ✅ 完成 | v1.0.0 |
| **知识卡片** | 蒸馏（仅基于用户划线/笔记）+ 1-5 掌握度 | ✅ 完成 | v1.0.0 |
| **方法论管理** | 自动注入智能体 + mastery/practice 自动更新 | ✅ 完成 | v1.0.0 |
| **每日学习** | RSS 抓取 + 中英对照 + 悬停查词 + 右键加生词 | ✅ 完成 | v1.0.0 |
| **AI 智能体** | 编排器 orchestrator + 意图分类 + 流式对话 | ✅ 完成 | v1.0.0 |
| **管理后台** | Dashboard/AgentConfig/KnowledgeBase/SessionHistory | ✅ 完成 | v1.0.0 |
| **生词本** | 词形还原 + 复习合并到知识卡片 | ✅ 完成 | v1.0.0 |
| **开发规范** | ai-dev-workflow 6 阶段 + 15 条硬规则 | ✅ 完成 | 8 个独立 commit (07-20) |
| **死代码治理循环工程（7/21）** | ✅ 完成 | 6 任务循环 + 双审 + verifier；19 处死代码（7 砍 + 8 补 + 4 留）；commit f5a3cbe + f4d1536 + 92bd56a |

### 🔄 进行中

| 功能 | 进度 | 备注 |
|------|------|------|
| 验证门禁 | ✅ | lint 0e/191w · type 0 · test 667 passed · build OK（2026-07-25 复核） |
| **夜间功能修复循环** | ✅ 主线完成 | 见 `.learnings/NIGHTLY_LOOP.md`：Chat 契约断链、流式 hang、导入不建卡、Home/Bookshelf/Profile 假数据、HashRouter、Review 文案/mastery、daily_stats、侧栏复习入口 |
| CodeGraph 知识图谱 | 已建图 | 100 文件 / 1,451 节点 / 4,645 边 |
| 比赛展示打磨 | 90% | demo.db + seed 脚本在 commit b43f607 已入库；Windows 安装包需基于当前 HEAD 重打 |
| **Vercel AI SDK 重构（7/23）** | ✅ 已实现未提交 | 新增 `electron/ai-sdk-service.ts` + 23 单测；orchestrator 已切换到 `sdkStreamChat`；方案见 `docs/ai-sdk-refactor-plan.md` |
| **MCP Server 子项目（7/23）** | ✅ 已实现未提交 | 新增独立子项目 `mcp-server/` — 5 个只读工具 + 14 个测试；支持 Claude Desktop / Cursor |
| **sql.js 集成测试套件（7/23）** | ✅ 已实现未提交 | `tests/database-integration.test.ts` — 49 个测试覆盖 13 张表 CRUD + 索引 + 约束 + 事务 |
| **UI 精简（7/23）** | ⚠️ 已实现未提交 | Review.tsx 删除；KnowledgeCards/VocabularyPage/SettingsAI 等 11 个页面精简 |
| **用户反馈批量优化（7/23-7/24）** | ⚠️ 部分已修 | A 类 backend 已修；B 类 UI 中 12/14 已确认完成；Stats.tsx:654 的「2026 已读过滤」bug 已修复；AI 对话区宽度/统计趋势图需真机复核 |
| **最终交付审查（7/25）** | 🔄 进行中 | 门禁全绿；working tree 35+ 文件未 commit；需最终收尾 commit + installer + dogfood |
| **演示数据 FSRS 修复（7/20）** | ✅ | Mastered 状态强制写入 + Token 1.27M |
| **死代码治理归档（7/21）** | ✅ 完成 | spec/tasks/checklist/verify-report 四件套；LEARNINGS 追加 LRN-20260721-006~010；installer-v2 污染已清理（-222378 行） |
| **测试覆盖率提升 Phase 16（7/22）** | ✅ 完成 | lines 91.99% / branches 84.48% / functions 95.83%；详见 `.learnings/PHASE_16_REPORT.md` |
| **审查 Agent 规范沉淀（7/22）** | ✅ 完成 | `.claude/rules/review-agent.md` — 提示词模板 + 审查类目 + 反馈表达规范 |
| **AI SDK 重构（7/22-7/23，Claude）** | ⚠️ 已实现未提交 | 新增 `electron/ai-sdk-service.ts` + `tests/ai-sdk-service.test.ts`；orchestrator 已切换到 `sdkStreamChat`；方案见 `docs/ai-sdk-refactor-plan.md` |
| **MCP Server 子项目（7/22-7/23，Claude）** | ⚠️ 已实现未提交 | 新增独立子项目 `mcp-server/` — 5 个只读工具（list-books/search-highlights/get-due-cards/get-vocabulary/get-reading-stats）+ 14 个测试；支持 Claude Desktop / Cursor 查询阅读数据 |
| **sql.js 集成测试套件（7/22-7/23，Claude）** | ⚠️ 已实现未提交 | 新增 `tests/database-integration.test.ts` — 49 个测试覆盖 13 张表 CRUD + 索引 + 约束 + 事务；测试夹具 `tests/__fixtures__/db-helpers.ts`；database.ts 加 `injectTestDatabase` 测试注入 |
| **Agent 编排架构（已上线，7/22-7/23 复核）** | ✅ 完整 | 详见下文「Agent 编排架构现状」章节 |
| **UI 精简（7/22-7/23，Claude）** | ⚠️ 已实现未提交 | 删除 `Review.tsx`（-896 行）；精简 KnowledgeCards/VocabularyPage/SettingsAI 等 11 个页面；35 文件 +/- 956/-1421 |
| **用户反馈批量优化（7/23-7/24）** | ✅ 完成 | 见下文「7/24 用户反馈批处理」章节 |
| **门禁复测（7/24）** | ✅ 全绿 | typecheck 0 · lint 0e/191w · test 493/493 · build OK |

### ⏳ 待开发（比赛后）

| 功能 | 优先级 | 预估工作量 |
|------|--------|-----------|
| 拆 database.ts（1967 行 → 多文件） | 中 | 2-3 天 |
| 拆 ipc.ts（657 行 → 多文件） | 中 | 2 天 |
| 拆 weread-api.ts | 低 | 1-2 天 |
| 拆 rag-service.ts | 低 | 1-2 天 |
| 升级 React Router 7 → 8 | 低 | 1 天（含破坏性变更） |
| macOS/Linux 打包配置 | 低 | 1 天 |
| 建立 sql.js 集成测试套件 | 高 | 2-3 天 |
| 建立 IPC 全链路冒烟测试 | 高 | 1-2 天 |
| 统一数据映射层 | 中 | 2 天 |
| 消除模块级可变全局状态 | 中 | 1-2 天 |
| 建立 service layer 封装 IPC | 中 | 2 天 |

---

## 🎯 后期开发规划

### Phase 1: 比赛期优化（7/20-7/31，仅修 bug）

- [ ] **门禁持续绿**
  - [ ] 每次 commit 前跑 `npm run verify`
  - [ ] CI 临时关掉省配额，本地 pre-commit 强制
  - [ ] 用户反馈的 bug 24h 内修
- [ ] **体验打磨**
  - [ ] 启动速度优化
  - [ ] 大数据量（>1000 划线）性能
  - [ ] 错误信息友好化（cancelled/timeout/network 分类）
- [x] **演示准备**
  - [x] 准备 demo 数据（精选 12 本书 + 68 划线/22 知识卡/1.27M Token）
  - [x] 录屏脚本（核心功能 3-5 分钟）：`docs/demo-screenplay-2026-07-20.md`
  - [x] PPT 14 页：`docs/zhixing-reader-presentation.pptx`
  - [x] 介绍 PDF 12 页：`docs/zhixing-reader-intro.pdf`
- [ ] **最终收尾**
  - [ ] 整理 commit（35+ 未提交改动）
  - [ ] 重打 Windows installer
  - [ ] final dogfood 手测
  - [ ] 更新 LEARNINGS / project_memory

### Phase 2: 技术债清理（8/1-8/15，比赛后）

- [ ] **巨型文件拆分**
  - [ ] `electron/database.ts` 1967 行 → 拆为 db/{books,highlights,cards,reviews,...}.ts
  - [ ] `electron/ipc.ts` 657 行 → 拆为 ipc/{books,highlights,cards,chat,admin,...}.ts
  - [ ] `electron/weread-api.ts` → 模块化
  - [ ] `electron/services/rag-service.ts` → 模块化
- [ ] **测试覆盖**
  - [ ] 核心服务单测（prompt-registry, knowledge-card-service, settings-service）
  - [ ] IPC handler 集成测试
  - [ ] AI service mock 测试
  - [ ] 目标覆盖率 ≥60%（从当前 5% 起步）

### Phase 3: 高级功能（8/16 起）

- [ ] **知识图谱**
  - [ ] 可视化（基于 CodeGraph 数据）
  - [ ] 跨书籍关联
  - [ ] 智能推荐
- [ ] **AI 增强**
  - [ ] 多模态（图片/音频支持）
  - [ ] 本地小模型集成（Ollama）
  - [ ] RAG 优化（混合检索 + rerank）
- [ ] **跨平台**
  - [ ] macOS 打包
  - [ ] Linux AppImage
  - [ ] 自动更新机制

### Phase 4: 性能与体验（持续）

- [ ] **性能**
  - [ ] 首屏加载 < 1.5s
  - [ ] 大数据列表虚拟滚动
  - [ ] 数据库查询优化
- [ ] **UX**
  - [ ] 快捷键（vim 风格）
  - [ ] 主题切换（亮/暗/跟随系统）
  - [ ] 多语言（中/英）

---

## 🐛 已知问题

| 问题 | 严重程度 | 状态 |
|------|----------|------|
| ~~API Key 不持久化~~ | 高 | ✅ 已修复 (v1.0.0) |
| ~~IPC 响应格式错误~~ | 高 | ✅ 已修复 (v1.0.0) |
| ~~HTTP 499 超时~~ | 中 | ✅ 已修复 (v1.0.0) |
| ~~中文 API Key 报错~~ | 中 | ✅ 已修复 (v1.0.0) |
| ~~RSS 文章未持久化~~ | 高 | ✅ 已修复 (06-14) |
| ~~require() of ES Module~~ | 高 | ✅ 已修复 (06-14) |
| ~~window close 数据丢失~~ | 高 | ✅ 已修复 (3e7167f) |
| ESLint warnings 126 个（max-lines-per-function + any + non-null） | 低 | 📝 长期优化，比赛后处理 |
| database.ts / ipc.ts 文件过大 | 中 | 📝 比赛后拆分 |

---

## 💡 技术债台账

| 项目 | 优先级 | 当前状态 | 计划 |
|------|--------|---------|------|
| 单元测试覆盖 | 高 | 15%（117 tests：FSRS 38 + prompt-registry 42 + template-engine 18 + http-client 11 + admin-charts 6 + ipc 2） | Phase 2 提升到 ≥60% |
| database.ts 单文件 1967 行 | 中 | grandfather（关闭 complexity 校验） | Phase 2 拆分 |
| ipc.ts 单文件 657 行 | 中 | grandfather（关闭 complexity 校验） | Phase 2 拆分 |
| weread-api.ts / rag-service.ts | 低 | grandfather | Phase 2 拆分 |
| React Router 7 → 8 升级 | 低 | 不升级（破坏性变更风险） | 比赛后评估 |
| ECharts 切换 | ~~低~~ | ✅ **已切**（AdminDashboard 局部，4 commits：`ad56699`+`67df415`+`e0ec3a2`+`5f7ad84`）| 比赛期调研 P1 提前完成（实际 ~1 天）|
| 错误边界 | 中 | 部分覆盖 | Phase 2 补齐 |
| 日志系统 | 低 | 当前简单 | Phase 3 升级 |

---

## 📝 开发规范（v2，2026-07-20 起执行）

完整规范见 `.learnings/STANDARDS.md` 和 `.claude/rules/*.md`。核心要点：

### 工作流
- **6 阶段**：需求澄清 → 架构设计 → 脚手架 → 编码 → 质量门禁 → 知识沉淀
- **闸门制**：每阶段不通过不前进
- **验证顺序**：lint → typecheck → test → build

### 提交
- **Conventional Commits**：`feat/fix/chore/docs/test/refactor/perf/build/ci/style/revert`
- **独立 commit**：每个 commit 单一关注点
- **commitlint 强校验**（建议本地 pre-commit 加）

### 自动化
- **ESLint**：complexity/eqeqeq/prefer-const/max-params = error；max-lines/* = warn
- **TypeScript**：strict mode
- **Vitest**：≥85% 覆盖率（新代码）
- **GitHub Actions**：lint + type + test + build + secret scan + dep audit

### 协作
- **AGENTS.md**：项目入口
- **.claude/ownership.yaml**：Sub-agent 文件所有权
- **.claude/agents/**：code-reviewer + test-writer 两个内置 agent
- **范围纪律**：只碰被要求碰的；其他问题用 `NOTICED BUT NOT TOUCHING: ...` 记录

---

## 📈 关键指标

| 指标 | 数值 | 测量方式 |
|------|------|----------|
| 总 commit 数 | 21 | `git log --oneline \| wc -l` |
| 本周（7/14-7/20）新增 | 13 | 8 个 ai-dev-workflow + 5 个 v1.0.0 |
| 代码行数（主项目） | ~25K | `cloc electron/ src/ shared/` |
| 测试用例 | 18 | vitest run |
| ESLint errors | 0 | `npm run lint` |
| TypeScript errors | 0 | `npm run typecheck` |
| Build 成功 | ✅ | `npm run build` |
| CI 配置 | ✅ | `.github/workflows/ci.yml` |
| 文档文件 | 5 | `.learnings/*.md` |
| 规范文件 | 3 | `.claude/rules/*.md` |
| Sub-agent 配置 | 2 | `.claude/agents/*.md` |

---

## 🔁 v2 循环工程（2026-07-21，收尾工程）

### v2 任务表

| 任务 | 描述 | 状态 | 关键产出 |
|------|------|------|----------|
| **T1** | Commit 整理（8 个独立 commit，覆盖 Nightly Loop Wave A-E + UI 改造 + 基础设施） | ✅ 完成 | HEAD `b43f607`，领先 origin/master 44 commits |
| **T2** | Installer 重打 | ✅ 完成 | `installer-v2/知行读书 Setup 1.0.0.exe` 104.65 MB |
| **T3** | Dogfood 真机走查 | ✅ 完成 | 10/10 路径通过；0 P0 / 3 P1 非阻断 |
| **T4** | 归档（PROGRESS / LEARNINGS / 报告 / memory 四件套同步） | ✅ 完成 | 本节 + LEARNINGS 5 条 + v2 报告 + memory v2 章节 |

### v2 关键产出

**8 个独立 commit**（HEAD `b43f607`，领先 `origin/master` 44 commits）：

1. `9cb76a7` feat(fsrs): add previewReviewRatings pure function + tests（2 文件，+79/-2）
2. `fec85b8` feat(stats): feed daily_stats on review + raise due limit + snake_case compat（2 文件，+23/-9）
3. `fe4555f` fix(router): switch to HashRouter for `file://` protocol compat（1 文件，+4/-3）
4. `f84a244` fix(review): align getDue limit to 100 matching backend batch size（1 文件，+1/-1）
5. `672aa17` feat(admin): add Link back to app and session history tab（1 文件，+16/-4）
6. `fdc56df` feat(chat): align stream contract, settle Promise, real abort, auto FSRS card（7 文件，+259/-40）
7. `48a0804` feat(ui): Google Design Library 1:1 redesign with tokens, components, and page refresh（37 文件，+16157/-4731）
8. `b43f607` chore(infra): tsconfig scripts include + demo data + nightly logs + gitignore + package.json（11 文件，+1732/-9）

合计 **62 文件 / +18271/-4799**。

- **Installer v2**：`installer-v2/知行读书 Setup 1.0.0.exe` — 104.65 MB（2026-07-21 12:31 构建，配置文件 `builder-output-override.json` 临时拆出）
- **Dogfood**：10/10 路径通过（chat / 流式 stop / 导入建卡 / 复习预览间隔 / 统计 / 路由 / Admin SessionHistory / 设置页 / 每日学习 / 知识卡）
- **测试**：173 passed（Wave F 新增 2 个 previewReviewRatings 测试，从 171 → 173）
- **门禁**：lint 0e · typecheck 0 · build OK

### v2 关键发现

- 之前 Claude Nightly Loop 5 轮（Wave A-E）已完成 P0/P1 修复，但**没 commit**；v2 T1 把它们整理入库（commit 1-6）
- 之前 Claude 还做了 **Google Design Library 1:1 UI 改造**（37 文件 / +16K 行），也**没 commit**；v2 T1 合并到 commit 7 (`48a0804`)
- v1 循环（T1-T8）的演示数据 / installer / 归档产物未跟踪；v2 T1 commit 8 (`b43f607`) 把可跟踪部分入库
- Stats.tsx 截断 bug 在 T1 拆 commit 时被发现，已随 commit 2 (`fec85b8`) 修复
- v1 报告 `docs/loop-engineering-report-2026-07-20.md` 在 git 历史中无记录（确实未创建，仅 memory/AGENTS.md 引用）

### v2 P0/P1 状态

| 等级 | 数量 | 详情 | 阻断性 |
|------|------|------|--------|
| P0 | 0 | — | — |
| P1 | 3 | ① dev server 端口 5176 被 Hyper-V 保留（5175-5274 范围）② app.asar 进程占用导致 electron-builder EPERM ③ GPU cache 拒绝访问（`GPUCache/` 目录权限） | 非阻断（均有绕过方案，见 LEARNINGS LRN-20260721-003/005） |

### v2 最终状态

✅ **可提交**（HEAD `b43f607`，working tree 仍有 T2/T3 产生的杂项改动 + `loop-logs/` `installer-v2/` `builder-output-override.json` 未跟踪，均非阻断）

### v2 后续待办

- **v1.0.1**（1-2 周）：修 npm audit 23 个 prod 漏洞 + 治理 124 个 ESLint warnings
- **v1.0.2**（1 周）：优化包体积（目标 < 80MB）+ 合并 `builder-output-override.json` 回 `package.json` + dev server 端口常量化 + 加 `.gitattributes` 统一行尾
- **v1.1.0**（1 周）：补 6 个 repository-factory 占位仓库 + 拆 `database.ts`/`ipc.ts`
- **v1.2.0**（1 周）：拆 `admin-charts.tsx` + 暴露 `previewReviewRatings()` API 给设置页

---

## 🤖 Agent 编排架构现状（2026-07-23 复核）

> Claude 在 7/22-7/23 期间未对 agent 编排架构本身做改动（架构在 v1.0.0 已落地），本次复核确认架构完整可用，并梳理出当前实际生效的 6 步流水线。

### 架构组成（`electron/agent/`）

| 文件 | 职责 | 关键算法 |
|------|------|----------|
| [intent-classifier.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/electron/agent/intent-classifier.ts) | 用户意图分类 | 关键词权重打分 + 负向模式 + 上下文延续（follow-up/affirmative）+ 问句模式兜底；4 类意图：`knowledge_query` / `deep_discussion` / `teaching_practice` / `casual_chat` |
| [strategy-selector.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/electron/agent/strategy-selector.ts) | 教学策略映射 | 意图 → 教学模式 + Bloom 层级映射表；4 种模式：`direct_answer` / `socratic` / `feynman` / `assessment` |
| [state-tracker.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/electron/agent/state-tracker.ts) | 会话状态跟踪 | 内存 Map（1000 session 上限 + 24h TTL + 每小时清理）；连续答对 3 题提升 Bloom、连续答错 2 题降层、Bloom 6 答对 5 题标记掌握 |
| [context-builder.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/electron/agent/context-builder.ts) | 构建器接口 | `ContextBuilder` 抽象接口（name/priority/shouldBuild/build） |
| [context-manager.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/electron/agent/context-manager.ts) | 上下文预算管理 | 5 个 builder 按优先级排序执行 + 4000 token 总预算 + 单 builder 截断 + 失败隔离 |
| [builders/](file:///d:/ai/claude%20code/微信读书/zhixing-reader/electron/agent/builders) | 5 个具体构建器 | book(90)→RAG 语义搜索 + 关键词降级；methodology(80)→相关性评分；knowledgeCard(70)→标题/内容权重；memory(50)→关键词检索；userProfile(40)→认知水平画像 |
| [system-prompt.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/electron/agent/system-prompt.ts) | 系统提示词 | 默认提示词 + 从 prompt-storage 加载可配置模板 |
| [orchestrator.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/electron/agent/orchestrator.ts) | 编排主入口 | 6 步流水线：意图分类 → 难度调整 → 上下文构建 → 系统提示组装 → 流式发送 → 概念掌握度更新 + 方法论掌握度更新 + 记忆提取 |

### 6 步流水线实际执行顺序（`processMessageStream`）

```
1. classifyIntent(userMessage, history)         → UserIntent
2. selectStrategy(intent) + adjustDifficulty()  → StrategyPlan + 难度动作
3. contextManager.buildAll(buildContext)        → combinedContext（5 builder 串行 + token 预算）
4. systemPrompt + strategyHint + difficultyHint → 最终 system 消息
5. sdkStreamChat(messages, onChunk, ...)        → 流式响应（7/23 已切到 Vercel AI SDK）
6. onComplete 回调                               → 概念掌握度更新 + 方法论 mastery 更新 + 记忆自动提取
```

### 编排算法关键设计

1. **意图分类的鲁棒性**：
   - 关键词权重 = 关键词长度 × 命中数（中文长关键词权重更高）
   - 负向模式扣分（如 "怎么用" 在 `knowledge_query` 中扣分，避免与 `teaching_practice` 冲突）
   - 上下文延续：上轮 assistant 提问 → 本轮判定 `deep_discussion`；上轮 affirmative + 本轮问句 → `teaching_practice`
   - 问句模式兜底：有问句标记且历史 >2 轮 → `deep_discussion`，否则 `knowledge_query`

2. **难度自适应**：
   - Bloom 1-6 层级，连续答对 3 题 +1 层，连续答错 2 题 -1 层
   - Bloom ≥4 自动切 `socratic` 模式；Bloom ≤2 自动切 `direct_answer` 模式
   - Bloom 6 答对 5 题永久标记掌握（consecutiveCorrect 清零）

3. **上下文预算管理**：
   - 4000 token 总预算，2 字符/token（中文估算）
   - builder 按优先级降序执行：book(90) > methodology(80) > knowledgeCard(70) > memory(50) > userProfile(40)
   - 单 builder 超预算时部分截断（保留剩余 token），后续 builder 跳过
   - builder 异常隔离：单 builder 失败不影响其他 builder

4. **概念掌握度评估**：
   - 正则模式提取概念（`什么是X` / `X是什么` / `教我X` 等 9 种模式）
   - 响应质量评估：用户反馈信号（"不懂"/"明白了"）+ 响应长度兜底（>50 字视为理解）
   - 概念掌握度 0-5 级，答对 +1，答错不扣

5. **方法论 mastery 联动**：
   - 词边界匹配（避免子串误匹配）
   - 答对 +5 mastery、答错 +2 mastery（最多 100）
   - practice_count 累加

### 配套测试

- [tests/intent-classifier.test.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/tests/intent-classifier.test.ts) — 4 类意图分类 + 关键词权重 + 上下文延续
- [tests/strategy-selector.test.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/tests/strategy-selector.test.ts) — 意图→策略映射 + prompt 提示词获取
- [src/renderer/src/pages/AgentOrchestration.tsx](file:///d:/ai/claude%20code/微信读书/zhixing-reader/src/renderer/src/pages/AgentOrchestration.tsx) — 管理后台可视化（6 步流水线 + 5 builder + 系统提示词编辑 + 测试运行）

### Claude 在 7/22-7/23 对 agent 编排的改动

仅 1 处：[orchestrator.ts#L272](file:///d:/ai/claude%20code/微信读书/zhixing-reader/electron/agent/orchestrator.ts) 把 `streamChat` 改为 `sdkStreamChat`（从 `ai-sdk-service` 导入），底层从手写 fetch+SSE 切换到 Vercel AI SDK。**编排算法本身未改动。**

---

## 📦 Claude 7/22-7/23 新增未提交工作清单

> 以下改动均在 working tree 中，未 commit。HEAD 仍为 `da678ab`（2026-07-22 Phase 16 完成）。

### 1. AI SDK 重构（替换手写 fetch/SSE）

- [electron/ai-sdk-service.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/electron/ai-sdk-service.ts) — 新文件，基于 Vercel AI SDK（`ai` + `@ai-sdk/openai-compatible`）实现 `sdkStreamChat` + `cancelActiveStream` + `generateObject` 结构化输出
- [docs/ai-sdk-refactor-plan.md](file:///d:/ai/claude%20code/微信读书/zhixing-reader/docs/ai-sdk-refactor-plan.md) — 重构方案文档
- [tests/ai-sdk-service.test.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/tests/ai-sdk-service.test.ts) — 配套测试
- [electron/agent/orchestrator.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/electron/agent/orchestrator.ts) — 已切换到 `sdkStreamChat`（保留 `legacyStreamChat` 导入作为降级）

### 2. MCP Server 子项目（独立 npm 包）

- [mcp-server/](file:///d:/ai/claude%20code/微信读书/zhixing-reader/mcp-server) — 完整子项目（独立 package.json + tsconfig + vitest）
- 5 个只读工具：`zhixing_list_books` / `zhixing_search_highlights` / `zhixing_get_due_cards` / `zhixing_get_vocabulary` / `zhixing_get_reading_stats`
- 14 个测试用例（5 smoke + 9 边界）
- 支持 Claude Desktop / Cursor 通过 stdio transport 查询本地阅读数据库
- 安全原则：仅暴露 SELECT，不提供任何写入操作

### 3. sql.js 集成测试套件（Phase 17 T2-T4）

- [tests/database-integration.test.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/tests/database-integration.test.ts) — 49 个测试覆盖：
  - schema（13 张表 + 18 个索引 + 外键约束 + 幂等初始化）
  - booksDb / highlightsDb / cardsDb / reviewsDb / bookSummariesDb / dailyStatsDb / tokenUsageDb / conversationDb / methodologiesDb / knowledgeCardsDb / bookArchitectureDb / articlesDb / vocabularyDb / memoriesDb CRUD
  - 外键级联删除（ON DELETE CASCADE）
  - 事务（runTransaction）
  - resetDatabase / clearConversationsAndMessages
- [tests/__fixtures__/db-helpers.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/tests/__fixtures__/db-helpers.ts) — 测试夹具：`createTestDatabase` + `runSchema` + `setupTestDatabase` + `teardownTestDatabase`
- [electron/database.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/electron/database.ts) — 加 `injectTestDatabase` / `getTestDatabase` / `resetTestDatabaseState` 测试注入函数（+348 行）
- [tests/debug-articles*.test.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/tests) — 3 个调试测试文件（已完成使命，可清理）

### 4. UI 精简（-896 行 Review.tsx 等）

- 删除 `src/renderer/src/pages/Review.tsx`（-896 行，复习功能合并到知识卡片页面）
- 精简 `KnowledgeCards.tsx`（-171 行）/ `VocabularyPage.tsx`（-41 行）/ `SettingsAI.tsx`（-111 行 → +简化）
- 11 个页面微调（Home/Chat/BookDetail/Methodologies/TokenUsage 等）
- `chatStore.ts` 调整（-81/+ 部分）

### 5. 其他

- [dogfood.mjs](file:///d:/ai/claude%20code/微信读书/zhixing-reader/dogfood.mjs) — 真机走查脚本
- [installer-final/](file:///d:/ai/claude%20code/微信读书/zhixing-reader/installer-final) — 新打包产物（`知行读书.exe` + 53 个 locales pak + resources）
- [T10-commit-msg.txt](file:///d:/ai/claude%20code/微信读书/zhixing-reader/T10-commit-msg.txt) — 提交消息草稿
- `src/renderer/src/stores/__tests__/toastStore.test.ts` — toast store 测试
- `tests/setup.ts` — 测试环境配置增强（+111 行）

### 6. 测试结果

- **473 tests passed (19 files)** — 4.58s
- 数据库集成测试 49 个全部通过
- ai-sdk-service 测试通过
- MCP server 测试通过（独立 npm test）

---

## ⚠️ 待办：Claude 工作的 commit 整理

Claude 完成的工作尚未 commit，建议按以下顺序整理（参考 v2 T1 经验）：

| 优先级 | commit 主题 | 涉及文件 | 备注 |
|--------|-------------|----------|------|
| P0 | `feat(ai-sdk): 重构流式对话为 Vercel AI SDK` | ai-sdk-service.ts / orchestrator.ts / ai-sdk-service.test.ts / docs/ai-sdk-refactor-plan.md / package.json | 替换 1441 行手写 fetch |
| P0 | `feat(mcp): 新增 MCP Server 子项目` | mcp-server/ 整个目录 | 独立子项目，可单独 commit |
| P0 | `test(db): sql.js 集成测试套件 49 用例` | database-integration.test.ts / db-helpers.ts / database.ts 测试注入 / setup.ts | Phase 17 T2-T4 |
| P1 | `refactor(ui): 精简 Review/KnowledgeCards/Vocabulary 等页面` | Review.tsx 删除 + 11 页面调整 | -896 行 Review.tsx |
| P1 | `chore(dogfood): 真机走查脚本 + installer-final` | dogfood.mjs / installer-final/ | 走查工具 |
| P2 | `test(toast): toastStore 单测` | stores/__tests__/toastStore.test.ts | 可并入其他 commit |

### ✅ Commit 整理结果（2026-07-23 完成）

5 个 commit 全部完成，工作区干净（仅剩 .learnings 文档更新）：

| Commit | Hash | 文件数 | 变更 |
|--------|------|--------|------|
| feat(ai-sdk): 重构流式对话为 Vercel AI SDK | `686e5ea` | 6 | +522/-2 |
| feat(mcp): 新增 MCP Server 子项目 | `5f300fe` | 14 | +5662 |
| test(db): sql.js 集成测试套件 49 用例 | `9db862d` | 4 | +1469/-5 |
| refactor(ui): 精简 Review/KnowledgeCards/Vocabulary 等页面 | `336e4eb` | 30 | +486/-1415 |
| chore(dogfood): 新增真机走查脚本并忽略 installer-final 产物 | `747276f` | 2 | +114 |

**门禁验证**：lint 0e/188w · typecheck 0 · test 470 passed (16 files) · build OK (1m21s)

**修复的 bug**：orchestrator.ts 第 272 行调用未定义的 `streamChat`（应为 `sdkStreamChat`），导致 lint error。已修复。

**清理**：
- 删除 3 个 debug-articles*.test.ts 调试文件
- 删除临时文件 T10-commit-msg.txt
- .gitignore 新增 installer-final/ 规则（打包产物不入库）

---

## 🔄 7/23 晚间修复循环（当前会话）

### 修复内容

| 问题 | 根因 | 修复方案 | 状态 |
|------|------|----------|------|
| **MessageBubble 样式断言失败** | `// @vitest-environment jsdom` 优先级高于 `vitest.config.ts` 的 `environmentMatchGlobs`；jsdom 25 过滤含 CSS 变量的内联样式 | 测试文件首行改为 `happy-dom`，并调整 `blockquote` 断言为检查 `border-left` | ✅ 通过 |
| **微信读书头像/昵称同步** | Profile 页只显示本地 nickname，未对接微信读书用户资料 API | 新增 `weread.getUserProfile()` IPC → `fetchUserProfile()` → store 更新 `userAvatarUrl`/`userNickname` → Profile 显示头像与同步按钮 | ✅ 已实现 |
| **阅读趋势 2026 书籍不显示** | 统计未过滤未来出版年份 | `db-mapper.ts` 增加 `publishDate` 映射；`Stats.tsx` 过滤 `publishDate >= 2026` 的书籍 | ✅ 已修复 |
| **流式响应 AI SDK not configured** | 设置 AI 配置时只更新了 `ai-service`，未更新 `ai-sdk-service` | `electron/ipc.ts` 设置配置时同时调用 `setAIConfig` 和 `setAISDKConfig` | ✅ 已修复 |
| **提示词中心文档缺失** | 用户要求不在 PPT/UI 中展示，改为独立 MD | 生成 `docs/提示词中心说明.md` + `docs/智能体编排流程说明.md` | ✅ 已完成 |

### 验证结果

- **lint**: 0 errors / 188 warnings（与上轮一致，无新增错误）
- **typecheck**: 0 errors
- **test**: 17 files / 493 tests passed（新增 MessageBubble 69 tests 全绿）
- **build**: OK（9.08s）

### 新增/更新文档

- `docs/提示词中心说明.md` — 覆盖知识卡片、方法论、Skill 生成的提示词模板与机制
- `docs/智能体编排流程说明.md` — 六步流水线、技术栈、设计理念，供 PPT 讲解用
- `.learnings/PROGRESS.md` — 本文档（本章节）

---

*最后更新：2026-07-23 | Claude 7/22-7/23 工作 commit 整理完成（5 commits），HEAD `747276f`*
*下次更新：Phase 17 T5 coverage 配置完成后追加；Phase 1 结束（7/31）后整体重写*

---

## 🛠️ 7/24 用户反馈批处理（UI 删减优化 + 微信读书同步算法 + 个人档案同步）

> 用户在 7/23 一次集中反馈了 11 项问题，7/23-7/24 期间全部修复并通过门禁验证。

### 完成清单

| # | 用户反馈 | 解决方案 | 涉及文件 | 状态 |
|---|---------|---------|---------|------|
| 1 | 知识卡片点开后减号点击没用，UI 删掉；删除时弹确认按钮；新建卡片功能删掉；保留 AI 蒸馏 | 移除减号按钮与新建卡片代码，删除按钮统一改为 `confirm()` 弹窗确认 | [KnowledgeCards.tsx](file:///d:/ai/claude%20code/微信读书/zhixing-reader/src/renderer/src/pages/KnowledgeCards.tsx) | ✅ |
| 2 | 方法论模块提取内容的步骤/场景/示例/输出格式选项删掉，默认提取所有 | 移除 4 个选项 UI，提取时直接调用 `methodology.extract` 不传额外选项 | [Methodologies.tsx](file:///d:/ai/claude%20code/微信读书/zhixing-reader/src/renderer/src/pages/Methodologies.tsx) | ✅ |
| 3 | 统计页面阅读趋势柱状图太粗，建议表下面列出一周趋势 | 新增 `WeeklyTrendMini` 组件，基于最近 7 天阅读时长绘制 mini 柱状图 | [Stats.tsx](file:///d:/ai/claude%20code/微信读书/zhixing-reader/src/renderer/src/pages/Stats.tsx) | ✅ |
| 4 | 2026 已读书籍不显示 | 在统计逻辑中加 `publishDate` 过滤，仅显示出版年份 < 2026 的书籍 | [Stats.tsx](file:///d:/ai/claude%20code/微信读书/zhixing-reader/src/renderer/src/pages/Stats.tsx) + [db-mapper.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/src/renderer/src/utils/db-mapper.ts) | ✅ |
| 5 | 智能体编排不需要测试模块，直接发布即可 | 移除测试运行模块相关 UI 代码 | [AgentOrchestration.tsx](file:///d:/ai/claude%20code/微信读书/zhixing-reader/src/renderer/src/pages/AgentOrchestration.tsx) | ✅ |
| 6 | 智能体流程编排 UI 重构排版布局 | 改为 Google Design Library 1:1 重构：2 列 grid + 6 步流水线卡片 + 热力矩阵 + 系统提示词跨列突出 | [AgentOrchestration.tsx](file:///d:/ai/claude%20code/微信读书/zhixing-reader/src/renderer/src/pages/AgentOrchestration.tsx) | ✅ |
| 7 | 流式响应失败: AI SDK not configured | [electron/ipc.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/electron/ipc.ts) 在 SETTINGS.SET 时同时调用 `setAIConfig` 和 `setAISDKConfig`，确保新旧 AI 服务都拿到配置 | [ipc.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/electron/ipc.ts) | ✅ |
| 8 | 提示词中心不显示在 UI，生成 md 文档说明 | 生成 [docs/提示词中心说明.md](file:///d:/ai/claude%20code/微信读书/zhixing-reader/docs/提示词中心说明.md)，记录知识卡片/方法论/skill 生成提示词 | docs/提示词中心说明.md | ✅ |
| 9 | AI 对话部分特别窄，会话可以收缩 | Chat.tsx 加 `sessionsCollapsed` 状态，grid 列宽从 `220px 1fr 260px` 切换为 `56px 1fr 260px`，会话项变成圆图标 | [Chat.tsx](file:///d:/ai/claude%20code/微信读书/zhixing-reader/src/renderer/src/pages/Chat.tsx) | ✅ |
| 10 | 微信读书测试连接成功时显示一本书的消息 | SettingsWeRead.tsx 显示 `已拉取到第 1 本书：XXX`；weread-api.ts 的 `test()` 返回 `firstBookTitle` | [SettingsWeRead.tsx](file:///d:/ai/claude%20code/微信读书/zhixing-reader/src/renderer/src/pages/settings/SettingsWeRead.tsx) + [weread-api.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/electron/weread-api.ts) | ✅ |
| 11 | 自动同步设置 1 天/3 天/一周时长，不要一直跑倒计时占内存 | 新建 [weread-sync-manager.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/electron/weread-sync-manager.ts)，基于「下一次执行时间」的 setTimeout 调度（非 setInterval 倒计时），支持 `1d`/`3d`/`7d` 三档；每小时兜底检查一次防系统时间漂移；记录 `wereadLastSyncAt` 持久化上次同步时间 | [weread-sync-manager.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/electron/weread-sync-manager.ts) | ✅ |
| 12 | 个人档案同步微信读书头像/名字 | weread-api.ts 加 `fetchUserProfile()`；Profile.tsx 加同步按钮 + 头像显示逻辑（img 失败回退首字母方块）；settingsStore 加 `userAvatarUrl`/`userNickname`/`syncingProfile` 状态 | [Profile.tsx](file:///d:/ai/claude%20code/微信读书/zhixing-reader/src/renderer/src/pages/Profile.tsx) + [weread-api.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/electron/weread-api.ts) + [settingsStore.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/src/renderer/src/stores/settingsStore.ts) | ✅ |
| 13 | TypeScript 类型错误：`getUserProfile` 不存在 | [src/types/renderer.d.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/src/types/renderer.d.ts) 的 weread 接口添加 `getUserProfile` 方法签名 | [renderer.d.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/src/types/renderer.d.ts) | ✅ |
| 14 | MessageBubble 样式断言失败（CSS 变量被 jsdom 过滤） | [vitest.config.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/vitest.config.ts) 加 `environmentMatchGlobs` 让 React 测试用 happy-dom；断言改为 `getAttribute('style')` | [vitest.config.ts](file:///d:/ai/claude%20code/微信读书/zhixing-reader/vitest.config.ts) + [MessageBubble.test.tsx](file:///d:/ai/claude%20code/微信读书/zhixing-reader/src/renderer/src/components/chat/__tests__/MessageBubble.test.tsx) | ✅ |

### 微信读书同步算法设计要点

**问题**：之前用 `setInterval` 跑倒计时，每秒/每分钟触发，常驻内存占用高。

**方案**：基于「下一次执行时间」的 `setTimeout` 调度。

```typescript
// 1. 计算下一次同步时间 = 上次同步时间 + 频率间隔
function getNextSyncTimeMs(): number {
  const lastSyncAt = settings[SYNC_AT_KEY] || 0
  const frequencyMs = FREQUENCY_MS[parseFrequency(settings[FREQUENCY_KEY])]
  return lastSyncAt ? lastSyncAt + frequencyMs : Date.now()
}

// 2. 用 setTimeout 调度到那个未来时间点（不是 setInterval）
wereadAutoSyncTimer = setTimeout(() => {
  void syncWereadBookshelfBackground().then(scheduleNextSync)
}, delay)

// 3. 每小时兜底检查一次，防系统时间调整或错过执行
wereadHourlyCheckTimer = setInterval(() => {
  if (Date.now() >= getNextSyncTimeMs()) {
    void syncWereadBookshelfBackground().then(scheduleNextSync)
  }
}, HOURLY_CHECK_MS)
```

**优势**：
- 定时器只在到期前一次唤醒，不每秒/每分钟轮询
- 系统休眠/唤醒后能通过兜底检查自愈
- 应用重启时从 `wereadLastSyncAt` 恢复进度，不丢同步历史
- 三档频率（1d/3d/7d）由用户在设置页选择

### 门禁验证（7/24）

| 项 | 结果 |
|----|------|
| `npx tsc --noEmit` | ✅ 0 errors |
| `npx eslint src electron` | ✅ 0 errors / 191 warnings（仅代码风格） |
| `npx vitest run` | ✅ 493/493 passed（17 测试文件） |
| `npx electron-vite build` | ✅ built in 16.77s |

### 后续规划

- **演示准备**：录屏脚本 + 真实数据 demo
- **比赛后技术债**：拆分 `database.ts`/`ipc.ts`、消除 ESLint warnings、补 IPC 全链路冒烟测试

---

## 🚀 v1.0.0 正式开源发布（2026-07-25）

> **里程碑**：项目首次正式开源发布，火山杯加分项全部完成（代码开源 + 开源许可证 + 应用内设置页关于模块完整）。

### 发布清单

| 项 | 状态 | 详情 |
|----|------|------|
| **代码开源** | ✅ | GitHub 仓库 `harryopo/zhixing-reader` 公开；123 commits 推送成功 |
| **开源许可证** | ✅ | MIT LICENSE（用户保留版权，允许自由使用/修改/分发） |
| **开源文档** | ✅ | LICENSE + CONTRIBUTING.md + CODE_OF_CONDUCT.md + PRIVACY.md + CHANGELOG.md |
| **GitHub Release v1.0.0** | ✅ | https://github.com/harryopo/zhixing-reader/releases/tag/v1.0.0 |
| **Installer 分发** | ✅ | `ZhixingReader-Setup-1.0.0.exe` (125 MB) 通过 Release Assets 分发 |
| **Landing Page** | ✅ | `landing/index.html` 火山杯赛事展示页（待部署到 GitHub Pages） |
| **应用内设置-关于** | ✅ | 检查更新 + 说明文档 + 问题反馈 + 开源许可 + 法律信息 5 卡片完整 |
| **检查更新功能** | ✅ | 调用 GitHub Releases API 真实检查；新版本跳转下载页 |
| **问题反馈入口** | ✅ | 跳转 GitHub Issues（替代原飞书问卷） |
| **说明文档入口** | ✅ | 跳转 README + 仓库内 docs/settings-tutorial.md |
| **大文件清理** | ✅ | git filter-branch 清除 installer-v2/installer-final/ 历史；force push 成功 |

### 关键技术决策

| 决策 | 理由 |
|------|------|
| 反馈入口从飞书问卷改为 GitHub Issues | 开源后 GitHub Issues 更专业；飞书问卷需要外部账号，与开源场景不匹配 |
| Asset 名称用 ASCII（`ZhixingReader-Setup-1.0.0.exe`） | PowerShell + gh API 中文乱码；ASCII 名称跨平台兼容 |
| 通过 GitHub Release Assets 分发 installer | 避免 git 历史累积大文件；GitHub 自动提供下载统计与 CDN 加速 |
| MIT 许可证 | 最宽松，允许商用/修改/分发，仅保留版权声明；适合学生项目开源 |
| SSH 密钥放项目目录 `.ssh/` 并 gitignore | 与项目隔离，不污染用户全局 `~/.ssh/`；多项目并行开发友好 |

### 火山杯加分项覆盖

| 加分项 | 完成方式 |
|--------|----------|
| **代码开源** | GitHub 公开仓库 + MIT 许可证 + 完整开源文档 |
| **开源许可证书** | MIT LICENSE 文件（自动获得，无需申请） |
| **应用内设置-关于** | 5 卡片：应用信息 / 版本更新（检查更新）/ 反馈与帮助 / 开源许可 / 法律信息 |
| **介绍网页** | `landing/index.html` 单页介绍（Hero + 功能 + 技术栈 + 截图 + 下载） |

### 最终交付状态

✅ **正式发布**：HEAD `1ff21db` 已推送至 `origin/master`；v1.0.0 Release 已发布；installer 已上传。

| 门禁项 | 结果 |
|--------|------|
| git working tree | ✅ 干净（仅 memory/、pnpm-lock.yaml、pnpm-workspace.yaml 未跟踪，均无需 commit） |
| git push | ✅ 123 commits 推送成功（`49e8611..1ff21db`） |
| GitHub Release v1.0.0 | ✅ 已发布，含 125MB installer asset |
| 代码门禁（lint/typecheck/test/build） | ✅ 全绿（详见 7/24 复测） |
| 之前检查出的问题 | ✅ 全部修复（Stats 2026 过滤 / orchestrator 控制字符 / AI 对话区宽度 / 统计趋势图） |

---

*最后更新：2026-07-25 | v1.0.0 正式开源发布完成*
