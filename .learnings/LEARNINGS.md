# Learnings

知行读书项目开发过程中的学习记录、错误和改进。

> **最近更新**：2026-07-25 — 追加 LRN-20260725-007~009 v1.0.0 正式开源发布经验

---

## [LRN-20260725-009] best_practice

**Logged**: 2026-07-25T17:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tooling
**Project**: zhixing-reader

### Summary
GitHub Release 创建时若 tag 已存在，应使用 `gh release upload --clobber` + `gh release edit` 增量更新，而非 `gh release delete` + 重建。

### Details
v1.0.0 tag 在 2026-07-14 已预先创建（旧 installer 96.62MB），本次 7/25 收尾时需替换为新的 125MB installer。直接 `gh release create v1.0.0` 报错 `a release with the same tag name already exists`。

**正确流程**：
1. `gh release delete-asset v1.0.0 Setup.1.0.0.exe --yes` 删除旧 asset
2. `gh release upload v1.0.0 "新文件" --clobber` 上传新 asset（--clobber 防止同名冲突）
3. `gh release edit v1.0.0 --title "..." --notes-file "..." --latest` 更新 release notes 与标题
4. 若需重命名 asset（避免中文文件名乱码），用 `gh api -X PATCH /repos/.../assets/{id} -f name=英文 -f label=描述`

**关键坑**：PowerShell 调用 `gh api -f "name=知行读书.exe"` 时中文会被编码为乱码（GBK→UTF-8 错位）。**Release asset 名称必须用 ASCII**，描述字段也尽量用英文或通过 JSON body 传 UTF-8 字节。

### Suggested Action
GitHub Release 增量更新模板：delete-asset → upload --clobber → edit notes。Asset 名称统一用 ASCII（项目名-Setup-版本.exe），中文展示用 label 字段（但仍有编码风险，建议英文 label）。

### Metadata
- Source: loop-engineering-v2/v1.0.0-publish
- Related Files: .github/RELEASE_NOTES_v1.0.0.md
- Tags: github, release, gh-cli, asset-upload, powershell-encoding

---

## [LRN-20260725-008] best_practice

**Logged**: 2026-07-25T16:30:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tooling
**Project**: zhixing-reader

### Summary
GitHub 大文件推送前必须用 `git filter-branch` 清理历史，否则 100MB+ 文件会导致 push 被永久拒绝（即使后续 commit 删除也不行）。

### Details
v1.0.0 发布前 push 时遇到 `pre-receive hook declined`：历史 commit 中存在 `installer-v2/知行读书 Setup 1.0.0.exe`（104MB+），即使后续 commit 已删除该文件，git 历史仍保留 blob，GitHub 服务端会扫描所有 commit 拒绝整批 push。

**清理流程**：
```bash
# 1. 用 filter-branch 从所有历史中删除大文件目录
git filter-branch --force --index-filter \
  "git rm -rf --cached --ignore-unmatch installer-v2/ installer-final/" \
  --prune-empty --tag-name-filter cat -- --all

# 2. 删除 filter-branch 备份引用
git for-each-ref --format="%(refname)" refs/original/ | xargs -n 1 git update-ref -d

# 3. 强制垃圾回收释放空间
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# 4. force push 覆盖远端历史
git push origin master --force
```

**关键点**：
- `--ignore-unmatch` 防止早期 commit 没有该目录时报错
- 必须删除 `refs/original/refs/heads/master` 备份引用，否则 gc 不会真正释放
- force push 是必须的，因为历史已经被重写

**预防**：`.gitignore` 应在项目初期就加入 `installer*/`、`dist-installer/` 等打包产物目录，避免大文件误入 git。

### Suggested Action
项目初始化模板 `.gitignore` 必含 `installer*/`、`dist/`、`*.exe`、`node_modules/`。打包产物永远不入库，通过 GitHub Release Assets 分发。

### Metadata
- Source: loop-engineering-v2/push-blocked
- Related Files: .gitignore
- Tags: git, filter-branch, large-files, github-push, git-history

---

## [LRN-20260725-007] best_practice

**Logged**: 2026-07-25T16:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tooling
**Project**: zhixing-reader

### Summary
SSH 密钥配置 GitHub push 必须用 `GIT_SSH_COMMAND` 环境变量显式指定密钥路径，否则默认 ssh-agent 会找不到非默认路径的密钥。

### Details
项目密钥放在 `d:\ai\claude code\微信读书\.ssh\id_ed25519`（非默认 `~/.ssh/id_ed25519`），`git push` 报 `Permission denied (publickey)`。

**解决方案**：
```powershell
$env:GIT_SSH_COMMAND = 'ssh -i "完整密钥路径" -o IdentitiesOnly=yes -o StrictHostKeyChecking=no'
git push origin master --force
```

**关键参数**：
- `-i "路径"`：指定密钥文件
- `-o IdentitiesOnly=yes`：强制只用 -i 指定的密钥，不尝试 ssh-agent 中的其他密钥（避免 "Too many authentication failures"）
- `-o StrictHostKeyChecking=no`：自动接受 GitHub host key（CI 友好）

**持久化方案**：在 `~/.ssh/config` 写 `Host github.com\n  IdentityFile 路径\n  IdentitiesOnly yes`，但项目级密钥建议用环境变量，避免污染全局配置。

### Suggested Action
非默认路径 SSH 密钥用 `GIT_SSH_COMMAND` 环境变量临时指定；CI 环境用 `~/.ssh/config` 持久化；密钥文件不要 commit（加入 .gitignore）。

### Metadata
- Source: loop-engineering-v2/ssh-push
- Related Files: .ssh/, .gitignore
- Tags: git, ssh, github, authentication, key-management

---

## [LRN-20260725-006] correction

**Logged**: 2026-07-25T11:15:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend
**Project**: zhixing-reader

### Summary
交付审查时发现 Stats.tsx 的年度书单过滤了 2026 年及以后出版的书籍，导致 2026 年真实已读书籍不显示。

### Details
代码位于 `src/renderer/src/pages/Stats.tsx:652-656`：
```typescript
// 过滤 2026 年及以后出版的书籍（避免未出版/测试数据干扰年度统计）
if (b.publishDate) {
  const publishYear = new Date(b.publishDate).getFullYear()
  if (!isNaN(publishYear) && publishYear >= 2026) return false
}
```
当前年份为 2026，该过滤会把所有 2026 年出版的真实书籍排除在年度书单之外。根因是开发者把"未出版/测试数据"与"当年真实数据"混为一谈。

**修复**：删除该过滤条件，仅保留"已完成 + updatedAt 在当年"的判定。

### Suggested Action
按出版年份过滤"未来/测试数据"时，应使用绝对未来年份（如 > 当前年份 + 1），且必须确认不影响真实当年数据。

### Metadata
- Source: deliverable-readiness-review
- Related Files: src/renderer/src/pages/Stats.tsx
- Tags: stats, filter, bug, delivery-review

---

## [LRN-20260721-001] best_practice

**Logged**: 2026-07-21T13:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tooling
**Project**: zhixing-reader

### Summary
commit-organizer 拆 commit 时，跨 commit 的文件（如 chatStore.ts 同时被 commit 6 和 commit 7 改）必须用 `git add -p` 分块暂存

### Details
v2 T1 把 working tree 中混在一起的 Nightly Loop Wave A-E + UI 改造拆成 8 个语义独立的 commit。`chatStore.ts` 同时承载：
- commit 6 (`fdc56df` feat(chat))：流式契约对齐 + Promise settle + 真 abort
- commit 7 (`48a0804` feat(ui))：Google Design Library UI 改造

直接 `git add chatStore.ts` 会把两个 commit 的改动混在一起。必须用 `git add -p chatStore.ts` 按 hunk 交互选择，把 abort 相关 hunk 放 commit 6，把 UI className hunk 放 commit 7。

**经验**：拆 commit 前先跑 `git diff` 全览，列出每个文件归属哪个 commit，再用 `git add -p` 精准暂存。对超长文件（如 Review.tsx 同时被 commit 3 的 HashRouter 影响和 commit 7 UI 改造影响），必要时用 `git add -e` 手动编辑 hunk。

### Suggested Action
跨 commit 文件用 `git add -p` 按 hunk 拆；拆前先列文件→commit 映射表；超长 diff 用 `git add -e` 手动编辑。

### Metadata
- Source: v2 T1 commit-organizer
- Related Files: src/renderer/src/stores/chatStore.ts, src/renderer/src/pages/Review.tsx
- Tags: git, commit-organizer, git-add-p, hunk-staging

---

## [LRN-20260721-002] correction

**Logged**: 2026-07-21T13:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tooling
**Project**: zhixing-reader

### Summary
CRLF 行尾导致 `git diff --cached` 显示整文件差异，拆 commit 时无法精准选 hunk

### Details
v2 T1 拆 commit 时，某些文件（如 settings/*.tsx）在 `git diff --cached` 中显示整文件被删除+重写，而不是按行 diff。原因是文件在 working tree 中是 LF，但 git autocrlf=settings 把它们转成了 CRLF，导致每行行尾变化。

**症状**：
```
- 旧内容\r
+ 旧内容
```
看起来每行都变了，`git add -p` 无法按 hunk 拆分。

**修复**：
1. 临时禁用 autocrlf：`git config core.autocrlf false`
2. 用 `git add --renormalize .` 统一行尾
3. 或者把文件保存回 LF 再 add

**预防**：项目根加 `.gitattributes` 文件指定 `* text=auto eol=lf`，避免 Windows/Linux 混用导致行尾漂移。

### Suggested Action
拆 commit 前先跑 `git diff --cached --stat` 确认没有整文件重写；遇到整文件 diff 先查 `git config core.autocrlf` 和 `.gitattributes`。

### Metadata
- Source: v2 T1 commit-organizer
- Related Files: .gitattributes（建议新增）, src/renderer/src/pages/settings/*.tsx
- Tags: git, crlf, autocrlf, line-ending, diff

---

## [LRN-20260721-003] correction

**Logged**: 2026-07-21T13:10:00+08:00
**Priority**: high
**Status**: resolved
**Area**: build
**Project**: zhixing-reader

### Summary
app.asar 进程占用导致 electron-builder 失败；绕过方案：关掉所有知行读书进程 + 删 app.asar 锁文件 + 用 builder-output-override.json 拆配置

### Details
v2 T2 重打 installer 时，`npm run package:win` 报错：
```
EPERM: operation not permitted, unlink '...app.asar'
```

原因：之前运行的 `知行读书.exe`（dev 或 preview）没完全退出，仍持有 `app.asar` 文件锁。

**绕过方案**：
1. 任务管理器结束所有 `知行读书.exe` / `electron.exe` 进程
2. 删除 `dist/` 和 `installer-v2/` 重新构建
3. 把 electron-builder 配置拆到 `builder-output-override.json`，避免 `package.json` 频繁改动触发缓存失效
4. 用 `--config builder-output-override.json` 指定独立输出目录 `installer-v2/`，与 v1 的 `installer/` 隔离

**根治方案**（v1.0.2 待办）：合并 `builder-output-override.json` 回 `package.json` 的 `build` 字段，并在 build 前加 `prebuild` 脚本 kill 残留进程。

### Suggested Action
electron-builder 报 EPERM 时先查进程占用；配置拆分只作临时绕过，长期要回归单 package.json。

### Metadata
- Source: v2 T2 installer rebuild
- Related Files: builder-output-override.json, package.json
- Tags: electron-builder, app.asar, eperm, file-lock, process-occupation

---

## [LRN-20260721-004] correction

**Logged**: 2026-07-21T13:15:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tooling
**Project**: zhixing-reader

### Summary
PowerShell here-string 中文 commit message 乱码 → 改英文 subject + 中文 body 仍乱码 → 全英文 commit message

### Details
v2 T1 拆 commit 时尝试用 PowerShell here-string 写中文 commit message：
```powershell
git commit -m "$(cat <<'EOF'
feat(chat): 对齐流式契约
- settle Promise
- 真 abort
EOF
)"
```

PowerShell 报 "Missing file specification after redirection operator"（与 LRN-20260720 旧经验一致），改用 `git commit -F msg.txt` 后中文 subject 在 `git log --oneline` 中显示为乱码（`绗?2 鎵?` 之类）。

**根因**：PowerShell 默认编码（GBK）与 git 的 UTF-8 解码不匹配；即使 `Set-Content -Encoding UTF8` 写文件，BOM 也会污染 commit message。

**最终方案**：commit message 全用英文 subject + 英文 body，符合 Conventional Commits 规范且无编码问题。中文细节放到 PR description 或 commit notes 里。

**反例**：commit `8441870` 的 message 在 git log 中显示为 `test: smoke test 绗?2 鎵? - agent / ai-service / dictionary 妯″潡 (+54 tests)`（"第 2 批 - agent / ai-service / dictionary 模块" 的乱码）。

### Suggested Action
Windows PowerShell 环境下 commit message 全用英文；必须用中文时用 `chcp 65001` 切 UTF-8 + `git commit -F` 配 UTF-8 无 BOM 文件。

### Metadata
- Source: v2 T1 commit-organizer
- Related Files: N/A
- Tags: powershell, encoding, utf8, gbk, commit-message, conventional-commits

---

## [LRN-20260721-005] knowledge_gap

**Logged**: 2026-07-21T13:20:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: config
**Project**: zhixing-reader

### Summary
dev server 端口 5176 被 Hyper-V 保留（5175-5274 范围），启动报 EADDRINUSE 但 `netstat -ano | findstr 5176` 无结果

### Details
v2 T3 dogfood 时重启 dev server 偶发报：
```
Error: listen EADDRINUSE: address already in use 0.0.0.0:5176
```

但 `netstat -ano | findstr :5176` 返回空，`Get-Process` 也找不到占用进程。

**根因**：Windows Hyper-V / WSL2 会预留端口段给虚拟网卡：
```powershell
netsh interface ipv4 show excludedportrange protocol=tcp
# 显示 5175-5274 被 Hyper-V 预留
```

5176 正好在预留范围内，所以即使没有进程监听，Windows TCP/IP 栈也拒绝 bind。

**绕过方案**：
1. 改 dev server 端口（如 5180）—— 但 AGENTS.md 警告"port 5176 在 electron.vite.config.ts 和 electron/main.ts 都硬编码，改一处会断"
2. 重启 Hyper-V 服务释放预留（`Restart-Service -Name "hns" -Force`，需管理员）
3. 用 `netsh int ipv4 add excludedportrange protocol=tcp startport=5175 numberofports=1` 显式排除冲突段（需管理员）

**长期方案**：v1.0.2 把端口常量化到 `.env` 或 `electron.vite.config.ts` 顶部，便于一键切换。

### Suggested Action
Windows 上 dev server 报 EADDRINUSE 但 netstat 找不到进程时，先跑 `netsh interface ipv4 show excludedportrange protocol=tcp` 查 Hyper-V 预留段。

### Metadata
- Source: v2 T3 dogfood
- Related Files: electron.vite.config.ts, electron/main.ts
- Tags: windows, hyper-v, port-reservation, eaddrinuse, dev-server, wsl2

---

## [LRN-20260720-011] correction

**Logged**: 2026-07-20T22:25:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
AI 对话 / 统计 / 导入建卡等多处「功能看起来有、运行时断」来自契约漂移，不是算法本身坏了。

### Details
1. **chatStore** 用 `conversationId/question/context`，preload/ipc 要 `sessionId/userMessage/conversationHistory` → 主功能空转。
2. 流式 `onStreamError` 不 settle Promise → 发送流程挂死。
3. `highlight.create` 单条路径不建 FSRS 卡，只有 batch 建 → 导入后复习空。
4. Home/Bookshelf 用 `getDue()` 当「总卡片」；Profile 读不存在的 `totalCards/masteredCards` 与 camelCase daily_stats。
5. 生产 `file://` + BrowserRouter 风险；Review 写死间隔 + 把 rating 当 mastery。

### Suggested Action
- 改 API 时同步：ipc-channels / preload / renderer.d.ts / store 调用四处。
- 统计字段以 `database.ts` 返回值为 SSOT，前端不要猜字段名。
- 导入路径与 batch 路径行为对齐（建卡、daily_stats）。

### Metadata
- Source: conversation
- Related Files: chatStore.ts, preload.ts, ipc.ts, Home.tsx, profileStore.ts, Review.tsx
- Tags: ipc, contract, fsrs, stats
> **历史归档**：2026-05-29 ~ 2026-06-14 共 7 条原始教训（LRN-20260529-001 ~ LRN-20260614-004）
> **归档策略**：同类型问题出现 ≥3 次时升级到 `.learnings/STANDARDS.md` 硬规则

---

## [LRN-20260529-001] best_practice

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: config

### Summary
Electron 应用中 IPC 响应格式处理的最佳实践

### Details
在 Electron + electron-vite 项目中，preload.ts 的 `invoke` 函数已经自动解包了 IPC 响应：
- 主进程返回：`{ success: true, data: result }`
- preload 的 invoke 返回：`response.data`（已解包）
- 渲染进程直接使用返回值，无需再次解构

错误做法：`const response = await window.electronAPI.settings.getAll() as { success, data }`
正确做法：`const settings = await window.electronAPI.settings.getAll() as Record<string, unknown>`

### Suggested Action
在所有使用 `window.electronAPI.*` 的地方，直接使用返回值，不要当作 `{ success, data }` 格式处理。

### Metadata
- Source: conversation
- Related Files: src/renderer/src/stores/settingsStore.ts, electron/preload.ts
- Tags: electron, ipc, preload

---

## [LRN-20260529-002] knowledge_gap

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: config

### Summary
微信读书 Agent API Gateway 的正确端点和响应格式

### Details
微信读书 API 使用 Agent API Gateway 模式：
- 端点：`https://i.weread.qq.com/api/agent/gateway`
- 认证：`Authorization: Bearer {API_KEY}`
- 请求格式：`{ api_name: "/shelf/sync", skill_version: "1.0.5" }`

关键发现：
1. `/shelf/sync` 是正确的书架端点（不是 `/shelf/list`）
2. 响应可能不包含 `errcode` 字段，需要检查 `data.errcode !== undefined`
3. Python 参考实现只检查 HTTP 状态码，不检查 errcode

### Suggested Action
使用 Python 参考实现 (weread_client.py) 的端点和参数格式。

### Metadata
- Source: conversation
- Related Files: electron/weread-api.ts, src/weread_client.py
- Tags: weread, api, gateway

---

## [LRN-20260529-003] correction

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: config

### Summary
HTTP 499 错误的根本原因和解决方案

### Details
HTTP 499 是 Nginx 的"客户端断连"状态码，原因：
1. 请求超时（net.fetch 没有设置超时）
2. API 端点不正确导致服务器无响应

解决方案：
- 添加 `fetchWithTimeout` 函数，使用 AbortController 设置 30 秒超时
- 使用正确的 API 端点（参考 Python 实现）
- 添加 499 特定错误提示

### Suggested Action
所有外部 API 调用都应添加超时控制。

### Metadata
- Source: conversation
- Related Files: electron/weread-api.ts, electron/ai-service.ts
- Tags: http, timeout, error-handling

---

## [LRN-20260529-004] best_practice

**Logged**: 2026-05-29T16:05:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: config

### Summary
应用启动时的配置初始化流程

### Details
正确的配置初始化流程：
1. main.ts 启动时从 settings.json 加载配置
2. 调用 `initFromSettings()` 初始化 weread-api 和 ai-service 的内存变量
3. 渲染进程通过 IPC 加载配置到 Zustand store
4. 保存时同步更新文件和内存变量

### Suggested Action
遵循"启动时加载 → 内存缓存 → 修改时同步"的模式。

### Metadata
- Source: conversation
- Related Files: electron/main.ts, electron/weread-api.ts, electron/ai-service.ts
- Tags: initialization, settings, persistence

---

## [LRN-20260601-001] best_practice

**Logged**: 2026-06-01T22:20:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: backend

### Summary
创建统一的设置服务模块，实现单例模式和安全存储

### Details
为 Electron 主进程创建了 SettingsService 类，实现了单例模式、get/set/getAll 方法，并使用 safeStorage API 实现敏感信息加密存储。该模块提供了 getSecureKey() 和 setSecureKey() 方法，用于安全地存储 API 密钥等敏感信息。

### Suggested Action
在需要存储设置或敏感信息的场景中，使用此服务模块。

### Metadata
- Source: conversation
- Related Files: electron/services/settings-service.ts
- Tags: settings, singleton, encryption, safeStorage

---

## [LRN-20260614-001] best_practice

**Logged**: 2026-06-14T20:30:00+08:00
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
RSS 抓取文章必须持久化到数据库，不能仅返回内存数据

### Details
在 ipc.ts 的 ARTICLES.FETCH_RSS handler 中，最初只返回 fetchAllRssSources() 的结果，但没有将文章存入数据库。这导致：
1. 刷新页面后文章丢失
2. 无法进行文章筛选/分类
3. 翻译结果无处保存

正确做法：
1. 遍历抓取的文章，检查数据库是否已存在（标题去重）
2. 调用 articlesDb.create() 存入数据库
3. 异步触发翻译（不阻塞返回）
4. 翻译完成后更新数据库记录

### Suggested Action
所有数据获取操作都应考虑持久化需求，避免"只取不存"的反模式。

### Metadata
- Source: conversation
- Related Files: electron/ipc.ts, electron/database.ts
- Tags: rss, database, persistence

---

## [LRN-20260614-002] correction

**Logged**: 2026-06-14T20:30:00+08:00
**Priority**: high
**Status**: resolved
**Area**: frontend

### Summary
再次确认 preload.ts 的 invoke() 已解包 IPC 响应，前端不应再次解包

### Details
在 DailyLearning.tsx 中发现多余的 unwrapData() 函数：
```typescript
// 错误做法
const unwrapData = (res: unknown) => (res as { success: boolean; data: unknown })?.data ?? res;
const articles = unwrapData(result);
```

这导致拿到 undefined，因为 preload 的 invoke() 已经返回了 response.data。

正确做法：
```typescript
const result = await window.electronAPI.articles.fetchRss();
const articles = Array.isArray(result) ? result : [];
```

### Suggested Action
在所有使用 window.electronAPI.* 的地方，直接使用返回值，用 Array.isArray() 或可选链做防御性编程。

### Metadata
- Source: conversation
- Related Files: src/renderer/src/pages/DailyLearning.tsx, electron/preload.ts
- Tags: electron, ipc, preload, unwrap

---

## [LRN-20260614-003] knowledge_gap

**Logged**: 2026-06-14T20:30:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: backend

### Summary
database.ts 中使用 require() 动态导入在 ESM 环境中会失败

### Details
在 electron/database.ts 中发现：
```typescript
const { Card, cardFromDb, cardToRow, createCard, reviewCard, reviewVocabulary, Rating, CardState } = require('./fsrs-engine');
```

这在 ESM 构建环境中会报错 "require() of ES Module"。

正确做法：使用静态 import 语句
```typescript
import { Card, cardFromDb, cardToRow, createCard, reviewCard, reviewVocabulary, Rating, CardState } from './fsrs-engine';
```

### Suggested Action
在 TypeScript 项目中，优先使用 import/export 而非 require()，特别是在 electron-vite 构建环境中。

### Metadata
- Source: conversation
- Related Files: electron/database.ts, electron/fsrs-engine.ts
- Tags: esm, require, import, module

---

## [LRN-20260614-004] best_practice

**Logged**: 2026-06-14T20:30:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: backend

### Summary
IPC handler 中使用数据库操作前必须导入 getDatabase

### Details
在 ipc.ts 中添加了 RSS 文章持久化逻辑后，调用 getDatabase() 时报错 "getDatabase is not defined"。

原因：虽然 database.ts 导出了 getDatabase，但 ipc.ts 没有导入。

修复：
```typescript
import { getDatabase, forceSaveDatabase } from './database';
```

### Suggested Action
在 IPC handler 中操作数据库时，确保导入必要的数据库工具函数。

### Metadata
- Source: conversation
- Related Files: electron/ipc.ts, electron/database.ts
- Tags: database, import, ipc

---

## [LRN-20260720-001] best_practice

**Logged**: 2026-07-20T18:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tooling

### Summary
ai-dev-workflow 6 阶段规范化已嵌入项目，新功能开发必须按此流程

### Details
2026-07-20 完成 ai-dev-workflow skill 在本项目的落地，确立 6 阶段流程：

1. **需求澄清**：输出 `docs/plans/YYYY-MM-DD-{feature}.md`，含功能/非功能/验收
2. **架构设计**：ADR + 目录树 + API Spec + DB Schema
3. **项目脚手架**：完整骨架 + AGENTS.md + CLAUDE.md
4. **编码实现**：代码 + 单测
5. **质量门禁**：lint + typecheck + test + build + audit 全绿
6. **知识沉淀**：更新 `.learnings/STANDARDS.md` 和 `.learnings/*.md`

每阶段有闸门（不做不前进）。已有项目从阶段三（结构检查）+ 阶段五（门禁检查）切入。

### Suggested Action
后续新功能开发（包括 bug 修复）必须按 6 阶段走；小修改可以简化为"阶段四+五"。

### Metadata
- Source: ai-dev-workflow skill
- Related Files: .learnings/STANDARDS.md, AGENTS.md, .claude/ownership.yaml
- Tags: workflow, ai-dev-workflow, standardization

---

## [LRN-20260720-002] best_practice

**Logged**: 2026-07-20T18:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tooling

### Summary
ESLint 规则分级策略：硬约束 vs 软约束

### Details
对 15 条硬性规则中的质量规则（R6-R10）采用分级策略：

**Error（硬约束，违反即阻塞）**：
- `complexity` ≤ 15（圈复杂度）
- `max-params` ≤ 6（函数参数）
- `prefer-const`
- `eqeqeq`（必须 `===`）

**Warn（软约束，长期优化）**：
- `max-lines` ≤ 500（单文件行数）
- `max-lines-per-function` ≤ 80（单函数行数）
- `max-depth` ≤ 4（嵌套深度）

**Grandfather（针对 legacy 文件豁免）**：
- `database.ts` 1967 行
- `ipc.ts` 657 行
- `weread-api.ts`
- `rag-service.ts`

只对 legacy 文件关闭 `complexity`（避免一刀切），其他规则继续生效。

### Suggested Action
新代码必须满足所有 error 规则；warn 规则可暂时不满足但要在 TODO 注释中标记。Legacy 文件不重新设计，比赛后拆分。

### Metadata
- Source: ai-dev-workflow 第 4-5 阶段
- Related Files: eslint.config.js
- Tags: eslint, quality-rules, grandfather

---

## [LRN-20260720-003] knowledge_gap

**Logged**: 2026-07-20T18:10:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tooling

### Summary
fix-unused-vars.mjs 自动化脚本的限制：不能处理解构类型定义

### Details
编写了 `scripts/fix-unused-vars.mjs` 自动修复 ESLint `no-unused-vars` 错误，方法是用 ESLint AST 把未使用变量加 `_` 前缀。

**问题**：对解构类型定义会破坏语法：
```typescript
// 原始
function Foo({ x, y }: { x: string; y: string }) {}

// 错误转换
function Foo({ x as _x, y }: { x: string; y: string }) {}  // 语法错误！
```

脚本无法识别 `{ x, y }: { x: string; y: string }` 中的 `x, y` 是类型字段名而不是变量名。

**已修复 27/33**，剩余 6 个解构类型需要手动用 `x: _x` 重命名。

### Suggested Action
不要尝试自动处理解构类型。脚本遇到解构类型应直接跳过并报告，由人工处理。

### Metadata
- Source: ai-dev-workflow 第 4 阶段
- Related Files: scripts/fix-unused-vars.mjs
- Tags: eslint, automation, ast, limitation

---

## [LRN-20260720-004] best_practice

**Logged**: 2026-07-20T18:15:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tooling

### Summary
Vitest 测试文件 import 路径：tests/ 引用 electron/ 用相对路径 `../`

### Details
测试文件位于 `tests/` 目录（如 `tests/fsrs-engine.test.ts`），引用 `electron/` 下的源文件时：

**错误**：
```typescript
import { createCard } from '../../electron/fsrs-engine'  // ❌ 解析失败
```

**正确**：
```typescript
import { createCard } from '../electron/fsrs-engine'  // ✅ Vite 正确解析
```

Vite 解析 import 路径时，相对路径基于当前测试文件位置向上找到 `electron/`，正确层级是 `../`（不是 `../../`）。

### Suggested Action
统一规范：`tests/*.test.ts` → `electron/*.ts` 用 `'../electron/xxx'`；`tests/integration/*.test.ts` → `electron/*.ts` 用 `'../../electron/xxx'`。

### Metadata
- Source: ai-dev-workflow 第 3 阶段
- Related Files: tests/fsrs-engine.test.ts
- Tags: vitest, import-path, vite, relative-path

---

## [LRN-20260720-005] correction

**Logged**: 2026-07-20T18:20:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tooling

### Summary
Edit 工具的怪癖：old_string 末尾字符 + new_string 末尾字符相同时可能产生重复字符

### Details
在使用 IDE/Agent 的 Edit 工具修改文件时，如果：
- `old_string` 末尾字符 = `(`、`{`、`[` 等
- `new_string` 末尾字符 = 相同字符

工具的字符串匹配可能产生重复字符：

```typescript
// 期望
function foo() {}

// 实际
function foo() {{}  // 多了一个 {
```

**修复策略**：
1. 修改后立即用 Read 工具验证
2. 把替换范围扩大到 1-2 行上下文
3. 确保 `old_string` 在文件中唯一
4. 确保 `old_string` 与 `new_string` 不重叠

### Suggested Action
每次 Edit 操作后必须 Read 验证；不要相信"已替换成功"。

### Metadata
- Source: ai-dev-workflow 第 4 阶段
- Related Files: N/A
- Tags: edit-tool, string-replace, verification

---

## [LRN-20260720-006] knowledge_gap

**Logged**: 2026-07-20T18:25:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tooling

### Summary
@typescript-eslint/no-unnecessary-condition 规则需要 type-aware linting

### Details
启用 `@typescript-eslint/no-unnecessary-condition` 这类需要类型信息的规则时，ESLint 抛：

```
The rule "@typescript-eslint/no-unnecessary-condition" requires type information.
```

**原因**：规则需要 TypeScript 类型推断，必须启用 type-aware linting。

**修复**：在 `eslint.config.js` 添加：
```javascript
parserOptions: {
  project: './tsconfig.json',
  tsconfigRootDir: import.meta.dirname,
}
```

**权衡**：启用 type-aware linting 会让 lint 速度慢 5-10 倍（需运行 TS 编译器）。

**当前决策**：默认**不启用**这条规则以保持 lint 速度。如果后续需要严格度可考虑加 `@typescript-eslint/strict` 预设。

### Suggested Action
需要 type-aware 规则时评估性能成本；本项目暂时不启用以保证开发体验。

### Metadata
- Source: ai-dev-workflow 第 4 阶段
- Related Files: eslint.config.js
- Tags: eslint, typescript, type-aware, performance

---

## [LRN-20260720-007] correction

**Logged**: 2026-07-20T18:30:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: tooling

### Summary
PowerShell 管道中 ESLint 退出码 2 不一定是错误

### Details
在 PowerShell 中跑：
```powershell
npx eslint src electron | Tee-Object | Select-Object
```

PowerShell 把 ESLint 的 stderr warning（输出到 stderr 的 lint 警告）通过管道传递给 `Select-Object` 时，会把退出码 2 当作"命令失败"。

**正确做法**：直接跑 ESLint 看真实退出码：
```powershell
npx eslint src electron; "EXIT:$LASTEXITCODE"
```

如果只是看 warning（不阻塞 commit），用 `|| true` 在 bash 没问题，但 PowerShell 必须用 `; "EXIT:$LASTEXITCODE"` 显式查看。

### Suggested Action
PowerShell 中评估命令是否成功，看 `$LASTEXITCODE` 而不是依赖管道行为。

### Metadata
- Source: ai-dev-workflow 第 5 阶段
- Related Files: scripts/fix-unused-vars.mjs
- Tags: powershell, eslint, exit-code, pipe

---

## [LRN-20260720-008] best_practice

**Logged**: 2026-07-20T18:35:00+08:00
**Priority**: low
**Status**: resolved
**Area**: tooling

### Summary
CodeGraph 知识图谱 auto-sync：文件改动 2s 防抖后增量更新

### Details
为项目建了 CodeGraph 知识图谱（100 文件 / 1,451 节点 / 4,645 边，建图 1.3s）。

**配置**：
- 默认 auto-sync 开启
- 文件改动 2s 防抖后触发增量更新
- `.codegraph/` 已加入 `.gitignore`（不提交生成的索引）

**使用**：
- `codegraph_search` / `codegraph_context` / `codegraph_trace` / `codegraph_callers` / `codegraph_callees` / `codegraph_impact` / `codegraph_node` / `codegraph_explore` / `codegraph_files` / `codegraph_status`
- SubAgent 启动时首选 `codegraph_context` 构建入口点+相关符号上下文

**好处**：
- 新增/修改文件后无需手动跑 sync
- 索引始终保持新鲜
- SubAgent 启动时能快速拿到代码上下文

### Suggested Action
日常开发无需再跑 sync；需要快速探索代码结构时直接用 CodeGraph 工具。

### Metadata
- Source: ai-dev-workflow 第 1 阶段（需求调研）
- Related Files: .codegraph/
- Tags: codegraph, knowledge-graph, auto-sync, subagent

---

## [LRN-20260720-009] correction

**Logged**: 2026-07-20T22:10:00+08:00
**Priority**: high
**Status**: resolved
**Area**: backend
**Project**: zhixing-reader

### Summary
ts-fsrs 没有 Mastered 状态，STATE_DISTRIBUTION 数组的 state=4 会被 ts-fsrs 真实算法覆盖

### Details
`scripts/seed-demo-data.ts` 中演示数据生成脚本设计了 `STATE_DISTRIBUTION` 数组，希望把 45 张卡片设置为 Mastered（state=4）。但调用 `simulateMatureCard()` 模拟 6 次连续 Good 后，`card.state` 仍返回 `FsrsState.Review=2`（ts-fsrs 库没有 Mastered 状态，最稳定的卡也是 Review=2）。

**症状**：
```sql
SELECT state, COUNT(*) FROM cards GROUP BY state;
-- state=0: 3 (New)
-- state=1: 5 (Learning)
-- state=2: 57 (Review)  ← 应该是 12，剩下 45 张是 Mastered
-- state=3: 3 (Relearning)
-- state=4: 0 (Mastered)  ← 实际为 0
```

**修复**：
```typescript
// scripts/seed-demo-data.ts insertHighlight() 末尾
const row = fsrsCardToRow(fsrsCard, h.id, cardId, DEMO_TODAY_ISO);
const finalState = targetState; // 覆盖 row.state，使用 STATE_DISTRIBUTION
db.run(`INSERT OR REPLACE INTO cards (id, ..., state, ...) VALUES (?, ..., ?, ...)`,
       [..., finalState, ...]);  // ← 用 finalState 而非 row.state
```

**附加优化**：Mastered 卡附 `stability≥90, difficulty≤4.5, scheduled_days≥30` 三参数微调，让 FSRS UI 显示更真实。

### Suggested Action
**当 ts-fsrs 缺少业务层状态时，必须在 `fsrsCardToRow` 之后强制覆盖 state 字段写入 DB**。不要相信 ts-fsrs 默认返回的状态符合业务需求。

### Metadata
- Source: demo.db 验证
- Related Files: zhixing-reader/scripts/seed-demo-data.ts (行 960-983)
- Tags: ts-fsrs, fsrs-engine, state-override, demo-data, idempotent-seed

---

## [LRN-20260720-010] best_practice

**Logged**: 2026-07-20T22:20:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: backend
**Project**: zhixing-reader

### Summary
PowerShell 环境调 Node 参数：用 mjs 脚本避免命令行转义问题

### Details
调试 `seed-demo-data.ts` Token 参数时，需要快速查询数据库验证。直接用 `node -e "..."` 内嵌代码在 PowerShell 中常遇到：
- 反引号（`）转义错误
- 中文 Unicode 字符处理异常
- 多行字符串语法错

**正确做法**：用 `node scripts/analyze-states.mjs` 独立脚本：
```javascript
// scripts/analyze-states.mjs
import initSqlJs from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const wasmDir = path.join(__dirname, '..', 'node_modules', 'sql.js', 'dist');
const SQL = await initSqlJs({ locateFile: (f) => path.join(wasmDir, f) });
const db = new SQL.Database(new Uint8Array(fs.readFileSync('resources/demo.db')));
// ... SQL 查询
```

**好处**：
- 用 `await initSqlJs(...)` top-level await，避免回调地狱
- 中文模板字符串可正常输出
- 可重复运行、版本控制
- 与 verify-demo-data.mjs 风格一致

### Suggested Action
调试 sql.js / 数据库 / AI 集成时，**优先写独立 .mjs 脚本**，避免 PowerShell 命令行内嵌代码的转义陷阱。

### Metadata
- Source: demo.db 验证
- Related Files: zhixing-reader/scripts/analyze-states.mjs, verify-demo-data.mjs
- Tags: powershell, mjs-script, sql.js, top-level-await, debugging-tool

---

## [LRN-20260721-006] best_practice

**Logged**: 2026-07-21T19:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: backend
**Project**: zhixing-reader

### Summary
给已有 SQLite 表加列时，用 `PRAGMA table_info` 检查 + `ALTER TABLE ADD COLUMN` 幂等迁移，配合 schema `DEFAULT` 兜底旧数据

### Details
死代码治理 Task 1 需要给 books 表加 `source` 字段区分微信读书书/本地书。直接改 CREATE TABLE 只对新建数据库有效，老用户的 zhixing.db 已存在 books 表不会重建。

**幂等迁移模式**：
```typescript
function migrateBooksTable(): void {
  try {
    const database = getDatabase();
    const cols = database.exec("PRAGMA table_info(books)");
    const colNames = rowsToObjects(cols).map(c => c.name as string);
    if (!colNames.includes('source')) {
      database.run("ALTER TABLE books ADD COLUMN source TEXT DEFAULT 'weread'");
      logger.info('Migration: added source column to books table');
    }
  } catch (error) {
    logger.error('Migration failed for books table', { error: String(error) });
  }
}
```

**关键点**：
1. `PRAGMA table_info` 先检查列是否存在，避免重复 ALTER 报错
2. schema 中 `source TEXT DEFAULT 'weread'` 保证旧数据自动归为 weread 来源（向后兼容）
3. 迁移函数在 `initDatabase()` 末尾调用，每次启动都跑（幂等）
4. try/catch 包裹避免迁移失败导致整个 DB 初始化失败

**业务层使用**：
```typescript
// BookDetail.tsx openInWeRead
if (book?.source && book.source !== 'weread') {
  toast.warning('本书非微信读书来源，无法在微信读书打开')
  return
}
```
旧数据 source 为 null/undefined 时按 weread 处理（`book?.source` 短路）。

### Suggested Action
所有 schema 变更走"CREATE TABLE IF NOT EXISTS + migrateXxxTable 幂等函数"双轨模式；新列必须带 DEFAULT；业务层用 `?.` 短路兼容旧数据。

### Metadata
- Source: dead-code-governance Task 1
- Related Files: electron/database.ts (migrateBooksTable L450-463), src/renderer/src/pages/BookDetail.tsx (openInWeRead L216-233)
- Tags: sqlite, migration, pragma, alter-table, idempotent, backward-compat

---

## [LRN-20260721-007] security

**Logged**: 2026-07-21T19:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: security
**Project**: zhixing-reader

### Summary
CSV 导出必须防御公式注入：以 `=` `+` `-` `@` 开头的值前置单引号（OWASP CSV Injection）

### Details
死代码治理 Task 3 实现 TokenUsage CSV 导出时，初版 `escapeCsv` 只处理 `,` `"` `\n` `\r`，未防御公式注入。攻击者若在 token_usage 表的 provider/model/feature 字段插入 `=CMD()` 或 `+HYPERLINK()`，导出的 CSV 在 Excel 中打开会执行公式，可能导致 RCE 或数据泄露。

**OWASP CSV Injection 防御**：
```typescript
function escapeCsv(value: unknown): string {
  let s = String(value ?? '')
  // 防御 CSV 公式注入：以 = + - @ 开头的值前置单引号
  if (/^[=+\-@]/.test(s)) {
    s = "'" + s
  }
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}
```

**关键点**：
1. `let s` 而非 `const s`（需要重新赋值）
2. 先检测危险前缀再处理引号转义（顺序不能反）
3. UTF-8 BOM `'\ufeff'` 前缀保证 Excel 中文不乱码
4. 同模式适用于所有 CSV 导出（TokenUsage / Stats / 任何用户数据导出）

**检测工具**：verifier subagent 7 维 code review 的"安全性"维度会主动检查这个。

### Suggested Action
所有 CSV 导出函数必须：1) 检测 `= + - @` 前缀并前置单引号；2) 字段含 `, " \n \r` 用双引号包裹并转义内部 `"`；3) 文件头加 UTF-8 BOM。

### Metadata
- Source: dead-code-governance Task 3 + verifier P1
- Related Files: src/renderer/src/pages/TokenUsage.tsx (escapeCsv L133-145)
- Tags: csv-injection, owasp, security, export, formula-injection

---

## [LRN-20260721-008] best_practice

**Logged**: 2026-07-21T19:10:00+08:00
**Priority**: high
**Status**: resolved
**Area**: backend
**Project**: zhixing-reader

### Summary
批量 DELETE 必须用 runTransaction 包裹，避免中途失败导致数据不一致

### Details
死代码治理 Task 4 实现"清理对话历史"和"重置数据库"时，初版直接连续调用 `database.run('DELETE FROM xxx')`，未用事务包裹。

**风险**：16 张表 DELETE 中第 7 张失败，前 6 张已删除数据无法回滚，导致数据库处于半清理状态（books 还在但 highlights 没了，FK 约束可能报错）。

**正确做法**：
```typescript
export function clearConversationsAndMessages(): void {
  runTransaction((database) => {
    database.run('DELETE FROM chat_messages')
    database.run('DELETE FROM conversations')
  })
}

export function resetDatabase(): void {
  const tables = [
    'chat_messages', 'conversations', 'reviews', 'cards', 'highlights',
    'book_summaries', 'daily_stats', 'token_usage', 'user_profiles',
    'methodologies', 'knowledge_cards', 'book_architecture', 'articles',
    'vocabulary', 'memories', 'books'
  ]
  runTransaction((db) => {
    for (const table of tables) {
      db.run(`DELETE FROM ${table}`)
    }
  })
}
```

`runTransaction` 内部：BEGIN TRANSACTION + COMMIT + saveDatabase；失败 ROLLBACK。

**关键点**：
1. 批量 DELETE 必须事务包裹（原子性）
2. 不要在事务内调 `forceSaveDatabase()`（事务 COMMIT 后 runTransaction 自动 saveDatabase）
3. 16 张表顺序无关（DELETE 不依赖 FK 约束）
4. 重置后 `app.relaunch() + app.exit(0)` 500ms 延迟确保 db 落盘

### Suggested Action
所有批量写操作（DELETE/UPDATE/INSERT 多条）必须用 `runTransaction(fn)` 包裹；单条写操作可依赖 markDirty 自动延迟保存。

### Metadata
- Source: dead-code-governance Task 4 + verifier P1
- Related Files: electron/database.ts (runTransaction L58-70, clearConversationsAndMessages L478-484, resetDatabase L490-522)
- Tags: sqlite, transaction, atomicity, rollback, batch-delete

---

## [LRN-20260721-009] best_practice

**Logged**: 2026-07-21T19:15:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: backend
**Project**: zhixing-reader

### Summary
微信读书 skill 第三方 API 调用走"gateway 优先 + 衍生降级"模式，避免单点失败

### Details
死代码治理 Task 5 实现"推荐好书"功能时，微信读书 skill 官方文档列了 `/book/recommend` 接口，但实际 gateway 可能未上线/返回空/超时。直接依赖 gateway 会导致 UI 显示"暂无推荐"。

**降级策略**：
```typescript
export async function fetchRecommendations(): Promise<RecommendationItem[]> {
  try {
    const data = await gatewayRequest<{books?: GatewayRecommendBook[]}>(
      { api_name: '/book/recommend', count: 20 }, false
    )
    if (data.books && data.books.length > 0) {
      return data.books.map(b => ({...}))
    }
    return await generateDerivedRecommendations()  // 降级
  } catch (error) {
    logger.warn('Gateway recommend API failed, falling back', {error: String(error)})
    return await generateDerivedRecommendations()  // 降级
  }
}
```

**衍生推荐逻辑**（generateDerivedRecommendations）：
1. 调 `fetchReadingData` 拿用户 preferCategory + preferAuthor
2. 对每个偏好分类调 `searchBooks` 拉同类书
3. 对每个偏好作者调 `searchBooks` 拉同作者书
4. 用 Map 去重（key = bookId）
5. 过滤掉已在书架的书
6. 取 top 20 返回

**关键点**：
1. `useCache: false` 对 gateway 推荐请求（推荐内容应实时）
2. 衍生推荐用 Map 去重避免重复
3. 衍生推荐的 `reason` 字段告知用户"基于你喜欢的《XXX》分类推荐"
4. UI 端 loading/empty/list 三态：gateway 失败 + 衍生也空时显示 empty + 同步按钮

### Suggested Action
所有第三方 API 调用必须有降级策略：1) gateway 优先；2) 衍生数据降级（基于已有数据计算）；3) 空数据兜底 UI（不能白屏）。

### Metadata
- Source: dead-code-governance Task 5
- Related Files: electron/weread-api.ts (fetchRecommendations L695-720, generateDerivedRecommendations L734-823)
- Tags: weread-skill, gateway, fallback, derived-data, recommendation

---

## [LRN-20260721-010] best_practice

**Logged**: 2026-07-21T19:20:00+08:00
**Priority**: high
**Status**: resolved
**Area**: process
**Project**: zhixing-reader

### Summary
死代码治理决策树：砍掉（无 skill 能力支撑）/ 补齐（有 skill 能力但未接）/ 保留（真实功能但 UX 差）

### Details
死代码治理循环工程识别出 19 处问题，按"决策树"分类处理：

```
死代码识别
├── 有微信读书 skill 能力支撑吗？
│   ├── 是 → 补齐真实功能（Task 3/4/5）
│   │       - TokenUsage CSV 导出 + 筛选（本地数据，无 skill 依赖）
│   │       - Stats JSON 报告 + 日期范围（本地数据）
│   │       - SettingsAI 自定义模板 CRUD（本地 settings.json）
│   │       - SettingsData 清理/重置（本地 DB）
│   │       - Bookshelf 推荐好书（weread skill /book/recommend）
│   └── 否 → 砍掉按钮（Task 2）
│           - Bookshelf 本地 EPUB 导入（无 EPUB 解析能力）
│           - Bookshelf 批量管理（无批量操作后端）
│           - BookDetail 编辑信息（无书籍元数据编辑后端）
│           - DailyLearning 编辑计划（无计划编辑后端）
│           - Methodologies 编辑方法论（无方法论编辑后端）
│           - SettingsAbout 5 处链接（无对应页面）
└── 是真实功能但 UX 差？
    └── 保留 + 优化（不在本循环处理）
        - SettingsAbout 用户反馈 toast.info（可改 mailto:）
```

**判定原则**：
1. **能砍则砍**：无后端支撑的占位按钮直接删除，比"disabled + tooltip"更诚实
2. **能补则补**：有 skill 能力但前端没接的，必须补齐真实功能（不能只接一半）
3. **降级要闭环**：gateway 失败时衍生数据降级，UI 不能显示空状态
4. **按钮要真**：每个可点击按钮必须有真实功能（"在微信读书打开"必须打开，"查看详情"必须跳转）

**验证手段**：
- verifier subagent 7 维 code review 主动检查每个按钮的 onClick 是否有真实实现
- spec-reviewer 检查是否有 over-engineer（砍多了）或漏砍（留了死代码）
- 手动走查覆盖 spec Task 6 列出的 6 个场景

### Suggested Action
新增功能前先走决策树：有 skill 能力 → 补齐；无 skill 能力 → 不做（不要先放占位按钮）；已有占位按钮 → 砍掉或补齐二选一。

### Metadata
- Source: dead-code-governance 全循环（Task 1-6）
- Related Files: .trae/specs/dead-code-governance/spec.md, verify-report.md
- Tags: dead-code, decision-tree, governance, button-ux, honesty

---

## [LRN-20260721-011] best_practice

**Logged**: 2026-07-21T23:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: packaging
**Project**: zhixing-reader

### Summary
Vectra 0.15 文档宣称"纯 TS 零依赖"，实际有 13 个直接依赖 + ~50 个传递依赖（含 @grpc/grpc-js / @grpc/proto-loader），Electron 打包白名单必须完整覆盖

### Details
T16 RAG 本地集成用 Vectra 0.15 替换 Qdrant。spec-reviewer 第一轮审查不通过（P0 阻塞）：打包后 asar 中没有 @grpc/grpc-js 等传递依赖，main 进程 `require("vectra")` 抛 `Cannot find module`。

修复：追加 37 个传递依赖到 `package.json` build.files 白名单，asar 实测验证 63/63 包覆盖。

### Suggested Action
任何新增 native 或近 native 依赖，必须 `npm ls --all` 查看完整依赖树，打包白名单不能只看顶层包名。Vectra 0.15 依赖树：`@grpc/grpc-js` / `@grpc/proto-loader` / `cheerio` / `wink-nlp` / `gpt-tokenizer` / `turndown` / `openai` / `protobufjs` / `yargs` / `long` / `lodash.camelcase` / `uuid` 等。

### Metadata
- Source: Phase 5 T16 RAG 本地集成
- Related Files: electron/services/vector-db.ts, package.json build.files
- Tags: vectra, electron-builder, packaging, dependencies

---

## [LRN-20260721-012] best_practice

**Logged**: 2026-07-21T23:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: process
**Project**: zhixing-reader

### Summary
spec 与代码不符时，implementer 应停止并报告，由主 agent 仲裁；不要凭印象强行实施

### Details
T6b 任务描述说"Chat/Stats/TokenUsage 三页面输出格式按钮加 tooltip"，但实际 grep 三个文件都没有"输出格式"按钮，"输出格式"只在 Methodologies.tsx 出现。

implementer 没有强行找最接近的控件加 tooltip（会误导用户），而是停止并报告 spec 与代码不符，提交主 agent 仲裁。主 agent 仲裁后派 fix-implementer 在 Methodologies.tsx 加 tooltip。

### Suggested Action
spec 与代码不符时：1) grep 确认事实；2) 停止实施；3) 报告差异；4) 主 agent 仲裁；5) 派 fix-implementer 按仲裁结果实施。不要凭印象强行实施，会误导用户。

### Metadata
- Source: Phase 5 T6b 输出格式 tooltip
- Related Files: .trae/specs/phase5-optimization/T6b-self-review.md
- Tags: spec, arbitration, honesty

---

## [LRN-20260721-013] best_practice

**Logged**: 2026-07-21T23:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: ui
**Project**: zhixing-reader

### Summary
暗色模式不能只改背景色，必须检查 shadow opacity / 边框对比度 / 文字对比度（WCAG AA 4.5:1）/ 跨主题一致性

### Details
T17 整体视觉优化发现 5 个暗色模式 bug：
1. shadow primitives 全 opacity 0（实际无阴影）
2. 暗色 border == card 颜色（边框不可见）
3. 暗色 primary 跨主题不一致（浅色蓝 #4285f4 vs 暗色粉红 #fc2c50）
4. 暗色 input 纯黑（#000000）
5. Badge 三 variant 对比度不足 WCAG AA（warning 1.6:1 / success 3.1:1 / error 3.4:1）

修复：逐一修复，统一蓝色系 primary，边框比 card 亮 12 单位，shadow opacity 修复，Badge 对比度全部 ≥ 4.5:1。

### Suggested Action
暗色模式 checklist：1) shadow opacity 非 0；2) border 比 card 亮 12+ 单位；3) 文字对比度 ≥ 4.5:1（WCAG AA）；4) primary 跨主题一致；5) input 背景非纯黑（用 #0a0a0b）；6) Badge 文字对比度 ≥ 4.5:1。

### Metadata
- Source: Phase 5 T17 整体视觉优化
- Related Files: src/renderer/src/styles/design-tokens.css, src/renderer/src/components/ui/Badge.tsx
- Tags: dark-mode, wcag, accessibility, contrast

---

## [LRN-20260721-014] best_practice

**Logged**: 2026-07-21T23:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: process
**Project**: zhixing-reader

### Summary
循环工程子 agent 模式可一天跑通 18 任务，关键是主 agent 把握依赖关系，独立任务并行，简单任务合并审查

### Details
Phase 5 优化循环工程 18 个任务在一天内全部跑通，verifier 总分 8.5/10，无 P0 阻塞。

关键实践：
- 独立任务并行派 implementer（T3+T5+T11 / T8+T9+T14 / T17+T6b）
- 简单任务合并双审（T3+T5+T11 一个 spec-reviewer + 一个 code-quality-reviewer）
- P1 修复与下一批次并行（T16 P1 fix + T3/T5/T11 implementer）
- spec 与代码不符时立即仲裁，不浪费 implementer 时间

### Suggested Action
循环工程不是死板的串行。主 agent 职责：1) 识别任务依赖关系；2) 独立任务并行派；3) 简单任务合并双审；4) P1 修复与下一批次并行；5) spec 冲突时立即仲裁。

### Metadata
- Source: Phase 5 优化循环工程全流程
- Related Files: .trae/specs/phase5-optimization/verify-report.md
- Tags: loop-engineering, parallel, subagent, efficiency

---

## [LRN-20260721-015] best_practice

**Logged**: 2026-07-21T23:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: ai
**Project**: zhixing-reader

### Summary
深度思考模式需兼容三种流式格式：DeepSeek R1 reasoning_content + OpenAI reasoning.summary + Anthropic thinking_delta

### Details
T13 AI 对话重构新增深度思考模式。不同 LLM 厂商的思考过程流式格式不同：
- DeepSeek R1：`reasoning_content` 字段
- OpenAI o1/o3：`reasoning.summary` 字段
- Anthropic Claude：`thinking_delta` 事件

ai-service.ts 解析三种格式，通过 `reasoning:chunk` IPC 通道推送到渲染进程，Reasoning.tsx 组件展示为可折叠面板（自动展开 → 1s 后折叠 → 显示耗时）。

### Suggested Action
新增 LLM 功能时，必须考虑多厂商兼容。深度思考模式 checklist：1) DeepSeek reasoning_content；2) OpenAI reasoning.summary；3) Anthropic thinking_delta；4) 统一 IPC 通道转发；5) UI 可折叠面板。

### Metadata
- Source: Phase 5 T13 AI 对话重构
- Related Files: electron/ai-service.ts, src/renderer/src/components/chat/Reasoning.tsx
- Tags: ai, reasoning, deepseek, openai, anthropic, streaming

---

## [LRN-20260722-001] best_practice

**Logged**: 2026-07-22T00:00:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: testing
**Project**: zhixing-reader

### Summary
提升单元测试覆盖率时，优先识别并补充"低成本高收益"分支

### Details
Phase 16 提升 ai-service.ts 测试覆盖率，采用以下识别方法：
1. **看 coverage HTML 报告**：`cbranch-no` / `cline-no` 标记的红色分支
2. **优先补"外部依赖失败"分支**：mock `fetch` reject / HTTP error response
3. **其次补"输入边界"分支**：空数组、null 字段、无效枚举值
4. **最后考虑"时间/缓存"分支**：需要 mock 时间，成本较高

本次补充 12 个边界测试用例，覆盖：
- `testConnection` fetch 抛非 Error 对象（`String(error)` fallback）
- `callAI` provider 空字符串 fallback
- `callAI` 配置缺失时使用默认值
- `testConnection` HTTP 错误响应
- `callAI` 缓存命中
- `extractMethodologies` fetch 失败
- `generateSummary` highlight 无 chapterTitle
- `distillKnowledgeCards` highlight 无 chapterTitle/note
- `distillKnowledgeCards` AI 返回非数组 JSON
- `distillKnowledgeCards` AI 返回空数组
- `distillKnowledgeCards` fetch 失败
- `generateCards` repairJSON 处理字符串内反斜杠

覆盖率变化：lines 91.16% → 91.99%，branches 83.24% → 84.48%，functions 95.13% → 95.83%

### Suggested Action
提升覆盖率时遵循"低成本高收益"原则：外部依赖失败 > 输入边界 > 时间/缓存。避免为了覆盖而覆盖，优先保证核心路径有测试。

### Metadata
- Source: Phase 16 T1 测试覆盖率提升
- Related Files: tests/ai-service-functions.test.ts, electron/ai-service.ts
- Tags: testing, coverage, branch, boundary

---

## [LRN-20260722-002] best_practice

**Logged**: 2026-07-22T00:30:00+08:00
**Priority**: high
**Status**: resolved
**Area**: review
**Project**: zhixing-reader

### Summary
建立审查 Agent 规范，沉淀提示词模板、审查类目和反馈表达规范

### Details
跳出项目进行批判性审视后，发现项目存在"用过度规范的流程掩盖架构腐烂"的问题。为系统性提升代码审查质量，建立审查 Agent 规范：

1. **提示词模板**：Role + 硬性约束 + 三维输出（问题/风险/代码）
2. **审查类目**：基础质量层 → 设计架构层 → 安全合规层 → 性能运维层 → 技术债务层
3. **反馈表达**：具体问题 + 业务影响 + 可操作建议，采用 Conventional Comments 规范
4. **批判性框架**：静态规则层 + 语义分析层 + 架构决策层

规范文档：`.claude/rules/review-agent.md`

### Suggested Action
所有 PR / MR / 功能实现必须经过 AI 审查 Agent 初审。审查 Agent 按 `.claude/rules/review-agent.md` 执行，输出结构化报告。人工复核架构决策层。

### Metadata
- Source: Phase 16 批判性审视
- Related Files: .claude/rules/review-agent.md, AGENTS.md
- Tags: review, agent, prompt, checklist, feedback

---

## [LRN-20260722-003] correction

**Logged**: 2026-07-22T20:00:00+08:00
**Priority**: high
**Status**: pending
**Area**: testing
**Project**: zhixing-reader

### Summary
三绿（lint/typecheck/test/build）只是静态代理指标，不能替代真机点击端到端验证

### Details
2026-07-22/23 dogfood 阶段用户实际安装真机上体验时，一次性暴露十几个问题，均为 lint/typecheck/test/build 三绿门禁无法捕获的类别：

1. **知识卡片删除无确认弹窗** — UI 交互完整性问题（静态扫描不 catch UX 缺失）
2. **统计柱状图太粗** — Design token / 样式视觉效果问题（CSS 审查不保证视觉质量）
3. **2026年书籍"已读"状态不显示** — 边界条件触发（三绿测试数据只覆盖 2024-2025）
4. **AI SDK not configured 错误** — 启动空状态引导缺失（流测试不覆盖首次引导）
5. **AI 对话区太窄** — 布局/自适应问题（vitest 不测真实窗口缩放）
6. **NIGHTLY_LOOP 周末执行策略** — 调度策略/业务逻辑问题（单元测试不测 cron 策略）
7. **自定义模板不选中** — 表单状态/交互问题
8. **提示词编辑区太小** — UI 交互差、resize 不支持
9. **统计数据更新不及时** — 实时性/事件驱动问题
10. **知识卡片显示不全** — 渲染/滚动边界问题

**根本原因分析**：
- `npm run verify`（lint + typecheck + test + build）全是**静态代理指标**：lint 检查不 catch 逻辑错，typecheck 不 catch 运行时错，test 只测单元不测集成/端到端，build 成功只说明打包工具能编过
- 项目中现有 171 条单测均为单元级别的**快乐路径**测试，几乎没有：
  - 集成测试（ipc → database → renderer 端到端流程）
  - E2E 测试（Electron 窗口内 UI 交互）
  - 视觉回归测试（截图对比）
  - 边界/错误状态测试（空数据、网络断开、配置缺失）
- dogfood 阶段暴露的问题只有**真人真机点击**才能发现，自动化门禁全覆盖不了

### Suggested Action
1. **立即**：把 dogfood 发现的 10+ 问题作为 P0 bug 加入项目看板，逐一修复
2. **短中期**：对高频出问题的页面（Chat页 / Stats页 / 知识卡片）加 Playwright E2E 测试，覆盖关键用户路径
3. **长期**：建立"三重验证"质量体系：静态门禁（三绿）→ 集成测试（ipc+db 端到端）→ 人工 dogfood checklist
4. **认知转变**：`npm run verify` 全绿只是"代码无语法错误"，不等于"功能可用"；提交前对关键路径做一次人工点检

### Metadata
`- Source: dogfood Phase 2026-07-22/23
- Related Files: 全页面的 Stats, Chat, Bookshelf, KnowledgeCards, DailyLearning
- Tags: dogfood, e2e, verification-gap, static-vs-dynamic, qa, triple-verification

---

## [LRN-20260725-001] correction

**Logged**: 2026-07-25T00:00:00+08:00
**Priority**: high
**Status**: resolved
**Area**: tooling
**Project**: zhixing-reader

### Summary
交付前必须复核 verify，因为 working tree 可能悄悄引入 lint error（如 orchestrator.ts `\x00` 控制字符）。

### Details
2026-07-25 交付审查复核时发现 `electron/agent/orchestrator.ts` 存在 1 个 lint error：文件中意外混入 `\x00`（NUL）控制字符。该字符在常规 diff 与编辑器中不可见，但 ESLint 报 `no-control-regex` / 解析错误，直接阻塞 verify。

**根因**：
- 多轮 agent 编辑后，文件末尾或字符串字面量中可能残留不可见控制字符。
- `git diff` 默认不显示控制字符，只在 lint 时才暴露。

**修复**：
- 定位并删除 `\x00` 字符。
- 重新跑 `npm run verify`，确认 lint/typecheck/test/build 全绿。

### Suggested Action
交付前强制跑完整 verify；遇到 lint error 但肉眼找不到时，用十六进制工具（如 VS Code Hex Editor / `xxd`）检查文件是否含控制字符。

### Metadata
- Source: 2026-07-25 交付审查
- Related Files: `electron/agent/orchestrator.ts`
- Tags: lint, control-character, verify, delivery-readiness

---

## [LRN-20260725-002] best_practice

**Logged**: 2026-07-25T00:05:00+08:00
**Priority**: high
**Status**: resolved
**Area**: process
**Project**: zhixing-reader

### Summary
用户反馈要分 A/B/C 类：backend 问题过夜自主修，UI 问题留给 Trae，避免冲突。

### Details
2026-07-23 用户集中反馈 11 项问题，按负责方分类处理：

- **A 类（backend）**：流式响应失败 "AI SDK not configured" →  overnight 自主修，`ipc.ts` 双写 `setAIConfig` + `setAISDKConfig`。
- **B 类（UI 文件）**：知识卡片控件删减、确认弹窗、对话区宽度、统计趋势图、2026 已读显示、个人档案头像/昵称等 → 明确留给 Trae，overnight 不碰 UI 文件，避免与 Trae 改动冲突。
- **C 类（设置/算法 UI）**：自动同步 1d/3d/7d 选择器 → 后端算法就绪，前端选择器由 Trae 接入。
- **D 类（文档）**：智能体编排/提示词中心说明 → 产出独立 md 文档。

**结果**： overnight 自主开发与 Trae UI 改动零冲突，次日合并后门禁全绿。

### Suggested Action
建立反馈分级协议：A 类 backend 自主修；B/C 类 UI 明确归属 Trae；D 类转文档。每日晨会同步"不碰"清单。

### Metadata
- Source: 2026-07-23-24 用户反馈批处理
- Related Files: `.learnings/NIGHTLY_LOG.md`
- Tags: user-feedback, triage, overnight, ui-backend-separation

---

## [LRN-20260725-003] best_practice

**Logged**: 2026-07-25T00:10:00+08:00
**Priority**: high
**Status**: resolved
**Area**: testing
**Project**: zhixing-reader

### Summary
测试从 173 → 667 的 Phase 12-18 经验：用 `vi.hoisted` mock 模块级依赖，用测试 DB fixture 不 mock。

### Details
Phase 12-18 集中补充了 14 个测试文件，覆盖 agent builders / context-manager / state-tracker / memory-service / orchestrator / user-profile-service / knowledge-card-service / prompt-storage / embedding-service / weread-sync-manager / database-integration / ai-sdk-service。

**两种核心模式**：

1. **模块级依赖 mock（orchestrator / builders / user-profile-service）**：
   ```typescript
   const { mockStreamChat } = vi.hoisted(() => ({
     mockStreamChat: vi.fn(),
   }));
   vi.mock('../electron/agent/ai-sdk-service', () => ({
     sdkStreamChat: mockStreamChat,
   }));
   ```
   用 `vi.hoisted` 在模块顶层定义 mock，避免循环导入与提升问题。

2. **测试 DB fixture 不 mock（memory-service / database-integration）**：
   ```typescript
   const db = setupTestDatabase();
   // 直接操作真实 sql.js 内存数据库，验证 SQL/schema/约束
   ```
   对数据访问层，用真实 sql.js WASM 内存 DB 比 mock repository 更能捕获 schema 漂移与约束问题。

**结果**：测试用例从 173 增至 667，ai-service 覆盖率 lines 91.99% / branches 84.48% / functions 95.83%。

### Suggested Action
- 依赖重的编排/服务层：用 `vi.hoisted + vi.mock` 在模块级 mock。
- 数据访问/集成层：用 sql.js 内存 DB fixture，不 mock repository。

### Metadata
- Source: Phase 12-18 测试补全
- Related Files: `tests/orchestrator.test.ts`, `tests/memory-service.test.ts`, `tests/database-integration.test.ts`, `tests/__fixtures__/db-helpers.ts`
- Tags: testing, vi-hoisted, mock, sql.js, fixture, coverage

---

## [LRN-20260725-004] correction

**Logged**: 2026-07-25T00:15:00+08:00
**Priority**: high
**Status**: resolved
**Area**: backend
**Project**: zhixing-reader

### Summary
Vercel AI SDK 重构后必须双写 `setAIConfig` + `setAISDKConfig`，否则流式响应报 "AI SDK not configured"。

### Details
2026-07-23 将 orchestrator 从手写 `streamChat` 切换到 Vercel AI SDK 的 `sdkStreamChat` 后，新增 `electron/ai-sdk-service.ts` 管理 SDK 配置。但 `ipc.ts` 的 `SETTINGS.SET` handler 仍只调用旧的 `setAIConfig`，导致：

- 用户保存 AI 配置后，旧服务有配置，新 `ai-sdk-service` 仍是未配置状态。
- 发起流式对话时，`sdkStreamChat` 抛 "AI SDK not configured"。

**修复**：
```typescript
// electron/ipc.ts SETTINGS.SET
setAIConfig(provider, apiKey, baseUrl, model);
setAISDKConfig(provider, apiKey, baseUrl, model);
```

**教训**：重构期存在"双轨"服务时，配置写入必须同步到所有活跃服务，不能假设新旧服务共用同一套内存变量。

### Suggested Action
任何"服务替换/双轨运行"期间，配置初始化与持久化必须显式同步到所有相关服务；重构完成后清理旧服务。

### Metadata
- Source: Wave K/L AI SDK 重构 + 用户反馈 A 类
- Related Files: `electron/ipc.ts`, `electron/ai-sdk-service.ts`, `electron/ai-service.ts`
- Tags: ai-sdk, configuration, dual-track, stream-chat, refactor

---

## [LRN-20260725-005] correction

**Logged**: 2026-07-25T00:20:00+08:00
**Priority**: medium
**Status**: resolved
**Area**: backend
**Project**: zhixing-reader

### Summary
中文文本正则匹配不能用 `\b` 词边界，改用 `includes` + 最小长度保护。

### Details
`orchestrator.updateMethodologyMastery` 原用 `\b` 词边界正则匹配方法论名：
```typescript
const regex = new RegExp(`\\b${methodology.name}\\b`, 'i');
```

但 `\b` 匹配"单词字符（字母/数字/下划线）与非单词字符"边界，对中文无效。导致中文方法论名几乎永远匹配不上，掌握度从不更新。

**修复**：
```typescript
function matchesMethodology(text: string, name: string): boolean {
  if (/^[a-zA-Z]/.test(name)) {
    return new RegExp(`\\b${name}\\b`, 'i').test(text);
  }
  // 中文：无词边界概念，用 includes + 最小长度 2 防单字误匹配
  return name.length >= 2 && text.includes(name);
}
```

**验证**：新增 2 个回归测试：中文名匹配命中、单字名不误匹配。

### Suggested Action
多语言文本匹配时，必须按语言分别处理：英文可用 `\b`，中文用 `includes` + 长度/分词保护，日文/韩文需单独评估。

### Metadata
- Source: Wave L orchestrator 测试发现
- Related Files: `electron/agent/orchestrator.ts`, `tests/orchestrator.test.ts`
- Tags: regex, word-boundary, chinese, includes, internationalization

---