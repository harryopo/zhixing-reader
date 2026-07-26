# Product

## Register

brand

## Users

**主要用户**：18-30 岁的深度阅读爱好者、知识工作者、终身学习者。
- **场景**：在桌面端进行阅读反思、知识管理、复习调度时使用。多在书桌前、图书馆、夜间深度阅读场景。
- **任务**：把零散的阅读划线变成可复习的知识资产；用 AI 理解书籍脉络；用 FSRS 算法对抗遗忘；通过英语词汇学习扩展能力。
- **情绪目标**：从"读完就忘"的焦虑，转为"知行合一"的掌控感与成长感。

**赛事评委**：火山杯 2026 评委、Trae 大赛评审、开源社区评估者。
- **场景**：通过 landing page 快速评估项目价值、技术深度、产品成熟度。
- **任务**：3 分钟内理解项目核心能力、技术栈、开源规范、可下载验证。

## Product Purpose

知行读书是一款 AI 驱动的阅读成长智能体。把"微信读书同步 → AI 智能体理解 → 科学间隔复习 → 知识卡片体系化 → 英语学习"完整闭环装进本地优先的 Electron 容器。

**为何存在**：阅读成长工具要么偏笔记（无复习）、要么偏卡片（无来源同步）、要么偏 AI（无数据资产化）。知行读书用一条主线打通整个阅读成长闭环，让每一本书都不止于读完。

**成功标志**：
- 用户每周打开应用 3+ 次主动复习
- AI 对话能引用用户的真实划线与卡片
- 90 天后用户仍能回忆起核心知识

## Brand Personality

**沉静、专业、可信、温暖**。

- **沉静**：不喧哗、不浮夸、不用渐变色堆砌。emerald 绿色承载"成长"隐喻，深色模式承载"专注"场景。
- **专业**：技术深度真实可见（FSRS v5 算法、667 测试用例、TypeScript strict）。文档完备，工程规范。
- **可信**：MIT 开源、本地优先、数据归属用户、无追踪 SDK。
- **温暖**：阅读是私人的事，应用尊重每一本读过的书、每一条划线、每一张卡片。

3 词概括：**Calm · Credible · Growing**。

## Anti-references

明确不要的样子：

- **AI 味浓重的 SaaS landing page**：蓝紫渐变 hero、玻璃拟态卡片堆叠、`border-radius: 32px+` 巨圆角、灰底白卡、`01/02/03` 编号 eyebrow、emoji 图标网格、`repeating-linear-gradient` 斜纹背景。
- **教程站审美**：宽行距、淡灰文字、巨大留白、信息密度过低，看起来"安全"但毫无记忆点。
- **AI 生成的占位图**：`text_to_image` 风格的卡通插画、3D 渲染图、抽象渐变球。
- **手绘 sketchy SVG**：`feTurbulence` 纸纹滤镜、粗糙路径插画的"伪温暖"。
- **幽灵卡片**：`border: 1px solid` + `box-shadow: 0 16px+` 的鬼影卡片组合。
- **教科书式 eyebrow**：每个章节上方都是 `ABOUT / FEATURES / PRICING` 全大写小字 + 字间距加宽，2023 年 AI 训练数据饱和产物。

## Design Principles

1. **Show, don't tell**：用真实截图、真实数据、真实代码、真实测试数字说话。不用形容词堆砌，不用营销话术。
2. **One calm anchor**：emerald 绿是唯一品牌锚点，承载所有强调。其余区域用真正的中性色（chroma 0），不用奶油色/沙色/纸色等 AI 默认暖色背景。
3. **Density over decoration**：评委时间宝贵，每屏要有信息密度。技术栈、测试数、版本号、文件大小、链接 — 都要具体到数字。
4. **Honest about scope**：125MB 是真的大，但功能完整不删减。已知问题（macOS 未打包、npm audit 23 个）写在 release notes 里。诚实比完美更重要。
5. **Real跳转 over 占位**：所有 link 必须真实跳转 — GitHub 仓库、Release 下载、Issues 反馈、PRIVACY.md、CONTRIBUTING.md。0 个 `#` 占位链接。

## Accessibility & Inclusion

- **WCAG 2.1 AA**：正文对比度 ≥ 4.5:1，大字 ≥ 3:1。placeholder 文字也需 4.5:1，不用默认淡灰。
- **键盘可达**：所有 CTA 按钮、链接 100% 键盘可达，焦点环可见。
- **Reduced motion**：所有动画提供 `@media (prefers-reduced-motion: reduce)` 降级为瞬切或淡入。
- **暗色模式**：完整支持 `prefers-color-scheme: dark`，夜间阅读场景友好。
- **中文优先排版**：中文字体 `PingFang SC / Microsoft YaHei` 优先，等宽字体用于代码与技术标签。
- **图片 alt**：所有截图提供有意义的 alt 文本，屏幕阅读器可理解。
