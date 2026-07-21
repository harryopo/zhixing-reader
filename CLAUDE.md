# CLAUDE.md — Claude Code 专属配置

> **作用**：Claude Code（Cursor/Trae/Claude Code CLI）启动时自动加载的项目级指令
> **作用范围**：仅在 Claude 系列 AI 中生效；其他 AI 看 `AGENTS.md`（已存在，更通用）
> **更新时机**：本文件由 `.learnings/STANDARDS.md` 提炼而来；与项目记忆冲突时，以本文件为准
> **详细规范**：`.claude/rules/{code-style,security,git}.md`

---

## 0. 一句话项目身份

> **知行读书**是 Anki 同源 FSRS 算法驱动的 AI 阅读成长智能体（Electron + React + sql.js），打通「微信读书同步 → AI 智能体理解 → 科学间隔复习 → 知识卡片体系化 → 英语学习」完整闭环。参赛作品 v1.0.0，距提交 11 天。

---

## 1. 必须先读的文件（按场景）

| 场景 | 先读 |
|------|------|
| 改 Electron 主进程 | `electron/main.ts` + `electron/database.ts` + `shared/ipc-channels.ts` |
| 改 IPC 通道 | `shared/ipc-channels.ts` + `electron/ipc.ts` + `electron/preload.ts` |
| 改数据库 schema | `electron/database.ts` + `electron/repositories/` + `electron/utils/db.ts` |
| 改 AI 提示词 | `electron/services/prompt-registry.ts` + `prompt-storage.ts` |
| 改智能体编排 | `electron/agent/orchestrator.ts` + `system-prompt.ts` + `context-builder.ts` |
| 改 React 页面 | `src/renderer/src/App.tsx`（路由）+ 对应 `pages/` 目录 |
| 改 Zustand store | `src/renderer/src/stores/` 找对应 store |
| 改 FSRS 复习 | `electron/fsrs-engine.ts`（自实现）+ `database.ts` 中卡片相关表 |

---

## 2. 绝对禁止（红线）

| # | 禁止 | 原因 |
|---|------|------|
| **A1** | 引入原生 Node 模块（node-gyp 编译） | sql.js 已用，原生模块在 Electron 35 + Win11 编译链不稳 |
| **A2** | 把 API Key、Token 写入代码或日志 | R1 + safeStorage 已有方案 |
| **A3** | 改 `database.ts` 1967 行核心文件而不读全文 | 拆解是 P1-1 技术债，比赛中禁止 |
| **A4** | 改 `ipc.ts` 657 行而不读全文 | 同上 |
| **A5** | 使用 React Router 8.x 升级 | 破坏性变更，比赛前禁止 |
| **A6** | 删 `.learnings/` 任何已有内容 | 团队沉淀的知识资产 |
| **A7** | 改 AGENTS.md 已写明的硬约束（端口 5275、`@/` 别名、Chinese UI） | 见 AGENTS.md Gotchas |
| **A8** | 提交时跳过 lint/typecheck/test | pre-commit hook 强制 |
| **A9** | `git add -A` / `git add .` | 可能误提交 .env / node_modules |
| **A10** | commit message 用 `WIP`/`fix bug`/`update code` | commitlint 拦截 |
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
| **B10** | commit message 必填 type（feat/fix/chore/docs/test/refactor/perf/build/ci/style/revert） | commitlint 强校验 |
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
| Qdrant | 通过 `electron/services/vector-db.ts` | ✅ 集成（可选） |

---

## 6. 自动化门禁（pre-commit + CI 强制）

| 命令 | 作用 | 触发 |
|------|------|------|
| `npm run lint` | ESLint 0 错误 | 本地 pre-commit + CI |
| `npm run typecheck` | tsc --noEmit 0 错误 | 本地 pre-commit + CI |
| `npm run test:run` | vitest 全通过 | 本地 pre-commit + CI |
| `npm run build` | electron-vite 编译 | CI |
| `npm run verify` | 上面四项一键串行 | 手动 |
| husky pre-commit | 跑上面三项本地拦截 | `git commit` |
| commitlint | Conventional Commits 校验 | `git commit -m "..."` |
| GitHub Actions | push/PR 完整流水线 | 远程 |

---

## 7. 知识沉淀位置（按温度分层）

| 温度 | 位置 | 用途 |
|------|------|------|
| 🔥 热 | 本对话上下文 | 即时讨论 |
| 🌡️ 温 | `.learnings/STANDARDS.md` | 速查规范 |
| 🌡️ 温 | `.learnings/ERRORS.md` | 已解决 bug |
| 🌡️ 温 | `.learnings/LEARNINGS.md` | 最佳实践 + 教训 |
| 🌡️ 温 | `.learnings/PROGRESS.md` | 进度跟踪 |
| 🧊 冷 | `CLAUDE.md`（本文件） | 每次启动加载 |
| 🧊 冷 | `AGENTS.md` | 所有 AI 通用 |
| 🧊 冷 | `docs/superpowers/specs/*.md` | 历史设计文档 |
| 🧊 冷 | `docs/research/*.md` | 调研报告（自检报告已建） |
| ❄️ 冻 | 代码本体 + 注释 | 不沉淀 |

---

## 8. 紧急联系（比赛相关）

- **距大赛提交**：11 天（截止 2026-07-31）
- **自检报告**：[`docs/项目自检_优化方案_2026-07-20.md`](../../docs/%E9%A1%B9%E7%9B%AE%E8%87%AA%E6%A3%80_%E4%BC%98%E5%8C%96%E6%96%B9%E6%A1%88_2026-07-20.md)
- **P0 bug 清单**：4 个（自检报告 §1.2）
- **当前阶段**：止血 + 规范建设（Day 1-2）

---

## 9. 自检报告未处理项的归属（避免重复劳动）

| 报告项 | 优先级 | 归属 | 状态 |
|--------|--------|------|------|
| P0-1 关窗数据保存 | P0 | **Day 1-2** | ⏳ |
| P0-2 rag-service 动态导入 | P0 | **已修**（commit d91036b） | ✅ |
| P0-3 preload stream 监听器 | P0 | **Day 1-2** | ⏳ |
| P0-4 IPC 通道统一常量 | P0 | **Day 1-2** | ⏳ |
| P1-1 database.ts 拆分 | P1 | 比赛后 | ⏸️ |
| P1-2 ipc.ts 拆分 | P1 | 比赛后 | ⏸️ |
| P1-3 Vite CJS 弃用 | P1 | 比赛后 | ⏸️ |
| Phase 2 FSRS 升级 | P0 | Day 3-4 | ⏳ |
| Phase 3 ECharts 集成 | P1 | Day 5-7 | ⏳ |
| **规范基础设施** | **P0** | **本次任务** | 🔄 |

---

*最后更新：2026-07-21 | 死代码治理循环工程收尾（A11/A12 + B11-B15 新增）*
*与 AGENTS.md 不一致时，以本文件 + .claude/rules/* 为准（Claude 专属）*
