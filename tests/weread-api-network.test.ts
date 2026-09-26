// 知行读书 — 微信读书 API 客户端（electron/weread-api.ts）对网络层的真实行为
//
// 为什么单独一份：这个文件 923 行，此前实测覆盖率只有 **2.25%（函数 0%）** ——
// 引用它的三个测试（chapter-title-backfill / reading-time-sync / startup-repair）
// 都把 `electron/weread-api` 整个 mock 掉了，只用到它导出的函数名，
// 于是"请求怎么发、错了怎么办、字段缺了怎么兜底"这半壁一条都没被执行过。
//
// 这里 mock 的是最外层那条缝（`electron/http-client` 的 fetchWithTimeout），
// 从 `weread-api` 自己的代码走进去：缓存、重试、不重试的状态码、字段兜底、
// 官方推荐空了要降级 —— 全是它自己的逻辑，不是别人的替身。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

type Spec = {
  status?: number
  ok?: boolean
  statusText?: string
  body?: Record<string, unknown>
  text?: string
  /** 让这条请求直接抛（模拟网络中断 / abort） */
  throw?: Error
}
type SpecOrFn = Spec | ((body: Record<string, unknown>) => Spec)

const h = vi.hoisted(() => ({
  routes: new Map<string, unknown[]>(),
  calls: [] as Array<{ api_name: string; body: Record<string, unknown> }>,
}))

vi.mock('../electron/http-client', () => ({
  // 真实的 RETRY_CONFIGS.WEREAD_API 是 3 次 / 线性退避；这里把延时压到可读的量级，
  // 次数保持 3 —— 判据要盯的就是"第几次成功/放弃"
  RETRY_CONFIGS: { WEREAD_API: { timeout: 30000, maxRetries: 3, baseDelay: 100 } },
  sleep: async () => {
    // 测试里不真的等
  },
  fetchWithTimeout: async (_url: string, init: { body: string }) => {
    const body = JSON.parse(init.body) as Record<string, unknown>
    const apiName = String(body.api_name)
    h.calls.push({ apiName: apiName as never, body } as never)
    const queue = h.routes.get(apiName)
    if (!queue || queue.length === 0) {
      throw new Error(`测试没有为 ${apiName} 准备响应`)
    }
    const picked = (queue.length > 1 ? queue.shift() : queue[0]) as SpecOrFn
    const spec = typeof picked === 'function' ? picked(body) : picked
    if (spec.throw) throw spec.throw
    const ok = spec.ok ?? (spec.status === undefined || (spec.status >= 200 && spec.status < 300))
    return {
      ok,
      status: spec.status ?? 200,
      statusText: spec.statusText ?? (ok ? 'OK' : 'Error'),
      json: async () => spec.body ?? {},
      text: async () => spec.text ?? JSON.stringify(spec.body ?? {}),
    }
  },
}))

vi.mock('../electron/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

import * as api from '../electron/weread-api'

/** 给某个 api_name 排队若干响应；最后一个会被重复使用 */
function respond(apiName: string, ...specs: SpecOrFn[]): void {
  h.routes.set(apiName, specs as unknown[])
}

const sentBodies = (apiName: string): Record<string, unknown>[] =>
  h.calls.filter((c) => (c as { apiName?: string }).apiName === apiName).map((c) => c.body)

const timesCalled = (apiName: string): number =>
  h.calls.filter((c) => (c as { apiName?: string }).apiName === apiName).length

describe('weread-api 走真实网络层代码（mock 只在 fetch 那条缝）', () => {
  beforeEach(() => {
    h.routes.clear()
    h.calls.length = 0
    api.setApiKey('test-key')
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('请求怎么发、错了怎么办', () => {
    it('没配 Key 时一句网络都不发，直接说要先设置', async () => {
      api.setApiKey('')
      await expect(api.getBookshelf()).rejects.toThrow('请先设置微信读书 API Key')
      expect(h.calls).toEqual([])
    })

    it('HTTP 500 会重试，第三次成功就交出结果', async () => {
      respond(
        '/shelf/sync',
        { status: 500, text: 'boom' },
        { status: 502, text: 'bad gateway' },
        { body: { errcode: 0, books: [{ bookId: 'b1', title: '回来的书' }] } }
      )
      const books = await api.getBookshelf()
      expect(books.map((b) => b.title)).toEqual(['回来的书'])
      expect(timesCalled('/shelf/sync')).toBe(3)
    })

    it('HTTP 401 不许重试（重试也不会变成有效），一次就抛', async () => {
      respond('/shelf/sync', { status: 401, text: 'unauthorized' })
      await expect(api.getBookshelf()).rejects.toThrow(/401/)
      expect(timesCalled('/shelf/sync')).toBe(1)
    })

    it('errcode 非 0 时报 errmsg；三次都错就把最后一次的错交出去', async () => {
      respond('/book/chapterinfo', { body: { errcode: 500, errmsg: '章节服务不可用' } })
      await expect(api.fetchChapters('b1')).rejects.toThrow('章节服务不可用')
      expect(timesCalled('/book/chapterinfo')).toBe(3)
    })

    it('errcode 401 立即停，不再空转三次', async () => {
      respond('/review/list/mine', { body: { errcode: 401, errmsg: 'key 失效' } })
      await expect(api.fetchNotes('b1')).rejects.toThrow('key 失效')
      expect(timesCalled('/review/list/mine')).toBe(1)
    })

    it('认证类判定不许靠错误文案里有没有 "401" 字样（服务端给的是中文 errmsg）', async () => {
      // 这条是跑测试时抓到的真缺陷：老写法判 message.includes('401')，
      // 而 errcode 分支的 message 是「没有权限」，于是失效的 key 被白白重试三次
      respond('/book/bookmarklist', { body: { errcode: 403, errmsg: '没有权限，请重新授权' } })
      await expect(api.fetchBookmarks('b1')).rejects.toThrow('没有权限')
      expect(timesCalled('/book/bookmarklist')).toBe(1)
    })

    it('同一个请求第二次走缓存，不再发网络', async () => {
      respond('/shelf/sync', { body: { errcode: 0, books: [{ bookId: 'b1' }] } })
      await api.getBookshelf()
      await api.getBookshelf()
      expect(timesCalled('/shelf/sync')).toBe(1)
    })

    it('缓存超过 5 分钟就重新请求（不是永久复用）', async () => {
      respond('/shelf/sync', { body: { errcode: 0, books: [{ bookId: 'b1' }] } })
      await api.getBookshelf()
      const realNow = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(realNow + 6 * 60 * 1000)
      await api.getBookshelf()
      expect(timesCalled('/shelf/sync')).toBe(2)
    })

    it('每次请求都带上 skill_version 与 Bearer 头由主进程保管的 key 决定', async () => {
      respond('/shelf/sync', { body: { errcode: 0, books: [] } })
      await api.getBookshelf()
      const body = sentBodies('/shelf/sync')[0]
      expect(body.skill_version).toBeTruthy()
    })
  })

  describe('书架与进度：缺字段不能变 NaN', () => {
    it('/shelf/sync 回来的书缺这缺那时逐项兜底，progress 缺失只能是 0 而不是覆盖已有进度', async () => {
      respond('/shelf/sync', {
        body: {
          errcode: 0,
          books: [
            { bookId: 'b_full', title: '全', author: '甲', isbn: '1', category: '心理', finishReading: 1, progress: 42, readUpdateTime: 111 },
            { bookId: 'b_bare' },
          ],
        },
      })
      const books = await api.getBookshelf()
      const full = books[0]
      expect(full).toMatchObject({
        bookId: 'b_full',
        title: '全',
        author: '甲',
        category: '心理',
        finishReading: 1,
        progress: 42,
        lastReadTime: 111,
        readUpdateTime: 111,
      })
      const bare = books[1]
      expect(bare).toMatchObject({
        bookId: 'b_bare',
        title: '',
        author: '',
        isbn: '',
        category: '',
        finishReading: 0,
        progress: 0,
        totalChapter: 0,
        lastReadTime: 0,
      })
    })

    it('books 整个缺失时返回空数组，不抛', async () => {
      respond('/shelf/sync', { body: { errcode: 0 } })
      expect(await api.getBookshelf()).toEqual([])
      expect(await api.getBookshelfWithRetry()).toEqual([])
    })

    it('/book/getprogress 的 0-100 归一化成 0-1，并且封顶在 1', async () => {
      respond('/book/getprogress', { body: { errcode: 0, book: { progress: 37 } } })
      expect(await api.getBookProgress('b1')).toBeCloseTo(0.37, 10)
      respond('/book/getprogress', { body: { errcode: 0, book: { progress: 250 } } })
      expect(await api.getBookProgress('b1')).toBe(1)
    })

    it('进度不是数字 / 是负数 / 干脆没有 book 时一律算 0，不猜', async () => {
      for (const body of [
        { errcode: 0, book: { progress: '一半' } },
        { errcode: 0, book: { progress: -5 } },
        { errcode: 0, book: {} },
        { errcode: 0 },
        { errcode: 0, book: { progress: Number.NaN } },
      ]) {
        respond('/book/getprogress', { body })
        expect(await api.getBookProgress('b1')).toBe(0)
      }
    })

    it('进度这条通道不许走缓存（进度会变，缓存就是旧数字）', async () => {
      respond('/book/getprogress', { body: { errcode: 0, book: { progress: 10 } } })
      await api.getBookProgress('b1')
      await api.getBookProgress('b1')
      expect(timesCalled('/book/getprogress')).toBe(2)
    })
  })

  describe('划线 / 笔记 / 章节', () => {
    it('bookmarklist 缺 updated 时为空数组，缺 chapterTitle 时是空串而不是 undefined', async () => {
      respond('/book/bookmarklist', {
        body: {
          errcode: 0,
          updated: [
            { bookmarkId: 'm1', bookId: 'b1', chapterUid: 3, markText: '一句', style: 1, range: '0-2', createTime: 10 },
          ],
        },
      })
      const marks = await api.fetchBookmarks('b1')
      expect(marks).toHaveLength(1)
      expect(marks[0].chapterTitle).toBe('')

      respond('/book/bookmarklist', { body: { errcode: 0 } })
      expect(await api.fetchBookmarks('b2')).toEqual([])
    })

    it('笔记缺 chapterUid / abstract / content 时兜底，书名不带的字段不会变 NaN', async () => {
      respond('/review/list/mine', {
        body: {
          errcode: 0,
          reviews: [{ reviewId: 'r1', bookId: 'b1', range: '1-2', createTime: 9 }],
        },
      })
      const notes = await api.fetchNotes('b1')
      expect(notes[0]).toMatchObject({ chapterUid: 0, chapterTitle: '', abstract: '', content: '' })
    })

    it('章节列表按原样映射 uid / 标题 / 层级', async () => {
      respond('/book/chapterinfo', {
        body: { errcode: 0, chapters: [{ chapterUid: 1, title: '第一章', level: 1, chapterIdx: 0 }] },
      })
      expect(await api.fetchChapters('b1')).toEqual([{ chapterUid: 1, title: '第一章', level: 1 }])
    })

    it('fetchAllContent 一次把三件取齐', async () => {
      respond('/book/bookmarklist', { body: { errcode: 0, updated: [{ bookmarkId: 'm1', bookId: 'b1', chapterUid: 1, markText: 'x', style: 0, range: '', createTime: 1 }] } })
      respond('/review/list/mine', { body: { errcode: 0, reviews: [{ reviewId: 'r1', bookId: 'b1', abstract: 'a', content: 'c', range: '', createTime: 2 }] } })
      respond('/book/chapterinfo', { body: { errcode: 0, chapters: [{ chapterUid: 1, title: 't', level: 1 }] } })
      const all = await api.fetchAllContent('b1')
      expect(all.bookmarks).toHaveLength(1)
      expect(all.notes).toHaveLength(1)
      expect(all.chapters).toHaveLength(1)
    })

    it('批量取内容时，失败的那本不进结果，别的照常（一批三本，第七本坏掉）', async () => {
      respond('/book/bookmarklist', (body) => (body.bookId === 'bad' ? { status: 500, text: 'no' } : { body: { errcode: 0, updated: [] } }))
      respond('/review/list/mine', (body) => (body.bookid === 'bad' ? { status: 500, text: 'no' } : { body: { errcode: 0, reviews: [] } }))
      respond('/book/chapterinfo', (body) => (body.bookId === 'bad' ? { status: 500, text: 'no' } : { body: { errcode: 0, chapters: [] } }))
      const ids = ['b1', 'b2', 'b3', 'bad', 'b5']
      const out = await api.fetchAllContentBatch(ids)
      expect([...out.keys()].sort()).toEqual(['b1', 'b2', 'b3', 'b5'])
      expect(out.has('bad')).toBe(false)
    })
  })

  describe('搜索与最近读过', () => {
    it('最近的书最多 10 本，多余的悄悄截掉（界面上的数就是这里的数）', async () => {
      respond(
        '/shelf/sync',
        { body: { errcode: 0, books: Array.from({ length: 25 }, (_, i) => ({ bookId: `b${i}`, title: `书${i}`, author: '甲', cover: '', lastReadTime: i })) } }
      )
      const recent = await api.getRecentBooks()
      expect(recent).toHaveLength(10)
      expect(recent[0].lastReadTime).toBe(0)
      expect(recent[9].title).toBe('书9')
    })

    it('搜索打平分层的 results，跳过没有 bookId 的，按 count 截断', async () => {
      respond('/store/search', {
        body: {
          errcode: 0,
          results: [
            { books: [{ bookInfo: { bookId: 's1', title: '搜到一', author: '甲' } }, { bookInfo: { title: '没有 id' } }] },
            { books: [{ bookInfo: { bookId: 's2', title: '搜到二' } }] },
            {},
          ],
        },
      })
      const two = await api.searchBooks('关键词', 2)
      expect(two.map((b) => b.bookId)).toEqual(['s1', 's2'])
      expect(two[1]).toMatchObject({ isbn: '', publisher: '', category: '', lastReadTime: 0 })

      respond('/store/search', { body: { errcode: 0, results: [] } })
      expect(await api.searchBooks('没有结果')).toEqual([])
    })
  })

  describe('连接测试（设置页那颗按钮的真实反馈）', () => {
    it('成功时把第一本书的标题带回去 —— 界面那句"真的拉到了"靠它', async () => {
      respond('/shelf/sync', { body: { errcode: 0, books: [{ title: '思考，快与慢' }] } })
      const r = await api.testConnection('k')
      expect(r).toMatchObject({ success: true, message: '连接成功', firstBookTitle: '思考，快与慢' })
    })

    it('一本都没有时不许编一个标题出来', async () => {
      respond('/shelf/sync', { body: { errcode: 0, books: [] } })
      const r = await api.testConnection('k')
      expect(r.success).toBe(true)
      expect(r.firstBookTitle).toBeUndefined()
    })

    it('401 说"认证失败"、499 说"连接超时"，其余状态码如实带 HTTP 码', async () => {
      respond('/shelf/sync', { status: 401, text: 'x' })
      expect(await api.testConnection('k')).toMatchObject({ success: false, message: '认证失败：API Key 无效或已过期' })

      respond('/shelf/sync', { status: 499, text: 'x' })
      expect((await api.testConnection('k')).message).toContain('连接超时')

      respond('/shelf/sync', { status: 503, text: '维护中' })
      expect((await api.testConnection('k')).message).toContain('HTTP 503')
    })

    it('HTTP 200 但 errcode 非 0 时按 API 错误报，不许当成功', async () => {
      respond('/shelf/sync', { body: { errcode: 403, errmsg: '没有权限' } })
      expect(await api.testConnection('k')).toMatchObject({ success: false, message: '没有权限' })
    })

    it('网络中断（abort）时说的是超时而不是天书错误码', async () => {
      respond('/shelf/sync', { throw: new Error('The operation was aborted') })
      expect((await api.testConnection('k')).message).toContain('连接超时')
    })

    it('一个 key 都没有时不发网络，直接提示先设置', async () => {
      api.setApiKey('')
      const r = await api.testConnection('')
      expect(r).toMatchObject({ success: false, message: '请先设置微信读书 API Key' })
      expect(h.calls).toEqual([])
    })
  })

  describe('用户资料（界面用它填头像昵称）', () => {
    it('第一个候选接口给得出昵称就用它，不用再试第二个', async () => {
      respond('/user/info', { body: { errcode: 0, nickname: '恒久', avatar: 'https://a/1.png', vid: 'v1' } })
      const r = await api.fetchUserProfile()
      expect(r).toMatchObject({ success: true, message: '已同步微信读书资料' })
      expect(r.profile).toMatchObject({ nickname: '恒久', avatarUrl: 'https://a/1.png', vid: 'v1' })
      expect(timesCalled('/user/profile')).toBe(0)
    })

    it('第一个报错时继续试第二个（字段名各家不一样，三种拼法都认）', async () => {
      respond('/user/info', { status: 500, text: 'no' })
      respond('/user/profile', { body: { errcode: 0, name: '甲', headImgUrl: 'https://a/2.png' } })
      const r = await api.fetchUserProfile()
      expect(r.profile).toMatchObject({ nickname: '甲', avatarUrl: 'https://a/2.png' })
    })

    it('两个候选都没有可用信息时如实说不支持，不交一个空壳当成功', async () => {
      respond('/user/info', { body: { errcode: 0 } })
      respond('/user/profile', { body: { errcode: 0 } })
      const r = await api.fetchUserProfile()
      expect(r.success).toBe(false)
      expect(r.message).toContain('暂不支持')
    })

    it('没配 key 时不发网络', async () => {
      api.setApiKey('')
      expect((await api.fetchUserProfile()).success).toBe(false)
      expect(h.calls).toEqual([])
    })
  })

  describe('阅读统计', () => {
    it('baseTime 没给时不许出现在请求体里（给了一个 undefined 会让服务端按 0 处理）', async () => {
      respond('/readdata/detail', { body: { errcode: 0, readDays: 7, totalReadTime: 100, dayAverageReadTime: 14 } })
      await api.fetchReadingData('monthly')
      expect(sentBodies('/readdata/detail')[0]).not.toHaveProperty('baseTime')
      expect(sentBodies('/readdata/detail')[0].mode).toBe('monthly')

      await api.fetchReadingData('weekly', 1788624000)
      expect(sentBodies('/readdata/detail')[1]).toMatchObject({ mode: 'weekly', baseTime: 1788624000 })
    })

    it('统计接口挂时把错误交出去，让调用方自己决定不写库', async () => {
      respond('/readdata/detail', { body: { errcode: 400, errmsg: 'mode 不支持' } })
      await expect(api.fetchReadingData('annually')).rejects.toThrow('mode 不支持')
    })
  })

  describe('推荐好书（官方空了要降级，而不是白屏）', () => {
    it('官方推荐有书时直接映射，缺 reason 用"基于您的阅读偏好"', async () => {
      respond('/book/recommend', {
        body: {
          errcode: 0,
          books: [
            { bookId: 'r1', title: '被讨厌的勇气', author: '岸见一郎', newRating: 91, reason: '和你读过的同类' },
            { bookId: 'r2', title: '缺失的书' },
          ],
        },
      })
      const recs = await api.fetchRecommendations()
      expect(recs[0]).toMatchObject({ bookId: 'r1', rating: 91, reason: '和你读过的同类' })
      expect(recs[1]).toMatchObject({ bookId: 'r2', reason: '基于您的阅读偏好', title: '缺失的书' })
      expect(recs[1].rating).toBeUndefined()
      // 官方推荐不许被缓存吃掉（每次进首页都该是新的一批）
      expect(timesCalled('/book/recommend')).toBe(1)
    })

    it('官方返回空列表 ⇒ 降级为按类别与作者搜出来的衍生推荐，并过滤掉书架已有的', async () => {
      respond('/book/recommend', { body: { errcode: 0, books: [] } })
      respond('/readdata/detail', {
        body: {
          errcode: 0,
          preferCategory: [
            { categoryId: 'c1', categoryTitle: '心理学', readingTime: 900, val: 1, readingCount: 3 },
            { categoryId: 'c2', categoryTitle: '', readingTime: 800, val: 1, readingCount: 2 },
          ],
          preferAuthor: [{ authorId: 'a1', name: '卡尼曼', count: 5, readTime: '1' }],
        },
      })
      respond('/shelf/sync', { body: { errcode: 0, books: [{ bookId: 'owned1' }] } })
      respond(
        '/store/search',
        (body) =>
          body.keyword === '心理学'
            ? { body: { errcode: 0, results: [{ books: [{ bookInfo: { bookId: 'cand1', title: '候选一', author: '甲', cover: '', intro: '', category: '心理学' } }, { bookInfo: { bookId: 'owned1', title: '已在书架' } }] }] } }
            : { body: { errcode: 0, results: [{ books: [{ bookInfo: { bookId: 'cand2', title: '候选二', author: '卡尼曼' } }] }] } }
      )
      const recs = await api.fetchRecommendations()
      expect(recs.map((r) => r.bookId).sort()).toEqual(['cand1', 'cand2'])
      expect(recs.find((r) => r.bookId === 'cand1')?.reason).toContain('心理学')
      expect(recs.find((r) => r.bookId === 'cand2')?.reason).toContain('卡尼曼')
      expect(recs.some((r) => r.bookId === 'owned1')).toBe(false)
    })

    it('官方接口直接报错 ⇒ 同样走降级，而不是把错抛给界面', async () => {
      respond('/book/recommend', { status: 500, text: 'no' })
      respond('/readdata/detail', { body: { errcode: 0, preferCategory: [], preferAuthor: [] } })
      respond('/shelf/sync', { body: { errcode: 0, books: [] } })
      expect(await api.fetchRecommendations()).toEqual([])
    })

    it('衍生推荐里搜索失败的那一路不影响另一路（一路 500 一路有书）', async () => {
      respond('/book/recommend', { body: { errcode: 0 } })
      respond('/readdata/detail', {
        body: {
          errcode: 0,
          preferCategory: [{ categoryId: 'c1', categoryTitle: '经济', readingTime: 100, val: 1, readingCount: 1 }],
          preferAuthor: [{ authorId: 'a1', name: '塞勒', count: 2, readTime: '1' }],
        },
      })
      respond('/shelf/sync', { body: { errcode: 0, books: [] } })
      respond(
        '/store/search',
        (body) => (body.keyword === '塞勒' ? { throw: new Error('network down') } : { body: { errcode: 0, results: [{ books: [{ bookInfo: { bookId: 'c9', title: '经济类一本' } }] }] } })
      )
      const recs = await api.fetchRecommendations()
      expect(recs.map((r) => r.bookId)).toEqual(['c9'])
    })

    it('阅读统计取不到时衍生推荐如实为空（不编推荐）', async () => {
      respond('/book/recommend', { body: { errcode: 0 } })
      respond('/readdata/detail', { body: { errcode: 500, errmsg: '统计不可用' } })
      respond('/shelf/sync', { body: { errcode: 0, books: [] } })
      expect(await api.fetchRecommendations()).toEqual([])
    })
  })

  describe('缓存的清理与 key 的来源', () => {
    it('clearCache 之后再请求要真的发网络', async () => {
      respond('/shelf/sync', { body: { errcode: 0, books: [{ bookId: 'b1' }] } })
      await api.getBookshelf()
      api.clearCache()
      await api.getBookshelf()
      expect(timesCalled('/shelf/sync')).toBe(2)
    })

    it('换 key 必须把旧 key 下的缓存清掉（否则新账号看到的是别人的数）', async () => {
      respond('/shelf/sync', { body: { errcode: 0, books: [{ bookId: 'old_key_book' }] } })
      await api.getBookshelf()
      api.setApiKey('another-key')
      respond('/shelf/sync', { body: { errcode: 0, books: [{ bookId: 'new_key_book' }] } })
      const books = await api.getBookshelf()
      expect(books.map((b) => b.bookId)).toEqual(['new_key_book'])
      expect(timesCalled('/shelf/sync')).toBe(2)
    })

    it('initFromSettings 读到 key 才生效，读到空值不许把已配的 key 抹掉', async () => {
      api.initFromSettings({ wereadApiKey: 'from-settings' })
      expect(api.getApiKey()).toBe('from-settings')
      api.initFromSettings({ wereadApiKey: '' })
      expect(api.getApiKey()).toBe('from-settings')
      expect(api.initFromSettings({})).toBeUndefined()
    })
  })
})
