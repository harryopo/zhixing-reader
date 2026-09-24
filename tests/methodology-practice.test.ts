import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { methodologiesDb, booksDb } from '../electron/database'
import { recordMethodologyPractice } from '../electron/agent/orchestrator'

/**
 * 「练过一次」的判据必须是用户的动作。
 *
 * 原先 orchestrator 里那套是在 **AI 的回答文本**里找方法论名字，命中就给
 * practice_count +1、mastery +5/+2 —— 模型顺嘴提一句「比如番茄工作法」，
 * 界面上就多出一次练习。用户什么都没做，数字却涨了，这是本项目不要的写法。
 */

function seedMethodology(name = '四步读书法'): string {
  const id = `method-${Math.random().toString(36).slice(2, 8)}`
  booksDb.create({ id: 'book-1', title: '一本书' })
  methodologiesDb.create({
    id,
    book_id: 'book-1',
    name,
    mastery_level: 0,
    practice_count: 0,
  })
  return id
}

function read(id: string): { mastery_level: number; practice_count: number } {
  const row = methodologiesDb.getById(id) as Record<string, unknown>
  return {
    mastery_level: Number(row.mastery_level),
    practice_count: Number(row.practice_count),
  }
}

describe('方法论练习记账', () => {
  beforeEach(async () => {
    await setupTestDatabase()
  })

  afterEach(() => {
    teardownTestDatabase()
  })

  it('带着这条方法论练一轮：练习次数 +1，掌握度按本轮质量上调', () => {
    const id = seedMethodology()
    recordMethodologyPractice(id, true)
    expect(read(id)).toEqual({ mastery_level: 5, practice_count: 1 })
    recordMethodologyPractice(id, false)
    expect(read(id)).toEqual({ mastery_level: 7, practice_count: 2 })
  })

  it('掌握度封顶 100，不会累加出 105 这种界面上没法解释的数', () => {
    const id = seedMethodology()
    methodologiesDb.update(id, { mastery_level: 98 })
    recordMethodologyPractice(id, true)
    expect(read(id).mastery_level).toBe(100)
  })

  it('练的方法论已被删除：不抛错、不凭空造行', () => {
    expect(() => recordMethodologyPractice('not-exist', true)).not.toThrow()
    expect(methodologiesDb.getAll()).toHaveLength(0)
  })

  it('记账只认这一条：同书其他方法论的数字不许跟着动', () => {
    const target = seedMethodology('目标方法')
    const otherId = `method-other`
    methodologiesDb.create({
      id: otherId,
      book_id: 'book-1',
      name: '目标方法进阶版',
      mastery_level: 0,
      practice_count: 0,
    })
    recordMethodologyPractice(target, true)
    expect(read(otherId)).toEqual({ mastery_level: 0, practice_count: 0 })
  })
})

/**
 * 结构守卫：按名字匹配回答文本的那套写法不许回来。
 * 它一旦复活，练习次数就又变成"模型说了算"，而这种漂移肉眼看不出来。
 */
describe('编排器的记账口径', () => {
  const source = readFileSync(resolve(process.cwd(), 'electron/agent/orchestrator.ts'), 'utf8')

  it('唯一的练习记账入口是"本轮带着 methodologyId"', () => {
    expect(source).toContain('if (context.methodologyId) {')
    expect(source).toContain('recordMethodologyPractice(context.methodologyId, isCorrect)')
  })

  it('不再有"回答里出现方法论名就算练过"的匹配代码', () => {
    expect(source).not.toContain('updateMethodologyMastery')
    expect(source).not.toMatch(/nameInResponse/)
    expect(source).not.toMatch(/cnNameHit/)
    // 反证：这个文件确实还在给方法论记账，上面三条不是因为整个文件被删空才通过的
    expect(source).toContain('recordMethodologyPractice')
  })
})
