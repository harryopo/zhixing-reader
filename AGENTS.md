# 知行读书 — Agent Guide

> **面向对象**：所有 AI Agent（Claude Code / Cursor / Continue / Trae）
> **生效日期**：2026-07-20
> **配套规范**：[CLAUDE.md](CLAUDE.md) + [.learnings/STANDARDS.md](.learnings/STANDARDS.md) + [.claude/rules/](.claude/)

---

## 一、项目速览

**知行读书**（Zhixing Reader）— Electron 桌面应用，知行合一的阅读成长伙伴。

| 维度 | 详情 |
|------|------|
| 形态 | Electron 三进程桌面应用（Main / Preload / Renderer）|
| 框架 | electron-vite 2 + React 19 + TypeScript 5.6 strict |
| 存储 | sql.js (SQLite WASM) + Qdrant（可选向量库）|
| 核心能力 | 微信读书同步、FSRS 间隔重复、AI 智能体对话、知识卡片、词汇学习 |
| 打包 | electron-builder → Windows NSIS 安装包 |

---

## 二、目录结构（30 秒读懂）

```
zhixing-reader/
├── electron/              # Main 进程：DB、IPC、AI、FSRS、WeChat Read API
│   ├── main.ts            # 入口（窗口创建 + 初始化序列）
│   ├── preload.ts         # contextBridge API 暴露面
│   ├── ipc.ts             # 100+ IPC handler（计划拆分）
│   ├── database.ts        # sql.js DB + 13 个 db 对象（1967 行 → 计划拆）
│   ├── fsrs-engine.ts     # FSRS 间隔重复算法（v1，singleton 函数导出）
│   ├── agent/             # 智能体（意图分类 / 编排 / 策略）
│   └── services/          # 业务服务（RAG / 嵌入 / 知识卡片 / Prompt 模板）
│
├── src/renderer/          # Renderer 进程：React SPA
│   └── src/
│       ├── pages/         # 路由页面（Bookshelf / Review / Chat / Admin / ...）
│       ├── features/      # 业务模块（bookshelf / chat / review / ...）
│       ├── components/    # 通用 UI 组件
│       ├── stores/        # Zustand 状态管理
│       └── styles/        # Tailwind CSS
│
├── shared/                # 跨进程共享：类型 + IPC 通道常量
├── resources/             # 静态资源（dictionary.json / icon.png）
├── tests/                 # Vitest 单元测试（FSRS 引擎等纯逻辑）
│
├── .claude/               # Claude Code 专属配置
│   ├── rules/             # 领域规则（code-style / security / git）
│   ├── agents/            # Sub-agent 模板（code-reviewer / test-writer）
│   └── ownership.yaml     # 文件所有权（防冲突）
├── .learnings/            # 临时学习记录（项目内 .gitignore）
├── .github/workflows/     # CI/CD（lint+typecheck+test+build）
├── docs/                  # 设计文档 + 调研报告
│
├── AGENTS.md              # ← 你正在读的（所有 Agent 入口）
├── CLAUDE.md              # Claude Code 专属配置
└── package.json           # 依赖与脚本
```

---

## 三、常用命令（5 秒上手）

```bash
# 日常开发
npm run dev              # 开发模式（Vite 端口 5275 + Electron 自动开）
npm run build            # 三进程编译到 dist/
npm run start            # 预览生产构建

# 质量门禁（提交前必跑）
npm run lint             # ESLint 严格模式（0 错误）
npm run typecheck        # tsc --noEmit
npm run test             # Vitest（含覆盖率）
npm run verify           # 一键跑 lint+typecheck+test+build（推荐）

# 打包
npm run package:win      # Windows NSIS 安装包

# 词典（仅开发者）
npm run build-dict       # 从 ecdict.db 重新提取 dictionary.json
```

**提交顺序**：lint → typecheck → test → build（**全绿才可提交**）。

---

## 四、Sub-agent 协作约定 🔴核心必读

### 4.1 文件所有权（防冲突）

所有并行 Sub-agent 必须遵守 [.claude/ownership.yaml](.claude/ownership.yaml)：

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
  - 详细规范：`.claude/rules/review-agent.md`
  - 提示词模板、审查类目、反馈表达规范
- **test-writer** — Vitest 用例生成（红绿循环）

详见 [.claude/agents/](.claude/agents/)。

---

## 五、自动化质量门禁 🔴核心必读

### 5.1 本地门禁（提交前）

| 门禁 | 命令 | 失败影响 |
|------|------|---------|
| ESLint 严格模式 | `npm run lint` | 阻塞 commit |
| TypeScript strict | `npm run typecheck` | 阻塞 commit |
| Vitest + 覆盖率 | `npm run test` | 覆盖率 < 85% 阻塞 |
| Build 全通过 | `npm run build` | 阻塞 PR |

**一键验证**：
```bash
npm run verify
```

### 5.2 CI 门禁（GitHub Actions）

每次 push / PR 自动跑：
1. ESLint
2. TypeScript
3. Vitest（含覆盖率上传 artifact）
4. 三进程 build

详见 [.github/workflows/ci.yml](.github/workflows/ci.yml)。

### 5.3 15 条硬性规则（违反即阻塞）

完整列表见 [.learnings/STANDARDS.md](.learnings/STANDARDS.md)，速查：

| 类别 | 规则 |
|------|------|
| 🔴 安全 R1-R5 | 禁硬编码密钥 / 必参数化查询 / 错误响应不泄露 stack |
| 🟡 质量 R6-R10 | 覆盖率 ≥ 85% / 文件 ≤ 500 行 / 圈复杂度 ≤ 15 / 目录 ≤ 4 层 / 0 lint 错误 |
| 🟢 规范 R11-R15 | Feature-First / 命名即文档 / Colocation / 配置外化 / Conventional Commits |

---

## 六、领域专属规范

| 领域 | 规则文件 | 重点 |
|------|---------|------|
| 代码风格 | [.claude/rules/code-style.md](.claude/rules/code-style.md) | TS/React/Electron 细节 |
| 安全 | [.claude/rules/security.md](.claude/rules/security.md) | R1-R5 + IPC 安全 |
| Git | [.claude/rules/git.md](.claude/rules/git.md) | Conventional Commits + pre-commit |

---

## 七、关键注意事项（Gotchas）

来自 [AGENTS.md 根级规则](d:/ai/claude%20code/%E5%BE%AE%E4%BF%A1%E8%AF%BB%E4%B9%A6/AGENTS.md)：

1. **端口 5275 硬编码** — 不要单独修改 `electron.vite.config.ts` 或 `electron/main.ts` 的端口（原 5176 因 Windows Hyper-V 保留端口范围 5175-5274 改为 5275）
2. **sql.js 是 WASM** — 默认内存运行，持久化必须显式 read/write
3. **preload path 解析** — `getPreloadPath()` 尝试多路径，改 build 输出需同步
4. **Windows-only 打包** — electron-builder 只配 NSIS，无 macOS/Linux
5. **中文 UI** — 所有用户字符串保持中文一致
6. **preload.ts 已解包** — `window.electronAPI.xxx()` 返回的是 data，不要再 `.data` 二次解包

---

## 八、对话起手式

新对话开始时，按以下顺序加载上下文（避免一次性吞下全部）：

```typescript
// 1. 必须读：AGENTS.md（本文件）+ CLAUDE.md + .learnings/STANDARDS.md
// 2. 任务相关：对应的 .claude/rules/*.md
// 3. 任务代码：目标文件 + 上下游 ±200 行
// 4. 不读：node_modules、dist、release、resources
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
| `SYSTEM:CLEAR_HISTORY` | 清理所有对话历史（runTransaction 包裹）| `database.ts` `clearConversationsAndMessages` |
| `SYSTEM:RESET_DATABASE` | 重置数据库 16 张表 + `app.relaunch` | `database.ts` `resetDatabase` |
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
| 测试 | 项目无测试框架（AGENTS.md 已说明），新增功能需手动走查 |
| 可访问性 | Modal `role/aria-modal/aria-labelledby` + ESC + 焦点管理 |
| 文档 | spec/tasks/checklist/verify-report 四件套 + 代码内注释 + 规范 commit message |

### 9.4 相关文件

- spec：`.trae/specs/dead-code-governance/spec.md`
- 任务清单：`.trae/specs/dead-code-governance/tasks.md`
- 验收 checklist：`.trae/specs/dead-code-governance/checklist.md`
- 最终 verify report：`.trae/specs/dead-code-governance/verify-report.md`
- 经验沉淀：`.learnings/LEARNINGS.md` LRN-20260721-006~010

---

## 十、变更记录

| 日期 | 变更 | 作者 |
|------|------|------|
| 2026-07-20 | 初始化（v1）— 加入 .claude/、CI、Vitest、AGENTS.md | AI Agent |
| 2026-07-21 | 死代码治理循环工程收尾 — 新增第九章"死代码治理经验" + 7 个 IPC 通道清单 + 7 维质量评分基准 | dead-code-governance verifier-subagent |
| 待补 | husky pre-commit hook 安装 | — |
| 待补 | CONTRIBUTING.md | — |
