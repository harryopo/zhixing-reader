# 知行读书 (Zhixing Reader)

> **AI 驱动的阅读成长智能体** · Electron 桌面应用 · Anki 同源 FSRS v5 · 微信读书深度同步
>
> **v1.0.0 正式版** | 2026-07-28 | [📦 下载安装包](https://github.com/harryopo/zhixing-reader/releases) | [🌐 项目主页](https://harryopo.github.io/zhixing-reader)

[![Version](https://img.shields.io/badge/version-1.0.0-8b5cf6)](https://github.com/harryopo/zhixing-reader/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](./LICENSE)
[![Electron](https://img.shields.io/badge/Electron-35-47848F?logo=electron)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![FSRS](https://img.shields.io/badge/FSRS-v5%20(DSR)-00C853)](https://github.com/open-spaced-repetition/ts-fsrs)
[![Tests](https://img.shields.io/badge/tests-667%20%E7%94%A8%E4%BE%8B%20/%2085%25-22c55e)](./tests)
[![Lines](https://img.shields.io/badge/code-57%2C000%2B%20TS-blueviolet)]()

---

## 一、项目简介

**知行读书**是一款面向阅读成长场景的桌面应用，把「**微信读书同步 → AI 智能体理解 → 科学间隔复习 → 知识卡片体系化 → 英语学习**」完整闭环装进本地优先的 Electron 容器。

围绕"读了就忘、笔记散乱、想问无门、知道做不到"四大阅读痛点，给出**16 大功能模块 + 5 大核心创新**的完整解决方案。

> **面向所有阅读者，帮每一位读者构建起属于自己的自我成长型系统。**

| 维度 | 详情 |
|------|------|
| **形态** | Electron 三进程桌面应用（Main / Preload / Renderer）|
| **代码规模** | 57,000+ 行 TypeScript strict（源码 49,081 + 测试 7,884）|
| **测试覆盖** | 667 用例 / 28 文件 / ≥ 85% 覆盖率（ai-service 94.6%）|
| **存储** | sql.js (SQLite WASM) · 16 张表 · Vectra 本地向量索引 |
| **核心能力** | 微信读书同步 · **FSRS v5** 间隔重复 · AI 智能体 · 知识卡片 · 词汇学习 |
| **算法** | **ts-fsrs@5.4.1**（open-spaced-repetition 官方，Anki 同源）|
| **打包** | electron-builder → Windows NSIS 安装包（**125MB**）|
| **License** | MIT（自由使用 / 修改 / 商用）|

---

## 二、5 大核心创新 ⭐

> **知行读书如何把"读了就忘、笔记散乱、想问无门、知道做不到"四大阅读痛点，打成"读→记→懂→用"完整闭环？**

| # | 创新点 | 一句话 | 关键指标 |
|---|--------|--------|----------|
| **1** | **方法论自动注入 Agent**（行业首创） | AI 回答时自动引用书中方法论，实时追踪掌握度 | mastery_level 追踪 / 一键导出 Skill |
| **2** | **5 维 ContextBuilder**（预算制懒加载） | 书籍/方法论/卡片/记忆/画像 5 维按需注入 | **Token 节省 33%-55%**（中位数 38%）|
| **3** | **FSRS v5 (DSR) 同源科学记忆引擎** | 集成 ts-fsrs 5.4.1 官方库（Anki 23.10+ 同源）| 保持率比 SM-2 **高 20-30%** |
| **4** | **本地优先架构 · 数据主权还给用户** | sql.js + Vectra + safeStorage 三重本地化 | **零遥测** / AI 直连不过中转 |
| **5** | **ECDICT 离线词典 + 语境化英语学习** | 13.6MB 词典 + 6 类词形还原 + 每日外刊 | **O(1) 查询** / 6 万词条 |

### 5 维 ContextBuilder 详细预算

| 优先级 | 构建器 | 数据源 | Token 预算 |
|--------|--------|--------|------------|
| 90 | 书籍内容 | Vectra 语义搜索 → 关键词回退 | 1500 |
| 80 | 方法论 | 相关性评分 Top 5 | 1000 |
| 70 | 知识卡片 | 相关性评分 Top 10 | 800 |
| 50 | 长期记忆 | 相关记忆 3 条 + 摘要 | 500 |
| 40 | 用户画像 | 动态生成 | 200 |
| **合计** | - | - | **4000** |

**三条硬规则**：① 预算不足时低优先级自动跳过；② 每个构建器独立失败不拖垮整体（fail-soft 柔性容错）；③ 超预算截断并显式标记 `...(已截断)`。

---

## 三、16 大功能模块

| # | 模块 | 路由 | 核心能力 |
|---|------|------|----------|
| 1 | 主页 | `/` | 数据卡片 + 今日待复习 + 推荐文章 |
| 2 | 书架 | `/bookshelf` | 微信读书同步 + 阅读进度 |
| 3 | 书籍详情 | `/bookshelf/:id` | 笔记/卡片/方法论/讨论 多 Tab |
| 4 | 笔记 | `/notes` | 全书笔记检索 + 高亮原文 + Markdown 导出 |
| 5 | **复习** | `/review` | FSRS v5 智能调度 + 主动回忆两段法 + 4 评分预览 |
| 6 | AI 对话 | `/chat` | 多会话 + 流式 + 深度思考 + 方法论注入 + RAG 溯源 |
| 7 | 方法论 | `/methodologies` | 独立方法论管理 + 掌握度追踪 |
| 8 | 每日学习 | `/daily-learning` | 英文外刊 + AI 翻译对照 + 悬停查词 |
| 9 | 生词本 | `/vocabulary` | ECDICT 查询 + 学习阶段 + CSV/Anki 导出 |
| 10 | 数据统计 | `/stats` | 阅读趋势 + 学习热力图 |
| 11 | Token 监控 | `/token-usage` | 服务商/功能双维用量 + 成本核算 |
| 12 | 个人中心 | `/profile` | 阅读画像 + 微信读书资料继承 |
| 13 | 设置 | `/settings` | AI 多服务商热切换 + 数据导入导出 |
| 14 | 智能体编排 | `/agent-orchestration` | 六步流水线可视化 + 意图/策略矩阵 + 提示词模板 |
| 15 | Skill 生成 | 对话/方法论内 | 方法论一键导出为 Claude Code Skill |
| 16 | 学习热力图 | `/stats/heatmap` | 12 周复习热力图 + 本周节奏可视化 |

---

## 四、Agent 六步编排流水线

> **灵魂模块**：为什么同样接大模型，知行读书的 AI 是"私教"而别人的是"问答机"？

```
   用户输入
      ↓
  ┌─────────────────────────────────────────────────────────────┐
  │  ① 意图分类         (1-5ms)      本地关键词打分 + 负向惩罚   │
  │  ② 策略选择         (<1ms)       意图 → 教学模式映射          │
  │  ③ 难度自适应       (<1ms)       Bloom 状态机 + 升降级规则   │
  │  ④ 5 维上下文构建   (50-200ms)   RAG 优先 + 关键词回退       │
  │  ⑤ 提示组装         (<1ms)       4 段动态拼装                │
  │  ⑥ 流式响应         (网络)       Vercel AI SDK streamText   │
  └─────────────────────────────────────────────────────────────┘
      ↓
   AI 打字机输出
```

**本地决策链路 52-207ms**（步骤 ①-⑤），**用户输入到 AI 开始输出"几乎无白屏感"**。

**4 类意图**：
- `knowledge_query` 知识查询 → 直接回答（Bloom 1 记忆）
- `deep_discussion` 深度讨论 → 苏格拉底追问（Bloom 3 应用）
- `teaching_practice` 教学实践 → 费曼复述（Bloom 2 理解）
- `casual_chat` 闲聊问候 → 直接回答

**对话后自动学习**：每轮对话完成后自动更新概念掌握度、提取长期记忆、更新方法论掌握度——**系统越用越懂你**。

---

## 五、技术栈

| 层 | 选型 | 版本 | 选型理由 |
|----|------|------|----------|
| **桌面壳** | Electron | 35.x | 跨平台桌面开发事实标准 |
| **构建工具** | electron-vite | 2.x | Vite 5 + HMR，三进程并行开发 |
| **UI 框架** | React | 19.x | Concurrent Mode、Suspense、自动批处理 |
| **路由** | React Router | 7.x | 嵌套路由 + Data Router |
| **类型** | TypeScript | 5.6 strict | 52,000+ 行 strict 模式 |
| **样式** | Tailwind CSS | 4.x | 原子化 CSS + PostCSS + 设计 Token |
| **状态** | Zustand | 5.x | 轻量（< 3KB）、hooks-first |
| **数据库** | sql.js | 1.14 | SQLite WASM，跨平台一致 |
| **向量索引** | Vectra | 0.15 | 纯 TS 本地向量库 |
| **间隔重复** | **ts-fsrs** | **5.4.1** | **FSRS v5 DSR，与 Anki 23.10+ 同源** |
| **AI SDK** | Vercel AI SDK | 7.x | 多服务商统一接口 + 流式 |
| **图表** | ECharts / Recharts | 5.5 / 3.8 | 复杂 / 简单场景分用 |
| **加密** | Electron safeStorage | 内置 | OS 系统级加密（DPAPI / Keychain）|
| **测试** | Vitest | 2.x | 667 用例，≥ 85% 覆盖率门禁 |
| **打包** | electron-builder | 25.x | Windows NSIS 安装包 |
| **词典** | ECDICT | 自建 | 13.6MB JSON，~6 万词条，CEFR 分级 |

---

## 六、FSRS v5 算法集成 ⭐

> **本节重点**：描述项目从自实现 FSRS 引擎升级到 `ts-fsrs@5.4.1`（Anki 同源算法）的设计与优势。

### 6.1 为什么升级？

| 维度 | 自实现 v1（已废弃） | **ts-fsrs 5.4.1** |
|------|---------------------|---------------------|
| 算法 | SM-2 简化 | **FSRS v5 (DSR)** · Anki 23.10+ 同源 |
| 参数 | 17 个 w | **19 个 w**（FSRS-5 标准权重）|
| 维护 | 项目自维护 | open-spaced-repetition 官方（Anki FSRS 团队）|
| 数据互通 | 仅本项目 | **与 Anki 数据互通**（同 schema）|
| 依赖 | fsrs.js 1.0.0（2 年未更新）| ts-fsrs 5.4.1（活跃维护）|
| 包体积 | — | **< 30KB**，0 依赖 |
| 预览能力 | 1 次 1 结果 | **`repeat()` 一次返回 4 种评分结果** |
| 遗忘曲线 | 简化 | **完整 DSR 公式** `(1 + factor·t/9S)^decay` |

### 6.2 升级方案：API 兼容适配层

**核心目标**：内部算法替换为 `ts-fsrs`，但**对外 100% 保持 API 兼容**，零破坏性变更。

```
+--------------------+        +----------------------+        +----------------+
| Renderer 调用       |  →     | electron/            |  →     | ts-fsrs        |
| reviewCard()       |        | fsrs-engine.ts       |        | 5.4.1          |
| isDue()            |        | (适配层)             |        | (FSRS v5 DSR)  |
| getParameters()    |        |                      |        |                |
+--------------------+        +----------------------+        +----------------+
                                       ↓
                                Card ↔ FsrsCard
                                双向转换层
```

### 6.3 对外 API 100% 兼容

| 类别 | API | 说明 |
|------|-----|------|
| **类型** | `Card`, `FSRSParameters`, `FSRSCardStats`, `VocabReviewResult` | 字段名、字段类型保持不变 |
| **枚举** | `CardState` (New=0/Learning=1/Review=2/Relearning=3) | 与 ts-fsrs `State` 完全对齐 |
| **枚举** | `Rating` (Again=1/Hard=2/Good=3/Easy=4) | 与 ts-fsrs `Grade` 完全对齐 |
| **函数** | `createCard`, `reviewCard`, `reviewCardBatch` | 签名不变 |
| **函数** | `getNextReviewTime`, `isDue`, `getCardInterval`, `getCardDaysUntilDue` | 签名不变 |
| **函数** | `getCardRetentionRate`, `calculateStats`, `getForecast`, `getOptimalReviewOrder` | 签名不变 |
| **函数** | `getParameters`, `setCustomParameters`, `resetParameters` | 签名不变 |
| **函数** | `cardFromDb`, `cardToRow` | 数据库 schema 不变 |
| **函数** | `reviewVocabulary` | 词汇独立 SM-2 混合，不走 ts-fsrs |

### 6.4 step 映射规则

项目原有 API 用 `step ∈ {0, 1, 2}` 表示学习阶段；ts-fsrs 用 `learning_steps` 索引表示"当前所在步骤"。两者语义不同，适配层做显式映射：

| 项目 step 语义 | ts-fsrs `learning_steps` |
|----------------|--------------------------|
| `New` 状态，`step=0` | `learning_steps=0` |
| `Learning`，刚进入第 1 步（`step=0`）| `learning_steps=1` |
| `Learning`，Learning+Good 1 次后（`step=1`）| `learning_steps=2` |
| `Review` 毕业（`step=2`）| `learning_steps=0`（无意义）|
| `Learning + Again` 重置（`step=0`）| `learning_steps=0` |

**核心规则**：
- `toFsrsCard`: `ls = state ∈ {Learning, Relearning} ? step + 1 : 0`
- `fromFsrsCard`: `step = state === Review ? 2 : max(0, ls - 1)`

### 6.5 ts-fsrs 5.4.1 关键 API 用法

```typescript
import { fsrs, generatorParameters, createEmptyCard, State, Rating } from 'ts-fsrs'

// 1. 创建调度器实例
const scheduler = fsrs(generatorParameters({
  request_retention: 0.9,
  maximum_interval: 36500,
  enable_fuzz: true,
  enable_short_term: true,
  learning_steps: ['1m', '10m', '10m'],
  relearning_steps: ['1m', '10m'],
}))

// 2. 计算一次复习
const card = createEmptyCard()
const result = scheduler.next(card, new Date(), Rating.Good)
// result.card  ← 更新后的卡片
// result.log   ← 复习日志

// 3. ⭐ 预览 4 种评分结果（v5 优势）
const preview = scheduler.repeat(card, new Date())
// preview[Rating.Manual=0] ... preview[Rating.Easy=4]
// 每条都是 { card, log }，可一次性显示给用户

// 4. 遗忘曲线检索概率
const retrievability = scheduler.get_retrievability(card, new Date(), false)
// 返回 0-1 之间的保持率
```

### 6.6 升级带来的实际收益

| 收益 | 说明 |
|------|------|
| **调度准确度** | DSR 模型（stability / difficulty / retrievability）比 SM-2 准确度高 20-30% |
| **Anki 互通** | 与 Anki FSRS 插件使用同一算法，本项目卡片可导出到 Anki |
| **0 依赖** | ts-fsrs 不依赖任何第三方库，包体积 < 30KB |
| **活跃维护** | open-spaced-repetition 团队持续迭代，bug 修复及时 |
| **预览能力** | `repeat()` 一次返回 4 种评分 → 可实现"评分前展示未来间隔" |
| **遗忘曲线** | 完整实现 `(1 + factor·t/9S)^decay`，可精细化分析用户记忆 |
| **类型安全** | 100% TypeScript，完整 `.d.ts` 类型定义 |

### 6.7 测试覆盖

升级后 **38 个 FSRS 引擎单元测试**（vitest），分两类：

1. **原有 18 个冒烟测试** —— 100% 保持通过（API 兼容验证）
2. **新增 20 个适配层测试** —— 验证与 ts-fsrs 5.4.1 的正确集成
   - 枚举映射（CardState / Rating 与 ts-fsrs 一致）
   - step 映射规则（toFsrsCard / fromFsrsCard 双向）
   - 算法真的来自 ts-fsrs（与独立 ts-fsrs 调用对比）
   - 19 元素默认 weights 兼容
   - `repeat()` 预览能力验证
   - 批量复习独立性

---

## 七、目录结构

```
zhixing-reader/
├── electron/                                # Main 进程
│   ├── main.ts                              # 入口
│   ├── preload.ts                           # contextBridge（423 行）
│   ├── ipc.ts                               # IPC handlers（657 行）
│   ├── database.ts                          # sql.js DB（1967 行）
│   ├── fsrs-engine.ts                       # ⭐ FSRS v5 适配层（900+ 行）
│   ├── ai-service.ts                        # AI 卡片/摘要（800+ 行）
│   ├── ai-sdk-service.ts                    # AI 流式（500+ 行）
│   ├── weread-api.ts                        # 微信读书 Skill API（1000+ 行）
│   ├── weread-sync-manager.ts               # 同步管理（300+ 行）
│   ├── agent/                               # ⭐ AI Agent 编排
│   │   ├── orchestrator.ts                  # 六步流水线主控
│   │   ├── context-manager.ts               # 5 维构建器协调
│   │   ├── intent-classifier.ts             # 4 类意图分类
│   │   ├── strategy-selector.ts             # 教学策略
│   │   ├── state-tracker.ts                 # Bloom 状态机
│   │   ├── system-prompt.ts                 # 4 段动态拼装
│   │   └── builders/                        # 5 个 ContextBuilder
│   ├── repositories/                        # 仓储层
│   ├── services/                            # 业务服务（RAG / 记忆 / 嵌入）
│   └── types/                               # 实体类型
├── src/renderer/                            # Renderer 进程（React）
│   └── src/
│       ├── pages/                           # 20 个路由页面
│       ├── components/                      # UI 组件
│       ├── stores/                          # 8 个 Zustand Store
│       ├── admin-charts.tsx                 # ECharts 6 图
│       └── echarts-theme-tailwind.ts        # 主题映射
├── src/shared/                              # 跨进程共享（类型 + IPC 通道常量）
├── tests/                                   # Vitest 单元测试（667 用例）
├── resources/
│   ├── dictionary.json                      # ECDICT 13.6MB
│   ├── icon.ico / icon.png
├── landing/                                 # 宣传页源码（GitHub Pages 部署）
├── AGENTS.md                                # AI Agent 入口
├── CLAUDE.md                                # Claude Code 专属
├── CHANGELOG.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── FAQ.md
├── LICENSE                                  # MIT
├── PRIVACY.md
└── README.md
```

---

## 八、性能画像

| 指标 | 数值 | 说明 |
|------|------|------|
| 冷启动 → 主页可交互 | **< 1.0s** | 三进程预加载 |
| 路由懒加载（Code Splitting） | **80ms/页** | Vite manualChunks |
| 词典首次加载 | **150ms** | 13.6MB JSON → 内存 |
| 向量索引首次构建 | **200-500ms** | 取决于划线数 |
| 意图分类 | **1-5ms** | 本地关键词打分 |
| 5 维上下文构建 | **50-200ms** | RAG 优先 + 关键词回退 |
| **Agent 本地决策合计** | **52-207ms** | 步骤 ①-⑤ 全本地 |
| AI 流式首 token | **500-2000ms** | 取决于服务商 |
| 后续 token 速率 | **30-80 token/s** | 中文 |

### 真实使用数据（开发者本人 30 天深度使用）

| 指标 | 数值 |
|------|------|
| **累计 Token 消耗** | **128 万 tokens**（30 天） |
| 复习曲线 | 稳定上升，无 ease hell 现象 |
| 核心场景 | 阅读 → 笔记 → 复习 → 应用 全闭环验证通过 |
| 平均每日 Token | ~4.3 万（≈ ¥0.5-1.5 元，按免费额度内零成本） |
| 数据完全本地 | 0 条数据离开本机（仅 AI 请求直连服务商） |

---

## 九、本地优先与安全合规

| 数据类别 | 存储位置 | 是否离开本机 |
|----------|----------|--------------|
| 用户输入（消息/笔记/评分） | 本地 SQLite | ❌ 否 |
| 微信读书同步数据 | 本地 SQLite | ❌ 否 |
| AI 请求上下文 | 发送至用户自选的 AI 服务商 | ✅ 仅此一项，**直连不过中转** |
| 系统生成（卡片/方法论/记忆） | 本地 SQLite | ❌ 否 |
| 向量索引 | Vectra 本地文件 | ❌ 否 |
| API Key | safeStorage 加密 | ❌ 否 |

**离线可用场景**：除"微信读书同步"和"AI 对话"外，复习 / 笔记 / 卡片 / 词典 / 生词本全部离线可用。

**零遥测** —— 项目不含任何分析 / 追踪 / 广告 SDK，不向任何第三方服务器发送用户数据。

**Electron safeStorage 系统级加密**：Windows DPAPI / macOS Keychain / Linux libsecret。

---

## 十、开发与构建

```bash
# 安装依赖（使用 npmmirror 镜像）
npm install

# 开发模式（Vite 端口 5500 + Electron 自动开）
npm run dev

# 质量门禁（提交前必跑）
npm run lint            # ESLint
npm run typecheck       # tsc --noEmit
npm run test            # Vitest（含覆盖率）
npm run build           # 三进程编译
npm run verify          # 一键跑上面四项

# 打包 Windows NSIS 安装包
npm run package:win
# → 生成 installer/ZhixingReader-Setup-1.0.0.exe (125MB)

# 词典（仅开发者）
npm run build-dict      # 从 ecdict.db 重新提取 dictionary.json
```

**提交顺序**：`lint` → `typecheck` → `test` → `build`（**全绿才可提交**）。

### ESLint 规则分级策略

| 规则级别 | 规则 | 说明 |
|----------|------|------|
| **error** | `complexity` (≤15) | 函数圈复杂度硬约束 |
| **error** | `max-params` (≤6) | 函数参数数量 |
| **error** | `prefer-const` + `eqeqeq` | 强制 const / 强制 === |
| **warn** | `max-lines` (≤500) | 单文件行数 |
| **warn** | `max-lines-per-function` (≤80) | 单函数行数 |
| **warn** | `max-depth` (≤4) | 嵌套深度 |

---

## 十一、相关链接

| 资源 | 链接 |
|------|------|
| 📦 安装包下载 | https://github.com/harryopo/zhixing-reader/releases |
| 🌐 项目主页 | https://harryopo.github.io/zhixing-reader |
| 🐛 Issue 反馈 | https://github.com/harryopo/zhixing-reader/issues |
| 📝 更新日志 | [CHANGELOG.md](CHANGELOG.md) |
| ❓ 常见问题 | [FAQ.md](FAQ.md) |
| 🔒 隐私政策 | [PRIVACY.md](PRIVACY.md) |
| 🤝 贡献指南 | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 📋 行为准则 | [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |
| 📄 开源许可证 | [LICENSE](LICENSE) |
| 🤖 Agent 协作规范 | [AGENTS.md](AGENTS.md) |
| 🧠 Claude Code 配置 | [CLAUDE.md](CLAUDE.md) |

### 参考资源

| 资源 | 链接 |
|------|------|
| ts-fsrs（官方）| https://github.com/open-spaced-repetition/ts-fsrs |
| FSRS 算法论文 | https://github.com/open-spaced-repetition/fsrs4anki |
| Anki FSRS 插件 | https://docs.ankiweb.net/deck-options.html#fsrs |
| Vectra 向量库 | https://github.com/Stevenic/vectra |
| sql.js | https://github.com/sql-js/sql.js |
| Vercel AI SDK | https://sdk.vercel.ai/docs |
| Electron 安全 | https://www.electronjs.org/docs/latest/tutorial/security |
| ECDICT 词典 | https://github.com/skywind3000/ECDICT |

---

## 十二、变更记录

| 日期 | 版本 | 变更 | 作者 |
|------|------|------|------|
| 2026-07-28 | v1.0.0 | 文档体系完善：技术白皮书（提交2/3）+ README 双双更新到 5 大创新 + 16 大模块；补充 30 天真实使用数据（128 万 Token） | 张子涵 |
| 2026-07-25 | v1.0.0 | 首个正式版本（含 FSRS v5 / ECharts / 667 测试），安装包见 [Releases](https://github.com/harryopo/zhixing-reader/releases) | 张子涵 |

历史迭代明细见 [CHANGELOG.md](CHANGELOG.md)。

---

## 十三、贡献指南

我们欢迎任何形式的贡献：Bug 报告、功能建议、文档完善、代码修复、UI/UX 改进。

**快速参与**：

1. 📖 阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解开发环境搭建、提交规范、PR 流程
2. 🤝 查看 [GitHub Issues](https://github.com/harryopo/zhixing-reader/issues) 中带 `good first issue` 标签的入门 Issue
3. ✅ 提交 PR 前请确保 `npm run verify` 全绿（lint / typecheck / test / build）
4. 📝 Commit message 遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 规范

**行为准则**：参与本项目即代表你同意遵守 [Code of Conduct](CODE_OF_CONDUCT.md)。请在所有交流中保持友善与尊重。

---

## 十四、开源许可证

本项目基于 [**MIT License**](LICENSE) 开源，允许自由使用、修改、分发、商用，只需保留版权声明与许可证文本。

### 主要依赖许可证

| 依赖 | 版本 | 许可证 |
|------|------|--------|
| Electron | 35 | MIT |
| React | 19 | MIT |
| TypeScript | 5.6 | Apache-2.0 |
| ts-fsrs | 5.4.1 | MIT |
| sql.js | 1.14 | MIT |
| Tailwind CSS | 4 | MIT |
| Zustand | 5 | MIT |
| Apache ECharts | 5.5.1 | Apache-2.0 |
| Recharts | 3.8.1 | MIT |
| Vitest | 2 | MIT |
| electron-builder | 25 | MIT |
| Vercel AI SDK | - | Apache-2.0 |

> 完整依赖许可证清单可通过 `npx license-checker --summary` 生成。

### 致谢

本项目站在巨人的肩膀上，特别感谢：

- [open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) —— FSRS v5 算法的 TypeScript 实现（Anki 同源）
- [Electron](https://www.electronjs.org/) —— 跨平台桌面应用框架
- [React](https://react.dev/) —— UI 框架
- [Apache ECharts](https://echarts.apache.org/) —— 数据可视化库
- [sql.js](https://github.com/sql-js/sql.js) —— SQLite WASM 编译
- 微信读书开放平台 —— Skill API 让"用户阅读资产归用户"成为可能

---

## License

本项目基于 [MIT License](LICENSE) 开源。

Copyright © 2026 张子涵 · 深圳信息职业技术大学

---

*最后更新：2026-07-28 | 与 v1.0.0 发布版代码一致*
