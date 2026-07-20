# 模块功能 smoke test 计划（2026-07-20）

> **目标**：为每个核心模块补齐"模块功能是否能跑通"的自动化测试，比赛期发现并修复潜在 bug。
> **范围**：聚焦纯函数 + 可 mock 依赖，规避 BrowserWindow / Electron 主进程耦合。
> **不做**：不写 E2E GUI 测试（比赛后用 Playwright 补），不重构模块（仅测试）。

---

## 一、测试金字塔

```
              ┌──────────────┐
              │  E2E (GUI)   │   ← 比赛后用 Playwright 补
              └──────┬───────┘
                     │
          ┌──────────┴──────────┐
          │  集成 smoke test    │   ← 本次目标
          │  (mock 外部依赖)    │      不依赖 Electron 主进程
          └──────────┬──────────┘
                     │
      ┌──────────────┴──────────────┐
      │  单元测试 (已有 40 个)      │   ← FSRS + IPC
      └─────────────────────────────┘
```

---

## 二、分批计划

### 第 1 批：零外部依赖纯函数（预计 +25 tests）

| # | 文件 | 测什么 | 测法 |
|---|------|--------|------|
| 1 | `tests/template-engine.test.ts` | `renderTemplate` / `extractVariables` / `highlightVariables` / `validateTemplate` | 直接调函数，断言返回值 |
| 2 | `tests/prompt-registry.test.ts` | `PROMPT_REGISTRY` 数据完整性：所有 id 唯一、category 合法、role 合法、变量 exampleVars 全覆盖 | 遍历数组断言 |
| 3 | `tests/http-client.test.ts` | `sleep` / `calculateBackoffDelay` (linear/exp/fixed) / `isAbortErrorMessage` / `HttpAbortError` / `HttpNetworkError` 行为 | 直接调，断言结果 |

### 第 2 批：纯逻辑 + mock 外部（预计 +40 tests）

| # | 文件 | 测什么 | 测法 |
|---|------|--------|------|
| 4 | `tests/intent-classifier.test.ts` | `classifyIntent` 对 4 种意图的分类准确率 | 关键词匹配 |
| 5 | `tests/strategy-selector.test.ts` | 教学策略选择逻辑（按意图 + 表现） | 纯函数断言 |
| 6 | `tests/dictionary-service.test.ts` | `deriveBaseForm` 词形还原 | mock electron.app，断言词形 |
| 7 | `tests/ai-service-distill.test.ts` | `distillKnowledgeCards` 输出解析（mock LLM 响应） | 注入 mock fetch |

### 第 3 批：renderer store（预计 +30 tests）

| # | 文件 | 测什么 | 测法 |
|---|------|--------|------|
| 8 | `tests/chatStore.test.ts` | 消息增删、清空、流式追加 | zustand + 初始化 store |
| 9 | `tests/profileStore.test.ts` | 画像 fetch/更新 | mock electronAPI |
| 10 | `tests/settingsStore.test.ts` | 配置读写 | mock electronAPI |

---

## 三、覆盖目标

| 阶段 | 目标覆盖率（被测文件） | 说明 |
|------|----------------------|------|
| 第 1 批 | ≥ 90% | 全是纯函数，容易全覆盖 |
| 第 2 批 | ≥ 70% | mock 依赖可能漏掉边界 |
| 第 3 批 | ≥ 60% | 异步 + 状态机，边界多 |
| 累计 | 当前 5% → ~25% | 不可能一次到位，分批推进 |

---

## 四、跳过 / 暂不测

| 模块 | 原因 | 后续 |
|------|------|------|
| `database.ts` 1754 行 | 强依赖 sql.js WASM 初始化，需 Electron 环境 | E2E 时测 |
| `weread-api.ts` | 依赖 electron.app + 真实网络 | 集成测试时 mock 网络 |
| `knowledge-card-service.ts` | 依赖 BrowserWindow + DB + WeRead API | E2E 时测 |
| `ipc.ts` 587 行 | 依赖 ipcMain 注册，需 Electron 环境 | E2E 时测 |
| `ai-service.ts` 主流程 | 依赖 LLM API key + 流式响应 | 部分函数在第 2 批 mock 测 |
| `admin.ts` / `main.ts` | Electron 生命周期 | E2E 时测 |

---

## 五、风险与缓解

| 风险 | 缓解 |
|------|------|
| Mock electron 失败 | 用 `vi.mock` 路径别名，参考 fsrs-engine.test.ts 已有的 mock 模式 |
| AI service 复杂依赖 | 仅测纯函数部分（distill JSON 解析），不测真实 LLM 链路 |
| Renderer store 需要 jsdom | 已有 `tests/jsdom-setup.ts`，复用 |
| 测试运行时间变长 | 控制在 5s 以内（当前 1.3s） |

---

## 六、提交策略

- 每批 1 个 commit：`test(模块名): add smoke test for ...`
- 跑通 verify 后才提交
- 失败立即 fix，不留 TODO

---

## 七、产出

- 8-10 个新测试文件
- 预计 +95 tests（25 + 40 + 30）
- 测试覆盖从 5% → ~25%
- 比赛期发现潜在 bug，记录到 `.learnings/ERRORS.md`

---

*创建于 2026-07-20 | 由 ai-dev-workflow 阶段四（编码）计划自动生成*
