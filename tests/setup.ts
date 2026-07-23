/// <reference types="vitest" />
/**
 * 知行读书 — Vitest 全局 setup（v1.2，2026-07-22）
 *
 * 同时支持 node（FSRS 引擎 / IPC）和 jsdom（React 组件 / ECharts）两种环境。
 *
 * - jest-dom 断言扩展：在 jsdom 环境下生效，node 环境下不影响现有断言
 * - TextEncoder/TextDecoder polyfill：补 jsdom 25 在某些 Node 版本下缺失的内置 API
 *   （esbuild 启动时 invariant 检查依赖）
 * - window.electronAPI mock（v1.2 新增）：renderer 组件通过 contextBridge 调用 IPC，
 *   jsdom 环境没有 preload 注入，必须手动 mock
 * - matchMedia / ResizeObserver / IntersectionObserver mock（v1.2 新增）：
 *   补 jsdom 缺失的浏览器 API，避免组件测试报错
 *
 * 历史：
 *   - v1.0 仅做 `defineConfig` 占位，无副作用
 *   - v1.1 引入 jsdom 测试项目后扩展（jest-dom + TextEncoder polyfill）
 *   - v1.2 补齐 renderer 组件测试缺口（electronAPI / matchMedia / ResizeObserver）
 */
import '@testing-library/jest-dom/vitest'
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'node:util'
import { vi, afterEach } from 'vitest'

// ============================================================================
// 1. TextEncoder / TextDecoder polyfill（jsdom 25 + esbuild invariant 检查）
// ============================================================================

if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === 'undefined') {
  ;(globalThis as unknown as { TextEncoder: typeof NodeTextEncoder }).TextEncoder = NodeTextEncoder
}
if (typeof (globalThis as { TextDecoder?: unknown }).TextDecoder === 'undefined') {
  ;(globalThis as unknown as { TextDecoder: typeof NodeTextDecoder }).TextDecoder =
    NodeTextDecoder as unknown as typeof globalThis.TextDecoder
}

// ============================================================================
// 2. window.electronAPI mock —— renderer 组件测试专用
//    仅在 jsdom 环境下注入（node 环境无 window 对象）
//    用 Proxy 实现惰性 mock：访问任意属性都返回 vi.fn()，无需手写全部 API
// ============================================================================

if (typeof window !== 'undefined') {
  // electronApiMockStore 保存已用到的 mock，便于测试中 vi.mocked() 断言
  const electronApiMockStore: Record<string, unknown> = {}

  // 惰性 mock：访问 electronAPI.book.getAll() 时自动返回 vi.fn().mockResolvedValue(undefined)
  const electronApiMock = new Proxy({} as Record<string, unknown>, {
    get: (_target, prop: string) => {
      if (typeof prop !== 'string') return undefined
      if (!electronApiMockStore[prop]) {
        // 每个命名空间（book / settings / chat 等）也是 Proxy，方法调用自动 mock
        electronApiMockStore[prop] = new Proxy({} as Record<string, unknown>, {
          get: () => vi.fn().mockResolvedValue(undefined),
        })
      }
      return electronApiMockStore[prop]
    },
  })

  Object.defineProperty(window, 'electronAPI', {
    value: electronApiMock,
    writable: true,
    configurable: true,
  })

  // 暴露给测试文件用：globalThis.__electronApiMockStore = electronApiMockStore
  ;(globalThis as Record<string, unknown>).__electronApiMockStore = electronApiMockStore
}

// ============================================================================
// 3. matchMedia / ResizeObserver / IntersectionObserver mock
//    jsdom 不实现这些浏览器 API，组件用到会 TypeError
// ============================================================================

if (typeof window !== 'undefined') {
  // matchMedia：Tailwind 暗色模式 / 响应式断点可能用到
  if (!window.matchMedia) {
    Object.defineProperty(window, 'matchMedia', {
      writable: true,
      configurable: true,
      value: vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(), // deprecated but still used by some libs
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    })
  }

  // ResizeObserver：echarts-for-react / recharts / 滚动条组件可能用到
  if (typeof (window as unknown as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
    class ResizeObserverStub {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
    }
    ;(window as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver =
      ResizeObserverStub
  }

  // IntersectionObserver：懒加载组件可能用到
  if (typeof (window as unknown as { IntersectionObserver?: unknown }).IntersectionObserver === 'undefined') {
    class IntersectionObserverStub {
      observe = vi.fn()
      unobserve = vi.fn()
      disconnect = vi.fn()
      takeRecords = vi.fn(() => [])
    }
    ;(window as unknown as { IntersectionObserver: typeof IntersectionObserverStub }).IntersectionObserver =
      IntersectionObserverStub
  }
}

// ============================================================================
// 4. 每个测试后清理 mock 调用记录，避免跨测试污染
//    vi.clearAllMocks() 清理调用计数但保留实现
//    vi.resetAllMocks() 会重置实现，需要每个测试重新 setup
// ============================================================================

afterEach(() => {
  vi.clearAllMocks()
})
