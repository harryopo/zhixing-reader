import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { articlesDb, vocabularyDb, booksDb } from '../electron/database'
import { ArticleContextBuilder } from '../electron/agent/builders/article-context-builder'
import { VocabularyContextBuilder } from '../electron/agent/builders/vocabulary-context-builder'

/**
 * 文章与生词进提示词这两路（2026-09-24 新增）。
 *
 * 库里早就存着读过的文章与收着的生词，但上下文构建器只有 5 路，
 * 问「我读过的那篇讲什么的」AI 完全看不见。这两路必须**真命中才注入**，
 * 不相关的句子不许被硬塞进提示词（那会白花 token 还带偏回答）。
 */

const ctx = (userMessage: string) => ({ sessionId: 's1', userMessage, conversationHistory: [] })

describe('文章上下文构建器', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    articlesDb.create({
      id: 'a1',
      title_en: 'How to read a book without forgetting it',
      title_zh: '如何读书而不遗忘',
      content_en: 'Spacing and retrieval practice are the two levers that keep a book alive.',
      summary_zh: '间隔与提取练习是让一本书活下来的两个杠杆。',
      source: 'rss',
      category: 'learning',
      difficulty: 'cet4',
    })
  })

  afterEach(() => {
    teardownTestDatabase()
  })

  it('问题命中文章时，把标题与原句注入进去', () => {
    const result = new ArticleContextBuilder().build(ctx('关于读书遗忘，我读过的那篇怎么说'))
    expect(result.content).toContain('用户读过的文章')
    expect(result.content).toContain('How to read a book without forgetting it')
    expect(result.metadata?.itemCount).toBe(1)
  })

  it('问题与文章无关时一个字都不注入（反证：上一条确实注入成功了）', () => {
    const irrelevant = new ArticleContextBuilder().build(ctx('量子纠缠的实验验证有哪些'))
    expect(irrelevant.content).toBe('')
    expect(irrelevant.metadata?.itemCount).toBe(0)
    const relevant = new ArticleContextBuilder().build(ctx('读书遗忘 那篇'))
    expect(relevant.content).not.toBe('')
  })

  it('库里没有文章时不报错、不注入', () => {
    articlesDb.delete('a1')
    const result = new ArticleContextBuilder().build(ctx('关于读书遗忘，我读过的那篇怎么说'))
    expect(result.content).toBe('')
    expect(result.metadata?.itemCount).toBe(0)
  })
})

describe('生词上下文构建器', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    booksDb.create({ id: 'b1', title: '一本书' })
    vocabularyDb.create({
      id: 'w1',
      word: 'procrastination',
      phonetic: '/prəkreɪˈsteɪʃn/',
      part_of_speech: 'n.',
      meaning_zh: '拖延',
      example_en: 'Procrastination is the thief of time.',
      example_zh: '拖延是时间的窃贼。',
      source: 'article',
    })
  })

  afterEach(() => {
    teardownTestDatabase()
  })

  it('命中时注入词条、释义与原句', () => {
    const result = new VocabularyContextBuilder().build(ctx('procrastination 是什么意思'))
    expect(result.content).toContain('用户的生词本')
    expect(result.content).toContain('拖延')
    expect(result.content).toContain('Procrastination is the thief of time.')
  })

  it('没命中的词不许硬塞', () => {
    expect(new VocabularyContextBuilder().build(ctx('今天天气如何')).content).toBe('')
  })
})

/** 写出来没接线 = 等于没做（本项目有过实现活着但没人调的一整壁） */
describe('两路构建器确实注册进编排器', () => {
  const source = readFileSync(resolve(process.cwd(), 'electron/agent/orchestrator.ts'), 'utf8')

  it('文章与生词都在注册表里', () => {
    expect(source).toContain('new ArticleContextBuilder()')
    expect(source).toContain('new VocabularyContextBuilder()')
  })

  it('注册时给出优先级（预算紧张时靠它让位）', () => {
    const article = readFileSync(
      resolve(process.cwd(), 'electron/agent/builders/article-context-builder.ts'),
      'utf8',
    )
    const vocab = readFileSync(
      resolve(process.cwd(), 'electron/agent/builders/vocabulary-context-builder.ts'),
      'utf8',
    )
    expect(article).toMatch(/priority = (\d+)/)
    expect(vocab).toMatch(/priority = (\d+)/)
  })
})
