# 知行读书 — PPT 演示脚本

## 第 1 页：封面
**标题**：知行读书 — AI 驱动的阅读成长智能体
**副标题**：把微信读书划线变成知识资产的桌面应用
**底部信息**：
- 作者：张子涵
- 赛事：火山杯 2026
- 版本：v1.0.0

---

## 第 2 页：痛点与机会
**标题**：阅读成长的三个断层
**内容**：
1. **读完就忘**：划线散落在微信读书里， never 变成可复习的知识
2. **工具孤岛**：笔记、卡片、复习、AI 对话分别在不同 App，无法联动
3. **算法黑箱**：Anki 强大但难以上手，普通用户不知如何调度复习

**我们的答案**：一条主线打通「同步 → 理解 → 复习 → 卡片化 → 英语学习」

---

## 第 3 页：产品定位
**标题**：知行读书是什么？
**一句话**：AI 驱动的阅读成长智能体，本地优先的 Electron 桌面应用
**核心闭环**：
```
微信读书同步 → AI 智能体理解 → FSRS v5 科学复习 → 知识卡片体系化 → 英语学习
```
**关键词**：本地优先、数据归属用户、MIT 开源

---

## 第 4 页：六大核心能力
**标题**：六大能力，构建阅读成长闭环

| 能力 | 一句话描述 | 技术亮点 |
|------|-----------|---------|
| 微信读书同步 | 一键拉取书架、划线、笔记 | 增量合并、离线可用 |
| AI 智能体对话 | 5 维上下文，费曼教学/深度提问 | Vercel AI SDK、流式响应 |
| FSRS v5 间隔重复 | Anki 同源算法，科学调度 | ts-fsrs 5.4.1、21 参数 |
| 知识卡片体系 | 概念卡/方法论卡/金句卡 | AI 蒸馏、反向链接、掌握度评估 |
| 英语词汇学习 | ~8 万词频词典、上下文例句 | SM-2 混合调度 |
| 统计可视化 | ECharts 5.5 仪表盘 | Canvas 渲染、6 图表 |

---

## 第 5 页：AI 智能体深度解析
**标题**：不只是聊天，是苏格拉底式的阅读伙伴
**核心创新**：
1. **5 维上下文构建**：书籍上下文 / 知识卡片 / 记忆 / 方法论 / 用户画像
2. **意图分类引擎**：自动识别教学、答疑、深度讨论等意图
3. **策略选择器**：根据意图切换 Prompt 与检索策略
4. **流式输出**：Vercel AI SDK `streamText`，实时打字效果
5. **思考过程可见**：DeepSeek R1 reasoning_content 实时展示

**演示要点**：输入"请用费曼学习法教我这本书中最核心的概念"，观察 AI 如何引用用户真实划线

---

## 第 6 页：FSRS v5 算法解析
**标题**：Anki 同源算法，科学对抗遗忘
**为什么是 FSRS v5**：
- 自实现 SM-2 → 升级为 open-spaced-repetition 官方算法
- 21 个参数（含 decay / factor），完整 DSR 遗忘曲线
- 与 Anki 数据互通，未来可迁移

**技术实现**：
- 引擎：`ts-fsrs@5.4.1`
- 调度：`repeat()` 一次返回 4 种评分结果（Again / Hard / Good / Easy）
- 持久化：sql.js (WASM)，本地存储

---

## 第 7 页：知识卡片蒸馏
**标题**：把零散划线变成体系化知识资产
**三类卡片**：
1. **概念卡**：核心概念定义、比喻、记忆口诀
2. **方法论卡**：思维模型、操作流程、检查清单
3. **金句卡**：原文摘录、个人感悟、行动指令

**AI 蒸馏流程**：
```
用户划线 → 意图识别 → AI 提炼 → 卡片生成 → FSRS 调度复习
```

---

## 第 8 页：技术架构
**标题**：现代桌面技术栈，工程化品质
**三层架构**：
- **Main 进程**：IPC 注册、数据库、AI 服务、向量索引
- **Preload 进程**：contextBridge 安全桥接、事件转发
- **Renderer 进程**：React 19 + Zustand 5 + Tailwind 4

**核心依赖**：
| 层 | 技术 |
|----|------|
| 桌面壳 | Electron 35 |
| 前端 | React 19 + TypeScript 5.6 |
| 样式 | Tailwind CSS 4 |
| 状态 | Zustand 5 |
| 数据库 | sql.js 1.14 (WASM) |
| 间隔重复 | ts-fsrs 5.4.1 |
| AI | Vercel AI SDK |
| 图表 | ECharts 5.5.1 + Recharts 3.8 |
| 测试 | Vitest 2 + Playwright |
| 打包 | electron-builder 25 |

---

## 第 9 页：工程质量
**标题**：667 测试用例，0 Lint Errors，91.99% AI 模块覆盖率
**数据说话**：
- 单元测试：**667** passing
- Lint：**0** errors / **0** warnings
- AI 模块覆盖率：**91.99%** lines / **95.83%** functions
- Windows 安装包：**125.5 MB** (NSIS)
- 开源许可证：**MIT**

**工程规范**：
- TypeScript strict 模式，0 `any` 原则
- ESLint 9 + 分级策略（complexity ≤15 error，max-lines warn）
- Vitest coverage 门禁 ≥85%
- electron-vite 构建，HMR 热更新

---

## 第 10 页：数据隐私与安全
**标题**：本地优先，数据永远属于你自己
**安全承诺**：
1. **本地存储**：sql.js WASM，数据在 %APPDATA%/zhixing-reader/
2. **无追踪 SDK**：不采集任何用户行为数据
3. **MIT 开源**：代码完全透明，可审计
4. **Electron 安全**：nodeIntegration: false，contextIsolation: true
5. **API Key 加密**：safeStorage 加密存储微信读书与 AI 密钥

---

## 第 11 页：演示与下载
**标题**：立即开始你的知行之旅
**下载信息**：
- 平台：Windows 10 x64+
- 文件：ZhixingReader-Setup-1.0.0.exe
- 大小：125.5 MB
- 协议：MIT（商用/修改/分发自由）

**开源地址**：
- GitHub：https://github.com/harryopo/zhixing-reader
- Issues：https://github.com/harryopo/zhixing-reader/issues
- Release：https://github.com/harryopo/zhixing-reader/releases/tag/v1.0.0

---

## 第 12 页：致谢与 Q&A
**标题**：感谢聆听
**内容**：
- 项目地址：github.com/harryopo/zhixing-reader
- 作者：张子涵
- 赛事：火山杯 2026

**Q&A**
