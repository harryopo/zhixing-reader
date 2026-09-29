import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { setupTestDatabase, teardownTestDatabase } from './__fixtures__/db-helpers'
import { articlesDb, vocabularyDb, booksDb, getDatabase } from '../electron/database'
import { ArticleContextBuilder } from '../electron/agent/builders/article-context-builder'
import { VocabularyContextBuilder } from '../electron/agent/builders/vocabulary-context-builder'

vi.mock('../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

/**
 * 文章与生词进提示词这两路（2026-09-24 新增）。
 *
 * 库里早就存着读过的文章与收着的生词，但上下文构建器只有 5 路，
 * 问「我读过的那篇讲什么的」AI 完全看不见。这两路必须**真命中才注入**，
 * 不相关的句子不许被硬塞进提示词（那会白花 token 还带偏回答）。
 *
 * 2026-09-29 补的一类：这两路的 `catch` 交出的是**与"库里没数据"一字不差**的结果，
 * 于是「调取知识库」面板把读库失败说成「无命中」。本文件因此逐条钉住
 * 「失败要带 `metadata.error`、没数据不许带」，末尾还有一条覆盖全部构建器的常驻扫描
 * —— 同一类形状不许只在这两路被修掉。
 */

const ctx = (userMessage: string) => ({ sessionId: 's1', userMessage, conversationHistory: [] })

/** 造一篇文章：默认字段齐，缺什么由用例覆盖 */
const makeArticle = (over: Record<string, unknown> = {}): void => {
  articlesDb.create({
    id: 'a1',
    title_en: 'How to read a book without forgetting it',
    title_zh: '如何读书而不遗忘',
    content_en: 'Spacing and retrieval practice are the two levers that keep a book alive.',
    summary_zh: '间隔与提取练习是让一本书活下来的两个杠杆。',
    source: 'rss',
    category: 'learning',
    difficulty: 'cet4',
    ...over,
  })
}

describe('文章上下文构建器', () => {
  beforeEach(async () => {
    await setupTestDatabase()
    makeArticle()
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

  it('命中那篇逐栏对账：中译 / 分类 / 难度 / 状态都是库里那一行的值', () => {
    const { content } = new ArticleContextBuilder().build(ctx('读书遗忘'))
    expect(content).toContain('【How to read a book without forgetting it】 中译：如何读书而不遗忘')
    expect(content).toContain('分类: learning')
    expect(content).toContain('难度: cet4')
    expect(content).toContain('状态: 未读')
    expect(content).toContain('Spacing and retrieval practice')
  })

  it('is_read 为 1 才说「已读过」（0 与缺省都是未读，不猜）', () => {
    const { content } = new ArticleContextBuilder().build(ctx('读书遗忘'))
    expect(content).toContain('状态: 未读')
    getDatabase().run('UPDATE articles SET is_read = 1 WHERE id = ?', ['a1'])
    expect(new ArticleContextBuilder().build(ctx('读书遗忘')).content).toContain('状态: 已读过')
  })

  it('没有中译时不摆「中译：」那一截', () => {
    getDatabase().run('UPDATE articles SET title_zh = NULL WHERE id = ?', ['a1'])
    const { content } = new ArticleContextBuilder().build(ctx('spacing and retrieval'))
    expect(content).toContain('【How to read a book without forgetting it】')
    expect(content).not.toContain('中译：')
  })

  it('英文标题是空串时退回中文标题（列 NOT NULL，空串是真能出现的值）', () => {
    getDatabase().run('UPDATE articles SET title_en = ? WHERE id = ?', ['', 'a1'])
    const { content } = new ArticleContextBuilder().build(ctx('如何读书而不遗忘'))
    expect(content).toContain('【如何读书而不遗忘】')
    expect(content).not.toContain('中译：')
  })

  it('两个标题都是空串时如实说「（无标题）」，不编一个', () => {
    getDatabase().run('UPDATE articles SET title_en = ?, title_zh = ? WHERE id = ?', ['', '', 'a1'])
    const { content } = new ArticleContextBuilder().build(ctx('间隔与提取练习'))
    expect(content).toContain('【（无标题）】')
  })

  it('正文缺省走「英文 → 中文 → 摘要」这一条链', () => {
    getDatabase().run('UPDATE articles SET content_en = ?, content_zh = ? WHERE id = ?', ['', '中文正文在此', 'a1'])
    const { content } = new ArticleContextBuilder().build(ctx('读书遗忘'))
    expect(content).toContain('中文正文在此')
    getDatabase().run('UPDATE articles SET content_zh = NULL WHERE id = ?', ['a1'])
    expect(new ArticleContextBuilder().build(ctx('间隔与提取练习')).content).toContain(
      '间隔与提取练习是让一本书活下来的两个杠杆。',
    )
  })

  it('三栏正文全空时不摆正文段（也没法摆）', () => {
    getDatabase().run(
      'UPDATE articles SET content_en = ?, content_zh = NULL, summary_zh = NULL WHERE id = ?',
      ['   ', 'a1'],
    )
    const { content } = new ArticleContextBuilder().build(ctx('读书遗忘'))
    expect(content).toContain('【How to read a book without forgetting it】')
    expect(content).not.toContain('   ')
  })

  it('正文截到 700 字，两头各钉一条（699 不截、701 截）', () => {
    getDatabase().run('UPDATE articles SET content_en = ? WHERE id = ?', ['z'.repeat(699), 'a1'])
    expect(new ArticleContextBuilder().build(ctx('读书遗忘')).content).toContain('z'.repeat(699))
    getDatabase().run('UPDATE articles SET content_en = ? WHERE id = ?', ['z'.repeat(701), 'a1'])
    const cut = new ArticleContextBuilder().build(ctx('读书遗忘')).content
    expect(cut).toContain('z'.repeat(700) + '…')
    expect(cut).not.toContain('z'.repeat(701))
  })

  it('一次最多注入两篇（提示词预算里给文章只留了这么大）', () => {
    makeArticle({ id: 'a2', title_en: 'Reading and forgetting curve two', title_zh: '第二篇读书遗忘' })
    makeArticle({ id: 'a3', title_en: 'Reading and forgetting curve three', title_zh: '第三篇读书遗忘' })
    const { metadata } = new ArticleContextBuilder().build(ctx('读书遗忘'))
    expect(metadata?.itemCount).toBe(2)
  })

  it('问题与文章无关时一个字都不注入（反证：上一条确实注入成功了）', () => {
    const irrelevant = new ArticleContextBuilder().build(ctx('量子纠缠的实验验证有哪些'))
    expect(irrelevant.content).toBe('')
    expect(irrelevant.metadata?.itemCount).toBe(0)
    const relevant = new ArticleContextBuilder().build(ctx('读书遗忘 那篇'))
    expect(relevant.content).not.toBe('')
  })

  it('库里没有文章时不报错、不注入，且**不说成失败**（没有 error 键）', () => {
    // 产品没有"删文章"的通路（articles:delete 通道早已因零调用被砍），所以直接清表来造这个场景
    getDatabase().run('DELETE FROM articles')
    const result = new ArticleContextBuilder().build(ctx('关于读书遗忘，我读过的那篇怎么说'))
    expect(result.content).toBe('')
    expect(result.metadata?.itemCount).toBe(0)
    expect(result.metadata?.error).toBeUndefined()
  })

  it('读库抛错时必须把原因交出去：面板要说「读取失败」而不是「无命中」', () => {
    const spy = vi.spyOn(articlesDb, 'getAll').mockImplementationOnce(() => {
      throw new Error('文章库读不动')
    })
    const result = new ArticleContextBuilder().build(ctx('读书遗忘'))
    expect(result.content).toBe('')
    expect(result.priority).toBe(55)
    expect(result.metadata?.itemCount).toBe(0)
    expect(result.metadata?.error).toBe('文章库读不动')
    spy.mockRestore()
  })
})

describe('生词上下文构建器', () => {
  const makeWord = (over: Record<string, unknown> = {}): void => {
    vocabularyDb.create({
      id: 'w1',
      word: 'procrastination',
      phonetic: '/prəkreɪˈsteɪʃn/',
      part_of_speech: 'n.',
      meaning_zh: '拖延',
      example_en: 'Procrastination is the thief of time.',
      example_zh: '拖延是时间的窃贼。',
      source: 'article',
      ...over,
    })
  }

  beforeEach(async () => {
    await setupTestDatabase()
    booksDb.create({ id: 'b1', title: '一本书' })
    makeWord()
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

  it('命中那个词逐栏对账：音标 / 释义 / 例句带中译 / 复习次数', () => {
    const { content } = new VocabularyContextBuilder().build(ctx('procrastination'))
    expect(content).toContain('【procrastination】 /prəkreɪˈsteɪʃn/')
    expect(content).toContain('释义: n. 拖延')
    expect(content).toContain('例句: Procrastination is the thief of time.（拖延是时间的窃贼。）')
    expect(content).toContain('复习过 0 次')
  })

  it('没有音标 / 词性 / 例句 / 级别时对应那几行都不摆', () => {
    vocabularyDb.create({ id: 'w2', word: 'serendipity', meaning_zh: '意外发现珍宝' })
    const { content } = new VocabularyContextBuilder().build(ctx('serendipity'))
    expect(content).toContain('【serendipity】')
    expect(content).toContain('释义: 意外发现珍宝')
    expect(content).not.toContain('例句:')
    expect(content).not.toContain('级别:')
  })

  it('例句有中译才加那对括号；级别与掌握标记照库里的值说', () => {
    vocabularyDb.create({
      id: 'w3',
      word: 'resilience',
      meaning_zh: '韧性',
      example_en: 'Resilience can be trained.',
      cefr_level: 'C1',
    })
    // review_count / is_mastered 由复习通路（updateReviewData）写，create 不接受这两个字段
    getDatabase().run('UPDATE vocabulary SET review_count = 4, is_mastered = 1 WHERE id = ?', ['w3'])
    const { content } = new VocabularyContextBuilder().build(ctx('resilience'))
    expect(content).toContain('例句: Resilience can be trained.')
    expect(content).not.toContain('（）')
    expect(content).toContain('级别: C1')
    expect(content).toContain('复习过 4 次，已标记掌握')
  })

  /*
    夹具说明：BM25 那台会把"人人都有的词"当噪声丢掉（df/文档数 > 0.5 就不参与打分），
    所以造 9 条同名次命中词 + 9 条不相关的，凑成"命中 9 条、上限 8 条"的形状。
  */
  it('一次最多注入八个词', () => {
    for (let i = 0; i < 9; i++) {
      vocabularyDb.create({ id: 'wx' + i, word: 'zzq' + i, meaning_zh: '甲乙丙丁' + i })
    }
    for (let i = 0; i < 9; i++) {
      vocabularyDb.create({ id: 'wy' + i, word: 'qqy' + i, meaning_zh: '戊己庚辛' + i })
    }
    const { content, metadata } = new VocabularyContextBuilder().build(ctx('甲乙丙丁'))
    expect(metadata?.itemCount).toBe(8)
    expect(content.match(/【zzq/g)).toHaveLength(8)
  })

  it('没命中的词不许硬塞，且不带 error 键', () => {
    const result = new VocabularyContextBuilder().build(ctx('今天天气如何'))
    expect(result.content).toBe('')
    expect(result.metadata?.error).toBeUndefined()
  })

  it('库里一个词都没有时不报错、不注入（也没有 error）', () => {
    getDatabase().run('DELETE FROM vocabulary')
    const result = new VocabularyContextBuilder().build(ctx('procrastination'))
    expect(result.content).toBe('')
    expect(result.metadata?.error).toBeUndefined()
  })

  it('读库抛错时必须把原因交出去', () => {
    const spy = vi.spyOn(vocabularyDb, 'getAll').mockImplementationOnce(() => {
      throw new Error('生词库读不动')
    })
    const result = new VocabularyContextBuilder().build(ctx('procrastination'))
    expect(result.content).toBe('')
    expect(result.priority).toBe(45)
    expect(result.metadata?.error).toBe('生词库读不动')
    spy.mockRestore()
  })
})

/**
 * 「构建器不许把失败演成没有数据」的常驻扫描（本批从两路扩到全部）
 *
 * 形状只有一个：`catch (error)` 之后交出的是与"库里没数据"一字不差的结果。
 * 面板因此对用户说「无命中」，而其实是读库炸了。判据：每个 catch 都要把消息
 * 落到 `metadata.error` 上 —— 数 `catch (error)` 与 `error instanceof Error` 的个数。
 *
 * 唯一的豁免是 book-context-builder 的**摘要层内层 catch**：它按设计只降级
 * （读不到摘要不影响用户真正的划线上下文），且已经 `logger.warn` 说了原因。
 * 豁免条目不许空转 —— 下面同时钉住"这本书确实比别的多一个 catch"。
 */
describe('全部构建器的失败都要交出去（源码扫描）', () => {
  const BUILDER_DIR = resolve(process.cwd(), 'electron/agent/builders')
  const EXEMPT: Record<string, string> = {
    'book-context-builder.ts':
      '摘要层是内层 catch：读不到只降级本轮的摘要（外层的划线失败仍然带 metadata.error）',
  }

  const files = readdirSync(BUILDER_DIR).filter((f) => f.endsWith('.ts'))

  it('扫描看得见东西（文件数与豁免数都不是 0 或全部）', () => {
    expect(files.length).toBeGreaterThanOrEqual(6)
    expect(Object.keys(EXEMPT).length).toBeLessThan(files.length)
  })

  for (const file of files) {
    it(`${file}：catch 的数量与交出错误消息的数量对得上`, () => {
      const src = readFileSync(join(BUILDER_DIR, file), 'utf8').replace(/\r\n/g, '\n')
      const catches = (src.match(/catch \(error\) \{/g) ?? []).length
      const reported = (src.match(/error instanceof Error/g) ?? []).length
      if (EXEMPT[file]) {
        // 豁免的理由必须仍然成立：这里恰好比别处多一个 catch，而不是整份都漏
        expect(catches, `${file} 的豁免理由已不成立（catch 数量变了）`).toBe(reported + 1)
      } else {
        expect(catches, `${file} 有 catch 没把错误消息交出去（面板会说成「无命中」）`).toBe(reported)
      }
    })
  }

  it('反证：本批改之前的文章构建器必须被这条扫描判红', () => {
    const before = [
      '    try {',
      "      const articles = articlesDb.getAll(500) as ArticleRow[]",
      '      ...',
      '    } catch (error) {',
      "      logger.error('Failed to build article context', error)",
      '      return empty(0)',
      '    }',
    ].join('\n')
    expect((before.match(/catch \(error\) \{/g) ?? []).length).toBe(1)
    expect((before.match(/error instanceof Error/g) ?? []).length).toBe(0)
  })
})

/** 与卡片 / 方法论那两路同一处理：库里的主键与 NOT NULL 列不留在类型里当"也许没有" */
describe('这两路也不许给主键编兜底 id', () => {
  for (const file of [
    'electron/agent/builders/article-context-builder.ts',
    'electron/agent/builders/vocabulary-context-builder.ts',
  ]) {
    it(`${file}：没有「按行号编 id」的兜底`, () => {
      const src = readFileSync(resolve(process.cwd(), file), 'utf8').replace(/\r\n/g, '\n')
      expect(src).not.toMatch(/\?\?\s*'(article|word)_' \+ index/)
    })
  }

  it('反证：收口前的两种原文都必须被命中', () => {
    expect("const id = a.id ?? 'article_' + index").toMatch(/\?\?\s*'(article|word)_' \+ index/)
    expect("const id = w.id ?? 'word_' + index").toMatch(/\?\?\s*'(article|word)_' \+ index/)
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
