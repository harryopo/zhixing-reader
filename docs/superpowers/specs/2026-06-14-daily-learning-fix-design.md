# 每日学习模块修复设计文档

**日期：** 2026-06-14
**模块：** 每日学习（DailyLearning）
**范围：** 14 项问题修复，分 3 阶段实施

---

## 阶段 1 — Bug 修复（P0）

### 1.1 RSS 文章持久化
- **文件：** `electron/ipc.ts`
- **改动：** `FETCH_RSS` handler 中遍历 `RssArticle[]`，调用 `articlesDb.create()` 逐条存入，基于 title 去重
- **验证：** 抓取文章后重启应用，文章仍存在

### 1.2 删除多余 unwrap
- **文件：** `src/renderer/src/pages/DailyLearning.tsx`
- **改动：** 删除 `unwrap` 函数，所有调用改为直接使用 `invoke()` 返回值 + `Array.isArray()` 防御
- **验证：** 文章列表正常加载，无 undefined 错误

### 1.3 生词本加载已有数据
- **文件：** `src/renderer/src/pages/DailyLearning.tsx`
- **改动：** `useEffect` 中添加 `loadVocabulary()` 调用
- **验证：** 打开生词本面板显示已有数据

### 1.4 require() 改为 import
- **文件：** `electron/database.ts`
- **改动：** 顶部添加 `import { reviewVocabulary } from './fsrs-engine'`，删除函数内 `require()`
- **验证：** `typecheck` 通过，复习功能正常

---

## 阶段 2 — 功能补齐（P1）

### 2.1 生词复习界面
- **文件：** `src/renderer/src/pages/DailyLearning.tsx`
- **改动：** 生词本面板新增"复习"Tab，卡片式 UI，调用 `updateReviewData()`
- **验证：** 待复习单词可正常复习，复习后更新下次复习时间

### 2.2 AI 中文翻译
- **文件：** `electron/ipc.ts`、`electron/ai-service.ts`、`DailyLearning.tsx`
- **改动：** 文章存库后异步调用 AI 翻译，通过 IPC 事件推送进度
- **验证：** 新文章自动获得中文翻译

### 2.3 文章筛选栏
- **文件：** `DailyLearning.tsx`、新建 `dailyLearningStore.ts`
- **改动：** 筛选栏（难度/状态），Zustand store 管理筛选状态
- **验证：** 筛选后文章列表正确过滤

---

## 阶段 3 — UI/UX 优化（P2）

### 3.1 绿色主题 + 非衬线字体
- 主色调 `emerald-500/600`，`font-sans` 替代 `font-serif`

### 3.2 删除硬编码示例文章
- 删除 `SAMPLE_ARTICLES`，空状态显示引导页

### 3.3 优化单词缓存策略
- 只缓存词典有收录的单词，上限 200 词/篇

### 3.4 右键菜单边界检测
- 菜单位置限制在可视区域内

### 3.5 段落分割优化
- 智能对齐中英文段落，fallback 显示"翻译加载中"

### 3.6 生词本面板增强
- "全部"/"待复习" Tab，学习阶段标签，删除/标记掌握操作

### 3.7 Tooltip 交互优化
- 移除 `pointer-events-none`，新增"添加到生词本"按钮

---

## 涉及文件清单

| 文件 | 改动类型 |
|------|---------|
| `electron/ipc.ts` | 修改（RSS 持久化 + AI 翻译触发） |
| `electron/database.ts` | 修改（require → import） |
| `electron/ai-service.ts` | 修改（新增翻译函数） |
| `src/renderer/src/pages/DailyLearning.tsx` | 大量修改（全部阶段） |
| `src/renderer/src/stores/dailyLearningStore.ts` | 新建（筛选状态管理） |
