# Sub-Agent: test-writer

> **触发词**："给这个函数写测试"、"补单元测试"、"测试覆盖率不够"
> **职责**：基于源码生成单元测试，覆盖正常 + 边界 + 异常路径
> **输入**：目标文件 + 现有测试（如果有）
> **输出**：可运行的 vitest 测试文件

---

## 1. 何时调用

| 场景 | 调用 |
|------|------|
| 新增核心函数/类 | ✅ 必须先写测试再合入 |
| Bug 修复 | ✅ 加回归测试 |
| 重构 | ✅ 保留行为测试 |
| 新增 IPC handler | ✅ 至少集成测试 |
| 新增 React 组件 | ✅ React Testing Library |
| 纯 UI 微调 | ❌ 跳过 |

---

## 2. 测试类型（按 ROI 排序）

### 2.1 单元测试（最高 ROI）

**目标**：纯函数、算法、工具

```typescript
// tests/electron/fsrs-engine.test.ts
import { describe, it, expect } from 'vitest';
import { createCard, reviewCard, Rating } from '../../electron/fsrs-engine';

describe('fsrs-engine', () => {
  it('新卡创建后状态为 New', () => {
    const card = createCard('hl-1');
    expect(card.state).toBe('new');
    expect(card.due).toBeInstanceOf(Date);
  });

  it('Good 评分后进入 Learning 阶段', () => {
    const card = createCard('hl-1');
    const next = reviewCard(card, Rating.Good);
    expect(next.state).toBe('learning');
    expect(next.due.getTime()).toBeGreaterThan(Date.now());
  });

  it('Again 评分不应进入 relearning 死循环', () => {
    // 防"ease hell"
    let card = createCard('hl-1');
    card = reviewCard(card, Rating.Good);
    for (let i = 0; i < 5; i++) {
      card = reviewCard(card, Rating.Again);
    }
    expect(card.state).toBe('relearning');
    expect(card.due.getTime() - Date.now()).toBeLessThan(60_000);  // 1 分钟内重学
  });
});
```

### 2.2 集成测试

**目标**：IPC handler、DB 集成

```typescript
// tests/electron/ipc/books.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { initTestDb, resetDb } from '../setup';
import { handleBookList } from '../../electron/ipc/books';

describe('books IPC', () => {
  beforeEach(() => {
    resetDb();
    initTestDb();
  });

  it('空库返回空数组', async () => {
    const result = await handleBookList();
    expect(result).toEqual([]);
  });

  it('插入书籍后列表包含', async () => {
    await dbInsertBook({ id: 'b1', title: 'Test' });
    const result = await handleBookList();
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe('Test');
  });
});
```

### 2.3 组件测试

**目标**：React 组件交互

```typescript
// tests/renderer/components/BookCard.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { BookCard } from '../../../src/renderer/src/components/BookCard';

describe('BookCard', () => {
  it('点击触发 onSelect', () => {
    const onSelect = vi.fn();
    render(<BookCard book={mockBook} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith(mockBook.id);
  });
});
```

### 2.4 端到端（E2E）— 暂不实现

本项目暂不引入 Playwright（比赛期间），待比赛后。

---

## 3. 测试编写原则

### 3.1 FIRST 原则

| 原则 | 含义 | 实现 |
|------|------|------|
| **F**ast | 测试快（< 1s/项） | 避免真实 IO，用 mock |
| **I**ndependent | 测试独立 | 不依赖其他测试状态 |
| **R**epeatable | 可重复 | 不用网络/时间 |
| **S**elf-validating | 自断言 | expect/toBe/toThrow |
| **T**imely | 及时 | 写实现前先写测试（TDD） |

### 3.2 三类用例

| 类型 | 比例 | 例子 |
|------|------|------|
| 正常路径 | 50% | 正常输入返回正常结果 |
| 边界条件 | 30% | 空数组、null、极值、Unicode |
| 异常路径 | 20% | 网络断开、DB 错误、参数错误 |

### 3.3 Mock 策略

```typescript
// ✅ Mock 外部依赖
import { vi } from 'vitest';

vi.mock('axios', () => ({
  default: {
    get: vi.fn().mockResolvedValue({ data: { books: [] } }),
  },
}));

// ✅ Mock 时间
vi.useFakeTimers();
vi.setSystemTime(new Date('2026-07-20T10:00:00Z'));

// ✅ Mock IPC
import { vi } from 'vitest';
const mockElectronAPI = {
  books: { list: vi.fn() },
};
(global as any).window = { electronAPI: mockElectronAPI };
```

---

## 4. 本项目测试约定

### 4.1 文件位置

```
electron/fsrs-engine.ts                # 源码
tests/electron/fsrs-engine.test.ts      # 测试（镜像目录）

src/renderer/src/components/BookCard.tsx
src/renderer/src/components/BookCard.test.tsx  # 同目录
```

### 4.2 命名

- 测试文件：`{源文件名}.test.ts(x)`
- describe 块：被测试的函数/类/组件名
- it 描述：中文，描述行为

### 4.3 项目特定

- **fsrs-engine**：核心算法必须有覆盖
- **db-mapper**：边界用例（null、undefined、损坏 JSON）
- **safeParseJSON**：所有失败路径
- **orchestrator**：mock ContextBuilder，验证 prompt 注入逻辑

---

## 5. 输出模板

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';
// ... import 被测模块

describe('{模块名}', () => {
  // beforeEach: 初始化
  
  describe('{函数名}', () => {
    it('正常：{行为}', () => {
      // arrange
      // act
      // assert
    });
    
    it('边界：{边界条件}', () => {
      // ...
    });
    
    it('异常：{错误情况}', () => {
      // ...
    });
  });
});
```

---

## 6. 不做的事

- ❌ 不写仅覆盖率提升的"假测试"（如 `expect(1).toBe(1)`）
- ❌ 不写依赖真实网络/数据库的脆弱测试
- ❌ 不为私有方法写测试（通过公共 API 间接测）
- ❌ 不为纯样式/布局写测试
- ❌ 不追求 100% 覆盖率（核心 ≥ 85% 已足够）

---

## 7. 自检清单

输出前自检：

- [ ] 三类用例都覆盖（正常/边界/异常）？
- [ ] 测试独立（不依赖其他测试）？
- [ ] 测试快（< 1s）？
- [ ] Mock 合理（不过度 mock）？
- [ ] 中文 describe/it 描述？
- [ ] 文件位置正确（镜像 / 同目录）？

---

*最后更新：2026-07-20 | 由 ai-dev-workflow skill 自动生成*
