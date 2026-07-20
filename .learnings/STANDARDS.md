# 知行读书 — 开发规范速查

> **作用**：一页纸速查 ai-dev-workflow 六阶段流程 + 15 条硬性规则 + 提交前自检清单
> **详细版**：`CLAUDE.md`（Claude 专属）+ `.claude/rules/*.md`（领域规范）
> **更新规则**：同一类问题在 `.learnings/` 出现 ≥3 次时，由本文件收纳

---

## 一、六阶段流程（任何非平凡任务都从这里开始）

```
需求澄清 → 架构设计 → 项目脚手架 → 编码实现 → 质量门禁 → 知识沉淀
  PRD        ADR        结构校验     Code Review   全自动检查   更新 STANDARDS
  闸门1      闸门2      闸门3        闸门4         闸门5        闸门6
```

| 阶段 | 输出物 | 闸门（不做不前进） |
|------|--------|------------------|
| 一 | `docs/plans/YYYY-MM-DD-{feature}.md` 含功能/非功能/验收 | 用户确认 |
| 二 | ADR + 目录树 + API Spec + DB Schema | 用户确认 |
| 三 | 完整骨架 + AGENTS.md + CLAUDE.md | `npm run verify` 通过 |
| 四 | 代码 + 单测 | AI Code Review 通过 + 覆盖率 |
| 五 | 门禁报告 | lint+type+test+build+audit 全绿 |
| 六 | 更新本文件 + `.learnings/` | 知识归档完成 |

**已有项目**：跳过阶段一/二，直接从阶段三（结构检查）+ 阶段五（门禁检查）切入。

---

## 二、15 条硬性规则

### 🔴 安全规则（违反即阻塞）

| # | 规则 | 本项目落地点 |
|---|------|-------------|
| R1 | 禁止硬编码密钥 | `safeStorage.encryptString` (electron/services/settings-service.ts) |
| R2 | 用户输入必须验证 | zod schema 在 IPC handler 入口（已部分缺失，待补） |
| R3 | API 响应不泄露 stack | error handler 走 toast，不直传 Error.stack |
| R4 | DB 参数化查询 | `db.prepare(sql).run(params)` 全量检查（sql.js） |
| R5 | 敏感操作审计日志 | 缺失，**TODO**：删除/权限变更/同步需 log |

### 🟡 质量规则（违反需修复）

| # | 规则 | 阈值 | 自动化 |
|---|------|------|--------|
| R6 | 新增代码覆盖率 | ≥ 85%（已有代码不强制） | vitest --coverage |
| R7 | 单文件行数 | ≤ 500 行 | ESLint `max-lines` |
| R8 | 单函数圈复杂度 | ≤ 15 | ESLint `complexity` |
| R9 | 目录深度 | ≤ 4 层 | AI 审查 |
| R10 | Linter 错误 | 0 | `npm run lint` |

### 🟢 规范规则（遵守但不阻塞）

| # | 规则 | 本项目习惯 |
|---|------|------------|
| R11 | Feature-First | `src/renderer/src/pages/{领域}/` 内含组件+hooks+API |
| R12 | 命名即文档 | `use-auth.ts` 而非 `utils.ts` |
| R13 | Colocation | 测试文件与源码同目录或 `tests/` 镜像 |
| R14 | 配置外化 | `.env` + safeStorage |
| R15 | Conventional Commits | `feat: / fix: / chore: / docs: / test: / refactor:` |

---

## 三、提交前自检清单（pre-commit 已自动化前 4 项）

```bash
□ npm run lint           # ESLint 0 错误
□ npm run typecheck      # tsc --noEmit 0 错误
□ npm run test           # vitest 全通过
□ npm run build          # electron-vite 成功
□ git status --porcelain # 无未跟踪大文件 / 调试 console
□ .learnings/ 同步       # 踩坑已记录
```

**Commit 格式**（commitlint 强校验）：

```
<type>(<scope>): <subject>

<body 72 字符换行>

<footer>
```

- type: `feat | fix | chore | docs | test | refactor | perf | build | ci | style | revert`
- scope 可选：`agent | ipc | db | fsrs | ai | renderer | build | deps | ...`
- 禁止：`WIP`、`fix bug`、`update code`

---

## 四、本项目特殊约束

| 约束 | 原因 |
|------|------|
| **不引入原生模块** | Electron 35 + Windows 11，node-gyp 编译链不稳。优先 sql.js（已用） |
| **不升级 React Router 7 大版本** | 7.0 → 8.0 破坏性变更，比赛前不做 |
| **不重写数据库层** | `database.ts` 1967 行是技术债但稳定，拆文件留到比赛后 |
| **不重写 ipc.ts** | 657 行同样留到比赛后 |
| **~~不切 ECharts~~** | ✅ **已切到 ECharts**（AdminDashboard 局部，4 commits `ad56699/67df415/e0ec3a2/5f7ad84`），admin chunk 优化到位 |
| **保持中文 UI** | 用户面向中文学习者 |

---

## 五、AI 协作约定（Claude/AI Agent 必读）

1. **改前必读**：用 Read 工具读目标文件 + 关联文件
2. **改后必验**：lint + typecheck + 相关 test
3. **不跳步骤**：用户说"直接写"时先确认
4. **范围纪律**：只碰被要求碰的；发现无关问题用 `NOTICED BUT NOT TOUCHING: ...` 格式记录
5. **沉淀**：踩坑 → `.learnings/ERRORS.md` 或 `LEARNINGS.md`
6. **质量声明前必验证**：跑命令看输出，不靠"应该通过"

---

## 六、CI 流水线（GitHub Actions 自动化）

触发条件：`pull_request` + `push: master`

| 阶段 | 命令 | 必须通过 |
|------|------|----------|
| Lint | `npm run lint` | ✅ |
| Type | `npm run typecheck` | ✅ |
| Test | `npm run test -- --run` | ✅ |
| Build | `npm run build` | ✅ |
| Secret scan | trufflehog filesystem . | ✅ |
| Dep audit | `npm audit --audit-level=high` | ✅ |

> 比赛期间（7/20-7/31）：可临时在 GitHub 端关闭 Actions 节省配额；本地 pre-commit 仍强制

---

## 七、快速命令

```bash
npm run dev           # 开发服务器（renderer 5176）
npm run lint          # ESLint
npm run lint:fix      # ESLint --fix
npm run typecheck     # tsc --noEmit
npm run test          # vitest watch
npm run test:run      # vitest --run（CI 用）
npm run verify        # lint + typecheck + test:run + build 一键全检
npm run package:win   # Windows NSIS 打包
```

---

*最后更新：2026-07-20 | 由 ai-dev-workflow skill 自动生成*
