/// <reference types="vite/client" />

// Vite 的编译期常量（`import.meta.env.*`）类型由此提供。
// 2026-10-05 加：`App.tsx` 用 `import.meta.env.DEV` 把开发期管理后台排除出打包产物
// （Issue #2 方案 1），没有这条引用时 `tsc --noEmit` 报
// `Property 'env' does not exist on type 'ImportMeta'`。