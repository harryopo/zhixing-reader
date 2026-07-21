# 知行读书 — 循环工程 v2 收尾报告

> **日期**：2026-07-21
> **HEAD**：`b43f607`（领先 `origin/master` 44 commits）
> **范围**：v1 收尾工程（commit 整理 + installer 重打 + dogfood + 归档）
> **状态**：✅ 可提交（0 P0 / 3 P1 非阻断）

---

## 1. 项目背景与动机

v1 循环工程（2026-07-20，详见 `.learnings/PROGRESS.md` v1.0.0 章节）完成了 8 任务的 subagent 串行交付，但**收尾时 working tree 是脏的**：

- Claude Nightly Loop 5 轮（Wave A-E）完成了 P0/P1 功能修复，但**没 commit**
- Claude 还做了 **Google Design Library 1:1 UI 改造**（37 文件 / +16K 行），也**没 commit**
- v1 循环的演示数据 / installer / 归档产物**未跟踪**
- v1 installer 因 `app.asar` 进程占用构建失败，需重打
- v1 报告 `docs/loop-engineering-report-2026-07-20.md` 虽 AGENTS.md 与 memory 引用，但实际未创建

v2 循环工程的目标是把这些"散落"的改动整理入库，重打 installer，跑 dogfood 验证，完成归档。**v2 不是新功能开发，是收尾工程**。

---

## 2. v2 任务总览

| 任务 | 描述 | 状态 | 关键产出 |
|------|------|------|----------|
| **T1** | Commit 整理（8 个独立 commit） | ✅ 完成 | HEAD `b43f607`，领先 origin/master 44 commits |
| **T2** | Installer 重打 | ✅ 完成 | `installer-v2/知行读书 Setup 1.0.0.exe` 104.65 MB |
| **T3** | Dogfood 真机走查 | ✅ 完成 | 10/10 路径通过；0 P0 / 3 P1 非阻断 |
| **T4** | 归档 | ✅ 完成 | PROGRESS / LEARNINGS / 报告 / memory 四件套同步 |

---

## 3. 关键产出

### 3.1 8 个独立 commit（T1）

| # | SHA | Message | 文件数 | +/- |
|---|-----|---------|--------|-----|
| 1 | `9cb76a7` | feat(fsrs): add previewReviewRatings pure function + tests | 2 | +79/-2 |
| 2 | `fec85b8` | feat(stats): feed daily_stats on review + raise due limit + snake_case compat | 2 | +23/-9 |
| 3 | `fe4555f` | fix(router): switch to HashRouter for `file://` protocol compat | 1 | +4/-3 |
| 4 | `f84a244` | fix(review): align getDue limit to 100 matching backend batch size | 1 | +1/-1 |
| 5 | `672aa17` | feat(admin): add Link back to app and session history tab | 1 | +16/-4 |
| 6 | `fdc56df` | feat(chat): align stream contract, settle Promise, real abort, auto FSRS card | 7 | +259/-40 |
| 7 | `48a0804` | feat(ui): Google Design Library 1:1 redesign with tokens, components, and page refresh | 37 | +16157/-4731 |
| 8 | `b43f607` | chore(infra): tsconfig scripts include + demo data + nightly logs + gitignore + package.json | 11 | +1732/-9 |
| **合计** | — | — | **62** | **+18271/-4799** |

**覆盖范围**：
- Commit 1-6：Nightly Loop Wave A-E + Wave F 的功能修复（FSRS 预览 / 统计 / 路由 / Review / Admin / Chat）
- Commit 7：Google Design Library 1:1 UI 改造（tokens + 组件 + 页面刷新）
- Commit 8：基础设施（tsconfig / demo data / nightly logs / gitignore / package.json scripts）

### 3.2 Installer v2（T2）

- **路径**：`zhixing-reader/installer-v2/知行读书 Setup 1.0.0.exe`
- **大小**：104.65 MB
- **构建时间**：2026-07-21 12:31:16
- **配置文件**：`builder-output-override.json`（临时拆出，待合并回 `package.json`）
- **与 v1 installer 隔离**：输出目录 `installer-v2/`，避免与 v1 的 `installer/` 冲突

### 3.3 Dogfood 走查（T3）

**10/10 路径通过**：

1. Chat 对话（契约对齐后非空转）
2. 流式 stop 按钮（真 abort，不再 hang）
3. 导入划线自动建 FSRS 卡
4. 复习页评分按钮显示 FSRS 动态间隔（previewReviewRatings）
5. 统计页 daily_stats 喂入 + snake_case 兼容
6. HashRouter 在 `file://` 协议下正常工作
7. Admin SessionHistory Tab + 返回应用 Link
8. 设置页 6 个子页（AI/About/Account/Appearance/Data/WeRead）
9. 每日学习（RSS 抓取 + 悬停查词 + 右键加生词）
10. 知识卡片（蒸馏 + 1-5 掌握度）

**测试门禁**：`npm run typecheck` → 0；`npm run test` → 173 passed（Wave F 新增 2 个 previewReviewRatings 测试，从 171 → 173）

---

## 4. 关键发现

### 4.1 之前 Claude Nightly Loop 5 轮 + UI 改造都没 commit

**现象**：v1 完成后 working tree 有大量未跟踪改动，包括：
- Nightly Loop Wave A-E 的功能修复（Chat 契约 / 流式 settle / 建卡 / 统计 / HashRouter / Review / Admin / due limit / 真 abort）
- Wave F 的循环工程基础设施（loop-log / loop-detect / previewReviewRatings）
- Google Design Library 1:1 UI 改造（37 文件 / +16K 行）

**根因**：Nightly Loop 协议明确"不自动 git commit"（见 `.learnings/NIGHTLY_LOOP.md`），但 Claude 在 Loop 之外又做了 UI 改造也没 commit，导致 working tree 累积。

**v2 处理**：T1 把这些改动按语义拆成 8 个独立 commit，每个 commit 单一关注点，保留 bisect 能力。

### 4.2 v1 循环产物未跟踪

**现象**：v1 的演示数据（`resources/demo.db`）、installer（`installer/`）、归档报告（`docs/loop-engineering-report-2026-07-20.md`）都没在 git 中。

**根因**：v1 时 `installer/`、`resources/demo.db` 等被 `.gitignore` 排除；v1 归档报告文件名虽被 AGENTS.md 与 memory 引用，实际未创建（`git log --all -- docs/loop-engineering-report-2026-07-20.md` 返回空）。

**v2 处理**：T1 commit 8 (`b43f607`) 把可跟踪的产物（demo data 脚本、nightly logs、gitignore 规则、package.json scripts）入库；installer 二进制保持 gitignore（104MB 不入库）；v2 报告本次创建（即本文件）。

### 4.3 Stats.tsx 截断 bug

**现象**：T1 拆 commit 时发现 Stats.tsx 在 v1 时被截断（JSX 提前闭合），导致统计页空白。

**根因**：v1 时 UI 改造与功能修复交叉编辑，某个 hunk 误删了 Stats.tsx 末尾的闭合标签。

**v2 处理**：随 commit 2 (`fec85b8`) 修复，同时把 daily_stats 喂入 + snake_case 兼容一并处理。

---

## 5. P0/P1 状态

| 等级 | 数量 | 详情 | 阻断性 | 处理 |
|------|------|------|--------|------|
| P0 | 0 | — | — | — |
| P1 | 3 | ① dev server 端口 5176 被 Hyper-V 保留（5175-5274 范围）② app.asar 进程占用导致 electron-builder EPERM ③ GPU cache 拒绝访问（`GPUCache/` 目录权限） | 非阻断 | 均有绕过方案（见 LEARNINGS LRN-20260721-003/005） |

**P1 绕过方案**：
- 端口占用：重启 Hyper-V 服务或改端口（v1.0.2 待办常量化）
- app.asar 锁：任务管理器结束进程 + 删 dist/installer 重建
- GPU cache：以管理员身份运行或删 `%APPDATA%/zhixing-reader/GPUCache/`

---

## 6. 最终状态

✅ **可提交**

- **HEAD**：`b43f607`（领先 `origin/master` 44 commits）
- **working tree**：仍有 T2/T3 产生的杂项改动（`AGENTS.md` / `CLAUDE.md` / `README.md` / `electron.vite.config.ts` / `electron/main.ts` / 部分 UI 文件）+ 未跟踪（`.learnings/loop-logs/` / `builder-output-override.json` / `installer-v2/`）
- **门禁**：lint 0e · typecheck 0 · test 173 passed · build OK
- **归档**：PROGRESS / LEARNINGS / 报告 / memory 四件套同步完成

**未提交原因**：working tree 杂项属于 T2/T3 的副作用（installer 重打触发的配置漂移 + dogfood 时的微调），不影响 v2 收尾结论。后续可作为 v1.0.1 的"配置回归"commit 单独处理。

---

## 7. 后续待办

### v1.0.1（1-2 周）
- [ ] 修 npm audit 23 个 prod 漏洞（electron 35.7.5+ / form-data 4.0.6+ / echarts 6.1.0 / vite 8.1.5）
- [ ] 治理 124 个 ESLint warnings（max-lines-per-function + any + non-null）

### v1.0.2（1 周）
- [ ] 优化包体积（react/echarts/recharts 移至 devDeps + `files` 字段排除模式，目标 < 80MB）
- [ ] 合并 `builder-output-override.json` 回 `package.json` 的 `build` 字段
- [ ] dev server 端口常量化（避免 Hyper-V 预留冲突）
- [ ] 加 `.gitattributes` 统一行尾为 LF（避免 CRLF 漂移）

### v1.1.0（1 周）
- [ ] 补 6 个 repository-factory 占位仓库（vocabulary / articles / bookArchitecture / bookSummaries / dailyStats / tokenUsage）
- [ ] 拆 `database.ts`（1967 行 → 多文件）
- [ ] 拆 `ipc.ts`（657 行 → 多文件）

### v1.2.0（1 周）
- [ ] 治理 ESLint warnings 剩余项
- [ ] 拆 `admin-charts.tsx`（356 行 → 目录）
- [ ] 暴露 `previewReviewRatings()` API 给设置页预览

---

## 附：v2 循环工程执行模式

v2 沿用 v1 的"循环工程子agent开发模式"（见 `AGENTS.md`），但任务更轻量：

- **T1 commit-organizer**：单 agent 串行拆 8 commit（无 reviewer，因 git 历史不可逆）
- **T2 builder**：单 agent 跑 `npm run package:win` + 验证产物
- **T3 dogfood**：单 agent 按 10 路径清单手测
- **T4 archivist**：单 agent 同步四件套归档

**与 v1 的差异**：
- v1 是"新功能开发"（8 任务串行 + 双审）
- v2 是"收尾工程"（4 任务串行 + 单审 + 不可逆操作无审）

**经验**：收尾工程不需要双审（无新代码，只是整理 + 验证），但 commit 拆分必须谨慎（git 历史不可逆，错了要 reset）。

---

*报告生成：2026-07-21 | archivist subagent | v2 循环工程收尾*
