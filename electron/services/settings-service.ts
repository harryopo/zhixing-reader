import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '../logger'
import { SECRET_SETTING_KEYS, isSecretSetting } from '../../src/shared/settings-secrets'

class SettingsService {
  private static instance: SettingsService | null = null
  private settings: Record<string, unknown> = {}
  private settingsPath: string
  private secureDir: string

  private constructor() {
    this.settingsPath = path.join(app.getPath('userData'), 'settings.json')
    this.secureDir = path.join(app.getPath('userData'), 'secure')
    this.load()
  }

  static getInstance(): SettingsService {
    if (!SettingsService.instance) {
      SettingsService.instance = new SettingsService()
    }
    return SettingsService.instance
  }

  private load(): void {
    try {
      if (fs.existsSync(this.settingsPath)) {
        this.settings = JSON.parse(fs.readFileSync(this.settingsPath, 'utf-8'))
      }
    } catch (e) {
      logger.error('Failed to load settings', { error: String(e) })
      this.settings = {}
    }
  }

  private save(): void {
    try {
      fs.writeFileSync(this.settingsPath, JSON.stringify(this.settings, null, 2), 'utf-8')
    } catch (e) {
      logger.error('Failed to save settings', { error: String(e) })
    }
  }

  get(key: string): unknown {
    if (isSecretSetting(key)) {
      return this.readSecret(key)
    }
    return this.settings[key]
  }

  /**
   * 密钥一律走加密存储，其余设置照旧明文。
   *
   * 加密不可用或加密失败时**退回明文写入** —— 用户的密钥不能因为操作系统
   * 拒绝访问就丢掉；退回时会在日志里留一条 error，并由 `secureStorageAvailable`
   * 让界面如实说明"当前是明文保存"。
   */
  set(key: string, value: unknown): void {
    if (isSecretSetting(key)) {
      this.setSecureKey(key, typeof value === 'string' ? value : '')
      return
    }
    this.settings[key] = value
    this.save()
  }

  getAll(): Record<string, unknown> {
    const all: Record<string, unknown> = { ...this.settings }
    for (const key of SECRET_SETTING_KEYS) {
      const value = this.readSecret(key)
      if (value === null) {
        delete all[key]
      } else {
        all[key] = value
      }
    }
    return all
  }

  /**
   * 本机能不能真的用系统加密保存密钥。
   *
   * `isEncryptionAvailable()` 只说"API 可用"，不等于加解密真跑得通（换机器、
   * DPAPI 拒绝访问时它仍然返回 true），所以这里做一次自检往返 ——
   * 界面那句"你的密钥是明文存的"必须跟着实测结果走，不能跟着一个布尔值走。
   */
  isEncryptionAvailable(): boolean {
    try {
      if (!safeStorage.isEncryptionAvailable()) return false
      const probe = safeStorage.encryptString('zhixing-secure-probe')
      return safeStorage.decryptString(probe) === 'zhixing-secure-probe'
    } catch (e) {
      logger.error('safeStorage self-check failed; falling back to plaintext', { error: String(e) })
      return false
    }
  }

  private encPath(keyName: string): string {
    return path.join(this.secureDir, `${keyName}.enc`)
  }

  getSecureKey(keyName: string): string | null {
    return this.readSecret(keyName)
  }

  private readSecret(keyName: string): string | null {
    const file = this.encPath(keyName)
    const legacy = typeof this.settings[keyName] === 'string' ? (this.settings[keyName] as string) : null
    try {
      if (!fs.existsSync(file)) {
        return legacy
      }
      if (!this.isEncryptionAvailable()) {
        logger.warn(`Encryption unavailable, reading ${keyName} from settings.json if present`)
        return legacy
      }
      return safeStorage.decryptString(fs.readFileSync(file))
    } catch (e) {
      // 解不开也要留着密文文件，并且还能用就退回明文 —— 两条路都不能让用户丢密钥
      logger.error(`Failed to read secure key: ${keyName}`, { error: String(e) })
      return legacy
    }
  }

  setSecureKey(keyName: string, value: string): void {
    const writePlaintext = (reason: string): void => {
      this.settings[keyName] = value
      this.save()
      logger.error(`${reason}; ${keyName} was kept in plaintext in settings.json`)
    }

    if (!this.isEncryptionAvailable()) {
      writePlaintext('System encryption unavailable')
      return
    }
    try {
      fs.mkdirSync(this.secureDir, { recursive: true })
      const encrypted = safeStorage.encryptString(value)
      fs.writeFileSync(this.encPath(keyName), encrypted)
      delete this.settings[keyName]
      this.save()
      logger.info(`Secure key saved: ${keyName}`)
    } catch (e) {
      writePlaintext(`Failed to encrypt ${keyName}`)
      logger.error(`Failed to save secure key: ${keyName}`, { error: String(e) })
    }
  }

  /**
   * 把历史明文密钥一次性搬进加密存储。
   *
   * 只处理"读不到密文、但 settings.json 里躺着明文"的项；加密不可用或加密失败时
   * 明文原样留着（`setSecureKey` 的失败分支会把它写回去）。幂等：搬完再跑就是空操作。
   */
  migratePlainSecrets(): { migrated: string[]; keptPlaintext: string[] } {
    const migrated: string[] = []
    const keptPlaintext: string[] = []
    for (const key of SECRET_SETTING_KEYS) {
      const plaintext = this.settings[key]
      if (typeof plaintext !== 'string' || plaintext.length === 0) continue
      this.setSecureKey(key, plaintext)
      // 迁移结果按**落盘后的实际状态**判定，不按 setSecureKey 有没有抛错判定 ——
      // 报"已迁移"就必须做到两件事：明文从 settings.json 消失了，且密文文件真在那儿。
      if (Object.prototype.hasOwnProperty.call(this.settings, key) || !fs.existsSync(this.encPath(key))) {
        keptPlaintext.push(key)
      } else {
        migrated.push(key)
      }
    }
    return { migrated, keptPlaintext }
  }
}

export const settingsService = SettingsService.getInstance()