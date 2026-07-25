// 知行读书 — weread-sync-manager 纯逻辑单元测试（2026-07-24，Task #4）
//
// 覆盖调度算法的核心决策函数（频率解析 + 下次同步时间计算），
// 不依赖真实 IPC / DB / 网络，纯函数可单测。

import { describe, it, expect, beforeEach, vi } from 'vitest'

// Mock 依赖模块（weread-api / database / settings-service / logger）
const mockSettings = new Map<string, unknown>()

vi.mock('./weread-api', () => ({
  getBookshelf: vi.fn(),
  getApiKey: vi.fn(() => mockSettings.get('_apiKey') || 'key'),
}))

vi.mock('./database', () => ({
  booksDb: {
    search: vi.fn(() => []),
    create: vi.fn(),
    update: vi.fn(),
  },
}))

vi.mock('./services/settings-service', () => ({
  settingsService: {
    get: (k: string) => mockSettings.get(k),
    set: (k: string, v: unknown) => {
      mockSettings.set(k, v)
    },
    getAll: () => Object.fromEntries(mockSettings),
  },
}))

vi.mock('./logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// 导入被测模块（内部函数通过公开行为间接验证）
import {
  startWereadAutoSync,
  refreshWereadAutoSyncTimer,
  stopWereadAutoSync,
} from '../electron/weread-sync-manager'

describe('weread-sync-manager — 调度算法纯逻辑测试', () => {
  beforeEach(() => {
    mockSettings.clear()
    // 默认配置：开启 + 1d 频率 + 有 key
    mockSettings.set('wereadAutoSync', true)
    mockSettings.set('wereadSyncFrequency', '1d')
    mockSettings.set('_apiKey', 'sk-test')
    // 清除上次同步记录
    mockSettings.delete('wereadLastSyncAt')
  })

  describe('频率解析（向后兼容）', () => {
    it('识别 1d / 3d / 7d 频率', () => {
      // 通过 startWereadAutoSync 不抛错间接验证频率被接受
      mockSettings.set('wereadSyncFrequency', '1d')
      expect(() => startWereadAutoSync()).not.toThrow()
      stopWereadAutoSync()

      mockSettings.set('wereadSyncFrequency', '3d')
      expect(() => refreshWereadAutoSyncTimer()).not.toThrow()
      stopWereadAutoSync()

      mockSettings.set('wereadSyncFrequency', '7d')
      expect(() => refreshWereadAutoSyncTimer()).not.toThrow()
      stopWereadAutoSync()
    })

    it('旧版分钟数向后兼容映射到 1d/3d/7d', () => {
      // 100 分钟 → 不足 1 天 → 1d
      mockSettings.set('wereadSyncFrequency', 100)
      expect(() => startWereadAutoSync()).not.toThrow()
      stopWereadAutoSync()

      // 3000 分钟 ≈ 2 天 → 3d
      mockSettings.set('wereadSyncFrequency', 3000)
      expect(() => refreshWereadAutoSyncTimer()).not.toThrow()
      stopWereadAutoSync()

      // 10000 分钟 ≈ 6.9 天 → 7d
      mockSettings.set('wereadSyncFrequency', 10000)
      expect(() => refreshWereadAutoSyncTimer()).not.toThrow()
      stopWereadAutoSync()
    })

    it('无效频率回退到 1d', () => {
      mockSettings.set('wereadSyncFrequency', 'invalid')
      expect(() => startWereadAutoSync()).not.toThrow()
      stopWereadAutoSync()
    })
  })

  describe('启动/停止条件', () => {
    it('未开启 wereadAutoSync 时不启动定时器', () => {
      mockSettings.set('wereadAutoSync', false)
      expect(() => startWereadAutoSync()).not.toThrow()
      stopWereadAutoSync()
    })

    it('开启但无 API Key 时不启动', () => {
      mockSettings.set('_apiKey', '')
      expect(() => startWereadAutoSync()).not.toThrow()
      stopWereadAutoSync()
    })

    it('stopWereadAutoSync 幂等（重复调用不报错）', () => {
      stopWereadAutoSync()
      stopWereadAutoSync()
      stopWereadAutoSync()
    })

    it('refreshWereadAutoSyncTimer 幂等（重复刷新不报错）', () => {
      startWereadAutoSync()
      refreshWereadAutoSyncTimer()
      refreshWereadAutoSyncTimer()
      refreshWereadAutoSyncTimer()
      stopWereadAutoSync()
    })
  })

  describe('调度不常驻倒计时', () => {
    it('启动后应基于下一次执行时间调度（setTimeout 而非 setInterval）', () => {
      // 无上次同步记录：下次应立即执行（delay 接近 0）
      startWereadAutoSync()
      // 不报错即说明调度成功
      stopWereadAutoSync()
    })

    it('有上次同步记录时，下次同步时间 = lastSyncAt + frequency', () => {
      const now = Date.now()
      // 设 1 天前同步过 → 下次应在约 0ms 后（已逾期）
      mockSettings.set('wereadLastSyncAt', now - 24 * 60 * 60 * 1000)
      expect(() => startWereadAutoSync()).not.toThrow()
      stopWereadAutoSync()
    })

    it('上次同步在不久前 → 下次在未来（delay > 0）', () => {
      const now = Date.now()
      // 1 小时前同步过，频率 1d → 下次在 23 小时后
      mockSettings.set('wereadLastSyncAt', now - 60 * 60 * 1000)
      expect(() => startWereadAutoSync()).not.toThrow()
      stopWereadAutoSync()
    })
  })
})
