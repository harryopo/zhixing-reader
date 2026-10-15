// admin 通道的开发闸门（2026-10-10）
//
// ## 病
//
// 上一批（`31790fa`）把 `pages/admin/` 那 1482 行挡在产物之外，标题写的是「安装版里那段
// 代码整个不存在」。页面确实没了，**通道还在**：主进程无条件注册 19 条 `admin:*`，
// preload 也无条件暴露同名方法，而应用菜单里那条「开发者工具」不是 dev-only
// （`electron/main.ts:198`）。装机版开控制台一句 `window.electronAPI.admin.getTableData('conversations')`
// 就能把任意一张表读出来 —— 关掉的只是入口，不是能力。
//
// ## 为什么不能整组关掉
//
// 先查了生产者：这 19 条里有 8 条是**设置页在用**的后台
// （SettingsAgent 的系统提示词、SettingsAI 的自定义模板、SettingsData 的 KPI 读数）。
// 按"这是 admin 通道"一刀切就会把那三个页面一起打断，而单测全绿 ——
// 只有装机版会坏，正是本项目反复吃的"收紧前没查生产者"。
//
// ## 修法
//
// 拆成两半：设置页那 8 条照常注册；读库结构 / 读任意表 / 读全部会话与消息 /
// 整批导入导出提示词 / 重置全部模板 / 内置模板列表这 11 条，装机版一条都不注册。
// 闸门放在注册这一层，不在 preload —— 没人接的通道调用只会 reject，读不到数据。
//
// ## 判据
//
// 量的是"传进去的 handle 到底收到了哪些通道"，不是源码里写了什么字。
// 两种形状都钉：开发形状少一条就红，装机形状多一条也红 —— 后者是这条判据的意义所在，
// 前者是它的正对照（少了正对照，"装机一条都没注册"会因为 mock 挂错而永远绿）。

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

const ROOT = join(__dirname, '..')

/** 开发闸门的当前取值：每个用例自己拧 */
const gate = vi.hoisted(() => ({ isDev: true }))

vi.mock('../electron/user-data', () => ({
  get isDev() {
    return gate.isDev
  },
}))

/** 本层唯一的下游就是服务层；把它换成带记号的可调用替身，断言落在"注册了什么"上 */
const service = vi.hoisted(() => ({
  calls: [] as string[],
}))

function stub(name: string) {
  return vi.fn(() => {
    service.calls.push(name)
    return `svc:${name}`
  })
}

vi.mock('../electron/admin', () => ({
  getAdminStats: stub('getAdminStats'),
  getAgentConfig: stub('getAgentConfig'),
  saveAdminPrompt: stub('saveAdminPrompt'),
  resetAdminPrompt: stub('resetAdminPrompt'),
  createAdminCustomPrompt: stub('createAdminCustomPrompt'),
  updateAdminCustomPrompt: stub('updateAdminCustomPrompt'),
  deleteAdminCustomPrompt: stub('deleteAdminCustomPrompt'),
  getAllAdminCustomPrompts: stub('getAllAdminCustomPrompts'),
  getBooksWithCounts: stub('getBooksWithCounts'),
  getHighlightsByBook: stub('getHighlightsByBook'),
  getCardsByBook: stub('getCardsByBook'),
  getAdminSessions: stub('getAdminSessions'),
  getAdminSessionMessages: stub('getAdminSessionMessages'),
  getAllAdminPrompts: stub('getAllAdminPrompts'),
  resetAllAdminPrompts: stub('resetAllAdminPrompts'),
  exportAdminPrompts: stub('exportAdminPrompts'),
  importAdminPrompts: stub('importAdminPrompts'),
  getDatabaseSchema: stub('getDatabaseSchema'),
  getDatabaseTableData: stub('getDatabaseTableData'),
}))

import { registerAdminHandlers } from '../electron/ipc/admin'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'

const ADMIN = IPC_CHANNELS.ADMIN

/** 设置页真在用的那 8 条 —— 装机版必须保留 */
const PRODUCT_KEYS = [
  'GET_STATS',
  'GET_AGENT_CONFIG',
  'SAVE_PROMPT',
  'RESET_PROMPT',
  'CREATE_CUSTOM_PROMPT',
  'UPDATE_CUSTOM_PROMPT',
  'DELETE_CUSTOM_PROMPT',
  'GET_CUSTOM_PROMPTS',
]

/** 只有后台页在用的那 11 条 —— 装机版一条都不许注册 */
const INSPECTION_KEYS = [
  'GET_BOOKS_WITH_COUNTS',
  'GET_HIGHLIGHTS_BY_BOOK',
  'GET_CARDS_BY_BOOK',
  'GET_SESSIONS',
  'GET_SESSION_MESSAGES',
  'GET_PROMPTS',
  'RESET_ALL_PROMPTS',
  'EXPORT_PROMPTS',
  'IMPORT_PROMPTS',
  'GET_DATABASE_SCHEMA',
  'GET_TABLE_DATA',
]

type Handler = (...args: unknown[]) => unknown

/** 跑一遍真实的注册函数，把「通道名 → handler」抓下来 */
function register(): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  registerAdminHandlers((channel: string, handler: Handler) => {
    handlers.set(channel, handler)
  })
  return handlers
}

function channelsOf(keys: string[]): string[] {
  return keys.map((k) => ADMIN[k as keyof typeof ADMIN])
}

beforeEach(() => {
  gate.isDev = true
  service.calls = []
  vi.clearAllMocks()
})

describe('admin 通道按消费者拆两半', () => {
  it('装机形状（isDev=false）：正好注册设置页在用的那 8 条', () => {
    gate.isDev = false
    const got = [...register().keys()].sort()
    const want = channelsOf(PRODUCT_KEYS).sort()
    expect(got, '装机形状多注册了：' + got.filter((c) => !want.includes(c)).join(', ')).toEqual(want)
  })

  it('装机形状：那 11 条读库能力一条都没注册', () => {
    gate.isDev = false
    const got = register()
    const leaked = channelsOf(INSPECTION_KEYS).filter((c) => got.has(c))
    expect(leaked, '装机版还能读：' + leaked.join(', ')).toEqual([])
  })

  it('开发形状（isDev=true）：19 条全在 —— 上面那条"一条都没有"不是因为整块没注册', () => {
    const got = [...register().keys()].sort()
    const want = channelsOf([...PRODUCT_KEYS, ...INSPECTION_KEYS]).sort()
    expect(got.length, '开发形状应当一条不少').toBe(want.length)
    expect(got.filter((c) => !want.includes(c)), '注册了声明表之外的通道').toEqual([])
    expect(want.filter((c) => !got.includes(c)), '开发形状少了这些条').toEqual([])
  })

  it('每条通道的 handler 真打到对应的服务函数，参数原样传过去', () => {
    const h = register()
    h.get(ADMIN.SAVE_PROMPT)?.('agent.system', '模板正文')
    h.get(ADMIN.GET_TABLE_DATA)?.('highlights', 10, 0)
    h.get(ADMIN.GET_HIGHLIGHTS_BY_BOOK)?.('b1')
    expect(service.calls).toEqual(['saveAdminPrompt', 'getDatabaseTableData', 'getHighlightsByBook'])
  })

  it('开发形状下 19 条挨个调用一遍：没有一条是接了却没落到服务层的空线', () => {
    const h = register()
    expect(h.size).toBe(PRODUCT_KEYS.length + INSPECTION_KEYS.length)
    service.calls = []
    for (const fn of h.values()) fn('参数1', '参数2', 3)
    expect(service.calls.length, '有的通道 handler 里根本什么都没调').toBe(h.size)
  })

  it('getStats 只交 stats 一个键 —— 不再顺手把最近 5 条会话查出来带进渲染层', () => {
    gate.isDev = false
    service.calls = []
    const h = register()
    const result = h.get(ADMIN.GET_STATS)?.() as Record<string, unknown>
    expect(Object.keys(result)).toEqual(['stats'])
    expect(result.stats).toBe('svc:getAdminStats')
    expect(service.calls, 'stats 那条链路上不该再查别的表').toEqual(['getAdminStats'])
  })
})

describe('消费面对账（永久守卫）', () => {
  /** 渲染层里非 pages/admin 的文件调用过哪些 `admin.<方法>` */
  function productConsumers(): Set<string> {
    const found = new Set<string>()
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) {
          walk(p)
          continue
        }
        if (!/\.(ts|tsx)$/.test(name)) continue
        if (/\.(test|spec)\.(ts|tsx)$/.test(name)) continue // 判据读的是产品代码的消费面，不是测试里的字
        if (relative(ROOT, p).replace(/\\/g, '/').startsWith('src/renderer/src/pages/admin/')) continue
        const text = readFileSync(p, 'utf8')
        for (const m of text.matchAll(/admin\.([a-zA-Z]+)/g)) found.add(m[1])
      }
    }
    walk(join(ROOT, 'src', 'renderer', 'src'))
    return found
  }

  it('非后台页用到的 admin 方法，装机形状真的把它们注册上了', () => {
    const used = [...productConsumers()].sort()
    expect(used.length, '一个 admin 方法都没扫到 —— 扫描本身坏了，这条判据等于没写').toBeGreaterThan(0)
    // 基准取"装机形状实际注册出来的通道"，不取测试里那份清单 ——
    // 拿清单比清单的话，有人把设置页在用的那条挪进开发专用那一半，这条照样绿。
    gate.isDev = false
    const kept = [...register().keys()].map((c) => c.slice('admin:'.length))
    const orphan = used.filter((m) => !kept.includes(m))
    expect(
      orphan,
      `这些方法被非后台页在用，但装机版不注册：${orphan.join(', ')} —— 要么把它挪回保留那半，要么别接`,
    ).toEqual([])
  })
})
