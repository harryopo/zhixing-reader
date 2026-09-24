// 密钥存储守卫测试（2026-09-23，Issue #13）
//
// 背景：`getSecureKey` / `setSecureKey` 自写下起就是零调用方 —— 所有密钥都明文躺在
// %APPDATA%\zhixing-reader\settings.json 里。这里钉住接通之后的四件事：
//   1) 加密可用 ⇒ 落盘进 secure/*.enc，settings.json 里不许再留明文
//   2) 加密不可用 ⇒ 允许降级写明文，但必须把 secureStorageAvailable 记成 false（界面据此如实提示）
//   3) **任何失败路径都不许把用户的密钥弄丢**（加密抛错时明文字段必须还在）
//   4) 迁移是幂等的，且只搬密钥，不碰 llmModel 这类普通设置

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { safeStorage } from 'electron'
import { SECRET_SETTING_KEYS, isSecretSetting } from '../src/shared/settings-secrets'

/**
 * 这个文件会真写 settings.json 与 secure/ —— 用独占的 profile 目录，
 * 否则与同样测密钥的 secret-ipc-boundary.test.ts 并行跑时会互删现场。
 */
const PROFILE = 'user-data-secret-storage'
process.env.ZHIXING_TEST_PROFILE = PROFILE

const DATA_DIR = join(process.cwd(), '.test-tmp', PROFILE)
const SETTINGS_FILE = join(DATA_DIR, 'settings.json')
const SECURE_DIR = join(DATA_DIR, 'secure')

/** 每个用例都要重来：settings-service 是模块级单例，必须重置模块缓存 */
async function freshService() {
  vi.resetModules()
  const { settingsService } = await import('../electron/services/settings-service')
  return settingsService as {
    get(key: string): unknown
    set(key: string, value: unknown): void
    getAll(): Record<string, unknown>
    isEncryptionAvailable(): boolean
    getSecureKey(name: string): string | null
    migratePlainSecrets(): { migrated: string[]; keptPlaintext: string[] }
  }
}

function encryptionWorks() {
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(true)
  vi.mocked(safeStorage.encryptString).mockImplementation((s: string) => Buffer.from(`enc:${s}`, 'utf8'))
  vi.mocked(safeStorage.decryptString).mockImplementation((b: Buffer) => b.toString('utf8').replace(/^enc:/, ''))
}

function encryptionUnavailable() {
  vi.mocked(safeStorage.isEncryptionAvailable).mockReturnValue(false)
}

function diskSettings(): Record<string, unknown> {
  return existsSync(SETTINGS_FILE) ? JSON.parse(readFileSync(SETTINGS_FILE, 'utf8')) : {}
}

beforeEach(() => {
  rmSync(SETTINGS_FILE, { force: true })
  rmSync(SECURE_DIR, { recursive: true, force: true })
})

describe('密钥不进明文设置文件', () => {
  it.each(SECRET_SETTING_KEYS)('%s：加密可用时落盘进 secure/，settings.json 里查不到这串值', async (key) => {
    encryptionWorks()
    const svc = await freshService()
    const secret = 'sk-TEST-VALUE-9f3a'

    svc.set(key, secret)

    expect(svc.get(key)).toBe(secret)
    const raw = readFileSync(SETTINGS_FILE, 'utf8')
    expect(raw).not.toContain(secret)
    expect(diskSettings()[key]).toBeUndefined()
    expect(existsSync(join(SECURE_DIR, `${key}.enc`))).toBe(true)
  })

  it('反证：mock 的 safeStorage 真的被调用了（不是"断言恰好都成立"）', async () => {
    encryptionWorks()
    const svc = await freshService()
    svc.set('llmKey', 'sk-abc')
    expect(safeStorage.encryptString).toHaveBeenCalledWith('sk-abc')
  })

  it('只搬密钥：llmModel 这类普通设置仍旧明文写在 settings.json 里', async () => {
    encryptionWorks()
    const svc = await freshService()

    svc.set('llmModel', 'deepseek-chat')
    svc.set('llmKey', 'sk-abc')

    expect(diskSettings().llmModel).toBe('deepseek-chat')
    expect(isSecretSetting('llmModel')).toBe(false)
    expect(existsSync(join(SECURE_DIR, 'llmModel.enc'))).toBe(false)
  })
})

describe('加密不可用时不许把功能弄坏', () => {
  it('降级写明文，但值仍读得回来', async () => {
    encryptionUnavailable()
    const svc = await freshService()

    svc.set('wereadApiKey', 'wr-key-plain')

    expect(diskSettings().wereadApiKey).toBe('wr-key-plain')
    expect(svc.get('wereadApiKey')).toBe('wr-key-plain')
    expect(svc.isEncryptionAvailable()).toBe(false)
  })
})

describe('失败路径一律不许丢用户的密钥', () => {
  it('encryptString 抛错 ⇒ settings.json 里的明文原样还在', async () => {
    encryptionWorks()
    vi.mocked(safeStorage.encryptString).mockImplementation(() => {
      throw new Error('DPAPI 拒绝了访问')
    })
    const svc = await freshService()
    svc.set('llmKey', 'sk-old-value')

    // 再写一次会走加密路径；失败时必须保留既有明文，不能"删了明文再报错"
    expect(diskSettings().llmKey).toBe('sk-old-value')
    expect(svc.get('llmKey')).toBe('sk-old-value')
  })

  // 上面那条其实是自检探针先失败 ⇒ 直接判"加密不可用"。下面两条把探针留在可用状态，
  // 只在真值上抛错 —— 那才是"能加密，但这一次没写成/解不开"的路径，缺了它这条守卫是半空的。
  it('自检能过、真值加密抛错 ⇒ 退回明文，值仍然读得回来', async () => {
    encryptionWorks()
    const realEncrypt = vi.mocked(safeStorage.encryptString).getMockImplementation()!
    vi.mocked(safeStorage.encryptString).mockImplementation((s: string) => {
      if (s === 'zhixing-secure-probe') return realEncrypt(s)
      throw new Error('真值加密被拒')
    })
    const svc = await freshService()
    expect(svc.isEncryptionAvailable()).toBe(true)

    svc.set('wereadApiKey', 'wr-must-survive')

    expect(diskSettings().wereadApiKey).toBe('wr-must-survive')
    expect(svc.get('wereadApiKey')).toBe('wr-must-survive')
  })

  it('自检能过、真值解密抛错 ⇒ 返回 null 且 .enc 留着不删', async () => {
    encryptionWorks()
    const svc = await freshService()
    svc.set('llmKey', 'sk-roundtrip')
    const encPath = join(SECURE_DIR, 'llmKey.enc')
    expect(existsSync(encPath)).toBe(true)

    const realDecrypt = vi.mocked(safeStorage.decryptString).getMockImplementation()!
    vi.mocked(safeStorage.decryptString).mockImplementation((b: Buffer) => {
      if (b.toString('utf8') === 'enc:zhixing-secure-probe') return realDecrypt(b)
      throw new Error('密文属于另一台机器')
    })
    expect(svc.isEncryptionAvailable()).toBe(true)

    expect(svc.get('llmKey')).toBeNull()
    expect(existsSync(encPath)).toBe(true)
  })
})

describe('历史明文的一次性迁移', () => {
  it.each(SECRET_SETTING_KEYS)('%s：启动迁移后明文从文件里消失、密文解得出原值', async (key) => {
    encryptionWorks()
    const secret = `legacy-${key}-value`
    // 先按旧方式造一份"明文躺在 settings.json 里"的历史现场
    const seed = await freshService()
    encryptionUnavailable()
    seed.set(key, secret)
    expect(diskSettings()[key]).toBe(secret)
    encryptionWorks()

    const svc = await freshService()
    const result = svc.migratePlainSecrets()

    expect(result.migrated).toContain(key)
    expect(diskSettings()[key]).toBeUndefined()
    expect(svc.get(key)).toBe(secret)
    // 幂等：再跑一次什么都不动
    expect(svc.migratePlainSecrets().migrated).toEqual([])
  })

  it('加密不可用时迁移什么都不做（宁可留明文，也不能把密钥弄没）', async () => {
    encryptionUnavailable()
    const seed = await freshService()
    seed.set('llmKey', 'sk-keep-me')

    encryptionUnavailable()
    const svc = await freshService()
    const result = svc.migratePlainSecrets()

    expect(result.keptPlaintext).toContain('llmKey')
    expect(result.migrated).toEqual([])
    expect(diskSettings().llmKey).toBe('sk-keep-me')
    expect(svc.get('llmKey')).toBe('sk-keep-me')
  })

  it('探针能过、真值加密抛错 ⇒ 迁移如实报 keptPlaintext，不许报"已迁移"', async () => {
    // 这条钉的是迁移结果的口径：只有"明文真的没了、密文真的在"才算 migrated。
    // 半途失败却报成功，日志就会对人说谎，界面也跟着说"已加密"。
    const secret = 'sk-migrate-fails'
    const seed = await freshService()
    encryptionUnavailable()
    seed.set('llmKey', secret)
    encryptionWorks()

    const svc = await freshService()
    const realEncrypt = vi.mocked(safeStorage.encryptString).getMockImplementation()!
    vi.mocked(safeStorage.encryptString).mockImplementation((s: string) => {
      if (s === 'zhixing-secure-probe') return realEncrypt(s)
      throw new Error('真值加密被拒')
    })

    const result = svc.migratePlainSecrets()

    expect(result.migrated).toEqual([])
    expect(result.keptPlaintext).toContain('llmKey')
    expect(diskSettings().llmKey).toBe(secret)
    expect(svc.get('llmKey')).toBe(secret)
    expect(existsSync(join(SECURE_DIR, 'llmKey.enc'))).toBe(false)
  })
})

describe('读写口径只有一套', () => {
  it('getAll 交出来的密钥与 get 逐个取的一致（两条路不许各说一个）', async () => {
    encryptionWorks()
    const svc = await freshService()
    svc.set('llmKey', 'sk-x')
    svc.set('wereadApiKey', 'wr-y')

    const all = svc.getAll()
    for (const key of SECRET_SETTING_KEYS) {
      expect(all[key]).toBe(svc.get(key))
    }
  })
})
