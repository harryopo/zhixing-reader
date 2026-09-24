# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security
- **API 密钥改为系统加密存储**：此前 `safeStorage` 那套加密读写从未被任何调用方接上，微信读书与 AI 服务的密钥实际一直以明文写在 `%APPDATA%` 下的 `settings.json` 里。现在密钥写到 `userData/secure/<名字>.enc`（Windows 上由 DPAPI 保护），设置文件里不再留明文；已配过密钥的老用户在下次启动时自动完成迁移，**加密不可用或加解密失败时退回明文而不是丢掉已配置的密钥**。可用性判定也改成"真做一次加密-解密自检"，界面关于密钥保存方式的说明跟着自检结果走
- **密钥原值不再发给渲染层**：设置页过去会把已保存的 key 取回主界面并回填进输入框，等于每次打开设置就把加密着的东西摊开一遍。现在跨进程只传"配没配"两个布尔，输入框改为**留空即不修改**，移除已存的 key 改用界面上的「清除已保存的 Key」；只改端点/模型时由主进程补回已存的 key，测试连接同样能用上已存的那把

### Fixed
- **开发模式下设置与日志仍写入装机版的数据目录**：数据目录的区分写在 `main.ts` 本体里，而负责读这个目录的两个模块在更早的「模块加载期」就把路径固定下来了，于是它们拿到的始终是装机版目录。表现为开发版读不到已配置的密钥（提示「请先设置微信读书 API Key」），且开发版每次保存设置会覆盖装机版的设置。切换逻辑改为独立模块并排在最前，守卫由 3 条加到 5 条（含一条反证，防止排序检查变成空转）
- **CI 自 2026-09-19 起每次推送都失败**：`npm run build:tokens --check` 对产物做逐字节比对，而 windows-latest Runner 检出时把 LF 换成 CRLF，导致「产物已过期」恒定判定。新增 `.gitattributes` 固定 `* text=auto eol=lf`，并加一条守卫断言钉住它
- **`npm run typecheck` 不覆盖测试文件**：根 `tsconfig.json` 的 `include` 只有 `electron` / `src` / `scripts`，`tests/` 完全在类型检查之外 —— 测试里写错的列名、类型、mock 签名只有真跑 Vitest 时才可能暴露（且只暴露跑到运行时的那部分）。现在把 `tests/**/*.ts` 纳入覆盖，一并清零此前积压的 61 处类型错误；新增 `tests/typecheck-coverage.test.ts` 钉住这个覆盖面（带反证：谁把 `tests/` 从 `include` 里删掉，这条立刻判红）。顺带修正三处被类型检查照出来的声明与实现不一致：`renderTemplate()` 的实现按「缺值」处理 `null` 但签名不含它、`AIServiceConfig` 被三个导出函数的签名使用却未导出、三个上下文构建器的 `shouldBuild()` 省略了接口声明的形参
- 删除 `tokenUsageDb.deleteOlderThan()`：无任何调用方，且是全仓库唯一把值直接拼进 SQL 字面量的地方

### Changed
- **打包器 electron-builder 由 25.1.8 升级到 26.15.3**：清掉 10 条依赖告警（`app-builder-lib`、`builder-util-runtime` 各 1 条 high，以及它们带出来的 8 条 `tar`）。换代点逐条对过官方 26.0.0 说明：`win` 的签名配置移到 `win.signtoolOptions`（本项目不签名）、Linux `.desktop` 配置改对象（只打 Windows）、`electronDist` 改为 Hook（未使用）、asar 打包换成官方 `@electron/asar`。重新出包并核过内容完整（`app.asar` 内 12,220 个文件、105 个字体分片、sql.js 的 wasm 仍在 unpack 目录），打包版启动到主窗口、检查更新走完并如实回「已是最新」
- **测试框架 Vitest 由 2.1.9 升到 3.2.7**（含 `@vitest/coverage-v8`）：清掉那条唯一的 **critical** 依赖告警。刻意停在 3.x —— 4.x 把 vite 变成 peer 且要求 ≥6，会连锁拽着 vite 与 electron-vite 一起跨大版本。顺带去掉一个双口径：`environmentMatchGlobs`（Vitest 3 已标废）与测试文件自己的 `@vitest-environment` 同时在指环境，谁生效说不清；现在统一由每个文件自己声明
- **运行时候体 Electron 由 35.7.5 升级到 39.8.10**（`package.json` 声明 `^35.0.0` → `^39.0.0`）：随包发出去的运行时本身卡着 32 条依赖告警，逐条读它们要求的最低修复版本后确定 39.8.10 是全部覆盖到的最低点。主进程用到的 API 逐条对照官方 36–39 的破坏性变更清单核过，无一命中；已重新出包并在本机启动到主窗口。按 GitHub 的 85 条告警对新锁文件重算：**累计清掉 64 条、剩 21 条**（tar 8、vite 3、vitest 3、extract-zip 2、electron-builder 2、echarts 1、esbuild 1、glob 1，其中 extract-zip 上游没有补丁）
- README 的数字与口径按代码重新核对：构建器预算表改为代码里真实存在的机制（一个全局上限 + 每维取数条数），撤掉无测量支撑的延迟与节省百分比，代码行数、IPC 领域数、覆盖率命令口径同步更正
- 性能一节为每一行标注口径（实测 / 未做基准）
- 依赖在 `package.json` 声明的 semver 范围内整体刷新一次（`package.json` 未改，只改锁文件）：Electron 35.0.0→35.7.5、react-router 7.16→7.18.4、js-yaml 4.1.1→4.3.2、@xmldom/xmldom 0.9.10→0.9.12、postcss 8.5.15→8.5.28、nanoid / form-data / browserslist / ip-address / brace-expansion 同步跟进，按 GitHub 的 85 条依赖告警逐条对账**清掉 33 条**；仍需跨大版本的 52 条另列待办（Electron 31、tar 8、vite/vitest 6、electron-builder 2、echarts 1、esbuild 1、glob 1、extract-zip 2 无上游补丁；其中 Electron 那 31 条已由上面一条做完）

### Added
- `.github/ISSUE_TEMPLATE/`：Bug 反馈 / 功能建议 / 环境与构建 三类模板，并关闭空白 Issue
- `.github/PULL_REQUEST_TEMPLATE.md`：含「我验证过什么」必填栏与本仓库守卫清单
- `SECURITY.md`：安全问题私有上报渠道 + 现状安全边界与已知限制
- README 新增「已知限制」与「反馈问题」两节；`CODE_OF_CONDUCT.md` 的举报通路改为私享（原写法会把举报内容放到公开 Issue 上）
- Issue #1–#10 建立公开待办清单（含 4 条 `good first issue`）

## [1.3.4] - 2026-09-23

### Fixed
- **「重启安装」弹「知行读书 无法关闭」**：安装包进程与主进程退出在抢时间 —— 安装器启动后立刻查找同名进程并结束它们，而原先主进程的退出是异步排队、退出前还要跑完异步收尾，慢几百毫秒就会被判成「关不掉的程序」。现在改为：先由应用自己把数据库同步写盘并关闭，再直接结束进程，退出顺序不再交给异步事件。
- **复习卡片「今日到期」把新卡算了进去**：同一份统计有两处实现，其中一处没有排除从未学过的卡片，导致它们被计入待办数。现在两处共用同一份定义与同一套口径（`due` 只统计已学过且到期的卡片）。
- **书籍详情页的「笔记」页签始终为空**：该页签按一个数据库里不存在的字段筛选，所以「笔记 N 条」这个数一直显示 0。现在按划线是否写了笔记来区分「划线」与「笔记」两类。
- **开发版与已安装版共用同一份数据**：开发模式下运行的实例与安装版使用同一个数据目录（数据库、设置、日志互相覆盖），且单实例锁也相互排斥。现在开发版使用独立目录 `zhixing-reader-dev`，已安装版的数据位置不变。

### Changed
- 数据字段的前端类型收口到 `src/renderer/src/utils/db-mapper.ts` 一处定义，各界面不再各自声明一套行结构；新增双向对账测试 `tests/db-row-types.test.ts`（15 条），字段与数据库真实列名不符时门禁直接判红。

测试 1004 → 1019 用例（59 → 60 文件）。



### Fixed
- **检查更新失败时的提示**：原先把 `net::ERR_CONNECTION_RESET` 一类的网络错误码直接显示出来，且同一次失败会弹两条提示（状态事件与按钮返回值各报一次）。现在网络类失败统一收成一句可行动的中文说明，证书异常、访问频率受限、找不到安装包各给一句，其余仍保留原文便于排查；后台静默检查的失败也不会在打开页面时重复提示。
- **「设置 → 关于」的更新历史**：改为短句分条，一条只说一件事。

## [1.3.2] - 2026-09-21

### Fixed
- **统计页趋势图与所选时间范围不一致**：时间范围、图表标题、柱子数量原本由三处分别决定 —— 选「本月」可能只画 7 根柱子，选「本年」会把按天的数据标成「1月…12月」。现在四处统一取自 `src/shared/reading-trend.ts` 的一份定义（名称 / 标题 / 角标 / 分桶粒度），按月聚合按本地月份统计，跨年不会把两个 3 月并成一个。
- **复习热力图日期偏移**：取数窗口与格子日期改用本地日期（原按 UTC 切分，UTC+8 凌晨使用时「今天」会被算成昨天，今天这一格不亮）。取数、格子、角标共用同一批日期 key。
- **两张卡片的数据与标题对齐**：KPI 卡标题改为「卡片总数」（值为累计建卡数，包含尚未复习过的），并在副标题说明来源；「复习热力 · 近 12 周密度」的角标改为这 12 周的实际复习次数。
- **移除 AI 调用日志的「费用」列**：`token_usage.cost_usd` 没有写入方，界面按固定汇率换算后始终显示 ¥0.00。CSV 导出仍保留该列（数据库真实列）。

### Changed
- `WeeklyBars` 更名 `HourlyBars`：该组件绘制的是一天 24 小时的分布，组件名与注释原本写的是「一周 / 7 日」。

测试 974 → 985 用例（55 → 56 文件）；`tests/no-fake-controls.test.ts` 新增 4 条口径守卫（费用列、chip 命名唯一、趋势分桶走 shared 定义、日期 key 用本地时区）。

## [1.3.1] - 2026-09-21

### Fixed
- **自动更新「检查了但没人知道」**：打包版启动确实会静默查一次更新，但那条状态是单向推送、错过不补，而全应用唯一的订阅者是晚挂载的「设置 → 关于」——用户还在首页时检查结果就永久丢弃，界面表现为「永远没有新版本」。现在主进程缓存最后一次状态并新增 `UPDATE.GET_STATUS` 回读通道（163→164），顶栏（常驻组件）也订阅该事件。

### Added
- **顶栏通知面板新增「新版本 vX」一条**：没下载时提示「去『关于』里点一下」，已下载完提示「下次退出或重启即装上」，点击跳「设置 → 关于」。查到「已是最新」会把这条**收回**，红点不会永远挂着。判定口径提成纯模块 `src/shared/update-notice.ts`（只有 `available`/`downloaded` 才提示）。
- **每 6 小时重查一次**：应用常连着开好几天，只在启动时查一次等于没有。下载中与已下载完不打断，退出时清定时器。
- **「设置 → 关于」进页自动补一次检查**：先回读缓存，没有结果才发起检查；开发环境不自动触发（那里的降级通路会直接打开浏览器下载页）。

### 口径
按用户选择维持**「只提示，不自动下载」**：`autoDownload=false` 保留，下载与安装那两下永远由用户点（后台静默拉一百多兆占带宽）。

测试 968 → 974 用例（54 → 55 文件）。

## [1.3.0] - 2026-09-21

### Added
- **书籍层级摘要（RAPTOR 简化）**：新增 `chapter_summaries` 表，L1 逐章 → L2 由 L1 汇总；L1 未变不重烧 L2，同书并发直接报错。书籍详情新增「摘要」页签与「生成 AI 摘要」入口，摘要与 BM25 挑出的章节一起注入对话上下文
- **摘要「只报不烧」**：顶栏通知面板列出「N 本书划线有变化，摘要待更新」并可一键跳到该书的摘要页签。启动/通知全程零 AI 调用，花钱那一下留给用户自己按
- **模型分级路由**：`casual_chat` 等白名单意图可分流到经济档（新增设置项 `llmModelFast`），未配置时恒走主模型
- **品牌 VIS**：徽标改「玉璧」（开口环 + 铜金方，一套几何四种配色）、思源黑体描骨转曲成字标、`tokens/brand.json` 作全部色值的唯一真值（`npm run build:tokens` / `build:icons` 生成产物入库）
- **字体本地打包**：Noto Sans SC / DM Sans / JetBrains Mono 三款可变字体随包分发（OFL，woff2 由 Vite 打进渲染层），补齐中文字体栈并移除 Google Fonts CDN 依赖——桌面应用离线可用
- **Modal / Drawer 弹层原语**：全应用 6 处重复实现的弹层收口到一处，统一 `aria-modal` + ESC + 焦点管理
- **档案页统计算法**：窗口/连续/热力/趋势/时长全部提成纯模块 `src/shared/profile-stats.ts`，一次 `Promise.all` 取数，热力图由同一批 `dailyRows` 派生（顺手修掉 `toISOString()` 的 UTC off-by-one）

### Changed
- **AI 非流式调用换通路**：章节摘要、全书摘要、卡片解读/应用、Skill 导出、文章翻译从手写 `callAI` 改走 `sdkGenerateText` / `sdkGenerateObject`；`buildMessages` 收口成一处（`prompt-messages.ts`），统一下发 `reasoningEffort: 'none'`，用量按 `feature` 逐次落库含 `cachedInputTokens`
- **巨型页拆分**：Stats 2993→553、TokenUsage 1612→974、SettingsData 1541→1185、DailyLearning 2190→1622、VocabularyPage 1972→1091、KnowledgeCards 1789→1058、Methodologies 1787→1004（子组件搬进各自 `pages/<page>/` 目录）
- **测试基线**：885 → 968 用例（42 → 54 文件），新增源码扫描类守卫（品牌资产 / 设计 token / 字体资产 / 假控件）

### Fixed
- **前端数据口径对齐**（统一标准：界面上的每个数字都接到真实数据库列，接不上的移除）
  - 档案页「加入知行 N 天」没有真实来源 → 改为回退到「第一条真实记录」
  - 复习 CSV 有 5 列长期为空：读的是 SM-2 时代的字段名，而 reviews 真实列是 `card_id/rating/review_time/elapsed_days/scheduled_days` → 表头与取数共用 `src/shared/review-export.ts` 一份定义，测试用 `PRAGMA table_info(reviews)` 双向对账
  - 顶栏「N 张卡片待复习」用 `getDue(100).length` 当计数，卡片超过 100 张时始终显示 100 → 改走 `getQueueStats().actionable`
  - 每日学习用被默认 limit 截断的列表长度当计数（实测 80 篇文章 > 默认 50，会把「还有未读的」算成「都读完了」）→ 显式取全量
  - 知识卡片的「复习 0 次」：`review_count` 有列但无写入方 → 移除该显示
  - 策略表写死的「4 条映射」→ `INTENT_META.length`
  - 后台 `admin.getCardsByBook` JOIN 了不存在的 `knowledge_cards.highlight_id`（一进后台就抛错）、`cards` 查询丢 `book_id`（卡片无法归属到书）→ 都补上
- **Skill 导出英文名排版**：`{{nameEn}}` 顶在「触发场景:」前渲染成 `Pomodoro触发场景: …`；纯中文名 slug 化后是空串，旧代码回退成 `methodology` 等于编造名字 → 提成 `src/shared/skill-name.ts`，整行自带换行、没有英文名就整行省略
- **老通路丢失 `cached_tokens`**：解析响应时丢掉 `prompt_tokens_details.cached_tokens`，导致统计页缓存命中率对部分功能恒为 0
- **`Review` 类型与真实列对齐**：接口声明的 `cardId/quality/easeFactor/interval/reviewedAt` 在数据库里一个都不存在，换成真实的 `ReviewRow`（snake_case）

### Removed
- **26 条渲染层零调用的 IPC 死链**（通道 188→163）：整条手写流式实现（`ai.streamChat` / `streamOpenAI` / `streamAnthropic`）、4 个被取代的非流式函数、Skill 批量导出、20 条数据读取死链，及 `book_architecture` 全链路
- **假控件**：设置页「难度衰减」（FSRS-6.0 的 decay 是常数，引擎从不接受该值）、存储进度的 `/ 512 MB` 上限（本应用没有容量上限这个概念）

## [1.2.0] - 2026-09-17

### Added
- **应用内自动更新**：接入 `electron-updater` + GitHub Releases。启动时静默检查，「设置 → 关于」可手动检查、一键下载（含进度条）、重启安装；下载完成后即便不点安装，下次正常退出也会自动装上。开发环境自动降级为 GitHub API 比对 + 打开下载页
- **本地 BM25 检索**：书籍划线检索从「向量语义检索（Vectra + embeddings API）」换成本地 BM25 + 中文 bigram（`src/shared/retrieval.ts`），零 API 依赖、不会静默失败；原向量链路整套移除
- **检索可视化**：对话页「调取知识库」面板实时展示 5 路检索结果、意图分类与命中原文；意图分类结果落库 `chat_messages.intent`，引用来源片段（`ragSources`）随消息持久化
- **对话深度思考流式展示**：思考内容流式下发前端，面板默认折叠
- **历史滚动摘要（Token 优化 Step 3）**：wire 历史超阈值时最老轮次增量折叠进持久化摘要，长会话输入 token 不再线性膨胀，跨重启保留早期上下文
- **前缀缓存友好化（Token 优化 P0）**：system prompt 逐字节稳定 + wire 历史视图 + 缓存命中率观测（`cached_tokens`）
- **微信读书后台自动同步**：定时器驱动全量同步，结果事件推送前端；失败告警不静默
- **每日新卡上限**：新卡与复习卡分桶展示，修复「934 条划线一次性全到期」的放弃感
- **卡片掌握度**：由 FSRS 状态推导，全应用共用一套「人话」表述；复习页可连续复习、评分防连点
- **启动自动修复**：卡片来源划线 / 划线章节名 / 阅读时长三类历史数据缺口启动后自动补齐（后台执行，不拖慢窗口）
- **数据导出补全**：备份导出纳入知识卡片 / 方法论 / 生词，导入真实恢复它们与复习卡片
- **存储用量真实化**：设置页显示数据库 / 日志真实字节数，小于 0.1MB 用 KB 显示

### Changed
- **每日学习重做**：只留系统能判定的事项，砍掉 4 项纯形式任务
- **词汇复习改用 ts-fsrs**：修复间隔恒为 1 天、评分档位错位、毕业丢状态三处问题；「加入复习」只排队不偷记评分
- **「重新蒸馏 / 重新提取」改为真替换**：先清旧数据再生成，不再新旧混杂
- **测试基线**：885 用例 / 42 文件全绿；fixture 复用生产的 `applySchemaAndMigrations()`，消除双份 schema

### Fixed
- 对话默认不选书时三路上下文全被跳过（意图为「提问」也检索）
- 书籍上下文恒为空、对话静默无响应（Repository 工厂从未初始化）
- 中文提问检索恒为 0 条（切词整句当一词、空索引误判、空结果不回退）
- 934 条划线章节名丢失、知识卡片 / 方法论来源划线丢失、阅读时长恒为 0、引用来源不落库——数据血缘四处断点全部修复
- 数据库持久化失败加指数退避重试与用户通知；`RESET_DATABASE` 退出前强制落盘
- 系统加密不可用时如实告知 API 密钥为明文存储（不再假装安全）
- 死代码治理：`book_architecture` 全链路、30+ 处假按钮 / 假数字 / 无人消费的开关清理
- 结构化 AI 任务（蒸馏 / 方法论 / 翻译）默认关思考 + 输出预算取用户配置 + JSON 截断抢救

### Security
- `getDatabaseTableData` 拒绝 `sqlite_` 内部表（纵深防御）

## [1.1.0] - 2026-08-28

### Added
- **间隔复习闭环**：新增复习页（`/review`），划线原文做卡面、四级评分带 FSRS 间隔预览、键盘快捷键（空格 + 1-4）、侧边栏与首页入口
- **Token 用量实时统计**：AI 对话用量实时落库，侧边栏与 Token 页通过事件即时刷新，0 用量（中断）不记录
- **档案资料注入 AI 画像**：个人档案自述资料（昵称/所在地/简介）优先注入对话上下文，叠加行为推导画像；空白资料不注入、单字段截断 200 字防垃圾上下文
- **首页行动入口重构**：继续阅读（最近 3 本封面进度卡）+ 最新划线/笔记 + 复习队列，统计展示收敛到统计页
- **书籍详情最近动态**：右栏展示本书最新划线/笔记真实预览
- **智能体编排真实化**：意图关键词、策略映射、难度规则直连后端运行时真实数据

### Changed
- 智能体编排从独立页迁入设置壳层（`/settings/agent`），与其他设置子页交互一致
- 主进程 database.ts（2415 行）/ ipc.ts（950 行）拆分为按领域组织的 `database/`（16 文件）与 `ipc/`（12 文件）目录，对外 API 不变
- 管理后台移出前端（无 UI 入口，开发期 URL 直达 `/admin`）
- 各页假数据治理：统计评分列、书籍难度、演示档案、编造规则等删除或替换为真实数据

### Fixed
- 侧边栏 /review 死链（菜单 Ctrl+2 现指向间隔复习页）
- 首页柱状图满刻度写死、头像未接昵称等展示问题

## [1.0.0] - 2026-07-25

### Added
- **微信读书同步**：支持拉取书架、划线、笔记、书评，离线缓存到本地 sql.js，自动合并增量更新
- **AI 智能体对话**：5 维上下文构建（书籍 / 知识卡片 / 记忆 / 方法论 / 用户画像）、意图分类、策略选择、编排执行、流式响应、Token 用量统计、提示词模板热更新
- **FSRS-6.0 间隔重复算法**：基于 `ts-fsrs@5.4.1`（open-spaced-repetition 官方，Anki 24.06+ 同源），完整 DSR 模型，21 组标准权重，支持 `repeat()` 预览 4 种评分结果
- **知识卡片体系**：自动从划线蒸馏概念卡 / 方法论卡 / 金句卡，反向链接到原文，复习时联动 FSRS 调度
- **英语词汇学习**：词频词典（`resources/dictionary.json`，~8 万词）、上下文例句匹配、SM-2 混合算法独立调度、每日学习、生词本、查词
- **统计与可视化**：基于 Apache ECharts 5.5.1 的 AdminDashboard（6 个图表、按需引入、Canvas 渲染），Token 用量大数字、FSRS 状态分布、稳定性曲线
- **智能体编排中枢**：六步流水线可视化、四种意图配置展示、策略矩阵热力图、系统提示词模板（6 变量注入），与后端 agent 实现同源
- **Vercel AI SDK 集成**：通过 `@ai-sdk/openai`、`@ai-sdk/anthropic` 等统一接入多家 AI 服务商
- **667 个单元测试**：覆盖率 ≥ 85%，关键模块（fsrs-engine、agent、database）≥ 95%
- **三进程架构**：Main / Preload / Renderer 严格隔离，`contextBridge` 安全暴露 IPC
- **自动检查更新**：通过 GitHub Releases API 检查新版本
- **GitHub Issues 反馈入口**：在应用内一键跳转 GitHub Issues
- **完整开源文档**：LICENSE (MIT)、CONTRIBUTING.md、CODE_OF_CONDUCT.md、PRIVACY.md、AGENTS.md、CLAUDE.md

### Security
- 所有用户数据本地存储，不上传任何服务器
- 微信读书 Cookie 加密保存，仅用于调用官方 API
- AI API Key 加密保存，请求直连 AI 服务商
- 不包含任何分析 / 追踪 / 广告 SDK

### Known Issues
- Windows installer 体积约 125MB（主要来自 Electron 运行时 + sql.js WASM + ECharts vendor）
- 部分依赖存在安全漏洞（详见 `npm audit`，均为间接依赖，已跟踪上游修复）
- macOS 与 Linux 版本尚未打包（需手动构建）
- 微信读书 Cookie 会随登录态过期，需定期重新获取

### Dependencies
- Electron 35
- React 19 + React Router 7
- TypeScript 5.6 strict
- Tailwind CSS 4
- Zustand 5
- sql.js 1.14
- ts-fsrs 5.4.1
- Apache ECharts 5.5.1 + echarts-for-react 3.0.2
- Recharts 3.8.1
- Vercel AI SDK
- Vitest 2 + @vitest/coverage-v8
- electron-builder 25

---

## 版本号说明

本项目遵循 [Semantic Versioning](https://semver.org/spec/v2.0.0.html)：

- **MAJOR**：不兼容的 API 变更
- **MINOR**：向后兼容的新功能
- **PATCH**：向后兼容的 Bug 修复

## 链接

[1.3.4]: https://github.com/harryopo/zhixing-reader/releases/tag/v1.3.4
[1.3.3]: https://github.com/harryopo/zhixing-reader/releases/tag/v1.3.3
[1.3.2]: https://github.com/harryopo/zhixing-reader/releases/tag/v1.3.2
[1.3.1]: https://github.com/harryopo/zhixing-reader/releases/tag/v1.3.1
[1.3.0]: https://github.com/harryopo/zhixing-reader/releases/tag/v1.3.0
[1.2.0]: https://github.com/harryopo/zhixing-reader/releases/tag/v1.2.0
[1.1.0]: https://github.com/harryopo/zhixing-reader/releases/tag/v1.1.0
[1.0.0]: https://github.com/harryopo/zhixing-reader/releases/tag/v1.0.0

---

*最后更新：2026-09-23*
