// tests/retrieval.test.ts
//
// 本地词法检索（轻量 RAG）的单测。
//
// 背景：向量语义检索在本机从来没通过（服务商没有 /embeddings 接口），
// 而兜底的关键词检索中文切词是坏的（整句当一个词），导致中文提问检索到 0 条划线。
// 这个模块是唯一剩下的检索路径，所以它的行为必须被钉住。

import { describe, it, expect } from 'vitest'
import { tokenize, buildIndex, searchIndex, type RetrievalDoc } from '../src/shared/retrieval'

/** 造一条划线 */
function doc(id: string, bookId: string, content: string, extra: Partial<RetrievalDoc> = {}): RetrievalDoc {
  return { id, bookId, bookTitle: '书 ' + bookId, content, ...extra }
}

describe('tokenize - 中文按 2 字滑窗，英文按词', () => {
  it('中文长句切成 bigram', () => {
    expect(tokenize('人际关系')).toEqual(['人际', '际关', '关系'])
  })
  it('两字中文保持原样', () => {
    expect(tokenize('习惯')).toEqual(['习惯'])
  })
  it('英文按词并小写，单字母丢弃', () => {
    expect(tokenize('Habits a Identity')).toEqual(['habits', 'identity'])
  })
  it('中英混排各自处理', () => {
    const t = tokenize('habit 习惯养成')
    expect(t).toContain('habit')
    expect(t).toContain('惯养')
  })
  it('标点与空白被剔除，不产生空词', () => {
    expect(tokenize('  ，。？ ')).toEqual([])
    expect(tokenize('a，b。c').every((x) => x.length > 0)).toBe(true)
  })
})

describe('buildIndex', () => {
  it('空语料不崩，返回空索引且检索为空', () => {
    const idx = buildIndex([])
    expect(idx.docCount).toBe(0)
    expect(idx.avgDocLength).toBe(0)
    expect(searchIndex(idx, '任意问题')).toEqual([])
  })
  it('记录词频与文档频率', () => {
    const idx = buildIndex([
      doc('h1', 'b1', '人际关系'),
      doc('h2', 'b1', '人际关系很重要'),
    ])
    expect(idx.docCount).toBe(2)
    expect(idx.docFreq.get('关系')).toBe(2)
    expect(idx.postings.get('关系')?.length).toBe(2)
  })
  it('章节名参与索引（权重高于正文）', () => {
    const idx = buildIndex([doc('h1', 'b1', '无关正文', { chapterTitle: '人际关系' })])
    expect(idx.postings.has('人际')).toBe(true)
  })
})

describe('searchIndex - BM25 排序与过滤', () => {
  const docs = [
    doc('h1', 'b1', '一切烦恼都来自人际关系'),
    doc('h2', 'b1', '所谓自由就是被别人讨厌'),
    doc('h3', 'b2', '习惯的养成需要环境设计'),
  ]
  const idx = buildIndex(docs)

  it('中文提问命中中文划线', () => {
    const hits = searchIndex(idx, '人际关系为什么会让人烦恼')
    expect(hits[0].highlightId).toBe('h1')
  })
  it('遵守 limit', () => {
    expect(searchIndex(idx, '人际关系 自由 讨厌', { limit: 1 })).toHaveLength(1)
  })
  it('bookId 过滤不会串到别的书', () => {
    expect(searchIndex(idx, '习惯养成', { bookId: 'b1' })).toEqual([])
  })
  it('不传 bookId 时跨书检索', () => {
    expect(searchIndex(idx, '习惯养成')[0].highlightId).toBe('h3')
  })
  it('完全无关的问题返回空数组，不硬凑', () => {
    expect(searchIndex(idx, '量子纠缠的数学基础')).toEqual([])
  })
  it('只命中大众词的文档会被相对阈值刷掉', () => {
    // 三条里都有同一个 bigram，df 比例过高 -> 不构成相关性
    const many = buildIndex([
      doc('a', 'b', '什么都可以'),
      doc('b', 'b', '什么都不是'),
      doc('c', 'b', '什么也没有'),
    ])
    expect(searchIndex(many, '什么')).toEqual([])
  })
  it('返回字段可直接喂给 RagSourceRef', () => {
    const hit = searchIndex(idx, '人际关系')[0]
    expect(hit).toMatchObject({ highlightId: 'h1', bookId: 'b1', bookTitle: '书 b1' })
    expect(hit.relevanceScore).toBeGreaterThan(0)
  })

  it('小语料（1-2 篇）里的唯一信号不会被噪声过滤误杀', () => {
    // 只有一张知识卡片时，「人人都有的词」这个判定没有样本量可言 ——
    // 按比例过滤会让它永远检索不到（实测命中数恒为 0）。
    // 知识卡片 / 方法论构建器复用本模块打分，靠的就是这条。
    const one = buildIndex([doc('c1', 'b1', '课题分离：把别人的课题还给别人')])
    expect(searchIndex(one, '课题分离是什么意思')[0]?.highlightId).toBe('c1')

    const two = buildIndex([
      doc('c1', 'b1', '课题分离：把别人的课题还给别人'),
      doc('c2', 'b2', '舒适区边缘：在拉伸区练习'),
    ])
    expect(searchIndex(two, '课题分离')[0]?.highlightId).toBe('c1')
  })
})

/**
 * 用户想法（note）参与打分（2026-09-29 新增）
 *
 * 全局搜索与笔记页那两台筛选器都搜 `note`，而这一层的索引以前只喂 `content`
 * ⇒ 同一个关键词三台两种答法（第三次）。想法是"这篇文档的内容"的一部分，
 * 所以它按 1 计、也计入文档长度（不是只加个词袋）。
 */
describe('buildIndex / searchIndex - 用户想法（note）', () => {
  const docs: RetrievalDoc[] = [
    doc('d1', 'b1', '一切烦恼都来自人际关系', { note: '拖延让我错过每一次表达' }),
    doc('d2', 'b1', '所谓自由就是被别人讨厌'),
    doc('d3', 'b1', '习惯的养成需要环境设计'),
  ]

  it('只在想法里出现的词也检索得到，且 content 不被改写', () => {
    const hits = searchIndex(buildIndex(docs), '拖延')
    expect(hits.map((h) => h.highlightId)).toEqual(['d1'])
    expect(hits[0].content).toBe('一切烦恼都来自人际关系')
    expect(hits[0].note).toBe('拖延让我错过每一次表达')
  })

  it('没写想法的文档交出的是 undefined，不是编出来的空串', () => {
    const hits = searchIndex(buildIndex(docs), '被别人讨厌')
    expect(hits[0].highlightId).toBe('d2')
    expect(hits[0].note).toBeUndefined()
  })

  it('想法计入文档长度（同一条有想法的划线会被自己摊薄，而不是白赚一次词频）', () => {
    const withNote = tokenize('一切烦恼都来自人际关系').length
    const withNoteAndThought = withNote + tokenize('拖延让我错过每一次表达').length
    expect(buildIndex(docs).docLengths[0]).toBe(withNoteAndThought)
    // 反证：没有想法的那两条，长度就是正文的 token 数
    expect(buildIndex(docs).docLengths[1]).toBe(tokenize('所谓自由就是被别人讨厌').length)
  })

  it('同一个词在正文与想法里各出现一次时，词频累加到 2', () => {
    const index = buildIndex([doc('d1', 'b1', '课题分离的实践', { note: '课题分离要练习' })])
    const postings = index.postings.get('课题') ?? []
    expect(postings).toHaveLength(1)
    expect(postings[0].tf).toBe(2)
  })

  it('空想法与没有想法等价（都不给这篇文档加任何 token）', () => {
    const a = buildIndex([doc('d1', 'b1', '正文一条', { note: '' })]).docLengths[0]
    const b = buildIndex([doc('d1', 'b1', '正文一条')]).docLengths[0]
    expect(a).toBe(b)
  })
})
