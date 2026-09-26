// weread-sync-manager 行为测试（2026-09-26）
//
// 这份文件是把旧的 `tests/weread-sync-manager.test.ts` 换掉重写的。旧那份的全部断言都是
// `expect(() => startWereadAutoSync()).not.toThrow()`，而且 `vi.mock('./weread-api')` 这类
// 路径是**相对测试文件**解析的 —— 从 tests/ 目录看它指向 `tests/weread-api`，那个文件不存在，
// mock 静默失效，被测模块用的是真的 weread-api / settings-service。所以那份测试一条行为都没钉住
// （覆盖率实测 17.96 / 44.44 / 36.36）。
//
// 这一份只把 mock 打在外围缝隙上（weread-api / database / settings-service / reading-time-sync /
// logger / electron 的 BrowserWindow），剩下的调度、写库、广播全从被测模块自己的代码走。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BrowserWindow } from 'electron'
import type { WereadBookLike } from '../src/shared/weread-book-sync'

const h = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  getBookshelf: vi.fn<() => Promise<WereadBookLike[]>>(),
  getApiKey: vi.fn<() => string>(() => 'test-key'),
  getById: vi.fn<(id: string) => Record<string, unknown> | undefined>(),
  create: vi.fn<(row: Record<string, unknown>) => void>(),
  update: vi.fn<(id: string, fields: Record<string, unknown>) => void>(),
  settingsSet: vi.fn<(key: string, value: unknown) => void>(),
  syncReadingTimeToLocal: vi.fn<() => Promise<void>>(),
}))

vi.mock('../electron/weread-api', () => ({
  getBookshelf: h.getBookshelf,
  getApiKey: h.getApiKey,
}))

vi.mock('../electron/database', () => ({
  booksDb: { getById: h.getById, create: h.create, update: h.update },
}))

vi.mock('../electron/services/settings-service', () => ({
  settingsService: {
    get: (k: string) => h.settings.get(k),
    set: (k: string, v: unknown) => {
      h.settings.set(k, v)
      h.settingsSet(k, v)
    },
    getAll: () => Object.fromEntries(h.settings),
  },
}))

vi.mock('../electron/services/reading-time-sync', () => ({
  syncReadingTimeToLocal: h.syncReadingTimeToLocal,
}))

vi.mock('../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

type ManagerModule = typeof import('../electron/weread-sync-manager')

/** 定时器与 lastAttemptAt 都是模块级状态，每条用例都要拿一个全新的模块实例 */
async function freshManager(): Promise<ManagerModule> {
  vi.resetModules()
  return await import('../electron/weread-sync-manager')
}

function wereadBook(over: Partial<WereadBookLike> = {}): WereadBookLike {
  return {
    bookId: 'bk_1',
    title: '思考，快与慢',
    author: '卡尼曼',
    cover: 'cover.png',
    isbn: '97875086',
    publisher: '中信出版社',
    publishTime: '2011-01-01',
    intro: '一本讲系统1与系统2的书',
    category: '心理学',
    finishReading: 0,
    progress: 0,
    totalChapter: 0,
    lastReadTime: 0,
    readUpdateTime: 1_700_000_000,
    ...over,
  }
}

/** 一条假窗口：只用到 isDestroyed 与 webContents.send */
function fakeWindow(destroyed = false) {
  return {
    isDestroyed: vi.fn(() => destroyed),
    webContents: { send: vi.fn() },
  }
}

const DAY = 24 * 60 * 60 * 1000
const HOUR = 60 * 60 * 1000
const MINUTE = 60 * 1000

/**
 * 广播出去的状态序列。
 * 按窗口对象去重再数 `send` 的调用：`getAllWindows` 每次同步都会被调一遍，
 * 而同一个窗口实例在多次结果里重复出现 —— 不去重就会把"同一窗口收到 2 条"
 * 数成 4 条。
 */
function sentStatuses(): Record<string, unknown>[] {
  const seen = new Set<object>()
  const out: Record<string, unknown>[] = []
  for (const result of vi.mocked(BrowserWindow.getAllWindows).mock.results) {
    for (const win of result.value as ReturnType<typeof fakeWindow>[]) {
      if (seen.has(win)) continue
      seen.add(win)
      for (const call of win.webContents.send.mock.calls) {
        out.push(call[1] as Record<string, unknown>)
      }
    }
  }
  return out
}

/** 最后一条广播出去的状态 */
function lastBroadcast(): Record<string, unknown> | undefined {
  const all = sentStatuses()
  return all[all.length - 1]
}

describe('weread-sync-manager — 后台自动同步的真实行为', () => {
  let mgr: ManagerModule

  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-26T08:00:00.000Z'))

    h.settings.clear()
    h.settings.set('wereadAutoSync', true)
    h.settings.set('wereadSyncFrequency', '1d')
    h.getBookshelf.mockReset()
    h.getApiKey.mockReset()
    h.getApiKey.mockReturnValue('test-key')
    h.getById.mockReset()
    h.getById.mockReturnValue(undefined)
    h.create.mockReset()
    h.update.mockReset()
    h.settingsSet.mockReset()
    h.syncReadingTimeToLocal.mockReset()
    h.syncReadingTimeToLocal.mockResolvedValue(undefined)
    vi.mocked(BrowserWindow.getAllWindows).mockReset()
    vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([fakeWindow()] as unknown as BrowserWindow[])

    mgr = await freshManager()
  })

  afterEach(() => {
    mgr.stopWereadAutoSync()
    vi.useRealTimers()
  })

  /** 触发一次"到期即同步"：无成功记录时 delay 为 0，推进 0ms 就会跑 */
  async function runDue() {
    await vi.advanceTimersByTimeAsync(0)
  }

  describe('该不该跑', () => {
    it('没有 API Key 时一次请求都不发（不设 key 就不该空跑刷日志）', async () => {
      h.getApiKey.mockReturnValue('')
      mgr.startWereadAutoSync()
      await vi.advanceTimersByTimeAsync(25 * HOUR)
      expect(h.getBookshelf).not.toHaveBeenCalled()
    })

    it('wereadAutoSync 关掉时一次都不跑', async () => {
      h.settings.set('wereadAutoSync', false)
      mgr.startWereadAutoSync()
      await vi.advanceTimersByTimeAsync(30 * DAY)
      expect(h.getBookshelf).not.toHaveBeenCalled()
    })

    it('stopWereadAutoSync 之后定时器全清（推进 30 天不再跑）', async () => {
      h.getBookshelf.mockResolvedValue([])
      mgr.startWereadAutoSync()
      await runDue()
      expect(h.getBookshelf).toHaveBeenCalledTimes(1)

      mgr.stopWereadAutoSync()
      await vi.advanceTimersByTimeAsync(30 * DAY)
      expect(h.getBookshelf).toHaveBeenCalledTimes(1)
    })

    it('反复 refresh 不会攒出多条排程链（同一时刻只跑一次）', async () => {
      h.getBookshelf.mockResolvedValue([])
      mgr.startWereadAutoSync()
      mgr.refreshWereadAutoSyncTimer()
      mgr.refreshWereadAutoSyncTimer()
      await runDue()
      expect(h.getBookshelf).toHaveBeenCalledTimes(1)

      // 兜底检查的 interval 也只许有一条：一小时后到点，补跑的是"一次"而不是"三次"
      //（startHourlyCheck 自己不再清旧定时器，清理归 applyWereadAutoSyncSettings 一处做）
      await vi.advanceTimersByTimeAsync(HOUR)
      expect(h.getBookshelf).toHaveBeenCalledTimes(2)
    })
  })

  describe('写库', () => {
    it('书架为空时不写库、不记同步时间、也不广播', async () => {
      h.getBookshelf.mockResolvedValue([])
      mgr.startWereadAutoSync()
      await runDue()
      expect(h.create).not.toHaveBeenCalled()
      expect(h.update).not.toHaveBeenCalled()
      expect(h.settings.get('wereadLastSyncAt')).toBeUndefined()
      expect(sentStatuses()).toHaveLength(0)
    })

    it('库里没有的那本走 create，字段按共享计划写全', async () => {
      h.getBookshelf.mockResolvedValue([wereadBook()])
      h.getById.mockReturnValue(undefined)
      mgr.startWereadAutoSync()
      await runDue()
      expect(h.create).toHaveBeenCalledTimes(1)
      const row = h.create.mock.calls[0][0]
      expect(row.id).toBe('bk_1')
      expect(row.title).toBe('思考，快与慢')
      expect(row.category).toBe('心理学')
      expect(row.last_read_time).toBe(new Date(1_700_000_000 * 1000).toISOString())
    })

    it('库里已有的那本按库里的 id 更新，且**不许写 reading_progress**', async () => {
      // /shelf/sync 不返回 progress，weread-api 一律映射成 0；
      // 一写进库就把 getBookProgress() 缓存的真实进度抹成 0（书架进度归零）。
      h.getBookshelf.mockResolvedValue([wereadBook({ progress: 0 })])
      h.getById.mockReturnValue({ id: 'bk_1', title: '思考，快与慢', reading_progress: 0.82 })
      mgr.startWereadAutoSync()
      await runDue()
      expect(h.create).not.toHaveBeenCalled()
      expect(h.update).toHaveBeenCalledTimes(1)
      const [id, fields] = h.update.mock.calls[0]
      expect(id).toBe('bk_1')
      expect(Object.keys(fields)).not.toContain('reading_progress')
      expect(fields.is_finished).toBe(0)
    })

    it('同名两本（bookId 不同）各自入库，不互相覆盖', async () => {
      // 旧写法按 title 判重：第二本被当成"已有"，于是把第一本的作者/封面盖掉。
      h.getBookshelf.mockResolvedValue([
        wereadBook({ bookId: 'bk_1', title: '活着', author: '余华' }),
        wereadBook({ bookId: 'bk_2', title: '活着', author: '史铁生' }),
      ])
      h.getById.mockImplementation((id: string) =>
        id === 'bk_1' ? { id: 'bk_1', title: '活着', author: '余华' } : undefined,
      )
      mgr.startWereadAutoSync()
      await runDue()
      expect(h.update).toHaveBeenCalledTimes(1)
      expect(h.update.mock.calls[0][0]).toBe('bk_1')
      expect(h.create).toHaveBeenCalledTimes(1)
      expect(h.create.mock.calls[0][0].id).toBe('bk_2')
    })

    it('一本书写失败不影响其余，仍照常记同步时间并广播成功', async () => {
      h.getBookshelf.mockResolvedValue([
        wereadBook({ bookId: 'bk_1', title: '坏了的那本' }),
        wereadBook({ bookId: 'bk_2', title: '好的那本' }),
      ])
      h.create.mockImplementation((row: Record<string, unknown>) => {
        if (row.id === 'bk_1') throw new Error('SQLITE_BUSY')
      })
      mgr.startWereadAutoSync()
      await runDue()
      expect(h.create).toHaveBeenCalledTimes(2)
      expect(h.settings.get('wereadLastSyncAt')).toBeTypeOf('number')
      expect(lastBroadcast()).toMatchObject({ ok: true, total: 2, newCount: 1 })
    })

    it('全部写失败不许报"同步完成"—— 报失败且不记同步时间', async () => {
      h.getBookshelf.mockResolvedValue([wereadBook(), wereadBook({ bookId: 'bk_2' })])
      h.create.mockImplementation(() => {
        throw new Error('SQLITE_BUSY')
      })
      mgr.startWereadAutoSync()
      await runDue()
      expect(lastBroadcast()?.ok).toBe(false)
      expect(String(lastBroadcast()?.error)).toContain('全部写入失败')
      expect(h.settings.get('wereadLastSyncAt')).toBeUndefined()
      // 一本都没落库，就不该再顺带刷阅读时长
      expect(h.syncReadingTimeToLocal).not.toHaveBeenCalled()
    })

    it('拉书架失败：广播失败原因，原样交出 message', async () => {
      h.getBookshelf.mockRejectedValue(new Error('Cookie 已过期'))
      mgr.startWereadAutoSync()
      await runDue()
      expect(lastBroadcast()).toMatchObject({ ok: false, error: 'Cookie 已过期' })
      expect(h.settings.get('wereadLastSyncAt')).toBeUndefined()
    })
  })

  describe('调度节律（这条是防"失败后空转刷屏"的）', () => {
    it('失败后不立刻重来：下一次排在往后一小时，而不是当前这一刻', async () => {
      h.getBookshelf.mockRejectedValue(new Error('HTTP 401: Unauthorized - key 已失效'))

      // 直接看"排下一次时给的 delay"，而不是靠推进时钟去数调用次数：
      // 旧写法每次都排 delay 0，任何 advance 都会把无穷多个定时器追不完（实测表现为墙钟超时，
      // 红是红了，但红得没法读）。把 delay 抓出来，回归时就是一条清楚的断言失败。
      const scheduled: number[] = []
      const current = globalThis.setTimeout
      globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
        scheduled.push(ms ?? 0)
        return current(fn as (...args: unknown[]) => void, ms, ...(rest as []))
      }) as typeof globalThis.setTimeout

      try {
        mgr.startWereadAutoSync()
        await runDue()
        expect(h.getBookshelf).toHaveBeenCalledTimes(1)
        // [0] 是首次（无成功记录时本来就该立刻试一次），[1] 是失败后重排的那一次
        expect(scheduled[0]).toBe(0)
        expect(scheduled[1]).toBeGreaterThanOrEqual(HOUR)

        // 退避按小时：满一小时才重试第二次（渲染层每条失败状态弹一次错误 toast，
        // 空转时那个循环会把界面刷成一片失败提示）
        await vi.advanceTimersByTimeAsync(59 * MINUTE)
        expect(h.getBookshelf).toHaveBeenCalledTimes(1)
        await vi.advanceTimersByTimeAsync(2 * MINUTE)
        expect(h.getBookshelf).toHaveBeenCalledTimes(2)
        expect(sentStatuses()).toHaveLength(2)
      } finally {
        globalThis.setTimeout = current
      }
    })

    it('每小时兜底检查是排程链之外的第二条路：到点就补跑一次', async () => {
      // 书架为空 ⇒ 不记成功时间，下一次只能靠退避 + 兜底检查推动
      h.getBookshelf.mockResolvedValue([])
      mgr.startWereadAutoSync()
      await runDue()
      expect(h.getBookshelf).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(HOUR)
      // 兜底 tick 看到"已经过了一小时退避期"⇒ 补跑；排程链本身排在同一刻，只跑一次
      expect(h.getBookshelf).toHaveBeenCalledTimes(2)
    })

    it('排到点之后 key 没了：这一次直接跳过，不发请求', async () => {
      h.getBookshelf.mockResolvedValue([wereadBook()])
      mgr.startWereadAutoSync()
      // 排程时还有 key，到点时没了（用户在设置里清掉了）—— 同步本体自己也要把这道门
      h.getApiKey.mockReturnValue('')
      await runDue()
      expect(h.getBookshelf).not.toHaveBeenCalled()
      expect(h.create).not.toHaveBeenCalled()
    })

    it('关掉自动同步并 refresh 后：已排的这一次也不跑，之后三小时都静默', async () => {
      // 这是设置页那颗开关的真实通路：ipc/settings 改完 weread* 就调 refresh
      h.getBookshelf.mockResolvedValue([wereadBook()])
      mgr.startWereadAutoSync()
      h.settings.set('wereadAutoSync', false)
      mgr.refreshWereadAutoSyncTimer()

      await vi.advanceTimersByTimeAsync(3 * HOUR)
      expect(h.getBookshelf).not.toHaveBeenCalled()
    })

    it('只改设置没 refresh（理论上的漏通路）：飞出去的这一次跑完就不再续排', async () => {
      // scheduleNextSync 自己那道开关检查就是为这条留的 —— 有它兜着，
      // 忘调 refresh 也只是多跑一次，不会变成每小时打一次的常驻任务
      h.getBookshelf.mockRejectedValue(new Error('网络不通'))
      const scheduled: number[] = []
      const current = globalThis.setTimeout
      globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
        scheduled.push(ms ?? 0)
        return current(fn as (...args: unknown[]) => void, ms, ...(rest as []))
      }) as typeof globalThis.setTimeout

      try {
        mgr.startWereadAutoSync()
        await runDue()
        expect(h.getBookshelf).toHaveBeenCalledTimes(1)

        h.settings.set('wereadAutoSync', false)
        await vi.advanceTimersByTimeAsync(HOUR + 1000)
        expect(h.getBookshelf).toHaveBeenCalledTimes(2)
        // 排程记录停在 [0（首次）, 一小时（第一次失败后的退避）] ——
        // 第二次跑完没有再排第三次，开关检查挡住了它
        expect(scheduled).toEqual([0, HOUR])
      } finally {
        globalThis.setTimeout = current
      }
    })

    it('同步成功后按频率排：一天频率在 23 小时内不跑，满一天跑第二次', async () => {
      h.getBookshelf.mockResolvedValue([wereadBook()])
      mgr.startWereadAutoSync()
      await runDue()
      expect(h.getBookshelf).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(23 * HOUR)
      expect(h.getBookshelf).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1 * HOUR + 1000)
      expect(h.getBookshelf).toHaveBeenCalledTimes(2)
    })

    it('上次同步时间被写到未来（系统时间被往回调）时先试一次，之后按小时退避', async () => {
      h.getBookshelf.mockResolvedValue([])
      h.settings.set('wereadLastSyncAt', Date.now() + 365 * DAY)
      mgr.startWereadAutoSync()
      await runDue()
      expect(h.getBookshelf).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['1d', DAY],
      ['3d', 3 * DAY],
      ['7d', 7 * DAY],
    ])('频率 %s：刚成功过一次，下一次在 %d 毫秒后', async (freq, ms) => {
      h.getBookshelf.mockResolvedValue([])
      h.settings.set('wereadSyncFrequency', freq)
      h.settings.set('wereadLastSyncAt', Date.now())
      mgr.startWereadAutoSync()

      await vi.advanceTimersByTimeAsync(ms - 1000)
      expect(h.getBookshelf).toHaveBeenCalledTimes(0)
      await vi.advanceTimersByTimeAsync(2000)
      expect(h.getBookshelf).toHaveBeenCalledTimes(1)
    })

    it.each([
      // 旧版本存的是"多少分钟"，映射规则：不足 2 天 → 1d，2~5 天 → 3d，其余 → 7d
      [100, DAY],
      [3000, 3 * DAY],
      [10000, 7 * DAY],
    ])('旧版分钟数 %i 分钟按 %d 毫秒的频率排', async (minutes, ms) => {
      h.getBookshelf.mockResolvedValue([])
      h.settings.set('wereadSyncFrequency', minutes)
      h.settings.set('wereadLastSyncAt', Date.now())
      mgr.startWereadAutoSync()

      await vi.advanceTimersByTimeAsync(ms - 1000)
      expect(h.getBookshelf).toHaveBeenCalledTimes(0)
      await vi.advanceTimersByTimeAsync(2000)
      expect(h.getBookshelf).toHaveBeenCalledTimes(1)
    })

    it('无效频率值回退到 1d，不因为读不懂设置就不同步', async () => {
      h.getBookshelf.mockResolvedValue([])
      h.settings.set('wereadSyncFrequency', '每小时')
      h.settings.set('wereadLastSyncAt', Date.now())
      mgr.startWereadAutoSync()

      await vi.advanceTimersByTimeAsync(DAY - 1000)
      expect(h.getBookshelf).toHaveBeenCalledTimes(0)
      await vi.advanceTimersByTimeAsync(2000)
      expect(h.getBookshelf).toHaveBeenCalledTimes(1)
    })
  })

  describe('广播', () => {
    it('只发给没销毁的窗口', async () => {
      const alive = fakeWindow(false)
      const dead = fakeWindow(true)
      vi.mocked(BrowserWindow.getAllWindows).mockReturnValue([alive, dead] as unknown as BrowserWindow[])
      h.getBookshelf.mockResolvedValue([wereadBook()])
      mgr.startWereadAutoSync()
      await runDue()
      expect(alive.webContents.send).toHaveBeenCalledTimes(1)
      expect(dead.webContents.send).not.toHaveBeenCalled()
    })

    it('窗口列举本身抛错时只记日志，绝不让同步失败（同步已经落库了）', async () => {
      h.getBookshelf.mockResolvedValue([wereadBook()])
      vi.mocked(BrowserWindow.getAllWindows).mockImplementation(() => {
        throw new Error('window list broken')
      })
      mgr.startWereadAutoSync()
      await expect(runDue()).resolves.toBeUndefined()
      expect(h.create).toHaveBeenCalledTimes(1)
      expect(h.settings.get('wereadLastSyncAt')).toBeTypeOf('number')
    })
  })

  describe('阅读时长顺带刷新', () => {
    it('拉到了书架就顺带刷一次本地阅读时长（每次同步只多一次请求）', async () => {
      h.getBookshelf.mockResolvedValue([wereadBook()])
      mgr.startWereadAutoSync()
      await runDue()
      expect(h.syncReadingTimeToLocal).toHaveBeenCalledTimes(1)
    })

    it('拉书架失败时不刷阅读时长（没有微信读书的连接，刷了也是白刷）', async () => {
      h.getBookshelf.mockRejectedValue(new Error('timeout'))
      mgr.startWereadAutoSync()
      await runDue()
      expect(h.syncReadingTimeToLocal).not.toHaveBeenCalled()
    })
  })
})
