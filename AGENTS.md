# 知行读书 — Agent Guide

> **面向对象**：所有 AI Agent（Claude Code / Cursor / Continue / Trae）
> **生效日期**：2026-07-20
> **配套规范**：[CLAUDE.md](CLAUDE.md) + [.learnings/LEARNINGS.md](.learnings/LEARNINGS.md) + [.learnings/PROGRESS.md](.learnings/PROGRESS.md)
> **最近核验**：2026-09-11（对代码实测校准；见第十章变更记录）

---

## 一、项目速览

**知行读书**（Zhixing Reader）— Electron 桌面应用，知行合一的阅读成长伙伴。

| 维度 | 详情 |
|------|------|
| 形态 | Electron 三进程桌面应用（Main / Preload / Renderer）|
| 框架 | electron-vite 2 + React 19 + TypeScript 5.6 strict |
| 存储 | sql.js (SQLite WASM) + Vectra 本地向量索引 |
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
│   ├── fsrs-engine.ts     # FSRS v5 适配层（基于 ts-fsrs 5.4.1，对外 API 100% 兼容）
│   ├── agent/             # 智能体（意图分类 / 编排 / 策略）
│   └── services/          # 业务服务（RAG / 嵌入 / 知识卡片 / Prompt 模板）
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
├── resources/             # 静态资源（dictionary.json / icon.png）
├── tests/                 # Vitest 单元测试（30 文件 / 688 用例）
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
npm run test             # Vitest（688 用例；不含覆盖率）
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
| Git | `.claude/rules/git.md` ⚠️未落地 | Conventional Commits；⚠️ **pre-commit hook 与 commitlint 均未安装** |

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
| 测试 | 项目已有 Vitest（30 文件 / 688 用例；纯逻辑 + 组件测试）。新增功能应补 `tests/*.test.ts`，门禁跑 `npm run test` |
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
| 2026-09-11 | 接手核验校准 — 修正 Qdrant→Vectra、fsrs-engine v1→v5 适配层、database/ 文件数、测试数（667→688）、覆盖率门禁口径（未接入）、`.claude/` 与 `.learnings/STANDARDS.md` 标注未落地、`.trae/` 四件套标注缺失；删除 §9.3「项目无测试框架」错误陈述 | AI Agent（接手） |
| 2026-09-11 | 遗留问题治理 — ① 补全 **Skill 导出全链路**（新增 `SKILL.EXPORT_FILE` 通道 + 方法论详情页「导出为 Skill」按钮，此前 handler/preload/AI 服务/测试齐全但无 UI）② 删除 6 个指向已消失 `scripts/` 的死脚本 ③ 清理 eslint 失效 grandfather 条目 ④ 明确 `.learnings/`/`.workbuddy/memory/` 为**本地文件不入库**（含内部策略与已知问题，不进公开仓库）⑤ `diagrams/`、`html2pdf-ultra.js` 显式 gitignore ⑥ CI 移除永不产出的 coverage artifact 步骤 | AI Agent（接手） |
| 2026-08-28 | v1.1.0 维护迭代 — 换机恢复 + 去伪存真（假数据/死链治理）+ 间隔复习与 Token 统计落地 + 画像注入 + database/ipc 拆分 + 编排页迁入设置壳层 + 管理后台移出前端；端口勘误 5275→5500 | AI Agent |
| 2026-07-20 | 初始化（v1）— 加入 .claude/、CI、Vitest、AGENTS.md | AI Agent |
| 2026-07-21 | 死代码治理循环工程收尾 — 新增第九章"死代码治理经验" + 7 个 IPC 通道清单 + 7 维质量评分基准 | dead-code-governance verifier-subagent |
| 待补 | husky pre-commit hook 安装（当前不存在，勿依赖自动拦截）| — |
| 待补 | commitlint 配置（当前不存在，R10 仅靠人工遵守）| — |
| 待补 | `.claude/rules/*` + `.learnings/STANDARDS.md` 正本（被多处引用但不存在）| — |
| 待补 | `.trae/specs/dead-code-governance/` 四件套 | — |
| 已处理 | `scripts/` 相关 6 个死脚本已从 `package.json` 移除（2026-09-11）| — |
