// ipc/profile 的 handler 行为测试（方案书第 2 批，2026-09-29）
//
// 判据照旧：注册**真实的** registerProfileHandlers，数据库用真库（这批要问的就是
// 「库里那些行最后落到文件里是什么形状」），写盘**不 mock fs** —— 真写到 .test-tmp
// 再把文件读回来对账。mock 只打在两条外圈缝上：保存框（dialog）与档案页自述三项
// （读的是 settings 文件，与本批要验的归层无关）。
//
// 三条最值钱的：
//  1) 取消时**一次库都不读、磁盘上一个文件都不许多**（顺序写反了就会白读一趟）；
//  2) 空语料**不写盘** —— 导一个空包出去，外部 AI 只能凭猜测编一个人；
//  3) 界面上报的那句数与文件里的行数出自同一份 manifest（两处各算一次迟早漂）。

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest'
import { BrowserWindow, dialog } from 'electron'
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import {
  booksDb,
  conversationDb,
  dailyStatsDb,
  getDatabase,
  highlightsDb,
  memoriesDb,
  profileStatementsDb,
} from '../electron/database'
import { registerProfileHandlers } from '../electron/ipc/profile'
import { IPC_CHANNELS } from '../src/shared/ipc-channels'
import { CATEGORY_CAVEAT } from '../src/shared/profile-corpus'
import { STATEMENT_FILE_APP, STATEMENT_FILE_VERSION } from '../src/shared/profile-statements'
import type { CorpusExportResult, ProfileManifest } from '../src/shared/profile-manifest'
import type { StatementImportResult, StatementListView } from '../src/shared/profile-statements'

const PROFILE = 'user-data-profile-corpus'
process.env.ZHIXING_TEST_PROFILE = PROFILE
const DATA_DIR = join(process.cwd(), '.test-tmp', PROFILE)
const PICKED = join(DATA_DIR, 'picked')

const seamer = vi.hoisted(() => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  // 返回类型要在这儿就标出来：写成 `vi.fn(() => null)` 会被推成"只能返回 null"，
  // 后面 mockReturnValue(真资料) 直接编译不过（本项目被这类"推断出来的窄类型"咬过几次）
  selfProfile: { get: vi.fn((): { nickname: string; location: string; bio: string } | null => null) },
}))

vi.mock('../electron/logger', () => ({ logger: seamer.logger }))
vi.mock('../electron/services/user-profile-service', () => ({ getUserSelfProfile: seamer.selfProfile.get }))

type Handler = (...args: unknown[]) => unknown

function register(): Map<string, Handler> {
  const handlers = new Map<string, Handler>()
  registerProfileHandlers((channel, handler) => handlers.set(channel, handler))
  return handlers
}

const EXPORT = IPC_CHANNELS.PROFILE.EXPORT_PACKAGE

function pickAt(dir: string) {
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [dir], blobURLs: [] } as never)
}

function cancelPick() {
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: true, filePaths: [], blobURLs: [] } as never)
}

async function exportOnce(): Promise<CorpusExportResult> {
  const handler = register().get(EXPORT)
  if (!handler) throw new Error(`profile 没注册 ${EXPORT}`)
  return (await handler()) as CorpusExportResult
}

/** 把导出的目录读成 { 文件名: 每行 parse 出来的对象 }，manifest 单独一项 */
function readPackage(dir: string): { files: Record<string, string[]>; manifest: ProfileManifest } {
  const names = readdirSync(dir).sort()
  const files: Record<string, string[]> = {}
  for (const name of names) {
    if (name === 'manifest.json') continue
    files[name] = readFileSync(join(dir, name), 'utf8').split('\n').filter(Boolean)
  }
  return { files, manifest: JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as ProfileManifest }
}

function seedLibrary() {
  booksDb.create({ id: 'b1', title: '当下的力量', author: '埃克哈特·托利', category: '心理与励志', reading_progress: 0.62 })
  booksDb.create({ id: 'b2', title: '一本没划过的书' })
  highlightsDb.create({
    id: 'hl_both', book_id: 'b1', chapter_title: '第一章', content: '欢乐总是衍生于你之外的事物',
    note: '向外求求而不得', created_at: '2026-05-06 03:09:56',
  })
  highlightsDb.create({ id: 'hl_only_marked', book_id: 'b1', content: '请观察你内在的任何一种防卫感', created_at: '2026-05-09 12:41:13' })
  conversationDb.create('第一次对话', 'b1')
  const [conversation] = conversationDb.getAll()
  conversationDb.addMessage(String(conversation.id), { role: 'user', content: '我该怎么开始写卡片笔记' })
  conversationDb.addMessage(String(conversation.id), { role: 'assistant', content: '先从一句原文开始' })
  memoriesDb.create({ type: 'insight', category: 'c', content: '你似乎更信任亲眼验证过的结论' })
  dailyStatsDb.upsertReadingTime('2026-05-06', 660)
}

beforeAll(async () => {
  // 全局 electron stub 只给了 getAllWindows，导出那条路先问 getFocusedWindow
  Object.assign(BrowserWindow, { getFocusedWindow: vi.fn(() => null) })
  await setupTestDatabase()
  rmSync(DATA_DIR, { recursive: true, force: true })
})

afterAll(() => {
  teardownTestDatabase()
  rmSync(DATA_DIR, { recursive: true, force: true })
})

afterEach(() => {
  // 会抛错的 spy 一律在这儿收，不写在断言之后 —— 那条断言一红就把"会抛的 getAll"
  // 漏给后面每个用例，于是一片红而红的不是同一个原因（本项目栽过一次）
  vi.restoreAllMocks()
})

beforeEach(() => {
  vi.mocked(dialog.showOpenDialog).mockReset()
  seamer.selfProfile.get.mockReset().mockReturnValue(null)
  getDatabase().run('DELETE FROM chat_messages')
  getDatabase().run('DELETE FROM conversations')
  getDatabase().run('DELETE FROM memories')
  getDatabase().run('DELETE FROM daily_stats')
  getDatabase().run('DELETE FROM highlights')
  getDatabase().run('DELETE FROM books')
  getDatabase().run('DELETE FROM profile_statements')
  rmSync(PICKED, { recursive: true, force: true })
})

describe('保存框：先问存哪儿，再决定要不要读库', () => {
  it('用户点取消 ⇒ saved:false、一次库都不读、磁盘上不产生任何文件', async () => {
    seedLibrary()
    cancelPick()
    const readAll = vi.spyOn(highlightsDb, 'getAll')

    const result = await exportOnce()

    expect(result).toEqual({ saved: false, summary: '已取消，磁盘上没有动', dir: '', volumes: 0, reason: 'canceled' })
    expect(readAll).not.toHaveBeenCalled()
    expect(existsSync(PICKED)).toBe(false)
    readAll.mockRestore()
  })

  it('库里确实没东西 ⇒ 不写盘，且那句说的是"没痕迹"而不是"导出成功 0 条"', async () => {
    pickAt(PICKED)
    const result = await exportOnce()

    expect(result.saved).toBe(false)
    expect(result.reason).toBe('empty')
    expect(result.summary).toContain('没有可导出的痕迹')
    expect(result.summary).not.toMatch(/0 条/)
    expect(existsSync(PICKED)).toBe(false)
  })

  it('取消与空语料是两种形状，界面才说得准下一句（不许共用一个返回值）', async () => {
    seedLibrary()
    cancelPick()
    const canceled = await exportOnce()
    // 把库清空再导一次 —— 两种 saved:false 必须各说各的
    for (const table of ['chat_messages', 'conversations', 'daily_stats', 'highlights', 'books']) {
      getDatabase().run(`DELETE FROM ${table}`)
    }
    pickAt(PICKED)
    const empty = await exportOnce()
    expect(canceled.reason).toBe('canceled')
    expect(empty.reason).toBe('empty')
  })
})

describe('真库导出：文件里的每一行都对得上库里那一行', () => {
  it('manifest + 三个层的卷各一份，文件名与 manifest 报的一一对应', async () => {
    seedLibrary()
    pickAt(PICKED)
    const result = await exportOnce()
    expect(result.saved, result.summary).toBe(true)

    const dir = join(result.dir)
    expect(dir.endsWith(join('corpus'))).toBe(true)
    const { files, manifest } = readPackage(dir)

    expect(Object.keys(files).sort()).toEqual(['chose-vol-01.jsonl', 'marked-vol-01.jsonl', 'said-vol-01.jsonl'])
    expect(manifest.volumes.map((v) => v.file).sort()).toEqual(Object.keys(files))
    for (const volume of manifest.volumes) {
      expect(files[volume.file]).toHaveLength(volume.records)
    }
  })

  it('said 层是"你写的字"、marked 层是"作者的话"，两个文件不互串（R1 落到盘上的形状）', async () => {
    seedLibrary()
    pickAt(PICKED)
    const { files } = readPackage((await exportOnce()).dir)

    const said = files['said-vol-01.jsonl'].map((line) => JSON.parse(line))
    const marked = files['marked-vol-01.jsonl'].map((line) => JSON.parse(line))
    expect(said.map((r) => r.text).sort()).toEqual(['向外求求而不得', '我该怎么开始写卡片笔记'])
    expect(marked.map((r) => r.id).sort()).toEqual(['hl_both', 'hl_only_marked'])
    // 想法那一条在 said 里带 #note 后缀，在 marked 里没有 —— 回指才对得上
    expect(some(said, (r) => r.id === 'hl_both#note')).toBe(true)
    expect(marked.some((r) => String(r.id).endsWith('#note'))).toBe(false)
    for (const r of marked) expect(r.text).not.toContain('向外求')
  })

  it('AI 抄下来的那条记忆一个字都不进文件，但 manifest 说清丢了几条（R2 + #33）', async () => {
    seedLibrary()
    pickAt(PICKED)
    const { files, manifest } = readPackage((await exportOnce()).dir)

    const all = Object.values(files).flat().join('\n')
    expect(all).not.toContain('亲眼验证过的结论')
    expect(manifest.dropped.insight).toBe(1)
  })

  it('chose 层每一行都带着那句平台分类说明，said / marked 一行都不带（R3）', async () => {
    seedLibrary()
    seamer.selfProfile.get.mockReturnValue({ nickname: 'harryopo', location: '', bio: '' })
    pickAt(PICKED)
    const result = await exportOnce()
    const { files } = readPackage(result.dir)

    const chose = (files['chose-vol-01.jsonl'] ?? []).map((line) => JSON.parse(line))
    expect(chose.length).toBeGreaterThan(0)
    for (const row of chose.filter((r) => r.kind === 'book')) expect(row.caveat).toBe(CATEGORY_CAVEAT)
    for (const name of ['said-vol-01.jsonl', 'marked-vol-01.jsonl']) {
      for (const line of files[name]) expect('caveat' in JSON.parse(line)).toBe(false)
    }
  })

  it('一条没划的书仍然进 chose，划线条数如实写 0', async () => {
    seedLibrary()
    pickAt(PICKED)
    const { files } = readPackage((await exportOnce()).dir)
    const chose = (files['chose-vol-01.jsonl'] ?? []).map((line) => JSON.parse(line))
    const untouched = chose.find((r) => r.bookId === 'b2')
    expect(untouched?.text).toContain('划了 0 条')
  })

  it('文件里那一刻与库里那一列指的是同一个瞬间（对账库，不猜字面）', async () => {
    seedLibrary()
    pickAt(PICKED)
    const { files } = readPackage((await exportOnce()).dir)
    const said = files['said-vol-01.jsonl'].map((line) => JSON.parse(line))
    const row = highlightsDb.getAll().find((h) => h.id === 'hl_both')
    // 库里那一串是「日期 空格 时间」的 UTC 墙上时钟；语料里必须补 Z 而不是再挪一次
    expect(String(row?.created_at)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
    expect(said.find((r) => r.id === 'hl_both#note').at).toBe(`${String(row?.created_at).replace(' ', 'T')}.000Z`)
  })

  it('界面那句与 manifest 同源：条数、卷数、字数三处都对得上文件', async () => {
    seedLibrary()
    pickAt(PICKED)
    const result = await exportOnce()
    const { files, manifest } = readPackage(result.dir)

    expect(result.summary).toContain(`分 ${manifest.volumes.length} 卷`)
    expect(result.summary).toContain(`共 ${manifest.total_chars} 字`)
    expect(result.volumes).toBe(manifest.volumes.length)
    expect(manifest.total_records).toBe(Object.values(files).flat().length)
  })

  it('重复导出同一天不留下上一次的旧卷（外部 AI 是按目录读文件的，留下就是把删掉的划线当成还在）', async () => {
    seedLibrary()
    pickAt(PICKED)
    const first = await exportOnce()
    const firstDir = first.dir
    const before = readdirSync(firstDir).filter((n) => n.startsWith('marked-vol-')).sort()
    expect(before).toEqual(['marked-vol-01.jsonl'])

    // 同一天再导一次（同名目录被复用），并且这回把 marked 清空
    getDatabase().run("UPDATE highlights SET content = '' WHERE content <> ''")
    pickAt(PICKED)
    const second = await exportOnce()
    const after = readdirSync(second.dir).filter((n) => n.startsWith('marked-vol-'))
    expect(after, `${firstDir} 里旧的 marked 卷没被摘掉`).toEqual([])
    // 上一次写过、这一次不该再存在的文件不残留
    expect(readdirSync(second.dir).sort()).toEqual(['chose-vol-01.jsonl', 'manifest.json', 'said-vol-01.jsonl'])
  })
})

describe('读库炸了不许演成"没有语料"', () => {
  it('getAll 抛错时把错误交出去，而不是回一个空包', async () => {
    const boom = vi.spyOn(highlightsDb, 'getAll').mockImplementation(() => {
      throw new Error('库文件被占用')
    })
    pickAt(PICKED)

    await expect(exportOnce()).rejects.toThrow('库文件被占用')
    expect(existsSync(PICKED)).toBe(false)
    boom.mockRestore()
  })
})

function some<T>(rows: T[], test: (row: T) => boolean): boolean {
  return rows.some(test)
}

const LIST = IPC_CHANNELS.PROFILE.LIST_STATEMENTS
const IMPORT = IPC_CHANNELS.PROFILE.IMPORT_STATEMENTS
const VERDICT = IPC_CHANNELS.PROFILE.SET_STATEMENT_VERDICT

function pickFile(path: string) {
  vi.mocked(dialog.showOpenDialog).mockResolvedValue({ canceled: false, filePaths: [path], blobURLs: [] } as never)
}

/** 写一份结论文件到磁盘（导入这条路不 mock fs：界面拿到的就是这一份文件的真实结果） */
function writeStatementsFile(name: string, statements: unknown[], origin = 'nuwa'): string {
  const path = join(DATA_DIR, name)
  writeFileSync(path, `${JSON.stringify({ app: STATEMENT_FILE_APP, version: STATEMENT_FILE_VERSION, origin, statements }, null, 2)}\n`, 'utf8')
  return path
}

async function run(channel: string, ...args: unknown[]): Promise<unknown> {
  const handler = register().get(channel)
  if (!handler) throw new Error(`profile 没注册 ${channel}`)
  return handler(...args)
}

const importOnce = (path?: string) => (path ? pickFile(path) : cancelPick(), run(IMPORT) as Promise<StatementImportResult>)
const listOnce = () => run(LIST) as Promise<StatementListView>

describe('导入结论清单：先问文件、逐条过闸、只写库不写盘', () => {
  it('用户点取消 ⇒ saved:false、一次库都不读、库里一行都没有', async () => {
    seedLibrary()
    const readCorpus = vi.spyOn(highlightsDb, 'getAll')
    const readStatements = vi.spyOn(profileStatementsDb, 'getAll')

    const result = await importOnce()

    expect(result).toEqual({ saved: false, summary: '已取消，库里什么都没改', written: 0, reason: 'canceled' })
    // 取消那条路上任何一摊数据都不许先读：语料与已有结论都排在弹框之后
    expect(readCorpus).not.toHaveBeenCalled()
    expect(readStatements).not.toHaveBeenCalled()
    expect(profileStatementsDb.getAll()).toEqual([])
    readCorpus.mockRestore()
    readStatements.mockRestore()
  })

  it('两条合规格的进库，判定从 pending 起', async () => {
    seedLibrary()
    const path = writeStatementsFile('ok.json', [
      { id: 'p1', layer: 'said', topic: '表达', statement: '我写东西短、直白', evidenceIds: ['hl_both#note', 'hl_only_marked'] },
      { id: 'p2', layer: 'marked', topic: '读什么', statement: '我挑的多是向内看的句子', evidenceIds: ['hl_both', 'hl_only_marked'] },
    ])

    const result = await importOnce(path)

    expect(result.saved).toBe(true)
    expect(result.written).toBe(2)
    const rows = profileStatementsDb.getAll()
    expect(rows.map((row) => row.id).sort()).toEqual(['nuwa:p1', 'nuwa:p2'])
    expect(rows.every((row) => row.verdict === 'pending')).toBe(true)
  })

  it('只有一条证据的那条被挡下，其余照常进，且 logger.warn 有那一条', async () => {
    seedLibrary()
    const path = writeStatementsFile('half.json', [
      { id: 'p1', layer: 'said', topic: '表达', statement: '站得住的那条', evidenceIds: ['hl_both#note', 'hl_only_marked'] },
      { id: 'p2', layer: 'said', topic: '表达', statement: '一条孤证', evidenceIds: ['hl_both#note'] },
    ])

    const result = await importOnce(path)

    expect(result.written).toBe(1)
    expect(result.summary).toContain('证据不足两条 1 条')
    expect(profileStatementsDb.getAll().map((row) => row.statement)).toEqual(['站得住的那条'])
    expect(seamer.logger.warn).toHaveBeenCalledWith('Profile statement rejected on import', { id: 'p2', reason: 'too_few_evidence' })
  })

  it('证据 id 对不上这份语料 ⇒ 整条不收（收了那颗「回原文」就是死链）', async () => {
    seedLibrary()
    const path = writeStatementsFile('ghost.json', [
      { id: 'p1', layer: 'said', topic: '表达', statement: '引用了一条不存在的划线', evidenceIds: ['hl_both#note', 'hl_404'] },
    ])

    const result = await importOnce(path)

    expect(result.saved).toBe(false)
    expect(result.reason).toBe('nothing_accepted')
    expect(result.summary).toContain('对不上你的语料 1 条')
    expect(profileStatementsDb.getAll()).toEqual([])
  })

  it('文件里替我写 verdict 无效 ⇒ 那一格只有我按下才算', async () => {
    seedLibrary()
    const path = writeStatementsFile('pushy.json', [
      { id: 'p1', layer: 'said', topic: '表达', statement: '外部 AI 替我判了', evidenceIds: ['hl_both#note', 'hl_only_marked'], verdict: 'confirmed' },
    ])

    await importOnce(path)

    expect(profileStatementsDb.getAll()[0].verdict).toBe('pending')
  })

  it('重导入不覆盖我已判过的那条（正文也不动），报的是"保持原样"', async () => {
    seedLibrary()
    const first = writeStatementsFile('v1.json', [
      { id: 'p1', layer: 'said', topic: '表达', statement: '第一版说法', evidenceIds: ['hl_both#note', 'hl_only_marked'] },
    ])
    await importOnce(first)
    profileStatementsDb.setVerdict('nuwa:p1', 'confirmed')

    const second = writeStatementsFile('v2.json', [
      { id: 'p1', layer: 'said', topic: '表达', statement: '第二版说法', evidenceIds: ['hl_both#note', 'hl_only_marked'] },
    ])
    const result = await importOnce(second)

    expect(result.saved).toBe(false)
    expect(result.summary).toContain('你已经判过的 1 条保持原样')
    expect(profileStatementsDb.getAll()[0].statement).toBe('第一版说法')
  })

  it('不是知行的结论文件 ⇒ 认出来并拒收，库里一字不动', async () => {
    seedLibrary()
    const path = join(DATA_DIR, 'other.json')
    writeFileSync(path, '{"app":"someone-else","version":"1.0","origin":"nuwa","statements":[]}\n', 'utf8')

    const result = await importOnce(path)

    expect(result.saved).toBe(false)
    expect(result.reason).toBe('bad_file')
    expect(result.summary).toContain('库里什么都没改')
    expect(profileStatementsDb.getAll()).toEqual([])
  })

  it('读文件读不动时把错误交出去，不演成"这份文件没有结论"', async () => {
    seedLibrary()
    pickAt(DATA_DIR) // 选中的是目录：readFileSync 会抛 EISDIR
    await expect(run(IMPORT)).rejects.toThrow()
    expect(profileStatementsDb.getAll()).toEqual([])
  })
})

describe('核验区读的那一份', () => {
  it('证据原句、书名、点得回去的那条划线，都来自语料自己那批记录', async () => {
    seedLibrary()
    const path = writeStatementsFile('ok.json', [
      { id: 'p1', layer: 'said', topic: '表达', statement: '我写东西短', evidenceIds: ['hl_both#note', 'hl_only_marked'] },
    ])
    await importOnce(path)

    const view = await listOnce()

    expect(view.statements).toHaveLength(1)
    expect(view.evidence['hl_both#note']).toEqual({
      text: '向外求求而不得',
      bookId: 'b1',
      bookTitle: '当下的力量',
      highlightId: 'hl_both',
    })
    // marked 层的 id 不带后缀，回原文指向它自己
    expect(view.evidence['hl_only_marked'].highlightId).toBe('hl_only_marked')
  })

  it('划线被删掉之后，那一条不出现在证据表里（界面据此说"已经找不到了"）', async () => {
    seedLibrary()
    const path = writeStatementsFile('ok.json', [
      { id: 'p1', layer: 'said', topic: '表达', statement: '我写东西短', evidenceIds: ['hl_both#note', 'hl_only_marked'] },
    ])
    await importOnce(path)
    getDatabase().run("DELETE FROM highlights WHERE id = 'hl_only_marked'")

    const view = await listOnce()

    expect(view.evidence.hl_only_marked).toBeUndefined()
    expect(view.evidence['hl_both#note']).toBeDefined()
  })

  it('库里一条结论都没有时交回空表，不抛，也不白读一整套语料', async () => {
    seedLibrary()
    const readAll = vi.spyOn(highlightsDb, 'getAll')

    expect(await listOnce()).toEqual({ statements: [], evidence: {} })
    expect(readAll).not.toHaveBeenCalled()
    readAll.mockRestore()
  })

  it('正向对照：有结论要摆证据时确实去读了语料', async () => {
    seedLibrary()
    await importOnce(writeStatementsFile('ok.json', [{ id: 'p1', layer: 'said', topic: '表达', statement: '我写东西短', evidenceIds: ['hl_both#note', 'hl_only_marked'] }]))
    const readAll = vi.spyOn(highlightsDb, 'getAll')

    const view = await listOnce()

    expect(Object.keys(view.evidence).sort()).toEqual(['hl_both#note', 'hl_only_marked'])
    expect(readAll).toHaveBeenCalled()
    readAll.mockRestore()
  })

  it('读库炸了要抛出去 —— 界面那句只能是"这一次没读出来"', async () => {
    const boom = vi.spyOn(profileStatementsDb, 'getAll').mockImplementation(() => {
      throw new Error('库文件被占用')
    })
    await expect(listOnce()).rejects.toThrow('库文件被占用')
    boom.mockRestore()
  })
})

describe('按下「对 / 不对 / 不确定」', () => {
  it('记上了交回 true，库里那一行跟着变', async () => {
    seedLibrary()
    await importOnce(writeStatementsFile('ok.json', [{ id: 'p1', layer: 'said', topic: '表达', statement: '我写东西短', evidenceIds: ['hl_both#note', 'hl_only_marked'] }]))

    const result = (await run(VERDICT, 'nuwa:p1', 'confirmed')) as { recorded: boolean }

    expect(result).toEqual({ recorded: true })
    expect(profileStatementsDb.getAll()[0].verdict).toBe('confirmed')
  })

  it('库里没有这一条时交回 false，不凭空建行', async () => {
    seedLibrary()
    const result = (await run(VERDICT, 'nuwa:没有这条', 'confirmed')) as { recorded: boolean }
    expect(result).toEqual({ recorded: false })
    expect(profileStatementsDb.getAll()).toEqual([])
  })

  it('判定只认那四个取值：把 `{}` 或字符串掰成"按过了"要抛出去', async () => {
    seedLibrary()
    await importOnce(writeStatementsFile('ok.json', [{ id: 'p1', layer: 'said', topic: '表达', statement: '我写东西短', evidenceIds: ['hl_both#note', 'hl_only_marked'] }]))

    for (const bad of [{}, [], 42, null, 'maybe', '']) {
      await expect(run(VERDICT, 'nuwa:p1', bad)).rejects.toThrow(/不是我认的判定/)
    }
    expect(profileStatementsDb.getAll()[0].verdict).toBe('pending')
  })

  it('没有编号时抛，且不碰库里那一行', async () => {
    seedLibrary()
    await importOnce(writeStatementsFile('ok.json', [{ id: 'p1', layer: 'said', topic: '表达', statement: '我写东西短', evidenceIds: ['hl_both#note', 'hl_only_marked'] }]))
    for (const bad of ['', '   ', {}, 42, null]) {
      await expect(run(VERDICT, bad, 'confirmed')).rejects.toThrow('没有结论编号')
    }
    expect(profileStatementsDb.getAll()[0].verdict).toBe('pending')
  })
})
