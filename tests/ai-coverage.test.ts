// AI 生成覆盖数与分批续跑（#87）—— 一次最多喂多少条划线、整本书怎么跑完
//
// 起因：知识卡片蒸馏硬截到 60 条划线、方法论提取硬截到 50 条，而界面上只说「蒸馏完成」。
// 一本 329 条划线的书（本机开发库实测最大的一本）看起来像整本书都生成了卡片。
// 上限本身不是 bug（单次请求的上下文与超时预算），**不说不然**才是 bug。
//
// 现在多了第二条路：分批续跑 —— 每次点「继续」只喂台账里没记过的那批，
// 单次花费与从前一致，多点几下覆盖整本书。
//
// 这里钉四件事：
//   1) 计划的算术对（covered / skipped / partial / alreadyProcessed）；
//   2) 续跑取的确实是"没处理过的那批"，而不是重新数一遍；
//   3) 界面文案由同一份 plan 派生，全部处理完时不啰嗦；
//   4) 上限只有一份真值 —— 主进程不许再自己写数字（反证：喂一条旧写法必须被判红）。

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import {
  AI_INPUT_LIMITS,
  coverageNotice,
  describeBookCoverage,
  generateButtonLabel,
  pickUnprocessed,
  planAiCoverage,
  resolveGenerateAction,
  takeWithinLimit,
} from '../src/shared/ai-coverage'

describe('planAiCoverage：覆盖数的算术', () => {
  it('未达上限：全部覆盖，skipped 0', () => {
    expect(planAiCoverage('knowledgeCards', 12)).toMatchObject({
      covered: 12,
      skipped: 0,
      partial: false,
      alreadyProcessed: 0,
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

  it('0 条划线：covered 0 且不算 partial（没有东西要处理）', () => {
    expect(planAiCoverage('knowledgeCards', 0)).toMatchObject({
      covered: 0,
      skipped: 0,
      partial: false,
    })
  })

  it('续跑：已处理过的从分母里扣掉，还剩的才算 skipped', () => {
    // 329 条的书，第二次点：前 60 条已处理 → 这次再 60，还剩 209
    expect(planAiCoverage('knowledgeCards', 329, 60)).toMatchObject({
      covered: 60,
      alreadyProcessed: 60,
      skipped: 209,
      partial: true,
    })
  })

  it('续跑最后一次：剩下的不足上限，全部吃掉且不再 partial', () => {
    // 329 = 60 × 5 + 29：第六次点只剩 29 条
    expect(planAiCoverage('knowledgeCards', 329, 300)).toMatchObject({
      covered: 29,
      skipped: 0,
      partial: false,
    })
  })

  it('台账比总数还大（划线被删过）：不会算出负的 covered', () => {
    expect(planAiCoverage('knowledgeCards', 10, 30)).toMatchObject({
      covered: 0,
      skipped: 0,
      partial: false,
    })
  })
})

describe('takeWithinLimit / pickUnprocessed：取到的与算出的是同一批', () => {
  it('takeWithinLimit：selected 长度恒等于 plan.covered，且保持调用方给的顺序', () => {
    const items = Array.from({ length: 70 }, (_, i) => i)
    const { selected, plan } = takeWithinLimit('knowledgeCards', items)
    expect(selected).toHaveLength(plan.covered)
    expect(selected[0]).toBe(0)
    expect(selected[selected.length - 1]).toBe(AI_INPUT_LIMITS.knowledgeCards - 1)
  })

  it('takeWithinLimit：不裁时原样返回', () => {
    const { selected, plan } = takeWithinLimit('methodologies', ['a', 'b'])
    expect(selected).toEqual(['a', 'b'])
    expect(plan.partial).toBe(false)
  })

  it('pickUnprocessed：跳过台账记过的，取的是没处理过的那一批', () => {
    const items = Array.from({ length: 130 }, (_, i) => ({ id: `h${i}` }))
    const processed = new Set(items.slice(0, 60).map((h) => h.id))
    const { selected, plan } = pickUnprocessed('knowledgeCards', items, processed, (h) => h.id)

    expect(selected[0].id).toBe('h60')
    expect(selected).toHaveLength(60)
    expect(selected.some((h) => processed.has(h.id))).toBe(false)
    expect(plan).toMatchObject({ total: 130, alreadyProcessed: 60, covered: 60, skipped: 10, partial: true })
  })

  it('pickUnprocessed：全都处理过了就交回空批 —— 调用方据此一次 AI 都不调', () => {
    const items = [{ id: 'a' }, { id: 'b' }]
    const { selected, plan } = pickUnprocessed(
      'methodologies',
      items,
      new Set(['a', 'b']),
      (h) => h.id,
    )
    expect(selected).toEqual([])
    expect(plan).toMatchObject({ covered: 0, skipped: 0, partial: false, alreadyProcessed: 2 })
  })

  it('pickUnprocessed：没有 id 的条目不会被当成"已处理"', () => {
    const { selected, plan } = pickUnprocessed(
      'knowledgeCards',
      [{ id: undefined }, { id: 'x' }],
      new Set<string>(),
      (h) => h.id,
    )
    expect(selected).toHaveLength(2)
    expect(plan.alreadyProcessed).toBe(0)
  })
})

describe('describeBookCoverage / resolveGenerateAction：列表页说清点下去会发生什么', () => {
  const words = { start: '开始蒸馏', continue: '继续', redo: '重新蒸馏' }

  it('一条没处理 → start（"开始蒸馏"）', () => {
    const view = describeBookCoverage(329, 0, 0)
    expect(view).toMatchObject({ remaining: 329, status: 'none' })
    const plan = resolveGenerateAction(view, 0)
    expect(plan.action).toBe('start')
    expect(generateButtonLabel(plan.action, plan.view, words)).toBe('开始蒸馏')
  })

  it('有成品、有可追溯进度、还剩一批 → continue（"继续剩余 N 条"，N 是还能生成多少）', () => {
    const view = describeBookCoverage(329, 60, 12)
    expect(view).toMatchObject({ processed: 60, remaining: 269, status: 'partial' })
    const plan = resolveGenerateAction(view, 12)
    expect(plan.action).toBe('continue')
    expect(generateButtonLabel(plan.action, plan.view, words)).toBe('继续剩余 269 条')
  })

  it('整本书都处理过 → replace（再点就是从头再来，界面必须换词并先确认）', () => {
    const view = describeBookCoverage(329, 329, 40)
    expect(view.status).toBe('full')
    const plan = resolveGenerateAction(view, 40)
    expect(plan.action).toBe('replace')
    expect(generateButtonLabel(plan.action, plan.view, words)).toBe('重新蒸馏')
  })

  it('有成品但台账是空的（记账上线前生成的老卡片）→ replace，不是 continue', () => {
    // 判成 continue 会静默重复生成一批卡片：重复花钱 + 内容翻倍
    const view = describeBookCoverage(329, 0, 90)
    const plan = resolveGenerateAction(view, 90)
    expect(plan.action).toBe('replace')
  })

  it('成品被清空过 → 台账进度作废，重新从第一批次开始', () => {
    // 卡片全删了却还让台账声称"这 60 条处理过了"，用户就永远补不回那 60 条
    const view = describeBookCoverage(329, 60, 0)
    expect(view).toMatchObject({ processed: 0, remaining: 329, status: 'none' })
    expect(resolveGenerateAction(view, 0).action).toBe('start')
  })

  it('台账数超过总数（划线删过）不会算出负的 remaining', () => {
    expect(describeBookCoverage(10, 30, 5)).toMatchObject({ processed: 10, remaining: 0, status: 'full' })
  })
})

describe('coverageNotice：说人话且不啰嗦', () => {
  it('完整覆盖时不提示', () => {
    expect(coverageNotice(planAiCoverage('knowledgeCards', 5), '划线')).toBeNull()
    expect(coverageNotice(planAiCoverage('knowledgeCards', 329, 329), '划线')).toBeNull()
  })

  it('部分覆盖时把三个数都摆出来', () => {
    const notice = coverageNotice(planAiCoverage('knowledgeCards', 312), '划线')
    expect(notice).toContain('60/312')
    expect(notice).toContain('还剩 252 条')
  })

  it('续跑时说出之前已经处理过多少', () => {
    const notice = coverageNotice(planAiCoverage('knowledgeCards', 312, 60), '划线')
    expect(notice).toContain('之前已处理 60')
    expect(notice).toContain('还剩 192 条')
  })

  it('措辞里不出现「前/后」—— 划线在库里按时间倒序取，被取走的是最近的那批，不是书的前半', () => {
    const notice = coverageNotice(planAiCoverage('knowledgeCards', 312), '划线') ?? ''
    expect(notice).not.toContain('前 60')
    expect(notice).not.toContain('后 60')
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
