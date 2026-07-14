# 每日学习模块修复 — 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复每日学习模块 14 项问题，分 3 阶段：Bug 修复 → 功能补齐 → UI/UX 优化

**Architecture:** 主进程（ipc.ts/database.ts）修复数据持久化和导入问题；渲染进程（DailyLearning.tsx）修复数据流、新增复习界面和筛选功能；AI 服务（ai-service.ts）新增翻译能力

**Tech Stack:** Electron + React 19 + TypeScript + Zustand + sql.js + FSRS

---

## 文件结构

| 文件 | 操作 | 职责 |
|------|------|------|
| `electron/ipc.ts` | 修改 | RSS 持久化 + AI 翻译触发 + IPC 事件 |
| `electron/database.ts` | 修改 | require → import 修复 |
| `electron/ai-service.ts` | 修改 | 新增 translateArticle 函数 |
| `src/renderer/src/pages/DailyLearning.tsx` | 大量修改 | 全部前端改动 |
| `src/renderer/src/stores/dailyLearningStore.ts` | 新建 | 筛选状态管理 |

---

## 阶段 1 — Bug 修复

### Task 1: RSS 文章持久化

**Files:**
- Modify: `electron/ipc.ts:105-108`

- [ ] **Step 1: 修改 FETCH_RSS handler，添加持久化逻辑**

将 `ipc.ts` 第 105-108 行：
```typescript
handle(IPC_CHANNELS.ARTICLES.FETCH_RSS, async () => {
    const articles = await fetchAllRssSources();
    return articles;
});
```

改为：
```typescript
handle(IPC_CHANNELS.ARTICLES.FETCH_RSS, async () => {
    const rssArticles = await fetchAllRssSources();
    const savedArticles = [];
    const seenTitles = new Set<string>();

    for (const article of rssArticles) {
      // 基于标题去重
      const titleKey = article.title.toLowerCase().trim();
      if (seenTitles.has(titleKey)) continue;
      seenTitles.add(titleKey);

      // 检查数据库是否已存在
      const existing = articlesDb.getAll(1000).find(
        (a: Record<string, unknown>) =>
          String(a.title_en || '').toLowerCase().trim() === titleKey
      );
      if (existing) continue;

      // 生成文章 ID
      const id = generateArticleId(article.source, article.title);

      // 存入数据库
      const created = articlesDb.create({
        id,
        title_en: article.title,
        content_en: article.content || article.description,
        source: article.source,
        source_url: article.link,
        source_website: article.sourceWebsite,
        category: article.category,
        difficulty: article.difficulty,
        published_at: article.pubDate,
      });

      if (created) {
        savedArticles.push({ id, title: article.title, source: article.source });
      }
    }

    return savedArticles;
});
```

- [ ] **Step 2: 运行 typecheck 验证**

Run: `npm run typecheck`
Expected: PASS（无新增错误）

- [ ] **Step 3: 运行 lint 验证**

Run: `npm run lint`
Expected: PASS

---

### Task 2: 删除多余 unwrap + 生词本加载

**Files:**
- Modify: `src/renderer/src/pages/DailyLearning.tsx`

- [ ] **Step 1: 删除 unwrap 函数**

删除第 5-12 行的 `unwrap` 函数定义。

- [ ] **Step 2: 替换所有 unwrap 调用**

将文件中所有 `unwrap<T>(res)` 调用替换为直接使用 `res`，并添加防御性检查：

```typescript
// loadArticles 中：
const data = await window.electronAPI.article.getAll()
const articles = Array.isArray(data) ? data : []
if (articles.length > 0) {
  setArticles(articles as Article[])
  preloadWordCache(articles[0] as Article)
}
// 删除 else 分支中的 SAMPLE_ARTICLES

// fetchRss 按钮中：
const data = await window.electronAPI.article.fetchRss()
const savedArticles = Array.isArray(data) ? data : []
if (savedArticles.length > 0) {
  await loadArticles() // 重新从数据库加载
  toast.success(`获取到 ${savedArticles.length} 篇新文章`)
}

// handleToggleFavorite 中：
const isFav = await window.electronAPI.article.toggleFavorite(article.id)
if (typeof isFav === 'boolean') {
  // ...
}
```

- [ ] **Step 3: 添加生词本加载**

在 `useEffect` 中添加：
```typescript
const loadVocabulary = async () => {
  try {
    const data = await window.electronAPI.vocabulary.getAll()
    const vocabList = Array.isArray(data) ? data : []
    setVocabulary(vocabList as unknown as Vocabulary[])
  } catch (error) {
    console.error('加载生词本失败:', error)
  }
}

useEffect(() => {
  loadArticles()
  loadVocabulary()
  // ...guide 逻辑保持不变
}, [])
```

- [ ] **Step 4: 运行 typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

---

### Task 3: require() 改为 import

**Files:**
- Modify: `electron/database.ts:1-7`（顶部 import 区）
- Modify: `electron/database.ts:1217-1219`（函数内 require）

- [ ] **Step 1: 添加顶层 import**

在 `database.ts` 顶部（第 7 行附近）添加：
```typescript
import { reviewVocabulary } from './fsrs-engine';
```

- [ ] **Step 2: 删除函数内 require**

删除 `updateReviewData` 函数内的：
```typescript
const { reviewVocabulary } = require('../fsrs-engine');
const Rating = require('../fsrs-engine').Rating;
```

- [ ] **Step 3: 确认 Rating 已导入**

检查 `database.ts` 顶部是否已有 `Rating` 的导入。如果没有，在 import 行添加：
```typescript
import { reviewVocabulary, Rating } from './fsrs-engine';
```

- [ ] **Step 4: 运行 typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

---

## 阶段 2 — 功能补齐

### Task 4: 生词复习界面

**Files:**
- Modify: `src/renderer/src/pages/DailyLearning.tsx`

- [ ] **Step 1: 添加复习相关状态**

在组件状态中添加：
```typescript
const [vocabTab, setVocabTab] = useState<'all' | 'review'>('all')
const [reviewingWord, setReviewingWord] = useState<Vocabulary | null>(null)
const [dueWords, setDueWords] = useState<Vocabulary[]>([])
```

- [ ] **Step 2: 添加加载待复习单词函数**

```typescript
const loadDueWords = async () => {
  try {
    const data = await window.electronAPI.vocabulary.getDueForReview()
    const words = Array.isArray(data) ? data : []
    setDueWords(words as unknown as Vocabulary[])
  } catch (error) {
    console.error('加载待复习单词失败:', error)
  }
}
```

在 `loadVocabulary` 后调用 `loadDueWords()`。

- [ ] **Step 3: 添加复习操作函数**

```typescript
const handleReviewWord = async (wordId: string, quality: number) => {
  try {
    await window.electronAPI.vocabulary.updateReviewData(wordId, { quality })
    toast.success(quality >= 3 ? '记住了！' : '继续加油')
    setReviewingWord(null)
    await loadVocabulary()
    await loadDueWords()
  } catch (error) {
    console.error('复习失败:', error)
    toast.error('复习失败')
  }
}
```

- [ ] **Step 4: 修改生词本面板 UI**

在生词本面板中添加 Tab 切换和复习卡片 UI：
```tsx
{/* Tab 切换 */}
<div className="flex border-b border-gray-200">
  <button
    onClick={() => setVocabTab('all')}
    className={`flex-1 py-2 text-sm font-medium ${vocabTab === 'all' ? 'text-emerald-600 border-b-2 border-emerald-600' : 'text-gray-500'}`}
  >
    全部 ({vocabulary.length})
  </button>
  <button
    onClick={() => setVocabTab('review')}
    className={`flex-1 py-2 text-sm font-medium ${vocabTab === 'review' ? 'text-emerald-600 border-b-2 border-emerald-600' : 'text-gray-500'}`}
  >
    待复习 ({dueWords.length})
  </button>
</div>

{/* 复习模式 */}
{vocabTab === 'review' && (
  reviewingWord ? (
    <div className="p-4">
      <div className="text-center mb-6">
        <div className="text-2xl font-bold text-gray-900 mb-2">{reviewingWord.word}</div>
        {reviewingWord.phonetic && <div className="text-sm text-gray-500">{reviewingWord.phonetic}</div>}
      </div>
      <div className="space-y-2">
        <button onClick={() => handleReviewWord(reviewingWord.id, 1)} className="w-full py-3 bg-red-100 text-red-700 rounded-lg hover:bg-red-200">忘记</button>
        <button onClick={() => handleReviewWord(reviewingWord.id, 3)} className="w-full py-3 bg-yellow-100 text-yellow-700 rounded-lg hover:bg-yellow-200">模糊</button>
        <button onClick={() => handleReviewWord(reviewingWord.id, 4)} className="w-full py-3 bg-green-100 text-green-700 rounded-lg hover:bg-green-200">认识</button>
      </div>
    </div>
  ) : dueWords.length > 0 ? (
    <div className="p-4 text-center">
      <button onClick={() => setReviewingWord(dueWords[0])} className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
        开始复习 ({dueWords.length} 词)
      </button>
    </div>
  ) : (
    <p className="text-gray-500 text-sm text-center p-4">今日暂无待复习单词</p>
  )
)}
```

- [ ] **Step 5: 运行 typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

---

### Task 5: AI 中文翻译

**Files:**
- Modify: `electron/ai-service.ts`（新增 translateArticle 函数）
- Modify: `electron/ipc.ts`（FETCH_RSS 中触发翻译）
- Modify: `src/renderer/src/pages/DailyLearning.tsx`（监听翻译进度）

- [ ] **Step 1: 在 ai-service.ts 新增翻译函数**

```typescript
export async function translateArticle(
  titleEn: string,
  contentEn: string,
  onProgress?: (stage: string) => void
): Promise<{ title_zh: string; summary_zh: string; content_zh: string }> {
  const config = getAIConfig();
  if (!config.apiKey) {
    throw new Error('未配置 AI API Key，无法翻译');
  }

  onProgress?.('translating_title');

  // 翻译标题和摘要
  const titlePrompt = `将以下英文文章标题翻译为中文，只返回翻译结果：\n${titleEn}`;
  const titleResult = await callLLM(config, [{ role: 'user', content: titlePrompt }]);
  const title_zh = titleResult.trim();

  onProgress?.('translating_content');

  // 翻译正文（分段翻译避免超长）
  const paragraphs = contentEn.split('\n\n').filter(p => p.trim());
  const contentParagraphs: string[] = [];

  for (const para of paragraphs) {
    const paraPrompt = `将以下英文段落翻译为中文，保持段落结构，只返回翻译结果：\n${para}`;
    const paraResult = await callLLM(config, [{ role: 'user', content: paraPrompt }]);
    contentParagraphs.push(paraResult.trim());
  }

  const content_zh = contentParagraphs.join('\n\n');
  const summary_zh = contentParagraphs[0]?.slice(0, 100) + '...' || '';

  return { title_zh, summary_zh, content_zh };
}
```

- [ ] **Step 2: 在 ipc.ts 的 FETCH_RSS 中添加翻译触发**

在文章存入数据库后，异步触发翻译（不阻塞返回）：
```typescript
// 在 savedArticles.push 之后添加：
// 异步翻译（不阻塞）
translateArticle(article.title, article.content || article.description)
  .then(({ title_zh, summary_zh, content_zh }) => {
    const db = getDatabase();
    db.run(
      'UPDATE articles SET title_zh = ?, summary_zh = ?, content_zh = ? WHERE id = ?',
      [title_zh, summary_zh, content_zh, id]
    );
    saveDatabase();
  })
  .catch(err => logger.error('Article translation failed', { error: String(err) }));
```

- [ ] **Step 3: 运行 typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

---

### Task 6: 文章筛选栏

**Files:**
- Create: `src/renderer/src/stores/dailyLearningStore.ts`
- Modify: `src/renderer/src/pages/DailyLearning.tsx`

- [ ] **Step 1: 创建筛选 store**

```typescript
import { create } from 'zustand'

interface DailyLearningState {
  difficultyFilter: 'all' | 'cet4' | 'cet6' | 'graduate'
  statusFilter: 'all' | 'unread' | 'read' | 'favorite'
  setDifficultyFilter: (filter: 'all' | 'cet4' | 'cet6' | 'graduate') => void
  setStatusFilter: (filter: 'all' | 'unread' | 'read' | 'favorite') => void
}

export const useDailyLearningStore = create<DailyLearningState>((set) => ({
  difficultyFilter: 'all',
  statusFilter: 'all',
  setDifficultyFilter: (filter) => set({ difficultyFilter: filter }),
  setStatusFilter: (filter) => set({ statusFilter: filter }),
}))
```

- [ ] **Step 2: 在 DailyLearning.tsx 中添加筛选 UI**

在文章头部导航栏下方添加筛选栏，使用 store 中的筛选状态过滤 `articles` 数组。

- [ ] **Step 3: 运行 typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

---

## 阶段 3 — UI/UX 优化

### Task 7: 绿色主题 + 非衬线字体

**Files:**
- Modify: `src/renderer/src/pages/DailyLearning.tsx`

- [ ] **Step 1: 全局颜色替换**

将所有颜色类名替换为绿色系：
- `bg-gray-50` → `bg-emerald-50/30`
- `bg-blue-50` → `bg-emerald-50`
- `text-blue-600` → `text-emerald-600`
- `bg-primary` → `bg-emerald-600`
- `border-gray-200` → `border-emerald-200`
- `text-primary` → `text-emerald-600`

- [ ] **Step 2: 字体替换**

将所有 `font-serif` 改为 `font-sans`。

- [ ] **Step 3: 运行 typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

---

### Task 8: 删除硬编码示例文章

**Files:**
- Modify: `src/renderer/src/pages/DailyLearning.tsx`

- [ ] **Step 1: 删除 SAMPLE_ARTICLES 常量**

删除第 47-102 行的 `SAMPLE_ARTICLES` 定义。

- [ ] **Step 2: 修改空状态 UI**

将空状态改为引导页：
```tsx
<div className="flex flex-col items-center justify-center h-full p-8">
  <div className="text-6xl mb-4">📖</div>
  <h2 className="text-2xl font-bold text-gray-900 mb-2">开始每日英语学习</h2>
  <p className="text-gray-600 mb-2 text-center max-w-md">
    从心理学、认知科学、自我提升等领域的优质英文文章中学习
  </p>
  <p className="text-gray-500 mb-6 text-sm">
    支持四级 / 六级 / 考研难度，悬停查词，一键收藏生词
  </p>
  <button onClick={handleFetchRss} className="px-6 py-3 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
    获取最新文章
  </button>
</div>
```

- [ ] **Step 3: 运行 typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

---

### Task 9: 优化单词缓存 + 右键菜单边界 + 段落分割 + Tooltip

**Files:**
- Modify: `src/renderer/src/pages/DailyLearning.tsx`

- [ ] **Step 1: 优化 preloadWordCache**

改为只缓存词典有收录的单词，上限 200：
```typescript
const preloadWordCache = useCallback(async (article: Article) => {
  const words = article.content_en.match(/\b[a-zA-Z]{3,}\b/g) || []
  const uniqueWords = [...new Set(words.map(w => w.toLowerCase()))]
  if (uniqueWords.length === 0) return

  try {
    const batchResult = await window.electronAPI.dictionary.lookupBatch(uniqueWords)
    const cache = wordCacheRef.current
    cache.clear()
    let count = 0
    if (batchResult && typeof batchResult === 'object') {
      for (const [word, entry] of Object.entries(batchResult)) {
        if (entry && count < 200) {
          cache.set(word, entry as Record<string, unknown>)
          count++
        }
      }
    }
  } catch (error) {
    console.error('预加载单词缓存失败:', error)
  }
}, [])
```

- [ ] **Step 2: 右键菜单边界检测**

```typescript
const handleWordContextMenu = useCallback((word: string, event: React.MouseEvent) => {
  event.preventDefault()
  const cleanWord = word.replace(/[^a-zA-Z]/g, '').toLowerCase()
  if (cleanWord.length < 3) return

  const menuWidth = 180
  const menuHeight = 100
  let x = event.clientX
  let y = event.clientY

  if (x + menuWidth > window.innerWidth) x = window.innerWidth - menuWidth
  if (y + menuHeight > window.innerHeight) y = window.innerHeight - menuHeight

  setContextMenu({ x, y, word: cleanWord })
}, [])
```

- [ ] **Step 3: 段落分割优化**

```typescript
const paragraphs = currentArticle.content_en.split(/\n\s*\n/).filter(p => p.trim())
const zhParagraphs = (currentArticle.content_zh || '').split(/\n\s*\n/).filter(p => p.trim())

// 渲染时处理段落数不匹配
{paragraphs.map((para, index) => {
  const zhPara = zhParagraphs[index] || null
  // ...
})}
```

- [ ] **Step 4: Tooltip 交互优化**

移除 `pointer-events-none`，在 tooltip 内添加"添加到生词本"按钮：
```tsx
{tooltipContent && (
  <button
    onClick={handleAddToVocabulary}
    className="mt-2 w-full py-1.5 bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100 text-xs font-medium"
  >
    + 添加到生词本
  </button>
)}
```

- [ ] **Step 5: 运行 typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

---

### Task 10: 生词本面板增强

**Files:**
- Modify: `src/renderer/src/pages/DailyLearning.tsx`

- [ ] **Step 1: 增强单词卡片显示**

在每个单词卡片中添加学习阶段标签和下次复习时间：
```tsx
const getStageLabel = (stage: number) => {
  const labels: Record<number, string> = { 0: '新词', 1: '学习中', 2: '复习中' }
  return labels[stage] || '新词'
}

const getRelativeTime = (dateStr: string) => {
  if (!dateStr) return ''
  const diff = new Date(dateStr).getTime() - Date.now()
  if (diff <= 0) return '现在'
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}分钟后`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}小时后`
  return `${Math.floor(hours / 24)}天后`
}
```

- [ ] **Step 2: 添加删除和标记掌握操作**

在右键菜单或单词卡片上添加操作按钮。

- [ ] **Step 3: 运行 typecheck + lint**

Run: `npm run typecheck && npm run lint`
Expected: PASS

---

## 最终验证

- [ ] **Step 1: 完整构建验证**

Run: `npm run typecheck && npm run lint && npm run build`
Expected: 全部 PASS

- [ ] **Step 2: 开发模式手动验证**

Run: `npm run dev`
验证清单：
1. 点击"获取最新文章"→ 文章存入数据库 → 重启后文章仍存在
2. 生词本面板打开时显示已有数据
3. 待复习单词可正常复习
4. 新文章自动获得中文翻译
5. 筛选栏正常工作
6. 绿色主题显示正确
7. 右键菜单不超出屏幕
8. 悬停查词正常
