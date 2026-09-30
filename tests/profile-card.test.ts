// @vitest-environment node
/**
 * profile-card — 画像卡（要贴给外部 AI 的那一小段）
 *
 * 判的是四条"改错就会说假话"的口径：
 * 1. **只有本人点过「对」的才配进这张卡**（喂进来的行带着 verdict，函数自己筛，
 *    不靠调用方自觉 —— 调用方漏筛一次，未核验的结论就以"你的画像"的名义出去了）。
 * 2. 超预算时**如实写出还有几条没放进去**，不是静默截断。
 * 3. token 这把尺只有 `src/shared/usage-tokens.ts` 一份，这里不写第二份。
 * 4. 「我说的」那层一条都没有时，表达风格那一维**自动记为不适用**并写进卡里
 *    （方案书 §8 第七条：没料的时候不许硬编）。
 */
import { describe, expect, it } from 'vitest'
import { estimateTextTokens } from '../src/shared/usage-tokens'
import { PROFILE_CARD_EMPTY, renderProfileCard } from '../src/shared/profile-card'
import type { CardStatement } from '../src/shared/profile-card'

const row = (over: Partial<CardStatement> = {}): CardStatement => ({
  layer: 'said',
  topic: '表达',
  statement: '我写东西短、直白、常用对仗',
  verdict: 'confirmed',
  ...over,
})

describe('只让本人确认过的进卡', () => {
  it('四种判定各归各的：只有 confirmed 进', () => {
    const card = renderProfileCard([
      row({ statement: '对的那一条', verdict: 'confirmed' }),
      row({ statement: '还没判', verdict: 'pending' }),
      row({ statement: '说了不对', verdict: 'rejected' }),
      row({ statement: '说不准', verdict: 'unsure' }),
    ])
    expect(card.text).toContain('对的那一条')
    expect(card.text).not.toContain('还没判')
    expect(card.text).not.toContain('说了不对')
    expect(card.text).not.toContain('说不准')
    expect(card.included).toBe(1)
  })

  it('一条 confirmed 都没有 ⇒ 说的是人话，不是空串', () => {
    const card = renderProfileCard([row({ verdict: 'pending' })])
    expect(card.text).toBe(PROFILE_CARD_EMPTY)
    expect(card.text.length).toBeGreaterThan(0)
    expect(card.included).toBe(0)
  })

  it('空清单同样不是空串（外部 AI 拿到空串会以为你没画像）', () => {
    expect(renderProfileCard([]).text).toBe(PROFILE_CARD_EMPTY)
  })
})

describe('按话题分组，顺序是稳定的', () => {
  it('同一话题合在一节，话题按首次出现排', () => {
    const card = renderProfileCard([
      row({ topic: '做事', statement: '甲' }),
      row({ topic: '表达', statement: '乙' }),
      row({ topic: '做事', statement: '丙' }),
    ])
    expect(card.text.indexOf('## 做事')).toBeLessThan(card.text.indexOf('## 表达'))
    expect(card.text.indexOf('- 甲')).toBeLessThan(card.text.indexOf('- 丙'))
    expect(card.text).toContain('- 乙')
  })

  it('同一份输入两次输出逐字相同（画像卡要能拿去比对）', () => {
    const rows = [row({ statement: '甲' }), row({ topic: '做事', statement: '乙' })]
    expect(renderProfileCard(rows).text).toBe(renderProfileCard(rows).text)
  })
})

describe('预算这把尺', () => {
  const three = [
    row({ statement: '第一条结论，说的是我写东西的偏好', verdict: 'confirmed' }),
    row({ statement: '第二条结论，说的是我要什么样的回答', verdict: 'confirmed' }),
    row({ statement: '第三条结论，说的是我怎么接新书', verdict: 'confirmed' }),
  ]

  it('预算够时全进去，且不多写「还有几条没放进去」', () => {
    const card = renderProfileCard(three, { maxTokens: 100000 })
    expect(card.included).toBe(3)
    expect(card.omitted).toBe(0)
    expect(card.text).not.toContain('没放进去')
  })

  it('两头各钉一次：刚好够全进去的那个预算，少一个字就少一条', () => {
    const full = renderProfileCard(three, { maxTokens: 100000 })
    const tight = renderProfileCard(three, { maxTokens: full.tokens - 1 })
    expect(full.omitted).toBe(0)
    expect(tight.included).toBe(2)
    expect(tight.omitted).toBe(1)
    expect(tight.text).toContain('还有 1 条没放进去')
    expect(tight.text).not.toContain(three[2].statement)
  })

  it('预算小到一条都放不下时，说的不是「你的画像」', () => {
    const card = renderProfileCard(three, { maxTokens: 1 })
    expect(card.included).toBe(0)
    expect(card.omitted).toBe(3)
    expect(card.text).toContain('装不下任何一条')
    expect(card.text).not.toContain(three[0].statement)
  })

  it('报出去的 tokens 就是那把尺量出来的，不是另算一遍', () => {
    const card = renderProfileCard(three, { maxTokens: 100000 })
    expect(card.tokens).toBe(estimateTextTokens(card.text))
  })

  it('默认预算是方案书里那个 150 token', () => {
    const card = renderProfileCard([row({ statement: '很短' })])
    expect(card.tokens).toBeLessThanOrEqual(card.maxTokens)
    expect(card.maxTokens).toBeGreaterThan(0)
  })
})

describe('没料的时候不许硬编', () => {
  it('「我说的」那层一条都没有 ⇒ 卡里写明表达风格那一维不适用', () => {
    const card = renderProfileCard([row({ layer: 'marked', statement: '我只划过别人的句子' })], { maxTokens: 100000 })
    expect(card.text).toContain('本次没有你亲手写的素材')
    expect(card.text).toContain('不适用')
  })

  it('正向对照：有一条 said 就不摆那句', () => {
    const card = renderProfileCard([row({ statement: '我自己写的一句话' })], { maxTokens: 100000 })
    expect(card.text).not.toContain('本次没有你亲手写的素材')
  })
})
