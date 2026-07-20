/// <reference types="vitest" />
/**
 * 知行读书 — Vitest 全局 setup（2026-07-20）
 *
 * 同时支持 node（FSRS 引擎 / IPC）和 jsdom（ECharts 组件）两种环境。
 *
 * - jest-dom 断言扩展：在 jsdom 环境下生效，node 环境下不影响现有断言
 * - TextEncoder/TextDecoder polyfill：补 jsdom 25 在某些 Node 版本下缺失的内置 API
 *   （esbuild 启动时 invariant 检查依赖）
 *
 * 历史：v1.0 仅做 `defineConfig` 占位，无副作用；v1.1 引入 jsdom 测试项目后扩展。
 */
import '@testing-library/jest-dom/vitest'
import { TextEncoder as NodeTextEncoder, TextDecoder as NodeTextDecoder } from 'node:util'

// 补充 jsdom 缺失的 TextEncoder/TextDecoder
if (typeof (globalThis as { TextEncoder?: unknown }).TextEncoder === 'undefined') {
  ;(globalThis as unknown as { TextEncoder: typeof NodeTextEncoder }).TextEncoder = NodeTextEncoder
}
if (typeof (globalThis as { TextDecoder?: unknown }).TextDecoder === 'undefined') {
  ;(globalThis as unknown as { TextDecoder: typeof NodeTextDecoder }).TextDecoder =
    NodeTextDecoder as unknown as typeof globalThis.TextDecoder
}
