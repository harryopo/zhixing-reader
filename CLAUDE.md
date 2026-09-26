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
| `npm run test` | vitest 全通过（1022 用例）| 手动 + CI |
| `npm run test:cov` | 覆盖率（阈值 83/80/75/83）| 手动（**未接入 CI**）|
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
| 🧊 冷 | `docs/superpowers/specs/*.md` ⚠️不存在 | 历史设计文档（目录已不在仓库）|
| 🧊 冷 | `docs/research/*.md` | 调研报告 ✅（⚠️ `docs/` 被 gitignore，不入库）|
| ❄️ 冻 | 代码本体 + 注释 | 不沉淀 |

---

## 8. 项目状态（2026-09-21 更新）

- **当前版本**：v1.3.4（2026-09-23 发布；维护迭代期，比赛已于 2026-07 结束）
- **git 锚点**：tag 序列 `v1.0.0` → `v1.1.0` → `v1.2.0` → `v1.3.0` → `v1.3.1` → `v1.3.2` → `v1.3.3` → `v1.3.4`（发版即打 tag 并推，Release 三件同传：exe / `.blockmap` / `latest.yml`）
- **未处理项追踪**：以本文件 §9 表为准（原 `docs/项目自检_优化方案_2026-07-20.md` 已不在仓库）；Token 优化调研见 `docs/research/token-optimization-plan.md`（**Step 1-3 已落地**，Step 4 核查为已实现，Step 5-6 待做）
- **主方向**：修复使用 bug、假数据/死代码治理、落地未完成功能、技术债消化
- **门禁基线（2026-09-25 搜索与筛选器对齐实测）**：typecheck 0 错误 ✅ / ESLint 0 error（183 warning）✅ / **89 文件 · 1340 用例** ✅ / `npm run verify` 退 0（覆盖率 **89.86 / 85.15 / 93.45 / 89.86**，被统计文件 59）✅。全局搜索（SQL LIKE）与各页那台筛选器（本地 includes）三处字段清单漂了没人发现：搜索不搜卡片「应用」与书名、方法论页不搜 steps、生词本那条 SQL 不分词也不转义 `%`。判据不比对清单而**比结果集合**（`tests/search-filter-parity.test.ts`：同一关键词下搜索报的条数与 id 必须落进页面自己筛出的集合），分词与字段清单收进 `src/shared/page-filter.ts`；卡片/方法论的搜索链接从 `?q=` 变成 `?q=&item=`，落地直接翻开那一张。**造数据踩到一条**：中文"正文里没有锚点"这种负向用例本身就把关键词包住了，四条全绿是假的，换 ASCII 生造词才红。真机：时间 ⇒ 搜索 12 / 页面「把 12 张加入复习」12、带 item 落地 291 字（背面）vs 137 字（正面）；的 ⇒ 方法论详情开的是点进去那条。装机版没跑过这批。
- **门禁基线（2026-09-25 数据库守卫实测）**：typecheck 0 错误 ✅ / ESLint 0 error（183 warning）✅ / **88 文件 · 1333 用例** ✅ / `npm run verify` 退 0（覆盖率 **89.74 / 85.12 / 93.19 / 89.74**，被统计文件 58）✅。上一提交列的"还有 20 个零调用方法"清完，实删 23 个（守卫一轮一轮把失去调用方的下一层报出来：`cards.createBatch` ← `highlights.createBatch`、`cards.getByState` ← `getNewCards`、`cards.findByManySources` ← `createBatch`），`electron/database/` +2 −267。新增 `tests/db-method-consumers.test.ts` 5 条：**数据库模块导出的每个方法都必须有人调用**，没有豁免名单；反证含"造一个孤儿必须报、跨行链式算调用、`count` 不许被 `countByBookId` 冒充、不许从 db 对象解构方法"。删掉 5 条"给已死方法写的测试"，4 条断言换读法、期望一字未改。装机版没跑过这批（纯内部收口，判据只有 typecheck + 用例这一层）。
- **门禁基线（2026-09-25 数据库层复扫实测）**：typecheck 0 错误 ✅ / ESLint 0 error（184 warning）✅ / **87 文件 · 1333 用例** ✅ / `npm run verify` 退 0（覆盖率 **88.93 / 85.11 / 91.07 / 88.93**，被统计文件 58）✅。上一批留下的下半件事做完：12 个界面已无消费者的数据库函数删掉（`electron/database/` −103 行），10 处测试断言改走活口、期望一字未改，`bookSummariesDb.delete` 那条改成断言"删一本书带走它的摘要"（外键级联），`sql-column-whitelist` 的豁免清单同步少一条。**判据**：删完跑 typecheck，生产侧零报错即证明没人调用（跨行链式调用也照样解析）—— 清点脚本那侧的坑记一条：把空白全删掉再匹配会让 `returntokenUsageDb.count(` 丢词边界，把在用的函数误判成零调用。清单里 `vocabularyDb.getById` 是上一批记错的（被本模块自己调用三次），留着。**同一把尺扫出还有 20 个方法零生产调用**，列进下一批并补永久守卫。装机版没跑过这批（纯内部收口）。
- **门禁基线（2026-09-25 相关度排序实测）**：typecheck 0 错误 ✅ / ESLint 0 error（184 warning）✅ / **87 文件 · 1334 用例** ✅ / `npm run verify` 退 0（覆盖率 **88.64 / 85.07 / 90.29 / 88.64**，被统计文件 58）✅。上一批那条 `❌ 没做相关度排序` 的欠账收掉：每类的行一次取完、按「命中次数（封顶）+ 标题加权 + 长度密度」打分，与 LIKE 用同一个"命中"关系（没用 `retrieval.ts` 的 bigram BM25，单字关键词在那套下会全 0 分）。真机 `时间` ⇒ 前 3 条含关键词 4 / 3 / 2 次、原时间序第一条落到第 4、报数仍是 35 条、一次搜索 5~8ms。装机版没跑过这批。
- **门禁基线（2026-09-25 多词搜索实测）**：typecheck 0 错误 ✅ / ESLint 0 error（184 warning）✅ / **87 文件 · 1325 用例** ✅ / `npm run verify` 退 0（覆盖率 **88.35 / 84.94 / 90.01 / 88.35**）✅。上一批自己记的两个缺口一起收：① **多关键词按空格分词做 AND**（`splitQueryTerms` 去重保序），WHERE 由 `buildWhere(likeColumns, terms)` 现拼 ⇒ `(列A LIKE ? OR 列B LIKE ?) AND (…)`，行查询与 `COUNT(*)` 共用同一次拼装；**列清单从字符串改成数组后，加一列只改一处**（原来是两条 SQL 各写一遍 WHERE）。笔记页那台筛选器本来就是 `terms.every`，现在两边同一套语义 ——「复利 时间」在两处给同一个答案。② **`assertLikeCount` 自动作废、换成 `assertPlaceholderCount`**：WHERE 由列清单生成后，"LIKE 个数对不对"成了同义反复；真正会错的是 `?` 与 params 对不上，于是核对那个。**判据要跟着改动走，结构变了还硬留旧断言，得到的是一条永远绿的测试。** ③ **措辞改正**：「列出其中最相关的」→「列出最**近**的」（排序一直是 `created_at DESC`，没有相关度评分这个词用大了）。**真机**（CDP）：`的 我` ⇒ 搜索页「划线 共 616 条 · 列出 8 条」，点「看全部」跳到 `#/notes?q=的+我` 后**笔记页自己那句筛后计数也是 616** ⇒ 两个词、两台筛选器、一个数 ✅；顶部文案「找到 649 条与「的 我」相关的内容，下面列出最近的 19 条」✅。**没验的**：❌ 词数很多时的耗时（词数 × 列数 = LIKE 个数，十个词四十个绑定，没量过）；❌ 装机版没跑过这批。
- **门禁基线（2026-09-25 搜索报数实测）**：typecheck 0 错误 ✅ / ESLint 0 error（184 warning）✅ / **87 文件 · 1325 用例** ✅ / `npm run verify` 退 0（覆盖率 **88.35 / 84.98 / 89.97 / 88.35**，被统计文件 58）✅。上一批的 `total` 是"列出来的条数"（每类受上限约束），界面写「划线 8 条」而库里命中 916 条 —— 自己埋的口径缺口，这批补上：每类多跑一条 `COUNT(*)`，分组加 `matched`、结果加 `matchedTotal`；**列清单与 `from` + `where` 由行查询和 COUNT 共用一份**（拆两份迟早漂成"报的数与给的行不是同一批"）。截断时写「共 916 条 · 列出 8 条」并给**「看全部」**，没截断就只写条数、**不给按钮**（`seeAllLink('article')` 返回 `null`：文章那页没有关键词筛选，给个点了不反应的按钮比不给更糟）。**顺带修一条实测出来的不一致**：搜索只搜正文 + 笔记（832），笔记页那台筛选器还搜章名与书名（916）⇒ 同一关键词两个数，于是把 `chapter_title` 与 `b.title` 加进搜索条件（`patternCount` 2 → 4，两条新用例分别钉章名命中与书名命中）。`VocabularyPage` 的关键词改成"调用方传进来"（原来 `handleSearch` 与 `loadVocabulary` 各发一条查询，同一件事两条路）。**真机**（CDP 连重启后的开发版）：`的` ⇒ hero「找到 1023 条…列出其中最相关的 26 条」、分组「划线 共 916 条 · 列出 8 条 看全部」，**点「看全部」落到 `#/notes?q=` 且笔记页自己那句筛后计数也是 916** ✅；生词本带 `?q=` 进来时列表 5 条 == `matched` ✅。**探针坑**：测"带 `?q=` 落到那一页"必须从**另一条路由**过去（同路由只改查询参数不重新挂载，`useState` 初值不重算，会误判成筛选没生效）。**没验的**：❌ "列出其中最相关的"里的相关性目前等于按时间倒序，没做相关度排序；❌ 一万条以上库的耗时；❌ 装机版没跑过这批。
- **门禁基线（2026-09-25 全局搜索实测）**：typecheck 0 错误 ✅ / ESLint 0 error（184 warning，新代码没带老债）✅ / **87 文件 · 1325 用例** ✅ / `npm run verify` 退 0（覆盖率 88.26 / 84.82 / 89.93 / 88.26，**被统计文件 56 → 58**）✅。顶栏搜索框过去只搜书名，现在一个关键词同时找**划线 / 知识卡片 / 方法论 / 文章 / 生词**：`src/shared/global-search.ts` 一份约定（类名、每类上限 8/6/6/6/6、片段截法、链接拼法），`electron/services/global-search.ts` 一次查完五类（**不在渲染层拼五次** —— 那是把"搜哪些类、每类几条"抄成两份口径），通道 `search:global`（**143 → 144**，ipc 领域文件 11 → **12**）。三条设计细节值得记：① 片段把命中那句**挪到中间**而不是从段首截（长段落里从段首截等于没给上下文），划线**正文不命中而笔记命中**时取笔记；② `%` `_` `\` 按字面转义 + `ESCAPE '\'`（测试里搜 `%` 断言零命中，同时验住"转义没生效"那种坏法）；③ 每类 SQL 的 `LIKE` 个数与 `patternCount` **逐次核对**（`assertLikeCount`），少一列静默漏搜比报错糟。深链分三种：划线走既有 `source-anchor` 精确到那一条、生词走 `?item=`、卡片与方法论没有"按 id 打开"的入口就带着同一个关键词让那页自己的搜索框筛（新加 `?q=` 初值）。**顺手把 `tests/doc-figures.test.ts` 的锚点扩到三条**（README「N 大功能模块」== 表行数、「N 个页面文件 / N 条路由」== 扫目录与 `App.tsx`）。**真机对账**（CDP 连重启后的开发版，零 AI 花费）：`时间` → 15 条（划线 8=上限 / 卡片 6=上限 / 文章 1）、`的` → 26 条五类齐全、`复利` → 1 条；结果页 hero 与分组条数与 `<mark>` 都在，**点第一条**落到 `#/bookshelf/848673?tab=highlights&highlight=hl_...` 且那一页有 196 个划线锚点；`/knowledge-cards?q=复利` 带着关键词进入并**如实显示"没有找到匹配的卡片"** ✅。**没验的**：❌ 用鼠标在顶栏输入框敲词再回车（只验到 IPC 与真机导航）；❌ 大库上的 LIKE 全表扫耗时；❌ 装机版没跑过这批。
- **门禁基线（2026-09-25 文档口径实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（184 warning）✅ / **85 文件 · 1285 用例** ✅ / `npm run verify` 退 0（覆盖率 88.29 / 84.78 / 89.66 / 88.29 不变，新测试文件不进分母，被统计文件仍 56）✅。上一批号称"文档口径同步"，实跑 `grep` 一量仍有**五处**与代码不符：同一份 README 里表数**既有 17 又有 16**、preload 写 547 行（实际 520）、测试徽标写 83 文件（正文写 84）、`electron/database/` 领域文件写 15（实际 16，`updatable-columns.ts` 那批加的）、TS 总行数停在 56,371（实际 57,025）。**没有一处是逻辑 bug，全是手工誊写的代价** —— 与版本号、色值、IPC 通道同类，那三处早有守卫，这一处没有。新增 **`tests/doc-figures.test.ts` 6 条**：表数**读真实建出来的库的 `sqlite_master`**（不数源码 `CREATE TABLE` —— 第一版那么做，`cards` 是迁移里 `DROP`+`RENAME` 出来的，当场少数一张）、通道数取 `IPC_CHANNELS` 去重值、目录与测试文件数扫仓库（`tests/` + 渲染层就近 `__tests__/` ⇒ 85 而非 77）、代码规模现算；**锚点句式被改掉也判红**（静默失配比报错更糟，覆盖率清单已被空匹配咬过），反证两条：表数改成 16 → 两处立刻红、README 换成空串 → 五条规则全红。另钉 `BACKUP_TABLES + EXCLUDED_TABLES == 真库表数`。**README 从此不再承诺"某个文件有多少行"**（删五处行数，代码规模改「约 5.7 万行」按万分位 + 容差 1500 对账）。**没验的**：❌ 用例数仍无守卫（静态数不出真实用例数，`it` 套 `each` 会翻倍，仍靠手工同步）；❌ AGENTS / CLAUDE 第十节与「门禁基线」那些历史行**刻意不扫** —— 当年的数字是当年的实测；❌ 装机版没跑过这批。
- **门禁基线（2026-09-25 通道复扫实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（184 warning）✅ / **84 文件 · 1279 用例** ✅ / `npm run verify` 退 0（覆盖率 88.29 / 84.78 / 89.66 / 88.29，被统计文件 56）✅。**砍掉 25 条渲染层零调用的 IPC 通道**（168 → **143**，preload 方法 158 → 133、547 → 520 行），扫描必须**去空白后匹配**才不漏 `highlight\n.getById()` 这种跨行写法。**顺手抓到一条既有断链**：`admin:getPrompts` 有 preload 暴露、`PromptCenter.tsx` 在调，主进程从没注册过 ⇒ 后台「提示词中心」一进去就 reject（`getAllAdminPrompts()` 一直是好的，只差一行 `handle()`）。为此新增 **`tests/ipc-channel-wiring.test.ts` 5 条**：preload `invoke()` 的每条通道必须有 `handle()`；声明表里每条通道要么注册要么被推送/订阅（`.send(` 跨行要允许、`ipcRenderer.on(` 单独算）；注册不得用声明表外的常量；反证用"少注册一条 handler"的假输入。踩到的一刀：批量删时 `IPC_CHANNELS.VOCABULARY.CREATE` 子串匹配误删 `CREATE_FROM_LOOKUP` 的 handler（四处调用点在跑，静态检查一条不报）—— 补回并把这个形状写进反证，**这正是新守卫存在的理由**。留下的 12 个产品侧零调用的 db 函数（部分仍被测试引用）刻意没动，见 [[project-audit-handoff]] 卅三续。**真机已补**（CDP 连重启后的开发版）：`admin.getPrompts()` 交回 **22 条模板**、后台「提示词」页渲染出「管理 22 个提示词 · 已自定义 0 个」且不再报加载失败 ✅；被误删又补回的 `vocabulary.createFromLookup` 用已存在的词验到返回 `null`（不改数据）✅；四条已砍通道在暴露面上确实是 `undefined`，三条还在的是 function ✅。**仍没验的**：❌ 其余 21 条被砍通道没有逐条点（判据是"渲染层零调用点"）；❌ 装机版没跑过这批。
- **门禁基线（2026-09-25 备份要有下文实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（184 warning）✅ / **83 文件 · 1274 用例** ✅ / `npm run verify` 退 0（覆盖率 **88.29 / 84.78 / 89.66 / 88.29**，被统计文件 54 → **56**）✅。两件收尾：① 上一批"恢复=整批替换"之后界面里各 store 挂的还是旧库数据（当时只手动刷了设置页三个 KPI），现在报完数 1.5 秒后 `window.location.reload()`，不给"半新半旧"留中间态；顺带删掉 `useDataIo(setKpiStats)` 这个已不可达的参数与两个空 import。② 新增纯判定 `src/shared/backup-reminder.ts`：没备份过 ⇒「还没有导出过备份 · 数据只存在这台电脑上」、≥30 天 ⇒「上次备份是 2026/8/16 · 已经 40 天」、刚备份过 ⇒ 那一行不出现；脏值按没备份过，时钟跳过去按刚备份过（不报负数天）。通知面板接上，点它去 `/settings/data`，不挂红点不弹窗。守卫：`tests/data-io-import.test.ts` 4 条（取消确认 ⇒ 一条都不动、不重载；确认 ⇒ 先报数后重载；主进程报错 ⇒ 不重载；旧格式 ⇒ 补一句带不回什么）+ `tests/backup-reminder.test.ts` 5 条（边界 29/30 天 + 脏值 + 反证）。**真机**（CDP）：三种情形的面板文字逐一看过并复原了设置项 ✅。**没验的**：❌「导入数据」那颗按钮的真实一次点击（含系统文件框）；❌ 装机版没跑过这批。**注**：聚合 lines 从 89.27 降到 88.29 是把 `use-data-io.ts`（只覆盖了导入那半条路，42%）量进来的正常结果，不是代码回退。
- **门禁基线（2026-09-25 备份完整化实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（184 warning）✅ / **81 文件 · 1265 用例** ✅ / `npm run test:cov` 退 0（**89.23 / 84.76 / 89.57 / 89.23**，被统计文件 52 → **54**：新加的 `src/shared/backup.ts` 与 `electron/services/backup.ts` 有测试就进清单）✅ / `npm run verify` 退 0 ✅。备份的表清单收成 `src/shared/backup.ts` 一份（15 张业务表 + `token_usage` / `book_architecture` 两张写明理由的排除表），取数与恢复挪进主进程 `electron/services/backup.ts`，两条新通道 `system:exportBackup` / `system:importBackup`（**166 → 168**），渲染层只剩选文件 / 下载 / 报数。**这次修的是三条量出来的断链**：① 上一批新增的 `ai_generation_batches`（"这本书已处理 60/329 条划线"）与 AI 层级摘要**根本不在旧清单里** ⇒ 恢复后台账归零、按钮变「重新蒸馏」＝再花一次钱；② 旧备份**写了 `cards` 却从不读**，导入只按划线重建 ⇒ #88 之后知识卡片/方法论的「加入复习」登记恢复后全丢（那两类 `highlight_id` 是 NULL，重建不出来）；③ `conversations` / `chat_messages` 从没被带走（无云端来源）。恢复语义从"逐条 create 冲突跳过"（于是"已导入 0 本书"也报成功）改成**单事务整批替换**：反序清空 → 正序 `INSERT OR REPLACE`（列名过 `assertRealColumns`，值走 `?`）⇒ 不会留"书回来了划线没回来"的半套；界面因此加了一次确认框。顺序由测试拿 `PRAGMA foreign_key_list` 断言是**拓扑序**，覆盖完整性断言"库里每张表要么在清单里要么写明理由"，两条各配反证。旧 v1.1 文件仍可读（适配层），并如实提示"当年清单里没有的类别带不回"；形状不对或版本更新一律拒收。守卫 `tests/backup-roundtrip.test.ts` 9 条（含坏列名整笔回滚）。**真机对账**（CDP 连重启后的开发版；先留 `zhixing.db` 文件还原点，跑完删除）：导出如实报出 `books 92 / highlights 934 / cards 934 / knowledge_cards 90 / methodologies 11 / vocabulary 12 / articles 80 / daily_stats 12 / reviews 10 / memories 2`（会话与摘要类本机确实是 0）；同一份 payload 导回去后**逐类计数与界面指纹前后完全一致**（含队列第一张卡的 `reps`），日志 `Backup imported {"version":"1.2","legacy":false}` ✅。**没验的**：❌ 界面「导出/导入数据」按钮的真实点击与确认框观感；❌ 跨机器恢复（同一台验不到）；❌ 装机版没跑过这批。
- **门禁基线（2026-09-25 行形状收成一份实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（188 warning）✅ / **80 文件 · 1256 用例** ✅ / `npm run test:cov` 退 0（**88.94 / 84.44 / 89.2 / 88.94**，被统计文件 52）✅ / `npm run verify` 退 0 ✅。`renderer.d.ts` 里 book/highlight/methodology/knowledgeCard 的读取通道不再声明成映射**之后**的驼峰领域类型（`Promise<Book[]>`），改说"交回的是库里那一行" —— 声明撒谎时每个消费方都要补一层硬转，全渲染层因此有 22 处 `as unknown[]` + 若干 `as unknown as`，现在前者 **0** 处、后者 **23 → 3** 处（剩下的是 echarts 主题色数组、chatStore 的诊断挂载 `window.__chatStore`、`import-weread-content` 故意读原始行）。同批删掉 `fsrs:previewReviewRatings` handler 里"蛇形行还是驼峰卡"的探测分支（渲染层唯一调用方只可能传驼峰），通道改收 `ReviewCardFields`、主进程 `cardFromFields()` 逐字段赋值；复习记录导出的列清单 `key` 钉成 `keyof ReviewRow`（2026-09-20 那"五列常年空白"的根治：列名写错今后是编译错误）；后台知识库页改走映射器，`highlight_count`（JOIN 出来的，books 没这列）单独收一张表。守卫：`tests/db-row-types.test.ts` 26 → 31（声明不许再写驼峰领域类型 + 正向"至少 8 条通道是原始行" + ` as unknown[] ` 全渲染层扫描 + 反证）、`tests/fsrs-engine.test.ts` 47 → 50（`cardFromFields` 预览结果与直接调用完全一致 + 空来源补 null + `'\w+' in card` 不许回来）。**真机对账**（CDP 连重启后的开发版，零 AI 花费）：队列真实卡片跑出 4 档 `[1,2,3,4]` 且带「1 分钟」这类人话间隔 ✅；`highlight.getById` 缺失时是 `undefined`、取回行带的是 `chapter_title` ✅；后台知识库页 92 本书 + 「140 条笔记」+ 展开后「划线 / 笔记」「知识卡片 (8」两小节都在 ✅；`review.getRecent(3)` 键集合恰好等于 `ReviewRow` 六列、无驼峰残留 ✅。**踩到一条**：批量删硬转的正则把调用括号一起吃掉（`mapBooks(booksRaw as unknown[])` → `mapBooksbooksRaw`），靠括号平衡检查补回 —— 机械搬运脚本只对边界配对负责，别只数替换条数。**没验的**：❌ 界面按钮真实点击（编辑划线、复习预览）；❌ CSV 真实导出（会弹保存框）；❌ 装机版没跑过这批。
- **门禁基线（2026-09-25 SQL 列名白名单实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（188 warning）✅ / **80 文件 · 1246 用例** ✅ / `npm run test:cov` 退 0（**88.89 / 84.42 / 89.17 / 88.89**，被统计文件 52）✅ / `npm run verify` 退 0 ✅。`books` / `highlights` / `methodologies` / `knowledge_cards` 四个 `update(id, record)` 过去把**界面传来的对象键名**原样拼进 `SET x = ?`（值走占位符，列名没人管，键名里带逗号就能改写整条子句），现在先按 `PRAGMA table_info` 证明这一列真存在、不合法整条不发；判据只有库自己一个来源，**没有另写一份列清单**（`conversations.ts` 里那份手写清单就是"加一列忘了改就是存不进去"的反面）。守卫 `tests/sql-column-whitelist.test.ts` 20 条：四表 × 三条（合法写入 / SQL 片段被拒且原值不动 / 非法列混入则整条不发）+ 驼峰映射仍落到真实列 + `id` 排除 + 守卫函数三条（含"表名拼错要判红而不是静默放行"）+ 源码扫描两条带反证（收口前写法必须命中；`IN (${placeholders})` 这类值占位符不许命中）。**先跑未接守卫的版本实测 5 条判红**，接上后 20 条全绿 ✅。**真机对账**（CDP 连重启后的开发版，主进程改动必须重启才生效；零 AI 花费）：临时划线 → 合法列写入生效 → 恶意键名返回 `highlights 表没有这些列，拒绝拼进 SQL：content = 1, note` 且 `content`/`note` 一字未动 → 探针自己清掉 ✅。**没验的**：❌ 界面「编辑划线」保存按钮的真实点击（只验到 IPC 层）；❌ 装机版没跑过这批。
- **门禁基线（2026-09-25 会话行与死兜底收口实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（188 warning）✅ / **79 文件 · 1226 用例** ✅ / `npm run test:cov` 退 0（**88.54 / 84.52 / 88.93 / 88.54**，被统计文件 51）✅ / `npm run verify` 退 0 ✅。`conversations` / `chat_messages` 各有一份真实行类型（`ConversationRow` / `ChatMessageRow` 是 IPC 交出来的下划线列名，`ConversationView` / `ChatMessageView` 是界面用的形状，JSON 文本列在映射器里解析），`shared/types.ts` 里那两份写着驼峰的 `Conversation` / `ChatMessage` 删除 —— 它们与运行时一个字段都对不上，只是没人直接消费所以没出错数字。同批清掉 `daily_stats` / `reviews` 的「一行读三种拼法」兜底（驼峰那两种没有任何生产方，`reviews` 表连 `created_at` 都没有），`normalizeDailyStatRow` / `summarizeReviews` 改成收真实行类型。守卫：`tests/db-row-types.test.ts` 22 → 26 条（两张新表进双向对账，具名类型必须显式登记是字符串联合还是对象|null），`tests/no-fake-controls.test.ts` 加一段扫描 + 反证。**真机对账**（CDP）：开发库会话是 0 条 ⇒ 用应用自己的 IPC 造一条临时会话（两条消息，其中一条带 sources），核原始行确实是下划线列名 / `sources` 是 JSON 字符串 / `liked` 是数字，过映射器后 `messageCount` 2、sources 变成长度 1 的数组、liked 是布尔；删掉后库与 store 都回到 0 条 ✅；档案页读到「59 分钟 / 9 天有读 · 日均 7 分钟」（`daily_stats` 真实列）。**没验的**：❌ 收藏与点赞的真实点击（只验到解析后的字段类型）；❌ 装机版没跑过这批。
- **门禁基线（2026-09-25 生词与文章行映射实测，Issue #3 关闭）**：typecheck 0 错误 ✅ / ESLint 0 错误（188 warning）✅ / **79 文件 · 1218 用例** ✅ / `npm run test:cov` 退 0（**88.52 / 84.63 / 88.93 / 88.52**，被统计文件 51）✅ / `npm run verify` 退 0 ✅。`vocabulary` 与 `articles` 从此各有一份行类型（`VocabularyRow` / `ArticleRow`，**故意不带索引签名** —— 读一个库里没有的列直接编译不过）；此前同一个生词行有三份声明（`VocabularyItem` / `Vocabulary` / 无），`is_mastered` 一份写 `number` 一份写 `boolean`，`is_read` 靠 `normalizeArticle` 在页面里各自掰；0/1 → boolean 收进映射器的 `safeBool`。渲染层 `as unknown as` 32 → **23 处**（剩下的在 chat / admin / reviews / daily_stats 那几摊，`import-weread-content` 那处是故意读原始行）。守卫：`tests/db-row-types.test.ts` 15 → 22 条（双向对账扩到这两张表 + 反证扫描认得旧写法 + 「旧类型不许回来」的源码扫描）。**真机对账**（CDP）：生词本照常渲染出 12 个词与释义、文章视图经 `?article=<id>` 深链进入后标题 / 「四级」难度 / 未读 / 收藏全部在位；IPC 原始行里 `is_read` 确实是数字 `0`（映射器负责掰成 boolean）✅。**没验的**：❌ 生词复习评分那条交互没真点过；❌ 装机版没跑过这批。
- **门禁基线（2026-09-25 分批续跑实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（189 warning）✅ / **79 文件 · 1211 用例** ✅ / `npm run test:cov` 退 0（**88.52 / 84.63 / 88.93 / 88.52**，被统计文件 51）✅ / `npm run verify` 退 0 ✅。新增第 17 张表 `ai_generation_batches`（批次台账：这一批喂过哪些划线），知识卡片与方法论从此**分批续跑到整本书** —— 每次点击仍只喂上限内的没处理过那批（花费不变），界面按书显示「已处理 N/M 条划线」与「继续剩余 K 条」，两种情况从头再来（用户点「重新蒸馏」、或这本书的成品已被清空 ⇒ 台账自动作废）；通道 164→166。**真机对账**（CDP 连跑着的开发版）：新表在真实开发库建好（17 张表 / 台账 0 行 / 指向不存在的书 0 条），两个 coverage 通道对 9 本有划线的书返回正确总数（329 / 196 / 160 / 140 / 68 / 28 / 8 / 4 / 1），蒸馏中心实际渲染出的按钮文案含「开始蒸馏」与「重新蒸馏」✅。**没验的**：❌ 一次真实的续跑点击（那要花钱，未经批准不做）；❌ 装机版没跑过这批。
- **门禁基线（2026-09-25 AI 生成覆盖数实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（188 warning）✅ / **77 文件 · 1171 用例** ✅ / `npm run test:cov` 退 0（**88.2 / 84.29 / 88.41 / 88.2**，被统计文件 50）✅ / `npm run verify` 退 0 ✅。知识卡片蒸馏与方法论提取的单次输入上限收进 `src/shared/ai-coverage.ts`（60 / 50，唯一真值），主进程不再自己写数字；两个生成通道返回覆盖计划，界面在「完成」那一条提示里如实写出「本次只覆盖 N/M 条划线，其余 K 条未处理」（完整覆盖不啰嗦）。12 条新用例含反证（旧的 `slice(0, 50)` 与 `DISTILL_MAX_HIGHLIGHTS` 回来就判红）。**没验的**：❌ 界面上那条提示的真实观感没点过；❌ 没有真打一次 AI 生成（本轮零 AI 调用，见花钱边界）。
- **门禁基线（2026-09-25 复习队列三来源实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（186 warning）✅ / **76 文件 · 1158 用例** ✅ / `npm run test:cov` 退 0（**88.16 / 84.23 / 88.34 / 88.16**，被统计文件 49）✅ / `npm run verify` 退 0 ✅。知识卡片与方法论现在能「加入 / 移出复习队列」（`cards:enroll` 单条与批量同一条通道、`cards:unenroll`、`cards:enrolledSources` ⇒ 通道 161→164）；`cards` 表从"只能挂划线"变成三种来源各一个可空外键列 + CHECK「有且只有一个」，老库整表重建迁移。正/背面文案收在 `src/shared/review-sources.ts` 一份。**真机对账**：开发库（92 书 / 934 划线 / 934 卡 / 10 复习）迁移前后逐字一致、孤儿 0；跑着的开发版走真实 IPC 入队 → 查重（skipped 1，不建第二张）→ 队列新卡池 924→925 → 移出 → 名单回空、卡片本身仍在 ✅。**没验的**：❌ 界面上那颗按钮的真实点击（只验到 IPC 往返与渲染数据）。
- **门禁基线（2026-09-25 外键复位修复实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（183 warning）✅ / **74 文件 · 1138 用例** ✅ / `npm run test:cov` 退 0（**87.43 / 84.58 / 87.64 / 87.43**，被统计文件 48）✅ / `npm run verify` 退 0 ✅ / 跑着的开发版真机复测：删一条划线带走它的复习卡片、隔过一次防抖落盘之后再删一本书仍然级联 ✅。**根因**：sql.js 的 `db.export()` 会把这条连接的 `PRAGMA foreign_keys` 复位成 0，而 `saveDatabase()` 的 3 秒防抖落盘每次都要 export 一遍 ⇒ 启动时开好的外键在第一落盘后悄悄关掉，库里那些 `ON DELETE CASCADE` 全不生效（表现：删书删完子行仍在，无任何报错）。修法 = `exportDatabaseForPersist()` 取完字节立刻重开。**为什么 1100+ 条用例抓不到它**：测试全走 `injectTestDatabase`，而 `persistToDisk()` 开头是 `if (!db || !isDirty) return` —— 模块级 `db` 在测试里永远是 null，**export 那一步从来没被测试执行过**。新守卫用 `setDatabase` 造一条生产形态的连接把落盘走完整（含一条反证：裸 `export()` 之后 fk 确实变 0）。装机版与开发库都只读过一遍：**孤儿行 0**（这个坑还没来得及攒下脏数据）。
- **门禁基线（2026-09-24 功能深化批次实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（183 warning）✅ / **73 文件 · 1133 用例** ✅ / `npm run test:cov` 退 0（**87.42 / 84.57 / 87.61 / 87.42**，被统计文件 45 → **48**）✅ / `npm run verify` 退 0 ✅ / `npm run dev` 真起到 `Main window shown` ✅。八项功能深化：AI 引用回原文（`src/shared/source-anchor.ts` 一份深链与锚点约定）、卡片与方法论摆真出处、收藏跨会话出口、上下文补 articles/vocabulary 两路 BM25、练习次数改由用户动作决定、单条划线可改可删 + 书可删、三处假口径（`cards.due` 字符串比较 / 复习 100 张就宣布完成 / 同步全失败仍弹「已是最新」）、**删除先留现场 8 秒可撤销**（`electron/services/deleted-archive.ts`，随之砍掉 5 条零消费者的物理删除通道 ⇒ 通道 163→161）。**⚠️ 同一轮用 CDP 在跑着的开发版上走真实 IPC，量出「外键级联运行期不生效」**（删完书/划线，子行仍在库里；同一个库文件复制到 node + sql.js 上做同样删除却正常级联）⇒ 撤销的现场按查询逐张表收集，不押注级联；删除侧的缺口单独追。
- **门禁基线（2026-09-24 工具链批次 A1 实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（176 warning）✅ / **64 文件 · 1071 用例** ✅ / `npm run test:cov` 退 0（86.33 / 84.24 / 84.82 / 86.33，阈值 83/80/75/83）✅ / `npm run verify` 退 0 ✅ / `npm run dev` 真起到 `Main window shown` ✅。**Vite 5.4.21 → 6.4.3、electron-vite 2.3.0 → 5.0.0**（`package.json` `^5.4.0`→`^6.4.3`、`^2.0.0`→`^5.0.0`；连带 esbuild 0.21.5→**0.25.12**，由 electron-vite 5 自带 ⇒ **不用 overrides 就清掉那条 esbuild 告警**）。**告警 10 → 6**（vite 3 条 + esbuild 1 条；剩 vitest 2 要 4.1.11、glob 1 嵌套副本、echarts 1、extract-zip 2 上游无补丁）。**链条先量的结论**（下次别再猜）：vitest 4 的 vite peer 是 `^6||^7||^8`；electron-vite 2 的 peer 只到 `^5` ⇒ 升 electron-vite 5 是前置，且它 peer `^5||^6||^7` ⇒ **两步可以分开做**；`@vitejs/plugin-react@4.7.0` peer `^4||^5||^6||^7` ⇒ **不跟它升到最新**（最新版 peer 是 `vite ^8`，跟"最新"走会白白拽一次大版本）。**产物逐项核过**：`index.html` 相对路径 `./assets/`、105 个 woff2、`echarts-vendor`/`recharts-vendor` 分包在、`dist/main/main.js` 396,910 字节。**⚠️ 唯一大的没验项：安装包这次没重出** —— 本机 electron-builder 下载不到自己的工具链二进制（`~/.cache/electron-builder` 空 + 到 GitHub 下载主机超时；带 npmmirror 镜像则撞 `app-builder-lib/binDownload.js:27` 的 `@electron/get` `ElectronDownloadCacheMode` undefined）。**做了反证才敢说跟 vite 6 无关**：把 package.json/锁退回升级前重装，同一条命令两种模式报错一字不差；两份锁里 `@electron/get` 的 hoisting（顶层 2.0.3 + app-builder-lib 嵌套 3.1.0）完全相同。所以「vite 6 打的包能启动、asar 完整」这句**本轮没说**，等出包通路修好再补。**别把覆盖率 86.2→86.33 读成变好** —— 同一批文件同一套断言，只是 esbuild 换代改了转译行映射的计数。
- **门禁基线（2026-09-24 文档指针批次实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（176 warning）✅ / `npm run test:cov` 退 0（**64 文件 / 1071 用例**）✅ / `npm run verify` 退 0 ✅。**Issue #7 关闭：AGENTS / CLAUDE 里 6 处"去读一个不存在的文件"的指针全收掉**（ownership 配置、review-agent 规则、三份 Agent 规则文件、那份从未存在的规范正本、早期 spec 四件套清单、§十两行"待补"）。**扫全量 18 处命中但只删 6 处**：`.claude/**`（infra-agent 可写范围 glob）、裸 `.claude/`（说明被 gitignore 排除 = "别去找"的依据）、§十 两行历史记录（**append-only，当时的事实不许改**）都是合法用法，一把删反而把权限声明和历史改掉。**方向取"收指针"**（写正本没用：这些目录不入库，且本项目已被"两份口径各自漂移"咬过三次）—— §5.3 表 = 15 条规则正本，§六 = 指名每个领域由哪份**入库配置**强制，§9.4 = 只留 `.learnings/LEARNINGS.md`。新增 `tests/doc-pointers.test.ts` 17 条：正文（第十节之前）零死路径 + 文档指向的 10 个入库配置必须存在；`.learnings/` / `.workbuddy/` 不断存在而断"被 gitignore 排除 + 文档标注为本地文件"（CI 上 fresh clone 没有它们，硬断会假红）。**反证做过**：往 §六 临时注入一句指向 Agent 规则文件的死路径 ⇒ 立刻判红，删掉 ⇒ 全绿。**issue 建议的通用判据试过并放弃**：要求"每个反引号路径都 ls 得到"实测 34 处误报（简写 `main.ts`、`@/` 别名、`get()/getAll()`、npm 包名）⇒ **判据宁要准不要全**。顺手把 §9.3 的"门禁跑 `npm run test`"改成 `npm run verify`（上一批 CI 已改跑 `test:cov`）。**未验**：❌ 没让新人真照文档找一遍（判据是脚本不是人）；❌ 不入库的 `docs/` 里同类断链没扫。
- **门禁基线（2026-09-24 覆盖率批次实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（176 warning）✅ / **`npm run test:cov` 退 0**（45 个文件，聚合 **86.2 / 84.24 / 84.82 / 86.2**，阈值 83/80/75/83）✅ / 三进程 build ✅ / **新口径 `npm run verify`（= lint + typecheck + test:cov + build）退 0** ✅。**CI 的测试步骤从 `npm run test` 换成 `npm run test:cov`** —— 那四个阈值此前在 CI 上**从来没把过关**（不带 `--coverage` 就不会评估阈值），本地不手动跑 `test:cov` 就等于没有这道门。`coverage/index.html` + `coverage-summary.json` 现在作为 artifact 留 14 天；husky pre-commit **仍跑快的 `npm run test`**（不拖慢每次提交）。**清单修掉两处静默空匹配**：`electron/database.ts`（已拆成 `electron/database/`）与 `electron/services/http-client.ts`（已移到 `electron/http-client.ts`）文件早就不在了，vitest 对不匹配的 glob 不报错 ⇒ 白写两条还误导人；另补入 10 个有专属测试却没进清单的纯逻辑模块 ⇒ 被统计文件 **18 → 35 → 45**（分两步各测一次，不是推的）。**只有常量/类型声明的模块刻意不列**（`types.ts` / `ipc-channels.ts` / `external-links.ts`，没有分支可盖，列进去是往分母塞 0%）。文档口径同步：AGENTS §2/§3/§5.1/§5.2、README 概览表+命令段+CI 说明、CONTRIBUTING、PR 模板（README 原来那句"只作用于 25 个文件"**两头都不对**：清单 20 条、真实存在 18 条）。**未验**：❌ CI 上跑 `test:cov` 真绿只能等推上去那一次（本地同版本同配置实跑过；Runner CPU 数不同理论上可能让极少数分支计数有差，未排除）；❌ 阈值**没上调**（余量 3.2pp 是下一个决定）；❌ 还有 17 个"有测试却没进清单"的文件（多为重逻辑：`orchestrator` / `weread-api` / `repositories` / 各 service），列进去会因未测分支拉低聚合，本批刻意不动，欠账记进 #9 评论。
- **门禁基线（2026-09-24 质量批次实测）**：typecheck 0 错误 ✅（**含 `tests/`**）/ ESLint 0 错误（176 warning）✅ / Vitest **1054 用例 · 63 文件** ✅ / `npm run verify` 退 0 ✅。**Issue #6 关闭：`tests/**/*.ts` 加进根 `tsconfig.json` 的 `include`**，此前 61 处类型错误 / 15 个文件积压在类型检查之外。改法分两栏：**生产侧三处声明与实现不一致**（`renderTemplate` 实现按缺值处理 `null` 但签名不含；`AIServiceConfig` 被三个导出函数签名使用却没 `export`；三个 builder 的 `shouldBuild()` 省掉接口形参）+ **测试侧补类型**（`vi.fn(() => [])` 推成 `never[]` ⇒ 标返回类型；回调里赋值的 `let capturedError: Error | null` 被 TS 的 narrowing 判成 `never` ⇒ 换对象持有 `{ error: null }`，属性 narrowing 会在调用后重置、`let` 不会，这点用最小复现单独验过）。**断言一字未动**：要比可能为 null 的返回值之前，一律先 `if (n === null) throw` / `expect(x).not.toBeNull()`（只加检查不减检查）；`dueCard(over)` 从 `Record<string, unknown>` 收窄成 `Partial<DueReviewCard>`。**顺手照出（不是缺陷）**：`book` / `methodology` / `knowledge-card` 三个 `shouldBuild()` **无条件返回 true**，那 5 条用例传的上下文全被忽略 —— 它们是 09-16 "默认对话零上下文"修复的回归守卫，保留。新增 `tests/typecheck-coverage.test.ts` 4 条**带反证**（临时从 include 删掉 `tests/**/*.ts` ⇒ 2 条判红；恢复 ⇒ 全绿）。**顺手拆掉上一批埋的雷**：两个密钥测试文件共用 `.test-tmp/user-data` 且各自 `rm` `settings.json` + `secure/`，vitest 按文件并行 ⇒ 互删现场；改为 `electron-mock-setup` 认 `ZHIXING_TEST_PROFILE`、两文件各占一个 profile 目录。**一条偶发红取证**：pre-commit 那次挂的是 `MessageBubble.test.tsx:430`（依赖 React 对 `<td>` 挂在 `<div>` 下的纠错行为），随后 4 次全套连跑全部退 0，未复现、未改动，归 #8 渲染测试那一摊。对账：62→**63 文件**、1050→**1054 用例**，多出的 4 条就是新守卫。**未验**：❌ 只保证"测试语义没动"，没逐条复核这些断言本身对不对（编译期≠正确性）；❌ 测试文件仍不在覆盖率 include（#9）；❌ `.tsx` 组件测试本来就在 `src/**/*.tsx` 覆盖内（61 条错误里零命中，量过）。
- **门禁基线（2026-09-23 安全批次 2/2 实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（176 warning）✅ / Vitest **1050 用例 · 62 文件** ✅ / `npm run verify` 退 0 ✅。**密钥原值不再跨进程下发**：`SETTINGS.GET_ALL` 改走 `settingsService.getForRenderer()`，密钥字段删掉、换成 `wereadApiKeySet` / `llmKeySet` 两个布尔（字段名唯一真值 = `secretSetFlagName()`）；`SETTINGS.GET` 问到密钥键名**抛错**而不是回 `undefined`（回空值会被界面当成"没配"，一次保存就清掉用户的 key）。**输入框语义换成"留空即不修改"**：`setSecureKey(key,'')` = 显式清除（`.enc` 与明文残留一起抹），界面给「清除已保存的 Key」；`set(key, 非字符串)` 拒绝写入。**顺带修掉一条被这套改动照出来的真断链**：`ai.setConfig` 整个包在 `if (llmKey)` 里 ⇒ "只改端点/模型、不重填 key"这条最常见的保存路径**根本不会把配置下发给 AI 服务，要重启才生效**；现在无条件调用，apiKey 留空由主进程用 `withStoredApiKey()`（在 `src/shared/settings-secrets.ts`，可单测）补回已存的那把，`weread.test('')` 本来就有 `key || apiKey` 回退。**通道 164 → 163**：`WEREAD.SET_API_KEY` 随之变死（渲染层唯一用途是再塞一次 key，而 `SETTINGS.SET` handler 早就在做），通道数按 `ipc-channels.ts` 去重字面量实测，同一算法喂 `HEAD` 得 164 以验判据。`tests/secret-ipc-boundary.test.ts` 15 条：注册**真实的** `registerSettingsHandlers` 后直接调 handler，含反证（同一现场 `getAll()` 查得到原值 ⇒ "查不到"是边界生效）。**未验**：❌ 界面一张没点开（清除按钮观感、两种占位文案、清除后徽标变灰）；❌ 装机版没重跑；❌ `.enc` 解不开时设置页的表现只推理过；❌ "改完模型立即生效"没在真 AI 服务上验。
- **门禁基线（2026-09-23 安全批次实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（176 warning）✅ / Vitest **1035 用例 · 61 文件** ✅ / `npm run verify` 退 0 ✅。**密钥落盘加密接通**（Issue #13 选"接通"而不是"砍掉"）：`settingsService.set()` 遇到 `SECRET_SETTING_KEYS`（`wereadApiKey` / `llmKey`，唯一真值在 `src/shared/settings-secrets.ts`）改走 `setSecureKey` ⇒ 值进 `secure/<key>.enc`、`settings.json` 里同名字段删掉；读侧 `get()/getAll()` 经 `readSecret` 回退（`.enc` 缺失时读历史明文）。**两条不变量**：① `isEncryptionAvailable()` 不做「信一次布尔」，改成**加解密自测**（`encryptString` 后 `decryptString` 回读比对），任何异常一律判不可用；② **失败路径只退回明文、绝不丢用户的密钥**（`setSecureKey` 加密抛错 → `writePlaintext`；`decryptString` 抛错 → 返回历史明文且 `.enc` 留着不删）。`migratePlainSecrets()` 在 `main.ts` 启动序列跑一次，迁移结果写日志（`migrated` / `keptPlaintext` 各一条），幂等。**本机实测**：开发版两个 key 从 `settings.json` 消失、`secure/{wereadApiKey,llmKey}.enc` = 59/66 字节、日志出现 `Migrated plaintext secrets to encrypted storage` 与 `WeRead API Key loaded from settings`；第二次启动迁移数为 0 且仍读得到原值；一次性 Electron 探针解回的长度与迁移前一致（28/35）。迁移用的明文备份**已删**（留着等于把加密白做）。**没做完的（安全批次 2/2）**：`SETTINGS.GET_ALL` 仍把解密后的原值发到渲染层并回填输入框 ⇒ 落盘加密、进程间又摊开一遍，要改成界面只知「配没配」、留空不修改。**未验**：❌ 装机版真加密仍未验（`isEncryptionAvailable` 在 39 上实测 `true`，但装机版历史上记的是 `false`）；❌ 换机器/重装系统后 `.enc` 解不开时的界面表现（代码路径有回退，没人眼看过）。
- **门禁基线（2026-09-23 打包链批次实测）**：`npm run verify` 退 0（**1022 用例 · 60 文件** / eslint 0 error · 176 warning / typecheck 0 错误 / 三进程 build ✅）。**electron-builder 25.1.8 → 26.15.3**：官方 26.0.0 的破坏项（`win` 签名配置进 `win.signtoolOptions`、Linux `.desktop` 改对象、`electronDist` 转 Hook、fpm 默认依赖搬进 JS）**都不落在我们的配置上**，唯一真吃得到的是 asar 打包改用官方 `@electron/asar` ⇒ 升完先核内容再谈别的：`app.asar` 内 12,220 文件 / 105 个 woff2 / 5 个 wasm，`app.asar.unpacked/.../sql-wasm.wasm` 659,730 字节仍在，`win-unpacked` 521,821 KB。产物 127,839,070 字节（比 25 那次小 7 MB，**原因没查**，别写成"26 压缩更好"）。打包版真启动到 `Main window shown`，静默检查更新这回落成 `not-available`（上一轮是 `ERR_CONNECTION_RESET` ⇒ 本机网络是间歇的，同一条链路两种结果都出现过）。**告警**：`app-builder-lib 26.15.3` / `builder-util-runtime 9.7.0` 达标，**`tar` 6.2.1 → 7.5.22 跟着 electron-builder 一起上去了**（8 条一并清），open 从 20 → **10**（vite 3、vitest/@vitest/mocker 各 1、esbuild 1、glob 1 = `test-exclude/node_modules/glob@10.4.5` 嵌套副本、echarts 1、extract-zip 2 上游无补丁）。**未验**：❌ 没做一次真安装（#1）；❌ 安装包变小的原因；❌ 界面一张没点开
- **门禁基线（2026-09-23 工具链批次实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（176 warning）✅ / Vitest **1022 用例 · 60 文件** ✅ / `npm run test:cov` 退 0（All files 91.84/83.3/95.58/91.84，阈值 83/80/75/83）✅ / `npm run verify` 退 0 ✅。**Vitest 2.1.9 → 3.2.7**（含 `@vitest/coverage-v8`）只为摘掉唯一那条 **critical**（要求 3.2.6）。**为什么不停在 2、为什么不冲 4**：`npm view vitest@3.2.6 dependencies.vite` = `^5||^6||^7-0` ⇒ 3.x 与本项目 vite 5.4.21 不冲突；而 `vitest@4.1.11` 把 vite 变成 peer 且要 `^6||^7||^8`，`electron-vite@2.3.0` 的 peer 只到 `^5` ⇒ 升 4 就是 vitest+vite+electron-vite 三个大版本一起动，另做。**顺带收掉一处双口径**：`environmentMatchGlobs`（v3 已标废、v4 会删）与测试文件首行的 `@vitest-environment` 同时在指环境，`admin-charts.test.tsx` 就是两边各说一个（glob: happy-dom / 自己第 24 行: jsdom）的那类 —— 改成每个文件自己声明，`Modal.test.tsx` 补 docblock。**实测**：升级前后都是 60 文件 / 1022 用例，四个 tsx 组件测试（Modal 8 / RetrievalPanel 5 / MessageBubble 69 / admin-charts 45）全绿，`DEPRECATED` 警告归零。**未验**：只跑单轮，没连跑多轮取证并行稳定性（老记录说旧版本有并行崩溃问题）；这批不动运行时与产物，所以界面表现无关。告警按锁文件重算 **剩 20 条**（vitest/@vitest/mocker 各 1 要 4.1.11、vite 3、tar 8、electron-builder 侧 2、esbuild 1、glob 1、echarts 1、extract-zip 2 上游无补丁）
- **门禁基线（2026-09-23 运行时批次实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（176 warning）✅ / Vitest **1022 用例 · 60 文件** ✅ / 三进程 build ✅ / `npm run verify` 退出码 0 ✅。**Electron 35.7.5 → 39.8.10**（`package.json` `^35.0.0`→`^39.0.0`）：目标版本是把 electron 那批告警（推送前 open 32 条；GitHub 记录里累计 33 条，其中 1 条上一批已满足）的 `first_patched_version` 排序后取最高要求（要 38.8.6 的 13 条、要 39.8.x 的 19 条，所以 38.8.6 只覆盖 13 条、39.8.10 全覆盖）；**本机 `npm install` 的 postinstall 连不上 GitHub**（`ETIMEDOUT 20.205.243.166:443`，`~/.npmrc` 的 `disturl` 已不被读），要 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`，装完单独验 `node_modules/electron/dist/version`。36–39 的破坏性变更逐条核过：`app.commandLine` 转小写（switch 本来全小写）、`NativeImage.getBitmap`（零调用）、39 的 `window.open` 必建可调弹窗（`setWindowOpenHandler` 恒 `deny`）、38 的 macOS 12 + C++20（只打 Windows、无原生模块）—— **无一命中**。**重新出包实测**：`electron-builder 25.1.8` 吃下 39.8.10，产物 134,881,884 字节（已发布的 1.3.4 是 119,246,768），`latest.yml` 的 sha512 与本机重算一致，`win-unpacked/知行读书.exe` 真启动到 `Main window shown` 并建了库；第一次在 NSIS 步报 `ENOSPC` 而三个候选目录各写 20 MB 都成功 ⇒ 瞬时抖动，重试即过。**顺带修的一条真缺陷**：`logger` 与 `settings-service` 在模块加载期就绑定 `app.getPath('userData')`，而静态 import 早于 `main.ts` 本体 ⇒ 09-21 的开发版数据目录隔离对 settings/logs 无效（开发版读不到自己的密钥、且会盖装机版设置）；修法见 `electron/user-data.ts` + `tests/dev-userdata-isolation.test.ts`（5 条，含一条反证）。**按新锁文件重算告警：85 条里命中 21、清掉 64，electron 归零**。**未验**：❌ 没真装一次（NSIS 装→保留数据→卸载这条链没走，是 Issue #1）；❌ 应用内「检查更新→下载→重启安装」在 39 上没跑完过（本次 `ERR_CONNECTION_RESET`，是网络）；❌ Chromium 换代后的界面一张都没点开看；❌ `safeStorage` 在 39 上能否加解密没测——顺手发现 `getSecureKey`/`setSecureKey` **零调用方**，密钥实际一直明文进 settings.json，那套 `.enc` 存储是死代码（另开 Issue）
- **门禁基线（2026-09-23 依赖批次实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（176 warning）✅ / Vitest **1020 用例 · 60 文件**全通过 ✅ / 三进程 build 成功 ✅ / `npm run verify` 退出码 0 ✅ / **依赖只做了 semver 范围内的一批**（`package.json` 一个字没改，只改锁）：electron 35.0.0→**35.7.5**（`node_modules/electron/dist/version` 实测，因为 npm 报 postinstall 未被 allowScripts 覆盖）、react-router 7.16.0→**7.18.4**、js-yaml→**4.3.2**、@xmldom/xmldom→**0.9.12**、postcss→8.5.28、nanoid→3.3.19、form-data→4.0.6、browserslist→4.29.0、ip-address→10.7.2；按 GitHub 的 85 条告警逐条拿锁文件重算，**清掉 33 条，仍命中 52 条**（判据本身踩过一次坑：GHSA 的逗号范围 `>= 2.1.0, < 4.1.11` 交给 `semver.satisfies()` 对任何版本都返回 false，第一版因此虚报 37 条，逗号换成空格才是 AND）。剩下的全要跨大版本：electron 31 条、tar 8 条、vite/vitest 6 条（含 1 条 critical）、electron-builder 2 条、echarts 1 条、esbuild 1 条、glob 嵌套副本 1 条、extract-zip 2 条上游无补丁/ **本机 `npm audit` 不可用**：registry 是 npmmirror，`/-/npm/v1/security/*` 返回 404 `[NOT_IMPLEMENTED]`，判据只能取 GitHub API。**故意没做**：不给 `builder-util-runtime`/`tar`/`esbuild` 加 `overrides` 强拉版本（前者在解析 `latest.yml` 的自动更新路径上，只有真装一次才看得见效果）。**未验**：没为依赖变动重新 `npm run package:win`，所以「35.7.5 打出的包能正常启动、更新链路不受影响」这句话**没说**；`echarts` 5.5.1→5.6.0 是顺带升的随包依赖，图表界面一张都没点开看；升级后的 Electron 没在装机版上跑过。剩余 52 条列成 Issue #11（Electron 大版本 + 重新出包与装机实测）/#12（工具链大版本 + 无上游补丁项）
- **门禁基线（2026-09-23 续实测 · GitHub 维护批次）**：typecheck 0 错误 ✅ / ESLint 0 错误（176 warning）✅ / Vitest **1020 用例 · 60 文件**全通过 ✅ / `npm run verify` 退出码 0 ✅ / **CI 长期红的根因确认并修**：windows-latest 检出时 `core.autocrlf=true` 把 LF 换成 CRLF，而 `build-tokens.mjs --check` 做逐字节比对 ⇒ 产物永远判「过期」；新克隆复现退 1、加 `.gitattributes`（`* text=auto eol=lf`）后同条件退 0；最后一次绿的 run 是 2026-09-18 15:04。**推送后回补**：master CI 转 success（`gh run watch --exit-status` 退 0，09-18 以来第一次）；GitHub 社区健康度 100%，issue/PR 模板均被识别；私有漏洞报告由 false 开成 true 并把直达链接写进 `SECURITY.md`；Dependabot 安全更新已开；仓库 homepage 已补。**topics 也补上了（12 条，独立读回确认）** —— 踩到一条 API 坑：`PATCH /repos` 带 `topics` 字段会**返回 200 但静默丢弃**（读回永远是 0，限流余量与令牌 scope 都排除了）；正解是专用路由 `PUT /repos/{owner}/{repo}/topics`，**body 字段名是 `names` 不是 `topics`**（这一点是拿 422 的报错体看出来的）。`npm run test:cov` 本轮没跑（#9 的第一步）。
- **门禁基线（2026-09-23 实测 · v1.3.4 已发布）**：typecheck 0 错误 ✅ / ESLint 0 错误（176 warning）✅ / Vitest **1019 用例 · 60 文件**全通过 ✅ / electron-vite 三进程 build 成功 ✅ / `npm run verify` 退出码 0 ✅ / `npm run package:win` 出包并逐字节对账 ✅：`zhixing-reader-Setup-1.3.4.exe` 119,246,768 字节、随包 `app.asar` 内 `package.json` 版本 1.3.4、`latest.yml` sha512 自洽；tag `v1.3.4` 已推、Release 标为 Latest、三件同传、`latest.yml` 回下载与本机相同。**未验**：远端 exe 未整份回下载重算 sha512（本机 `github.com` 下载主机此刻被 reset），装机版应用内「检查更新→下载→重启安装」在新退出路径上仍未真跑过一遍
- **门禁基线（2026-09-22 再续实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（176 warning）✅ / Vitest **1019 用例 · 60 文件**全通过 ✅ / electron-vite 三进程 build 成功 ✅ / `npm run verify` 退出码 0 ✅ / 渲染层 `as unknown as` 硬转 63 → 32 处，行类型只在 `utils/db-mapper.ts` 一处定义；「笔记」页签此前按不存在的 `type` 列筛，恒为空，现按 `note` 是否非空推导
- **门禁基线（2026-09-22 实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（176 warning）✅ / Vitest **1004 用例 · 59 文件**全通过 ✅ / electron-vite 三进程 build 成功 ✅ / `npm run verify` 退出码 0 ✅ / **本轮未出包**：「重启安装」退出路径加固要随下一版才到装机版，线上 1.3.3 仍是旧路径
- **门禁基线（2026-09-21 实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（176 warning）✅ / Vitest **993 用例 · 57 文件**全通过 ✅ / electron-vite 三进程 build 成功 ✅ / `npm run verify` 退出码 0 ✅ / `npm run package:win` 出包并逐字节对账 ✅
- **发版要走的六处版本同步点**（漏一处界面与文档就各说一个版本；已由 `tests/version-sync.test.ts` 4 条钉住）：`package.json`+lock、`src/shared/external-links.ts` 的 `APP_META`、`CHANGELOG.md` 的 `## [x]` 与链接行、`README.md`（横幅/Version 徽标/`Setup-x.exe`/变更记录表/页脚）、关于页 `UPDATE_HISTORY` 首条
- **门禁基线（2026-09-16 实测）**：typecheck 0 错误 ✅ / ESLint 0 错误（197 warning）✅ / Vitest **885 用例 · 42 文件**全通过 ✅ / electron-vite 三进程 build 成功 ✅ / 覆盖率 91.09-85.05-93.81-91.09 ✅
- **2026-09-16 数据血缘修复**：量真实数据库（`%APPDATA%\zhixing-reader\zhixing.db`）列出「应该有的 vs 实际有的」，5 个差值为 0 的字段全部修完 —— ① 934 条划线章节名全丢（`chapters` 对照表取了不用）② 90 张知识卡片来源划线全丢（提示词没问、写死 null；现在 `sourceIndex` 需在本批内换算）③ 对话意图不落库 ④ 对话引用来源不落库（`chunkId` 是 Qdrant 遗留字段名，新增 `RagSourceRef` 唯一真值）⑤ 阅读时长恒为 0（改为同步微信读书月度数据，累加改覆盖）。**外加启动自动修复** `electron/services/startup-repair.ts`：历史数据不会自己变好，回填藏在设置页等于不修，改为启动后台自动跑（本地步骤零网络；网络步骤先查缺口、带节流）。测试 790→875（40 文件）
- **2026-09-16 默认对话路径的「零上下文」修复**：`book` / `knowledgeCard` / `methodology` 三个构建器的 `shouldBuild` 原来都要求 `!!context.bookId`，而首页进来的对话是不选书的 —— 上一轮修好的中文检索**在实际使用中根本不会被调用**（打包实测：「调取知识库」只有 2/2 路 = 记忆 + 画像，`promptTokens` 358，AI 回答「你提供的笔记里没有相关内容」）。现在没选书就跨全部书籍 / 卡片 / 方法论检索，选书则只搜那本书；卡片与方法论的打分也从「整句 includes」（中文几乎永远 false → 实际按库顺序硬塞 10 张）改成复用 BM25 中文分词，只注入真正命中的。另修：`searchIndex` 噪声过滤加 `df >= 3` 下限（1~2 篇小语料里唯一信号会被丢掉，实测卡片命中恒为 0）；卡片类型字段 `card_type` → `type`。**打包实测**：934 条划线 →「作者怎么看人际关系」命中 5 条（topScore 17.2）+ 方法论 1/11 + 卡片 5/90，`promptTokens` 358→1252，回复带「引用来源：5 个片段」。测试 880→885（42 文件）
- **2026-09-16 按计划执行 15 个任务**（计划：`docs/superpowers/plans/2026-09-16-lightweight-rag-and-fixes.md`，6 阶段 TDD）：轻量 RAG 落地（`src/shared/retrieval.ts` BM25 + 中文 bigram；rag-service 变适配层 + 写计数器签名；删除 Vectra/embedding-service/vectra 依赖）。实测 934 条真实划线：修复前四个中文问题命中 0 条，现在命中正确划线。其余：生词本「加入复习」不再偷记评分、导出全部、评分防连点；统计/Token 两套时间范围说清、KPI 口径修正；备份导出补知识卡片/方法论/生词且导入真恢复；删 4 个空开关；KPI 卡片真能点或不装；每日学习筛选空态/下标统一/连续复习；提示词中心四处；后台三处；砍 book_architecture（-299 行）；明文密钥如实告知。测试 888→880（42 文件）
- **2026-09-16 AI 检索链路修复（中文提问原来是零上下文）**：① `keywordSearch` 的切词对中文是坏的 —— 中文没有空格，整句当一个词去 includes，实测四个日常问题**旧切词命中 0 条**、改 2 字 bigram 后命中 33~79 条；② `checkRAGAvailability` 只看索引文件能否打开、不看是否有向量（实测 0 条），把空索引判成"可用"；③ 语义检索返回 0 条时不回退关键词，AI 拿零条上下文回答且日志写着用了语义检索。另外查明：本机语义检索本来也用不了（DeepSeek 无 /embeddings），索引只在「新建划线」写入、微信读书导入的 934 条从未索引、`rebuildIndex()` 无调用方 —— 关键词检索一直是唯一来源。新增 `tests/rag-keyword-search.test.ts`（12 条）。测试 875→888（41 文件）
- **2026-09-16 交互逻辑审计**：4 个并行子代理通读全部页面，按用户点名的「一个页面两三个按钮指向同一功能」逐条查证。修 40 余处，四类：① 重复入口（书架页三个同步按钮同函数、顶栏两处同 handleSync、账户页两个同款开关、保存配置=保存模板、问题反馈=常见问题…）② 名不副实（「今日复习」跳去没有复习入口的页面、「刷新数据」实为全量同步、搜索框只搜书名、「分享」只是复制）③ **假控件/假数字**（存储用量三个 MB 是写死常量 → 改为真实文件大小；微信读书页 13 个空控件全删，其中「仅同步所选分类」是假承诺；「已是最新版本」写死徽章；「清理历史」写 1,284 条实为删全部对话）④ **数据风险**（「重新蒸馏/重新提取」只 INSERT 不 delete，重复点会成倍翻 → 改为真替换 + 确认）。另：清空历史/删除会话补二次确认；「重新生成」只保留在最后一条回复上（实现只认最后一条提问）；复习完成态键盘守卫
- **2026-09-16 每日学习重做**：任务标题前的「0」是 sql.js 的 0/1 被 `&&` 当文本渲染出来的（在边界归一化成 boolean）；砍掉 4 项"没人知道你做没做"的形式任务（整理笔记/写卡片 2 张/总结反思等），只留系统自己能判定的 4 类（阅读/复习/生词/对话）；「复习 N 张卡片」原来取的是生词数还跳错页，改用真实卡片队列并跳复习页；手点勾（localStorage 覆盖）删除——进度环不允许被点出来；「已用时间」是编的，换成真实的今日已复习/已阅读；规则抽成 `src/shared/daily-tasks.ts` 并由 15 条测试守住。测试 860→875（40 文件）
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
| P1-2 ipc.ts 拆分 | P1 | **已修**（commit a3eb462，拆为 ipc/ 按领域文件；现为 12 个领域文件 + index 注册 + types 契约） | ✅ |
| P1-3 Vite CJS 弃用 | P1 | 迭代中 | ⏸️ |
| Phase 2 FSRS 升级 | P0 | **已完成**（v1.0.0 已集成 ts-fsrs 5.4.1） | ✅ |
| Phase 3 ECharts 集成 | P1 | **已完成**（v1.0.0 AdminDashboard 6 图表） | ✅ |
| **规范基础设施** | **P0** | CI 门禁 ✅ / husky pre-commit ✅ / commitlint ✅（三者 2026-09-18 装妥）/ 覆盖率阈值已接 CI ✅（2026-09-24）/ `tests/` 在 typecheck 内 ✅（2026-09-24）。**规范文本不再另立文件** —— 可执行真值就是那几份配置，文档里指向不存在文件的指针已全清（2026-09-24）| ✅ |

---

*最后更新：2026-09-25 | v1.3.4 已发布；之后 master 上补了 CI 换行符修复与 GitHub 维护面、四批工具链升级、密钥落盘加密与跨进程收口、功能深化一批（引用回原文 / 出处 / 练习记账 / 删除可撤销）、以及「删除不级联」的根因修复（sql.js `export()` 复位外键）· 1340 用例 / 89 文件*
*与 AGENTS.md 不一致时，两者均以上述实测代码配置为准（`package.json` / `eslint.config.js` / `tsconfig.json` / `vitest.config.ts`）*
