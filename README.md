# 知行读书 (Zhixing Reader)

> **AI 驱动的阅读成长智能体** · Electron 桌面应用 · Anki 同源 FSRS v5 算法 · 微信读书同步

[![Version](https://img.shields.io/badge/version-1.0.0-8b5cf6)](#)
[![Electron](https://img.shields.io/badge/Electron-35-47848F?logo=electron)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![FSRS](https://img.shields.io/badge/FSRS-v5%20(DSR)-00C853)](https://github.com/open-spaced-repetition/ts-fsrs)

---

## 一、项目简介

**知行读书**是一款面向阅读成长场景的桌面应用，把「**微信读书同步 → AI 智能体理解 → 科学间隔复习 → 知识卡片体系化 → 英语学习**」完整闭环装进本地优先的 Electron 容器。

| 维度 | 详情 |
|------|------|
| **形态** | Electron 三进程桌面应用（Main / Preload / Renderer）|
| **存储** | sql.js (SQLite WASM) · Qdrant（可选向量库）|
| **核心能力** | 微信读书同步 · **FSRS v5** 间隔重复 · AI 智能体对话 · 知识卡片 · 词汇学习 |
| **打包** | electron-builder → Windows NSIS 安装包 |
| **算法** | **ts-fsrs@5.4.1**（open-spaced-repetition 官方，Anki 同源）|

---

## 二、技术栈

| 层 | 选型 | 备注 |
|----|------|------|
| 桌面壳 | Electron 35 | 三进程：Main / Preload / Renderer |
| 构建 | electron-vite 2 | Vite 5 + HMR |
| UI 框架 | React 19 + React Router 7 | 严格模式 |
| 类型 | TypeScript 5.6 strict | 0 `any` 原则（除遗留）|
| 样式 | Tailwind CSS 4 + PostCSS | 暗色主题优先 |
| 状态 | Zustand 5 | 轻量、hooks-first |
| 数据库 | sql.js 1.14 | WASM，无原生依赖 |
| 间隔重复 | **ts-fsrs 5.4.1** | FSRS v5 DSR 模型 |
| 图表（AdminDashboard） | **Apache ECharts 5.5.1** + echarts-for-react 3.0.2 | 按需引入、Canvas 渲染、20+ 图表类型 |
| 图表（Stats 页） | Recharts 3.8.1 | 简单场景够用 |
| AI 智能体 | 自研 5 维 ContextBuilder | 意图分类 + 编排 + 策略 |
| 向量库（可选） | Qdrant | RAG 增强 |
| 测试 | Vitest 2 + @vitest/coverage-v8 | ≥ 85% 覆盖率门禁 |
| 打包 | electron-builder 25 | Windows NSIS |

---

## 三、核心功能

### 3.1 微信读书同步
- 拉取书架、笔记、划线、书评
- 离线缓存到本地 sql.js
- 自动合并增量更新

### 3.2 AI 智能体对话
- 5 维上下文：书籍上下文 / 知识卡片 / 记忆 / 方法论 / 用户画像
- 意图分类 → 策略选择 → 编排执行
- 流式响应 + Token 用量统计
- 提示词模板热更新

### 3.3 科学间隔复习 ⭐ FSRS v5
见下方 [§ 四、FSRS v5 算法集成](#四fsrs-v5-算法集成) 章节。

### 3.4 知识卡片
- 自动从划线蒸馏知识卡片
- 反向链接到原文
- 复习时联动 FSRS 调度

### 3.5 词汇学习
- 词频词典（resources/dictionary.json，~8 万词）
- 上下文例句匹配
- SM-2 混合算法独立调度

### 3.6 数据看板
- Token 用量（CCS-CSwitch 风格大数字）
- 复习统计（FSRS 状态分布 + 稳定性曲线）
- 会话历史 + 提示词中心

---

## 四、FSRS v5 算法集成

> **本节重点**：描述项目从自实现 FSRS 引擎升级到 `ts-fsrs@5.4.1`（Anki 同源算法）的设计与优势。

### 4.1 为什么升级？

| 维度 | 自实现 v1（已废弃） | **ts-fsrs 5.4.1** |
|------|---------------------|---------------------|
| 算法 | SM-2 简化 | **FSRS v5 (DSR)** · Anki 23.10+ 同源 |
| 参数 | 17 个 w | **21 个 w**（含 decay / factor）|
| 维护 | 项目自维护 | open-spaced-repetition 官方（Anki FSRS 团队）|
| 数据互通 | 仅本项目 | **与 Anki 数据互通**（同 schema）|
| 依赖 | fsrs.js 1.0.0（2 年未更新）| ts-fsrs 5.4.1（活跃维护）|
| 包体积 | — | **< 30KB**，0 依赖 |
| 预览能力 | 1 次 1 结果 | **`repeat()` 一次返回 4 种评分结果** |
| 遗忘曲线 | 简化 | **完整 DSR 公式** `(1 + factor·t/9S)^decay` |

### 4.2 升级方案：API 兼容适配层

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

### 4.3 对外 API 100% 兼容

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

### 4.4 step 映射规则

项目原有 API 用 `step ∈ {0, 1, 2}` 表示学习阶段；ts-fsrs 用 `learning_steps` 索引（`0` / `1` / `2`）表示**当前所在步骤**。两者语义不同，适配层做显式映射：

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

### 4.5 学习步骤配置

学习步骤配置为 `['1m', '10m', '10m']`（3 步分钟级），与原 `step=0/1/2` 毕业语义匹配：

| 操作序列 | 项目状态 | 项目 step | ts-fsrs ls |
|----------|----------|-----------|------------|
| New+Good | Learning | 0 | 1 |
| Learning+Good (1st) | Learning | 1 | 2 |
| Learning+Good (2nd) | **Review**（毕业）| 2 | 0 |
| Learning+Again | Learning | 0 | 0 |

第 3 个 step 是 noop，触发毕业条件（与原实现行为一致）。

### 4.6 ts-fsrs 5.4.1 关键 API 用法

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

### 4.7 升级带来的实际收益

| 收益 | 说明 |
|------|------|
| **调度准确度** | DSR 模型（stability / difficulty / retrievability）比 SM-2 准确度高 20-30% |
| **Anki 互通** | 与 Anki FSRS 插件使用同一算法，本项目卡片可导出到 Anki |
| **0 依赖** | ts-fsrs 不依赖任何第三方库，包体积 < 30KB |
| **活跃维护** | open-spaced-repetition 团队持续迭代，bug 修复及时 |
| **预览能力** | `repeat()` 一次返回 4 种评分 → 可实现"评分前展示未来间隔" |
| **遗忘曲线** | 完整实现 `(1 + factor·t/9S)^decay`，可精细化分析用户记忆 |
| **类型安全** | 100% TypeScript，完整 `.d.ts` 类型定义 |

### 4.8 测试覆盖

升级后 38 个 FSRS 引擎单元测试（vitest），分两类：

1. **原有 18 个冒烟测试** —— 100% 保持通过（API 兼容验证）
2. **新增 20 个适配层测试** —— 验证与 ts-fsrs 5.4.1 的正确集成
   - 枚举映射（CardState / Rating 与 ts-fsrs 一致）
   - step 映射规则（toFsrsCard / fromFsrsCard 双向）
   - 算法真的来自 ts-fsrs（与独立 ts-fsrs 调用对比）
   - 21 元素默认 weights 兼容
   - `repeat()` 预览能力验证
   - 批量复习独立性

---

## 五、目录结构

```
zhixing-reader/
├── electron/              # Main 进程：DB、IPC、AI、FSRS、WeChat Read API
│   ├── main.ts            # 入口
│   ├── preload.ts         # contextBridge API
│   ├── ipc.ts             # IPC handlers
│   ├── database.ts        # sql.js DB
│   ├── fsrs-engine.ts     # ⭐ FSRS v5 适配层（基于 ts-fsrs 5.4.1）
│   ├── agent/             # AI 智能体
│   └── services/          # 业务服务
├── src/renderer/          # Renderer 进程（React）
│   └── src/
│       ├── pages/         # 路由页面
│       ├── features/      # 业务模块
│       ├── components/    # UI 组件
│       └── stores/        # Zustand stores
├── shared/                # 跨进程共享
├── resources/             # 静态资源
├── tests/                 # Vitest 单元测试
├── docs/                  # 设计文档 + 调研
├── AGENTS.md              # AI Agent 入口
├── CLAUDE.md              # Claude Code 专属
└── package.json
```

---

## 六、开发与构建

```bash
# 安装依赖（使用 npmmirror 镜像）
npm install

# 开发模式（Vite 端口 5176 + Electron 自动开）
npm run dev

# 质量门禁（提交前必跑）
npm run lint            # ESLint
npm run typecheck       # tsc --noEmit
npm run test            # Vitest（含覆盖率）
npm run build           # 三进程编译
npm run verify          # 一键跑上面四项

# 打包 Windows NSIS 安装包
npm run package:win

# 词典（仅开发者）
npm run build-dict      # 从 ecdict.db 重新提取 dictionary.json
```

**提交顺序**：`lint` → `typecheck` → `test` → `build`（**全绿才可提交**）。

---

## 七、相关链接

| 资源 | 链接 |
|------|------|
| ts-fsrs（官方）| https://github.com/open-spaced-repetition/ts-fsrs |
| FSRS 算法论文 | https://github.com/open-spaced-repetition/fsrs4anki |
| Anki FSRS 插件 | https://docs.ankiweb.net/deck-options.html#fsrs |
| 调研报告 | [docs/research/2026-07-20-opensource-integration-research.md](docs/research/2026-07-20-opensource-integration-research.md) |
| Agent 协作规范 | [AGENTS.md](AGENTS.md) |
| Claude Code 配置 | [CLAUDE.md](CLAUDE.md) |

---

## 八、变更记录

| 日期 | 版本 | 变更 | 作者 |
|------|------|------|------|
| 2026-07-20 | v1.0.0 | 知行读书 v1.0.0 首发 | AI Agent |
| 2026-07-20 | v1.1.0 | **FSRS 引擎升级到 ts-fsrs 5.4.1 (FSRS v5 DSR)** | AI Agent |
| 2026-07-20 | v1.2.0 | **AdminDashboard 切到 Apache ECharts 5.5.1（按需引入）** | AI Agent |

---

## 九、图表库架构

项目按场景使用两套图表库，各取所长：

### 9.1 双库选型

| 场景 | 库 | 包体积 | 渲染 | 理由 |
|------|----|--------|------|------|
| **AdminDashboard** | Apache ECharts 5.5.1 + echarts-for-react 3.0.2 | 业务 chunk ~ **20KB** + vendor ~ 2.5MB（仅在打开 /admin 时加载）| Canvas | 6 个图表、类型多样、Canvas 性能高 |
| **Stats 页** | Recharts 3.8.1 | ~ 200KB | SVG | 简单柱/线/饼图够用，组件少不值得切 |

> **关键策略**：AdminDashboard 是 `lazy()` 路由，访问前不下载。ECharts vendor chunk 仅在用户进入 `/admin` 时才请求，主入口体积不受影响。

### 9.2 ECharts 按需引入

```ts
// src/renderer/src/admin-charts.tsx
import * as echarts from 'echarts/core'
import { BarChart, GaugeChart, PieChart } from 'echarts/charts'      // 只引 3 个
import { DatasetComponent, GridComponent, LegendComponent, /* ... */ } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'

echarts.use([BarChart, GaugeChart, PieChart, /* ... components */, CanvasRenderer])
```

**只引入 3 个图表类型 + 7 个组件**，不引 `line / scatter / heatmap / radar` 等无关图表，vendor chunk 比全量小 ~40%。

### 9.3 Tailwind 主题映射

`src/renderer/src/echarts-theme-tailwind.ts` 将 ECharts 主题与 Tailwind 设计系统对齐：

- 主色：`#10b981`（emerald-500）
- 辅助：`#34d399` / `#6ee7b7` / `#a7f3d0`（emerald-400/300/200）
- 文本：`#1f2937`（gray-800）/ `#6b7280`（gray-500）/ `#9ca3af`（gray-400）
- 网格：虚线 `#f3f4f6`（gray-100）
- Tooltip：深色卡片 `rgba(31,41,55,0.95)`

注册一次（`registerTailwindTheme()`），6 个图表共享同一套色系与排版。

### 9.4 6 个图表组件

| # | 组件 | 类型 | 数据 |
|---|------|------|------|
| 1 | `ProviderPieChart` | 环形图 | `providers[].total_tokens` |
| 2 | `ModelBarChart` | 水平柱图 | `providers[].total_tokens`（Top 10）|
| 3 | `FeatureBarChart` | 垂直柱图（双 Y 轴）| `features[].total_tokens + request_count` |
| 4 | `RequestPieChart` | 环形图 | `features[].request_count` |
| 5 | `TokensGauge` | 仪表盘 | `stats.totalTokens` / 5M 容量 |
| 6 | `ProviderTokenBarChart` | 分组堆叠柱图 | `providers[].total_input_tokens + total_output_tokens` |

### 9.5 分包策略（Vite manualChunks）

`electron.vite.config.ts` 显式切分大依赖：

```ts
output: {
  manualChunks(id) {
    if (id.includes('echarts') || id.includes('zrender')) return 'echarts-vendor'
    if (id.includes('recharts') || id.includes('d3-')) return 'recharts-vendor'
    if (id.includes('sql.js')) return 'sqljs-vendor'
  }
}
```

效果：

| Chunk | 旧（Recharts） | 新（ECharts） |
|-------|---------------|--------------|
| AdminDashboard（业务）| ~ **862KB** | **~ 20KB**（-97.7%）|
| 主入口（index）| 不变 | 不变 |
| echarts-vendor | — | 2.5MB（仅在打开 /admin 时按需加载）|

### 9.6 文件结构

```
src/renderer/src/
├── echarts-theme-tailwind.ts   # Tailwind 主题（色系、排版、组件默认值）
├── admin-charts.tsx             # 6 个图表组件 + ECharts 模块注册
└── pages/admin/
    └── AdminDashboard.tsx       # 数据加载 + 6 个图表组合（业务逻辑）
```

---

*最后更新：2026-07-20*
