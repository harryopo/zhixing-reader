// 密钥的跨进程边界守卫（2026-09-23，安全批次 2/2，Issue #13 的下半场）
//
// 上一批把密钥真正接上了 safeStorage：落盘不再是明文。但那条缝只堵了一半 ——
// `SETTINGS.GET_ALL` 走的是 `settingsService.getAll()`，它会把解密后的原值一起
// 发给渲染层，界面再回填进输入框。于是"加密存着"的 key 每次打开设置页就摊开一次，
// DevTools / 渲染层任意一处 XSS / 任何后来加的日志都能拿到它。
//
// 这一批立的规矩：**密钥原值不出主进程**。
//   1) 渲染层拿到的只有 `<key>Set` 布尔（配没配），拿不到值
//   2) `SETTINGS.GET('wereadApiKey')` 直接抛错，而不是静默回 undefined
//      （回空值会被界面读成"没配"，随手一次保存就把用户的 key 清了）
//   3) 输入框留空 = 不修改；清除必须是显式动作（空串写进 setSecureKey 就是清除）
//   4) AI 配置里 apiKey 留空 = 沿用已存的那把，由主进程补

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync, rmSync } from 'fs'
import { join } from 'path'
import { safeStorage } from 'electron'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'
import {
  SECRET_SET_FLAG_NAMES,
  SECRET_SETTING_KEYS,
  secretSetFlagName,
  withStoredApiKey,
} from '../src/shared/settings-secrets'

/** 独占 profile 目录：与 secret-storage.test.ts 并行跑时不互删 settings.json / secure/ */
const PROFILE = 'user-data-secret-ipc'
process.env.ZHIXING_TEST_PROFILE = PROFILE

const DATA_DIR = join(process.cwd(), '.test-tmp', PROFILE)
const SETTINGS_FILE = join(DATA_DIR, 'settings.json')
const SECURE_DIR = join(DATA_DIR, 'secure')
/** 一个"绝对不该出现在渲染层收到的对象里"的字符串 */
const SECRET = 'sk-NEVER-CROSS-THIS-BRIDGE-42'

type Handler = (...args: unknown[]) => unknown

/** 加载一份干净的 settings-service，并用它注册真实的 settings handlers */
async function freshHandlers() {
  vi.resetModules()
  const { settingsService } = await import('../electron/services/settings-service')
  const { registerSettingsHandlers } = await import('../electron/ipc/settings')
  const handlers = new Map<string, Handler>()
  registerSettingsHandlers((channel, handler) => {
    handlers.set(channel, handler as Handler)
  })
  return { svc: settingsService, handlers }
}

function encryptionWorks() {
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
  vi.mocked(safeStorage.encryptString).mockImplementation((s: string) => Buffer.from(`enc:${s}`, 'utf8'))
  vi.mocked(safeStorage.decryptString).mockImplementation((b: Buffer) => b.toString('utf8').replace(/^enc:/, ''))
}

function diskJson(): string {
  return existsSync(SETTINGS_FILE) ? readFileSync(SETTINGS_FILE, 'utf8') : ''
}

beforeEach(() => {
  rmSync(SETTINGS_FILE, { force: true })
  rmSync(SECURE_DIR, { recursive: true, force: true })
})

describe('SETTINGS.GET_ALL 只回「配没配」', () => {
  it.each(SECRET_SETTING_KEYS)('%s：主进程存着原值，交出去的对象里却查不到', async (key) => {
    encryptionWorks()
    const { svc, handlers } = await freshHandlers()
    svc.set(key, SECRET)

    const getAll = handlers.get(IPC_CHANNELS.SETTINGS.GET_ALL)
    expect(getAll).toBeTypeOf('function')
    const sent = getAll!() as Record<string, unknown>

    // 反证：同一份现场，主进程内部用的 getAll() 确实能取到原值 ——
    // 说明上面那条"查不到"是边界生效，不是压根没存进去。
    expect(svc.getAll()[key]).toBe(SECRET)

    expect(JSON.stringify(sent)).not.toContain(SECRET)
    expect(sent[key]).toBeUndefined()
    expect(sent[secretSetFlagName(key)]).toBe(true)
  })

  it('没配过的密钥在渲染层侧是 false，而不是一个空字段', async () => {
    encryptionWorks()
    const { handlers } = await freshHandlers()
    const sent = handlers.get(IPC_CHANNELS.SETTINGS.GET_ALL)!() as Record<string, unknown>

    for (const flag of SECRET_SET_FLAG_NAMES) {
      expect(sent[flag]).toBe(false)
    }
  })

  it('非密钥项照常下发（这套过滤只针对密钥，不是把设置页掏空）', async () => {
    encryptionWorks()
    const { svc, handlers } = await freshHandlers()
    svc.set('llmModel', 'deepseek-v4-flash')

    const sent = handlers.get(IPC_CHANNELS.SETTINGS.GET_ALL)!() as Record<string, unknown>
    expect(sent.llmModel).toBe('deepseek-v4-flash')
  })
})

describe('SETTINGS.GET 不许单独问密钥', () => {
  it.each(SECRET_SETTING_KEYS)('问 %s ⇒ 抛错并指向 *Set 字段', async (key) => {
    encryptionWorks()
    const { svc, handlers } = await freshHandlers()
    svc.set(key, SECRET)

    const get = handlers.get(IPC_CHANNELS.SETTINGS.GET)!
    expect(() => get(key)).toThrow(new RegExp(`${secretSetFlagName(key)}`))
    // 抛的是"走错路"，不是把值原样端出去
    let leaked: unknown = '没有被抛错'
    try {
      leaked = get(key)
    } catch (e) {
      leaked = (e as Error).message
    }
    expect(String(leaked)).not.toContain(SECRET)
  })

  it('普通项照常能问（守卫没有顺手把整条通道封掉）', async () => {
    encryptionWorks()
    const { svc, handlers } = await freshHandlers()
    svc.set('theme', 'dark')
    expect(handlers.get(IPC_CHANNELS.SETTINGS.GET)!('theme')).toBe('dark')
  })
})

describe('清除与误写', () => {
  it('空串是显式清除：密文文件与明文残留一起没了', async () => {
    encryptionWorks()
    const { svc } = await freshHandlers()
    svc.set('wereadApiKey', SECRET)
    expect(existsSync(join(SECURE_DIR, 'wereadApiKey.enc'))).toBe(true)

    svc.set('wereadApiKey', '')

    expect(existsSync(join(SECURE_DIR, 'wereadApiKey.enc'))).toBe(false)
    expect(svc.get('wereadApiKey')).toBeNull()
    expect(diskJson()).not.toContain(SECRET)
    expect(svc.getForRenderer().wereadApiKeySet).toBe(false)
  })

  it('非字符串（undefined / null）不许把已存的密钥抹掉', async () => {
    encryptionWorks()
    const { svc } = await freshHandlers()
    svc.set('llmKey', SECRET)

    svc.set('llmKey', undefined)
    svc.set('llmKey', null)

    expect(svc.get('llmKey')).toBe(SECRET)
  })

  it('写密钥不会在 settings.json 里留明文副本', async () => {
    encryptionWorks()
    const { svc } = await freshHandlers()
    svc.set('llmKey', SECRET)
    expect(diskJson()).not.toContain(SECRET)
  })
})

describe('AI 配置的 apiKey 留空 = 沿用已存的', () => {
  it('空串 / 缺失都从主进程补回原值', () => {
    expect(withStoredApiKey({ apiKey: '', model: 'm' }, SECRET).apiKey).toBe(SECRET)
    expect(withStoredApiKey({ model: 'm' }, SECRET).apiKey).toBe(SECRET)
  })

  it('用户当场填了新 key ⇒ 用新的，不许被已存的顶掉', () => {
    expect(withStoredApiKey({ apiKey: 'sk-typed' }, SECRET).apiKey).toBe('sk-typed')
  })

  it('主进程也没有 key ⇒ 交回空串，让调用方如实报"请先配置"', () => {
    expect(withStoredApiKey({ apiKey: '' }, null).apiKey).toBe('')
    expect(withStoredApiKey({ apiKey: '' }, undefined).apiKey).toBe('')
  })
})

describe('渲染层不再读密钥原值（源码扫描）', () => {
  const RENDERER_ROOT = 'src/renderer/src'

  it('settingsStore 只从 getAll 取 *Set 布尔', () => {
    const src = readFileSync(join(process.cwd(), `${RENDERER_ROOT}/stores/settingsStore.ts`), 'utf8')
    for (const key of SECRET_SETTING_KEYS) {
      // 形如 `(settings.wereadApiKey as string)` 的读法不许回来
      expect(src).not.toMatch(new RegExp(`settings\\.${key}\\s+as\\s+string`))
      expect(src).not.toMatch(new RegExp(`electronAPI\\.settings\\.get\\(['"]${key}['"]\\)`))
    }
    // 反证：这条扫描真的在看得到 *Set 的那份代码上成立
    expect(src).toMatch(/settings\.wereadApiKeySet === true/)
    expect(src).toMatch(/settings\.llmKeySet === true/)
  })

  it('没有渲染层文件再把密钥原值喂给 IPC 返回值', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir).flatMap((name) => {
        const full = join(dir, name)
        if (statSync(full).isDirectory()) return walk(full)
        return /\.(ts|tsx)$/.test(name) ? [full] : []
      })
    const offenders: string[] = []
    for (const file of walk(join(process.cwd(), RENDERER_ROOT, 'pages'))) {
      const src = readFileSync(file, 'utf8')
      // 把 IPC 回来的 key 值再摆回输入框的写法：value={llmKey} / value={wereadApiKey}
      if (/value=\{llmKey\}/.test(src) || /value=\{wereadApiKey\}/.test(src)) offenders.push(file)
    }
    expect(offenders).toEqual([])
  })
})
