// 行映射层的判据（2026-09-28）
//
// DEBT 表这笔的实测是 75.34 / 50 / 57.14：28 个导出函数里 **12 个从没被执行过**
// （九个列表包装 + 三个时间格式化），branches 有一半没判据。这一层是
// 「库里那一行 → 界面上那个数字」之间唯一的翻译处，它错了不报错，
// 只是每个页面一起错 —— 本项目已经在这一层抓过恒为 0 的「笔记」页签、
// 被 React 画成一个「0」的 is_read、以及三个库里根本不存在的列名。
//
// 判据分两类来源，都不 mock：
//  1. **真库**：走生产的 db 模块写入、`SELECT *` 读回，再喂给映射器。
//     量的是「写进去的那一刻，读出来还是那一刻」。
//  2. **手造行**：库里造不出来的形状（同一列蛇形与驼峰同时出现、脏 JSON、非数组）——
//     这些正是通道那侧一改返回形状就会撞上的形状。
//
// `tests/db-row-types.test.ts` 钉的是「声明的字段对不对得上库里的列」（列名层面），
// 这一份钉的是「值对不对得上」（时刻有没有走样、NULL 落成什么、数组解不出来时怎么办）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import {
  getDatabase,
  booksDb,
  highlightsDb,
  cardsDb,
  knowledgeCardsDb,
  methodologiesDb,
  vocabularyDb,
  articlesDb,
  conversationDb,
} from '../electron/database'
import {
  mapBooks,
  mapHighlights,
  mapCards,
  mapKnowledgeCards,
  mapMethodologies,
  mapVocabularies,
  mapArticles,
  mapConversations,
  mapChatMessages,
  safeNum,
  safeStr,
  safeBool,
  safeDate,
  safeJsonArray,
  safeStrArray,
  safeJsonObject,
  formatDate,
  formatDateShort,
  formatTimeAgo,
} from '../src/renderer/src/utils/db-mapper'
import { dbTimeIso, parseDbTime } from '../src/shared/db-time'

/** 把 `exec` 的结果摊成行对象（只用在生产读口的形状我需要原样看的时候） */
function rawRows(sql: string, params: unknown[] = []): Record<string, unknown>[] {
  const result = getDatabase().exec(sql, params)
  if (result.length === 0) return []
  const { columns, values } = result[0]
  return values.map((v) => Object.fromEntries(columns.map((c, i) => [c, v[i]])))
}

const BOOK_ID = 'b_mapper_fixture'
const HL_ID = 'hl_mapper_fixture'

function seedBook(): void {
  booksDb.create({
    id: BOOK_ID,
    title: '被讨厌的勇气',
    author: '岸见一郎',
    cover: 'https://cdn/cover.jpg',
    isbn: '9787111667308',
    publisher: '机械工业出版社',
    description: '阿德勒心理学对话体',
    category: '心理学',
    reading_progress: 0.5,
    total_chapter: 12,
    last_read_time: '2026-09-20T00:00:00.000Z',
    is_finished: 1,
  })
}

describe('真库的一行 → 映射器交回的那一行（逐字段对账）', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    seedBook()
  })

  afterEach(() => {
    teardownTestDatabase()
    vi.useRealTimers()
  })

  it('书籍：进度与「读完」走的是库里的真列，不是界面猜的', () => {
    const mapped = mapBooks([booksDb.getById(BOOK_ID)])[0]

    expect(mapped.id).toBe(BOOK_ID)
    expect(mapped.title).toBe('被讨厌的勇气')
    expect(mapped.author).toBe('岸见一郎')
    // reading_progress → progress：书架那根进度条与档案页「读完 N 本」都读这两个名字
    expect(mapped.progress).toBe(0.5)
    expect(mapped.isFinished).toBe(1)
    expect(mapped.totalChapter).toBe(12)
    // 已经是带 Z 的 ISO（微信读书那侧写进来的就是 ISO），时刻原样保住
    expect(mapped.lastReadAt).toBe('2026-09-20T00:00:00.000Z')
    // publish_date 没写 → 空串，不是 'null'、不是 1970
    expect(mapped.publishDate).toBe('')
  })

  it('书籍：库里 datetime("now") 落的那一列，读回来还是此刻', () => {
    // 这条是本批修的那条真缺陷的判据：库里存的是**不带时区标记的 UTC 墙上时钟**
    // （`datetime('now')` 与我们自己写的 toSqliteDateTime 都是这个形状），
    // 而 JS 的 `new Date('2026-09-28 03:15:00')` 按**本地时区**解释。
    // 在 UTC+8 上，刚建的一行被读成 8 小时前 —— 界面按它排序、说「X 小时前」、
    // 按它归日，全都跟着早 8 小时。
    const mapped = mapBooks([booksDb.getById(BOOK_ID)])[0]
    const drift = Math.abs(Date.now() - new Date(mapped.createdAt).getTime())
    expect(drift, `created_at 读回来漂了 ${drift / 3600000} 小时`).toBeLessThan(2 * 60 * 1000)
  })

  it('划线：真实划线时刻写进去、读回来还是同一刻', () => {
    highlightsDb.create({
      id: HL_ID,
      book_id: BOOK_ID,
      chapter_title: '第二夜 一切烦恼都来自人际关系',
      content: '重要的不是过去发生了什么，而是你如何对待它。',
      note: '这句才是整本书的抓手',
      style: 1,
      created_at: '2026-09-01T15:00:00.000Z',
    })

    const [mapped] = mapHighlights(highlightsDb.getByBookId(BOOK_ID))

    expect(mapped.id).toBe(HL_ID)
    expect(mapped.bookId).toBe(BOOK_ID)
    expect(mapped.chapterTitle).toBe('第二夜 一切烦恼都来自人际关系')
    expect(mapped.note).toBe('这句才是整本书的抓手')
    // 想法（note 非空）才算「笔记」，库里没有类型列
    expect(mapped.type).toBe('note')
    expect(mapped.style).toBe(1)
    expect(mapped.createdAt).toBe('2026-09-01T15:00:00.000Z')
  })

  it('划线：章节名为 NULL 时给出「未知章节」，没笔记时 type 是 highlight', () => {
    highlightsDb.create({ id: 'hl_plain', book_id: BOOK_ID, content: '没有章名的一句' })

    const [mapped] = mapHighlights(highlightsDb.getByBookId(BOOK_ID))

    expect(mapped.chapterTitle).toBe('未知章节')
    expect(mapped.note).toBe('')
    expect(mapped.type).toBe('highlight')
  })

  it('复习卡：due / last_review 这两列的名字只有库知道，界面拿的是 nextReviewAt', () => {
    highlightsDb.create({ id: HL_ID, book_id: BOOK_ID, content: '给复习卡当来源的那一句' })
    const card = cardsDb.create(HL_ID)
    const rows = rawRows('SELECT * FROM cards WHERE id = ?', [card.id])
    const raw = rows[0]

    expect(Object.keys(raw)).toContain('due')
    const [mapped] = mapCards(rows)

    expect(mapped.id).toBe(card.id)
    expect(mapped.highlightId).toBe(HL_ID)
    expect(mapped.nextReviewAt).toBe(safeDate(raw.due))
    // 从未复习过：last_review 是 NULL → 空串，界面上的「上次复习」因此是不显示而不是显示 1970
    expect(mapped.lastReviewAt).toBe('')
    expect(mapped.reps).toBe(0)
    expect(mapped.lapses).toBe(0)
    expect(mapped.state).toBe(0)
    // cards 表没有 book_id 列，只有带 JOIN 的那条读口才供得上；裸读就是空串
    expect(mapped.bookId).toBe('')
  })

  it('知识卡片：tags / related_card_ids 是 JSON 文本列，交回数组', () => {
    knowledgeCardsDb.create({
      id: 'kc_1',
      book_id: BOOK_ID,
      type: 'concept',
      title: '课题分离',
      content: '把自己的课题与别人的课题分开。',
      interpretation: '判断是谁的课题，看后果由谁承担。',
      application: null,
      related_card_ids: ['kc_2', 'kc_3'],
      tags: ['阿德勒', '关系'],
      source_highlight_id: HL_ID,
      review_count: 4,
      mastery_level: 60,
    })

    const [mapped] = mapKnowledgeCards(knowledgeCardsDb.getByBookId(BOOK_ID))

    expect(mapped.type).toBe('concept')
    expect(mapped.tags).toEqual(['阿德勒', '关系'])
    expect(mapped.relatedCardIds).toEqual(['kc_2', 'kc_3'])
    expect(mapped.application).toBe('')
    expect(mapped.sourceHighlightId).toBe(HL_ID)
    expect(mapped.reviewCount).toBe(4)
    expect(mapped.masteryLevel).toBe(60)
  })

  it('知识卡片：tags 列里是坏 JSON 时回空数组，不把整张卡弄崩', () => {
    knowledgeCardsDb.create({
      id: 'kc_bad',
      book_id: BOOK_ID,
      type: 'quote',
      title: '摘句',
      content: '内容',
    })
    getDatabase().run(`UPDATE knowledge_cards SET tags = ? WHERE id = 'kc_bad'`, ['{这不是 JSON'])

    const [mapped] = mapKnowledgeCards(knowledgeCardsDb.getByBookId(BOOK_ID))

    expect(mapped.tags).toEqual([])
    expect(mapped.title).toBe('摘句')
  })

  it('方法论：steps 解成数组，name_en / practice_count 走真实列名', () => {
    methodologiesDb.create({
      id: 'mt_1',
      book_id: BOOK_ID,
      name: '活在此时此刻法',
      nameEn: 'Live in the Present',
      trigger_scenario: '反复为过去后悔时',
      description: '把注意力拉回今天能做的事',
      steps: ['察觉自己在反刍', '列出今天能做的一件小事', '去做'],
      output_format: '三步清单',
      examples: '例子',
      tags: ['行动'],
      source_highlight_ids: [HL_ID],
      mastery_level: 30,
      practice_count: 2,
    })

    const [mapped] = mapMethodologies(methodologiesDb.getByBookId(BOOK_ID))

    expect(mapped.name).toBe('活在此时此刻法')
    expect(mapped.nameEn).toBe('Live in the Present')
    expect(mapped.steps).toHaveLength(3)
    expect(mapped.sourceHighlightIds).toEqual([HL_ID])
    expect(mapped.practiceCount).toBe(2)
    expect(mapped.masteryLevel).toBe(30)
    expect(mapped.triggerScenario).toBe('反复为过去后悔时')
    expect(mapped.outputFormat).toBe('三步清单')
    expect(mapped.examples).toBe('例子')
    // 没给的可选列是空串而不是 undefined（界面 `if (m.outputFormat)` 才不会静默走偏）
    expect(mapMethodologies([{ id: 'm2', name: '只有名字' }])[0].outputFormat).toBe('')
  })

  it('生词：库里的 DEFAULT 值原样读出来（ef_factor 2.5、未掌握、无复习时间）', () => {
    const created = vocabularyDb.create({ word: 'Leading', meaning_zh: '领先的' })
    expect(created, '生词没写进库').not.toBeNull()

    const [mapped] = mapVocabularies(vocabularyDb.getAll())

    expect(mapped.word).toBe('leading')
    expect(mapped.meaning_zh).toBe('领先的')
    expect(mapped.is_mastered).toBe(false)
    expect(mapped.review_count).toBe(0)
    expect(mapped.ef_factor).toBe(2.5)
    expect(mapped.last_review_at).toBe('')
  })

  it('生词与文章的时间列**原样交出**，不掰成 ISO（页面按前 10 位判「今天」）', () => {
    // DailyLearning 判「今天已复习 N 个词」用的是 `last_review_at.slice(0, 10)`，
    // 读的正是库里那一串的日期部分。这一层要是把它 safeDate 一遍，
    // 带时区偏移的值一转换就可能挪到前一天，那张清单就整天少算。
    vocabularyDb.create({ id: 'v_raw', word: 'rawcase', meaning_zh: '原样' })
    getDatabase().run(
      `UPDATE vocabulary SET created_at = '2026-09-01 07:30:00', last_review_at = '2026-09-02 07:30:00' WHERE id = 'v_raw'`
    )

    const [mapped] = mapVocabularies(
      rawRows('SELECT * FROM vocabulary WHERE id = ?', ['v_raw'])
    )

    expect(mapped.created_at).toBe('2026-09-01 07:30:00')
    expect(mapped.last_review_at).toBe('2026-09-02 07:30:00')
  })

  it('文章：is_read / is_favorite 是数字 0/1，交回的是布尔', () => {
    articlesDb.create({
      id: 'art_1',
      title_en: 'The Compounding Effect of Reading',
      title_zh: '阅读的复利效应',
      content_en: 'Reading a little every day compounds.',
      source: '每日英语听力',
      source_url: 'https://example.com/a',
      source_website: 'example.com',
      category: 'psychology',
      difficulty: 'cet4',
      published_at: '2026-08-01',
    })

    const [mapped] = mapArticles(articlesDb.getById('art_1') ? [articlesDb.getById('art_1')] : [])

    expect(mapped.title_en).toBe('The Compounding Effect of Reading')
    expect(mapped.title_zh).toBe('阅读的复利效应')
    expect(mapped.is_read).toBe(false)
    expect(mapped.is_favorite).toBe(false)
    expect(mapped.read_time).toBe(0)
    // source_website 是迁移加的列：没迁移过的库读不出这一列，这条同时是它的对账
    expect(mapped.source_website).toBe('example.com')
    expect(mapped.difficulty).toBe('cet4')
  })

  it('会话与消息：JSON 文本列解成结构，数字 0/1 解成布尔', () => {
    const conv = conversationDb.create('关于课题分离的讨论')
    conversationDb.addMessage(String(conv.id), {
      role: 'user',
      content: '课题分离和边界感是一回事吗',
    })
    const assistantId = conversationDb.addMessage(String(conv.id), {
      role: 'assistant',
      content: '两者相近但不是一回事……',
      intent: 'knowledge_query',
      tools_used: ['retrieve', 'profile'],
      bloom_level: 4,
      mastery_assessment: { concept: '课题分离', level: 3, confidence: 0.7 },
      sources: [{ type: 'highlight', id: HL_ID }],
    })
    getDatabase().run('UPDATE chat_messages SET liked = 1 WHERE id = ?', [assistantId])

    const [session] = mapConversations(conversationDb.getAll())
    expect(session.title).toBe('关于课题分离的讨论')
    // 没关联书 → 空串（界面据此不摆「关联书籍」那一栏）
    expect(session.bookId).toBe('')
    expect(session.messageCount).toBe(2)

    const messages = mapChatMessages(conversationDb.getMessages(String(conv.id)))
    const answer = messages.find((m) => m.id === assistantId)!
    expect(answer.role).toBe('assistant')
    expect(answer.intent).toBe('knowledge_query')
    expect(answer.toolsUsed).toEqual(['retrieve', 'profile'])
    expect(answer.bloomLevel).toBe(4)
    expect(answer.masteryAssessment).toEqual({ concept: '课题分离', level: 3, confidence: 0.7 })
    expect(answer.sources).toHaveLength(1)
    expect(answer.liked).toBe(true)
    expect(answer.bookmarked).toBe(false)

    const question = messages.find((m) => m.role === 'user')!
    expect(question.toolsUsed).toEqual([])
    expect(question.masteryAssessment).toBeNull()
    expect(question.intent).toBe('')
  })

  it('会话：没关联书就是空串，标题缺列时补「新对话」', () => {
    // conversations.title 是 NOT NULL DEFAULT ''，而写入口 conversationDb.create
    // 自己写着 `title || '新对话'` —— 所以库里不会有 NULL 标题，这层的兜底只在
    // 「整行是本地构造的、还没有标题」时生效。两种情形各钉一条，别把它当成"界面永远有标题"。
    getDatabase().run(
      `INSERT INTO conversations (id, title, book_id, message_count) VALUES ('c_no_book', '一条没关联书的会话', NULL, 0)`
    )
    const [fromDb] = mapConversations(
      rawRows('SELECT * FROM conversations WHERE id = ?', ['c_no_book'])
    )
    expect(fromDb.title).toBe('一条没关联书的会话')
    expect(fromDb.bookId).toBe('')
    expect(fromDb.bookTitle).toBe('')
    expect(fromDb.messageCount).toBe(0)

    const [crafted] = mapConversations([{ id: 'c_new' }])
    expect(crafted.title).toBe('新对话')
  })
})

describe('列表包装：通道那侧给什么都兜得住', () => {
  const LISTS: Array<{ name: string; fn: (rows: unknown[]) => unknown[] }> = [
    { name: 'mapBooks', fn: mapBooks },
    { name: 'mapHighlights', fn: mapHighlights },
    { name: 'mapCards', fn: mapCards },
    { name: 'mapKnowledgeCards', fn: mapKnowledgeCards },
    { name: 'mapMethodologies', fn: mapMethodologies },
    { name: 'mapVocabularies', fn: mapVocabularies },
    { name: 'mapArticles', fn: mapArticles },
    { name: 'mapConversations', fn: mapConversations },
    { name: 'mapChatMessages', fn: mapChatMessages },
  ]

  /** 判据要喂的就是非法入参，这一处把类型放开（映射器本来就该兜住它，页面才不会整块崩） */
  function feedNonArray(fn: (rows: unknown[]) => unknown[]): (bad: unknown) => unknown[] {
    return (bad) => fn(bad as never)
  }

  it('九个包装都在：不是数组就回空数组，不抛', () => {
    // IPC 失败/超时/返回 undefined 时，页面拿到的必须是「没有数据」而不是一个崩掉的渲染树
    for (const { name, fn } of LISTS) {
      const loose = feedNonArray(fn)
      for (const bad of [undefined, null, 'not a list', 42, { 0: 'x' }]) {
        expect(loose(bad), `${name} 收到 ${String(bad)}`).toEqual([])
      }
    }
  })

  it('正向往回一条：这些包装确实逐条映射且保持顺序（负向断言得配"该发生的发生了"）', () => {
    expect(mapBooks([{ id: 'a' }, { id: 'b' }]).map((b) => b.id)).toEqual(['a', 'b'])
    expect(mapHighlights([{ id: 'h1' }, { id: 'h2' }]).map((h) => h.id)).toEqual(['h1', 'h2'])
    expect(mapCards([{ id: 'c1' }, { id: 'c2' }]).map((c) => c.id)).toEqual(['c1', 'c2'])
    expect(mapKnowledgeCards([{ id: 'k1' }]).map((k) => k.id)).toEqual(['k1'])
    expect(mapMethodologies([{ id: 'm1' }]).map((m) => m.id)).toEqual(['m1'])
    expect(mapVocabularies([{ id: 'v1' }]).map((v) => v.id)).toEqual(['v1'])
    expect(mapArticles([{ id: 'a1' }]).map((a) => a.id)).toEqual(['a1'])
    expect(mapConversations([{ id: 'c1' }]).map((c) => c.id)).toEqual(['c1'])
    expect(mapChatMessages([{ id: 'msg1' }]).map((m) => m.id)).toEqual(['msg1'])
    expect(mapBooks([])).toEqual([])
  })
})

describe('同一列的蛇形与驼峰同时出现时，以库里那一列为准', () => {
  // 页面在落库前构造的对象用驼峰，通道交回的行用下划线。两种都可能进来，
  // 但**库里的那一列才是真值**：优先级反过来就等于让本地那份旧对象盖掉刚读回来的行。
  it('书籍：reading_progress / is_finished / total_chapter 赢过驼峰别名', () => {
    const [mapped] = mapBooks([
      {
        id: 'b1',
        title: '库里这一本',
        reading_progress: 0.8,
        progress: 0.1,
        is_finished: 1,
        isFinished: 0,
        total_chapter: 20,
        totalChapter: 3,
        last_read_time: '2026-09-03T00:00:00.000Z',
        lastReadAt: '2020-01-01T00:00:00.000Z',
        created_at: '2026-09-04T00:00:00.000Z',
        createdAt: '2020-01-01T00:00:00.000Z',
      },
    ])

    expect(mapped.progress).toBe(0.8)
    expect(mapped.isFinished).toBe(1)
    expect(mapped.totalChapter).toBe(20)
    expect(mapped.lastReadAt).toBe('2026-09-03T00:00:00.000Z')
    expect(mapped.createdAt).toBe('2026-09-04T00:00:00.000Z')
  })

  it('只给驼峰时也认（页面本地构造的行）', () => {
    const [mapped] = mapBooks([{ id: 'b1', progress: 0.1, isFinished: 1, totalChapter: 3 }])
    expect(mapped.progress).toBe(0.1)
    expect(mapped.isFinished).toBe(1)
    expect(mapped.totalChapter).toBe(3)
  })

  it('划线：book_id / chapter_title 赢过驼峰别名', () => {
    const [mapped] = mapHighlights([
      {
        id: 'h1',
        book_id: '库里那一本',
        bookId: '页面那一本',
        chapter_title: '库里这一章',
        chapterTitle: '页面那一章',
        created_at: '2026-09-05T00:00:00.000Z',
        createdAt: '2020-01-01T00:00:00.000Z',
      },
    ])

    expect(mapped.bookId).toBe('库里那一本')
    expect(mapped.chapterTitle).toBe('库里这一章')
    expect(mapped.createdAt).toBe('2026-09-05T00:00:00.000Z')
  })

  it('复习卡：due / last_review / highlight_id 是库里的列名', () => {
    const [mapped] = mapCards([
      {
        id: 'c1',
        book_id: 'b9',
        bookId: 'b0',
        highlight_id: 'h9',
        highlightId: 'h0',
        due: '2026-09-06T00:00:00.000Z',
        nextReviewAt: '2020-01-01T00:00:00.000Z',
        last_review: '2026-09-07T00:00:00.000Z',
        lastReviewAt: '2020-01-01T00:00:00.000Z',
      },
    ])

    expect(mapped.bookId).toBe('b9')
    expect(mapped.highlightId).toBe('h9')
    expect(mapped.nextReviewAt).toBe('2026-09-06T00:00:00.000Z')
    expect(mapped.lastReviewAt).toBe('2026-09-07T00:00:00.000Z')
  })

  it('知识卡片与方法论：下划线列优先，数组列两种写法都解得开', () => {
    const [kc] = mapKnowledgeCards([
      {
        id: 'k1',
        book_id: 'b9',
        bookId: 'b0',
        type: 'methodology',
        title: 'T',
        content: 'C',
        related_card_ids: ['a'],
        relatedCardIds: ['zz'],
        source_highlight_id: 'h9',
        sourceHighlightId: 'h0',
        review_count: 5,
        reviewCount: 99,
        mastery_level: 40,
        masteryLevel: 1,
      },
    ])
    expect(kc.bookId).toBe('b9')
    expect(kc.relatedCardIds).toEqual(['a'])
    expect(kc.sourceHighlightId).toBe('h9')
    expect(kc.reviewCount).toBe(5)
    expect(kc.masteryLevel).toBe(40)

    const [mt] = mapMethodologies([
      {
        id: 'm1',
        name: 'N',
        name_en: '库里那个英文名',
        nameEn: '页面那个',
        trigger_scenario: '库里这个触发场景',
        triggerScenario: '页面这个',
        output_format: '库里这个产出',
        outputFormat: '页面那个',
        source_highlight_ids: ['h1', 'h2'],
        sourceHighlightIds: ['zz'],
        practice_count: 7,
        practiceCount: 1,
      },
    ])
    expect(mt.nameEn).toBe('库里那个英文名')
    expect(mt.triggerScenario).toBe('库里这个触发场景')
    expect(mt.outputFormat).toBe('库里这个产出')
    expect(mt.sourceHighlightIds).toEqual(['h1', 'h2'])
    expect(mt.practiceCount).toBe(7)
  })

  it('已经解好的数组也接得住（通道若改成直接交回结构，这层不该要求必须是文本）', () => {
    const [kc] = mapKnowledgeCards([{ id: 'k1', tags: ['已是数组'], type: 'concept' }])
    expect(kc.tags).toEqual(['已是数组'])
    const [mt] = mapMethodologies([{ id: 'm1', name: 'N', steps: ['一步'] }])
    expect(mt.steps).toEqual(['一步'])
  })
})

describe('映射器交回的默认值：NULL、空串、0 是三件事', () => {
  it('safeNum：空串走兜底（Number("") 是 0，不查就会把"没填"读成 0）', () => {
    expect(safeNum('')).toBe(0)
    expect(safeNum('', 2.5)).toBe(2.5)
    expect(safeNum(null, 2.5)).toBe(2.5)
    expect(safeNum(undefined, 2.5)).toBe(2.5)
    expect(safeNum('abc', 7)).toBe(7)
    expect(safeNum(NaN, 7)).toBe(7)
    // 0 是个真值，不能被当成"没填"
    expect(safeNum(0, 2.5)).toBe(0)
    expect(safeNum('12')).toBe(12)
    expect(safeNum('2.5')).toBe(2.5)
  })

  it('safeStr：只有 null/undefined 走兜底，数字 0 要交出 "0"', () => {
    expect(safeStr(null)).toBe('')
    expect(safeStr(undefined, 'x')).toBe('x')
    expect(safeStr(0)).toBe('0')
    expect(safeStr('')).toBe('')
    // 库里没这一列时才用兜底文案（界面读到一个真值 0 时不许摆「未知书名」）
    expect(mapBooks([{ id: 'b', title: 0 }])[0].title).toBe('0')
    expect(mapBooks([{ id: 'b' }])[0].title).toBe('未知书名')
    expect(mapCards([{ id: 'c' }])[0].bookId).toBe('')
  })

  it('safeBool：库里是 INTEGER 0/1，只有 1 才算真', () => {
    for (const truthy of [1, true, '1']) expect(safeBool(truthy)).toBe(true)
    for (const falsy of [0, false, null, undefined, '', 'abc', 2]) {
      expect(safeBool(falsy), String(falsy)).toBe(false)
    }
  })

  it('缺列的兜底文案摆出来的是"没这个字段"，不是空标题', () => {
    expect(mapKnowledgeCards([{ id: 'k', type: 'concept' }])[0].title).toBe('无标题')
    expect(mapMethodologies([{ id: 'm' }])[0].name).toBe('未命名方法论')
    expect(mapArticles([{ id: 'a' }])[0].title_en).toBe('无标题')
    expect(mapConversations([{ id: 'c' }])[0].title).toBe('新对话')
    expect(mapHighlights([{ id: 'h' }])[0].chapterTitle).toBe('未知章节')
  })

  it('未声明的下划线列原样透传（页面在读 JOIN 出来的那一列）', () => {
    const [book] = mapBooks([{ id: 'b1', title: 'T', highlight_count: 12 }])
    expect(book['highlight_count']).toBe(12)
    const [hl] = mapHighlights([{ id: 'h1', content: 'C', book_title: 'JOIN 来的书名' }])
    expect(hl['book_title']).toBe('JOIN 来的书名')
  })
})

describe('时间：库里两种形状，交回的时刻必须是同一个', () => {
  it('不带时区标记的「YYYY-MM-DD HH:MM:SS」按 UTC 解（库里就是这么写的）', () => {
    expect(safeDate('2026-09-28 03:15:00')).toBe('2026-09-28T03:15:00.000Z')
    // 秒可省
    expect(safeDate('2026-09-28 03:15')).toBe('2026-09-28T03:15:00.000Z')
  })

  it('带 Z 的 ISO 原样保住时刻', () => {
    expect(safeDate('2026-09-28T03:15:00.000Z')).toBe('2026-09-28T03:15:00.000Z')
  })

  it('往返一致：写入用的那一串与读回来的是同一刻', () => {
    // 划线导入把真实划线时刻归一成 'YYYY-MM-DD HH:MM:SS' 再落库（形状与库里其它行一致，
    // 因为 'T' > ' '，混着写会让同一天里导入的那批整体排到手填那条之前）。
    // 读回来必须还原成同一个瞬间，否则笔记页的排序与统计页的按天归集都建在错的一列上。
    const iso = '2026-09-01T15:00:00.000Z'
    const stored = iso.slice(0, 19).replace('T', ' ')
    expect(safeDate(stored)).toBe(iso)
  })

  it('没有值与解不出来都回空串，不猜 1970、不返回 undefined', () => {
    for (const empty of [null, undefined, '', 0]) expect(safeDate(empty)).toBe('')
    expect(safeDate('不是日期')).toBe('')
    expect(safeDate('2026-13-45 99:99:99')).toBe('')
    // 不是字符串也不是数字就没有"时刻"可言：对象/布尔不许被 Date 掰出一个能解析的值
    for (const odd of [{}, [], true, Symbol('nope')]) expect(safeDate(odd), String(odd)).toBe('')
  })

  it('只有「日期 空格 时间」这一种形状被补上 UTC 偏移', () => {
    // 库里写出来的就这一种；纯日期串 JS 本来就按 UTC 解，不需要再过一遍
    expect(safeDate('2026-09-28')).toBe('2026-09-28T00:00:00.000Z')
    // 带偏移的串照它自己声明的时区走，不许被再挪一次
    expect(safeDate('2026-09-28T03:15:00+08:00')).toBe('2026-09-27T19:15:00.000Z')
  })

  it('数字（epoch 毫秒）也接得住', () => {
    const ms = Date.UTC(2026, 8, 28, 3, 15, 0)
    expect(safeDate(ms)).toBe('2026-09-28T03:15:00.000Z')
  })

  it('formatDate：解不出来时说「未知时间」，界面不许出现 Invalid Date', () => {
    expect(formatDate(null)).toBe('未知时间')
    expect(formatDate('')).toBe('未知时间')
    expect(formatDate(0)).toBe('未知时间')
    expect(formatDate('garbage')).toBe('未知时间')

    const label = formatDate(new Date(2026, 8, 1, 20, 45).toISOString())
    expect(label).not.toContain('Invalid')
    expect(label).toContain('2026')
    expect(label).toMatch(/\d{2}\/\d{2}/)
    expect(label).toMatch(/\d{2}:\d{2}/)
  })

  it('formatDateShort：没有值说「-」，有值只给月日', () => {
    expect(formatDateShort(null)).toBe('-')
    expect(formatDateShort(undefined)).toBe('-')
    expect(formatDateShort(0)).toBe('-')
    expect(formatDateShort('garbage')).toBe('-')

    const label = formatDateShort(new Date(2026, 8, 1, 20, 45).toISOString())
    expect(label).toMatch(/^\d{2}\/\d{2}$/)
  })

  describe('formatTimeAgo 的档位边界', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-09-28T12:00:00.000Z'))
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    const ago = (ms: number): string => new Date(Date.now() - ms).toISOString()

    it('不到一分钟说「刚刚」，正好一分钟就进「分钟前」', () => {
      expect(formatTimeAgo(ago(30 * 1000))).toBe('刚刚')
      expect(formatTimeAgo(ago(60 * 1000))).toBe('1分钟前')
      expect(formatTimeAgo(ago(59 * 60 * 1000))).toBe('59分钟前')
    })

    it('一小时进「小时前」，23 小时还在小时档，整 24 小时换成日期', () => {
      expect(formatTimeAgo(ago(60 * 60 * 1000))).toBe('1小时前')
      expect(formatTimeAgo(ago(23 * 60 * 60 * 1000))).toBe('23小时前')
      const label = formatTimeAgo(ago(24 * 60 * 60 * 1000))
      expect(label).not.toContain('小时前')
      expect(label).toMatch(/\d{2}\/\d{2}/)
    })

    it('没有值与解不出来都回「-」', () => {
      expect(formatTimeAgo(null)).toBe('-')
      expect(formatTimeAgo('')).toBe('-')
      expect(formatTimeAgo('garbage')).toBe('-')
    })

    it('库里那一串不许被读早 8 小时（这条是本批修的那条真缺陷）', () => {
      // 假时钟停在 12:00:00Z；库里那行写的是 UTC 的 11:59:30，就是 30 秒前
      expect(formatTimeAgo('2026-09-28 11:59:30')).toBe('刚刚')
      // 一小时前的那一行说「1小时前」，而不是本地时区读法给出的「9小时前」
      expect(formatTimeAgo('2026-09-28 11:00:00')).toBe('1小时前')
    })
  })
})

describe('时间口径只有一份：映射器与主进程共用的那把尺', () => {
  it('parseDbTime 交出的是同一个瞬间，解不出来是 null', () => {
    expect(parseDbTime('2026-09-28 03:15:00')?.toISOString()).toBe('2026-09-28T03:15:00.000Z')
    expect(parseDbTime('2026-09-28 03:15')?.toISOString()).toBe('2026-09-28T03:15:00.000Z')
    expect(parseDbTime('2026-09-28T03:15:00.000Z')?.toISOString()).toBe('2026-09-28T03:15:00.000Z')
    expect(parseDbTime(0)).toBeNull()
    expect(parseDbTime('不是日期')).toBeNull()
    expect(parseDbTime({})).toBeNull()
  })

  it('映射器用的就是这一把尺（出现第二份解析口径就会在这里分叉）', () => {
    for (const sample of ['2026-09-28 03:15:00', '2026-09-28T03:15:00.000Z', '', 'garbage', 0]) {
      expect(safeDate(sample), String(sample)).toBe(dbTimeIso(sample))
    }
  })
})

describe('JSON 文本列：解不出来就当没有，不炸、不猜', () => {
  it('safeJsonArray：数组原样、文本解数组、非数组与坏值回空', () => {
    expect(safeJsonArray(['a'])).toEqual(['a'])
    expect(safeJsonArray('[1,2]')).toEqual([1, 2])
    expect(safeJsonArray('[]')).toEqual([])
    for (const bad of ['{"a":1}', '不是 JSON', '', null, undefined, 5, true]) {
      expect(safeJsonArray(bad), String(bad)).toEqual([])
    }
  })

  it('safeStrArray：逐项转字符串（库里存的是数字 id 时也要能用）', () => {
    expect(safeStrArray('[1,2]')).toEqual(['1', '2'])
    expect(safeStrArray(null)).toEqual([])
    expect(safeStrArray(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('safeJsonObject：只认对象，数组与「null」文本都算没有', () => {
    expect(safeJsonObject<{ a: number }>('{"a":1}')).toEqual({ a: 1 })
    expect(safeJsonObject('[1,2]')).toBeNull()
    expect(safeJsonObject('null')).toBeNull()
    expect(safeJsonObject('garbage')).toBeNull()
    expect(safeJsonObject('')).toBeNull()
    expect(safeJsonObject(null)).toBeNull()
    // 已经解好的对象不再解一遍：这层的入参就是库里的文本列
    expect(safeJsonObject({ a: 1 })).toBeNull()
  })
})
