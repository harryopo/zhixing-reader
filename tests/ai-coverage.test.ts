// AI 生成覆盖数（#87）—— 一次最多喂多少条划线，以及这个数字怎么到用户眼前
//
// 起因：知识卡片蒸馏硬截到 60 条、方法论提取硬截到 50 条，而界面上只说「蒸馏完成」。
// 一本 312 条划线的书看起来像全本书都生成了卡片。上限本身不是 bug（单次请求的
// 上下文与超时预算），**不说不然**才是 bug。
//
// 这里钉三件事：
//   1) 计划的算术对（covered / skipped / partial）；
//   2) 界面文案由同一份 plan 派生，完整覆盖时不啰嗦；
//   3) 上限只有一份真值 —— 主进程不许再自己写数字（反证：喂一条旧写法必须被判红）。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { AI_INPUT_LIMITS, coverageNotice, planAiCoverage, takeWithinLimit } from '../src/shared/ai-coverage'

describe('planAiCoverage：覆盖数的算术', () => {
  it('未达上限：全部覆盖，skipped 0', () => {
    expect(planAiCoverage('knowledgeCards', 12)).toMatchObject({
      covered: 12,
      skipped: 0,
      partial: false,
    })
  })

  it('正好等于上限：不算 partial（没有一条被挡在外面）', () => {
    const plan = planAiCoverage('methodologies', AI_INPUT_LIMITS.methodologies)
    expect(plan.covered).toBe(AI_INPUT_LIMITS.methodologies)
    expect(plan.partial).toBe(false)
    expect(plan.skipped).toBe(0)
  })

  it('超过上限：covered 到顶，skipped 是差额', () => {
    expect(planAiCoverage('knowledgeCards', 312)).toMatchObject({
      covered: 60,
      skipped: 252,
      partial: true,
      limit: 60,
    })
  })

  it('0 条划线：covered 0 且不算 partial（没有东西被挡在外面）', () => {
    expect(planAiCoverage('knowledgeCards', 0)).toMatchObject({
      covered: 0,
      skipped: 0,
      partial: false,
    })
  })
})

describe('takeWithinLimit：取到的与算出的是同一批', () => {
  it('selected 长度恒等于 plan.covered，且保持调用方给的顺序', () => {
    const items = Array.from({ length: 70 }, (_, i) => i)
    const { selected, plan } = takeWithinLimit('knowledgeCards', items)
    expect(selected).toHaveLength(plan.covered)
    expect(selected[0]).toBe(0)
    expect(selected[selected.length - 1]).toBe(AI_INPUT_LIMITS.knowledgeCards - 1)
  })

  it('不裁时原样返回（不长出新数组语义之外的东西）', () => {
    const { selected, plan } = takeWithinLimit('methodologies', ['a', 'b'])
    expect(selected).toEqual(['a', 'b'])
    expect(plan.partial).toBe(false)
  })
})

describe('coverageNotice：说人话且不啰嗦', () => {
  it('完整覆盖时不提示', () => {
    expect(coverageNotice(planAiCoverage('knowledgeCards', 5), '划线')).toBeNull()
  })

  it('部分覆盖时把三个数都摆出来', () => {
    const notice = coverageNotice(planAiCoverage('knowledgeCards', 312), '划线')
    expect(notice).toContain('60/312')
    expect(notice).toContain('252 条未处理')
  })

  it('措辞里不出现「前/后」—— 划线在库里按时间倒序取，被取走的是最近的那批，不是书的前半', () => {
    const notice = coverageNotice(planAiCoverage('knowledgeCards', 312), '划线') ?? ''
    expect(notice).not.toMatch(/[前后] \d+\/\d+/)
    expect(notice).not.toContain('前 60')
  })
})

describe('上限只有一份真值', () => {
  const aiService = readFileSync(join(__dirname, '../electron/ai-service.ts'), 'utf8')

  it('ai-service 从 shared 取上限，不再自己写数字', () => {
    expect(aiService).toMatch(/from '\.\.\/src\/shared\/ai-coverage'/)
    expect(aiService).toContain('takeWithinLimit')
  })

  it('反证：旧的硬截断写法一旦回来就判红', () => {
    // 这两条就是改动前 ai-service.ts 里的原文
    expect(aiService).not.toMatch(/slice\(0,\s*50\)/)
    expect(aiService).not.toMatch(/DISTILL_MAX_HIGHLIGHTS/)
    // 判据本身看得见东西：把被禁的写法喂进去必须命中
    const forbidden = ['highlights.slice(0, 50)', 'const DISTILL_MAX_HIGHLIGHTS = 60']
    for (const snippet of forbidden) {
      const hit = snippet.match(/slice\(0,\s*50\)|DISTILL_MAX_HIGHLIGHTS/)
      expect(hit, `扫描正则对旧写法失效：${snippet}`).not.toBeNull()
    }
  })

  it('两个上限各自存在且不为 0（0 会让所有生成都变成空结果）', () => {
    expect(AI_INPUT_LIMITS.knowledgeCards).toBeGreaterThan(0)
    expect(AI_INPUT_LIMITS.methodologies).toBeGreaterThan(0)
  })
})
