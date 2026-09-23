# 贡献指南

> 感谢你对知行读书项目的兴趣！本文档将帮助你快速上手参与项目贡献。

## 一、欢迎

知行读书是一款 AI 驱动的阅读成长智能体桌面应用，欢迎任何形式的贡献：

- 🐛 报告 Bug
- 💡 提出新功能建议
- 📝 完善文档
- 🔧 提交代码修复
- 🌍 翻译界面
- 🎨 改进 UI/UX

**无论贡献大小，我们都表示感谢。** 首次贡献者请优先查看带有 `good first issue` 标签的 Issue。

---

## 二、开发环境搭建

### 2.1 环境要求

| 工具 | 版本 | 说明 |
|------|------|------|
| **Node.js** | ≥ 20.0.0 | 推荐 LTS 版本 |
| **npm** | ≥ 10.0.0 | 随 Node 安装 |
| **Git** | ≥ 2.30 | 版本控制 |
| **操作系统** | Windows 10+ | 当前主要支持 Windows |

### 2.2 拉取代码并安装

```bash
# 1. Fork 仓库后克隆到你本地
git clone https://github.com/<你的用户名>/zhixing-reader.git
cd zhixing-reader

# 2. 添加上游仓库（用于同步主仓库更新）
git remote add upstream https://github.com/harryopo/zhixing-reader.git

# 3. 安装依赖（推荐使用 npmmirror 镜像加速）
npm install
```

### 2.3 启动开发模式

```bash
# 启动 Vite 开发服务器（端口 5500）+ Electron 主进程
npm run dev
```

应用窗口自动打开后，修改代码即可看到 HMR 热更新。

---

## 三、项目结构简介

```
zhixing-reader/
├── electron/              # Main 进程：数据库、IPC、AI、FSRS、微信读书 API
│   ├── main.ts            # 入口
│   ├── preload.ts         # contextBridge API（Renderer 桥）
│   ├── ipc/               # IPC handlers（按领域 12 文件，index.ts 统一注册）
│   ├── database/          # sql.js DB（按领域 16 文件，index.ts 统一出口）
│   ├── fsrs-engine.ts     # FSRS-6.0 适配层（基于 ts-fsrs 5.4.1）
│   ├── agent/             # AI 智能体（5 维上下文构建 + 编排）
│   ├── repositories/      # 数据访问层
│   └── services/          # 业务服务
├── src/renderer/          # Renderer 进程（React 19）
│   └── src/
│       ├── pages/         # 路由页面
│       ├── components/    # UI 组件
│       ├── stores/        # Zustand stores
│       ├── design/        # 设计系统
│       └── utils/         # 渲染层工具
├── src/shared/            # 跨进程共享类型与常量
├── resources/             # 静态资源（图标、词典）
├── tests/                 # Vitest 单元测试
├── docs/                  # 设计文档与调研报告
└── package.json
```

**三进程架构**：
- **Main**（`electron/`）：Node.js 环境，负责系统 API、数据库、AI 服务、微信读书同步
- **Preload**（`electron/preload.ts`）：通过 `contextBridge` 安全暴露 IPC API
- **Renderer**（`src/renderer/`）：浏览器环境，React UI

详细架构请阅读 [README.md](README.md) 与 [AGENTS.md](AGENTS.md)。

---

## 四、提交规范（Conventional Commits）

本项目遵循 [Conventional Commits](https://www.conventionalcommits.org/zh-hans/v1.0.0/) 规范。

提交信息由 husky `commit-msg` 钩子（commitlint config-conventional，header ≤ 120 字符）自动校验，不合格式的提交会被拒绝；`pre-commit` 同时跑 lint + typecheck + test。

### 4.1 Commit Message 格式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### 4.2 Type 取值

| Type | 含义 |
|------|------|
| `feat` | 新功能 |
| `fix` | Bug 修复 |
| `docs` | 文档变更 |
| `style` | 代码风格（不影响功能） |
| `refactor` | 重构（既不是 feat 也不是 fix） |
| `perf` | 性能优化 |
| `test` | 测试相关 |
| `build` | 构建系统或外部依赖变更 |
| `ci` | CI 配置变更 |
| `chore` | 杂项（不修改 src 或测试） |
| `revert` | 回滚之前的 commit |

### 4.3 示例

```
feat(fsrs): 适配 ts-fsrs 5.4.1，支持 repeat() 预览 4 种评分

- 新增 toFsrsCard / fromFsrsCard 双向转换层
- 保持对外 API 100% 兼容
- 新增 20 个适配层单元测试
```

```
fix(chat): 修复流式响应末尾 Token 丢失问题

Closes #123
```

---

## 五、代码风格

### 5.1 ESLint + Prettier

项目已配置 ESLint 与 Prettier，提交前请运行：

```bash
npm run lint        # 检查
npm run lint -- --fix   # 自动修复
```

### 5.2 TypeScript Strict 模式

- `tsconfig.json` 启用 `strict: true`
- **0 `any` 原则**（除遗留代码外，禁止新增 `any`）
- 公共 API 必须有完整类型定义

### 5.3 命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| 文件（组件） | PascalCase | `MessageBubble.tsx` |
| 文件（工具） | kebab-case | `fsrs-engine.ts` |
| 变量/函数 | camelCase | `reviewCard` |
| 类型/接口 | PascalCase | `FSRSParameters` |
| 常量 | UPPER_SNAKE | `GITHUB_REPO_URL` |
| CSS 类 | kebab-case | `book-card-title` |

### 5.4 注释

- 代码注释**用中文**
- 复杂逻辑必须有注释说明「为什么这样做」
- 公共 API 必须有 JSDoc 注释

---

## 六、PR 流程

### 6.1 创建分支

```bash
# 从 master 拉最新代码（本仓库默认分支是 master，不是 main）
git checkout master
git pull upstream master

# 创建特性分支（命名：type/简短描述）
git checkout -b feat/fsrs-preview
git checkout -b fix/chat-stream-token
git checkout -b docs/readme-license
```

### 6.2 提交并推送

```bash
git add .
git commit -m "feat(fsrs): 适配 ts-fsrs 5.4.1"
git push origin feat/fsrs-preview
```

### 6.3 创建 Pull Request

1. 在 GitHub 上发起 PR，目标分支为 `harryopo/zhixing-reader` 的 `master`
2. PR 标题遵循 Conventional Commits 格式
3. 打开 PR 时正文会自动带上 `.github/PULL_REQUEST_TEMPLATE.md`，其中「我验证过什么」这一栏请照实填，包括**没有验证的部分**

> PR 模板的正文（变更类型 / 变更说明 / 关联 Issue / 本仓库守卫清单）只维护在 `.github/PULL_REQUEST_TEMPLATE.md` 一处，本文不再复制，避免两份对不上。

### 6.4 Code Review

- 至少 1 位 Maintainer 审核通过后才能合并
- 审核重点关注：**正确性、测试、类型安全、性能、可维护性**
- 修改后请回复审核意见而非关闭重开 PR

---

## 七、测试要求

### 7.1 质量门禁

**提交 PR 前必须运行 `npm run verify` 并全绿**：

```bash
npm run verify
# 等价于依次执行：
#   npm run lint        # ESLint
#   npm run typecheck   # tsc --noEmit
#   npm run test        # Vitest（不含覆盖率）
#   npm run build       # 三进程编译
```

### 7.2 覆盖率门禁

实测口径（与 `vitest.config.ts` 一致，2026-09-18 校准）：

- 覆盖率仅在 `npm run test:cov` 时计算，阈值：**lines ≥ 83 / branches ≥ 80 / functions ≥ 75 / statements ≥ 83**
- 统计范围是 `vitest.config.ts` 中的**源文件精确白名单**（新增模块的测试需同步登记，避免 0% 文件拖垮门禁）
- CI 当前只跑 `npm run test`，**尚未接入覆盖率阻塞**（待 `@vitest/coverage-v8` 版本对齐后升级为门禁项）
- 期望实践：新增代码尽量带上测试（历史基线参考：关键模块 fsrs-engine / database / agent 实测 ≥90%）

### 7.3 测试文件组织

- 单元测试：`tests/*.test.ts`
- 测试夹具：`tests/__fixtures__/`
- 组件测试：与组件同目录 `__tests__/` 文件夹
- 测试文件命名：`<被测文件名>.test.ts`

### 7.4 测试风格

```typescript
import { describe, it, expect } from 'vitest'

describe('reviewCard', () => {
  it('应该在 Good 评分时返回正确的下次复习时间', () => {
    // Arrange
    const card = createEmptyCard()
    // Act
    const result = reviewCard(card, Rating.Good)
    // Assert
    expect(result.state).toBe(CardState.Learning)
  })
})
```

遵循 **AAA 模式**：Arrange（准备）→ Act（执行）→ Assert（断言）。

---

## 八、反馈渠道

- **提 Issue 请走模板**：[New Issue](https://github.com/harryopo/zhixing-reader/issues/new/choose) 里有三类 —— Bug 反馈 / 功能建议 / 环境与构建问题。仓库关闭了空白 Issue，就是为了少来回追问一次。
- **上手可做**：带 `good first issue` 标签的 Issue（每条都写清了改哪个文件和判定标准）。
- **安全问题**：不要公开发，走 [SECURITY.md](SECURITY.md) 的私有渠道。
- **代码讨论**：通过 PR Review。

---

## 九、行为准则

参与本项目即代表你同意遵守 [Code of Conduct](CODE_OF_CONDUCT.md)。请在所有交流中保持友善与尊重。

---

*感谢你的贡献！愿知行读书因你而更好。*
