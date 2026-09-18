# 知行读书 — Agent Guide

> **面向对象**：所有 AI Agent（Claude Code / Cursor / Continue / Trae）
> **生效日期**：2026-07-20
> **配套规范**：[CLAUDE.md](CLAUDE.md) + [.learnings/LEARNINGS.md](.learnings/LEARNINGS.md) + [.learnings/PROGRESS.md](.learnings/PROGRESS.md)
> **最近核验**：2026-09-16（对代码与用户真实数据库实测校准；见第十章变更记录）

---

## 一、项目速览

**知行读书**（Zhixing Reader）— Electron 桌面应用，知行合一的阅读成长伙伴。

| 维度 | 详情 |
|------|------|
| 形态 | Electron 三进程桌面应用（Main / Preload / Renderer）|
| 框架 | electron-vite 2 + React 19 + TypeScript 5.6 strict |
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
│   ├── ipc/               # IPC handlers（按领域 12 文件，index.ts 统一注册）
│   ├── database/          # sql.js DB（16 个领域文件 + index.ts 出口 + schema.ts）
│   ├── fsrs-engine.ts     # FSRS-6.0 适配层（基于 ts-fsrs 5.4.1，对外 API 100% 兼容）
│   ├── agent/             # 智能体（意图分类 / 编排 / 策略）
│   └── services/          # 业务服务（RAG / 知识卡片 / Prompt 模板 / 启动修复）
│
├── src/renderer/          # Renderer 进程：React SPA
│   └── src/
│       ├── pages/         # 路由页面（Bookshelf / Review / Chat / Settings / ...）
│       ├── components/    # 通用 UI 组件（layout / chat / ui 等）
│       ├── stores/        # Zustand 状态管理（8 个 store）
│       ├── design/        # 设计系统
│       ├── utils/         # 渲染层工具
│       └── styles/        # Tailwind CSS
│
├── src/shared/            # 跨进程共享：类型 + IPC 通道常量
├── brand/                 # 徽标唯一真值（mark*.svg + grid.svg + README 规范）
├── scripts/               # 构建期脚本（build-icons.mjs：SVG → png/ico）
├── resources/             # 静态资源（dictionary.json / icon.png / icon.ico —— 后两者由脚本生成）
├── tests/                 # Vitest 单元测试（47 文件 / 877 用例）
│
├── .learnings/            # 经验与进度沉淀（⚠️ 本地文件，.gitignore 排除，不入库）
│   ├── LEARNINGS.md       # 踩坑与最佳实践
│   └── PROGRESS.md        # 路线图与待办
├── .workbuddy/memory/     # 会话交接记录（⚠️ 本地文件，不入库）
├── .github/workflows/     # CI（lint + typecheck + test + build）
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
npm run test             # Vitest（862 用例；不含覆盖率）
npm run verify           # 一键跑 lint+typecheck+test+build（推荐）

# 打包
npm run package:win      # Windows NSIS 安装包
```

> ⚠️ 原有的 `build-dict` / `seed:demo` / `loop:*` 共 6 个脚本已于 2026-09-11 移除 —— 它们指向的 `scripts/` 目录已不在仓库（commit `2361f9e` 清除）。词典现在只能使用已提交的 `resources/dictionary.json`。

**提交顺序**：lint → typecheck → test → build（**全绿才可提交**）。

---

## 四、Sub-agent 协作约定 🔴核心必读

### 4.1 文件所有权（防冲突）

所有并行 Sub-agent 按下表划分文件所有权（⚠️ `.claude/ownership.yaml` **未落地**，下表为准）：

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
  - 提示词模板、审查类目、反馈表达规范（⚠️ `.claude/rules/review-agent.md` **未落地**，7 维清单见第 9.3 节）
- **test-writer** — Vitest 用例生成（红绿循环）

> ⚠️ `.claude/` 目录当前**不存在**（`.gitignore` 明确排除 `.claude/`，换机后未恢复）。本节保留约定内容作为协作契约，落地文件待补。

---

## 五、自动化质量门禁 🔴核心必读

### 5.1 本地门禁（提交前）

| 门禁 | 命令 | 失败影响 |
|------|------|---------|
| ESLint 严格模式 | `npm run lint` | 阻塞 commit |
| TypeScript strict | `npm run typecheck` | 阻塞 commit |
| Vitest | `npm run test` | 未接入覆盖率门禁，仅断言全绿 |
| 覆盖率（可选）| `npm run test:cov` | 阈值 lines 83 / branches 80 / functions 75 / statements 83 |
| Build 全通过 | `npm run build` | 阻塞 PR |

**一键验证**：
```bash
npm run verify
```

### 5.2 CI 门禁（GitHub Actions）

每次 push / PR 自动跑：
1. ESLint
2. TypeScript
3. Vitest（⚠️ `npm run test` 不带 `--coverage`，CI 的 coverage artifact 目前不会生成）
4. 三进程 build

详见 [.github/workflows/ci.yml](.github/workflows/ci.yml)。

### 5.3 15 条硬性规则（违反即阻塞）

15 条规则正本（`.learnings/STANDARDS.md`）**未落地**，下表为速查口径：

| 类别 | 规则 |
|------|------|
| 🔴 安全 R1-R5 | 禁硬编码密钥 / 必参数化查询 / 错误响应不泄露 stack |
| 🟡 质量 R6-R10 | 覆盖率阈值见 `vitest.config.ts`（83/80/75/83）/ 文件 ≤ 500 行 / 圈复杂度 ≤ 15 / 目录 ≤ 4 层 / 0 lint 错误 |
| 🟢 规范 R11-R15 | Feature-First / 命名即文档 / Colocation / 配置外化 / Conventional Commits |

> ⚠️ 实测口径：`max-lines`、`complexity`、`max-depth` 在 `eslint.config.js` 中均为 **warn**（不阻塞）；仅 `max-params`、`prefer-const`、`eqeqeq`、`no-unused-vars` 为 error。故「违反即阻塞」仅对后四类成立。

---

## 六、领域专属规范

| 领域 | 规则文件 | 重点 |
|------|---------|------|
| 代码风格 | `.claude/rules/code-style.md` ⚠️未落地 | TS/React/Electron 细节；以 `eslint.config.js` + `tsconfig.json` 实际配置为准 |
| 安全 | `.claude/rules/security.md` ⚠️未落地 | R1-R5 + IPC 安全；红线见 CLAUDE.md §2 |
| Git | `.claude/rules/git.md` ⚠️未落地 | Conventional Commits；✅ husky pre-commit（lint+typecheck+test）+ commit-msg（commitlint config-conventional，header≤120）均 2026-09-18 装妥 |

---

## 七、关键注意事项（Gotchas）

来自 [AGENTS.md 根级规则](d:/ai/claude%20code/%E5%BE%AE%E4%BF%A1%E8%AF%BB%E4%B9%A6/AGENTS.md)：

1. **端口 5500 硬编码** — 不要单独修改 `electron.vite.config.ts` 或 `electron/main.ts` 的端口（原 5176 因 Windows Hyper-V 保留端口范围 5175-5274 多次调整，现为 5500，两处必须保持一致）
2. **sql.js 是 WASM** — 默认内存运行，持久化必须显式 read/write
3. **preload path 解析** — `getPreloadPath()` 尝试多路径，改 build 输出需同步
4. **Windows-only 打包** — electron-builder 只配 NSIS，无 macOS/Linux
5. **中文 UI** — 所有用户字符串保持中文一致
6. **preload.ts 已解包** — `window.electronAPI.xxx()` 返回的是 data，不要再 `.data` 二次解包

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
| `SYSTEM:RESET_DATABASE` | 重置数据库 15 张表 + `app.relaunch` | `database/schema.ts` `resetDatabase` |
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
| 测试 | 项目已有 Vitest（46 文件 / 862 用例；纯逻辑 + 组件测试）。新增功能应补 `tests/*.test.ts`，门禁跑 `npm run test` |
| 可访问性 | Modal `role/aria-modal/aria-labelledby` + ESC + 焦点管理 |
| 文档 | spec/tasks/checklist/verify-report 四件套 + 代码内注释 + 规范 commit message |

### 9.4 相关文件

> ⚠️ 下列 `.trae/specs/` 四件套**当前不存在**（`.trae/` 目录已不在仓库，换机后未恢复）；沉淀有效的部分见 `.learnings/LEARNINGS.md`。

- spec：`.trae/specs/dead-code-governance/spec.md`（未落地）
- 任务清单：`.trae/specs/dead-code-governance/tasks.md`（未落地）
- 验收 checklist：`.trae/specs/dead-code-governance/checklist.md`（未落地）
- 最终 verify report：`.trae/specs/dead-code-governance/verify-report.md`（未落地）
- 经验沉淀：`.learnings/LEARNINGS.md` LRN-20260721-006~010 ✅

---

## 十、变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-09-19（续） | **VIS 第二轮：字体本地化 + 中文字体栈补齐** —— 上一轮查出的两个遗留一起修：① `--font-sans` 只有 `"DM Sans"`（**无中文字形**），四个中文字一直在吃 Windows 默认回退，字体气质不可控；② 字体从 `fonts.googleapis.com` 拉（**桌面应用离线打不开、国内常被墙**）。现在三款字体全部本地打包：`@fontsource-variable/{noto-sans-sc,dm-sans,jetbrains-mono}`（**OFL-1.1，可变字重 100–900 一个文件**，devDependency，woff2 由 Vite 打进 `dist/renderer/assets`，实测 105 个 woff2 / 4.7MB / 最大分片 76KB，不进 git）。字体栈顺序是 **拉丁在前、中文在后**（`"DM Sans Variable", "Noto Sans SC Variable", "Microsoft YaHei UI", "PingFang SC", ui-sans-serif`）—— 反过来会让英文和数字换一套字形。OFL 义务：三份许可文本（含 `Copyright` 行）放进 `src/renderer/public/licenses/` 随包分发，关于页开源许可表加三行。**顺手删掉 `--font-serif`（定义了但全项目零消费的死 token）**。新增 `tests/typography-assets.test.ts` 8 条：无 CDN、依赖声明与入口引入、字体栈含中文族、拉丁族在前、许可文本存在且含版权行、关于页列出的字体数 = 3、死 token 不许回来。打包实测 `dist/renderer` 无 `fonts.googleapis.com`、CSS 里是 `url(./…woff2)` 相对路径（`file://` 下可用）、4 个 <4KB 子集被 Vite 内联为 base64（正常）。测试 877→885（48 文件） | AI Agent（接手） |
| 2026-09-19 | **品牌 VIS 第一轮 —— 徽标「玉璧」+ 图标生成流水线**（commit 5146f8e / bab6629）—— 起因是项目里躺着 **4 份互相打架的 logo**：`resources/logo.svg` 的渐变书只有官网在用、侧栏与关于页是 CSS 手写的绿方块「知」字占位、favicon 还是 Google 蓝 `#4285f4`。先做开源方案调研（结论：可商用的 text-to-SVG 模型输出的是重建 path 不是可维护几何；FLUX.1-dev / FLUX.2-klein-9B / Ideogram 4 / IconShop 全部禁商用或根本没 LICENSE；方正/汉仪做 logo 需单独授权），再落两套稿。**第一版「拾级」（台阶剪影）被用户否掉**——量了原因：平涂 emerald 满铺色块着墨率 **84%**，天生像系统默认图标。第二版「玉璧」：r=16 / 线宽 6 的环开 60° 口，缺口正中嵌 6×6 铜金方（知行合一，缺的那一步由「行」补上），着墨率降到 **23.3%**。**一套几何四种配色**（mark / mark-reverse / mark-icon / mark-mono），环与方的坐标在六处派生物里逐字相同，`tests/brand-assets.test.ts` 15 条钉住（含「方中心落在 −30° 角平分线、到圆心 16.12≈半径」的几何自洽断言）。三条实测踩坑：① **electron-builder 的 `app-builder icon` 不接受 SVG**（`icons.LoadImage` 直接报错），且从 PNG 只产出 256 一档 → ICO 必须自己写容器（`scripts/build-icons.mjs` + `npm run build:icons`，16/20/24/32/40/64/96/128/256 十档 PNG 压缩条目）；② **SVG 里的中文 `<text>` 吃本机系统字体**，换机器/CI 结果就变 → 字标将来必须转曲；③ **应用图标必须带底板**，无板的墨绿环贴深色壁纸会直接消失（品牌徽标不带板，两者共用同一组坐标）。配色立了新规：**品牌墨与 UI 交互色是两个口径** —— 新增 `--brand-ink #0c3b2e` / `--brand-brass #b08d57` / `--brand-paper #f5f1e8` / `--brand-mark`（暗档自动反白），`--primary` 仍是 emerald-600 一行未动。对比度全量实测：墨绿对白 12.50、宣纸对墨绿板 11.08、铜金对墨绿板 4.04、**铜金对白只有 3.09 → 铜金只做点缀不承载信息**。测试 862→877（46→47 文件）。**VIS 遗留**：字标（OFL 字体描骨后转曲，不能用字库直出）、`tokens/brand.json` 收掉 design-tokens.css 与 colors.ts 的双写 hex、**中文字体从未指定**（`--font-sans` 只有 DM Sans，四个中文字一直在吃 Windows 默认回退）且字体走 Google Fonts CDN（离线/墙内首屏会掉） | AI Agent（接手） |
| 2026-09-18（再续） | **B1 前置：先把死链砍干净，再谈迁移** —— 用脚本扫 preload 暴露面，查出 **27 个渲染层零消费者的方法**，逐个核实「主进程内部还有没有别的调用方」后砍掉 26 条真死链（通道 + handler + preload + renderer.d.ts 类型）：① 老通路整条手写流式实现（ai.streamChat + agent:streamChat + streamOpenAI(复杂度46) + streamAnthropic(40) + legacy cancelActiveStream）—— 渲染层走的是 STREAM_CHAT_WITH_CONTEXT，手写 SSE 那半壁早已被 AI SDK 取代且更完整；② 四个被界面弃用或被新功能取代的非流式函数（generateCards / generateSummary / chatWithContext(早标 @deprecated) / explainHighlight）+ skill.exportBatch + 8 个提示词模板（注册表 30→22）；③ 20 条数据读取死链（books:updateProgress、cards:getByHighlight/createBatch、reviews:getByCard、articles:getUnread/getFavorites、vocabulary:getByWord/incrementReview、dictionary:getSize、weread:fetchBookmarks/fetchNotes、readingData:fetch{Weekly,Monthly,Annually,Overall}、knowledgeCards:getByType/isDistilling、admin:getPrompt、fsrs:getForecast/getOptimalReviewOrder、preload stats:getWeekly 包装）。**保留了链路断了但实现仍活的**：cardsDb.getByHighlightId（单条建划线时防重复建卡在用）、vocabularyDb.getByWord、reviewsDb.getByCardId、weread-api 的 fetchBookmarks/fetchNotes（fetchAllContent 内部调用）、dictionaryService.getSize、knowledgeCardService.isDistilling（有测试）。顺手修一个测量缺陷：老通路解析响应时丢了 prompt_tokens_details.cached_tokens，导致统计页缓存命中率对这 8 个功能恒为 0（2 条新用例，红绿都验过）。结果：通道 188→162，ai-service 1664→1132 行，preload 541→521，fsrs-engine −42，测试 928→862（删的全是被砍功能自己的用例）。**踩坑一条**：判断「实现是否已成孤儿」时，grep 若把 electron/ipc/ 整个排除掉，就会把仍在 handler 里用的 cardsDb.getByHighlightId 误判成死的 —— 排除范围只能到「本次正要删的那个 handler」。B1 剩余：8 个仍活着的非流式函数迁 AI SDK（换成 generateObject + zod 后，模型不合财会从「repairJSON 修修能用」变成「抛错」，必须逐条真打 API 看形状，适合有人在电脑前时做）。commit 6a88bdb / 93ddc41 / f221c8f / 66838bc | AI Agent（接手） |
| 2026-09-18（续） | **巨型页拆分第二、三批（纯搬运，零逻辑改动）** —— DailyLearning 2190→1622（`pages/daily-learning/` ×4）、VocabularyPage 1972→1091（`pages/vocabulary/` ×5）、KnowledgeCards 1789→1058（`pages/knowledge-cards/` ×4）、Methodologies 1787→1004（`pages/methodologies/` ×5）。搬运块用脚本比对确认与原文件逐字相同，页面本体只换 import。**结论**：能整块搬走的顶层子组件已基本搬完，剩下 10 个 >1000 行的文件都是单个巨型组件本体（状态与 JSX 互相引用几十处），再拆需要能真点一遍 UI 的会话，不靠盲改。踩坑两条：enum 不在常规的 export 前缀清单里（ReviewRating 枚举漏迁一次）；删区间时容易连带删掉组件签名那行本身（typecheck 立刻抓到）。commit 4c30af7 / 5d21a38 / 42b477f / 613af17 | AI Agent（接手） |
| 2026-09-18 | **一次性清空六批债务（commitlint / Modal 收口 / 死代码 / 模型分档 / 层级摘要 / 巨型页拆分）** —— ① `.husky/commit-msg` + `commitlint.config.js`（config-conventional，header ≤120，`subject-case` 关闭放行中文），此前 R10 只靠人工 ② VocabularyPage 最后两处手写弹层迁 `ui/Modal`（抽屉生词详情 + 导出对话框），全应用 6 处弹层收口完毕 ③ `types/repositories.ts` 5 个无实现接口 + `sqlite3.d.ts` 删；`build.files` 白名单 84→50 项（只留 node_modules 里确实没有的）；preload 监听器改造前先核实：**12 个调用点全部成对注销，改造零收益**，改为把「必须持有返回的清理函数」写进注释 ④ **主线 A Step 6 模型分级路由**：`src/shared/model-routing.ts`（`resolveChatTier`，白名单意图 casual_chat 走经济档）+ 设置项 `llmModelFast` + orchestrator 传 intent，未配置时恒走主模型 ⑤ **主线 A Step 5 书籍层级摘要（RAPTOR 简化）**：新增 `chapter_summaries` 表（第 16 张）+ `chapterSummariesDb.upsertBatch`（sql.js 落盘是全库导出，一次生成只导盘一次而不是 N 次）+ `src/shared/chapter-summaries.ts` 纯判定（分章、按「该章划线条数」判新鲜度、注入文案必须标明是 AI 概括）+ `chapter-summary-service`（L1 逐章 → L2 由 L1 汇总；L1 没变就不重烧 L2；同书并发直接报错，防双份 AI 花费）+ 4 个提示词模板（注册表 26→30）+ IPC `SUMMARIES.GET_CHAPTERS/GENERATE` 全链路 + BookDetail 新增「摘要」页签与「生成 AI 摘要」入口 + `book-context-builder` 在关联书籍时注入全书摘要与 BM25 挑出的 3 章摘要。**顺带查出**：`book_summaries` 表和它的 IPC/preload 一直全在，但**渲染层零引用**（第 6 个断链），且 `BookSummary` 类型写的是 `content/createdAt` 而真实列是 `summary/generated_at` —— 现在两头对齐并真在界面上显示 ⑥ 巨型页第一批纯搬运：Stats 2993→553（`pages/stats/` ×7）、TokenUsage 1612→974（`pages/token-usage/` ×6）、SettingsData 1541→1185（`data-utils.ts` + `use-data-io.ts`），逻辑一行未改。测试 895→928（44→47 文件），`npm run verify` 退出码 0（lint 0 error / 202 存量 warning），已推送 | AI Agent（接手） |
| 2026-09-16 | **默认对话路径的「零上下文」修复 —— 检索第一次在真实使用中生效** —— 上一轮把中文切词修好了，但**默认路径根本不会调用它**：`book` / `knowledgeCard` / `methodology` 三个构建器的 `shouldBuild` 都要求 `!!context.bookId`，而从首页进入「AI 对话」时是不选书的（对话框上的「关联书籍」是一个可选的虚框按钮）。在**打包后的应用**上实测（CDP 发一条真实提问）：「调取知识库」只有 **2/2 路**（相关记忆 + 用户画像），`promptTokens` 仅 **358**，AI 回答「你提供的笔记里并没有直接出现…」—— 934 条划线一条都没进提示词。修法：三个构建器不再以「有没有选书」为门槛 —— 选了书只搜那本书（用户显式意图），没选书就跨全部书籍 / 全部卡片 / 全部方法论检索，并在注入文本里写明「来自你的全部书籍，与当前问题无关就忽略」。同时修掉三个同源缺陷：① 卡片与方法论的相关性打分原来是拿**用户整句**去 `content.includes(...)`（中文没有空格 → 几乎永远为 false），于是「相关卡片」实际是按数据库顺序硬塞 10 张、分数全是 0；现在复用 `src/shared/retrieval.ts` 的 BM25 + 中文 bigram，只注入真正命中的，一条都没命中就不注入（面板如实显示「无命中」）② `searchIndex` 的噪声词过滤只看出现比例，1~2 篇的小语料里**唯一的信号会被当成噪声整段丢掉**（实测知识卡片命中数恒为 0），加了下限 `df >= 3`（真实 934 条划线语料的行为完全不变）③ 卡片类型读的是不存在的字段 `card_type`（列名是 `type`），所以「【卡名】(类型)」里的类型从来没显示过。**打包实测（用户真实数据，一次真实提问）**：934 条划线建索引 →「作者怎么看人际关系」命中 **5 条 / topScore 17.2**，方法论 **1/11**、知识卡片 **5/90**，`promptTokens` **358 → 1252**，回复末尾出现「**引用来源：5 个片段**」。新增 5 条测试（含「没选书也要检索」「不相关就不注入」）。测试 880→885（42 文件） | AI Agent（接手） |
| 2026-09-16 | **按计划执行 15 个任务（轻量 RAG + 交互审计遗留全清）** —— 完整计划见 `docs/superpowers/plans/2026-09-16-lightweight-rag-and-fixes.md`（6 个阶段 / 15 个任务 / TDD）。核心是**用本地词法检索替换掉从未生效的向量语义检索**：① 新增 `src/shared/retrieval.ts`（BM25 + 倒排索引 + 中文 2 字滑窗，零依赖零网络）；② `rag-service` 退化为「取数 → 按签名缓存索引 → 调纯函数」的适配层，签名含**写计数器**（`updated_at` 只到秒，同秒内的导入+回填不会触发重建）；③ 删除 Vectra + embedding-service + `vectra` 依赖（少约 50 个传递依赖）。**实测验收（用户真实 934 条划线，零 AI 调用）**：「作者怎么看人际关系」命中《被讨厌的勇气》「第二夜 一切烦恼都来自人际关系」；修复前同四个问题命中 **0 条**。其余 12 个任务：生词本「加入复习」不再偷记一次评分、评分防连点、导出改为导出全部；统计页两套时间范围各自说清、书单行真能点；Token 页 KPI 口径不再被列表筛选截断；备份导出补全知识卡片/方法论/生词且导入真的恢复（含复习卡片按划线重建）；删除 4 个无人消费的模板开关；KPI 卡片要么真能点要么不装；每日学习筛选为空不再假装显示全部、翻页下标统一、复习可连续；空状态补出口、提示词中心四处；后台搜索/筛选范围如实标注；**砍掉 book_architecture 全链路（-299 行）**；系统加密不可用时如实告知密钥为明文。测试 888→880（42 文件，删掉 13 条测试死代码用例、新增 22 条检索用例） | AI Agent（接手） |
| 2026-09-16 | **AI 检索链路修复：中文提问原来是"零上下文"** —— 顺着「向量索引目录只有 79 字节」查下去，发现三个叠加的断点：① **中文切词是错的**：`keywordSearch` 用 `query.split(/[\s,，。？?！!、]+/)` 切词，而**中文句子没有空格**，整句会变成一个"词"（如「作者认为人际关系重要吗」），拿去 `includes` 几乎永远为 false —— 实测用真实数据库对比：**四个日常中文问题，旧切词命中 0 条划线；改成 2 字滑窗 bigram 后命中 33~79 条**。② **空索引被判成"可用"**：`checkRAGAvailability` 只看索引文件能不能打开，不看里面有没有向量（实测 0 条），于是走语义检索拿到空结果；③ **空结果不回退**：语义检索返回 0 条时 builder 直接把空数组返回，不落回关键词检索 —— AI 就带着零条书籍上下文回答，日志还写着 "Using RAG semantic search"。附带查清：语义检索在本机本来也用不了（DeepSeek 没有 /embeddings 接口，日志里 "Failed to generate embedding"），而索引只在「新建划线」这一条 IPC 路径写入，**微信读书导入的 934 条划线从未被索引**，`rebuildIndex()` 也没有任何调用方 —— 也就是说关键词检索一直是唯一的上下文来源，而它是坏的。修完三处后，中文提问能真正检索到自己的划线。新增 12 条测试（`tests/rag-keyword-search.test.ts`）钉住中文命中行为。测试 875→888（41 文件） | AI Agent（接手） |
| 2026-09-16 | **交互逻辑审计（4 个并行子代理 × 全页面）** —— 起因是用户点名：「交互逻辑有没有问题，特别是一个页面俩三个按钮都指向一个功能的」。审计出的问题分四类，**共修 40 余处**：① **重复入口**：首页 hero 三个按钮两个与导航重复、书架页**三个**「同步」按钮同一个函数、书籍详情「在微信读书打开」同屏两次、顶栏刷新按钮与通知面板「立即同步书架」同一个 handleSync、账户页两个一模一样的开关、智能体页「保存配置」=「保存模板」、关于页「问题反馈」=「常见问题」、方法论「开始练习」两个入口、统计页点当前时段 = 点刷新；② **名不副实**：顶栏「今日复习」跳去没有复习入口的知识卡片页、「刷新数据」实际是全量同步、首页「同步微信读书」只跳设置页、搜索框说能搜笔记卡片其实只搜书名、档案页「分享」只是复制文本；③ **假控件与假数字**（最严重）：设置页存储用量 12.3/45.2/128.5 MB 是**写死的常量**（现已改为向主进程要真实文件大小，量不出显示「—」）、微信读书页 **13 个空控件**（同步范围/同步分类/自动化开关，其中「仅同步所选分类的书籍」是写在界面上的假承诺）、知识卡片「反思」筛选永远 0 结果、没有实现的「更换头像」死按钮、「已是最新版本」写死徽章、清理历史写「共 1,284 条」而实际删的是全部 AI 对话；④ **数据风险**：「重新蒸馏/重新提取」对每张卡都是纯 INSERT、**没有任何 delete** —— 对已有内容的书再点一次会成倍翻（现已支持 replace：AI 成功后才清空旧数据，且界面先弹确认）。另修：对话「清空历史」「删除会话」补二次确认、每条 AI 回复的「重新生成」其实只重跑最后一条（现只保留在最后一条回复上）、收起搜索框不清关键词、复习完成态键盘可静默重评、`data-dom-id` 冲突。测试 875 用例（40 文件）不变 | AI Agent（接手） |
| 2026-09-16 | 每日学习重做（**用户原话：「这些真的能做吗，不能做只是形式的删去」**）—— ① 修掉任务标题前凭空出现的「0」：sql.js 读出来的 `is_read` 是数字 0/1，类型却写着 boolean，于是 `{task.done && <Icon/>}` 在未读时求值为数字 0 并被 React 当文本画出来；在边界处归一化成真 boolean（`normalizeArticle`）② **砍掉 4 项纯形式任务**：整理今日笔记 / AI 对话：探讨今日阅读内容 / 写卡片笔记 2 张 / 总结反思今日（点一下弹 toast 说已完成）—— 它们的共同点是没人知道你做没做 ③ 清单只留 4 类**系统自己知道做没做**的事：阅读（`articles.is_read`）/ 复习（真实卡片队列 actionable）/ 生词（`last_review_at`）/ 对话（`conversations.updated_at`）④ 顺带修两处错：旧的「复习 12 张卡片」取的其实是**生词**到期数却写着卡片、还跳到卡片页 —— 现在用真正的卡片队列并跳复习页 ⑤ 删掉手点勾（localStorage 覆盖），勾本身改成纯状态点，进度环不再能被点出来 ⑥ 左卡片「已用时间 / 预计剩余」是把写死的 30/15/10 分钟加起来编出来的，换成真实的「今天已复习 N 张 / 今天已阅读 N 分钟」⑦ 规则抽成纯模块 `src/shared/daily-tasks.ts`，15 条测试钉住「不许再出现没有判定依据的任务」。测试 860→875（40 文件） | AI Agent（接手） |
| 2026-09-16 | 数据血缘修复（**量真实数据库找出来的 5 个断点，全部修完**）—— 方法：先查 `%APPDATA%\zhixing-reader\zhixing.db`，列「应该有的 vs 实际有的」，差值为 0 的字段去代码里找断点。① 934 条划线章节名 **0/934**：`fetchAllContent` 明明取了 `chapters` 对照表，三个导入入口全丢掉了；新增 `src/shared/weread-content.ts`（章节名解析只留一份）+ `import-weread-content.ts`（导入逻辑只留一份，改为 upsert 补空）② 90 张知识卡片来源划线 **0/90**：提示词从没问过"来自第几条"，写入时写死 null；新增 `sourceIndex` 让 AI 回答来源并在**每批内**换算成真实划线 id（分批偏移坑）③ 对话意图 **0/21**：orchestrator 算出来了只写日志，现在随 retrieval done 事件下发并落库 ④ 对话引用来源 **0 条**：`RAGSource.chunkId` 是 **Qdrant 时代**的字段名（Qdrant 早已移除），且 builder 把 bookId/highlightId/relevanceScore 全丢了；`shared/types.ts` 新增唯一真值 `RagSourceRef` 一路串到渲染层 ⑤ `daily_stats.reading_time` 恒为 0：ADD_READING_TIME 通道/handler/repository 全在，渲染层从未调用；改为从微信读书 `/readdata/detail?mode=monthly` 同步（累加改覆盖，月度是全量快照）。另修：`getRetrievability` 与 ts-fsrs 逐点对齐、测试 fixture 复用生产 schema。**再补一层**：五个断点修好的只是"以后"，历史数据不会自己变好，而回填入口都藏在设置页按钮里 —— 新增 `electron/services/startup-repair.ts`，应用一打开自动补卡片来源（纯本地）、划线章节名（先查缺口，**没缺口时零请求**，12 小时节流）、阅读时长（6 小时节流），失败不影响启动。启动实测：44 张卡片补上来源、927/934 划线补上章节名（余 7 条正文为空、按定义补不了，已排除以免反复重拉）、阅读时长写入 7 天 3252 秒。测试 790→875（40 文件） | AI Agent（接手） |
| 2026-09-15 | 算法数字换人话（**"我很多也看不懂"的直接回应**）—— 新增 `src/shared/fsrs-voice.ts`：把 FSRS 状态翻译成「一句陈述 + 一个动作」（`describeForgetting` / `describeNextReview`），全应用共用一张嘴。三条硬约束写进测试逐条守住：① 只说结论不请用户评判算法（否则评分信号被污染，而那是 FSRS 唯一真值输入）② 没数据就闭嘴绝不编日期 ③ 不许用亲切的词撒谎（12 天不能说成"这周"）。界面改动：复习页卡片背面「记忆稳定性 46.35 天 / 当前保持率 87%」→「已经拖了 4 天没复习 · 现在花 10 秒？」；评分后「掌握度 32 → 41」→「好，我 12 天后再来问你」；完成态「平均稳定性 12.3 → 46.4 天」→「最远的一张能记到 9月28日」；生词本抽屉两个数字合并成一句。原始数字收进「为什么这么说」折叠，想核对的人随时能展开。测试 764→790（34 文件） | AI Agent（接手） |
| 2026-09-15 | 每日新卡上限（**修复"用户为什么不每天打开"的真正原因**）—— 实测用户数据库发现 934 张卡片里只有 10 张被复习过，931 张已逾期堆在三个过去的日期上：微信读书同步把全部划线一次性变成"今天就到期"的卡片，而 getDueCards 是 WHERE due <= now，**全项目没有任何每日上限**。用户每次打开复习页看到"931 张待复习"，一个永远做不完的清单。修复：新卡（state=0）与复习卡分开排队，新卡每天最多放 newCardsPerDay 张（默认 15，可设 0 暂停）；getReviewStats().due 语义修正为只统计已学过且到期的卡（900+ 那个数字的来源）；新增 CARDS.GET_QUEUE_STATS 全链路与首页"今天：复习 3 张 · 新卡 15 张"展示；设置页新增「每日新卡上限」。测试 741→764（33 文件），src/shared/study-limits.ts 100% 覆盖 | AI Agent（接手） |
| 2026-09-15 | 生词本三个正确性缺陷 + 测试 schema 去重 — ① **评分档位错位**：界面用 SM-2 风格 1/3/4/5 传评分，主进程映射表 {1:1,2:2,3:3,4:3,5:4} 把「困难」(3) 记成 Good(3) → ts-fsrs 的 Hard 档在生词本里完全不可达；统一为「界面直接传 Rating 1-4」并删除映射表 ② 新词自举写死 Rating.Good → 刚学就忘和轻松想起拿到相同初始状态 ③ 毕业时无条件重新自举 → 冲掉已累积的稳定性（连续复习 6 次 stability 恒为 2.3065，间隔长不起来） ④ is_mastered 改为仅用户显式设置（原复习满 5 次自动置位会让词被 getDueForReview 永久排除） ⑤ 生词本掌握度由 familiarity_level 代理改为 FSRS 推导（原显示 80%「已掌握」而真实分数 29） ⑥ **测试 fixture 复用生产的 applySchemaAndMigrations()**，删掉 280 行复制粘贴的平行 DDL（该漂移已两次导致 "no such column"）⑦ 测试 733→741 | AI Agent（接手） |
| 2026-09-15 | 复习闭环「看得见」—— 卡片掌握度 — ① 新增 `src/shared/fsrs-metrics.ts`（main/renderer 双端复用的纯函数）：`getCardMastery()` 由 FSRS 的 stability/difficulty/reps/lapses 推导 0-100 掌握度，`getRetrievability()` 复刻 FSRS-6.0 遗忘曲线并与 ts-fsrs 逐点校验一致 ② 复习页显示掌握度徽标 + 当前保持率，评分后给出「掌握度 X → Y」即时反馈，完成态展示本轮真实统计（复习张数 / 平均稳定性 A→B / 掌握升降）③ 书籍详情卡片列表补上划线摘要与掌握度徽标（原只有「卡片 #a1b2c3」）④ 修正 `card.review` 的返回类型（原声明 `Promise<Review>`，实际是 `{ reviewId, card }`）⑤ 按 B11 决策树**砍掉**不可达的 `CARDS.UPDATE_MASTERY_LEVEL` / `UPDATE_APPLICATION_TAG` 全链路（通道+handler+preload+repository），DB 两列保留但不再写入 ⑥ 修复 `npm run test:cov` —— `@vitest/coverage-v8` 锁在 2.0.0 与 vitest 2.1.9 不匹配导致覆盖率命令直接崩，重新生成 lock 锁到 2.1.9 ⑦ 测试 703→733（32 文件），覆盖率 90.4/83.5/93.0/90.4 全过阈值 | AI Agent（接手） |
| 2026-09-11 | FSRS 真值对齐 — ① ts-fsrs@5.4.1 实测实现的是 **FSRS-6.0 / 21 参数**（库内 `FSRSVersion` = "using FSRS-6.0"，`default_w.length` = 21，`FSRS6_DEFAULT_DECAY` = 0.1542），全仓库 "FSRS v5 / 19 组权重 / Anki 23.10+ / `(1+factor·t/9S)^decay`" 表述校正 ② **修复词汇间隔恒为 1 天**：`_nextIntervalVocabulary` 公式符号写反（`(1/R)^(1/decay)-1` 恒为负 → 被 clamp 到 1），且把 SM-2 的 efFactor 当记忆稳定性用；现词汇与划线卡片共用同一 ts-fsrs 实例，记忆状态持久化于 vocabulary 表新增的 stability/difficulty/lapses 三列 ③ 修 `w` 长度 <19 被静默忽略（17/19/21 均可下发，与库 checkParameters 对齐）、`getParameters().w` 由 slice(0,17) 恢复为完整 21 ④ 测试 698→703 | AI Agent（接手） |
| 2026-09-11 | 接手核验校准 — 修正 Qdrant→Vectra、fsrs-engine v1→v5 适配层、database/ 文件数、测试数（667→688）、覆盖率门禁口径（未接入）、`.claude/` 与 `.learnings/STANDARDS.md` 标注未落地、`.trae/` 四件套标注缺失；删除 §9.3「项目无测试框架」错误陈述 | AI Agent（接手） |
| 2026-09-11 | 遗留问题治理 — ① 补全 **Skill 导出全链路**（新增 `SKILL.EXPORT_FILE` 通道 + 方法论详情页「导出为 Skill」按钮，此前 handler/preload/AI 服务/测试齐全但无 UI）② 删除 6 个指向已消失 `scripts/` 的死脚本 ③ 清理 eslint 失效 grandfather 条目 ④ 明确 `.learnings/`/`.workbuddy/memory/` 为**本地文件不入库**（含内部策略与已知问题，不进公开仓库）⑤ `diagrams/`、`html2pdf-ultra.js` 显式 gitignore ⑥ CI 移除永不产出的 coverage artifact 步骤 | AI Agent（接手） |
| 2026-08-28 | v1.1.0 维护迭代 — 换机恢复 + 去伪存真（假数据/死链治理）+ 间隔复习与 Token 统计落地 + 画像注入 + database/ipc 拆分 + 编排页迁入设置壳层 + 管理后台移出前端；端口勘误 5275→5500 | AI Agent |
| 2026-07-20 | 初始化（v1）— 加入 .claude/、CI、Vitest、AGENTS.md | AI Agent |
| 2026-07-21 | 死代码治理循环工程收尾 — 新增第九章"死代码治理经验" + 7 个 IPC 通道清单 + 7 维质量评分基准 | dead-code-governance verifier-subagent |
| 已处理 | husky pre-commit hook 安装（2026-09-18：lint+typecheck+test 三连）| — |
| 已处理 | commitlint 配置（2026-09-18：config-conventional + commit-msg 钩子，R10 不再靠人工）| — |
| 待补 | `.claude/rules/*` + `.learnings/STANDARDS.md` 正本（被多处引用但不存在）| — |
| 待补 | `.trae/specs/dead-code-governance/` 四件套 | — |
| 已处理 | `scripts/` 相关 6 个死脚本已从 `package.json` 移除（2026-09-11）| — |
