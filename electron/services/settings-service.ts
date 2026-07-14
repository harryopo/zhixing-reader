import { app, safeStorage } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { logger } from '../logger'

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
    return this.settings[key]
  }

  set(key: string, value: unknown): void {
    this.settings[key] = value
    this.save()
  }

  getAll(): Record<string, unknown> {
    return { ...this.settings }
  }

  getSecureKey(keyName: string): string | null {
    try {
      if (!fs.existsSync(this.secureDir)) {
        fs.mkdirSync(this.secureDir, { recursive: true })
      }
      const keyPath = path.join(this.secureDir, `${keyName}.enc`)
      if (!fs.existsSync(keyPath)) {
        return null
      }
      const encrypted = fs.readFileSync(keyPath)
      if (!safeStorage.isEncryptionAvailable()) {
        logger.warn('Encryption not available, falling back to settings.json')
        return this.settings[keyName] as string || null
      }
      return safeStorage.decryptString(encrypted)
    } catch (e) {
      logger.error(`Failed to read secure key: ${keyName}`, { error: String(e) })
      return null
    }
  }

  setSecureKey(keyName: string, value: string): void {
    try {
      if (!fs.existsSync(this.secureDir)) {
        fs.mkdirSync(this.secureDir, { recursive: true })
      }
      const keyPath = path.join(this.secureDir, `${keyName}.enc`)
      if (!safeStorage.isEncryptionAvailable()) {
        logger.warn('Encryption not available, falling back to settings.json')
        this.settings[keyName] = value
        this.save()
        return
      }
      const encrypted = safeStorage.encryptString(value)
      fs.writeFileSync(keyPath, encrypted)
      delete this.settings[keyName]
      this.save()
      logger.info(`Secure key saved: ${keyName}`)
    } catch (e) {
      logger.error(`Failed to save secure key: ${keyName}`, { error: String(e) })
    }
  }
}

export const settingsService = SettingsService.getInstance()
export default settingsService