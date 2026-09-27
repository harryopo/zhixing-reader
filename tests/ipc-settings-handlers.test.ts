// ipc/settings 的 handler 行为测试（2026-09-27，销覆盖率 DEBT 一笔）
//
// 为什么这批值得做：`electron/ipc/settings.ts` 实测 **38.18%** 的语句被走过 —— 它注册的
// 十条通道里，只有 `SETTINGS.GET` / `GET_ALL` 被 `secret-ipc-boundary.test.ts` 用到，
// 其余（强制落盘、清缓存、外链、存储用量、清历史、**重置数据库**、撤销删除、备份导出/导入）
// 一条没有判据。这个文件里最容易出事的是两处：
//  1) `OPEN_EXTERNAL` 的协议白名单 —— 放开门就是"网页里一个链接能让系统打开任意程序"；
//  2) `RESET_DATABASE` 的收尾顺序 —— 库里注释写着 resetDatabase 只标脏、3 秒防抖落盘，
//     而 500ms 后就 `app.exit(0)`，**不强制同步刷盘的话重置结果根本没落盘**，
//     重启后旧数据复现。顺序与时机只能在这里钉住。
//
// 判据照旧：mock 只打在被测模块外面那圈缝上（settings-service / database / weread-api /
// 自动同步 / 归档 / 备份 / logger），handler 本体走真实注册的那一份。
// 注意 `vi.mock` 的路径**相对本文件解析**，所以写 `../electron/...` 而不是源码里的 `../...`。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { app, shell } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'
import { SECRET_SETTING_KEYS } from '../src/shared/settings-secrets'

/** 独占 profile：这条通路会往 userData 里写真文件（存储用量量的是磁盘） */
const PROFILE = 'user-data-ipc-settings'
process.env.ZHIXING_TEST_PROFILE = PROFILE
const DATA_DIR = join(process.cwd(), '.test-tmp', PROFILE)

type Handler = (...args: unknown[]) => unknown

const seams = vi.hoisted(() => ({
  settings: { get: vi.fn(), set: vi.fn(), getForRenderer: vi.fn() },
  weread: { setApiKey: vi.fn(), clearCache: vi.fn() },
  sync: { refreshWereadAutoSyncTimer: vi.fn() },
  db: { forceSaveDatabase: vi.fn(), clearConversationsAndMessages: vi.fn(), resetDatabase: vi.fn() },
  archive: { archiveAndDelete: vi.fn(), restoreDeleted: vi.fn() },
  backup: { exportBackup: vi.fn(), importBackup: vi.fn() },
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

vi.mock('../electron/services/settings-service', () => ({ settingsService: seams.settings }))
vi.mock('../electron/weread-api', () => ({
  setApiKey: seams.weread.setApiKey,
  clearCache: seams.weread.clearCache,
}))
vi.mock('../electron/weread-sync-manager', () => seams.sync)
vi.mock('../electron/database', () => seams.db)
vi.mock('../electron/services/deleted-archive', () => seams.archive)
vi.mock('../electron/services/backup', () => seams.backup)
vi.mock('../electron/logger', () => ({ logger: seams.logger }))

/** 注册**真实的** registerSettingsHandlers，返回"通道名 → handler" */
async function register() {
  vi.resetModules()
  const { registerSettingsHandlers } = await import('../electron/ipc/settings')
  const handlers = new Map<string, Handler>()
  registerSettingsHandlers((channel: string, handler: Handler) => {
    handlers.set(channel, handler)
  })
  return (name: string): Handler => {
    const fn = handlers.get(name)
    if (!fn) throw new Error(`handler 未注册：${name}`)
    return fn
  }
}

let at: (name: string) => Handler

beforeEach(async () => {
  vi.clearAllMocks()
  fs.rmSync(DATA_DIR, { recursive: true, force: true })
  fs.mkdirSync(DATA_DIR, { recursive: true })
  at = await register()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('SETTINGS.GET：密钥不跨进程下发', () => {
  it.each(SECRET_SETTING_KEYS)('%s 问原值要抛错，而不是回一个"看起来像没配"的空值', (key) => {
    // 回 undefined 会被界面读成"没配"，于是下一次保存就把用户配了半年的 key 清掉了
    expect(() => at(IPC_CHANNELS.SETTINGS.GET)(key)).toThrow(/不跨进程下发/)
    expect(seams.settings.get).not.toHaveBeenCalled()
  })

  it('抛的那句话要指名去读哪个字段（让人一眼知道改哪里）', () => {
    expect(() => at(IPC_CHANNELS.SETTINGS.GET)('wereadApiKey')).toThrow(/wereadApiKeySet/)
  })

  it('非密钥项照常交回服务层的值', () => {
    seams.settings.get.mockReturnValue('deepseek-v4-flash')
    expect(at(IPC_CHANNELS.SETTINGS.GET)('llmModel')).toBe('deepseek-v4-flash')
    expect(seams.settings.get).toHaveBeenCalledWith('llmModel')
  })
})

describe('SETTINGS.SET：写库之后还要把内存里那两份跟着改对', () => {
  it('微信读书 key 一改就立刻应用到 weread-api 内存单例（否则同步报"未设置 Key"）', () => {
    at(IPC_CHANNELS.SETTINGS.SET)('wereadApiKey', 'sk-new')
    expect(seams.settings.set).toHaveBeenCalledWith('wereadApiKey', 'sk-new')
    expect(seams.weread.setApiKey).toHaveBeenCalledWith('sk-new')
    // 没配 key 时定时器不会跑，所以换了 key 必须重排
    expect(seams.sync.refreshWereadAutoSyncTimer).toHaveBeenCalledTimes(1)
  })

  it('值不是字符串时按空串应用，不把 undefined 塞进客户端', () => {
    at(IPC_CHANNELS.SETTINGS.SET)('wereadApiKey', undefined)
    expect(seams.weread.setApiKey).toHaveBeenCalledWith('')
  })

  it('应用到内存失败也不许把整条 set 弄失败（值已经写进设置了）', () => {
    seams.weread.setApiKey.mockImplementation(() => {
      throw new Error('单例炸了')
    })
    expect(() => at(IPC_CHANNELS.SETTINGS.SET)('wereadApiKey', 'sk')).not.toThrow()
    expect(seams.logger.warn).toHaveBeenCalled()
    // 前半句失败不该拖累后半句：定时器仍然重排了
    expect(seams.sync.refreshWereadAutoSyncTimer).toHaveBeenCalledTimes(1)
  })

  it.each(['wereadAutoSync', 'wereadAutoSyncInterval', 'wereadApiKey'])(
    '%s：这三个键各自都会触发重排定时器（一次，不多不少）',
    (key) => {
      at(IPC_CHANNELS.SETTINGS.SET)(key, 'x')
      expect(seams.sync.refreshWereadAutoSyncTimer).toHaveBeenCalledTimes(1)
    },
  )

  it('改别的设置项不许顺手重排定时器（保存一次设置会连发八次 refresh）', () => {
    at(IPC_CHANNELS.SETTINGS.SET)('llmModel', 'deepseek-v4-flash')
    expect(seams.sync.refreshWereadAutoSyncTimer).not.toHaveBeenCalled()
  })

  it('重排失败只记一条警告，返回值仍然是"成功"（设置真的写进去了）', () => {
    seams.sync.refreshWereadAutoSyncTimer.mockImplementation(() => {
      throw new Error('定时器模块没起来')
    })
    expect(at(IPC_CHANNELS.SETTINGS.SET)('wereadAutoSync', true)).toBeUndefined()
    expect(seams.logger.warn).toHaveBeenCalled()
  })
})

describe('设置页那五颗按钮：各自只碰自己该碰的东西', () => {
  it('强制落盘', () => {
    expect(at(IPC_CHANNELS.SYSTEM.FORCE_SAVE_DATABASE)()).toEqual({ success: true })
    expect(seams.db.forceSaveDatabase).toHaveBeenCalledTimes(1)
  })

  it('清理缓存清的是微信读书那三份（不是向量索引，那套早删了）', () => {
    expect(at(IPC_CHANNELS.SYSTEM.CLEAR_CACHE)()).toEqual({ success: true })
    expect(seams.weread.clearCache).toHaveBeenCalledTimes(1)
    expect(seams.db.forceSaveDatabase).not.toHaveBeenCalled()
  })

  it('清理对话历史走单事务那条路', () => {
    expect(at(IPC_CHANNELS.SYSTEM.CLEAR_HISTORY)()).toEqual({ success: true })
    expect(seams.db.clearConversationsAndMessages).toHaveBeenCalledTimes(1)
  })

  it('GET_ALL 走的是"只回配没配"那一份，不是原值那份', () => {
    seams.settings.getForRenderer.mockReturnValue({ wereadApiKeySet: true, llmEndpoint: 'x' })
    expect(at(IPC_CHANNELS.SETTINGS.GET_ALL)()).toEqual({ wereadApiKeySet: true, llmEndpoint: 'x' })
    expect(seams.settings.getForRenderer).toHaveBeenCalledTimes(1)
  })
})

describe('OPEN_EXTERNAL：白名单之外一律不开', () => {
  it.each(['https://github.com/x', 'http://localhost:5500', 'weread://reading?bId=1'])(
    '%s：放形协议开出去，且原样交给系统',
    async (url) => {
      expect(await at(IPC_CHANNELS.SYSTEM.OPEN_EXTERNAL)(url)).toEqual({ opened: true })
      expect(shell.openExternal).toHaveBeenCalledWith(url)
    },
  )

  it('协议大小写不敏感（WEREAD: 也是自家深链）', async () => {
    await at(IPC_CHANNELS.SYSTEM.OPEN_EXTERNAL)('WEREAD://x')
    expect(shell.openExternal).toHaveBeenCalledWith('WEREAD://x')
  })

  // 这些不是"看起来奇怪"，是每一条都能真出事：file:// 能开本地程序，
  // javascript: 能把整段脚本塞给默认浏览器，其余协议同理。
  it.each([
    'file:///C:/Windows/System32/calc.exe',
    'javascript:alert(1)',
    'ftp://example.com',
    'data:text/html,<script>1</script>',
    'mailto:someone@example.com',
    'example.com',
  ])('%s：不开，且一次都不碰 shell', async (url) => {
    await expect(at(IPC_CHANNELS.SYSTEM.OPEN_EXTERNAL)(url)).rejects.toThrow(/allowed/)
    expect(shell.openExternal).not.toHaveBeenCalled()
  })

  it.each([[undefined], [null], [''], [123]])('%s：非字符串或空串直接拒（不传给 shell 去猜）', async (url) => {
    await expect(at(IPC_CHANNELS.SYSTEM.OPEN_EXTERNAL)(url as string)).rejects.toThrow(/Invalid URL/)
    expect(shell.openExternal).not.toHaveBeenCalled()
  })
})

describe('GET_STORAGE_USAGE：量不到就说量不到，不编数字', () => {
  function seed() {
    fs.writeFileSync(join(DATA_DIR, 'zhixing.db'), 'x'.repeat(1024))
    fs.mkdirSync(join(DATA_DIR, 'logs', 'sub'), { recursive: true })
    fs.writeFileSync(join(DATA_DIR, 'logs', 'a.log'), 'yy')
    fs.writeFileSync(join(DATA_DIR, 'logs', 'sub', 'b.log'), 'zzz')
  }

  it('数据库文件按字节量，日志目录连子目录一起累加', () => {
    seed()
    expect(at(IPC_CHANNELS.SYSTEM.GET_STORAGE_USAGE)()).toMatchObject({
      dbBytes: 1024,
      logBytes: 5,
    })
  })

  it('遗留的向量索引目录不存在时是 null（界面据此显示「—」，不是 0 字节）', () => {
    seed()
    const usage = at(IPC_CHANNELS.SYSTEM.GET_STORAGE_USAGE)() as Record<string, number | null>
    expect(usage.vectorBytes).toBeNull()
    expect(usage.dbBytes).toBe(1024)
  })

  it('什么都没种的时候三项都是 null，不是三个 0', () => {
    expect(at(IPC_CHANNELS.SYSTEM.GET_STORAGE_USAGE)()).toEqual({
      dbBytes: null,
      vectorBytes: null,
      logBytes: null,
    })
  })

  it('同名的不是目录而是文件时那一项给 null，另外两项照常量', () => {
    // 名字占了位置但根本不是目录：existsSync 说"有"，readdirSync 当场 ENOTDIR ——
    // 这条 catch 分支只有这个形状能真走到（不 mock fs）。向量索引那套 09-16 撤了，
    // 老用户目录里留个同名文件不稀奇；一处量不出来不许把另外两处一起抹成 0。
    seed()
    fs.writeFileSync(join(DATA_DIR, 'vectra-index'), 'not a directory')
    expect(at(IPC_CHANNELS.SYSTEM.GET_STORAGE_USAGE)()).toMatchObject({
      dbBytes: 1024,
      vectorBytes: null,
      logBytes: 5,
    })
  })
})

describe('RESET_DATABASE：重置要真的落盘，再重启', () => {
  it('resetDatabase 之后必须紧跟一次强制落盘（防抖 3s，而 500ms 后就要 exit）', () => {
    // 这条用例不验重启，所以把定时器冻住：不然回调会在测试跑完后才 fire
    vi.useFakeTimers()
    const order: string[] = []
    seams.db.resetDatabase.mockImplementation(() => order.push('reset'))
    seams.db.forceSaveDatabase.mockImplementation(() => order.push('save'))
    expect(at(IPC_CHANNELS.SYSTEM.RESET_DATABASE)()).toEqual({ success: true })
    expect(order).toEqual(['reset', 'save'])
  })

  it('给前端 500ms 收到响应，到点才 relaunch + exit（早一秒界面就没结果了）', () => {
    vi.useFakeTimers()
    const relaunch = vi.fn()
    const exit = vi.fn()
    Object.assign(app, { relaunch, exit })

    at(IPC_CHANNELS.SYSTEM.RESET_DATABASE)()
    // 边界两头钉：499ms 还不许动手，500ms 必须动手（"给前端留时间"这件事全靠这个数）
    vi.advanceTimersByTime(499)
    expect(relaunch).not.toHaveBeenCalled()
    expect(exit).not.toHaveBeenCalled()

    vi.advanceTimersByTime(1)
    expect(relaunch).toHaveBeenCalledTimes(1)
    // 顺序要紧：先 relaunch 再 exit，反过来新进程会被单实例锁挡住
    expect(relaunch.mock.invocationCallOrder[0]).toBeLessThan(exit.mock.invocationCallOrder[0])
    expect(exit).toHaveBeenCalledWith(0)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('撤销删除与备份：主进程那两份是唯一干活的人', () => {
  it('归档删除把 kind 与 id 原样交过去，结果原样交回来', () => {
    seams.archive.archiveAndDelete.mockReturnValue({ token: 'tk-1', kind: 'highlight' })
    expect(at(IPC_CHANNELS.SYSTEM.ARCHIVE_DELETE)('highlight', 'hl_1')).toEqual({
      token: 'tk-1',
      kind: 'highlight',
    })
    expect(seams.archive.archiveAndDelete).toHaveBeenCalledWith('highlight', 'hl_1')
  })

  it('撤销只认 token', () => {
    seams.archive.restoreDeleted.mockReturnValue({ restored: 3 })
    expect(at(IPC_CHANNELS.SYSTEM.RESTORE_DELETE)('tk-1')).toEqual({ restored: 3 })
    expect(seams.archive.restoreDeleted).toHaveBeenCalledWith('tk-1')
  })

  it('导出/导入都是"一次通道做完"，不再逐表发六次 IPC', () => {
    seams.backup.exportBackup.mockReturnValue({ version: '1.2', tables: {} })
    seams.backup.importBackup.mockReturnValue({ books: 92 })
    expect(at(IPC_CHANNELS.SYSTEM.EXPORT_BACKUP)()).toEqual({ version: '1.2', tables: {} })
    expect(at(IPC_CHANNELS.SYSTEM.IMPORT_BACKUP)({ version: '1.2' })).toEqual({ books: 92 })
    expect(seams.backup.importBackup).toHaveBeenCalledWith({ version: '1.2' })
  })

  it('备份层报错时不把错误吞成 { success: true }（恢复失败必须让界面知道）', () => {
    seams.backup.importBackup.mockImplementation(() => {
      throw new Error('某张表不是行数组')
    })
    expect(() => at(IPC_CHANNELS.SYSTEM.IMPORT_BACKUP)({})).toThrow('某张表不是行数组')
  })
})

describe('这个文件注册的通道集合（少一条或多一条都要先说清）', () => {
  it('十条通道全部注册到位', () => {
    for (const channel of [
      IPC_CHANNELS.SETTINGS.GET,
      IPC_CHANNELS.SETTINGS.SET,
      IPC_CHANNELS.SETTINGS.GET_ALL,
      IPC_CHANNELS.SYSTEM.FORCE_SAVE_DATABASE,
      IPC_CHANNELS.SYSTEM.CLEAR_CACHE,
      IPC_CHANNELS.SYSTEM.OPEN_EXTERNAL,
      IPC_CHANNELS.SYSTEM.GET_STORAGE_USAGE,
      IPC_CHANNELS.SYSTEM.CLEAR_HISTORY,
      IPC_CHANNELS.SYSTEM.RESET_DATABASE,
      IPC_CHANNELS.SYSTEM.ARCHIVE_DELETE,
      IPC_CHANNELS.SYSTEM.RESTORE_DELETE,
      IPC_CHANNELS.SYSTEM.EXPORT_BACKUP,
      IPC_CHANNELS.SYSTEM.IMPORT_BACKUP,
    ]) {
      expect(typeof at(channel)).toBe('function')
    }
  })
})
