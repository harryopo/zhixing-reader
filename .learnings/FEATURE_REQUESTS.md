# Feature Requests

知行读书项目功能需求记录。

> **最近更新**：2026-07-20 — 追加 8 条 5-7 月新增功能（FEAT-20260614-001 ~ FEAT-20260720-005）
> **历史归档**：2026-05-29 共 4 条原始功能（FEAT-20260529-001 ~ 004）

---

## [FEAT-20260529-001] api-config

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Requested Capability
API 配置的持久化和自动加载

### User Context
用户需要保存微信读书 API Key 和 AI 服务配置，重启应用后自动生效。

### Complexity Estimate
medium

### Suggested Implementation
1. 使用 settings.json 存储配置
2. 应用启动时加载配置到内存
3. 保存时同步更新文件和内存

### Metadata
- Frequency: recurring
- Related Features: 设置页面、API 测试

---

## [FEAT-20260529-002] custom-ai

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Requested Capability
支持自定义 AI 服务提供商

### User Context
用户不想局限于 OpenAI/Anthropic，需要支持任何兼容 OpenAI 接口的服务（如 DeepSeek、通义千问、Ollama 等）。

### Complexity Estimate
simple

### Suggested Implementation
1. 移除 OpenAI/Anthropic 预设按钮
2. 只保留自定义配置输入框
3. 输入框使用浅色 placeholder 示例

### Metadata
- Frequency: first_time
- Related Features: AI 服务配置

---

## [FEAT-20260529-003] toast-notification

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: frontend

### Requested Capability
Toast 通知系统

### User Context
需要在操作成功/失败时显示友好的提示信息。

### Complexity Estimate
medium

### Suggested Implementation
1. 创建全局 toast store (Zustand)
2. 创建 Toast UI 组件
3. 支持 success/error/warning/info/loading 类型

### Metadata
- Frequency: first_time
- Related Features: 所有操作反馈

---

## [FEAT-20260529-004] port-config

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: config

### Requested Capability
避免端口冲突

### User Context
用户同时开发多个项目，需要避免端口占用。

### Complexity Estimate
simple

### Suggested Implementation
1. 修改 electron.vite.config.ts 设置 renderer 端口
2. 修改 main.ts 使用环境变量或默认端口

### Metadata
- Frequency: first_time
- Related Features: 开发环境配置

---

## [FEAT-20260614-001] rss-daily-learning

**Logged**: 2026-06-14T20:30:00+08:00
**Priority**: high
**Status**: resolved
**Area**: feature

### Requested Capability
每日学习模块：RSS 抓取 + 中英对照阅读 + 悬停查词 + 生词本

### User Context
用户希望在主应用内阅读精选英文文章（心理学/认知科学/自我提升），同时积累生词。需要中英对照（不是分开两栏），每段可独立点击显示翻译，悬停查词自动加入生词本。

### Complexity Estimate
complex

### Suggested Implementation
1. RSS fetcher：10 个 RSS 源（CET-4/CET-6/Postgraduate 三档）
2. 翻译管道：抓取后异步翻译存入数据库
3. UI：双列布局（左英右中，垂直对齐），每段独立翻译开关
4. 悬停查词：本地 ECDICT 词典（59k 词条，13.6MB JSON）
5. 词形还原：deriveBaseForm 支持 -ies→-y / -ves→-f / -ing / -ed 等
6. 右键加生词：首次访问 1.5s 引导 + localStorage 记忆

### Metadata
- Frequency: first_time
- Related Features: 生词本、复习系统、AI 智能体
- Files: electron/rss-fetcher.ts, electron/dictionary-service.ts, src/renderer/src/pages/DailyLearning.tsx

---

## [FEAT-20260620-001] fsrs-sm2-learning-stages

**Logged**: 2026-06-20T15:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: algorithm

### Requested Capability
FSRS 复习算法优化：学习阶段 + ease hell 防护

### User Context
原 SM-2 算法答错时直接重置导致"ease hell"（用户越复习越觉得难）。需要 Anki 风格学习阶段（0=新词/1=学习中/2=复习中），答错时进入 10 分钟重新学习而非完全重置。

### Complexity Estimate
medium

### Suggested Implementation
1. 增加 `learning_stage` 字段（0/1/2）
2. 答错时：`interval = max(current * 0.1, 1)` + 阶段-1 + 10min relearn
3. `learningSteps` 数组管理 1min/10min 重学间隔
4. 测试覆盖：18 个 FSRS 单元测试

### Metadata
- Frequency: first_time
- Related Features: 复习系统、知识卡片
- Files: electron/fsrs-engine.ts, tests/fsrs-engine.test.ts

---

## [FEAT-20260625-001] knowledge-card-distill

**Logged**: 2026-06-25T10:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: feature

### Requested Capability
知识卡片蒸馏：从用户划线/笔记中自动提取概念/方法论/金句

### User Context
用户已有大量划线和笔记，但很少主动整理。AI 智能体应能基于用户的划线/笔记自动生成知识卡片（不是基于全书），卡片包含标题+内容+标签，释义和应用按需生成以节省 token。

### Complexity Estimate
complex

### Suggested Implementation
1. 蒸馏 prompt：明确"这是用户自己的划线/笔记，不是全书内容"
2. 三种类型卡片：concept / methodology / golden-sentence
3. 输出字段：title + content + tags（释义/应用按需生成）
4. KnowledgeCardService 单例管理并发任务（activeTasks Map，30min TTL + 5min 清理）
5. 蒸馏入口：始终可见（不被已有卡片/筛选条件隐藏）
6. 卡片详情：正面 title+content；背面 content+释义+应用+标签+来源"来自笔记"
7. 测试：KnowledgeCardService 单测

### Metadata
- Frequency: first_time
- Related Features: 知识库、AI 智能体、复习系统
- Files: electron/services/knowledge-card-service.ts, electron/services/prompt-registry.ts, src/renderer/src/pages/KnowledgeCards.tsx

---

## [FEAT-20260701-001] methodology-auto-inject

**Logged**: 2026-07-01T14:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: feature

### Requested Capability
方法论自动注入智能体：orchestrator 自动加载当前书籍的方法论和知识卡片

### User Context
用户在 AI 对话中引用方法论时，智能体应该"知道"该方法论的内容，而不是泛泛而谈。同时智能体回复引用方法论时自动更新 mastery_level (+5/次) 和 practice_count (+1/次)，形成闭环。

### Complexity Estimate
medium

### Suggested Implementation
1. orchestrator.ts 在构建 systemPrompt 时自动加载当前书籍的 methodologies 和 knowledge_cards
2. prompt 模板注入方法论摘要 + 引用规则
3. 引用检测：回复中包含方法论标题时 +5 mastery / +1 practice
4. 避免上下文双重注入（之前 combinedContext 同时注入 system 和 user 导致 token 翻倍）
5. db-mapper.ts 增加 mapMethodology / mapMethodologies 处理字段映射
6. safeParseJSON 处理 JSON 字段解析失败

### Metadata
- Frequency: first_time
- Related Features: AI 智能体、方法论管理
- Files: electron/agent/orchestrator.ts, electron/utils/db-mapper.ts

---

## [FEAT-20260710-001] admin-page

**Logged**: 2026-07-10T11:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: feature

### Requested Capability
智能体管理后台：Dashboard / AgentConfig / KnowledgeBase / SessionHistory

### User Context
需要给管理员（开发者/高级用户）一个集中管理 AI 智能体、查看会话历史、浏览知识库、监控系统状态的入口。路由 `/admin`，使用盾牌图标。

### Complexity Estimate
medium

### Suggested Implementation
1. 路由 `/admin` 接入 React Router
2. Sidebar.tsx navItems 添加 `path='/admin', label='智能体管理', icon=Shield`
3. preload.ts 同步暴露 `admin.*` 命名空间
4. 4 个 Tab：Dashboard（统计）/ AgentConfig（提示词管理）/ KnowledgeBase（知识库浏览）/ SessionHistory（会话历史）
5. lazy() + Suspense 按需加载（AdminPage 862KB 较大）
6. PromptCenter：提示词可视化编辑 + 即时预览

### Metadata
- Frequency: first_time
- Related Features: AI 智能体、知识库
- Files: src/renderer/src/pages/admin/*, src/renderer/src/components/Sidebar.tsx, electron/preload.ts

---

## [FEAT-20260715-001] stream-chat-cancel

**Logged**: 2026-07-15T16:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: feature

### Requested Capability
AI 流式对话支持外部取消（AbortSignal）

### User Context
长任务（知识卡片蒸馏、大批量生成）时用户可能想取消。前端需要一个"取消"按钮，发送 AbortSignal 到主进程立即停止 API 调用，避免资源浪费。

### Complexity Estimate
medium

### Suggested Implementation
1. AI service 接受 `CallOptions { signal?: AbortSignal }`
2. `fetchWithRetry` 接受 `externalSignal` 参数
3. AbortController 超时抛 HttpAbortError(cause: timeout/cancelled/unknown)
4. 错误分类：cancelled / timeout / network / empty / import / parse / config
5. 前端友好提示按错误类型显示

### Metadata
- Frequency: first_time
- Related Features: AI 智能体、知识卡片蒸馏
- Files: electron/ai-service.ts, electron/http-client.ts, src/renderer/src/stores/chatStore.ts

---

## [FEAT-20260720-001] ai-dev-workflow

**Logged**: 2026-07-20T09:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tooling

### Requested Capability
ai-dev-workflow 6 阶段开发规范落地

### User Context
当前项目开发流程不规范（想到哪改到哪），缺乏质量门禁、自动化检查、知识沉淀。引入 ai-dev-workflow 6 阶段流程（需求→设计→脚手架→编码→门禁→沉淀）提升效率和代码质量。

### Complexity Estimate
complex

### Suggested Implementation
1. 12 步流程：基线→STANDARDS→rules→agents→eslint→deps→vitest→CI→AGENTS→verify→8 commits→归档
2. 输出物：
   - `.learnings/STANDARDS.md`（15 条硬规则 + 自检清单）
   - `.learnings/{ERRORS,LEARNINGS,FEATURE_REQUESTS,PROGRESS}.md`
   - `.claude/rules/{code-style,security,git}.md`
   - `.claude/agents/{code-reviewer,test-writer}.md`
   - `.claude/ownership.yaml`（Sub-agent 文件所有权）
   - `AGENTS.md` + `CLAUDE.md`（项目入口）
   - `.github/workflows/ci.yml`（自动化门禁）
   - `eslint.config.js`（规则分级）
   - `scripts/fix-unused-vars.mjs`（自动修复）
   - `tests/fsrs-engine.test.ts`（18 个测试）
3. 验证：`npm run verify` 0 errors / 18 tests / build 成功
4. 8 个独立 commit，每个单一关注点

### Metadata
- Frequency: first_time
- Related Features: 全部
- Files: 详见 .learnings/PROGRESS.md 关键指标

---

## [FEAT-20260720-002] codegraph-knowledge-graph

**Logged**: 2026-07-20T10:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tooling

### Requested Capability
CodeGraph 本地代码知识图谱（auto-sync 增量更新）

### User Context
代码量增加后 SubAgent 启动时缺乏代码结构上下文，每次都要重新探索。建本地知识图谱让 SubAgent 启动时直接拿到入口点 + 相关符号。

### Complexity Estimate
medium

### Suggested Implementation
1. 一次性建图：100 文件 / 1,451 节点 / 4,645 边 / 1.3s
2. 默认 auto-sync 开启，文件改动 2s 防抖后增量更新
3. `.codegraph/` 加入 `.gitignore`
4. 提供 10 个工具：search / context / trace / callers / callees / impact / node / explore / files / status
5. SubAgent 启动时首选 `codegraph_context`

### Metadata
- Frequency: first_time
- Related Features: 开发体验
- Files: .codegraph/ (gitignored)

---

## [FEAT-20260720-003] safe-storage-encryption

**Logged**: 2026-07-20T11:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: security

### Requested Capability
API Key 等敏感信息使用 Electron safeStorage 加密存储

### User Context
之前 API Key 明文存 settings.json 存在安全隐患。应使用 Electron safeStorage 加密，目录在 `%APPDATA%/zhixing-reader/secure/`。

### Complexity Estimate
medium

### Suggested Implementation
1. SettingsService 单例模式 + getInstance()
2. 统一 get/set/getAll 方法
3. safeStorage.encryptString 加密 API Key
4. safeStorage.isEncryptionAvailable() 检测，不可用时降级到 settings.json
5. 数据库工具函数 rowsToObjects 统一在 electron/utils/db.ts

### Metadata
- Frequency: first_time
- Related Features: 配置管理、安全
- Files: electron/services/settings-service.ts, electron/utils/db.ts

---
