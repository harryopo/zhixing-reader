// 阅读画像语料的「归层」判据（方案书第 2 批，2026-09-29）
//
// 这批的重点不是写盘，是**谁说的话别混**。方案书 §3 那三条红线逐条钉在这里：
//   R1 划线正文（作者的话）与你写的想法分属两层，同一条划线出两条记录；
//   R2 `memories` 整张表都不进语料 —— `recordInsight` 抄的是 AI 回复里那一句，
//      `extractMemoriesFromConversation` 抄的是你话里的半句片段，两者都不是你亲手
//      写下的一句话（GitHub #33），并且丢弃必须计数、不许静默；
//   R3 平台分类不是本人的标签，chose 层每条带那句 caveat，其他层连这个键都不许有。
//
// 每条负向断言都配了"该发生的确实发生了"的对照（本项目反复栽在夹具造不出触发条件，
// 于是改前改后都绿）。

import { describe, it, expect } from 'vitest'
import {
  CATEGORY_CAVEAT,
  PROFILE_LAYERS,
  SELF_RECORD_ID,
  describeCorpus,
  planCorpusRecords,
  planVolumes,
  splitIntoVolumes,
  volumeChars,
} from '../src/shared/profile-corpus'
import type { CorpusInput, CorpusRecord } from '../src/shared/profile-corpus'
import { KNOWN_GAPS, buildManifest, describeManifest } from '../src/shared/profile-manifest'

const hl = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'hl1',
  book_id: 'b1',
  book_title: '当下的力量',
  chapter_title: '第一章 你不等于你的大脑',
  content: '欢乐总是衍生于你之外的事物',
  note: '向外求求而不得',
  created_at: '2026-05-06 03:09:56',
  ...over,
})

const bk = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'b1',
  title: '当下的力量',
  author: '埃克哈特·托利',
  category: '心理与励志',
  reading_progress: 0.5,
  last_read_time: '2026-06-01T02:00:00.000Z',
  ...over,
})

function plan(over: Partial<CorpusInput> = {}) {
  return planCorpusRecords({
    highlights: [],
    books: [],
    userMessages: [],
    memories: [],
    dailyStats: [],
    selfProfile: null,
    ...over,
  })
}

const of = (records: CorpusRecord[], layer: CorpusRecord['layer']) => records.filter((r) => r.layer === layer)

describe('R1：作者的话与你写的字分属两层', () => {
  it('同一条划线既有正文又有想法 ⇒ 两条记录，id 不同、层不同', () => {
    const { records } = plan({ highlights: [hl()] })
    expect(records).toHaveLength(2)
    const said = of(records, 'said')[0]
    const marked = of(records, 'marked')[0]
    expect(said.id).toBe('hl1#note')
    expect(marked.id).toBe('hl1')
    expect(said.text).toBe('向外求求而不得')
    expect(marked.text).toBe('欢乐总是衍生于你之外的事物')
  })

  it('正文与想法永不互串：marked 层的任何一句都不出现在 said 层', () => {
    const { records } = plan({
      highlights: [hl(), hl({ id: 'hl2', note: '' }), hl({ id: 'hl3', content: '', note: '只有想法' })],
    })
    const markedTexts = of(records, 'marked').map((r) => r.text)
    expect(markedTexts).toHaveLength(2)
    for (const row of of(records, 'said')) expect(markedTexts).not.toContain(row.text)
  })

  it('只有正文没想法 ⇒ 一条 marked；想法是空白串也按"没写"处理', () => {
    expect(plan({ highlights: [hl({ note: '' })] }).records.map((r) => r.layer)).toEqual(['marked'])
    expect(plan({ highlights: [hl({ note: '  \n\t ' })] }).records.map((r) => r.layer)).toEqual(['marked'])
  })

  it('整本书评（只有想法没挂句子）⇒ 一条 said，正文空着不产 marked', () => {
    const { records } = plan({ highlights: [hl({ content: '' })] })
    expect(records.map((r) => r.layer)).toEqual(['said'])
  })

  it('正文与想法都空 ⇒ 一条都不产并计数（库里那 8 条空白行的形状）', () => {
    const { records, dropped } = plan({ highlights: [hl({ content: '', note: '' })] })
    expect(records).toEqual([])
    expect(dropped.blank).toBe(1)
  })

  it('没有主键的行不产记录（不把 undefined 拼成 "undefined#note" 这种假 id）', () => {
    const { records } = plan({ highlights: [hl({ id: '', note: '有想法但没 id' })] })
    expect(records).toEqual([])
  })
})

describe('R2 + #33：memories 整张表不进语料，且丢得不静默', () => {
  const extracted = '你似乎更信任亲眼验证过的结论'

  it('insight 与 preference 都丢掉，且各按各的原因计数', () => {
    const { records, dropped } = plan({
      memories: [
        { id: 'm1', type: 'insight', content: extracted },
        { id: 'm2', type: 'preference', content: '我喜欢' },
      ],
    })
    expect(records).toEqual([])
    expect(dropped.insight).toBe(1)
    expect(dropped.preference).toBe(1)
  })

  it('反证：同一句话作为你亲手打的消息进来时就在 said 层（证明"搜不到"是归层规则，不是没读）', () => {
    expect(plan({ memories: [{ id: 'm1', type: 'insight', content: extracted }] }).records).toEqual([])
    const said = plan({ userMessages: [{ id: 'c1', content: extracted, created_at: '2026-09-01 01:00:00' }] })
    expect(said.records).toHaveLength(1)
    expect(said.records[0].layer).toBe('said')
    expect(said.records[0].kind).toBe('user_message')
  })

  it('未知类型同样不进语料（白名单，不是"除 insight 都收"）', () => {
    const { records, dropped } = plan({ memories: [{ id: 'm9', type: 'fact', content: extracted }] })
    expect(records).toEqual([])
    expect(dropped.fact).toBeUndefined()
  })

  it('只读声明的列：行上多带的 AI 生成物不会顺进行文本', () => {
    const { records } = plan({ highlights: [hl({ ai_summary: 'AI 替我写的概括', steps: '["一","二"]' })] })
    const joined = records.map((r) => r.text).join('\n')
    expect(joined).not.toContain('AI 替我写的概括')
    expect(joined).not.toContain('一","二')
  })
})

describe('R3：chose 层带着那句平台分类说明，其他层不许带', () => {
  it('books 与 daily 每条都有 caveat，且 books 那条正是 CATEGORY_CAVEAT', () => {
    const { records } = plan({
      books: [bk(), bk({ id: 'b2', category: '' })],
      highlights: [hl()],
      dailyStats: [{ id: 'd1', date: '2026-09-01', reading_time: 600, highlights_added: 2, cards_reviewed: 5 }],
    })
    const chose = of(records, 'chose')
    expect(chose).toHaveLength(3)
    for (const row of chose) expect(row.caveat).toBeTruthy()
    for (const row of chose.filter((r) => r.kind === 'book')) expect(row.caveat).toBe(CATEGORY_CAVEAT)
    for (const row of [...of(records, 'said'), ...of(records, 'marked')]) expect('caveat' in row).toBe(false)
  })

  it('一条没划的书仍然进 chose，如实写「划了 0 条」（那 82 本不许被筛掉）', () => {
    const { records } = plan({ books: [bk({ id: 'b9', title: '一本没划过的书' })], highlights: [] })
    expect(records.find((r) => r.id === 'b9')?.text).toContain('划了 0 条')
  })

  it('划线条数来自调用方给的汇总，不在这儿翻库', () => {
    const { records } = plan({ books: [bk()], highlights: [hl({ id: 'x1' },), hl({ id: 'x2' })], highlightCountsByBook: { b1: 2 } })
    expect(of(records, 'chose')[0].text).toContain('划了 2 条')
  })

  it('当日三项全 0 ⇒ 不产这条，计入 no_activity', () => {
    const { records, dropped } = plan({
      dailyStats: [{ id: 'd1', date: '2026-09-01', reading_time: 0, highlights_added: 0, cards_reviewed: 0 }],
    })
    expect(records).toEqual([])
    expect(dropped.no_activity).toBe(1)
  })

  it('日子写在 text 里、at 是 null —— 按天归集那一列给不出"哪一刻"', () => {
    const { records } = plan({
      dailyStats: [{ id: 'd1', date: '2026-09-01', reading_time: 660, highlights_added: 0, cards_reviewed: 0 }],
    })
    const row = of(records, 'chose').find((r) => r.kind === 'daily')
    expect(row?.text).toContain('2026-09-01 读了 11 分钟')
    expect(row?.at).toBe(null)
  })
})

describe('自述资料与对话：有就说、没有就不摆空壳', () => {
  it('三项拼成一条 said；只填一项时另两项一个字都不多', () => {
    const both = plan({ selfProfile: { nickname: 'harryopo', location: '杭州', bio: '' } })
    expect(of(both.records, 'said').find((r) => r.kind === 'self')?.text).toBe('昵称：harryopo · 所在地：杭州')
    const only = plan({ selfProfile: { nickname: 'harryopo', location: '   ', bio: '\n' } })
    expect(of(only.records, 'said').find((r) => r.kind === 'self')?.text).toBe('昵称：harryopo')
  })

  it('没填或全空白 ⇒ 不产那条，id 用常量而不是编一个', () => {
    expect(plan({ selfProfile: null }).records).toEqual([])
    expect(plan({ selfProfile: { nickname: '', location: '', bio: '' } }).records).toEqual([])
    const one = plan({ selfProfile: { nickname: 'harryopo', location: '', bio: '' } })
    expect(of(one.records, 'said').find((r) => r.kind === 'self')?.id).toBe(SELF_RECORD_ID)
  })

  it('空的对话消息不产记录并计数', () => {
    const { records, dropped } = plan({ userMessages: [{ id: 'c1', content: '   ' }] })
    expect(records).toEqual([])
    expect(dropped.blank_message).toBe(1)
  })
})

describe('每条只落一层，id 回得去库里那一行', () => {
  const full = () => plan({
    books: [bk()],
    highlights: [hl(), hl({ id: 'hl2', note: '' })],
    userMessages: [{ id: 'c1', content: '我该怎么开始写卡片笔记', created_at: '2026-09-02 10:00:00' }],
    memories: [{ id: 'm1', type: 'insight', content: '不该进来的一句' }],
    dailyStats: [{ id: 'd1', date: '2026-09-02', reading_time: 1200, highlights_added: 1, cards_reviewed: 0 }],
    selfProfile: { nickname: 'harryopo', location: '', bio: '把读到的用起来' },
  })

  it('三层数量之和 == 总数，且层名只可能是这三者', () => {
    const { records } = full()
    const sum = PROFILE_LAYERS.reduce((n, layer) => n + records.filter((r) => r.layer === layer).length, 0)
    expect(sum).toBe(records.length)
    expect(new Set(records.map((r) => r.layer))).toEqual(new Set(PROFILE_LAYERS))
  })

  it('id 唯一（同一条划线贡献的两行不撞键）', () => {
    const ids = full().records.map((r) => r.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每行 JSON 往返后与原对象**严格**一字不差（toStrictEqual 才分得开"键不存在"与"键值是 undefined"）', () => {
    for (const record of full().records) expect(JSON.parse(JSON.stringify(record))).toStrictEqual(record)
  })
})

describe('回指不到库里那一行的，宁可不产', () => {
  // 语料包唯一的价值就是"外部 AI 说的每条结论都能对回你库里那一行"。
  // 没有主键的行进不去（`#note` 后缀拼在空串上会造出一个假 id），
  // 而缺的那些列一律不摆 —— 不写「未知书籍」这种看起来像值的假值。
  it('划线没主键 ⇒ said 与 marked 都不产', () => {
    const { records } = plan({ highlights: [hl({ id: '', content: '有正文', note: '有想法' })] })
    expect(records).toEqual([])
  })

  it('消息没主键 ⇒ 不产', () => {
    expect(plan({ userMessages: [{ id: '', content: '一句没 id 的话' }] }).records).toEqual([])
  })

  it('日粒度行没主键 ⇒ 跳过那一条，其余照常', () => {
    const { records } = plan({
      dailyStats: [
        { id: '', date: '2026-09-01', reading_time: 600, highlights_added: 0, cards_reviewed: 0 },
        { id: 'd2', date: '2026-09-02', reading_time: 600, highlights_added: 0, cards_reviewed: 0 },
      ],
    })
    expect(of(records, 'chose').map((r) => r.id)).toEqual(['d2'])
  })

  it('接口没给书名与章节名 ⇒ 那两个键根本不出现', () => {
    const { records } = plan({ highlights: [hl({ book_title: '', chapter_title: null, content: '' })] })
    const row = of(records, 'said')[0]
    expect('bookTitle' in row).toBe(false)
    expect('chapterTitle' in row).toBe(false)
    expect(row.bookId).toBe('b1')
  })

  it('书没有阅读进度那一列 ⇒ 说 0%，不说 NaN%', () => {
    const { records } = plan({ books: [bk({ reading_progress: undefined })] })
    expect(of(records, 'chose')[0].text).toContain('读了 0%')
  })
})

describe('时刻只有一份判定', () => {
  it('库里那串不带时区标记的 UTC 墙上时钟 ⇒ 补 Z，不再被按本地时区读', () => {
    const { records } = plan({ highlights: [hl({ note: '只这一句' })] })
    expect(of(records, 'said')[0].at).toBe('2026-05-06T03:09:56.000Z')
  })

  it('已经带 Z 的串照它自己声明的时区走，不二次挪', () => {
    const { records } = plan({ books: [bk({ last_read_time: '2026-06-01T02:00:00.000Z' })] })
    expect(of(records, 'chose')[0].at).toBe('2026-06-01T02:00:00.000Z')
  })

  it('解不出来的时间交回 null —— 不猜 1970，也不填"此刻"', () => {
    for (const bad of ['不是时间', 0, null, undefined]) {
      const { records } = plan({ highlights: [hl({ created_at: bad })] })
      for (const row of records) expect(row.at).toBe(null)
    }
  })
})

describe('分卷：外部 AI 一次喂不下整层', () => {
  const row = (id: string, text: string, layer: CorpusRecord['layer'] = 'marked'): CorpusRecord => ({
    id, layer, kind: 'highlight', text, at: null,
  })

  it('正好到上限 ⇒ 还是一卷；再多一条 ⇒ 开第二卷', () => {
    expect(splitIntoVolumes([row('a', 'x'.repeat(2000)), row('b', 'y'.repeat(2000))], 4000)).toHaveLength(1)
    expect(splitIntoVolumes([row('a', 'x'.repeat(2000)), row('b', 'y'.repeat(2000)), row('c', 'z')], 4000)).toHaveLength(2)
  })

  it('一条就超上限的独占一卷，不截断、不丢条目', () => {
    const volumes = splitIntoVolumes([row('big', 'x'.repeat(9000)), row('small', '短句')], 4000)
    expect(volumes).toHaveLength(2)
    expect(volumeChars(volumes[0])).toBe(9000)
    expect(volumes.flat().map((r) => r.id)).toEqual(['big', 'small'])
  })

  it('按层分卷：文件名带层名与两位序号，层序固定 said → marked → chose', () => {
    const volumes = planVolumes(
      [
        row('s1', '我写的第一句', 'said'), row('s2', '我写的第二句', 'said'),
        row('m1', '作者的第一句'), row('m2', '作者的第二句'),
        row('c1', '一本书', 'chose'),
      ],
      6,
    )
    expect(volumes.map((v) => v.file)).toEqual([
      'said-vol-01.jsonl', 'said-vol-02.jsonl',
      'marked-vol-01.jsonl', 'marked-vol-02.jsonl',
      'chose-vol-01.jsonl',
    ])
  })

  it('没有记录的层不产空卷', () => {
    expect(planVolumes([row('m1', '一句')], 4000).map((v) => v.layer)).toEqual(['marked'])
    expect(planVolumes([], 4000)).toEqual([])
  })
})

describe('人话统计与 manifest：不许把"没有痕迹"报成"导出成功 0 条"', () => {
  const now = new Date('2026-09-29T10:00:00.000Z')

  it('空语料那句里没有任何一个 0 条', () => {
    const text = describeCorpus(plan())
    expect(text).toContain('没有可导出的痕迹')
    expect(text).not.toMatch(/0 条/)
  })

  it('有内容时三层各自的条数与字数都在', () => {
    const text = describeCorpus(plan({ highlights: [hl()], books: [bk()] }))
    expect(text).toContain('我说的 1 条（7 字）')
    expect(text).toContain('我挑的 1 条（13 字）')
    expect(text).toContain('我选的 1 条')
  })

  it('丢了记忆就说清丢了几条；没丢就不许多这一句', () => {
    const withDrop = describeCorpus(plan({
      highlights: [hl()],
      memories: [{ id: 'm1', type: 'insight', content: '一句' }, { id: 'm2', type: 'preference', content: '半句' }],
    }))
    expect(withDrop).toContain('另有 2 条系统从对话里抽的记忆没算进来')
    expect(describeCorpus(plan({ highlights: [hl()] }))).not.toContain('没算进来')
  })

  it('manifest 的逐层数与文件里的那批同源', () => {
    const p = plan({ highlights: [hl()], books: [bk()], userMessages: [{ id: 'c1', content: '一问' }] })
    const volumes = planVolumes(p.records, 4000)
    const manifest = buildManifest({ plan: p, volumes, now })
    expect(manifest.generated_at).toBe('2026-09-29T10:00:00.000Z')
    expect(manifest.layers.said.records).toBe(2)
    expect(manifest.total_records).toBe(p.records.length)
    expect(manifest.total_chars).toBe(volumeChars(p.records))
    expect(manifest.volumes.reduce((n, v) => n + v.records, 0)).toBe(p.records.length)
    expect(manifest.dropped).toEqual(p.dropped)
  })

  it('空的层自己说清为什么是空的，不为空的层不许带上这句', () => {
    const one = buildManifest({ plan: plan({ highlights: [hl({ content: '' })], books: [bk()] }), volumes: [], now })
    expect(one.caveats.join('\n')).toContain('「我挑的」这层是空的')
    expect(one.caveats.join('\n')).not.toContain('「我说的」这层是空的')

    const all = buildManifest({ plan: plan(), volumes: [], now }).caveats.join('\n')
    for (const phrase of ['「我说的」', '「我挑的」', '「我选的」']) expect(all).toContain(`${phrase}这层是空的`)
  })

  it('三条已知缺口恒在，即使三层都不为空', () => {
    const manifest = buildManifest({ plan: plan({ highlights: [hl()], books: [bk()] }), volumes: [], now })
    for (const gap of KNOWN_GAPS) expect(manifest.caveats).toContain(gap)
  })

  it('界面那句同时报卷数与总字数', () => {
    const p = plan({ highlights: [hl()] })
    const manifest = buildManifest({ plan: p, volumes: planVolumes(p.records, 4000), now })
    expect(describeManifest(manifest)).toBe(`${manifest.summary} · 分 2 卷 · 共 ${manifest.total_chars} 字`)
  })
})
