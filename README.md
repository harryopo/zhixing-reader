<p align="center"><img src="resources/icon.png" alt="知行读书" width="104" height="104"></p>

# 知行读书 (Zhixing Reader)

> **AI 驱动的阅读成长智能体** · Electron 桌面应用 · Anki 同源 FSRS-6.0 · 微信读书深度同步
>
> **v1.3.4** | 2026-09-23 | [📦 下载安装包](https://github.com/harryopo/zhixing-reader/releases) | [🌐 项目主页](https://harryopo.github.io/zhixing-reader)

[![Version](https://img.shields.io/badge/version-1.3.4-8b5cf6)](https://github.com/harryopo/zhixing-reader/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow)](./LICENSE)
[![Electron](https://img.shields.io/badge/Electron-35-47848F?logo=electron)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.6-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![FSRS](https://img.shields.io/badge/FSRS--6.0%20(DSR)-00C853)](https://github.com/open-spaced-repetition/ts-fsrs)
[![Tests](https://img.shields.io/badge/tests-1285%20%E7%94%A8%E4%BE%8B%20/%2085%20%E6%96%87%E4%BB%B6-22c55e)](./tests)
[![CI](https://github.com/harryopo/zhixing-reader/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/harryopo/zhixing-reader/actions/workflows/ci.yml?query=branch%3Amaster)
[![Lines](https://img.shields.io/badge/code-53%2C800%2B%20TS-blueviolet)]()

---

## 一、项目简介

**知行读书**是一款面向阅读成长场景的桌面应用，把「**微信读书同步 → AI 智能体理解 → 科学间隔复习 → 知识卡片体系化 → 英语学习**」完整闭环装进本地优先的 Electron 容器。

围绕"读了就忘、笔记散乱、想问无门、知道做不到"四大阅读痛点，给出**16 大功能模块 + 5 大核心创新**的完整解决方案。

> **面向所有阅读者，帮每一位读者构建起属于自己的自我成长型系统。**

| 维度 | 详情 |
|------|------|
| **形态** | Electron 三进程桌面应用（Main / Preload / Renderer）|
| **代码规模** | 约 5.7 万行 TypeScript strict（`electron/` + `src/` 下跟踪的 `.ts`/`.tsx`，由 `tests/doc-figures.test.ts` 现算对账）|
| **测试** | 1285 用例 / 85 文件（`npm run test`，**不含覆盖率**）· 覆盖率门禁是另一条命令 `npm run test:cov`，阈值 lines 83 / branches 80 / functions 75 / statements 83，**只作用于 `vitest.config.ts` 的 include 清单（实测 56 个文件），不是全库覆盖率**；CI 从 2026-09-24 起跑的就是这条命令，阈值不过则流水线红 |
| **存储** | sql.js (SQLite WASM) · 17 张表 · 本地 BM25 检索索引（内存构建，不落盘）|
| **核心能力** | 微信读书同步 · **FSRS-6.0** 间隔重复 · AI 智能体 · 知识卡片 · 词汇学习 |
| **算法** | **ts-fsrs@5.4.1**（open-spaced-repetition 官方，Anki 同源）|
| **打包** | electron-builder → Windows NSIS 安装包（v1.3.4 实测 **113.7 MB** / 119,246,768 字节）|
| **License** | MIT（自由使用 / 修改 / 商用）|

---

## 二、5 大核心创新

> **知行读书如何把"读了就忘、笔记散乱、想问无门、知道做不到"四大阅读痛点，打成"读→记→懂→用"完整闭环？**

| # | 创新点 | 一句话 | 关键指标 |
|---|--------|--------|----------|
| **1** | **方法论自动注入 Agent**（行业首创） | AI 回答时自动引用书中方法论，实时追踪掌握度 | mastery_level 追踪 |
| **2** | **5 维 ContextBuilder**（预算制懒加载） | 书籍/方法论/卡片/记忆/画像 5 维按需注入，超预算跳过后面的维度 | 上下文硬上限 4000 token（`MAX_CONTEXT_TOKENS`，按 2 字符≈1 token 估算）|
| **3** | **FSRS-6.0 同源科学记忆引擎** | 集成 ts-fsrs 5.4.1（该版本实现的即 **FSRS-6.0**，Anki 24.06+ 同源），DSR 三变量模型 | 目标保持率 0.9 可配置；对 SM-2 的优势见 [FSRS 基准测试](https://github.com/open-spaced-repetition/fsrs4anki/wiki/The-Algorithm)（**非本项目实测**）|
| **4** | **本地优先架构 · 数据主权还给用户** | sql.js + 本地检索 + safeStorage 三重本地化，零遥测 | AI 直连不过中转 |
| **5** | **多模型深度思考归一化 + ECDICT 离线词典** | DeepSeek / OpenAI / Anthropic 推理格式统一 + 15.0MB 离线词典 | 多模型无感切换 / 59,118 词条 |

### 5 维 ContextBuilder 实际取数量（以代码为准）

| 优先级 | 构建器 | 取数方式 | 单次上限 |
|--------|--------|----------|----------|
| 90 | 书籍内容 | 本地 BM25 检索（中文 2 字滑窗）命中用户自己的划线；选了书只搜那本书，没选书搜全部 | 命中 3 条 |
| 80 | 方法论 | 同一套 BM25 按相关性取 | 命中 5 条 |
| 70 | 知识卡片 | 同一套 BM25 按相关性取；一条都没命中就不注入 | 命中 10 条 |
| 50 | 长期记忆 | 相关记忆 + 摘要 | 3 条 |
| 40 | 用户画像 | 动态生成；空白资料不注入 | 单字段超 200 字截断 |

**总量与三条硬规则**（`electron/agent/context-manager.ts`）：五维合起来上限 `MAX_CONTEXT_TOKENS = 4000`，按 `CHARS_PER_TOKEN = 2` 估算。① 预算用完直接跳过后面的构建器；② 允许最后一个构建器部分截断，并显式标记 `...(已截断)`；③ 单个构建器失败不拖垮整体（fail-soft）。

> 早期版本这张表的"每维 Token 预算 1500/1000/800/500/200"是设计稿数字，代码里从未按维度分配过预算——只有上面这一条全局上限。2026-09-23 按代码实测改正。

---

## 三、16 大功能模块

| # | 模块 | 路由 | 核心能力 |
|---|------|------|----------|
| 1 | 主页 | `/` | 继续阅读 + 最新划线/笔记 + 复习队列 |
| 2 | 书架 | `/bookshelf` | 微信读书同步 + 阅读进度 |
| 3 | 书籍详情 | `/bookshelf/:id` | 笔记/卡片/方法论/讨论 多 Tab |
| 4 | 间隔复习 | `/review` | 划线原文做卡面 + FSRS 四级评分与间隔预览 + 键盘快捷键 |
| 5 | 笔记 | `/notes` | 全书笔记检索 + 高亮原文 + Markdown 导出 |
| 6 | AI 对话 | `/chat` | 多会话 + 流式 + 深度思考 + 方法论注入 + RAG 溯源 |
| 7 | 方法论 | `/methodologies` | 独立方法论管理 + 掌握度追踪 + 一键导出为 Skill |
| 8 | 知识卡片 | `/knowledge-cards` | 卡片体系化管理 + 语境化知识提取 |
| 9 | 每日学习 | `/daily-learning` | 英文外刊 + AI 翻译对照 + 悬停查词 |
| 10 | 生词本 | `/vocabulary` | ECDICT 查询 + 学习阶段 + CSV/Anki 导出 |
| 11 | 数据统计 | `/stats` | 阅读趋势 + 学习热力图 + 12 周复习可视化 |
| 12 | Token 监控 | `/token-usage` | 服务商/功能双维用量 + 成本核算 |
| 13 | 个人中心 | `/profile` | 阅读画像 + 微信读书资料继承 |
| 14 | 设置 | `/settings` | AI 多服务商热切换 + 数据导入导出 |
| 15 | 智能体编排 | `/settings/agent` | 六步流水线可视化 + 意图/策略矩阵 + 提示词模板（设置子页） |
| 16 | 划线检索 | 设置/对话内 | 本地 BM25 检索（零依赖零网络）+ 引用来源溯源 |

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

步骤 ①-⑤ 全部在本地完成，不产生任何网络请求（第九节给了各步口径；这几步没有单独计时）。用户感知上"回车之后就开始出字"，中间等待的是服务商的首 token 时间。

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
| **构建工具** | electron-vite | 5.x | Vite 6 + HMR，三进程并行开发 |
| **UI 框架** | React | 19.x | Concurrent Mode、Suspense、自动批处理 |
| **路由** | React Router | 7.x | 嵌套路由 + Data Router |
| **类型** | TypeScript | 5.6 strict | 56,371 行 strict 模式（2026-09-25 实测）|
| **样式** | Tailwind CSS | 4.x | 原子化 CSS + PostCSS + 设计 Token |
| **状态** | Zustand | 5.x | 轻量（< 3KB）、hooks-first |
| **数据库** | sql.js | 1.14 | SQLite WASM，跨平台一致 |
| **检索** | 自研 BM25 | - | 纯 TS 倒排索引 + 中文 2 字滑窗，零依赖零网络 |
| **间隔重复** | **ts-fsrs** | **5.4.1** | **FSRS-6.0 DSR（21 组权重），与 Anki 24.06+ 同源** |
| **AI SDK** | Vercel AI SDK + 自研 SSE | 7.x | 多服务商统一接口 + 流式 + 深度思考归一化 |
| **AI 服务商** | 火山引擎 / DeepSeek / OpenAI / Anthropic / Moonshot | - | 热切换，Key 本地加密 |
| **图表** | ECharts / Recharts | 5.5 / 3.8 | 复杂 / 简单场景分用 |
| **加密** | Electron safeStorage | 内置 | OS 系统级加密（DPAPI / Keychain）|
| **测试** | Vitest | 3.x | 1285 用例 / 85 文件，阈值见 `vitest.config.ts` |
| **打包** | electron-builder | 26.x | Windows NSIS 安装包 |
| **词典** | ECDICT | 自建 | 15.0MB JSON，59,118 词条，CEFR 分级 |

---

## 六、系统架构

**五层架构**：Renderer（React SPA）→ Preload（contextBridge 安全桥）→ IPC（`electron/ipc/` 11 个领域 handler + `index.ts` 统一注册 + `types.ts` 契约，共 **143 条通道**）→ Service/Agent（RAG / FSRS / 智能体编排）→ Data（sql.js 17 张表 + safeStorage）。

**跨进程类型只有一份**：所有 IPC 通道名收在 `src/shared/ipc-channels.ts`（写死字面量会被 `tests/ipc-channels.test.ts` 判红）；数据库行的 snake_case → 前端 camelCase 只过一次 `src/renderer/src/utils/db-mapper.ts`，页面直接 `as unknown as` 硬转行类型会被 `tests/db-row-types.test.ts` 判红。

**Agent 编排**：六步流水线 = 意图分类 → 策略选择 → 难度适配 → 5 维上下文构建 → 提示组装 → 流式生成。

---

## 七、FSRS-6.0 算法集成

知行读书集成了 **ts-fsrs 5.4.1**（open-spaced-repetition 官方库）。该版本实现的算法是 **FSRS-6.0**，与 Anki 24.06+ 同源。模型基于 **21 组权重参数** 和 **DSR 三变量模型**（Stability 稳定性 / Difficulty 难度 / Retrievability 可提取性），通过遗忘曲线 `R(t, S) = (1 + factor·t/S)^decay` 预测记忆保持率，其中 `decay = -w[20] = -0.1542`、`factor = 0.9^(1/decay) − 1 ≈ 0.9805`（满足 `R(t = S) = 0.9`）。

> ⚠️ 早期版本的本节曾写作「FSRS v5 / 19 组权重参数」，并引用 FSRS-4.5 时代的公式 `(1 + factor·t/9S)^decay`。经对 `node_modules/ts-fsrs` 实测核验，该库导出的为 `FSRS-6.0`、`default_w` 长度 21、`FSRS6_DEFAULT_DECAY = 0.1542`，故于 2026-09-11 校正。

**核心能力**：

| 能力 | 说明 |
|------|------|
| **4 评分预览** | `repeat()` 一次返回 Again/Hard/Good/Easy 四种结果，用户可在评分前查看未来间隔 |
| **Anki 数据互通** | 与 Anki FSRS 插件同一算法、同一 schema，卡片可互相导入导出 |
| **0 依赖 < 30KB** | 纯 TypeScript 实现，无第三方依赖，包体积极小 |
| **API 100% 兼容** | 内部算法替换为 ts-fsrs，对外接口零变更，原有调用方无需修改 |

项目实现了完整的适配层（`electron/fsrs-engine.ts`），包括 Card ↔ FsrsCard 双向转换、step 学习阶段映射、枚举对齐等，确保与 ts-fsrs 正确集成的同时保持对外 API 稳定。

**划线卡片与词汇学习共用同一个 ts-fsrs 实例**：两条复习路径都由 FSRS-6.0 调度，记忆状态（stability / difficulty / lapses）持久化后逐次累积。该文件现有 **45 个单元测试** 覆盖，含"词汇间隔必须随复习增长"的回归用例。

---

## 八、目录结构

```
zhixing-reader/
├── electron/                                # Main 进程
│   ├── main.ts                              # 入口
│   ├── preload.ts                           # contextBridge 安全桥（每条 invoke 都有 handle，由 tests/ipc-channel-wiring.test.ts 钉住）
│   ├── ipc/                                 # IPC handlers（按领域 11 文件 + index 注册 + types 契约）
│   ├── database/                            # sql.js DB（按领域 16 文件 + index / schema / connection）
│   ├── fsrs-engine.ts                       # ⭐ FSRS-6.0 适配层（ts-fsrs 5.4.1）
│   ├── ai-service.ts                        # AI 卡片/摘要（仅剩 2 个 JSON 型功能）
│   ├── ai-sdk-service.ts                    # AI 流式 + 已迁的非流式
│   ├── weread-api.ts                        # 微信读书 Skill API
│   ├── weread-sync-manager.ts               # 同步管理
│   ├── agent/                               # ⭐ AI Agent 编排
│   │   ├── orchestrator.ts                  # 六步流水线主控
│   │   ├── context-manager.ts               # 5 维构建器协调
│   │   ├── intent-classifier.ts             # 4 类意图分类
│   │   ├── strategy-selector.ts             # 教学策略
│   │   ├── state-tracker.ts                 # Bloom 状态机
│   │   ├── system-prompt.ts                 # 4 段动态拼装
│   │   └── builders/                        # 5 个 ContextBuilder
│   ├── repositories/                        # 仓储层
│   ├── services/                            # 业务服务（RAG / 记忆 / 知识卡片 / 启动修复）
│   └── types/                               # 实体类型
├── src/renderer/                            # Renderer 进程（React）
│   └── src/
│       ├── pages/                           # 14 个页面文件 / 22 条路由（巨型页拆到 pages/<page>/ 子目录）
│       ├── components/                      # UI 组件
│       ├── stores/                          # 6 个 Zustand Store
│       ├── utils/db-mapper.ts               # ⭐ 数据库行 → 前端对象的唯一一处转换
│       ├── admin-charts.tsx                 # ECharts 6 图
│       └── echarts-theme-tailwind.ts        # 主题映射
├── src/shared/                              # 跨进程共享（类型 + 163 条 IPC 通道常量 + 纯函数）
├── tokens/brand.json                        # 全部色值的唯一真值（产物由 npm run build:tokens 生成）
├── brand/                                   # 徽标唯一真值（mark*.svg / wordmark / logo-horizontal）
├── scripts/                                 # 构建期脚本（build-tokens / build-icons）
├── tests/                                   # Vitest 单元测试（1285 用例 / 85 文件）
├── .github/
│   ├── workflows/ci.yml                     # lint + typecheck + test:cov + build（windows-latest）
│   └── ISSUE_TEMPLATE/                      # Bug / 功能建议 / 环境与构建 三类模板
├── resources/
│   ├── dictionary.json                      # ECDICT 15.0MB / 59,118 词条
│   ├── icon.ico / icon.png
├── landing/                                 # 宣传页源码（部署到 gh-pages 分支）
├── .gitattributes                           # 检出统一 LF（逐字节比对的产物依赖它）
├── AGENTS.md                                # AI Agent 入口
├── CLAUDE.md                                # AI 辅助开发配置
├── CHANGELOG.md
├── CONTRIBUTING.md
├── CODE_OF_CONDUCT.md
├── FAQ.md
├── LICENSE                                  # MIT
├── PRIVACY.md
├── SECURITY.md                              # 安全问题走私享渠道，不公开提
└── README.md
```

---

## 九、性能画像

> **口径先说清**：下表只有标「实测」的两行是这台机器上量出来的；其余是开发过程中的**本机单次观察量级，不是基准测试**（没有多次采样、没有统计分布、没有换机复现）。需要拿数字做承诺的，按第十四节命令自己跑一遍。

| 指标 | 数值 | 口径 |
|------|------|------|
| 检索索引语料规模 | 934 条划线 → **15,927 词项** | **实测**（本机开发库，`src/shared/retrieval.ts` 建索引后计数）|
| 检索命中（真实提问） | 「作者怎么看人际关系」命中 **5 条 / topScore 17.2**，`promptTokens` 358 → 1252 | **实测**（打包后的应用 + 真实数据 + 一次真实提问，2026-09-16）|
| 冷启动 → 主页可交互 | < 1.0s | 未做基准，开发期观察 |
| 路由懒加载 | 约 80ms/页 | 未做基准 |
| 词典首次加载（15.0MB JSON → 内存） | 约 150ms | 未做基准 |
| 检索索引首次构建 | 200-500ms | 未做基准，随划线条数线性变化 |
| 意图分类 + 策略选择 + 难度适配 | 各 < 5ms | 纯本地字符串/状态机计算，未单独计时 |
| 5 维上下文构建 | 50-200ms | 未做基准（含本地检索）|
| AI 流式首 token | 500-2000ms | 完全取决于所选服务商与网络，本项目不控制 |
| 后续 token 速率 | 30-80 token/s | 同上 |

---

## 十、本地优先与安全合规

| 数据类别 | 存储位置 | 是否离开本机 |
|----------|----------|--------------|
| 用户输入（消息/笔记/评分） | 本地 SQLite | ❌ 否 |
| 微信读书同步数据 | 本地 SQLite | ❌ 否 |
| AI 请求上下文 | 发送至用户自选的 AI 服务商 | ✅ 仅此一项，**直连不过中转** |
| 系统生成（卡片/方法论/记忆） | 本地 SQLite | ❌ 否 |
| 检索索引 | 内存构建，不落盘 | ❌ 否 |
| API Key | safeStorage 加密 | ❌ 否 |

**离线可用场景**：除"微信读书同步"和"AI 对话"外，复习 / 笔记 / 卡片 / 词典 / 生词本全部离线可用。

**零遥测** —— 项目不含任何分析 / 追踪 / 广告 SDK，不向任何第三方服务器发送用户数据。

**Electron safeStorage 系统级加密**：Windows DPAPI / macOS Keychain / Linux libsecret。

**合规性**：遵循微信读书开放平台使用条款，符合《个人信息保护法》相关规定——用户数据全部本地存储，AI 请求仅发送用户自选服务商，零遥测零埋点。

---

## 十一、快速开始

1. **下载安装** — 从 [GitHub Releases](https://github.com/harryopo/zhixing-reader/releases) 下载 `zhixing-reader-Setup-1.3.4.exe`（Windows），或安装后由应用内自动更新
2. **配置 AI** — 设置页选择 AI 服务商（火山引擎 / DeepSeek / OpenAI / Anthropic / Moonshot），填入 API Key
3. **连接微信读书** — 设置页填入微信读书 API Key，同步书架与划线数据
4. **开始使用** — 浏览书架、AI 对话、知识卡片复习、每日英语学习

> 除 AI 对话和微信读书同步需联网外，其余功能全部离线可用。
>
> **数据位置**：书架、划线、复习记录与设置全部存在本机 `%APPDATA%\zhixing-reader\`（与安装位置无关，升级和重装都不会动它）；`npm run dev` 跑起来的是另一份 `%APPDATA%\zhixing-reader-dev\`，两边互不覆盖。

---

## 十二、已知限制（v1.3.4）

> 这一节只列**当前真实存在**的限制；正在办的会带上 Issue 编号，做完了会删行，不会留着占位。完整在办事项见 [Issues](https://github.com/harryopo/zhixing-reader/issues)。

| 限制 | 事实 | 影响与替代做法 |
|------|------|----------------|
| 只出 Windows 安装包 | `electron-builder` 只配了 NSIS 目标，没有 macOS / Linux 的打包与签名配置（[#5](https://github.com/harryopo/zhixing-reader/issues/5)）| 其他平台目前从源码跑：`npm install && npm run build && npm run start` |
| 应用内更新的「重启安装」尚未跑通一轮完整真人验证 | 2026-09-21 实跑时卡在安装器的「无法关闭」提示；退出顺序已在 09-22 改为「先同步落盘 → 再 `app.exit(0)`」，随 v1.3.4 发布，发布后还没有新的实跑记录（[#1](https://github.com/harryopo/zhixing-reader/issues/1)）| 若仍卡住：手动运行 `%LOCALAPPDATA%\zhixing-reader-updater\` 里已下载的安装包，数据在 `%APPDATA%`，不受影响 |
| 部分页面没有访问口令 | 「设置 → 智能体编排」是界面里的真入口，能改提示词模板；`/admin` 管理后台没有界面入口，但路由仍在应用包里（能打开 devtools 的人可以直接跳） | 桌面单机的前提假设；共用电脑时请留意（[#2](https://github.com/harryopo/zhixing-reader/issues/2) 在定方向） |
| 划线只保留原文、想法与章节名 | 微信读书同步落库的字段是 `content` / `note` / `chapter_title`，没有颜色与章节 id；「是划线还是笔记」由 `note` 是否为空推导 | 界面不显示高亮颜色；「笔记」页签要有想法类笔记才有内容 |
| AI 能力需要自备 API Key | Key 存本机：经系统加密（Windows DPAPI）写入 `secure/*.enc`，设置文件里不留明文；界面上也不回填原值，输入框留空表示"不修改" | 不填 Key 时同步、复习、词典、笔记全部照常可用；加密不可用时如实提示并退回明文保存（绝不会因此丢掉你已配置的 Key），想删除用设置页的「清除已保存的 Key」 |
| 词典为本地 ECDICT 单文件 | 15.0MB / 59,118 词条（实测 `resources/dictionary.json`），含 CEFR 分级，不含例句库 | 生词查询完全离线 |

## 十三、反馈问题

1. **用模板开 Issue** —— [New Issue](https://github.com/harryopo/zhixing-reader/issues/new/choose) 下拉里有三类：Bug 反馈 / 功能建议 / 环境与构建问题。带 `good first issue` 标签的欢迎直接认领。
2. **请一并给出**：版本号（设置 → 关于）、复现步骤、报错原文。
3. **日志位置**：`%APPDATA%\zhixing-reader\logs\`（开发模式是 `zhixing-reader-dev`）。日志落盘时已对 API Key 做脱敏，**贴出来之前仍请自查一遍**。
4. **涉及密钥、越权、注入等安全问题**：请按 [SECURITY.md](SECURITY.md) 的私享渠道联系，不要公开发在 Issue 里。

## 十四、开发与构建

```bash
# 安装依赖（使用 npmmirror 镜像）
npm install

# 开发模式（Vite 端口 5500 + Electron 自动开）
npm run dev

# 质量门禁（提交前必跑）
npm run lint            # ESLint
npm run typecheck       # tsc --noEmit（覆盖 electron / src / scripts / tests）
npm run test            # Vitest（npm run test = vitest run，不含覆盖率统计）
npm run build           # 三进程编译
npm run verify          # 一键跑 lint + typecheck + test:cov + build（提交前必跑）

# 覆盖率是另一条命令：只对 vitest.config.ts 的 include 清单（实测 56 个文件）统计
# CI 的测试步骤跑的就是它 —— 阈值不达标流水线直接红
npm run test:cov

# 打包 Windows NSIS 安装包
npm run package:win
# → 生成 installer/zhixing-reader-Setup-<version>.exe
```

> ⚠️ 原 `build-dict` / `seed:demo` / `loop:*` 共 6 个脚本已于 2026-09-11 移除 —— 它们指向的 `scripts/` 目录已不在仓库。词典请直接使用已提交的 `resources/dictionary.json`。

**提交顺序**：`lint` → `typecheck` → `test` → `build`（**全绿才可提交**）。

### ESLint 规则分级策略

| 规则级别 | 规则 | 说明 |
|----------|------|------|
| **warn** | `complexity` (≤15) | 函数圈复杂度提示（存量巨型文件豁免）|
| **error** | `max-params` (≤6) | 函数参数数量 |
| **error** | `prefer-const` + `eqeqeq` | 强制 const / 强制 === |
| **warn** | `max-lines` (≤500) | 单文件行数 |
| **warn** | `max-lines-per-function` (≤80) | 单函数行数 |
| **warn** | `max-depth` (≤4) | 嵌套深度 |

---

## 十五、相关链接

| 资源 | 链接 |
|------|------|
| 📦 安装包下载 | https://github.com/harryopo/zhixing-reader/releases |
| 🌐 项目主页 | https://harryopo.github.io/zhixing-reader |
| 🐛 Issue 反馈 | https://github.com/harryopo/zhixing-reader/issues |
| 📝 提 Issue（选模板） | https://github.com/harryopo/zhixing-reader/issues/new/choose |
| 🔒 安全漏洞上报 | [SECURITY.md](SECURITY.md) |
| 📝 更新日志 | [CHANGELOG.md](CHANGELOG.md) |
| ❓ 常见问题 | [FAQ.md](FAQ.md) |
| 🔒 隐私政策 | [PRIVACY.md](PRIVACY.md) |
| 🤝 贡献指南 | [CONTRIBUTING.md](CONTRIBUTING.md) |
| 📋 行为准则 | [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) |
| 📄 开源许可证 | [LICENSE](LICENSE) |
| 🤖 Agent 协作规范 | [AGENTS.md](AGENTS.md) |
| 🧠 AI 辅助开发配置 | [CLAUDE.md](CLAUDE.md) |

### 参考资源

| 资源 | 链接 |
|------|------|
| ts-fsrs（官方）| https://github.com/open-spaced-repetition/ts-fsrs |
| FSRS 算法论文 | https://github.com/open-spaced-repetition/fsrs4anki |
| Anki FSRS 插件 | https://docs.ankiweb.net/deck-options.html#fsrs |
| sql.js | https://github.com/sql-js/sql.js |
| Vercel AI SDK | https://sdk.vercel.ai/docs |
| Electron 安全 | https://www.electronjs.org/docs/latest/tutorial/security |
| ECDICT 词典 | https://github.com/skywind3000/ECDICT |

---

## 十六、变更记录

| 日期 | 版本 | 变更 | 作者 |
|------|------|------|------|
| 2026-09-23 | v1.3.4 | 应用内「重启安装」不再弹「无法关闭」（退出前先同步写盘再结束进程）+ 复习待办数不再把新卡算进去 + 书籍详情「笔记」页签恢复可筛 + 开发版与安装版数据目录分开 / 测试 1019 用例 | 张子涵 |
| 2026-09-21 | v1.3.3 | 检查更新失败时的提示改为可执行的中文说明（不再显示网络错误码），同一次失败只提示一次；「设置 → 关于」更新历史改为短句分条 / 测试 990 用例 | 张子涵 |
| 2026-09-21 | v1.3.2 | 统计页数据口径修正：趋势图与所选时间范围对齐（本周/本月按天、本年按月）+ 复习热力图改用本地日期 + 卡片总数与近 12 周复习次数分别标注 + 移除未接入计费数据的费用列 / 测试 985 用例 | 张子涵 |
| 2026-09-21 | v1.3.1 | 修复应用内更新提示不显示：状态可回读 + 顶栏「新版本」提示 + 每 6 小时重查；维持「只提示、不自动下载」/ 测试 974 用例 | 张子涵 |
| 2026-09-21 | v1.3.0 | 书籍层级摘要（L1 分章 → L2 全书）+ 摘要「只报不烧」提醒 / 模型分级路由 / 品牌 VIS（玉璧徽标 + 转曲字标 + brand.json 单一色值真值）/ 字体本地打包（离线可用）/ 界面数据接到真实存储 / 26 条未使用的 IPC 链路清理（通道 188→163）/ 测试 968 用例 | 张子涵 |
| 2026-09-17 | v1.2.0 | 应用内自动更新（electron-updater）/ 本地 BM25 检索替换向量链路 / 检索可视化 / 数据血缘四处断点修复 / 微信读书后台自动同步 / 每日新卡上限 / 测试 885 用例 | 张子涵 |
| 2026-08-28 | v1.1.0 | 维护迭代：间隔复习闭环 / Token 用量实时统计 / 档案画像注入 AI / 首页重构 / 导航与界面数据治理 / database·ipc 拆分 | 张子涵 |
| 2026-07-28 | v1.0.0 | 文档体系完善：技术白皮书（提交2/3）+ README 更新到核心亮点 + 15 大模块 | 张子涵 |
| 2026-07-25 | v1.0.0 | 首个正式版本（含 FSRS 间隔重复 / ECharts / 667 测试），安装包见 [Releases](https://github.com/harryopo/zhixing-reader/releases) | 张子涵 |

历史迭代明细见 [CHANGELOG.md](CHANGELOG.md)。

---

## 十七、贡献指南

我们欢迎任何形式的贡献：Bug 报告、功能建议、文档完善、代码修复、UI/UX 改进。

**快速参与**：

1. 📖 阅读 [CONTRIBUTING.md](CONTRIBUTING.md) 了解开发环境搭建、提交规范、PR 流程
2. 🤝 查看 [GitHub Issues](https://github.com/harryopo/zhixing-reader/issues) 中带 `good first issue` 标签的入门 Issue
3. ✅ 提交 PR 前请确保 `npm run verify` 全绿（lint / typecheck / **test:cov（含覆盖率阈值）** / build）
4. 📝 Commit message 遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 规范

**行为准则**：参与本项目即代表你同意遵守 [Code of Conduct](CODE_OF_CONDUCT.md)。请在所有交流中保持友善与尊重。

---

## 十八、开源许可证

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
| electron-builder | 26 | MIT |
| Vercel AI SDK | - | Apache-2.0 |

> 完整依赖许可证清单可通过 `npx license-checker --summary` 生成。

### 致谢

本项目站在巨人的肩膀上，特别感谢：

- [open-spaced-repetition/ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs) —— FSRS-6.0 算法的 TypeScript 实现（Anki 同源）
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

*最后更新：2026-09-25 | 与 master 分支代码一致（最新发布 v1.3.4，1285 用例 / 85 文件）*
