# 知行读书 — Agent Guide

> **面向对象**：所有 AI Agent（Claude Code / Cursor / Continue / Trae）
> **生效日期**：2026-07-20
> **配套规范**：[CLAUDE.md](CLAUDE.md) + [.learnings/LEARNINGS.md](.learnings/LEARNINGS.md) + [.learnings/PROGRESS.md](.learnings/PROGRESS.md)
> **最近核验**：2026-10-04（历史正文已移出本文件，见下方 §十 指针）

---

## 一、项目速览

**知行读书**（Zhixing Reader）— Electron 桌面应用，知行合一的阅读成长伙伴。

| 维度 | 详情 |
|------|------|
| 形态 | Electron 三进程桌面应用（Main / Preload / Renderer）|
| 框架 | electron-vite 5 + React 19 + TypeScript 5.6 strict |
| 存储 | sql.js (SQLite WASM) + 本地 BM25 检索索引（内存构建）|
| 核心能力 | 微信读书同步、FSRS 间隔重复、AI 智能体对话、知识卡片、词汇学习 |
| 打包 | electron-builder → Windows NSIS 安装包 |

---

## 二、目录结构（30 秒读懂）

```
zhixing-reader/
├── electron/              # Main 进程：DB、IPC、AI、FSRS、WeChat Read API
│   ├── main.ts            # 入口（窗口创建 + 初始化序列）
│   ├── preload.ts         # contextBridge API 暴露面
│   ├── ipc/               # IPC handlers（按领域 13 文件 + index.ts 统一注册 + types.ts 契约）
│   ├── database/          # sql.js DB（按领域 17 文件 + index.ts / schema.ts / connection.ts）
│   ├── fsrs-engine.ts     # FSRS-6.0 适配层（基于 ts-fsrs 5.4.1，对外 API 100% 兼容）
│   ├── agent/             # 智能体（意图分类 / 编排 / 策略）
│   └── services/          # 业务服务（RAG / 知识卡片 / Prompt 模板 / 启动修复）
│
├── src/renderer/          # Renderer 进程：React SPA
│   └── src/
│       ├── pages/         # 路由页面（Bookshelf / Review / Chat / Settings / ...）
│       ├── components/    # 通用 UI 组件（layout / chat / ui 等）
│       ├── stores/        # Zustand 状态管理（6 个 store）
│       ├── design/        # 设计系统
│       ├── utils/         # 渲染层工具
│       └── styles/        # Tailwind CSS
│
├── src/shared/            # 跨进程共享：类型 + IPC 通道常量
├── tokens/                # brand.json — 全部色值的唯一真值（DTCG）
├── brand/                 # 徽标唯一真值（mark*.svg / wordmark / logo-horizontal / grid + README 规范）
├── scripts/               # 构建期脚本（build-tokens.mjs、build-icons.mjs）
├── resources/             # 静态资源（dictionary.json / icon.png / icon.ico —— 后两者由脚本生成）
├── tests/                 # Vitest 单元测试（129 文件 / 2397 用例）
│
├── .learnings/            # 经验与进度沉淀（⚠️ 本地文件，.gitignore 排除，不入库）
│   ├── LEARNINGS.md       # 踩坑与最佳实践
│   └── PROGRESS.md        # 路线图与待办
├── .workbuddy/memory/     # 会话交接记录（⚠️ 本地文件，不入库）
├── .github/workflows/     # CI（lint + typecheck + test:cov + build）
├── docs/                  # 设计文档 + 调研报告（⚠️ .gitignore 排除，不入库）
│
├── AGENTS.md              # ← 你正在读的（所有 Agent 入口）
├── CLAUDE.md              # Claude Code 专属配置
└── package.json           # 依赖与脚本
```

---

## 三、常用命令（5 秒上手）

```bash
# 日常开发
npm run dev              # 开发模式（Vite 端口 5500 + Electron 自动开）
npm run build            # 三进程编译到 dist/
npm run start            # 预览生产构建

# 质量门禁（提交前必跑）
npm run lint             # ESLint 严格模式（0 错误）
npm run typecheck        # tsc --noEmit
npm run test             # Vitest（2397 用例；不含覆盖率）
npm run verify           # 一键跑 lint+typecheck+test:cov+build（推荐；测试那步带覆盖率阈值，与 CI 同口径）

# 品牌资产生成（改色/改徽标后必跑，产物入库）
npm run build:tokens   # tokens/brand.json → generated-palette.css + design/palette.ts
npm run build:icons    # brand/*.svg → resources/icon.{png,ico}

# 打包
npm run package:win      # Windows NSIS 安装包
```

> ⚠️ 原有的 `build-dict` / `seed:demo` / `loop:*` 共 6 个脚本已于 2026-09-11 移除 —— 它们指向的 `scripts/` 目录已不在仓库（commit `2361f9e` 清除）。词典现在只能使用已提交的 `resources/dictionary.json`。

**提交顺序**：lint → typecheck → test → build（**全绿才可提交**）。

---

## 四、Sub-agent 协作约定 🔴核心必读

### 4.1 文件所有权（防冲突）

所有并行 Sub-agent 按下表划分文件所有权（**下表就是正本**，仓库内没有第二份机器可读的配置文件）：

| Agent | 可写 | 禁止 |
|-------|------|------|
| `renderer-agent` | `src/renderer/src/**` | `electron/**`、`shared/**` |
| `backend-agent` | `electron/**`、`shared/**` | `src/renderer/src/**` |
| `test-agent` | `tests/**` | `src/**`、`electron/**`（**只读**）|
| `infra-agent` | `*.config.*`、`.github/**`、`.claude/**` | 业务代码 |

**共享文件**（`package.json`、`AGENTS.md`、`CLAUDE.md`、根 `tsconfig.json`）由主编排器独占修改权。

### 4.2 并行开发协议

```
1. 主编排器读取 PRD → 拆解任务 + DAG 依赖分析
2. 文件归属映射（每个任务对应具体文件路径）
3. 按域分配 Agent → 并行执行
4. 共享文件修改前必须通知其他 Agent
5. 完成后集成 → 跑 verify 门禁
```

### 4.3 Sub-agent 模板

- **code-reviewer** — 7 维度审查（安全/性能/正确性/可维护性/测试/可访问性/文档）
  - 审查类目见本文 **§9.3 七维清单**（那就是正本）；提示词模板与反馈表达规范随任务下发，不落文件
- **test-writer** — Vitest 用例生成（红绿循环）

> 本章是**协作契约**，不是配置说明：仓库内没有任何 Agent 配置文件可读，规则的**可执行真值**在
> `eslint.config.js`、`tsconfig.json`、`vitest.config.ts`、`.github/workflows/ci.yml` 与下面 §5.3 的表里。
> `.claude/` 与 `.workbuddy/` 都在 `.gitignore` 里，换机后不会有、也不该去找。

---

## 五、自动化质量门禁 🔴核心必读

### 5.1 本地门禁（提交前）

| 门禁 | 命令 | 失败影响 |
|------|------|---------|
| ESLint 严格模式 | `npm run lint` | 阻塞 commit |
| TypeScript strict | `npm run typecheck` | 阻塞 commit（覆盖 `electron` / `src` / `scripts` / **`tests`**，覆盖面由 `tests/typecheck-coverage.test.ts` 钉住）|
| Vitest | `npm run test` | 阻塞 commit（只断言全绿，不算覆盖率） |
| 覆盖率 | `npm run test:cov` | **CI 上阻塞**（阈值 lines 83 / branches 80 / functions 75 / statements 83；2026-09-24 起 CI 的测试步骤就是这条）|
| Build 全通过 | `npm run build` | 阻塞 PR |

**一键验证**：
```bash
npm run verify
```

### 5.2 CI 门禁（GitHub Actions）

每次 push / PR 自动跑：
1. ESLint
2. TypeScript
3. Vitest + 覆盖率阈值（跑的是 `npm run test:cov`，阈值不过则 CI 红；`coverage/index.html` 与 `coverage-summary.json` 作为 artifact 保留 14 天）
4. 三进程 build

详见 [.github/workflows/ci.yml](.github/workflows/ci.yml)。

### 5.3 15 条硬性规则（违反即阻塞）

**下表就是这 15 条的正本**（仓库内没有第二份文本；过去这里指向过一个从未存在的规范正本文件，
2026-09-24 收掉 —— 一个"正本"不该有两种口径）：

| 类别 | 规则 |
|------|------|
| 🔴 安全 R1-R5 | 禁硬编码密钥 / 必参数化查询 / 错误响应不泄露 stack |
| 🟡 质量 R6-R10 | 覆盖率阈值见 `vitest.config.ts`（83/80/75/83）/ 文件 ≤ 500 行 / 圈复杂度 ≤ 15 / 目录 ≤ 4 层 / 0 lint 错误 |
| 🟢 规范 R11-R15 | Feature-First / 命名即文档 / Colocation / 配置外化 / Conventional Commits |

> ⚠️ 实测口径：`max-lines`、`complexity`、`max-depth` 在 `eslint.config.js` 中均为 **warn**（不阻塞）；仅 `max-params`、`prefer-const`、`eqeqeq`、`no-unused-vars` 为 error。故「违反即阻塞」仅对后四类成立。

---

## 六、领域专属规范

每个领域的规则**由谁强制**（刻意不另写一份规范文本 —— 本项目已在版本号、色值、IPC 通道上被"两份口径各自漂移"咬过三次）：

| 领域 | 可执行真值 | 重点 |
|------|-----------|------|
| 代码风格 | `eslint.config.js` + 根 `tsconfig.json` | TS/React/Electron 细节全在这两份配置里；`npm run lint` / `npm run typecheck` 是判定手段 |
| 安全 | `CLAUDE.md` §2 红线 + `SECURITY.md` | R1-R5 + IPC 边界；`contextIsolation: true` / `nodeIntegration: false` / 密钥不出主进程 |
| Git | `commitlint.config.js` + `.husky/` | Conventional Commits；pre-commit（lint+typecheck+test）与 commit-msg 两道钩子 2026-09-18 装妥 |

---

## 七、关键注意事项（Gotchas）

来自 [AGENTS.md 根级规则](d:/ai/claude%20code/%E5%BE%AE%E4%BF%A1%E8%AF%BB%E4%B9%A6/AGENTS.md)：

1. **端口 5500 硬编码** — 不要单独修改 `electron.vite.config.ts` 或 `electron/main.ts` 的端口（原 5176 因 Windows Hyper-V 保留端口范围 5175-5274 多次调整，现为 5500，两处必须保持一致）
2. **sql.js 是 WASM** — 默认内存运行，持久化必须显式 read/write
3. **preload path 解析** — `getPreloadPath()` 尝试多路径，改 build 输出需同步
4. **Windows-only 打包** — electron-builder 只配 NSIS，无 macOS/Linux
5. **中文 UI** — 所有用户字符串保持中文一致
6. **preload.ts 已解包** — `window.electronAPI.xxx()` 返回的是 data，不要再 `.data` 二次解包
7. **数据目录跟着应用名、不跟着安装目录** — 数据库/设置/日志全在 `app.getPath('userData')`（装机版 = `%APPDATA%\zhixing-reader`）。2026-09-21 起**只在非打包环境**把它换成 `zhixing-reader-dev`；装机版这个路径一个字都不能改（改了用户升级后看不到自己的数据）。`requestSingleInstanceLock()` 同样按 userData 上锁，所以换目录必须排在它之前。**2026-09-23 补：光排在锁前还不够** —— `logger` 与 `settings-service` 在**模块加载期**就绑定了 userData，而静态 import 全部早于 `main.ts` 本体执行，所以写在 main.ts 里的切换对它们等于没写（实测表现：开发版读不到自己的密钥、日志写进装机版目录）。切换逻辑因此提成 `electron/user-data.ts`，**它必须是 main.ts 最靠前的 import 之一**，由 `tests/dev-userdata-isolation.test.ts` 钉住顺序（sql.js 是整文件写回，共用目录会互盖数据）。

---

## 八、对话起手式

新对话开始时，按以下顺序加载上下文（避免一次性吞下全部）：

```typescript
// 1. 必须读：AGENTS.md（本文件）+ CLAUDE.md + .learnings/PROGRESS.md
// 2. 交接记录：.workbuddy/memory/ 下最新日期文件
// 3. 任务相关：CLAUDE.md §1 的「必须先读的文件」表
// 4. 任务代码：目标文件 + 上下游 ±200 行
// 5. 不读：node_modules、dist、release、resources
```

---

## 九、死代码治理经验（2026-07-21 循环工程沉淀）

### 9.1.1 Renderer 里仍然超过 1000 行的文件（由 `tests/doc-figures.test.ts` 现算）

> **这份清单曾经手工维护过，漏过 `BookDetail`**：2026-09-19 记的是 10 个，那时 `BookDetail` 才 917 行；
> 到 09-30 它涨到 1084，却没人往清单里加 —— **清单靠人维护，漏一个就静默失效**。
> 现在它由判据从仓库算出来，下面这份表只是给人看的中文对照。

| 文件 | 行数 |
|------|------|
| `pages/DailyLearning.tsx` | 1632 |
| `pages/settings/SettingsAbout.tsx` | 1161 |
| `pages/KnowledgeCards.tsx` | 1156 |
| `pages/settings/SettingsAgent.tsx` | 1132 |
| `pages/settings/SettingsAI.tsx` | 1113 |
| `pages/settings/SettingsData.tsx` | 1104 |
| `pages/Methodologies.tsx` | 1093 |
| `pages/BookDetail.tsx` | 1123 |
| `pages/VocabularyPage.tsx` | 1084 |
| `pages/Profile.tsx` | 1072 |
| `pages/Bookshelf.tsx` | 1032 |

**为什么这 11 个还拆不动**：它们都是**单个巨型组件本体** —— 状态与 JSX 互相引用几十处，
不存在能整块搬走的子组件（对比 `pages/profile/StatementReview.tsx` 那种按约定拆进子目录的先例）。
09-18 三批拆分拿到的 61% 降幅来自搬走整块的子组件，**剩下的这一层需要能真点一遍 UI 才能动**。

### 9.1 死代码治理决策树

新增功能 / 修改按钮前必走：

```
死代码识别
├── 有微信读书 skill 能力支撑吗？
│   ├── 是 → 补齐真实功能（IPC + handler + preload + UI 全链路）
│   └── 否 → 砍掉按钮（直接删除，不要 disabled + tooltip 占位）
└── 是真实功能但 UX 差？
    └── 保留 + 优化（不在本循环处理）
```

**原则**：能砍则砍 / 能补则补 / 按钮要真。详见 `.learnings/LEARNINGS.md` LRN-20260721-010。

### 9.2 2026-07-21 死代码治理新增 IPC 通道

| 通道 | 用途 | 文件 |
|------|------|------|
| `WEREAD:FETCH_RECOMMENDATIONS` | 微信读书推荐好书（gateway 优先 + 衍生降级）| `weread-api.ts` `fetchRecommendations` |
| `SYSTEM:CLEAR_HISTORY` | 清理所有对话历史（runTransaction 包裹）| `database/schema.ts` `clearConversationsAndMessages` |
| `SYSTEM:RESET_DATABASE` | 重置数据库 18 张表 + `app.relaunch` | `database/schema.ts` `resetDatabase` |
| `ADMIN:CREATE_CUSTOM_PROMPT` | 新建自定义 AI 模板 | `services/prompt-storage.ts` |
| `ADMIN:UPDATE_CUSTOM_PROMPT` | 更新自定义 AI 模板 | 同上 |
| `ADMIN:DELETE_CUSTOM_PROMPT` | 删除自定义 AI 模板 | 同上 |
| `ADMIN:GET_CUSTOM_PROMPTS` | 拉取自定义 AI 模板列表 | 同上 |

### 9.3 死代码治理 7 维质量评分基准

verifier subagent 7 维审查标准（来自 dead-code-governance verify-report）：

| 维度 | 重点检查 |
|------|---------|
| 安全 | CSV 公式注入防御 / DB 重置多次确认 / `runTransaction` 包裹批量 DELETE / Modal `aria-modal` |
| 性能 | `runTransaction` 单事务批量 / `useMemo` 缓存 / Map 去重 / Promise.all 并行 |
| 正确性 | 幂等迁移 / `?.` 短路兼容旧数据 / 按钮 onClick 真实跳转 |
| 可维护性 | IPC 通道集中定义 / wrapper 转发解耦 / 类型从 shared/types 复用 |
| 测试 | 项目已有 Vitest（123 文件 / 2281 用例；纯逻辑 + 组件测试）。新增功能应补 `tests/*.test.ts`；提交前跑 `npm run verify`（含覆盖率阈值）|
| 可访问性 | Modal `role/aria-modal/aria-labelledby` + ESC + 焦点管理 |
| 文档 | 代码内注释 + 规范 commit message + **本文第十节一行批次记录**（早期设想的 spec/tasks/checklist/verify-report 四件套从未落地，实际沉淀位置见 §9.4）|

### 9.4 相关文件

经验与进度的**唯一**沉淀位置（都是本地文件、`.gitignore` 排除、不入库）：

- 踩坑与最佳实践：`.learnings/LEARNINGS.md` —— 本轮治理的结论在 LRN-20260721-006~010
- 路线图与待办：`.learnings/PROGRESS.md`（公开待办以 GitHub Issues 为准）
- 会话交接：`.workbuddy/memory/` 下最新日期文件
- **变更历史**：`docs/agent-history.md` —— 2026-10-04 建，原 §十 变更记录与头部「最近核验」的全文搬到这里。**它是 append-only 的**：里面的用例数、覆盖率、被跳过的验证项都是**当年**的实测，拿今天的真值去改它等于伪造历史（这也是本项目 §十 历史行一直被守卫排除在数字对账之外的原因）。

---

## 十、变更记录

本节曾是本文件里最大的一块（173 KB / 300+ KB 中文），2026-10-04 整节搬进
[`docs/agent-history.md`](docs/agent-history.md)（本地文件，不入库）。

**新规矩**：以后每批只在下面加一行摘要表，完整实测记录写进那个历史档 ——
本节与头部「最近核验」都不许再长成长段落。它们是每次会话都要全量加载的文档，
而变更历史对"下一个 Agent 做什么"没有约束力。

| 日期 | 变更 | 摘要 |
|------|------|------|
| 2026-10-04 | 历史正文外迁 | §十 整节与头部「最近核验」搬进 `docs/agent-history.md`；AGENTS.md 由 446 KB 降到约 20 KB。全文见历史档，字字未改。 |
| 2026-10-04 | Issue #8 剩余部分：readingDataStore | 补 26 条判据（Issue 原写「两个 store 零测试」，实测 settingsStore 已由 09-27 那批还了 37 条，真零的只有这个 45 行的）。**顺带修掉一条真缺陷**：`catch` 交出 `{error, loading:false}` 但 `data` 留上一次的成功值 ⇒ 统计页拿旧数字当这一次的结果画，界面上只有一行错误，两句都在说谎（本项目治过十次的同一族）。同时 `mode` 只在成功那支写，失败时用户点的档位写不进去。期望先想清楚再写：5 条首跑红里 **3 条是代码错**（data 留旧值、mode 错乱、NaN 直显），**2 条是我期望错**（`formatReadingTime(30)` 显示「0分钟」是既有行为不是缺陷；`NaN` 那条不该混在这个 store 判据里）——按 Issue #8 的硬要求逐条判了归属。变异 4 处全判红（撤 `data:null` 2 条 / 撤 `mode:targetMode` 1 条 / 撤 `loading:true` 2 条 / `setMode` 不重取 3 条）。**没验**：统计页真界面一次没点开；`formatReadingTime(NaN)` 显示「NaN分钟」这个真缺陷**量到了但没修**（属"脏数据不许直接显示"，该单独立判据）。 |
| 2026-10-04 | Issue #1 可做部分：退出收尾的真行为 | 补 `tests/shutdown-behavior.test.ts` 17 条（`shutdown.ts` 100 / 80 / 100 进清单）。**病是补判据时量出来的**：`shutdownForExit` 是五步裸调用，任何一步抛错后面全部不执行 —— 最要命的是 `closeDatabase()`（它抛错正是"落盘失败"）⇒ `logger.close()` 永远轮不到，于是这次退出**数据没落盘、退出卡住、日志里也没有"为什么"**，出问题时连原因都查不到；`done` 幂等标记还会把它粘在半路。本项目为此治过十几次。修法：`runStep(label, fn, errors)` 每步各自兜住并逐条 `logger.error` 指名是哪一步，全走完把错误 `AggregateError` 抛回（吞掉比报出来更坏：调用方看到"没抛"就以为盘写好了）。② 既有 `tests/install-exit-path.test.ts` 那条断 `indexOf('closeDatabase()')` 先后顺序的判据当场失配（字面量变成裸标识符）⇒ 改成断"那几步一个都没被删掉"，**顺序由新行为判据用真实调用序列钉**。③ **变异当场抓到我自己的洞**：把 `logger.close` 改回裸调用时 17 条**全绿** —— 前面所有用例里它自己不抛，而"前一步先炸"那几条只断言它被调用过（那时它确实被调用了）；补的那条要求**两个条件同时成立**（前一步炸 + 关日志自己也炸）才暴露。④ **自己踩的第二个坑**：第一版 `vi.mock` + `vi.resetModules()` 组合让 mock 静默失效（`calls` 恒空、10 条红得看不出是代码错还是 mock 没挂上；本项目在 `weread-sync-manager` 那批栽过同一形状）⇒ 改 `vi.doMock` 且路径按测试文件写 `../electron/...`（`'electron/database'` 与 `'./database'` 落到不同 mock id）。⑤ typecheck 当场抓到 handler 类型标注不接（把 `tests/` 纳入 typecheck 的价值）。变异 6 处全判红。**没验**：**Issue #1 本身关不掉** —— 装机实测（装 v1.3.3 → 走「检查更新→下载更新→重启安装」）仍需人在真机上做；这批只把"代码写成了那个形状"升级成"跑起来真按那个顺序、失败时真不互相带走"。 |
