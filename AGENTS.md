# 知行读书 — Agent Guide

> **面向对象**：所有 AI Agent（Claude Code / Cursor / Continue / Trae）
> **生效日期**：2026-07-20
> **配套规范**：[CLAUDE.md](CLAUDE.md) + [.learnings/LEARNINGS.md](.learnings/LEARNINGS.md) + [.learnings/PROGRESS.md](.learnings/PROGRESS.md)
> **最近核验**：2026-10-17（历史正文已移出本文件，见下方 §十 指针）

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
├── tests/                 # Vitest 单元测试（136 文件 / 2484 用例）
│
├── .learnings/            # 经验与进度沉淀（⚠️ 本地文件，.gitignore 排除，不入库）
│   ├── LEARNINGS.md       # 踩坑与最佳实践
│   └── PROGRESS.md        # 路线图与待办
├── .workbuddy/memory/     # 会话交接记录（⚠️ 本地文件，不入库）
├── .github/workflows/     # CI（lint + typecheck + test:cov + build）
├── docs/                  # 设计文档 + 调研报告（⚠️ .gitignore 排除，不入库；例外：docs/design/ 两份在规则之前已被跟踪）
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
npm run test             # Vitest（2484 用例；不含覆盖率）
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
8. **「哪一天」只许问一把尺** — `src/shared/db-time.ts` 的 `localDayKey` / `dayKeyOfStoredTime` / `isSameLocalDay`；`toISOString()` 取的是 UTC 日，不是"今天"（判据 `tests/daily-stats-day-key.test.ts`）。

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
| `pages/DailyLearning.tsx` | 1636 |
| `pages/settings/SettingsAbout.tsx` | 1161 |
| `pages/KnowledgeCards.tsx` | 1156 |
| `pages/settings/SettingsAgent.tsx` | 1156 |
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
| 测试 | 项目已有 Vitest（136 文件 / 2484 用例；纯逻辑 + 组件测试）。新增功能应补 `tests/*.test.ts`；提交前跑 `npm run verify`（含覆盖率阈值）|
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
| 2026-10-15 | admin 出口按消费者拆两半 | 上一批 `31790fa` 只挡住 `/admin` 页面，**19 条 `admin:*` 通道在安装版仍全注册**（菜单里 `toggleDevTools` 不是 dev-only，`electron/main.ts:198`）。先查生产者再收口：设置三页真在用 8 条（`SettingsAgent:330/354/374`、`SettingsAI:293/341/345/367/392`、`SettingsData:130/156/326`），其余 11 条（任意表 / 库结构 / 全部会话与消息 / 整批导入导出 / 重置全部 / 内置模板列表）改成只在开发构建注册。**按"这是 admin 通道"一刀切会把那三个页面打断，而单测一条不报** —— 这是本项目"收紧前先查生产者"又一次没白查。`getStats` 顺手查的 `tokenTrend` + `recentSessions` 全场只有后台页的兜底字面量里出现过、无人读 ⇒ 删掉服务层 `getTokenUsageLast7Days`，这条链每次进设置页少两次 SQL、不再把对话行带进渲染层。判据 7 条（`tests/admin-ipc-dev-only.test.ts`）钉两种形状各自的通道清单，另加一条对账守卫：基准取**装机形状实际注册出来的通道**而不是测试里那份清单（第一版比的是清单，有人把产品通道挪进闸门它照样绿）。变异两处各判红（撤 `if (!isDev) return` 报出那 11 条 / 把 `savePrompt` 挪进闸门报出 `savePrompt`）。覆盖率清单 +1：`electron/ipc/admin.ts` 100 / 100 / 100。**没验**：装机版一次没打开过，"控制台确实调不到"只证到注册这一层；`electron/main.ts:198` 那条 devtools 菜单项刻意留着（个人应用要给自己留调试通路）—— 于是 preload 上那 11 个同名方法在安装版里是"点得动但只会拿到一条 reject"。 |
| 2026-10-15 | 脏时长不再上屏 + 软著材料不入库 | `formatReadingTime` 对 `NaN` 画「NaN分钟」、对 `Infinity` 画「Infinity小时」、缺字段拼出「undefined分钟」（字符串会被 JS 当数字用）—— 这条 09-29 量到、10-04 记为"该单独立判据"，本次补闸门（`typeof` 收窄 + `Number.isFinite`）并落 7 条判据：脏值 ⇒ `-`，**真 0 秒仍说「0分钟」**（"不知道"与"确实是零"不并成一个写法）。变异一处判红（把闸门改成恒 false ⇒ 6 条全红，报出 'NaN分钟' / 'Infinity小时' / '0分钟' / '1小时'）。同批：`.gitignore` 收下**软著申报材料**与根目录两个临时脚本（`软件著作权申请资料/`、`软著申请/`、`_seed.py`、`_setcheck.py`）—— 实测这四样从未被跟踪、也从未出现在任何历史提交里，挡的是以后一句 `git add -A` 把它们推进公开仓库。`readingDataStore.ts` 覆盖仍是 100/100/100，用例 2402 → 2409。 |
| 2026-10-16 | CI 转绿：vitest worker 的 RPC 上限顶不住真出包的守卫 | **⚠️ 这一行的结论后来被证明是错的，以本表 2026-10-17「更正上面…」那行为准（修法那次是空转的假开关）。** 上一笔推上去 CI 退 1，但日志里 **130 文件 / 2412 用例全绿、覆盖率也过阈值** —— 真报错在摘要之后：`[vitest-worker]: Timeout calling "onTaskUpdate"`，vitest 把"有未处理错误"算失败。按时间线取证：`tests/admin-not-in-bundle.test.ts` 在自己的 worker 里真跑三进程构建，CI windows runner 实测 **64255ms**（本地 45s），它 10:34:28 跑完、10:34:31 就报这个错，而 `poolOptions.threads.rpcTimeout` 默认 5 秒。修法与 09 月把 `testTimeout` 从 5s 抬到 20s 同一手法：**只放宽墙钟（→120s），不动任何断言**。守卫本身没错，它就该真出一次包。**坑记一条**：我第一次用 `gh run watch --exit-status \| tail` 读退出码，`$?` 是 `tail` 的，于是把 red 念成了 green —— 同一条规矩本项目已经栽过两次，验证串改用 `>file 2>&1; echo $?` 或直接问 API。**没验**：本机复现不了那台 runner 的饱和度，只能靠这一推的流水线落锤（`1bfd601` 实测 success）。 |
| 2026-10-16 | 统计页副标题跟着档位说窗口 + 方法论来源划线查清是存量数据 | `Stats.tsx` 的 hero 副标题原先写死 `${年份} 年度阅读数据`，而下面那排 chip 是本周/本月/本年三档、KPI 与趋势图都跟着重取数 —— 选「本周」时标题说全年、屏上数字是 7 天，两句里只有一句是真的（09-21 那批立的"名字只有一套"漏了这一处）。窗口名收回 `READING_TREND_SPECS.chipLabel` 一份口径，年份改由锚点带出，判据 3 条（三档各说各的 + 脏/缺锚点 ⇒ 通用文案 + 认识不到的档位按本月兜底），变异两处各判红（写死一档 ⇒ 2 条红；撤脏值闸门 ⇒ 报出 '截至 NaN 年 NaN 月 NaN 日'）。**顺手扫其余标题**：KPI 卡与明细卡都取 `modeLabels`，只有 hero 一处漏。另一件登记很久的"方法论「出自你的划线」在真库上恒空"查清了：11 条全是 2026-09-12 单次生成的存量行（那时落库还写死空数组），血缘修复是 09-16 的 `90ebf36`，正向链路完好、`[]` 与"没数据"是同一件事；卡片那路能靠 `content` 全等做本地 SQL 回填（44/90 回来了），方法论的名字/步骤是 AI 改写的、**没有可对账的列**，只能重新生成（烧钱，未授权）。界面本身没错：`SourceHighlights` 空 id 直接不渲染。用例 2409 → 2412，覆盖 93.18 / 89.62 / 93.28 / 93.18。**没验**：真实模型会不会真给 `sourceIndexes` —— 09-16 之后库里没生成过任何一条，正向链路只证到单测。 |
| 2026-10-17 | 出包反证用例先查工作树；顺手修自己刚写坏的台账 | **`ff14bbf`（测试）**：那条反证会**真的改掉 `src/renderer/src/App.tsx` 约 30 秒再还原**，而这个目录正被另一路会话编辑 —— 09:19 我跑全量时对方 09:20:22 存了一次，`npm run build` 当场失败（一次红不属于任何人的代码）。比红更坏的是另一种走法：还原写回的是"用例开始时读到的那一份"，若对方的保存落在读取之后、还原之前，就把他**没进 git 的活**盖掉了，那种丢失不可恢复（这次侥幸没发生：事后核对 mtime 仍是他的保存时刻、dev-only 闸门与他的注释改动都在，变异无残留）。改法是动手前先 `git diff --quiet HEAD -- <该文件>`（0=干净、1=脏，**其他退出码一律抛出**，不把"查不出来"演成"干净"）；脏 ⇒ `ctx.skip(原因)` —— 是 skipped 不是 passed，摘要看得见、note 说清怎么让它跑；并把"闸门还在源码里"那条断言提到分支之前，脏不脏都说话。两分支都验过：本地脏树 `5 passed \| 1 skipped`、CI 干净树日志里 `1 skipped` 命中 **0 次** 且 `conclusion=success`（该支本地跑从 33.7s 降到 14.4s）。**`a083288`（文档）**：本表 10-17 那行我插错了位置（在被更正行的上面却写「上一行是错的」，按表格顺序那指的是 10-15 那行）、头部日期戳差一天、还有一处**裸竖线**把 10-16 那行劈成 4 格（`` `gh run watch --exit-status \| tail` `` 是 `bd02655` 写进去的）。三处都是排版与指向，事实一字未改。**量具又错一次**：我先用 awk 按竖线切分数格子，它把转义后的竖线也算分隔符 ⇒ "修好了"仍报异常，改用 Node 先把转义竖线让位再切分，才是**表头与每一条台账行都是 3 格、无一例外**（`tests/doc-figures.test.ts` 按规矩不看 §十，这类格式问题目前没有守卫）。 |
| 2026-10-17 | 更正上面「2026-10-16 CI 转绿」那行：不是 rpcTimeout，是同步构建冻住 worker | **那行关于 CI 的结论是错的**（就是上面那条 2026-10-16「CI 转绿…」，行首已加 ⚠️），原文留着不改，以这条为准。`bd02655`（只加一行台账）推上去又红同一个 `[vitest-worker]: Timeout calling "onTaskUpdate"`，这才去核实量具：Vitest 3.2 的 dist 里 `rpcTimeout` 出现 **0 次**，`createThreadsRpcOptions({ port })` 不传 `timeout` ⇒ 走 birpc 的 **`DEFAULT_TIMEOUT = 6e4`（60 秒，不是我写的 5 秒）** —— 所以 `1bfd601` 那笔配置是**空转的假开关**，它绿只是因为那台 runner 恰好没顶到 60 秒。真根因在 `tests/admin-not-in-bundle.test.ts`：`build()` 用 `execFileSync` **同步**跑三进程构建，把整个 worker 的事件循环占死，主线程对 `onTaskUpdate` 的应答处理不了（CI 实测这一支 64s > 60s）。`5984f7f` 改成 `promisify(execFile)` 异步等待，并**就地点了两次自己的错**：① 撤掉那个假键，`vitest.config.ts` 的原位注释改成这条事实的存档，免得下一个窗口再写一个看着像那么回事的开关；② 给根因配一条能证伪的判据 —— `beforeAll` 里放 50ms `setInterval` 计数器，构建结束断 `ticks > 0`；变异把 `build()` 换回同步 ⇒ 当场 `expected 0 to be greater than 0`。顺带被 `npm run typecheck` 抓到一处：`execFile` 的重载不认 `stdio`（它本来就把 stdout/stderr 收进 buffer）。实测该支 6 条绿、33.7s（比同步版 45s 还快）；`npm run verify` 退 0，130 文件 / 2412 用例、覆盖 93.18 / 89.62 / 93.28 / 93.18、lint 0 error + 174 warning；`5984f7f` 与 `7fda31f` 两笔 CI `conclusion` 都是 **success**（改动前那笔 `bd02655` 是 failure）。**但"两次绿"只算佐证、不算证明**：能扛住结论的是那条机制判据（构建期间事件循环必须还在跳），不是某一次流水线绿 —— 那行 10-16 的记录就是把一次绿当成了修好。**同类已量过**：`tests/design-tokens.test.ts:22` 也用 `execFileSync`，实测 `node scripts/build-tokens.mjs --check` 是 **312 ms**，离 60 秒差两个数量级 ⇒ 形状相同、风险不同，不动它。 |
| 2026-10-17 | 台账排版立成常驻守卫 + 摘掉一条墙钟假红 | **上一行末句「这类格式问题目前没有守卫」以本行为准：守卫有了。** `tests/agents-ledger-format.test.ts` 5 条，只管排版不碰事实（`tests/doc-figures.test.ts` 按既有规矩排除 §十 —— 历史行里的用例数、覆盖率是当年实测，拿今天的真值去改它等于伪造历史）。钉三件事：① 每行格子数等于表头（单元格里一根没转义的竖线就当场抓出；数之前必须先把转义竖线让位 —— 上一轮我用 awk 按竖线切分，它把转义过的也算分隔符，于是"修好了"照样报异常）；② 日期不回退（更正行必须排在被更正那行之后，位置写反的真实代价不是难看，是句子里「上一行」指向另一件事）；③ 两条反证 + 一条自检：往内容里加一根裸竖线格子数必须加一、加转义的必须不变，合成两行喂进顺序检查必须报出回退，找不到表头或行数掉到 8 以下就直接红（防止扫描口径变了而断言集体沉默）。**变异两处各判红**（在真文件里插裸竖线 / 把 10-15 那行挪到 10-16 之后），改完 `AGENTS.md` 与 HEAD 逐字节一致。**同批**：8 处文档口径由 130 文件 / 2412 用例改成 **131 / 2417**（新增一个测试文件就会动这些数，那条守卫按仓库现算）。**另一条假红**：上一轮 `npm run verify` 唯一一条红是 `tests/http-client.test.ts` 的 `sleep(0)` 断 `elapsed < 20`，单独跑 11 条全绿、本轮全量也绿 ⇒ 判为负载造成的墙钟假红（满负载时 `setTimeout` 回调本身被推迟，那个上界不是被测行为的属性）；改成只断「会 resolve、不挂住不 reject」并在名字里说清，`sleep(50) >= 45` 那条留着（下界，满负载只会更晚）。**顺带证实**：本轮 `App.tsx` 在对方手里确实是脏的，那条出包反证按上一行的新闸门自动 skip，全量摘要为 `2416 passed / 1 skipped (2417)` —— 闸门在真脏的树上说了话。`npm run verify` 退 0，覆盖 93.18 / 89.62 / 93.28 / 93.18，lint 0 error + 174 warning。**没验**：装机版界面没打开；守卫只证排版，历史行里的事实仍靠人读。 |
| 2026-10-17 | 「哪一天」收成一把尺 | 写入侧用 UTC 日、界面按本地日读 ⇒ 凌晨的活动记到前一天；微信读书的 epoch 是北京零点，整条阅读时长早一天。启动时一次性搬正（只搬一次、计数器不动）。全文见 `docs/agent-history.md`。**没验**：真实库还没跑过。 |
| 2026-10-17 | 「近 N 天」窗口与用量归日：同一把尺的第二、第三处 | 横扫同类又量到两处各算各的：① `stats/constants.ts` 与 `token-usage/format.ts` 各写一份"日期范围 → 起止"，都用本地 00:00 再 `toISOString()` 求起始日 ⇒ 东八区往前多一天，实测 `7d` **闭区间 8 天**，而消费方按行求和、还把行数当"天数"显示；② `token_usage` 三条 SQL 用 `date(created_at)`（UTC 日）配本地日键 ⇒ 北京早上七点那次调用被归到昨天（真库实测 0/38 行撞上，隐患不是幻觉）。收成 `db-time` 的 `windowEndingToday` / `shiftDayKey` 一份，判据钉的是不变量本身（**闭区间恰含 N 天**、跨年跨月、脏键 ⇒ null、凌晨与下午同一个窗口）+ 两处接线；`getDailyStats` 的天数改走参数，不再把数字拼进 SQL。**没验**：用量页与统计页界面没打开。全文见 `docs/agent-history.md`。 |
| 2026-10-18 | 同一把尺还剩四处没扫；宣传页上线并落守卫 | 上一批只钉了当时改到的两处，横扫又抓到四处各算各的：`cards.countNewIntroducedToday`（今日新卡按 UTC 日数）、`TokenUsage` 趋势横轴（**改了 SQL 归日却漏了横轴键，两边口径分家**）、logger 日志文件名、备份与复习 CSV 文件名，另三条集成测试照写 UTC 的"今天"、本地过零点当场红（10-17 那行末句"没验：真实库还没跑过"就是这一类的代价）。判据从"两个文件的清单"改成扫全树（注释行放过：`db-time.ts` 要在注释里写清旧写法错在哪）。另一件：设置页构建器表与调取面板图标表停在 5 路（09-24 注册文章/生词时没人跟着改，注释还自称"与注册顺序一致"），新增 `tests/context-builder-registry.test.ts` 把三处抄件对账到 orchestrator 注册。宣传页按实测改准（v1.1.0 改 v1.3.4、885 改 2484 用例、16 改 18 模块、5 改 7 维）并同步 gh-pages，数字与版本号各落一条守卫；`8208878` 把图标判据从"比清单"改成"比字形"，上岗当场又抓到第三处写死的条数（`PIPELINE_STEPS` 第 04 步）。**没验**：装机版界面没打开；宣传页只验到线上资源逐个 200。全文见 `docs/agent-history.md`。 |
