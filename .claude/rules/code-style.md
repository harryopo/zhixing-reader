# Code Style Rules — 知行读书

> **适用**：TypeScript / React / Electron 项目所有 `.ts`/`.tsx` 文件
> **强制级别**：pre-commit hook + ESLint 自动检查
> **详细规范参考**：ai-dev-workflow §五（编码规范速查）

---

## 1. TypeScript 基础

### ✅ 必须

```typescript
// ✅ 严格模式（已开）
// tsconfig.json: "strict": true

// ✅ 所有函数/方法必须有显式返回类型
export function getUser(id: string): Promise<User> { ... }

// ✅ 所有组件必须有 Props 接口
interface BookCardProps {
  book: Book;
  onSelect: (id: string) => void;
  disabled?: boolean;
}
export function BookCard({ book, onSelect, disabled = false }: BookCardProps) { ... }

// ✅ 错误类型用 instanceof 区分
if (error instanceof HttpAbortError) {
  // 区分 cancelled/timeout
}

// ✅ 异步函数返回 Promise<T>
export async function fetchBooks(): Promise<Book[]> { ... }
```

### ❌ 禁止

```typescript
// ❌ 禁止 any（除非有充分理由并注释）
const data: any = ...;  // 禁用

// 例外必须用注释说明：
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- IPC 事件原始 payload 类型未定义
const event: any = ipcEvent;

// ❌ 禁止 @ts-ignore
// @ts-ignore  // 禁用，改用 @ts-expect-error 并注释原因

// ❌ 禁止 as 强转绕过类型
const user = response as User;  // 禁用，除非 response 类型不可控

// ❌ 禁止 console.log 提交到代码（debug 用）
console.log('debug');  // 必须删除或换 logger
```

---

## 2. React 19 特别规则

```typescript
// ✅ 函数组件 + Hooks
export function Bookshelf() {
  const books = useBookStore((s) => s.books);
  const { sync, isLoading } = useSync();
  return <div>...</div>;
}

// ✅ Zustand 选择器细粒度订阅
const bookCount = useBookStore((s) => s.books.length);  // ✅ 只订阅 count
const { books, sync } = useBookStore();  // ❌ 全量订阅

// ✅ 事件处理器命名 handleXxx
<button onClick={handleSync} onChange={handleSearch} />

// ✅ useEffect 依赖必须完整
useEffect(() => { loadBooks(bookId); }, [bookId, loadBooks]);

// ✅ lazy + Suspense 按需加载重组件
const AdminPage = lazy(() => import('./pages/admin/AdminPage'));
<Suspense fallback={<Loading />}><AdminPage /></Suspense>

// ❌ 禁止 useEffect 同步 setState（用 useMemo / useState 计算）
useEffect(() => { setFullName(first + last); }, [first, last]);  // ❌
const fullName = useMemo(() => first + last, [first, last]);    // ✅
```

---

## 3. Electron 进程边界

| 进程 | 文件范围 | 禁止 |
|------|---------|------|
| **Main** | `electron/**` | 禁止 `import` React 组件；禁止 `document`/`window` |
| **Preload** | `electron/preload.ts` | 禁止业务逻辑；只做 contextBridge 转发 |
| **Renderer** | `src/renderer/src/**` | 禁止 `require('electron')`；禁止 `ipcRenderer` |
| **Shared** | `src/shared/**` | 只能放类型/常量，**零运行时依赖** |

```typescript
// ✅ 共享类型放 src/shared/
// shared/types.ts
export interface Book { id: string; title: string; }

// ✅ Main 和 Renderer 都可导入
// electron/database.ts
import type { Book } from '../src/shared/types';

// ✅ IPC 通道常量
// shared/ipc-channels.ts
export const IPC_CHANNELS = {
  BOOK: {
    SYNC: 'book:sync',
    LIST: 'book:list',
  }
} as const;
```

---

## 4. 文件组织（Feature-First 风格）

```
src/renderer/src/
├── pages/                  # 路由页面（每个 feature 一个目录）
│   ├── Bookshelf/          # 书架 feature
│   │   ├── Bookshelf.tsx
│   │   ├── BookCard.tsx
│   │   ├── useBookshelf.ts # 本地 hooks
│   │   └── types.ts
│   ├── Review/
│   ├── Chat/
│   └── ...
├── components/             # 跨 feature 通用组件
│   ├── layout/             # Sidebar / Layout
│   ├── chat/               # chat 域通用组件
│   └── ErrorBoundary.tsx
├── stores/                 # 全局 Zustand stores
├── utils/                  # 纯函数工具
└── styles/

electron/
├── main.ts                 # 应用入口
├── preload.ts              # contextBridge
├── ipc.ts                  # IPC handler 注册（legacy，等 P1-2 拆分）
├── database.ts             # sql.js 初始化 + 全部表（legacy，1967 行）
├── agent/                  # AI 智能体
│   ├── orchestrator.ts
│   ├── context-builder.ts
│   └── builders/           # 5 维 ContextBuilder
├── repositories/           # 仓储层（已有但未全用）
├── services/               # 业务服务
│   ├── settings-service.ts
│   └── prompt-registry.ts
└── utils/                  # db.ts 等纯函数
```

**禁止**：
- `src/utils/Helper.ts`（无意义命名）
- `src/components/Misc/index.tsx`（杂物间）
- `src/renderer/src/utils/db-mapper.ts` ✅ 例外（数据库映射是项目级通用工具）

---

## 5. 函数行数与复杂度

| 阈值 | 值 | 工具 | 处理 |
|------|----|------|------|
| 单函数行数 | ≤ 50 行（建议 30） | AI 审查 | 超出必须拆分 |
| 单文件行数 | ≤ 500 行 | ESLint `max-lines` | 超出需说明 + 拆文件计划 |
| 单函数圈复杂度 | ≤ 15 | ESLint `complexity` | 早 return / 抽函数 |
| 目录深度 | ≤ 4 层 | AI 审查 | 抽子目录 |

```typescript
// ❌ 圈复杂度 18（if/else 嵌套）
function processReview(rating, card, settings) {
  if (rating === 1) {
    if (card.state === 'new') { ... } 
    else if (card.state === 'learning') { ... }
    else { ... }
  } else if (rating === 2) {
    if (card.state === 'new') { ... }
    else if (card.state === 'learning') { ... }
    else { ... }
  }
  // ... 嵌套 4 层
}

// ✅ 抽出查表 + 单一职责
function processReview(rating: Rating, card: Card): ReviewResult {
  const handlers = {
    again: () => handleAgain(card),
    hard: () => handleHard(card),
    good: () => handleGood(card),
    easy: () => handleEasy(card),
  };
  return handlers[rating]();
}
```

---

## 6. 命名约定

| 类型 | 命名 | 例子 |
|------|------|------|
| React 组件 | PascalCase | `BookCard`, `ChatBubble` |
| 函数/方法 | camelCase | `getUserById`, `parseHighlight` |
| 常量 | UPPER_SNAKE_CASE | `MAX_RETRY_COUNT`, `DEFAULT_TIMEOUT_MS` |
| 类型/接口 | PascalCase | `Book`, `IPCResult` |
| 文件（组件） | PascalCase.tsx | `BookCard.tsx` |
| 文件（hooks） | use-kebab-case.ts | `use-bookshelf.ts` |
| 文件（工具） | kebab-case.ts | `db-mapper.ts` |
| 目录 | kebab-case | `bookshelf/`, `daily-learning/` |
| 数据库表 | snake_case | `chat_messages`, `book_highlights` |
| IPC 通道常量 | UPPER_SNAKE_CASE 嵌套 | `BOOK.SYNC` |
| IPC 通道字符串 | `domain:action` | `book:sync` |

---

## 7. 注释规范

```typescript
/**
 * 计算 FSRS 卡片的下次复习时间（自实现版本）
 * 比赛后会升级为 ts-fsrs v5（参见 STANDARDS §自检报告 P0）
 * @param card 卡片状态
 * @param rating 用户评分 (1=Again, 2=Hard, 3=Good, 4=Easy)
 * @returns 新的卡片状态 + due time
 */
export function reviewCard(card: Card, rating: Rating): Card { ... }

// 单行注释：解释 WHY，不解释 WHAT
const TIMEOUT_MS = 30_000;  // 微信读书 API 平均响应 8s，3 倍缓冲

// TODO 必须关联 issue
// TODO(#123): 替换为 ts-fsrs 官方实现
```

---

## 8. 测试规范（新增/修改代码时）

```typescript
// ✅ vitest + happy-dom
import { describe, it, expect } from 'vitest';
import { createCard, reviewCard } from './fsrs-engine';

describe('fsrs-engine', () => {
  it('新卡评分 Good 后应有 due 时间', () => {
    const card = createCard('hl-1');
    const next = reviewCard(card, Rating.Good);
    expect(next.due).toBeInstanceOf(Date);
  });
});

// ✅ 测试文件与源码同目录或镜像在 tests/
// electron/fsrs-engine.ts ↔ tests/electron/fsrs-engine.test.ts
```

---

## 9. 提交前 ESLint 必跑

```bash
npm run lint         # 检查
npm run lint:fix     # 自动修复
```

ESLint 配置在 `eslint.config.js`，核心规则：
- `complexity: ['error', 15]`
- `max-lines: ['error', { max: 500, skipBlankLines: true, skipComments: true }]`
- `max-lines-per-function: ['warn', { max: 50 }]`
- `@typescript-eslint/no-explicit-any: 'warn'`（已从 off 改 warn）
- `@typescript-eslint/no-unused-vars: ['error', { argsIgnorePattern: '^_' }]`
- `no-console: ['warn', { allow: ['warn', 'error'] }]`

---

*最后更新：2026-07-20 | 由 ai-dev-workflow skill 自动生成*
