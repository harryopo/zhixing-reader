// 知行读书 — 微信读书章节名解析（src/shared/weread-content.ts）单元测试
//
// 背景：实测用户数据库里 934 条划线 chapter_title 有值 0 条 ——
// 章节表被 fetchAllContent 取回来了，但三个导入入口全都丢掉不用。
// 这里把解析规则钉死，避免再出现"三处各写一遍且三处都错"。

import { describe, it, expect } from 'vitest'
import {
  buildChapterTitleMap,
  resolveChapterTitle,
  withResolvedChapterTitles,
  resolveWereadContent,
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
