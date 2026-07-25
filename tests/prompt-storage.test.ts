// 知行读书 — prompt-storage 单元测试（2026-07-25，过夜 Task #14）
//
// 覆盖 get/save/reset/import/export 与自定义模板 CRUD + intent 关键词序列化。
// prompt-storage 是提示词中心持久化核心（settingsService 读写），此前 0 单测。

import { describe, it, expect, beforeEach, vi } from 'vitest'

const { mockGet, mockSet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn(),
}))

vi.mock('../electron/services/settings-service', () => ({
  settingsService: {
    get: mockGet,
    set: mockSet,
  },
}))

vi.mock('../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

// 轻量 mock registry：固定 2 个 id，避免依赖完整 PROMPT_REGISTRY 体积
vi.mock('../electron/services/prompt-registry', () => ({
  PROMPT_REGISTRY: [
    {
      id: 'agent.system',
      category: 'agent',
      role: 'system',
      title: '系统',
      description: 'd',
      defaultTemplate: 'DEFAULT_SYSTEM',
      variables: [],
      exampleVars: {},
    },
    {
      id: 'agent.intentKeywords',
      category: 'intent',
      role: 'user',
      title: '意图',
      description: 'd',
      defaultTemplate: 'DEFAULT_INTENT',
      variables: [],
      exampleVars: {},
    },
  ],
  getPromptMeta: (id: string) => {
    const all = [
      {
        id: 'agent.system',
        category: 'agent',
        role: 'system',
        title: '系统',
        description: 'd',
        defaultTemplate: 'DEFAULT_SYSTEM',
        variables: [],
        exampleVars: {},
      },
      {
        id: 'agent.intentKeywords',
        category: 'intent',
        role: 'user',
        title: '意图',
        description: 'd',
        defaultTemplate: 'DEFAULT_INTENT',
        variables: [],
        exampleVars: {},
      },
    ]
    return all.find((p) => p.id === id)
  },
  getAllPromptIds: () => ['agent.system', 'agent.intentKeywords'],
}))

import {
  getAllPrompts,
  getPrompt,
  getPromptTemplate,
  savePrompt,
  resetPrompt,
  resetAllPrompts,
  exportPrompts,
  importPrompts,
  createCustomPrompt,
  getAllCustomPrompts,
  getCustomPrompt,
  updateCustomPrompt,
  deleteCustomPrompt,
  parseIntentKeywords,
  serializeIntentKeywords,
} from '../electron/services/prompt-storage'

const STORE_KEY = 'admin_prompts'
const STORE_KEY_CUSTOM = 'admin_custom_prompts'

/** in-memory settings bag shared by mockGet/mockSet */
let bag: Record<string, unknown> = {}

beforeEach(() => {
  bag = {}
  mockGet.mockImplementation((key: string) => bag[key])
  mockSet.mockImplementation((key: string, value: unknown) => {
    bag[key] = value
  })
  vi.clearAllMocks()
  // clearAllMocks 会清掉 mockImplementation，重新挂
  mockGet.mockImplementation((key: string) => bag[key])
  mockSet.mockImplementation((key: string, value: unknown) => {
    bag[key] = value
  })
})

describe('prompt-storage — registry overrides', () => {
  it('getAllPrompts 无覆盖时 isCustom=false 且用 defaultTemplate', () => {
    const list = getAllPrompts()
    expect(list).toHaveLength(2)
    expect(list[0].currentTemplate).toBe('DEFAULT_SYSTEM')
    expect(list[0].isCustom).toBe(false)
  })

  it('getPromptTemplate 有覆盖时返回覆盖内容', () => {
    bag[STORE_KEY] = { 'agent.system': 'CUSTOM_SYS' }
    expect(getPromptTemplate('agent.system')).toBe('CUSTOM_SYS')
  })

  it('getPromptTemplate 未知 id 返回空串', () => {
    expect(getPromptTemplate('no.such')).toBe('')
  })

  it('getPrompt 未知 id 返回 undefined', () => {
    expect(getPrompt('no.such')).toBeUndefined()
  })

  it('savePrompt 写入 store 并标记 isCustom', () => {
    const r = savePrompt('agent.system', 'NEW')
    expect(r.success).toBe(true)
    expect(bag[STORE_KEY]).toEqual({ 'agent.system': 'NEW' })
    const p = getPrompt('agent.system')
    expect(p?.isCustom).toBe(true)
    expect(p?.currentTemplate).toBe('NEW')
  })

  it('savePrompt 未知 id 失败', () => {
    expect(savePrompt('x', 'y')).toEqual({
      success: false,
      error: 'Prompt x not found',
    })
  })

  it('resetPrompt 删除单条覆盖', () => {
    bag[STORE_KEY] = { 'agent.system': 'A', 'agent.intentKeywords': 'B' }
    const r = resetPrompt('agent.system')
    expect(r.success).toBe(true)
    expect(bag[STORE_KEY]).toEqual({ 'agent.intentKeywords': 'B' })
    expect(getPromptTemplate('agent.system')).toBe('DEFAULT_SYSTEM')
  })

  it('resetAllPrompts 清空覆盖', () => {
    bag[STORE_KEY] = { 'agent.system': 'A' }
    resetAllPrompts()
    expect(bag[STORE_KEY]).toEqual({})
  })

  it('exportPrompts 导出 version + overrides', () => {
    bag[STORE_KEY] = { 'agent.system': 'X' }
    const raw = exportPrompts()
    const parsed = JSON.parse(raw)
    expect(parsed.version).toBe(1)
    expect(parsed.overrides).toEqual({ 'agent.system': 'X' })
    expect(parsed.exportedAt).toBeTruthy()
  })

  it('importPrompts 只导入合法 id 的 string 模板', () => {
    const json = JSON.stringify({
      version: 1,
      overrides: {
        'agent.system': 'IMP',
        'agent.intentKeywords': 123,
        'unknown.id': 'skip',
      },
    })
    const r = importPrompts(json)
    expect(r.success).toBe(true)
    expect(r.imported).toBe(1)
    expect(bag[STORE_KEY]).toEqual({ 'agent.system': 'IMP' })
  })

  it('importPrompts 缺 overrides 失败', () => {
    const r = importPrompts(JSON.stringify({ version: 1 }))
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/overrides/)
  })

  it('importPrompts 非法 JSON 失败', () => {
    const r = importPrompts('{not json')
    expect(r.success).toBe(false)
    expect(r.imported).toBe(0)
  })
})

describe('prompt-storage — custom prompts CRUD', () => {
  it('createCustomPrompt 成功写入', () => {
    const p = createCustomPrompt('  我的模板  ', '内容 body')
    expect(p.name).toBe('我的模板')
    expect(p.content).toBe('内容 body')
    expect(p.category).toBe('custom')
    expect(p.id.startsWith('custom-')).toBe(true)
    expect(getCustomPrompt(p.id)?.name).toBe('我的模板')
  })

  it('createCustomPrompt 空名/空内容抛错', () => {
    expect(() => createCustomPrompt('  ', 'x')).toThrow(/名称/)
    expect(() => createCustomPrompt('n', '  ')).toThrow(/内容/)
  })

  it('getAllCustomPrompts 按 createdAt 升序', () => {
    bag[STORE_KEY_CUSTOM] = {
      a: {
        id: 'a',
        name: '后',
        content: 'c',
        category: 'custom',
        createdAt: '2026-07-02T00:00:00.000Z',
        updatedAt: '2026-07-02T00:00:00.000Z',
      },
      b: {
        id: 'b',
        name: '先',
        content: 'c',
        category: 'custom',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    }
    const list = getAllCustomPrompts()
    expect(list.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('updateCustomPrompt 成功与校验', () => {
    const p = createCustomPrompt('旧', '旧内容')
    expect(updateCustomPrompt(p.id, '新', '新内容').success).toBe(true)
    expect(getCustomPrompt(p.id)?.name).toBe('新')
    expect(updateCustomPrompt('missing', 'a', 'b').success).toBe(false)
    expect(updateCustomPrompt(p.id, '  ', 'x').error).toMatch(/名称/)
    expect(updateCustomPrompt(p.id, 'n', ' ').error).toMatch(/内容/)
  })

  it('deleteCustomPrompt 成功与不存在', () => {
    const p = createCustomPrompt('d', 'c')
    expect(deleteCustomPrompt(p.id).success).toBe(true)
    expect(getCustomPrompt(p.id)).toBeUndefined()
    expect(deleteCustomPrompt(p.id).success).toBe(false)
  })
})

describe('prompt-storage — intent keywords', () => {
  it('parseIntentKeywords 解析中英文逗号', () => {
    const text = 'knowledge_query: 什么是,定义\nmethodology: 怎么用，步骤'
    expect(parseIntentKeywords(text)).toEqual({
      knowledge_query: ['什么是', '定义'],
      methodology: ['怎么用', '步骤'],
    })
  })

  it('parseIntentKeywords 空/无效返回 null', () => {
    expect(parseIntentKeywords('')).toBeNull()
    expect(parseIntentKeywords('no colon line')).toBeNull()
  })

  it('serializeIntentKeywords 往返', () => {
    const obj = { a: ['x', 'y'], b: ['z'] }
    const s = serializeIntentKeywords(obj)
    expect(parseIntentKeywords(s)).toEqual(obj)
  })
})
