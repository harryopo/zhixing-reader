/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// 知行读书 — Vitest 配置（v1.4，2026-07-23）
//
// 演进历史：
//   v1.0 (2026-07-20) — 初始配置，node 环境，主进程纯逻辑测试
//   v1.1 (2026-07-20) — 补 coverage + setupFiles
//   v1.2 (2026-07-22) — 新增 @ alias + react plugin + css:false；coverage.include 扩展到 stores/components
//   v1.3 (2026-07-22) — coverage.include 改为精确文件列表（仅含已测文件）
//                       原因：v1.2 用 `**/*` 通配符把无测试文件（Toast.tsx/profileStore.ts）也纳入，
//                       导致整体覆盖率被 0% 文件拉低到 15%，门禁 fail。
//                       策略：保持 85% 阈值作为目标，后续写测试时逐步扩展 include。
//   v1.4 (2026-07-23) — Phase 17 T5：新增 database.ts 到 include（sql.js 集成测试 49 用例覆盖）
//                       ai-sdk-service.ts 暂不加入（smoke 测试仅覆盖配置管理，流式函数依赖真实 API）
//
// 默认环境：node（FSRS 引擎、SQL 工具、IPC 通道等纯逻辑测试）
// React 组件测试：在测试文件首行加 `// @vitest-environment jsdom` 切换环境
//
// 覆盖率目标：lines/funcs/statements ≥ 85%，branches ≥ 80%
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // 关键：与 electron.vite.config.ts / tsconfig.json 保持一致
      '@': resolve(__dirname, 'src/renderer/src'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    // 一批守卫测试是"扫全仓库源码"的（db-method-consumers / coverage-list / doc-figures /
    // ipc-channel-wiring），默认 5 秒上限在并行负载下会被踩穿 —— 实测同一份代码
    // 单跑全绿、整套跑时 db-method-consumers 报 `Test timed out in 5000ms`。
    // 抬到 20 秒只放宽墙钟，不动任何断言（判据该红的还是红）。
    testTimeout: 20000,
    // 需要 DOM 的测试在自己文件首行写 `// @vitest-environment happy-dom`。
    // 原先这里用 environmentMatchGlobs 统一指环境，Vitest 3 已把它标废（4 会删），
    // 而且它和文件头的 docblock 谁生效说不清 —— admin-charts 就同时被 glob 指到
    // happy-dom、又在第 24 行自己声明了 jsdom。环境交给每个文件自己说，只留一套口径。
    include: [
      'tests/**/*.test.ts',
      'electron/**/*.test.ts',
      'src/renderer/**/*.test.{ts,tsx}',
    ],
    exclude: [
      'node_modules/**',
      'dist/**',
      'release/**',
      'installer*/**',
      '**/*.integration.test.ts',
    ],
    // CSS 处理：项目组件 import 'styles/design-tokens.css'，jsdom 不解析 CSS
    // false = 把 .css/.scss import 当空模块，避免测试报错
    css: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'json-summary'],
      // 精确文件列表：只纳入已有测试的文件
      // 新增测试时，把对应源文件路径加入此列表，逐步扩展覆盖率范围
      include: [
        // 主进程核心逻辑（tests/ 下已有测试）
        'electron/fsrs-engine.ts',
        'electron/dictionary-service.ts',
        'electron/agent/intent-classifier.ts',
        'electron/agent/strategy-selector.ts',
        'electron/ai-service.ts',
        'electron/ai-sdk-service.ts',
        // `electron/database.ts` 已拆成 `electron/database/`（14 个领域文件 + index），
        // 逐条列文件名早就漂成了静默空匹配 —— 用 glob，index 由下方 exclude 挡掉
        'electron/database/*.ts',
        'electron/http-client.ts', // 原 `electron/services/http-client.ts`，2026-09 已移出 services/
        'electron/services/prompt-registry.ts',
        'electron/services/template-engine.ts',
        // 共享纯逻辑（main + renderer 双端复用）
        'src/shared/fsrs-metrics.ts',
        'src/shared/source-anchor.ts',
        'src/shared/study-limits.ts',
        'src/shared/usage-tokens.ts',
        'src/shared/fsrs-voice.ts',
        'src/shared/weread-content.ts',
        // 以下这批早就有专属测试文件，却没进清单 —— 覆盖率只量了 18 个文件，
        // 而实际被测试 import 的源文件有 62 个。纯函数纳入后门槛面积更真实。
        // 只有常量/类型声明的（types.ts / ipc-channels.ts / external-links.ts）不列：
        // 它们没有分支可盖，列进去只会把一个 0% 塞进分母。
        'src/shared/ai-coverage.ts',
        'src/shared/backup.ts',
        'src/shared/backup-reminder.ts',
        'src/shared/chapter-summaries.ts',
        'src/shared/csv.ts',
        'src/shared/daily-tasks.ts',
        'src/shared/global-search.ts',
        'src/shared/page-filter.ts',
        'src/shared/model-routing.ts',
        'src/shared/profile-stats.ts',
        'src/shared/reading-trend.ts',
        'src/shared/retrieval.ts',
        'src/shared/review-sources.ts',
        'src/shared/review-export.ts',
        'src/shared/settings-secrets.ts',
        'src/shared/update-notice.ts',
        'electron/services/chapter-title-backfill.ts',
        'electron/services/global-search.ts',
        'electron/services/backup.ts',
        'electron/services/deleted-archive.ts',
        'electron/services/reading-time-sync.ts',
        // 用户画像服务：2026-09-26 换读口后补了真库对账（tests/user-profile-service-real-db.test.ts）
        'electron/services/user-profile-service.ts',
        // renderer（colocated __tests__ 已有测试）
        'src/renderer/src/stores/toastStore.ts',
        'src/renderer/src/pages/settings/use-data-io.ts',
        'src/renderer/src/stores/reviewStore.ts',
        'src/renderer/src/components/chat/MessageBubble.tsx',
        'src/renderer/src/admin-charts.tsx',
        // ===== 2026-09-26 覆盖率清单对账 =====
        // 之前这批文件"有测试却没进清单"（Issue #9 留下的欠账）。判据不是"挑好看的"，
        // 而是当场量：33 个候选全部接进清单跑一遍，**三个维度都过门禁阈值的才留下**，
        // 过不了的按数字记进 Issue #9 评论（见 tests/coverage-list.test.ts 的反向守卫）。
        // 数字（lines / branches / funcs）：
        'electron/agent/context-manager.ts',          // 100 / 100 / 100
        'electron/agent/history-summarizer.ts',       // 100 / 88.88 / 100
        'electron/agent/orchestrator.ts',             // 91.84 / 80.8 / 100
        'electron/services/prompt-storage.ts',        // 98.06 / 95.08 / 100
        'electron/services/settings-service.ts',      // 93.54 / 94.33 / 94.11
        'electron/services/chapter-summary-service.ts', // 94.84 / 87.09 / 100
        'electron/services/startup-repair.ts',        // 88.46 / 86.95 / 100
        'src/renderer/src/echarts-theme-tailwind.ts', // 100 / 100 / 100
        'src/renderer/src/components/ui/Modal.tsx',   // 97.18 / 85.71 / 100
        'src/renderer/src/components/chat/RetrievalPanel.tsx', // 100 / 91.66 / 100
        // 2026-09-26 补了网络层测试（tests/weread-api-network.test.ts）后重新量的
        'electron/weread-api.ts',
        // 2026-09-26 后台自动同步：原来那份测试的 vi.mock 路径写错了（相对测试文件解析 ⇒
        // 指向 tests/ 下不存在的文件，mock 静默失效），整份都是 not.toThrow()。
        // 重写成真行为测试（tests/weread-sync-manager.test.ts）+ 抽出共享计划后的量法。
        'electron/weread-sync-manager.ts', // 100 / 98.3 / 100
        'src/shared/weread-book-sync.ts',  // 100 / 100 / 100
        // 2026-09-26 后台的每条 SQL 上了真库对账（tests/admin-real-db.test.ts）
        'electron/admin.ts',              // 100 / 96.96 / 100
        // 2026-09-27 对话 store：原来只有 5 条用例（意图与引用来源那条链），
        // 会话读写 / 重新生成 / 流式控制 / 点赞收藏 16 个函数一条没走过。
        'src/renderer/src/stores/chatStore.ts', // 100 / 100 / 100
        // 2026-09-27 设置 store：20 个函数里只有微信读书连接测试那一条走过（09-26 登记欠账时的量法），
        // 读设置 / 保存 / 清除密钥 / 五个开关的乐观更新与回滚全部补齐后的量法。
        'src/renderer/src/stores/settingsStore.ts', // 100 / 98.87 / 100
        // 2026-09-27 设置与系统类通道：十条 handler 里只有 GET / GET_ALL 被密钥边界那批用到，
        // 强制落盘 / 清缓存 / 外链白名单 / 存储用量 / 清历史 / 重置库 / 撤销删除 / 备份 都没判据。
        'electron/ipc/settings.ts',        // 98.18 / 97.61 / 100
        // 2026-09-27 书籍与划线类通道：既有那份真库用例只走了入队三条，
        // 划线新建的字段兜底与「导出笔记」的分组/排序/转义/写盘都没判据。
        'electron/ipc/books.ts',           // 100 / 100 / 100
        // 2026-09-27 用户画像构建器：原来只走过 shouldBuild 一行，两层装配（自述资料 +
        // 行为画像）与「一层算崩了别把另一层一起带走」这条兜底都没有判据。
        'electron/agent/builders/user-profile-context-builder.ts',
        // 2026-09-28 知识与卡片类通道：既有两份测试只走了两条 coverage 与 extract 的分批续跑，
        // 「本地没划线就去微信读书搬回来」那半边与「导出 Skill」（映射 + 文件名 + 写盘）一条没测过。
        'electron/ipc/knowledge.ts',
        // 2026-09-28 蒸馏服务：既有那份测试把 electron/database 整个 mock 掉了，
        // "库里到底有没有这一行"从没被回答过；自动导入那半边还漏着 id（每条 INSERT 都抛错）。
        // 新增真库那份：tests/knowledge-card-service-real-db.test.ts
        'electron/services/knowledge-card-service.ts',
        // 同一批：导入字段清单收成一份后，渲染层那条通路自己也该有判据（判重、补章节名、单条失败不带走整批）
        'src/renderer/src/utils/import-weread-content.ts',
        // 2026-09-28 行映射层：九个列表包装与三个时间格式化从来没被执行过，branches 一半没判据。
        // 补判据时量出「库里 UTC 那一串被按本地时区读」这条真偏差（实测 8.0002 小时），一并修掉。
        'src/renderer/src/utils/db-mapper.ts',
        // 同一批：时间口径收成一份（渲染层行映射与主进程导出笔记共用同一把尺）
        'src/shared/db-time.ts',
        // 2026-09-28 会话状态机：难度层级从来没写回（界面三条规则全停在纸面上），
        // 而每小时回收定时器（TTL / 超上限腾位置）一次都没被跑过。
        'electron/agent/state-tracker.ts',
        // 同一批：历史划线时间回填（缺口信号纯库内、对不上就不猜、每本书只试一次）
        'electron/services/highlight-time-backfill.ts',
        // 2026-09-28 记忆这一路：构建器三种交回形状与 catch 没走过；服务层更是要问
        // 「库里到底有没有这一行、按什么顺序交回来」—— 补判据时量出"相关记忆"其实只按
        // 重要度排（命中词数不参与），以及 LIKE 没转义（下划线多匹配一个字符）。
        'electron/agent/builders/memory-context-builder.ts',
        'electron/services/memory-service.ts',
        // 2026-09-29 卡片与方法论这两路：量出「AI 那台检索的字段清单与界面那两台不一致」
        // （书名被写死成空串、输出格式既不搜也不摆），以及两条读路形状不同。
        // 补判据那份是真库：tests/knowledge-methodology-builders.test.ts
        'electron/agent/builders/methodology-context-builder.ts', // 100 / 92.1 / 100
        'electron/agent/builders/knowledge-card-context-builder.ts', // 100 / 83.33 / 100
        // 同一批：相关度的显示口径（BM25 原始分没有上界，界面那句 ×100 的百分比是编的）
        'src/shared/relevance-display.ts', // 100 / 100 / 100
        // 2026-09-29 文章与生词这两路：catch 交出的是与"库里没数据"一字不差的形状
        // ⇒「调取知识库」面板把读库失败说成「无命中」。补判据时顺带把两路的每一栏、
        // 截断两头与上限钉住（tests/context-builders-article-vocab.test.ts 扩到 34 条）。
        'electron/agent/builders/article-context-builder.ts', // 100 / 93.54 / 100
        'electron/agent/builders/vocabulary-context-builder.ts', // 100 / 92.59 / 100
        // 2026-09-29 划线检索那一路：用户想法（note）以前不进索引，而全局搜索与笔记页都搜它；
        // 下游这层把读库失败演成空数组 ⇒ 面板只会说「无命中」。
        // （tests/book-context-builder-real-db.test.ts 27 条 + rag-service 那份扩到 21 条）
        'electron/agent/builders/book-context-builder.ts', // 92 / 88.13 / 100（未盖的是最外层那圈兜底 catch，见下）
        'electron/services/rag-service.ts', // 100 / 100 / 100
      ],
      exclude: [
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.d.ts',
        '**/__tests__/**',
        '**/index.ts',
      ],
      thresholds: {
        // Phase 18 阈值提升（2026-07-23）
        // Phase 17 基线：lines 81.54% / branches 82.3% / functions 73.79%（11 文件）
        // Phase 18 新增 ai-sdk-service.ts + database.ts 持久化/迁移/init 测试后：
        //   ai-sdk-service.ts: 92.85% lines / 100% functions（新增，mock ai 模块）
        //   database.ts: 59.37%→69.24% lines / 52.05%→57.53% functions（+10% lines）
        //   整体提升至：lines 84.86% / branches 81.38% / functions 77.1%
        // 策略：阈值提升到当前基线 - 2% 缓冲
        //   - lines/statements: 80→83（当前 84.86%，留 1.86% 缓冲）
        //   - functions: 70→75（当前 77.1%，留 2.1% 缓冲）
        //   - branches: 80→80（当前 81.38%，留 1.38% 缓冲，维持）
        lines: 83,
        functions: 75,
        branches: 80,
        statements: 83,
      },
    },
    setupFiles: ['./tests/setup.ts', './tests/electron-mock-setup.ts'],
  },
})
