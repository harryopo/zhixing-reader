import { logger } from '../logger'
import { settingsService } from './settings-service'
import { PROMPT_REGISTRY, getPromptMeta, getAllPromptIds, PromptMeta } from './prompt-registry'

const STORE_KEY = 'admin_prompts'

export interface PromptWithOverride extends PromptMeta {
  currentTemplate: string
  isCustom: boolean
}

function readStore(): Record<string, string> {
  const v = settingsService.get(STORE_KEY)
  if (v && typeof v === 'object') {
    return v as Record<string, string>
  }
  return {}
}

function writeStore(store: Record<string, string>): void {
  settingsService.set(STORE_KEY, store)
}

export function getAllPrompts(): PromptWithOverride[] {
  const store = readStore()
  return PROMPT_REGISTRY.map(meta => {
    const custom = store[meta.id]
    return {
      ...meta,
      currentTemplate: custom || meta.defaultTemplate,
      isCustom: !!custom,
    }
  })
}

export function getPrompt(id: string): PromptWithOverride | undefined {
  const meta = getPromptMeta(id)
  if (!meta) return undefined
  const store = readStore()
  const custom = store[id]
  return {
    ...meta,
    currentTemplate: custom || meta.defaultTemplate,
    isCustom: !!custom,
  }
}

export function getPromptTemplate(id: string): string {
  const meta = getPromptMeta(id)
  if (!meta) {
    logger.warn(`Prompt not found: ${id}, returning empty`)
    return ''
  }
  const store = readStore()
  return store[id] || meta.defaultTemplate
}

export function savePrompt(id: string, template: string): { success: boolean; error?: string } {
  const meta = getPromptMeta(id)
  if (!meta) {
    return { success: false, error: `Prompt ${id} not found` }
  }
  const store = readStore()
  store[id] = template
  writeStore(store)
  logger.info(`Prompt saved: ${id}`)
  return { success: true }
}

export function resetPrompt(id: string): { success: boolean; error?: string } {
  const meta = getPromptMeta(id)
  if (!meta) {
    return { success: false, error: `Prompt ${id} not found` }
  }
  const store = readStore()
  delete store[id]
  writeStore(store)
  logger.info(`Prompt reset: ${id}`)
  return { success: true }
}

export function resetAllPrompts(): void {
  writeStore({})
  logger.info('All prompts reset to default')
}

export function exportPrompts(): string {
  const store = readStore()
  const payload = {
    version: 1,
    exportedAt: new Date().toISOString(),
    overrides: store,
  }
  return JSON.stringify(payload, null, 2)
}

export function importPrompts(json: string): { success: boolean; imported: number; error?: string } {
  try {
    const parsed = JSON.parse(json)
    const overrides = parsed?.overrides
    if (!overrides || typeof overrides !== 'object') {
      return { success: false, imported: 0, error: 'Invalid format: missing "overrides"' }
    }
    const validIds = new Set(getAllPromptIds())
    const cleaned: Record<string, string> = {}
    let imported = 0
    for (const [id, template] of Object.entries(overrides)) {
      if (validIds.has(id) && typeof template === 'string') {
        cleaned[id] = template
        imported++
      }
    }
    writeStore(cleaned)
    logger.info(`Imported ${imported} prompts`)
    return { success: true, imported }
  } catch (e) {
    return { success: false, imported: 0, error: String(e) }
  }
}

export function parseIntentKeywords(text: string): Record<string, string[]> | null {
  try {
    const result: Record<string, string[]> = {}
    const lines = text.split('\n').filter(l => l.trim())
    for (const line of lines) {
      const idx = line.indexOf(':')
      if (idx < 0) continue
      const intent = line.slice(0, idx).trim()
      const keywords = line
        .slice(idx + 1)
        .split(/[,，]/)
        .map(k => k.trim())
        .filter(k => k.length > 0)
      if (intent && keywords.length > 0) {
        result[intent] = keywords
      }
    }
    return Object.keys(result).length > 0 ? result : null
  } catch {
    return null
  }
}

export function serializeIntentKeywords(keywords: Record<string, string[]>): string {
  return Object.entries(keywords)
    .map(([intent, words]) => `${intent}: ${words.join(',')}`)
    .join('\n')
}
