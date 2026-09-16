# CLAUDE.md — Claude Code 专属配置

> **作用**：Claude Code（Cursor/Trae/Claude Code CLI）启动时自动加载的项目级指令
> **作用范围**：仅在 Claude 系列 AI 中生效；其他 AI 看 `AGENTS.md`（已存在，更通用）
> **更新时机**：本文件由团队规范提炼而来；与项目记忆冲突时，以本文件为准
> **详细规范**：⚠️ `.learnings/STANDARDS.md` 与 `.claude/rules/{code-style,security,git}.md` **均未落地**（不存在），本文与 `eslint.config.js` / `tsconfig.json` / `package.json` 的实际配置为唯一真值
> **最近核验**：2026-09-11（对代码实测校准）

---

## 0. 一句话项目身份

> **知行读书**是 Anki 同源 FSRS 算法驱动的 AI 阅读成长智能体（Electron + React + sql.js），打通「微信读书同步 → AI 智能体理解 → 科学间隔复习 → 知识卡片体系化 → 英语学习」完整闭环。当前 v1.1.0 维护迭代期（比赛已于 2026-07 结束）。

---

## 1. 必须先读的文件（按场景）

| 场景 | 先读 |
|------|------|
| 改 Electron 主进程 | `electron/main.ts` + `electron/database/index.ts` + `src/shared/ipc-channels.ts` |
| 改 IPC 通道 | `src/shared/ipc-channels.ts` + `electron/ipc/index.ts` + `electron/ipc/types.ts` + `electron/preload.ts` |
| 改数据库 schema | `electron/database/schema.ts` + `electron/database/connection.ts` + `electron/repositories/` + `electron/utils/db.ts` |
| 改 AI 提示词 | `electron/services/prompt-registry.ts` + `prompt-storage.ts` |
| 改智能体编排 | `electron/agent/orchestrator.ts` + `system-prompt.ts` + `context-builder.ts` |
| 改 React 页面 | `src/renderer/src/App.tsx`（路由）+ 对应 `pages/` 目录 |
| 改 Zustand store | `src/renderer/src/stores/` 找对应 store |
| 改 FSRS 复习 | `electron/fsrs-engine.ts`（ts-fsrs 5.4.1 **适配层**，非自实现）+ `electron/database/cards.ts` |

---

## 2. 绝对禁止（红线）

| # | 禁止 | 原因 |
|---|------|------|
| **A1** | 引入原生 Node 模块（node-gyp 编译） | sql.js 已用，原生模块在 Electron 35 + Win11 编译链不稳 |
| **A2** | 把 API Key、Token 写入代码或日志 | R1 + safeStorage 已有方案 |
| **A3** | 改 `electron/database/` 领域文件前不读上下文（连接/schema 依赖方向见文件头注释） | 拆分后仍需先读关联文件再动手 |
| **A4** | 改 `electron/ipc/` 领域文件前不读 `ipc/types.ts`（HandleFn 包装器约定） | 同上 |
| **A5** | 升级 React Router 大版本（7.x → 8.x） | 破坏性变更，需专项评估 |
| **A6** | 删 `.learnings/` 任何已有内容 | 团队沉淀的知识资产 |
| **A7** | 改 AGENTS.md 已写明的硬约束（端口 5500、`@/` 别名、Chinese UI） | 见 AGENTS.md Gotchas |
| **A8** | 提交时跳过 lint/typecheck/test | ⚠️ **无 pre-commit hook**（husky 未安装），靠人工自觉执行 |
| **A9** | `git add -A` / `git add .` | 可能误提交 .env / node_modules |
| **A10** | commit message 用 `WIP`/`fix bug`/`update code` | ⚠️ **commitlint 未安装**，无自动拦截，靠人工遵守 |
| **A11** | 留死代码占位按钮（onClick 弹 toast.info "即将上线" / navigate 到不存在的页面） | 用户硬约束"按钮必须真实可用"；见 LRN-20260721-010 决策树 |
| **A12** | 把 installer 产物（installer/、installer-v2/、out/、release/）提交到 git | `.gitignore` 已排除；CI 重新打包 |

---

## 3. 必须遵守（白名单）

| # | 要求 | 实现 |
|---|------|------|
| **B1** | 新增 IPC 通道必须先在 `shared/ipc-channels.ts` 注册常量 | `IPC_CHANNELS.MY_NEW = 'my:new'` |
| **B2** | 新增 IPC handler 必须返回 `{ success, data }` 或抛 Error | preload invoke 已自动解包 |
| **B3** | 新增 Renderer 端 `window.electronAPI.*` 必须在 `electron/preload.ts` 暴露 | 否则 `undefined` |
| **B4** | DB 字段下划线 → TS 驼峰映射用 `electron/utils/db.ts` 的 `rowsToObjects` | 已有工具函数 |
| **B5** | JSON 字段反序列化用 `safeParseJSON`（在 `db-mapper.ts`） | 失败返回 `[]` |
| **B6** | 长任务（知识卡片蒸馏/批量生成）必须用 `KnowledgeCardService` 单例 | 防并发竞态 |
| **B7** | 敏感信息用 `safeStorage.encryptString` + `getSecureKey` | `electron/services/settings-service.ts` |
| **B8** | API Key 输入必须 ASCII 校验 | `/^[\x20-\x7E]+$/`（已有，参见 ERR-20260529-004） |
| **B9** | 错误处理分类：cancelled/timeout/network/empty/import/parse/config | 已定义，preload 层抛出 |
| **B10** | commit message 必填 type（feat/fix/chore/docs/test/refactor/perf/build/ci/style/revert） | ⚠️ commitlint **未安装**，无自动校验，人工遵守 |
| **B11** | 新增功能前先走死代码决策树：有 skill 能力 → 补齐；无 skill 能力 → 不做（不放占位）；已有占位 → 砍或补二选一 | 见 LRN-20260721-010 |
| **B12** | 批量 DB 写操作（DELETE/UPDATE/INSERT 多条）必须用 `runTransaction(fn)` 包裹 | 见 LRN-20260721-008 |
| **B13** | CSV 导出必须防御公式注入：`= + - @` 开头的值前置单引号 + UTF-8 BOM | 见 LRN-20260721-007 |
| **B14** | SQLite schema 加列走 `CREATE TABLE IF NOT EXISTS + migrateXxxTable()` 双轨幂等模式 | 见 LRN-20260721-006 |
| **B15** | 微信读书 skill 第三方 API 调用走"gateway 优先 + 衍生降级"模式 | 见 LRN-20260721-009 |

---

## 4. AI 协作工作流（接到任务后）

```
Step 1  Read 目标文件 + 关联文件 + 本文件对应章节
Step 2  Surface Assumptions（"我假设 X，纠正我再继续"）
Step 3  列出修改点 + 验证方法
Step 4  实施修改（最小改动原则）
Step 5  跑 npm run verify（lint + typecheck + test + build）
Step 6  按主题拆 commit（不要 WIP）
Step 7  在 .learnings/ 记录踩坑（如有）
```

**对话中遇到以下词立即停**：
- 用户说"直接写"/"跳过 X" → 先确认
- 用户说"先这样以后改" → 提醒"97% 不会回来改"
- 发现 P0/P1 问题（自检报告）→ 告知用户但不擅自修

---

## 5. 与其他 AI 工具的边界

| 工具 | 用法 | 本项目状态 |
|------|------|------------|
| Trae IDE | 主 IDE | ✅ 在用 |
| Claude Code CLI | 终端 AI 助手 | ✅ 在用 |
| Cursor | 备选 IDE | 可选 |
| Codex / GPT | 不在本项目使用 | — |
| 微信读书 API | 通过 `electron/weread-api.ts` | ✅ 集成 |
| Anthropic Claude API | 通过 `electron/ai-service.ts` | ✅ 集成 |
| Vectra | 通过 `electron/services/vector-db.ts` | ✅ 集成（本地向量索引；Qdrant 已移除）|

---

## 6. 自动化门禁（CI 强制 + 人工本地）

| 命令 | 作用 | 触发 |
|------|------|------|
| `npm run lint` | ESLint 0 错误 | 手动 + CI |
| `npm run typecheck` | tsc --noEmit 0 错误 | 手动 + CI |
| `npm run test` | vitest 全通过（850 用例）| 手动 + CI |
| `npm run test:cov` | 覆盖率（阈值 83/80/75/83）| 手动（**未接入 CI**）|
| `npm run build` | electron-vite 编译 | CI |
| `npm run verify` | 上面四项一键串行 | 手动 |
| GitHub Actions | push/PR 完整流水线 | 远程 |
| husky pre-commit | ⚠️ **未安装** | — |
| commitlint | ⚠️ **未安装** | — |

> ⚠️ 实测（2026-09-11）：`package.json` 无 husky / commitlint / lint-staged 依赖，无 `.husky/` 目录，无 `prepare` 脚本。另：脚本名为 `test` 而非 `test:run`。

---

## 7. 知识沉淀位置（按温度分层）

| 温度 | 位置 | 用途 |
|------|------|------|
| 🔥 热 | 本对话上下文 | 即时讨论 |
| 🌡️ 温 | `.learnings/STANDARDS.md` ⚠️未落地 | 速查规范（以 AGENTS.md §5.3 为准）|
| 🌡️ 温 | `.learnings/ERRORS.md` ⚠️未落地 | 已解决 bug（并入 LEARNINGS.md）|
| 🌡️ 温 | `.learnings/LEARNINGS.md` | 最佳实践 + 教训 ✅ |
| 🌡️ 温 | `.learnings/PROGRESS.md` | 进度跟踪 ✅ |
| 🌡️ 温 | `.workbuddy/memory/*.md` | 会话交接记录 ✅（⚠️ 本地文件，不入库）|
| 🧊 冷 | `CLAUDE.md`（本文件） | 每次启动加载 |
| 🧊 冷 | `AGENTS.md` | 所有 AI 通用 |
| 🧊 冷 | `docs/superpowers/specs/*.md` ⚠️不存在 | 历史设计文档（目录已不在仓库）|
| 🧊 冷 | `docs/research/*.md` | 调研报告 ✅（⚠️ `docs/` 被 gitignore，不入库）|
| ❄️ 冻 | 代码本体 + 注释 | 不沉淀 |

---

## 8. 项目状态（2026-09-16 更新）

- **当前版本**：v1.1.0（维护迭代期，比赛已于 2026-07 结束）
- **git 锚点**：master @ `6b3cfbc`（2026-09-02），共 183 commits，tag `v1.0.0`
- **未处理项追踪**：以本文件 §9 表为准（原 `docs/项目自检_优化方案_2026-07-20.md` 已不在仓库）；Token 优化调研见 `docs/research/token-optimization-plan.md`（**Step 1-3 已落地**，Step 4 核查为已实现，Step 5-6 待做）
- **主方向**：修复使用 bug、假数据/死代码治理、落地未完成功能、技术债消化
- **门禁基线（2026-09-16 实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（192 warning）✅ / Vitest **850 用例 · 38 文件**全通过 ✅ / electron-vite 三进程 build 成功 ✅ / 覆盖率 91.09-85.05-93.81-91.09 ✅
- **2026-09-16 数据血缘修复**：量真实数据库（`%APPDATA%\zhixing-reader\zhixing.db`）列出「应该有的 vs 实际有的」，5 个差值为 0 的字段全部修完 —— ① 934 条划线章节名全丢（`chapters` 对照表取了不用）② 90 张知识卡片来源划线全丢（提示词没问、写死 null；现在 `sourceIndex` 需在本批内换算）③ 对话意图不落库 ④ 对话引用来源不落库（`chunkId` 是 Qdrant 遗留字段名，新增 `RagSourceRef` 唯一真值）⑤ 阅读时长恒为 0（改为同步微信读书月度数据，累加改覆盖）。测试 790→850（38 文件）
- **2026-09-15 算法数字换人话**：新增 `src/shared/fsrs-voice.ts`（`describeForgetting` / `describeNextReview`），全应用共用一张嘴；复习页与生词本不再显示「稳定性 46.35 天」「保持率 87%」，改为「已经拖了 4 天没复习 · 现在花 10 秒？」这类陈述+动作；原始数字收进「为什么这么说」折叠。测试 764→790
- **2026-09-15 每日新卡上限**：实测发现 934 张卡片中 931 张一次性全部逾期（同步导入即到期 + 无每日上限），是"用户不每天打开"的真正原因。新卡与复习卡拆成两个队列，新卡每天限量放行（默认 15，可配置）；`getReviewStats().due` 不再把未学过的卡算成到期
- **2026-09-15 生词本正确性修复**：评分档位错位（「困难」被记成 Good，Hard 档不可达）/ 自举写死 Rating.Good / 毕业时冲掉已累积稳定性 / is_mastered 自动置位致词永久退场 / 掌握度改用 FSRS 推导；测试 fixture 改为复用 `applySchemaAndMigrations()`，删除 280 行平行 DDL
- **2026-09-15 卡片掌握度（复习闭环反馈）**：新增 `src/shared/fsrs-metrics.ts`（`getCardMastery` / `getRetrievability`，纯函数、双端复用、与 ts-fsrs 逐点校验）；复习页与书籍详情卡片列表展示掌握度与保持率，评分后即时反馈掌握度增量，完成态展示真实统计；砍掉不可达的 `CARDS.UPDATE_MASTERY_LEVEL` / `UPDATE_APPLICATION_TAG`；修复 `test:cov`（coverage-v8 2.0.0→2.1.9 版本不匹配）
- **2026-09-11 FSRS 真值对齐**：ts-fsrs@5.4.1 实测为 **FSRS-6.0 / 21 参数**（原文档写 v5 / 19 参数已校正）；修复 fsrs-engine 中 _nextIntervalVocabulary 公式符号错误导致**词汇复习间隔恒为 1 天**（且把 SM-2 的 efFactor 当记忆稳定性用）；词汇与划线卡片现共用同一 ts-fsrs 实例，记忆状态存于 vocabulary 表 stability/difficulty/lapses 三列（幂等迁移）
- **2026-09-02 进展**：完成 C1 健壮性 6 修（重置落盘竞态 / 落盘失败重试+通知 / 重新生成重复问答对 / Sidebar 轮询暂停 / 蒸馏去 800ms 延时 / admin sqlite_ 守卫），6 个原子 commit，均过 verify
- **2026-09-11 进展**：接手全量核验，校准 AGENTS.md / CLAUDE.md / README.md 失真项（详见 `.workbuddy/memory/2026-09-11.md`）
- **版本控制边界**：`.learnings/`、`.workbuddy/memory/`、`.claude/`、`docs/`、`diagrams/` 均为**本地文件不入库**（含内部策略与已知问题，见 .gitignore）

---

## 9. 自检报告未处理项的归属（避免重复劳动）

| 报告项 | 优先级 | 归属 | 状态 |
|--------|--------|------|------|
| P0-1 关窗数据保存 | P0 | **已修**（main.ts close: cancelActiveStream + forceSaveDatabase 双保险；before-quit closeDatabase） | ✅ |
| P0-2 rag-service 动态导入 | P0 | **已修**（commit d91036b） | ✅ |
| P0-3 preload stream 监听器 | P0 | **已修**（流式健壮性 e653c6a：safeSend isDestroyed 守卫 + chatStore 监听器 cleanup） | ✅ |
| P0-4 IPC 通道统一常量 | P0 | **已修**（shared/ipc-channels.ts 集中定义，ipc/ 领域文件统一引用） | ✅ |
| P1-1 database.ts 拆分 | P1 | **已修**（commit 28811b2，拆为 database/ 17 文件） | ✅ |
| P1-2 ipc.ts 拆分 | P1 | **已修**（commit a3eb462，拆为 ipc/ 12 文件） | ✅ |
| P1-3 Vite CJS 弃用 | P1 | 迭代中 | ⏸️ |
| Phase 2 FSRS 升级 | P0 | **已完成**（v1.0.0 已集成 ts-fsrs 5.4.1） | ✅ |
| Phase 3 ECharts 集成 | P1 | **已完成**（v1.0.0 AdminDashboard 6 图表） | ✅ |
| **规范基础设施** | **P0** | **部分未落地**：CI 门禁 ✅；`.claude/rules/` ❌、`.learnings/STANDARDS.md` ❌、husky/commitlint ❌（均不存在）| ⚠️ |

---

*最后更新：2026-09-16 | 数据血缘修复（5 个断点）+ 门禁基线刷新（850 用例 / 38 文件）*
*与 AGENTS.md 不一致时，两者均以上述实测代码配置为准（`package.json` / `eslint.config.js` / `tsconfig.json` / `vitest.config.ts`）*
