// 知行读书 — 测试环境 electron 模块 mock（2026-07-20）
//
// 背景：electron/*.ts 顶层会 `import { app } from 'electron'`，并在模块加载时
//       调用 app.getPath('userData')。在 vitest node 环境下没有真实 electron，
//       会抛 "Cannot read properties of undefined (reading 'getPath')"。
//
// 策略：用 vi.mock 提供一个最小可用的 electron stub，覆盖 app / BrowserWindow /
//       net / ipcMain / ipcRenderer / contextBridge 等常用 API。
//
// 影响范围：所有 electron/* 主进程模块的纯逻辑测试。
// 不影响：fsrs-engine / template-engine / prompt-registry / http-client / ipc-channels
//        等无 electron 依赖的测试（mock 仍然生效但 noop）。

import { vi } from 'vitest'

// 用 vi.hoisted 避免 hoisting 问题
const { mockElectron } = vi.hoisted(() => ({
  mockElectron: {
    app: {
      getPath: vi.fn((name: string) => {
        if (name === 'userData') return `${process.cwd()}/.test-tmp/user-data`
        if (name === 'logs') return `${process.cwd()}/.test-tmp/logs`
        if (name === 'temp') return `${process.cwd()}/.test-tmp/temp`
        return `${process.cwd()}/.test-tmp/temp`
      }),
      getVersion: vi.fn(() => '1.0.0-test'),
      getName: vi.fn(() => 'zhixing-reader-test'),
      isReady: vi.fn(() => true),
      whenReady: vi.fn(() => Promise.resolve()),
      on: vi.fn(),
      once: vi.fn(),
      quit: vi.fn(),
      exit: vi.fn(),
    },
    BrowserWindow: vi.fn().mockImplementation(() => ({
      webContents: { send: vi.fn(), on: vi.fn() },
      isDestroyed: vi.fn(() => false),
      on: vi.fn(),
      once: vi.fn(),
      show: vi.fn(),
      close: vi.fn(),
      loadURL: vi.fn(),
      loadFile: vi.fn(),
    })),
    ipcMain: {
      handle: vi.fn(),
      on: vi.fn(),
      removeHandler: vi.fn(),
      removeAllListeners: vi.fn(),
    },
    ipcRenderer: {
      invoke: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn(),
      send: vi.fn(),
    },
    contextBridge: {
      exposeInMainWorld: vi.fn(),
    },
    dialog: {
      showMessageBox: vi.fn(),
      showOpenDialog: vi.fn(),
      showSaveDialog: vi.fn(),
    },
    safeStorage: {
      encryptString: vi.fn((s: string) => Buffer.from(`encrypted:${s}`)),
      decryptString: vi.fn((b: Buffer) => b.toString().replace(/^encrypted:/, '')),
      isEncryptionAvailable: vi.fn(() => true),
    },
    net: {
      fetch: vi.fn(),
    },
    shell: {
      openExternal: vi.fn(),
      openPath: vi.fn(),
    },
  },
}))

vi.mock('electron', () => mockElectron)
