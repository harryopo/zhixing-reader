// ipc/knowledge 的 handler 行为测试（2026-09-28，销覆盖率 DEBT 一笔）
//
// `electron/ipc/knowledge.ts` 实测 **50.76 / 79.31 / 50**。funcs 50 说的就是这件事：
// 一半的 handler 从没被执行过。既有 `ai-coverage-channel.test.ts` 只走了两条 coverage
// 与 extract 的分批续跑，剩下没人碰的是最要紧的两块：
//  1) **extract 里「本地没划线就去微信读书把笔记搬回来」那半边** —— 它真往库里写行、
//     真调 AI，失败还全被 try/catch 咽进日志；
//  2) **SKILL.EXPORT_FILE** —— 生成一段 Skill 文本再弹保存框写盘，字段映射与文件名
//     安全化全在这个 handler 里，界面上只有一句「导出完成」。
//
// 判据照旧：注册**真实的** `registerKnowledgeHandlers`，mock 只打在外圈那几份
// （ai-service / ai-sdk-service / weread-api / knowledge-card-service / logger）。
// **数据库用真库** —— 自动导入与台账那批判据量的就是「库里到底有没有这一行」，
// mock 掉 database 等于什么都没测。`vi.mock` 的路径相对本文件解析，所以写 `../electron/...`。
// 导出那组不 mock fs：文件真写到 `.test-tmp` 下再读回来对内容。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { BrowserWindow, dialog, type SaveDialogOptions } from 'electron'
import * as fs from 'fs'
import { join } from 'path'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import {
  aiBatchesDb,
  booksDb,
  getDatabase,
  highlightsDb,
  knowledgeCardsDb,
  methodologiesDb,
} from '../electron/database'

const PROFILE = 'user-data-ipc-knowledge'
process.env.ZHIXING_TEST_PROFILE = PROFILE
const OUT_FILE = join(process.cwd(), '.test-tmp', PROFILE, 'skill-export.md')

const seams = vi.hoisted(() => ({
  extract: vi.fn(),
  interpret: vi.fn(),
  application: vi.fn(),
  skill: vi.fn(),
  fetchAllContent: vi.fn(),
  distillBook: vi.fn(),
  cancelDistill: vi.fn(),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

vi.mock('../electron/ai-service', () => ({ extractMethodologies: seams.extract }))
vi.mock('../electron/ai-sdk-service', () => ({
  generateCardInterpretation: seams.interpret,
  generateCardApplication: seams.application,
  generateSkill: seams.skill,
}))
vi.mock('../electron/weread-api', () => ({ fetchAllContent: seams.fetchAllContent }))
vi.mock('../electron/services/knowledge-card-service', () => ({
  knowledgeCardService: { distillBook: seams.distillBook, cancelDistill: seams.cancelDistill },
}))
vi.mock('../electron/logger', () => ({ logger: seams.logger }))

const { registerKnowledgeHandlers } = await import('../electron/ipc/knowledge')

type Handler = (...args: unknown[]) => unknown
type SkillPayload = {
  name: string
  nameEn?: string
  triggerScenario: string
  description: string
  steps: string[]
  outputFormat: string
  examples: string
  bookTitle: string
}

function at(channel: string): Handler {
  const handlers = new Map<string, Handler>()
  registerKnowledgeHandlers((name, handler) => handlers.set(name, handler as Handler))
  const fn = handlers.get(channel)
  if (!fn) throw new Error(`没有注册这条通道：${channel}`)
  return fn
}

/** 库里 highlights 那一行原样读出来（判"到底插进去没有"只能问库） */
function highlightRows(): Array<Record<string, unknown>> {
  const result = getDatabase().exec(
    'SELECT id, book_id, chapter_title, content, note FROM highlights ORDER BY content'
  )
  if (result.length === 0) return []
  const columns = result[0].columns ?? []
  return (result[0].values ?? []).map((values) =>
    Object.fromEntries(columns.map((c, i) => [String(c), values[i]]))
  )
}

/** 保存框：默认"用户点了取消"，各用例自己改成选了某个路径 */
function savesTo(path: string | null): void {
  const show = vi.mocked(dialog.showSaveDialog)
  if (path === null) {
    show.mockResolvedValue({ canceled: true, filePath: '' })
    return
  }
  show.mockResolvedValue({ canceled: false, filePath: path })
}

/**
 * 保存框是 `showSaveDialog(win, options)` 两个参数，但 electron 的类型声明把
 * `vi.mocked` 解析到了"只收 options"那一个重载上（拿不到第二个实参），
 * 所以这里按实参数组取，再单独说明它是选项对象。
 */
function saveOptions(): SaveDialogOptions {
  const calls = vi.mocked(dialog.showSaveDialog).mock.calls as unknown as unknown[][]
  return (calls.at(-1) ?? [])[1] as SaveDialogOptions
}

function seedMethodology(overrides: Record<string, unknown> = {}): void {
  methodologiesDb.create({
    id: 'm1',
    book_id: 'b1',
    name: '课题分离',
    name_en: 'Separation of Tasks',
    trigger_scenario: '被人期待压住时',
    description: '把别人的课题还给别人',
    steps: ['认出这是谁的课题', '只做自己的那一步'],
    output_format: '三步清单',
    examples: '孩子写作业',
    tags: ['人际'],
    ...overrides,
  })
}

/** 一份"接口不给章节名、要靠 chapters 对照表"的真实形状 */
const threeNotes = () => ({
  bookmarks: [
    { bookmarkId: 'x1', chapterTitle: '', markText: '第一条划线', chapterUid: 7, createTime: 1_700_000_000 },
    { bookmarkId: 'x2', chapterTitle: '自带章名', markText: '第二条划线', chapterUid: 99, createTime: 1_700_000_100 },
  ],
  notes: [
    { reviewId: 'r1', chapterTitle: '', abstract: '笔记的摘句', content: '我写的想法', chapterUid: 8, createTime: 1_700_000_200 },
  ],
  chapters: [
    { chapterUid: 7, title: '第二夜 一切烦恼都来自人际关系' },
    { chapterUid: 8, title: '第四夜 要有被讨厌的勇气' },
  ],
})

beforeEach(async () => {
  await setupTestDatabase()
  booksDb.create({ id: 'b1', title: '被讨厌的勇气' })
  // 导出那组真写盘，父目录得先在（保存框是 mock，路径由测试自己给）
  fs.mkdirSync(join(process.cwd(), '.test-tmp', PROFILE), { recursive: true })
  vi.clearAllMocks()
  seams.extract.mockResolvedValue([{ name: '一个方法', sourceHighlightIds: [] }])
  seams.skill.mockResolvedValue('# SKILL 正文')
  seams.fetchAllContent.mockResolvedValue({ bookmarks: [], notes: [], chapters: [] })
  seams.distillBook.mockResolvedValue({ cards: [], coverage: {} })
  savesTo(null)
  Object.assign(BrowserWindow, { getFocusedWindow: vi.fn(() => null) })
})

afterEach(() => {
  teardownTestDatabase()
  if (fs.existsSync(OUT_FILE)) fs.rmSync(OUT_FILE)
})

describe('透传那半边：参数一字不改，交回库那一层的结果', () => {
  it('方法论两个读口各走各的：整表与按 id', () => {
    seedMethodology()
    methodologiesDb.create({ id: 'm2', book_id: 'b1', name: '活在此时此刻' })
    const all = at(IPC_CHANNELS.METHODOLOGIES.GET_ALL)() as Array<Record<string, unknown>>
    expect(all.map((m) => m.id).sort()).toEqual(['m1', 'm2'])
    expect((at(IPC_CHANNELS.METHODOLOGIES.GET_BY_ID)('m2') as Record<string, unknown>).name).toBe('活在此时此刻')
  })

  it('知识卡片整表读 + 按 id 改一行，改完读得到', () => {
    knowledgeCardsDb.create({ id: 'k1', book_id: 'b1', type: 'concept', title: '旧标题', content: '正文' })
    at(IPC_CHANNELS.KNOWLEDGE_CARDS.UPDATE)('k1', { title: '新标题' })
    const all = at(IPC_CHANNELS.KNOWLEDGE_CARDS.GET_ALL)() as Array<Record<string, unknown>>
    expect(all).toHaveLength(1)
    expect(all[0].title).toBe('新标题')
  })

  it('找回来源划线那口把库里的条数包成 {updated}：没得补时说 0，正文一字不差才算', () => {
    knowledgeCardsDb.create({ id: 'k1', book_id: 'b1', type: 'concept', title: '无源', content: '这句话库里没有' })
    expect(at(IPC_CHANNELS.KNOWLEDGE_CARDS.BACKFILL_SOURCE)()).toEqual({ updated: 0 })

    highlightsDb.create({ id: 'h_src', book_id: 'b1', content: '一切烦恼都来自人际关系' })
    knowledgeCardsDb.create({
      id: 'k_src',
      book_id: 'b1',
      type: 'concept',
      title: '烦恼',
      content: '一切烦恼都来自人际关系',
    })
    expect(at(IPC_CHANNELS.KNOWLEDGE_CARDS.BACKFILL_SOURCE)()).toEqual({ updated: 1 })
  })
})

describe('蒸馏与单条生成：花钱的入口要照实转下去', () => {
  it('蒸馏转给服务的是同一本书 + 同样的标题', async () => {
    await at(IPC_CHANNELS.KNOWLEDGE_CARDS.DISTILL)('b1', '被讨厌的勇气')
    expect(seams.distillBook).toHaveBeenCalledWith('b1', '被讨厌的勇气', { replace: false })
  })

  it('replace 只认严格 true：undefined / 字符串 / 数字都不算「让用户清空重做」', async () => {
    for (const value of [undefined, 'true', 1, {}]) {
      seams.distillBook.mockClear()
      await at(IPC_CHANNELS.KNOWLEDGE_CARDS.DISTILL)('b1', '一本书', value)
      expect(seams.distillBook).toHaveBeenCalledWith('b1', '一本书', { replace: false })
    }
    seams.distillBook.mockClear()
    await at(IPC_CHANNELS.KNOWLEDGE_CARDS.DISTILL)('b1', '一本书', true)
    expect(seams.distillBook).toHaveBeenCalledWith('b1', '一本书', { replace: true })
  })

  it('取消蒸馏把服务的布尔包成 {success}，没在跑时如实是 false', () => {
    seams.cancelDistill.mockReturnValue(true)
    expect(at(IPC_CHANNELS.KNOWLEDGE_CARDS.CANCEL_DISTILL)('b1')).toEqual({ success: true })
    seams.cancelDistill.mockReturnValue(false)
    expect(at(IPC_CHANNELS.KNOWLEDGE_CARDS.CANCEL_DISTILL)('b1')).toEqual({ success: false })
  })

  it('卡片解读 / 应用四个参数逐字转给生成层，交回的是 {text}', async () => {
    seams.interpret.mockResolvedValue('这段解读')
    seams.application.mockResolvedValue('这段应用')
    expect(await at(IPC_CHANNELS.KNOWLEDGE_CARDS.GENERATE_INTERPRETATION)('一本书', '一个概念', '正文', 'concept')).toEqual({ text: '这段解读' })
    expect(seams.interpret).toHaveBeenCalledWith('一本书', '一个概念', '正文', 'concept')
    expect(await at(IPC_CHANNELS.KNOWLEDGE_CARDS.GENERATE_APPLICATION)('一本书', '一个概念', '正文', 'method')).toEqual({ text: '这段应用' })
    expect(seams.application).toHaveBeenCalledWith('一本书', '一个概念', '正文', 'method')
  })

  it('生成层报错时如实失败，不兜成一段空文本', async () => {
    seams.interpret.mockRejectedValue(new Error('模型超时'))
    await expect(at(IPC_CHANNELS.KNOWLEDGE_CARDS.GENERATE_INTERPRETATION)('a', 'b', 'c', 'd')).rejects.toThrow('模型超时')
  })
})

describe('导出 Skill：先问存哪儿，再生成，再写盘', () => {
  it('库里那一列是 NULL 时交回空串，而不是「null」字样进提示词', async () => {
    seedMethodology({ name_en: null, trigger_scenario: null, description: null, steps: null, output_format: null, examples: null })
    savesTo(OUT_FILE)
    await at(IPC_CHANNELS.SKILL.EXPORT_FILE)('m1', '一本书')
    expect(seams.skill.mock.calls[0][0] as SkillPayload).toEqual({
      name: '课题分离',
      nameEn: undefined,
      triggerScenario: '',
      description: '',
      steps: [],
      outputFormat: '',
      examples: '',
      bookTitle: '一本书',
    })
  })

  it('库里那行 name 是空串时：交回空名，文件名落到「方法论.md」而不是拼一个 null', async () => {
    seedMethodology({ name: '' })
    savesTo(OUT_FILE)
    await at(IPC_CHANNELS.SKILL.EXPORT_FILE)('m1', '一本书')
    expect(seams.skill.mock.calls[0][0]).toMatchObject({ name: '' })
    expect(saveOptions().defaultPath).toBe('方法论.md')
  })

  it('保存框没取消却给了空路径 ⇒ 一样当没保存：不发 AI、不写盘', async () => {
    seedMethodology()
    vi.mocked(dialog.showSaveDialog).mockResolvedValue({ canceled: false, filePath: '' })
    await expect(at(IPC_CHANNELS.SKILL.EXPORT_FILE)('m1', '一本书')).resolves.toEqual({ saved: false })
    expect(seams.skill).not.toHaveBeenCalled()
  })

  it('方法论不存在 ⇒ 抛错，AI 一次都不发、保存框一次都不弹', async () => {
    await expect(at(IPC_CHANNELS.SKILL.EXPORT_FILE)('没有这个 id', '一本书')).rejects.toThrow('方法论不存在')
    expect(seams.skill).not.toHaveBeenCalled()
    expect(dialog.showSaveDialog).not.toHaveBeenCalled()
  })

  it('用户点取消 ⇒ {saved:false}，而且一次 AI 都不许发（取消了不该把这份钱花掉）', async () => {
    seedMethodology()
    const res = await at(IPC_CHANNELS.SKILL.EXPORT_FILE)('m1', '被讨厌的勇气')
    expect(res).toEqual({ saved: false })
    expect(seams.skill).not.toHaveBeenCalled()
    expect(fs.existsSync(OUT_FILE)).toBe(false)
  })

  it('保存框给的路径 ⇒ 真写到磁盘，文件内容就是生成层交回的那段', async () => {
    seedMethodology()
    savesTo(OUT_FILE)
    const res = (await at(IPC_CHANNELS.SKILL.EXPORT_FILE)('m1', '被讨厌的勇气')) as { saved: boolean; path: string }
    expect(res).toEqual({ saved: true, path: OUT_FILE })
    expect(fs.readFileSync(OUT_FILE, 'utf8')).toBe('# SKILL 正文')
    expect(seams.logger.info).toHaveBeenCalledWith('Skill exported to file', { methodologyId: 'm1', path: OUT_FILE })
  })

  it('七个字段逐个转给生成层：库里那一行是蛇形，参数是驼峰', async () => {
    seedMethodology()
    savesTo(OUT_FILE)
    await at(IPC_CHANNELS.SKILL.EXPORT_FILE)('m1', '被讨厌的勇气')
    expect(seams.skill.mock.calls[0][0] as SkillPayload).toEqual({
      name: '课题分离',
      nameEn: 'Separation of Tasks',
      triggerScenario: '被人期待压住时',
      description: '把别人的课题还给别人',
      steps: ['认出这是谁的课题', '只做自己的那一步'],
      outputFormat: '三步清单',
      examples: '孩子写作业',
      bookTitle: '被讨厌的勇气',
    })
  })

  it('没有英文名时交回 undefined，而不是把中文名塞进去冒充', async () => {
    seedMethodology({ name_en: null })
    savesTo(OUT_FILE)
    await at(IPC_CHANNELS.SKILL.EXPORT_FILE)('m1', '一本书')
    expect(seams.skill.mock.calls[0][0]).toMatchObject({ name: '课题分离', nameEn: undefined })
  })

  it('steps 是坏 JSON ⇒ 记一句警告、按空数组继续导出（一列脏数据不该让整个导出崩掉）', async () => {
    seedMethodology()
    getDatabase().run(`UPDATE methodologies SET steps = '[{ 坏掉的 JSON' WHERE id = 'm1'`)
    savesTo(OUT_FILE)
    await expect(at(IPC_CHANNELS.SKILL.EXPORT_FILE)('m1', '一本书')).resolves.toMatchObject({ saved: true })
    expect(seams.skill.mock.calls[0][0]).toMatchObject({ steps: [] })
    expect(seams.logger.warn).toHaveBeenCalledWith('Failed to parse methodology steps for skill generation')
  })

  it('steps 是合法 JSON 但不是数组（老数据的对象形状）⇒ 同样按空数组，不猜', async () => {
    seedMethodology()
    getDatabase().run(`UPDATE methodologies SET steps = '{"a":1}' WHERE id = 'm1'`)
    savesTo(OUT_FILE)
    await at(IPC_CHANNELS.SKILL.EXPORT_FILE)('m1', '一本书')
    expect(seams.skill.mock.calls[0][0]).toMatchObject({ steps: [] })
  })

  it('steps 里混进数字时转成字符串（模板只吃字符串数组）', async () => {
    seedMethodology({ steps: [1, 2] })
    savesTo(OUT_FILE)
    await at(IPC_CHANNELS.SKILL.EXPORT_FILE)('m1', '一本书')
    expect(seams.skill.mock.calls[0][0]).toMatchObject({ steps: ['1', '2'] })
  })

  it('文件名安全化：Windows 非法字符全换成 -、连续空格并成一个', async () => {
    seedMethodology({ name: '课题/分离:到底*怎么?做"才<' })
    savesTo(OUT_FILE)
    await at(IPC_CHANNELS.SKILL.EXPORT_FILE)('m1', '一本书')
    expect(saveOptions().defaultPath).toBe('课题-分离-到底-怎么-做-才-.md')
  })

  it('名字超长时截到 60 字，没名字时落到 methodology.md', async () => {
    seedMethodology({ name: '长'.repeat(80) })
    savesTo(OUT_FILE)
    await at(IPC_CHANNELS.SKILL.EXPORT_FILE)('m1', '一本书')
    expect(saveOptions().defaultPath).toBe(`${'长'.repeat(60)}.md`)

    seedMethodology({ id: 'm_empty', name: '   ' })
    await at(IPC_CHANNELS.SKILL.EXPORT_FILE)('m_empty', '一本书')
    expect(saveOptions().defaultPath).toBe('methodology.md')
  })
})

describe('库里没划线时，extract 先去微信读书把笔记搬回来', () => {
  it('本地有划线就一次都不碰微信读书', async () => {
    highlightsDb.create({ id: 'h0', book_id: 'b1', content: '本地已有的一条' })
    await at(IPC_CHANNELS.METHODOLOGIES.EXTRACT)('b1', '被讨厌的勇气')
    expect(seams.fetchAllContent).not.toHaveBeenCalled()
  })

  it('三条都进了库，且章节名是从 chapters 对照表查出来的（接口自己没给）', async () => {
    seams.fetchAllContent.mockResolvedValue(threeNotes())
    await at(IPC_CHANNELS.METHODOLOGIES.EXTRACT)('b1', '被讨厌的勇气')
    expect(seams.fetchAllContent).toHaveBeenCalledWith('b1')
    const rows = highlightRows()
    expect(rows).toHaveLength(3)
    // 按正文取（库里排的序不是导入序，断序没有意义）
    expect(new Set(rows.map((r) => r.chapter_title))).toEqual(
      new Set(['第二夜 一切烦恼都来自人际关系', '第四夜 要有被讨厌的勇气', '自带章名']),
    )
    expect(rows.find((r) => r.content === '第一条划线')?.chapter_title).toBe('第二夜 一切烦恼都来自人际关系')
    expect(rows.find((r) => r.content === '笔记的摘句')?.chapter_title).toBe('第四夜 要有被讨厌的勇气')
  })

  it('笔记那条：正文是接口给的摘句，note 才是用户写的想法', async () => {
    seams.fetchAllContent.mockResolvedValue(threeNotes())
    await at(IPC_CHANNELS.METHODOLOGIES.EXTRACT)('b1', '一本书')
    const note = highlightRows().find((r) => r.note === '我写的想法')
    expect(note).toMatchObject({ content: '笔记的摘句', book_id: 'b1' })
  })

  it('搬进来的每条都有 id：没有 id 就进不了批次台账，下次点会把同一批再喂一遍（重复花钱）', async () => {
    seams.fetchAllContent.mockResolvedValue(threeNotes())
    await at(IPC_CHANNELS.METHODOLOGIES.EXTRACT)('b1', '一本书')
    const ids = highlightRows().map((r) => String(r.id))
    expect(ids).toHaveLength(3)
    expect(ids.every((id) => /^hl_/.test(id))).toBe(true)
    // 记进台账的必须真是那三条的 id，而不是空集合
    expect(aiBatchesDb.getProcessedIds('b1', 'methodologies').sort()).toEqual([...ids].sort())
  })

  it('接口不给章节名、也没有 chapters 对照表 ⇒ 章名留空，不写「未知章节」这种假值', async () => {
    seams.fetchAllContent.mockResolvedValue({
      bookmarks: [{ bookmarkId: 'x1', chapterTitle: '', markText: '没有章名的一条', chapterUid: 42, createTime: 1_700_000_000 }],
      notes: [],
      chapters: [],
    })
    await at(IPC_CHANNELS.METHODOLOGIES.EXTRACT)('b1', '一本书')
    expect(highlightRows()[0].chapter_title).toBe('')
  })

  it('搬回来的两条正文一模一样 ⇒ 第二条判重不入库，但整批照样继续（导入条数如实记进日志）', async () => {
    seams.fetchAllContent.mockResolvedValue({
      bookmarks: [
        { bookmarkId: 'x1', chapterTitle: '同一章', markText: '重复的一条', chapterUid: 1, createTime: 1_700_000_000 },
        { bookmarkId: 'x2', chapterTitle: '同一章', markText: '重复的一条', chapterUid: 1, createTime: 1_700_000_000 },
      ],
      notes: [],
      chapters: [],
    })
    await at(IPC_CHANNELS.METHODOLOGIES.EXTRACT)('b1', '一本书')
    expect(highlightRows()).toHaveLength(1)
    expect(seams.logger.info).toHaveBeenCalledWith('自动导入笔记完成', {
      bookId: 'b1',
      scanned: 2,
      importedCount: 1,
    })
    expect(seams.extract.mock.calls[0][0]).toHaveLength(1)
  })

  it('单条插入真抛错时只丢那一条，其余照常导入（一条失败不带走整批）', async () => {
    seams.fetchAllContent.mockResolvedValue(threeNotes())
    const realCreate = highlightsDb.create.bind(highlightsDb)
    const create = vi.spyOn(highlightsDb, 'create').mockImplementation((h: Record<string, unknown>) => {
      // 挡掉两条，留下另一条
      if (h.content === '第一条划线' || h.content === '笔记的摘句') throw new Error('这一条被外键挡了')
      return realCreate(h)
    })
    try {
      await at(IPC_CHANNELS.METHODOLOGIES.EXTRACT)('b1', '一本书')
      expect(highlightRows()).toHaveLength(1)
      // 划线与想法现在走同一个循环、同一个口径报失败（字段清单收成一份之后没有两个循环了）
      expect(seams.logger.error).toHaveBeenCalledWith('导入划线失败:', expect.any(Error))
      expect(seams.logger.error).toHaveBeenCalledTimes(2)
      expect(seams.extract.mock.calls[0][0]).toHaveLength(1)
    } finally {
      create.mockRestore()
    }
  })

  it('取回的过程失败且抛的不是 Error ⇒ 照原文说出来，不变成 undefined', async () => {
    seams.fetchAllContent.mockRejectedValue('微信读书那边挂了')
    await expect(at(IPC_CHANNELS.METHODOLOGIES.EXTRACT)('b1', '一本书')).rejects.toThrow('自动导入笔记失败: 微信读书那边挂了')
  })

  it('旧库里那种没有 id、正文还是空串的行 ⇒ 照样转给 AI，不崩、也不猜一个 id', async () => {
    getDatabase().run(`INSERT INTO highlights (id, book_id, content) VALUES (NULL, 'b1', '')`)
    await at(IPC_CHANNELS.METHODOLOGIES.EXTRACT)('b1', '一本书')
    expect(seams.extract.mock.calls[0][0]).toEqual([
      { id: undefined, content: '', note: undefined, chapterTitle: undefined },
    ])
    // 没有 id 的行进不了台账（不然下次点会被判成"已经处理过"）
    expect(aiBatchesDb.getProcessedIds('b1', 'methodologies')).toEqual([])
  })

  it('搬回来的两条笔记正文一模一样 ⇒ 第二条同样判重不入库（不只是划线那条判重）', async () => {
    seams.fetchAllContent.mockResolvedValue({
      bookmarks: [],
      notes: [
        { reviewId: 'r1', chapterTitle: '同一章', abstract: '重复的摘句', content: '想法甲', chapterUid: 1, createTime: 1_700_000_000 },
        { reviewId: 'r2', chapterTitle: '同一章', abstract: '重复的摘句', content: '想法乙', chapterUid: 1, createTime: 1_700_000_000 },
      ],
      chapters: [],
    })
    await at(IPC_CHANNELS.METHODOLOGIES.EXTRACT)('b1', '一本书')
    expect(highlightRows()).toHaveLength(1)
    expect(seams.logger.info).toHaveBeenCalledWith('自动导入笔记完成', {
      bookId: 'b1',
      scanned: 2,
      importedCount: 1,
    })
  })

  it('划线没有笔记也没有章名 ⇒ 转给 AI 的那份里另两个字段是 undefined，不写空串冒充有', async () => {
    highlightsDb.create({ id: 'h_bare', book_id: 'b1', content: '只有正文的一条' })
    await at(IPC_CHANNELS.METHODOLOGIES.EXTRACT)('b1', '一本书')
    expect(seams.extract.mock.calls[0][0]).toEqual([{ id: 'h_bare', content: '只有正文的一条', note: undefined, chapterTitle: undefined }])
  })

  it('AI 给了来源划线编号时逐条换算成真实 id 落库，没给时是空数组而不是猜', async () => {
    highlightsDb.create({ id: 'hA', book_id: 'b1', content: '甲' })
    highlightsDb.create({ id: 'hB', book_id: 'b1', content: '乙' })
    seams.extract.mockResolvedValue([
      { name: '有来源的', sourceHighlightIds: ['hA', 'hB'] },
      { name: '没来源的' },
    ])
    const res = (await at(IPC_CHANNELS.METHODOLOGIES.EXTRACT)('b1', '一本书')) as {
      methodologies: Array<{ id: string }>
    }
    expect(res.methodologies).toHaveLength(2)
    const stored = methodologiesDb
      .getByBookId('b1')
      .map((m) => ({ name: String(m.name), ids: JSON.parse(String(m.source_highlight_ids ?? '[]')) }))
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
    expect(stored).toEqual([
      { name: '没来源的', ids: [] },
      { name: '有来源的', ids: ['hA', 'hB'] },
    ])
  })

  it('取回的过程本身失败 ⇒ 说的是「自动导入笔记失败: <原因>」', async () => {
    seams.fetchAllContent.mockRejectedValue(new Error('网络断了'))
    await expect(at(IPC_CHANNELS.METHODOLOGIES.EXTRACT)('b1', '一本书')).rejects.toThrow('自动导入笔记失败: 网络断了')
  })

  it('微信读书确实一条笔记都没有 ⇒ 说的是「没有笔记」，不许混成「导入失败」', async () => {
    seams.fetchAllContent.mockResolvedValue({ bookmarks: [], notes: [], chapters: [] })
    await expect(at(IPC_CHANNELS.METHODOLOGIES.EXTRACT)('b1', '一本书')).rejects.toThrow('该书在微信读书中也没有笔记，无法提取方法论')
    // 那句「导入失败」没被顺手扣在一条没失败的通路上
    expect(seams.logger.error).not.toHaveBeenCalledWith('自动导入笔记失败:', expect.anything())
  })

  it('搬完之后接着算覆盖：分母就是刚搬进来的这三条', async () => {
    seams.fetchAllContent.mockResolvedValue(threeNotes())
    const res = (await at(IPC_CHANNELS.METHODOLOGIES.EXTRACT)('b1', '一本书')) as {
      coverage: { total: number; covered: number }
      nothingNew: boolean
    }
    expect(res.coverage).toMatchObject({ total: 3, covered: 3 })
    expect(res.nothingNew).toBe(false)
  })

  it('AI 那一步失败时不许记台账：半途炸了，下次点还得把这批补上', async () => {
    seams.fetchAllContent.mockResolvedValue(threeNotes())
    seams.extract.mockRejectedValue(new Error('AI 超时'))
    await expect(at(IPC_CHANNELS.METHODOLOGIES.EXTRACT)('b1', '一本书')).rejects.toThrow('AI 超时')
    expect(aiBatchesDb.getProcessedIds('b1', 'methodologies')).toEqual([])
  })
})
