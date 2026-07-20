# 知行读书 — 项目进度与规划

## 📊 当前进度（截至 2026-07-20）

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

### 🔄 进行中

| 功能 | 进度 | 备注 |
|------|------|------|
| 验证门禁持续运行 | 持续 | verify = lint + typecheck + test + build，0 errors / 124 warns / 171 tests pass（FSRS 38 + http-client 11 + prompt-registry 42 + template-engine 18 + admin-charts 6 + ipc 2 + intent-classifier 19 + strategy-selector 13 + dictionary-service 16 + ai-service-config 6）|
| CodeGraph 知识图谱 | 已建图 | 100 文件 / 1,451 节点 / 4,645 边，1.3s 增量同步 |
| 比赛展示打磨 | 35% | 7/20-7/31：smoke test 第 1+2 批完成（template-engine / prompt-registry / http-client / electron-mock-setup / intent-classifier / strategy-selector / dictionary-service / ai-service-config），+125 tests。第 3 批（renderer stores）+ 演示数据待办 |

### ⏳ 待开发（比赛后）

| 功能 | 优先级 | 预估工作量 |
|------|--------|-----------|
| 拆 database.ts（1967 行 → 多文件） | 中 | 2-3 天 |
| 拆 ipc.ts（657 行 → 多文件） | 中 | 2 天 |
| 拆 weread-api.ts | 低 | 1-2 天 |
| 拆 rag-service.ts | 低 | 1-2 天 |
| 升级 React Router 7 → 8 | 低 | 1 天（含破坏性变更） |
| macOS/Linux 打包配置 | 低 | 1 天 |
| 单元测试覆盖率提升（当前仅 FSRS 18 个测试） | 高 | 持续 |

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
- [ ] **演示准备**
  - [ ] 准备 demo 数据（精选书籍 + 完整划线/笔记/方法论/知识卡片）
  - [ ] 录屏脚本（核心功能 3-5 分钟）

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

*最后更新：2026-07-20 | ai-dev-workflow 第 6 阶段（知识沉淀）完成*
*下次更新：每完成一个 Sprint 后追加；Phase 1 结束（7/31）后整体重写*
