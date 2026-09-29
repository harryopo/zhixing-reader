// 知行读书 — 微信读书章节名解析（src/shared/weread-content.ts）单元测试
//
// 背景：实测用户数据库里 934 条划线 chapter_title 有值 0 条 ——
// 章节表被 fetchAllContent 取回来了，但三个导入入口全都丢掉不用。
// 这里把解析规则钉死，避免再出现"三处各写一遍且三处都错"。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  buildChapterTitleMap,
  resolveChapterTitle,
  withResolvedChapterTitles,
  resolveWereadContent,
  wereadTimeIso,
  planHighlightRows,
  buildContentTimeMap,
  planHighlightTimeRepairs,
} from '../src/shared/weread-content'

describe('buildChapterTitleMap', () => {
  it('建立 chapterUid → 标题 的映射', () => {
    const map = buildChapterTitleMap([
      { chapterUid: 3, title: '第三章 承诺与一致' },
      { chapterUid: 7, title: '第七章 稀缺性' },
    ])
    expect(map.size).toBe(2)
    expect(map.get(3)).toBe('第三章 承诺与一致')
    expect(map.get(7)).toBe('第七章 稀缺性')
  })

  it('跳过标题为空 / 只有空格的条目（不写入无意义的键）', () => {
    const map = buildChapterTitleMap([
      { chapterUid: 1, title: '' },
      { chapterUid: 2, title: '   ' },
      { chapterUid: 3, title: '有效标题' },
    ])
    expect(map.size).toBe(1)
    expect(map.has(3)).toBe(true)
  })

  it('标题两端空白被去掉', () => {
    expect(buildChapterTitleMap([{ chapterUid: 1, title: '  第一章  ' }]).get(1)).toBe('第一章')
  })

  it('chapterUid 非法时跳过', () => {
    const map = buildChapterTitleMap([
      { chapterUid: Number.NaN, title: '坏数据' },
      { chapterUid: 5, title: '好数据' },
    ])
    expect(map.size).toBe(1)
  })

  it('空输入 / null / undefined 都返回空 Map，不抛错', () => {
    expect(buildChapterTitleMap([]).size).toBe(0)
    expect(buildChapterTitleMap(null).size).toBe(0)
    expect(buildChapterTitleMap(undefined).size).toBe(0)
  })

  it('同一 chapterUid 重复出现时后写的生效', () => {
    const map = buildChapterTitleMap([
      { chapterUid: 1, title: '旧名' },
      { chapterUid: 1, title: '新名' },
    ])
    expect(map.get(1)).toBe('新名')
  })
})

describe('resolveChapterTitle', () => {
  const map = buildChapterTitleMap([{ chapterUid: 42, title: '第四章 社会认同' }])

  it('优先用条目自带的 chapterTitle', () => {
    expect(resolveChapterTitle({ chapterUid: 42, chapterTitle: '自带的章节名' }, map)).toBe('自带的章节名')
  })

  it('自带为空时用 chapterUid 查表 —— 这是本次修复的核心', () => {
    expect(resolveChapterTitle({ chapterUid: 42, chapterTitle: '' }, map)).toBe('第四章 社会认同')
    expect(resolveChapterTitle({ chapterUid: 42 }, map)).toBe('第四章 社会认同')
    expect(resolveChapterTitle({ chapterUid: 42, chapterTitle: '   ' }, map)).toBe('第四章 社会认同')
  })

  it('查不到时返回空字符串，**不编造**「未知章节」这类假值', () => {
    expect(resolveChapterTitle({ chapterUid: 999 }, map)).toBe('')
    expect(resolveChapterTitle({}, map)).toBe('')
    expect(resolveChapterTitle(null, map)).toBe('')
    expect(resolveChapterTitle(undefined, map)).toBe('')
  })

  it('章节表缺失时不抛错', () => {
    expect(resolveChapterTitle({ chapterUid: 42 }, null)).toBe('')
    expect(resolveChapterTitle({ chapterUid: 42, chapterTitle: '有就用' }, null)).toBe('有就用')
  })

  it('chapterUid 是字符串数字时也能匹配', () => {
    expect(resolveChapterTitle({ chapterUid: '42' as unknown as number }, map)).toBe('第四章 社会认同')
  })
})

describe('withResolvedChapterTitles', () => {
  const map = buildChapterTitleMap([
    { chapterUid: 1, title: '第一章' },
    { chapterUid: 2, title: '第二章' },
  ])

  it('批量为每条补上 resolvedChapterTitle', () => {
    const out = withResolvedChapterTitles(
      [{ chapterUid: 1, markText: 'a' }, { chapterUid: 2, markText: 'b' }],
      map,
    )
    expect(out.map((x) => x.resolvedChapterTitle)).toEqual(['第一章', '第二章'])
  })

  it('不修改原对象（纯函数）', () => {
    const input = [{ chapterUid: 1, markText: 'a' }]
    withResolvedChapterTitles(input, map)
    expect(Object.keys(input[0])).toEqual(['chapterUid', 'markText'])
  })

  it('保留原有字段', () => {
    const out = withResolvedChapterTitles([{ chapterUid: 1, markText: '正文', style: 2 }], map)
    expect(out[0].markText).toBe('正文')
    expect(out[0].style).toBe(2)
  })

  it('空输入返回空数组', () => {
    expect(withResolvedChapterTitles(null, map)).toEqual([])
    expect(withResolvedChapterTitles([], map)).toEqual([])
  })
})

describe('resolveWereadContent — 一次搞定 fetchAllContent 的返回值', () => {
  it('同时补齐 bookmarks 与 notes', () => {
    const { bookmarks, notes, chapterTitleMap } = resolveWereadContent({
      bookmarks: [{ chapterUid: 10, markText: '划线内容' }],
      notes: [{ chapterUid: 20, abstract: '笔记摘要', chapterTitle: '自带名' }],
      chapters: [
        { chapterUid: 10, title: '第十章' },
        { chapterUid: 20, title: '第二十章' },
      ],
    })
    expect(bookmarks[0].resolvedChapterTitle).toBe('第十章')
    expect(notes[0].resolvedChapterTitle).toBe('自带名')
    expect(chapterTitleMap.size).toBe(2)
  })

  it('章节表为空时全部退化为空字符串（不抛错、不编造）', () => {
    const { bookmarks } = resolveWereadContent({
      bookmarks: [{ chapterUid: 10, markText: 'x' }],
      notes: [],
      chapters: [],
    })
    expect(bookmarks[0].resolvedChapterTitle).toBe('')
  })

  it('整个入参为 null 时安全返回空结果', () => {
    const r = resolveWereadContent(null)
    expect(r.bookmarks).toEqual([])
    expect(r.notes).toEqual([])
    expect(r.chapterTitleMap.size).toBe(0)
  })

  it('真实场景形状：bookmarks 无 chapterTitle、chapters 有标题', () => {
    // 这正是用户数据库里 934 条划线的处境
    const { bookmarks } = resolveWereadContent({
      bookmarks: [
        { bookmarkId: 'b1', chapterUid: 5, chapterTitle: '', markText: '青年们都想认真地生活' },
        { bookmarkId: 'b2', chapterUid: 5, chapterTitle: '', markText: '如果不懂得如何构筑良好的人际关系' },
      ],
      notes: [],
      chapters: [{ chapterUid: 5, title: '第一章 人际关系' }],
    })
    expect(bookmarks.every((b) => b.resolvedChapterTitle === '第一章 人际关系')).toBe(true)
  })
})

describe('wereadTimeIso（微信读书的秒级时间戳 → ISO）', () => {
  it('正常秒数换算成对应的时刻', () => {
    expect(wereadTimeIso(1_700_000_000)).toBe(new Date(1_700_000_000 * 1000).toISOString())
  })

  it('接口给成字符串也认（这个接口的数字字段经常是字符串）', () => {
    expect(wereadTimeIso('1700000000')).toBe(wereadTimeIso(1700000000))
  })

  it('缺失、0、负数、非数字一律 null —— 不许写成 1970', () => {
    for (const bad of [undefined, null, 0, '', -5, Number.NaN, 'abc', {}]) {
      expect(wereadTimeIso(bad)).toBeNull()
    }
  })

  it('0 换算出来确实是 1970-01-01（所以这一条不是"我想当然"）', () => {
    expect(new Date(0).toISOString().startsWith('1970-01-01')).toBe(true)
    expect(wereadTimeIso(0)).toBeNull()
  })
})

describe('planHighlightRows（三条导入通路共用的一份行规划）', () => {
  const raw = {
    bookmarks: [
      { bookmarkId: 'b1', chapterUid: 5, chapterTitle: '', markText: '青年们都想认真地生活', createTime: 1_700_000_000 },
      { bookmarkId: 'b2', chapterUid: 9, chapterTitle: '自带标题', markText: '第二句', createTime: 1_700_000_060 },
    ],
    notes: [
      { reviewId: 'n1', chapterUid: 5, chapterTitle: '', abstract: '被划的那一句', content: '我的想法', createTime: 1_700_000_120 },
    ],
    chapters: [{ chapterUid: 5, title: '第一章 人际关系' }],
  }

  it('划线：正文取 markText、章节名查对照表、时间取真实划线时刻', () => {
    const rows = planHighlightRows(raw)
    expect(rows[0]).toEqual({
      content: '青年们都想认真地生活',
      chapter_title: '第一章 人际关系',
      created_at: new Date(1_700_000_000 * 1000).toISOString(),
    })
  })

  it('条目自带章节名时优先用它，不去查表', () => {
    expect(planHighlightRows(raw)[1].chapter_title).toBe('自带标题')
  })

  it('想法这一条分两个字段：正文=被划的摘句，note=用户自己写的想法', () => {
    const row = planHighlightRows(raw)[2]
    expect(row.content).toBe('被划的那一句')
    expect(row.note).toBe('我的想法')
    expect(row.chapter_title).toBe('第一章 人际关系')
  })

  it('想法没有正文（只在页边写了一句）时不塞空串键', () => {
    const rows = planHighlightRows({
      bookmarks: [],
      notes: [{ reviewId: 'n2', chapterUid: 5, abstract: '摘句', content: '', createTime: 1_700_000_000 }],
      chapters: raw.chapters,
    })
    expect('note' in rows[0]).toBe(false)
  })

  // ↓ 真机导入时量出来的：网关会回一些"摘句与想法都为空"的条目（划线里的空标记、
  // 被删过内容的想法），而规划层照单建行 ⇒ 库里多出"正文为空且无想法"的空白划线，
  // 笔记页摆出来就是一行空白。开发库里原有 7 条就是这个形状留下的。
  it('书签正文为空 ⇒ 不建这一行（建进去就是笔记页的一行空白）', () => {
    const rows = planHighlightRows({
      bookmarks: [
        { bookmarkId: 'e1', chapterUid: 5, chapterTitle: '', markText: '   ', createTime: 1_700_000_000 },
        { bookmarkId: 'e2', chapterUid: 5, chapterTitle: '', markText: '', createTime: 1_700_000_000 },
        { bookmarkId: 'ok', chapterUid: 5, chapterTitle: '', markText: '有内容的一句', createTime: 1_700_000_000 },
      ],
      notes: [],
      chapters: raw.chapters,
    })
    expect(rows.map((r) => r.content)).toEqual(['有内容的一句'])
  })

  it('想法的摘句与正文都为空 ⇒ 这一条没有任何可导内容，一行都不产', () => {
    // 夹具要能区分"闸在"与"闸不在"：如果把两条想法放一起（一条全空、一条是书评），
    // 全空那条会先建成一行 content=''，书评那条按 content 命中它并 merge 进去 ⇒
    // 无论这道闸在不在，行数都是 1，判据空转。所以这里只喂那一条全空的。
    const rows = planHighlightRows({
      bookmarks: [],
      notes: [{ reviewId: 'both-blank', chapterUid: 5, abstract: '  ', content: '', createTime: 1_700_000_000 }],
      chapters: raw.chapters,
    })
    expect(rows).toEqual([])
  })

  it('整本书评（不挂具体摘句）⇒ 产一行：正文空、note 是书评本身', () => {
    // 实测网关就是这么回的（type=4 那几条），它是用户自己写的字，值得留进库里；
    // 它和"空白划线"的区别是 note 非空，所以上一条那条闸不许把它一起挡掉。
    const rows = planHighlightRows({
      bookmarks: [],
      notes: [{ reviewId: 'review', chapterUid: 0, abstract: '', content: '始于觉知，成于反思，终于改变。', createTime: 1_700_000_000 }],
      chapters: raw.chapters,
    })
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toBe('')
    expect(rows[0].note).toBe('始于觉知，成于反思，终于改变。')
  })

  // ↓ 这两条是 2026-09-29 为「个人画像的前置数据源」补的。上面的夹具把想法的
  // abstract 故意写成与书签不同的一句，于是"同一句既划过、又写了想法"这个
  // 真会丢数据的形状从没被走到：两条行 content 相同 ⇒ 第二条撞 (book_id, content)
  // 判重 ⇒ create 返回 false ⇒ 用户写的想法整条不进库。收在规划这一层合掉。
  it('同一句既被划过又写了想法 ⇒ 合成一行（正文 + note），不产出两条互相顶掉的行', () => {
    const rows = planHighlightRows({
      bookmarks: [
        { bookmarkId: 'm1', chapterUid: 5, chapterTitle: '', markText: '人的烦恼皆源于人际关系', createTime: 1_700_000_000 },
      ],
      notes: [
        { reviewId: 'm1n', chapterUid: 5, chapterTitle: '', abstract: '人的烦恼皆源于人际关系', content: '这句我要用在明天的沟通里', createTime: 1_700_009_000 },
      ],
      chapters: raw.chapters,
    })

    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual({
      content: '人的烦恼皆源于人际关系',
      note: '这句我要用在明天的沟通里',
      // 章节名两边都能解析出来，取到的必须是同一个
      chapter_title: '第一章 人际关系',
      // 时刻取划线那一刻，不取想法那一刻 —— 库里这一列回答的是"我什么时候划的"
      created_at: new Date(1_700_000_000 * 1000).toISOString(),
    })
  })

  it('想法正文只有空格 ⇒ 按"没写想法"处理，不产出 note 键', () => {
    const rows = planHighlightRows({
      bookmarks: [],
      notes: [{ reviewId: 'blank', chapterUid: 5, abstract: '摘句', content: '   \n\t ', createTime: 1_700_000_000 }],
      chapters: raw.chapters,
    })

    expect('note' in rows[0]).toBe(false)
  })

  it('查不到章节名就留空串，不编「未知章节」', () => {
    const rows = planHighlightRows({
      bookmarks: [{ bookmarkId: 'b3', chapterUid: 404, chapterTitle: '', markText: '无章可查', createTime: 1_700_000_000 }],
      notes: [],
      chapters: [],
    })
    expect(rows[0].chapter_title).toBe('')
  })

  it('没有 createTime 时 created_at 是 null，不是 1970、也不是导入那一刻', () => {
    const rows = planHighlightRows({
      bookmarks: [{ bookmarkId: 'b4', chapterUid: 5, markText: '没时间戳' }],
      notes: [],
      chapters: raw.chapters,
    })
    expect(rows[0].created_at).toBeNull()
  })

  it('顺序固定：先全部划线，再全部想法', () => {
    expect(planHighlightRows(raw).map((r) => r.content)).toEqual([
      '青年们都想认真地生活',
      '第二句',
      '被划的那一句',
    ])
  })

  it('入参为空（接口一个条目都没回）时返回空数组', () => {
    expect(planHighlightRows(null)).toEqual([])
    expect(planHighlightRows(undefined)).toEqual([])
    expect(planHighlightRows({})).toEqual([])
  })
})

describe('buildContentTimeMap + planHighlightTimeRepairs（历史时间回填的判定）', () => {
  const content = {
    bookmarks: [
      { bookmarkId: 'w1', markText: '第一句', createTime: 1_700_000_000 },
      { bookmarkId: 'w2', markText: '第二句', createTime: 1_700_003_600 },
    ],
    notes: [{ reviewId: 'r1', abstract: '摘句', content: '想法', createTime: 1_700_007_200 }],
  }

  it('按划线原文对上时刻，想法那条用摘句对（入库时正文就是摘句）', () => {
    const map = buildContentTimeMap(content)
    expect(map.times.get('第一句')).toBe(wereadTimeIso(1_700_000_000))
    expect(map.times.get('摘句')).toBe(wereadTimeIso(1_700_007_200))
    expect(map.ambiguous.size).toBe(0)
  })

  it('同一句被划两次且时刻不同 ⇒ 整条作废，不挑一个时间', () => {
    const map = buildContentTimeMap({
      bookmarks: [
        { markText: '重句', createTime: 1_700_000_000 },
        { markText: '重句', createTime: 1_700_009_999 },
      ],
      notes: [],
    })
    expect(map.times.has('重句')).toBe(false)
    expect([...map.ambiguous]).toEqual(['重句'])
  })

  it('同一句两次时刻相同 ⇒ 不算歧义，可以回填', () => {
    const map = buildContentTimeMap({
      bookmarks: [
        { markText: '重句', createTime: 1_700_000_000 },
        { markText: '重句', createTime: 1_700_000_000 },
      ],
      notes: [],
    })
    expect(map.ambiguous.size).toBe(0)
    expect(map.times.get('重句')).toBe(wereadTimeIso(1_700_000_000))
  })

  it('库里那一行的时间与目标不同 ⇒ 进更新清单', () => {
    const { updates, ambiguous, unmatched } = planHighlightTimeRepairs(
      [{ id: 'h1', content: '第一句', created_at: '2026-09-02 12:28:58' }],
      buildContentTimeMap(content),
    )
    expect(updates).toEqual([{ id: 'h1', createdAt: wereadTimeIso(1_700_000_000) }])
    expect({ ambiguous, unmatched }).toEqual({ ambiguous: 0, unmatched: 0 })
  })

  it('已经是对的了 ⇒ 零写入（同一天不同形状也认：库内存的是空格形状，对照表是 ISO）', () => {
    const map = buildContentTimeMap(content)
    const asIso = wereadTimeIso(1_700_000_000) as string
    expect(planHighlightTimeRepairs([{ id: 'h1', content: '第一句', created_at: asIso }], map).updates).toEqual([])
    expect(
      planHighlightTimeRepairs(
        [{ id: 'h1', content: '第一句', created_at: asIso.slice(0, 19).replace('T', ' ') }],
        map,
      ).updates,
    ).toEqual([])
  })

  it('对不上微信读书的行只计数不猜时间', () => {
    const r = planHighlightTimeRepairs(
      [
        { id: 'a', content: '库里独有的一句', created_at: '2026-09-02 12:28:58' },
        { id: 'b', content: '   ', created_at: '2026-09-02 12:28:58' },
        { id: 'c', content: '', created_at: '2026-09-02 12:28:58' },
      ],
      buildContentTimeMap(content),
    )
    expect(r.updates).toEqual([])
    expect(r.unmatched).toBe(3)
  })

  it('歧义的行单独计入 ambiguous，不与"对不上"混为一谈', () => {
    const map = buildContentTimeMap({
      bookmarks: [
        { markText: '重句', createTime: 1_700_000_000 },
        { markText: '重句', createTime: 1_700_009_999 },
      ],
      notes: [],
    })
    const r = planHighlightTimeRepairs([{ id: 'h', content: '重句', created_at: '2026-09-02 12:28:58' }], map)
    expect({ updates: r.updates, ambiguous: r.ambiguous, unmatched: r.unmatched }).toEqual({
      updates: [],
      ambiguous: 1,
      unmatched: 0,
    })
  })

  it('入参缺失（空库 / 接口一条没回）时安全返回', () => {
    expect(planHighlightTimeRepairs(null, buildContentTimeMap(null))).toEqual({
      updates: [],
      ambiguous: 0,
      unmatched: 0,
    })
    expect(buildContentTimeMap(undefined).times.size).toBe(0)
  })
})

describe('导入字段清单只有一份（三处手写循环不许回来）', () => {
  // 这三个文件是"从微信读书搬划线进库"的三个入口。09-16 只把章节名收成一份，
  // 字段清单仍各写一遍 ⇒ 同一批缺陷各犯一次（漏 id、绕开对照表、created_at 被丢）。
  const importSites = [
    'electron/ipc/knowledge.ts',
    'electron/services/knowledge-card-service.ts',
    'src/renderer/src/utils/import-weread-content.ts',
  ]

  const BANNED = ['chapter_uid:', "type: 'highlight'", 'bm.chapterTitle', 'note.abstract']

  for (const site of importSites) {
    it(`${site} 必须吃 planHighlightRows，且不再自己拼字段`, () => {
      const text = readFileSync(site, 'utf8')
      expect(text).toContain('planHighlightRows')
      for (const token of BANNED) {
        expect(text, `${site} 里不该再出现 ${token}`).not.toContain(token)
      }
    })
  }

  it('反证：这几段是收口前的原文，必须被同一条规则判红', () => {
    const before = [
      'highlightsDb.create({ book_id: bookId, content: bm.markText, chapter_uid: bm.chapterUid, type: \'highlight\' })',
      'const row = { content: note.abstract, chapter_title: bm.chapterTitle }',
    ]
    const hit = before.filter((t) => BANNED.some((token) => t.includes(token)))
    expect(hit).toHaveLength(before.length)
  })
})
