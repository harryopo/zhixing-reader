# CLAUDE.md — Claude Code 专属配置

> **作用**：Claude Code（Cursor/Trae/Claude Code CLI）启动时自动加载的项目级指令
> **作用范围**：仅在 Claude 系列 AI 中生效；其他 AI 看 `AGENTS.md`（已存在，更通用）
> **更新时机**：本文件由团队规范提炼而来；与项目记忆冲突时，以本文件为准
> **详细规范**：本文与 `eslint.config.js` / `tsconfig.json` / `vitest.config.ts` / `package.json` 的**实际配置就是唯一真值**，仓库内没有第二份规范文本（过去这里指向过的两份本地规范文件从未存在，2026-09-24 已把这些指针收掉 —— 见 AGENTS.md §5.3 / §六）
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
| 改数据库 schema | `electron/database/schema.ts` + `electron/database/connection.ts` + `electron/utils/db.ts` |
| 改 AI 提示词 | `electron/services/prompt-registry.ts` + `prompt-storage.ts` |
| 改智能体编排 | `electron/agent/orchestrator.ts` + `system-prompt.ts` + `context-builder.ts` |
| 改 React 页面 | `src/renderer/src/App.tsx`（路由）+ 对应 `pages/` 目录 |
| 改 Zustand store | `src/renderer/src/stores/` 找对应 store |
| 改 FSRS 复习 | `electron/fsrs-engine.ts`（ts-fsrs 5.4.1 **适配层**，非自实现）+ `electron/database/cards.ts` |

---

## 2. 绝对禁止（红线）

| # | 禁止 | 原因 |
|---|------|------|
| **A1** | 引入原生 Node 模块（node-gyp 编译） | sql.js 已用，原生模块在 Electron + Win11 编译链不稳（且每次 Electron 大版本升级都要重验编译链） |
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
Step 5  跑 npm run verify（lint + typecheck + test:cov + build）
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
| 本地检索 | 通过 `electron/services/rag-service.ts` + `src/shared/retrieval.ts` | ✅ 集成（BM25 倒排索引，无第三方依赖；向量检索 2026-09-16 已移除）|

---

## 6. 自动化门禁（CI 强制 + 人工本地）

| 命令 | 作用 | 触发 |
|------|------|------|
| `npm run lint` | ESLint 0 错误 | 手动 + CI |
| `npm run typecheck` | tsc --noEmit 0 错误 | 手动 + CI |
| `npm run test` | vitest 全通过（2340 用例）| 手动 + CI |
| `npm run test:cov` | 覆盖率（阈值 83/80/75/83）| 手动 + **CI**（2026-09-24 起 CI 的测试步骤就是这条，阈值不过流水线红）|
| `npm run build` | electron-vite 编译 | CI |
| `npm run verify` | 上面四项一键串行 | 手动 |
| GitHub Actions | push/PR 完整流水线 | 远程 |
| husky pre-commit | ✅ 已装（lint + typecheck + test 三连）| 每次 commit |
| commitlint | ✅ 已装（config-conventional，header ≤120，中文 subject 放行）| 每次 commit |

> 实测（2026-09-21）：`.husky/pre-commit` 与 `.husky/commit-msg` 均在，`package.json` 有 `prepare: husky`；脚本名为 `test`（不是 `test:run`）。注意 **`npm run typecheck` 不覆盖 `tests/`**（根 tsconfig 的 include 只有 electron/src/scripts），测试文件要靠真跑 vitest 才暴露问题。

---

## 7. 知识沉淀位置（按温度分层）

| 温度 | 位置 | 用途 |
|------|------|------|
| 🔥 热 | 本对话上下文 | 即时讨论 |
| 🌡️ 温 | `.learnings/LEARNINGS.md` | 最佳实践 + 教训 + 已解决 bug ✅（规范速查在 AGENTS.md §5.3，不另立文件）|
| 🌡️ 温 | `.learnings/PROGRESS.md` | 进度跟踪 ✅ |
| 🌡️ 温 | `.workbuddy/memory/*.md` | 会话交接记录 ✅（⚠️ 本地文件，不入库）|
| 🧊 冷 | `CLAUDE.md`（本文件） | 每次启动加载 |
| 🧊 冷 | `AGENTS.md` | 所有 AI 通用 |
| ❄️ 冷 | `docs/agent-history.md` | 两份入口文档的历史正文存档（⚠️ `docs/` 被 gitignore，不入库；2026-10-04 建，AGENTS §十 + CLAUDE §8 搬入）|
| 🧊 冷 | `docs/superpowers/specs/*.md` ⚠️不存在 | 历史设计文档（目录已不在仓库）|
| 🧊 冷 | `docs/research/*.md` | 调研报告 ✅（⚠️ `docs/` 被 gitignore，不入库）|
| ❄️ 冻 | 代码本体 + 注释 | 不沉淀 |

---

## 8. 项目状态（2026-09-21 更新）

- **当前版本**：v1.3.4（2026-09-23 发布；维护迭代期，比赛已于 2026-07 结束）
- **git 锚点**：tag 序列 `v1.0.0` → `v1.1.0` → `v1.2.0` → `v1.3.0` → `v1.3.1` → `v1.3.2` → `v1.3.3` → `v1.3.4`（发版即打 tag 并推，Release 三件同传：exe / `.blockmap` / `latest.yml`）
- **未处理项追踪**：以本文件 §9 表为准（原 `docs/项目自检_优化方案_2026-07-20.md` 已不在仓库）；Token 优化调研见 `docs/research/token-optimization-plan.md`（**Step 1-6 全部已落地**；Step 4 核查为已实现，仅剩"升级为向量语义检索"这一边际增强可选）
- **主方向**：修复使用 bug、假数据/死代码治理、落地未完成功能、技术债消化
- **发版要走的六处版本同步点**（漏一处界面与文档就各说一个版本；已由 `tests/version-sync.test.ts` 4 条钉住）：`package.json`+lock、`src/shared/external-links.ts` 的 `APP_META`、`CHANGELOG.md` 的 `## [x]` 与链接行、`README.md`（横幅/Version 徽标/`Setup-x.exe`/变更记录表/页脚）、关于页 `UPDATE_HISTORY` 首条
- **门禁基线**：最新一次实测见 AGENTS.md §十 表首行与 `docs/agent-history.md`（2026-10-04 前本节按批次堆了 56 行「门禁基线（某日实测）」，已整段搬进那份历史档；**当时那几百个用例数是当时的实测，不许拿今天的真值去改它**）。本项目**当前**的门禁数值由 `npm run verify` 现算，不在文档里抄 —— 抄一次漂一次是本项目被咬过三次的老毛病（版本号、色值、IPC 通道三处都有守卫）。
- **历史正文去哪了**：AGENTS.md 头部「最近核验」、§十 变更记录、本节的门禁基线与各日进展，2026-10-04 起统一在 [`docs/agent-history.md`](docs/agent-history.md)（⚠️ `docs/` 被 gitignore，不入库）。
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
| P1-2 ipc.ts 拆分 | P1 | **已修**（commit a3eb462，拆为 ipc/ 按领域文件；现为 12 个领域文件 + index 注册 + types 契约） | ✅ |
| P1-3 Vite CJS 弃用 | P1 | 迭代中 | ⏸️ |
| Phase 2 FSRS 升级 | P0 | **已完成**（v1.0.0 已集成 ts-fsrs 5.4.1） | ✅ |
| Phase 3 ECharts 集成 | P1 | **已完成**（v1.0.0 AdminDashboard 6 图表） | ✅ |
| **规范基础设施** | **P0** | CI 门禁 ✅ / husky pre-commit ✅ / commitlint ✅（三者 2026-09-18 装妥）/ 覆盖率阈值已接 CI ✅（2026-09-24）/ `tests/` 在 typecheck 内 ✅（2026-09-24）。**规范文本不再另立文件** —— 可执行真值就是那几份配置，文档里指向不存在文件的指针已全清（2026-09-24）| ✅ |

---

*最后更新：2026-09-26 | v1.3.4 已发布；之后 master 上补了 CI 换行符修复与 GitHub 维护面、四批工具链升级、密钥落盘加密与跨进程收口、功能深化一批（引用回原文 / 出处 / 练习记账 / 删除可撤销）、「删除不级联」的根因修复（sql.js `export()` 复位外键）、全局搜索一批、数据库层与主进程数据访问层三轮复扫收口 · 1346 用例 / 90 文件*
*与 AGENTS.md 不一致时，两者均以上述实测代码配置为准（`package.json` / `eslint.config.js` / `tsconfig.json` / `vitest.config.ts`）*
