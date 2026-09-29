/**
 * 相关度显示口径（src/shared/relevance-display.ts）的判据
 *
 * 起因（2026-09-29 量出来的，不是猜的）：AI 消息气泡那条「引用来源」原先写的是
 * `相关度 ${Math.round((src.relevanceScore || 0) * 100)}%`，把 BM25 的**原始分**当成
 * 0-1 比率用。拿生产切词与打分跑一份小语料，顶部命中就是 5.4744 —— 界面会画成
 * 「相关度 547%」；09-16 那次在开发库（934 条划线）实测到过 17.2，即「1720%」。
 * 而既有的组件测试一直喂 0.9 / 0.87 这种假分数，于是这条缺陷被夹具掩护住了 ——
 * 「把缺陷写成期望」的又一种形态：不止断言能写成假的，夹具也能。
 *
 * mock：无。这里被测的是纯函数 + 真实的 BM25 打分 + 两份组件源码。
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import { relativeRelevancePercent, topRelevanceScore } from '../src/shared/relevance-display'
import { buildIndex, searchIndex, type RetrievalDoc } from '../src/shared/retrieval'

const ROOT = join(__dirname, '..')
const read = (rel: string): string => readFileSync(join(ROOT, rel), 'utf-8').replace(/\r\n/g, '\n')

describe('BM25 原始分的真实量级（这条是"百分比是编的"的证据）', () => {
  /** 与生产同一套切词与打分：中文 2 字滑窗 + BM25 + 标题加权 */
  const docs: RetrievalDoc[] = [
    { id: 'd1', bookId: 'b1', bookTitle: '被讨厌的勇气', chapterTitle: '第二夜', content: '一切烦恼都来自人际关系，人际关系的烦恼在于课题分离没有做好' },
    { id: 'd2', bookId: 'b1', bookTitle: '被讨厌的勇气', chapterTitle: '第一夜', content: '所有的烦恼都来自于人际关系这一句话并不准确' },
    { id: 'd3', bookId: 'b2', bookTitle: '思考，快与慢', chapterTitle: '第1章', content: '系统一与系统二的运作方式不同' },
    { id: 'd4', bookId: 'b2', bookTitle: '思考，快与慢', chapterTitle: '第2章', content: '注意力与记忆有关' },
    { id: 'd5', bookId: 'b3', bookTitle: '认知觉醒', chapterTitle: '第3章', content: '元认知是对思考的思考' },
    { id: 'd6', bookId: 'b3', bookTitle: '认知觉醒', chapterTitle: '第4章', content: '舒适区边缘的学习最有效' },
  ]

  it('顶部命中分数大于 1 —— 所以它不可能是个百分比', () => {
    const hits = searchIndex(buildIndex(docs), '人际关系', { limit: 3 })
    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0].relevanceScore).toBeGreaterThan(1)
  })

  it('反过来讲：把这个分乘 100 会摆出一个超过 100 的"百分比"', () => {
    const hits = searchIndex(buildIndex(docs), '人际关系', { limit: 3 })
    expect(Math.round(hits[0].relevanceScore * 100)).toBeGreaterThan(100)
  })

  it('相对最相关那条折算之后，第一条恰好是 100%', () => {
    const hits = searchIndex(buildIndex(docs), '人际关系', { limit: 3 })
    const top = topRelevanceScore(hits.map((h) => h.relevanceScore))
    expect(relativeRelevancePercent(hits[0].relevanceScore, top)).toBe(100)
  })
})

describe('topRelevanceScore：分母只取"真的能比"的那几个', () => {
  it('正常取最大值，与顺序无关', () => {
    expect(topRelevanceScore([0.86, 17.2, 4.3])).toBe(17.2)
  })

  it('空清单回 null（没有任何可比对象）', () => {
    expect(topRelevanceScore([])).toBeNull()
  })

  it('undefined / 0 / 负数 / NaN / Infinity 一律不参与', () => {
    expect(topRelevanceScore([undefined, 0, -3.5, NaN, Infinity])).toBeNull()
  })

  it('混在里面时，脏值不许冒充最高分', () => {
    expect(topRelevanceScore([Infinity, 2.5])).toBe(2.5)
    expect(topRelevanceScore([0, 1.25])).toBe(1.25)
  })

  it('全是脏值时是 null 而不是 0 —— 0 会被界面读成"相关度 0%"', () => {
    expect(topRelevanceScore([0, 0])).toBeNull()
  })
})

describe('relativeRelevancePercent：只说"相对最相关那条"', () => {
  it('与分母相同 ⇒ 100', () => {
    expect(relativeRelevancePercent(17.2, 17.2)).toBe(100)
  })

  it('按比例折算并四舍五入', () => {
    expect(relativeRelevancePercent(4.3, 17.2)).toBe(25)
    expect(relativeRelevancePercent(0.86, 17.2)).toBe(5)
  })

  it('没有分母时回 null，不猜 0%', () => {
    expect(relativeRelevancePercent(3.2, null)).toBeNull()
  })

  it('自己这分数无效时回 null（undefined / 0 / 负 / NaN / Infinity）', () => {
    for (const bad of [undefined, 0, -1, NaN, Infinity]) {
      expect(relativeRelevancePercent(bad, 17.2)).toBeNull()
    }
  })

  it('比最相关那条弱到不足 0.5% 时报 1，不说成 0%', () => {
    // 0.001 / 17.2 → 0.0058% → Math.round 是 0；那会被读成"完全无关"
    expect(relativeRelevancePercent(0.001, 17.2)).toBe(1)
  })

  it('传进来的分数高于分母时封顶 100（不可能摆出 547% 那种数）', () => {
    expect(relativeRelevancePercent(100, 17.2)).toBe(100)
  })
})

/*
  「同一件事只许有一份口径」在本项目已验证过五次（字段清单 → 章节名 → 时间口径 →
  难度算法 → 记忆检索的 LIKE 转义）。相关度的"显示口径"同理：一旦组件里各算各的，
  就会有一处重新乘回 100。所以这里扫源码，而不是只测纯函数。
*/
describe('界面不许再把原始分当百分比（源码扫描）', () => {
  const COMPONENTS = [
    'src/renderer/src/components/chat/MessageBubble.tsx',
    'src/renderer/src/components/chat/RetrievalPanel.tsx',
  ]

  it('这两份组件都不许出现 relevanceScore 乘 100', () => {
    for (const file of COMPONENTS) {
      const src = read(file)
      expect(src, `${file} 又把 BM25 原始分乘成百分比了`).not.toMatch(/relevanceScore[^\n]*\*\s*100/)
    }
  })

  it('气泡那份显示相关度时必须走共享的相对口径', () => {
    const src = read('src/renderer/src/components/chat/MessageBubble.tsx')
    expect(src).toContain('relativeRelevancePercent')
    expect(src).toContain('topRelevanceScore')
  })

  it('面板那份既然不再摆相关度，就不许再留着"命中数 · 分数"那个拼法', () => {
    const panel = read('src/renderer/src/components/chat/RetrievalPanel.tsx')
    expect(panel).not.toMatch(/条命中\s*·/)
    expect(panel).not.toMatch(/topScore|scoreText/)
    expect(read('src/renderer/src/stores/chatStore.ts')).not.toMatch(/\btopScore\b/)
  })

  it('反证：收口前的原文必须被扫描命中（判据不是空转）', () => {
    const before = '相关度 {Math.round((src.relevanceScore || 0) * 100)}%'
    expect(before).toMatch(/relevanceScore[^\n]*\*\s*100/)
  })
})
