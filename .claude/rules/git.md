# Git Rules — 知行读书

> **适用**：所有 git commit / branch / PR 操作
> **强制级别**：commitlint + husky pre-commit + GitHub Actions
> **详细规范**：ai-dev-workflow §五（Git Commit 规范）

---

## 1. Conventional Commits 强制规范

### 1.1 Commit Message 格式

```
<type>(<scope>): <subject>

<body（可选，72 字符换行）>

<footer（可选）>
```

### 1.2 Type 列表（必须小写）

| Type | 含义 | 触发版本号 |
|------|------|----------|
| `feat` | 新功能 | MINOR 升 |
| `fix` | Bug 修复 | PATCH 升 |
| `docs` | 文档变更 | — |
| `style` | 格式（不影响代码） | — |
| `refactor` | 重构（非 feat/fix） | — |
| `perf` | 性能优化 | PATCH 升 |
| `test` | 测试 | — |
| `build` | 构建系统/依赖 | — |
| `ci` | CI 配置 | — |
| `chore` | 杂项（不修改 src/test） | — |
| `revert` | 回退 | — |

### 1.3 Scope（本项目约定）

| Scope | 范围 |
|-------|------|
| `agent` | electron/agent/ 智能体 |
| `ipc` | electron/ipc.ts + preload.ts + ipc-channels |
| `db` | electron/database.ts + repositories/ + utils/db.ts |
| `fsrs` | electron/fsrs-engine.ts |
| `ai` | electron/ai-service.ts + http-client.ts |
| `weread` | electron/weread-api.ts |
| `renderer` | src/renderer/src/ |
| `admin` | src/renderer/src/pages/admin/ |
| `bookshelf` | 书架 feature |
| `chat` | 对话 feature |
| `review` | 复习 feature |
| `daily` | 每日学习 feature |
| `vocab` | 词汇 feature |
| `deps` | 依赖 |
| `build` | 构建配置 |
| `ci` | CI 配置 |
| `docs` | 文档 |
| `hooks` | husky/pre-commit |

### 1.4 Subject 规则

- 50 字符以内
- 首字母不大写
- 不加句号
- 中文允许（项目以中文团队为主），但英文优先
- 祈使语气："添加 X" 而非 "添加了 X"

### 1.5 Body 规则（可选）

- 解释 **WHY** 而非 WHAT
- 72 字符换行
- 可用列表

### 1.6 Footer 规则

- `Refs: #123` 或 `Closes #456`
- `BREAKING CHANGE: 描述`（触发 MAJOR 升）

---

## 2. 提交示例

### ✅ 标准示例

```bash
# 新功能
git commit -m "feat(chat): 添加对话历史搜索功能

支持按内容/书籍/时间范围检索历史对话，
复用现有 chatStore.search() 接口。

Refs: #123"

# Bug 修复
git commit -m "fix(db): 修复关窗时数据丢失问题

主进程 before-quit 已正确调用 forceSaveDatabase，
但用户直接点 X 关窗时未触发。
解决方案：在 mainWindow.on('close') 中也调用。

Closes #456"

# 依赖
git commit -m "chore(deps): 升级 typescript 到 5.6.3"

# 文档
git commit -m "docs: 更新 AGENTS.md 自动化门禁章节"

# 性能
git commit -m "perf(admin): AdminDashboard 切 ECharts 后体积 -400KB"

# 重构
git commit -m "refactor(db): 提取 schema 建表逻辑到 db-init.ts"
```

### ❌ 禁止示例

```bash
git commit -m "update code"                    # ❌ 无意义
git commit -m "WIP"                            # ❌
git commit -m "fix bug"                        # ❌
git commit -m "feat: 添加功能。"                # ❌ 句号
git commit -m "Feat: 添加功能"                 # ❌ type 大写
git commit -m "feat:Add"                       # ❌ 冒号后无空格
```

**commitlint 会自动拒绝以上格式**

---

## 3. Pre-commit 强制流程

```bash
git commit -m "feat: xxx"
  ↓
.husky/pre-commit 触发：
  1. npm run lint           # ESLint 0 错误
  2. npm run typecheck      # tsc 0 错误
  3. npx trufflehog filesystem .  # 密钥扫描
  4. npm run test:run       # 单测全过（可跳过用 --no-verify）
  ↓
commitlint 校验 message 格式
  ↓
提交成功
```

**紧急跳过**（仅比赛交付冲刺期）：

```bash
git commit --no-verify -m "feat: 紧急修复"
# ⚠️ 但事后必须补 verify + 单独 commit 修复
```

---

## 4. Branch 策略

### 4.1 主分支

- `master` — 主分支（当前）
- 比赛期间：直推 master 即可，无需 PR（节省时间）
- 比赛后：恢复 `feature/*` → `master` PR 流程

### 4.2 临时分支（可选）

```bash
git checkout -b feat/knowledge-card-distill
# 完成后
git checkout master
git merge --no-ff feat/knowledge-card-distill
git branch -d feat/knowledge-card-distill
```

**避免**：
- 长寿命分支（>3 天未合）
- 嵌套分支

---

## 5. Stage 规则

```bash
# ✅ 按文件 stage（推荐）
git add electron/ipc.ts electron/preload.ts shared/ipc-channels.ts
git commit -m "feat(ipc): 统一 IPC 通道为常量"

# ✅ 交互式
git add -p  # 按 hunk stage

# ❌ 禁止 -A / . （可能误提交 .env / node_modules / 调试文件）
git add -A  # ❌
git add .   # ❌
```

**.gitignore 已包含**：
- `node_modules/` `dist/` `release/` `out/`
- `*.log` `.env` `.env.local`
- `resources/ecdict.db`（大文件）

---

## 6. 敏感信息保护

```bash
# 如果不小心提交了密钥
git rm --cached path/to/secret
git commit -m "chore: 移除误提交密钥"
# 然后立即轮换密钥
```

**pre-commit 已有** `trufflehog filesystem .` 扫描，会拦截。

---

## 7. 提交频率

| 频率 | 推荐 |
|------|------|
| 大量无关改动 | ❌ 拆成多个 commit |
| 一个完整功能 | ✅ 一个 commit |
| Bug 修复 + 重构 | ❌ 拆开 |
| 调试代码混在功能中 | ❌ 用 git add -p 分离 |

**原则**：一个 commit 只做一件事（便于 revert）

---

## 8. 与本项目历史的衔接

最近 5 个 commit 风格：
```
49e8611 feat: 知行读书 v1.0.0 - AI驱动的阅读成长伙伴
d91036b chore(build): fix dynamic import warning in rag-service
```

**本项目 commit 风格**：scope 必填，subject 中文为主，body 偶尔出现。

**建议**（由 commitlint 强制）：
- 已有 `49e8611` 是 `feat:` 无 scope —— 未来 commit 应补 scope
- 已有 `d91036b` 是 `chore(build):` 格式 —— 符合本规则

---

## 9. 紧急提交约定

比赛期间（7/20-7/31）：

```bash
# 紧急修复 P0 bug
git commit -m "fix(主进程): 修复关窗数据丢失" --no-verify
git push origin master  # 比赛期允许直推

# 补充 verify
git commit -m "chore(ci): 补全 verify 链路" --allow-empty
```

---

## 10. Pre-commit 完整流程图

```
git commit -m "..."
   │
   ├─→ .husky/pre-commit
   │     │
   │     ├─→ npm run lint          (必须 0 错误)
   │     ├─→ npm run typecheck     (必须 0 错误)
   │     ├─→ npx trufflehog filesystem .  (必须 0 命中)
   │     └─→ npm run test:run      (全过或 --no-verify 跳过)
   │
   └─→ commitlint 校验 message 格式
         │
         └─→ 通过 → 写入 .git
         └─→ 不通过 → 拒绝并提示

失败处理：
- lint/type 失败 → 编辑代码 → 重试
- trufflehog 命中 → 移除密钥 → 重新加密存储 → 重试
- commitlint 失败 → 修改 message → 重试
```

---

*最后更新：2026-07-20 | 由 ai-dev-workflow skill 自动生成*
