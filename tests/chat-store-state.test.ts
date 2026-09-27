// @vitest-environment happy-dom
//
// chatStore 状态与通路测试 —— 会话读写、重新生成、流式控制、点赞收藏
//
// 为什么单独一个文件：`chat-store.test.ts` 只盯了「助手消息带上意图与引用来源」那一条链
// （2026-09-16 的实测缺陷），store 另外 16 个函数一条没走过 —— 实测 functions 23.81%。
// 判据仍然是"最外那条缝"：只伪造 `window.electronAPI`（渲染层与主进程之间唯一的边界），
// 分词、映射、计数、乐观更新与回滚全部走 store 自己的代码。
//
// 每个用例重新 import 一次 store：模块级 `activeStreamStop` 是流式控制句柄，
// 上一条用例没跑完的流会留一个句柄给下一条 —— 那会让 stopStreaming 打到已经结束的会话上。

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { BookmarkedMessageRow, RagSourceRef } from '../src/shared/types'
import type { ChatMessageRow, ConversationRow } from '../src/renderer/src/utils/db-mapper'

type Store = typeof import('../src/renderer/src/stores/chatStore').useChatStore

/** 重新 import 一份干净的 store（连带清掉模块级的流式句柄） */
async function freshStore(): Promise<Store> {
  vi.resetModules()
  const mod = await import('../src/renderer/src/stores/chatStore')
  return mod.useChatStore
}

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0))

const RAG: RagSourceRef = {
  highlightId: 'hl_1',
  bookId: 'b1',
  bookTitle: '认知觉醒',
  chapterTitle: '第一章',
  content: '元认知就是对自己的思考过程进行思考',
  relevanceScore: 0.9,
}

function convRow(over: Partial<ConversationRow> = {}): ConversationRow {
  return {
    id: 'c1',
    title: '新对话',
    book_id: null,
    created_at: '2026-09-27 10:00:00',
    updated_at: '2026-09-27 10:00:00',
    message_count: 0,
    history_summary: null,
    ...over,
  }
}

function msgRow(over: Partial<ChatMessageRow> = {}): ChatMessageRow {
  return {
    id: 'm1',
    conversation_id: 'c1',
    role: 'assistant',
    content: '回答',
    intent: null,
    tools_used: null,
    bloom_level: null,
    mastery_assessment: null,
    sources: null,
    liked: 0,
    bookmarked: 0,
    created_at: '2026-09-27 10:00:00',
    ...over,
  }
}

interface StreamApi {
  addMessage: ReturnType<typeof vi.fn>
  deleteMessage: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
  getAll: ReturnType<typeof vi.fn>
  getMessages: ReturnType<typeof vi.fn>
  getBookmarked: ReturnType<typeof vi.fn>
  clearHistory: ReturnType<typeof vi.fn>
  toggleLike: ReturnType<typeof vi.fn>
  toggleBookmark: ReturnType<typeof vi.fn>
  streamChatWithContext: ReturnType<typeof vi.fn>
  cancelStream: ReturnType<typeof vi.fn>
  /** 手动推流：测试自己决定什么时候来 chunk、什么时候完成 */
  push: {
    chunk: (text: string) => void
    reasoning: (text: string) => void
    error: (msg: string) => void
    complete: () => void
    retrievalStart: () => void
    retrievalDone: (over?: { intent?: string; ragSources?: RagSourceRef[] | null }) => void
  }
  /** 五个监听器被注销的次数（settle 之后不该再留订阅） */
  unsubscribed: () => number
  tokenBroadcasts: () => number
  /** deferAssistantSave 时用来放行那次助手消息落库 */
  releaseSave: () => void
}

function installApi(
  over: {
    conversations?: ConversationRow[]
    messages?: ChatMessageRow[]
    addMessageFails?: boolean
    /** 只让助手那条写不进去（用户那条照常） */
    assistantSaveFails?: boolean
    /** 助手落库挂住不返回，用来试"完成与停止抢在同一刻" */
    deferAssistantSave?: boolean
    /** 通道交回空 id 的会话行（守卫那条支路） */
    createReturns?: ConversationRow
    createFails?: boolean
    deleteMessageFails?: boolean
    deleteFails?: boolean
    streamFails?: Error
    getBookmarkedValue?: BookmarkedMessageRow[] | unknown
    clearHistoryFails?: boolean
  } = {},
): StreamApi {
  const listeners: Record<string, ((...args: never[]) => void) | undefined> = {}
  const unsubs: Array<ReturnType<typeof vi.fn>> = []
  const sub = () => {
    const off = vi.fn(() => {})
    unsubs.push(off)
    return off
  }
  let broadcasts = 0
  const onBroadcast = () => {
    broadcasts++
  }
  window.addEventListener('token-usage:updated', onBroadcast)

  // 与 renderer.d.ts 的签名逐字对齐：不写签名的话 mock.calls 的元素类型靠 as 撑，
  // 测试自己也盯不住传参对不对
  let releaseSave: () => void = () => {}
  const saveGate = new Promise<void>(resolve => {
    releaseSave = resolve
  })
  const addMessage = vi.fn(
    async (
      conversationId: string,
      message: { role: string; content: string; intent?: string; sources?: RagSourceRef[] },
    ) => {
      if (over.addMessageFails || (over.assistantSaveFails && message.role === 'assistant')) {
        throw new Error('写库失败')
      }
      if (over.deferAssistantSave && message.role === 'assistant') await saveGate
      return 'msg_from_db'
    },
  )
  const deleteMessage = vi.fn(async (_id: string) => {
    if (over.deleteMessageFails) throw new Error('删不掉')
  })
  const create = vi.fn(async (_title?: string, bookId?: string) => {
    if (over.createFails) throw new Error('建会话失败')
    return over.createReturns ?? convRow({ id: 'c_new', book_id: bookId ?? null })
  })
  const getAll = vi.fn(async () => over.conversations ?? [])
  const getMessages = vi.fn(async (_id: string) => over.messages ?? [])
  const getBookmarked = vi.fn(
    async (_limit?: number) =>
      ('getBookmarkedValue' in over ? over.getBookmarkedValue : []) as BookmarkedMessageRow[],
  )
  const clearHistory = vi.fn(async () => {
    if (over.clearHistoryFails) throw new Error('清不掉')
    return { success: true }
  })
  const del = vi.fn(async (_id: string) => {
    if (over.deleteFails) throw new Error('删不掉会话')
  })
  const toggleLike = vi.fn(async (_id: string, _liked: boolean) => {})
  const toggleBookmark = vi.fn(async (_id: string, _marked: boolean) => {})
  const streamChatWithContext = vi.fn(async () => {
    if (over.streamFails) throw over.streamFails
  })
  const cancelStream = vi.fn(async () => ({ aborted: true }))

  Object.defineProperty(window, 'electronAPI', {
    value: {
      ai: {
        streamChatWithContext,
        cancelStream,
        onStreamChunk: (cb: (c: string) => void) => {
          listeners.chunk = cb as (...args: never[]) => void
          return sub()
        },
        onStreamReasoningChunk: (cb: (c: string) => void) => {
          listeners.reasoning = cb as (...args: never[]) => void
          return sub()
        },
        onStreamError: (cb: (e: string) => void) => {
          listeners.error = cb as (...args: never[]) => void
          return sub()
        },
        onStreamComplete: (cb: () => void) => {
          listeners.complete = cb as (...args: never[]) => void
          return sub()
        },
        onRetrievalStatus: (cb: (s: never) => void) => {
          listeners.retrieval = cb
          return sub()
        },
      },
      conversation: {
        addMessage,
        deleteMessage,
        create,
        getAll,
        getMessages,
        getBookmarked,
        delete: del,
      },
      chat: { toggleLike, toggleBookmark },
      system: { clearHistory },
    } as never,
    writable: true,
    configurable: true,
  })

  return {
    addMessage,
    deleteMessage,
    create,
    getAll,
    getMessages,
    getBookmarked,
    clearHistory,
    toggleLike,
    toggleBookmark,
    streamChatWithContext,
    cancelStream,
    push: {
      chunk: (text) => listeners.chunk?.(text as never),
      reasoning: (text) => listeners.reasoning?.(text as never),
      error: (msg) => listeners.error?.(msg as never),
      complete: () => listeners.complete?.(),
      retrievalStart: () =>
        listeners.retrieval?.({ stage: 'start' } as never),
      retrievalDone: (o) =>
        listeners.retrieval?.({
          stage: 'done',
          sources: [],
          intent: o?.intent ?? 'knowledge_query',
          ragSources: o && 'ragSources' in o ? o.ragSources : [RAG],
        } as never),
    },
    unsubscribed: () => unsubs.filter((f) => f.mock.calls.length > 0).length,
    tokenBroadcasts: () => broadcasts,
    releaseSave: () => releaseSave(),
  }
}

/** 会话列表与流式都用得到的公共前置 */
async function setup(over?: Parameters<typeof installApi>[0]) {
  const store = await freshStore()
  store.setState({
    sessions: [],
    currentSessionId: null,
    messages: [],
    loading: false,
    streaming: false,
    streamingContent: '',
    streamingReasoning: '',
    reasoningStartTime: null,
    error: null,
    currentBookId: null,
    practiceMethodologyId: null,
    enableReasoning: false,
    retrieval: null,
    bookmarkedMessages: [],
  })
  return { store, api: installApi(over) }
}

describe('chatStore — 会话的读与写', () => {
  it('loadSessions 把库里的原始行过一遍映射器（下划线列 → 驼峰，book_id 的 null → 空串）', async () => {
    const { store, api } = await setup({
      conversations: [convRow({ id: 'c1', message_count: 3 }), convRow({ id: 'c2', book_id: 'b7' })],
    })
    await store.getState().loadSessions()
    expect(api.getAll).toHaveBeenCalledTimes(1)
    expect(store.getState().sessions).toEqual([
      expect.objectContaining({ id: 'c1', messageCount: 3, bookId: '' }),
      expect.objectContaining({ id: 'c2', bookId: 'b7' }),
    ])
  })

  it('没有 electronAPI.conversation 时 loadSessions 直接返回，不抛、也不把已有列表清空', async () => {
    const store = await freshStore()
    delete (window as unknown as { electronAPI?: unknown }).electronAPI
    store.setState({ sessions: [convView('c1')] })
    await expect(store.getState().loadSessions()).resolves.toBeUndefined()
    expect(store.getState().sessions.map(s => s.id)).toEqual(['c1'])
  })

  it('loadSessions 读库失败只记日志：error 不动、旧列表留着（加载失败不该被演成"没有会话"）', async () => {
    const store = await freshStore()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    Object.defineProperty(window, 'electronAPI', {
      value: { conversation: { getAll: async () => { throw new Error('库锁了') } } },
      writable: true,
      configurable: true,
    })
    store.setState({ sessions: [convView('c1')] })
    await store.getState().loadSessions()
    expect(store.getState().error).toBeNull()
    expect(store.getState().sessions.map(s => s.id)).toEqual(['c1'])
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('createSession：新会话排最前、成为当前会话、消息清空，bookId 原样透传', async () => {
    const { store, api } = await setup()
    store.setState({ sessions: [convView('c_old')], messages: [{ role: 'user', content: '旧消息' }] })
    await store.getState().createSession('b9')
    expect(api.create).toHaveBeenCalledWith(undefined, 'b9')
    const s = store.getState()
    expect(s.sessions.map(x => x.id)).toEqual(['c_new', 'c_old'])
    expect(s.currentSessionId).toBe('c_new')
    expect(s.messages).toEqual([])
  })

  it('createSession 失败：写 error 且列表一字未动', async () => {
    const { store } = await setup({ createFails: true })
    store.setState({ sessions: [convView('c_old')] })
    await store.getState().createSession()
    expect(store.getState().error).toBe('建会话失败')
    expect(store.getState().sessions.map(x => x.id)).toEqual(['c_old'])
  })

  it('switchSession：消息过映射器（JSON 文本列解析、0/1 转布尔、空 intent 变 undefined），书的关联跟着会话走', async () => {
    const { store } = await setup({
      conversations: [convRow({ id: 'c1', book_id: 'b5' })],
      messages: [
        msgRow({
          id: 'm1',
          role: 'user',
          content: '提问',
          intent: '',
          liked: 1,
          sources: JSON.stringify([RAG]),
          mastery_assessment: '{坏 JSON',
        }),
        msgRow({ id: 'm2', bookmarked: 1 }),
      ],
    })
    await store.getState().loadSessions()
    await store.getState().switchSession('c1')
    const s = store.getState()
    expect(s.currentSessionId).toBe('c1')
    expect(s.currentBookId).toBe('b5')
    expect(s.messages[0]).toMatchObject({
      id: 'm1',
      role: 'user',
      liked: true,
      bookmarked: false,
      sources: [RAG],
    })
    expect(s.messages[0].intent).toBeUndefined()
    expect(s.messages[0].masteryAssessment).toBeUndefined()
    expect(s.messages[1].bookmarked).toBe(true)
  })

  it('switchSession 切到不在列表里的会话：currentBookId 归 null，不留上一本', async () => {
    const { store } = await setup({ conversations: [convRow({ id: 'c1', book_id: 'b5' })] })
    await store.getState().loadSessions()
    await store.getState().switchSession('c1')
    await store.getState().switchSession('ghost')
    expect(store.getState().currentBookId).toBeNull()
  })

  it('switchSession 读消息失败：写 error，不动当前会话与消息', async () => {
    const store = await freshStore()
    Object.defineProperty(window, 'electronAPI', {
      value: { conversation: { getMessages: async () => { throw new Error('读不到') } } },
      writable: true,
      configurable: true,
    })
    store.setState({ messages: [{ role: 'user', content: '留着' }] })
    await store.getState().switchSession('cX')
    expect(store.getState().error).toBe('读不到')
    expect(store.getState().messages.map(m => m.content)).toEqual(['留着'])
  })

  it('deleteSession 删的是当前会话：列表少一条、当前会话与消息清空', async () => {
    const store = await freshStore()
    const del = vi.fn(async () => {})
    Object.defineProperty(window, 'electronAPI', {
      value: { conversation: { delete: del } },
      writable: true,
      configurable: true,
    })
    store.setState({
      sessions: [convView('c1'), convView('c2')],
      currentSessionId: 'c1',
      messages: [{ role: 'user', content: 'x' }],
    })
    await store.getState().deleteSession('c1')
    expect(del).toHaveBeenCalledWith('c1')
    const s = store.getState()
    expect(s.sessions.map(x => x.id)).toEqual(['c2'])
    expect(s.currentSessionId).toBeNull()
    expect(s.messages).toEqual([])
  })

  it('deleteSession 删的不是当前会话：当前会话与消息一个字都不动', async () => {
    const store = await freshStore()
    Object.defineProperty(window, 'electronAPI', {
      value: { conversation: { delete: vi.fn(async () => {}) } },
      writable: true,
      configurable: true,
    })
    store.setState({
      sessions: [convView('c1'), convView('c2')],
      currentSessionId: 'c1',
      messages: [{ role: 'user', content: '还开着' }],
    })
    await store.getState().deleteSession('c2')
    const s = store.getState()
    expect(s.sessions.map(x => x.id)).toEqual(['c1'])
    expect(s.currentSessionId).toBe('c1')
    expect(s.messages.map(m => m.content)).toEqual(['还开着'])
  })

  it('deleteSession 失败：写 error，列表与当前会话都不动（报错不等于删成了）', async () => {
    const { store } = await setup({ deleteFails: true })
    store.setState({
      sessions: [convView('c1'), convView('c2')],
      currentSessionId: 'c1',
      messages: [{ role: 'user', content: '还开着' }],
    })
    await store.getState().deleteSession('c1')
    const s = store.getState()
    expect(s.error).toBe('删不掉会话')
    expect(s.sessions.map(x => x.id)).toEqual(['c1', 'c2'])
    expect(s.currentSessionId).toBe('c1')
  })

  it('clearAllSessions 走单事务通道一次清完；通道失败时本地列表原样留着（本地清空必须排在库清成功之后）', async () => {
    const ok = await setup()
    ok.store.setState({ sessions: [convView('c1')], currentSessionId: 'c1', messages: [{ role: 'user', content: 'x' }] })
    await ok.store.getState().clearAllSessions()
    expect(ok.api.clearHistory).toHaveBeenCalledTimes(1)
    expect(ok.store.getState().sessions).toEqual([])

    const bad = await setup({ clearHistoryFails: true })
    bad.store.setState({ sessions: [convView('c1')], currentSessionId: 'c1', messages: [] })
    await expect(bad.store.getState().clearAllSessions()).rejects.toThrow('清不掉')
    expect(bad.store.getState().sessions.map(x => x.id)).toEqual(['c1'])
  })
})

describe('chatStore — 发送', () => {
  it('没有当前会话时先发问再建会话，会话带着当前书', async () => {
    const { store, api } = await setup()
    store.setState({ currentBookId: 'b3' })
    const done = store.getState().sendMessage('第一个问题')
    await flush()
    api.push.retrievalDone()
    api.push.chunk('答案')
    api.push.complete()
    await done
    expect(api.create).toHaveBeenCalledWith(undefined, 'b3')
    expect(store.getState().currentSessionId).toBe('c_new')
    expect(store.getState().messages.map(m => m.role)).toEqual(['user', 'assistant'])
  })

  it('建会话失败：写 error，且一条消息都不往库里写（不许拿 null 会话 id 继续）', async () => {
    const { store, api } = await setup({ createFails: true })
    await store.getState().sendMessage('发不出去')
    expect(store.getState().error).toBe('建会话失败')
    expect(api.addMessage).not.toHaveBeenCalled()
    expect(api.streamChatWithContext).not.toHaveBeenCalled()
  })

  it('通道交回的会话行没有 id：当场停下说「创建会话失败」，不拿空 id 往下写', async () => {
    const { store, api } = await setup({ createReturns: convRow({ id: '' }) })
    await store.getState().sendMessage('没有会话可用')
    expect(store.getState().error).toBe('创建会话失败')
    expect(api.addMessage).not.toHaveBeenCalled()
    expect(api.streamChatWithContext).not.toHaveBeenCalled()
    expect(store.getState().messages).toEqual([])
  })

  it('正在回答时再点发送直接返回：一次 IPC 都不发（防连点攒出两条同样提问）', async () => {
    const { store, api } = await setup()
    store.setState({ currentSessionId: 'c1', loading: true })
    await store.getState().sendMessage('排队')
    expect(api.addMessage).not.toHaveBeenCalled()
    store.setState({ loading: false, streaming: true })
    await store.getState().sendMessage('排队')
    expect(api.streamChatWithContext).not.toHaveBeenCalled()
  })

  it('标题还是「新对话」时拿首条提问当标题；已经有标题就不改，两条各计一次', async () => {
    const { store, api } = await setup()
    // 列表里再放一条别的会话：计数只许动当前这一条
    store.setState({ currentSessionId: 'c1', sessions: [convView('c1'), convView('c_other', { messageCount: 7 })] })
    const run = async (text: string) => {
      const done = store.getState().sendMessage(text)
      await flush()
      api.push.retrievalDone()
      api.push.chunk('好')
      api.push.complete()
      await done
    }
    await run('如何培养元认知能力？这是很长的一段用来验证截断的提问文字')
    expect(store.getState().sessions[0].title).toBe('如何培养元认知能力？这是很长的一段用来验证截断的')
    expect(store.getState().sessions[0].title).toHaveLength(24)
    expect(store.getState().sessions[0].messageCount).toBe(2)
    await run('第二个问题')
    expect(store.getState().sessions[0].title).toBe('如何培养元认知能力？这是很长的一段用来验证截断的')
    expect(store.getState().sessions[0].messageCount).toBe(4)
    expect(store.getState().sessions[1]).toMatchObject({ id: 'c_other', messageCount: 7 })
  })

  it('用户消息落库失败照样往下流：本地已经有那一条，流式照跑，计数不加在那一次上', async () => {
    const store = await freshStore()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const api = installApi({ addMessageFails: true })
    store.setState({ currentSessionId: 'c1', sessions: [convView('c1', { messageCount: 0 })] })
    const done = store.getState().sendMessage('会失败')
    await flush()
    api.push.chunk('答')
    api.push.complete()
    await done
    expect(api.streamChatWithContext).toHaveBeenCalledTimes(1)
    expect(store.getState().messages.map(m => m.content)).toEqual(['会失败', '答'])
    // 提问那次没写进库 ⇒ 不该计数；回答这次落了库才 +1（0 也要能被加上去）
    expect(store.getState().sessions[0].messageCount).toBe(1)
    spy.mockRestore()
  })
})

describe('chatStore — 重新生成', () => {
  it('复用最后一条提问：删掉它之后持久化过的旧回复、本地截断、计数回退，且不再新增提问', async () => {
    const { store, api } = await setup()
    store.setState({
      currentSessionId: 'c1',
      sessions: [convView('c1', { messageCount: 4 }), convView('c_other', { messageCount: 6 })],
      messages: [
        { role: 'user', content: '第一个问题' },
        { role: 'assistant', content: '第一个回答', id: 'a1' },
        { role: 'user', content: '要重问的问题' },
        { role: 'assistant', content: '旧答案', id: 'a2' },
        // 没落库的回复没有 id：删不了库里的行，也不该被拿去调删除
        { role: 'assistant', content: '还没存下来的答案' },
      ],
    })
    const done = store.getState().regenerate()
    await flush()
    // 删掉一条旧回复的那一刻，计数先回退到 3（本地截断与库里的删除同一步）
    expect(store.getState().sessions[0].messageCount).toBe(3)
    api.push.retrievalDone()
    api.push.chunk('新答案')
    api.push.complete()
    await done
    expect(api.deleteMessage.mock.calls.map(c => c[0])).toEqual(['a2'])
    expect(api.streamChatWithContext.mock.calls[0][0]).toMatchObject({
      sessionId: 'c1',
      userMessage: '要重问的问题',
    })
    expect(api.addMessage.mock.calls.filter(c => c[1].role === 'user')).toHaveLength(0)
    const s = store.getState()
    expect(s.messages.map(m => [m.role, m.content])).toEqual([
      ['user', '第一个问题'],
      ['assistant', '第一个回答'],
      ['user', '要重问的问题'],
      ['assistant', '新答案'],
    ])
    // 删一条 + 补一条：净零，但提问那一次不重复计数
    expect(s.sessions[0].messageCount).toBe(4)
    expect(s.sessions[1]).toMatchObject({ id: 'c_other', messageCount: 6 })
  })

  it('上下文只带那条提问之前的历史（不含它之后的旧答案）', async () => {
    const { store, api } = await setup()
    store.setState({
      currentSessionId: 'c1',
      messages: [
        { role: 'user', content: 'q1' },
        { role: 'assistant', content: 'a1', id: 'a1' },
        { role: 'user', content: 'q2' },
        { role: 'assistant', content: 'a2', id: 'a2' },
      ],
    })
    const done = store.getState().regenerate()
    await flush()
    api.push.complete()
    await done
    expect(api.streamChatWithContext.mock.calls[0][0].conversationHistory).toEqual([
      { role: 'user', content: 'q1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'q2' },
    ])
  })

  it('没有提问可重问 / 没有会话 / 正在回答：三种情况都直接返回，一次 IPC 都不发', async () => {
    const a = await setup()
    a.store.setState({ currentSessionId: 'c1', messages: [{ role: 'assistant', content: '只有回答' }] })
    await a.store.getState().regenerate()
    expect(a.api.streamChatWithContext).not.toHaveBeenCalled()

    const b = await setup()
    await b.store.getState().regenerate()
    expect(b.api.streamChatWithContext).not.toHaveBeenCalled()

    const c = await setup()
    c.store.setState({ currentSessionId: 'c1', messages: [{ role: 'user', content: 'q' }], streaming: true })
    await c.store.getState().regenerate()
    expect(c.api.streamChatWithContext).not.toHaveBeenCalled()
  })

  it('删旧回复失败也照样重跑（删除失败不该把重新生成整条掐掉），计数也不会被减成负数', async () => {
    const store = await freshStore()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const api = installApi({ deleteMessageFails: true })
    store.setState({
      currentSessionId: 'c1',
      sessions: [convView('c1', { messageCount: 0 })],
      messages: [
        { role: 'user', content: 'q' },
        { role: 'assistant', content: '旧', id: 'a1' },
      ],
    })
    const done = store.getState().regenerate()
    await flush()
    // 库里那条计数本来就是 0，删一条不该把它减成 -1
    expect(store.getState().sessions[0].messageCount).toBe(0)
    api.push.chunk('新')
    api.push.complete()
    await done
    expect(api.deleteMessage).toHaveBeenCalledWith('a1')
    expect(api.streamChatWithContext).toHaveBeenCalledTimes(1)
    expect(store.getState().sessions[0].messageCount).toBe(1)
    spy.mockRestore()
  })
})

describe('chatStore — 流式过程与停止', () => {
  it('思考过程累积成一条 reasoning，结束时定格（isStreaming false + 至少 1 秒耗时）', async () => {
    const { store, api } = await setup()
    store.setState({ currentSessionId: 'c1', enableReasoning: true })
    const done = store.getState().sendMessage('在想什么')
    await flush()
    expect(store.getState().reasoningStartTime).not.toBeNull()
    api.push.reasoning('先想')
    api.push.reasoning('再想')
    expect(store.getState().streamingReasoning).toBe('先想再想')
    api.push.chunk('结论')
    api.push.complete()
    await done
    const last = store.getState().messages.at(-1)!
    expect(last.content).toBe('结论')
    expect(last.reasoning).toMatchObject({ content: '先想再想', isStreaming: false })
    expect(last.reasoning!.duration).toBeGreaterThanOrEqual(1)
  })

  it('没开深度思考但模型仍在思考：开始时间在第一条思考到达时补记，思考照样定格', async () => {
    const { store, api } = await setup()
    store.setState({ currentSessionId: 'c1' })
    const done = store.getState().sendMessage('普通提问')
    await flush()
    api.push.reasoning('它自己想了')
    expect(store.getState().streamingReasoning).toBe('它自己想了')
    expect(store.getState().reasoningStartTime).not.toBeNull()
    api.push.chunk('答')
    api.push.complete()
    await done
    const last = store.getState().messages.at(-1)!
    expect(last.reasoning).toMatchObject({ content: '它自己想了', isStreaming: false })
    expect(last.reasoning!.duration).toBeGreaterThanOrEqual(1)
  })

  it('主进程报错：error 写出来、流式与加载都归位、不落一条空回复', async () => {
    const { store, api } = await setup()
    store.setState({ currentSessionId: 'c1' })
    const done = store.getState().sendMessage('会报错')
    await flush()
    api.push.chunk('半句')
    api.push.error('上游 500')
    await done
    const s = store.getState()
    expect(s.error).toBe('上游 500')
    expect(s.streaming).toBe(false)
    expect(s.loading).toBe(false)
    expect(s.streamingContent).toBe('')
    expect(s.messages.map(m => m.role)).toEqual(['user'])
    expect(s.reasoningStartTime).toBeNull()
  })

  it('软停：已经收到的半句落库成一条真实回复，而不是丢掉', async () => {
    const { store, api } = await setup()
    store.setState({ currentSessionId: 'c1' })
    const done = store.getState().sendMessage('慢慢说')
    await flush()
    api.push.chunk('第一段，')
    api.push.chunk('第二段。')
    store.getState().stopStreaming()
    await done
    expect(api.cancelStream).toHaveBeenCalledTimes(1)
    const assistant = store.getState().messages.at(-1)!
    expect(assistant.content).toBe('第一段，第二段。')
    expect(assistant.id).toBe('msg_from_db')
    expect(store.getState().streaming).toBe(false)
  })

  it('没有进行中的流时点停止：只把状态归位，不凭空造一条回复', async () => {
    const store = await freshStore()
    Object.defineProperty(window, 'electronAPI', {
      value: { ai: { cancelStream: vi.fn(async () => ({ aborted: false })) } },
      writable: true,
      configurable: true,
    })
    store.setState({ streaming: true, loading: true })
    store.getState().stopStreaming()
    const s = store.getState()
    expect(s.streaming).toBe(false)
    expect(s.loading).toBe(false)
    expect(s.messages).toEqual([])
  })

  it('完成与停止抢在同一刻：那一轮只落一条回复，第二次的正文不进库', async () => {
    const { store, api } = await setup({ deferAssistantSave: true })
    store.setState({ currentSessionId: 'c1' })
    const done = store.getState().sendMessage('慢一点的回答')
    await flush()
    api.push.chunk('只有这一份。')
    api.push.complete()
    await flush()
    // 落库还在飞的这一刻点停止：并发守卫要挡住第二次写入
    store.getState().stopStreaming()
    api.releaseSave()
    await done
    const assistantCalls = api.addMessage.mock.calls.filter(c => c[1].role === 'assistant')
    expect(assistantCalls).toHaveLength(1)
    expect(assistantCalls[0][1].content).toBe('只有这一份。')
    const s = store.getState()
    expect(s.messages.filter(m => m.role === 'assistant')).toHaveLength(1)
    expect(s.streaming).toBe(false)
  })

  it('助手消息写库失败：回答照样留在界面上，只是没有 id（点赞/收藏对它不可用）', async () => {
    const store = await freshStore()
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const api = installApi({ assistantSaveFails: true })
    store.setState({ currentSessionId: 'c1' })
    const done = store.getState().sendMessage('存不进去的回答')
    await flush()
    api.push.chunk('内容是在的')
    api.push.complete()
    await done
    const last = store.getState().messages.at(-1)!
    expect(last.content).toBe('内容是在的')
    expect(last.id).toBeUndefined()
    expect(store.getState().streaming).toBe(false)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('结束之后的四类迟到事件都不再改动这一轮（订阅已注销、重复 settle 被挡住）', async () => {
    const { store, api } = await setup()
    store.setState({ currentSessionId: 'c1' })
    const done = store.getState().sendMessage('一次问答')
    await flush()
    api.push.retrievalDone({ intent: 'knowledge_query' })
    api.push.chunk('完整答案')
    api.push.complete()
    await done
    expect(api.unsubscribed()).toBe(5)
    api.push.chunk('迟到的尾巴')
    api.push.reasoning('迟到的思考')
    api.push.retrievalDone({ intent: 'late' })
    api.push.complete()
    api.push.error('迟到的错误')
    const s = store.getState()
    expect(s.streamingContent).toBe('')
    expect(s.streamingReasoning).toBe('')
    expect(s.messages).toHaveLength(2)
    expect(s.messages[1].content).toBe('完整答案')
    expect(s.messages[1].intent).toBe('knowledge_query')
    expect(s.streaming).toBe(false)
  })

  it('空回复不落库、不进列表：计数只算那一条提问（失败不许演成一条空气泡）', async () => {
    const { store, api } = await setup()
    store.setState({ currentSessionId: 'c1', sessions: [convView('c1', { messageCount: 2 })] })
    const done = store.getState().sendMessage('模型没吐字')
    await flush()
    api.push.complete()
    await done
    expect(api.addMessage.mock.calls.filter(c => c[1].role === 'assistant')).toHaveLength(0)
    const s = store.getState()
    expect(s.messages.map(m => m.role)).toEqual(['user'])
    // 2 → 3 是提问那一次的份；空回复不再往上加
    expect(s.sessions[0].messageCount).toBe(3)
  })

  it('检索可视化：start 只占位，done 才把各路结果与意图收进来；done 少了 ragSources 也不猜', async () => {
    const { store, api } = await setup()
    store.setState({ currentSessionId: 'c1' })
    const done = store.getState().sendMessage('查知识库')
    await flush()
    expect(store.getState().retrieval).toEqual({ stage: 'start' })
    api.push.retrievalStart()
    expect(store.getState().retrieval).toEqual({ stage: 'start' })
    api.push.retrievalDone({ intent: 'casual_chat', ragSources: null })
    expect(store.getState().retrieval).toMatchObject({ stage: 'done', intent: 'casual_chat' })
    api.push.chunk('答')
    api.push.complete()
    await done
    expect(store.getState().messages.at(-1)!.intent).toBe('casual_chat')
    expect(store.getState().messages.at(-1)!.sources).toBeUndefined()
  })

  it('完成时广播 token-usage 更新事件（Token 统计页不用手动刷新）', async () => {
    const { store, api } = await setup()
    store.setState({ currentSessionId: 'c1' })
    const done = store.getState().sendMessage('花 token 的一次')
    await flush()
    api.push.chunk('答')
    api.push.complete()
    await done
    expect(api.tokenBroadcasts()).toBe(1)
  })

  it('练习中的方法论与关联书一起下发；没设置时是 undefined 而不是空串', async () => {
    const withBoth = await setup()
    withBoth.store.setState({ currentSessionId: 'c1', currentBookId: 'b8', practiceMethodologyId: 'm9' })
    const d1 = withBoth.store.getState().sendMessage('练这个')
    await flush()
    withBoth.api.push.complete()
    await d1
    expect(withBoth.api.streamChatWithContext.mock.calls[0][0]).toMatchObject({
      bookId: 'b8',
      methodologyId: 'm9',
    })

    const bare = await setup()
    bare.store.setState({ currentSessionId: 'c1' })
    const d2 = bare.store.getState().sendMessage('不练')
    await flush()
    bare.api.push.complete()
    await d2
    expect(bare.api.streamChatWithContext.mock.calls[0][0].bookId).toBeUndefined()
    expect(bare.api.streamChatWithContext.mock.calls[0][0].methodologyId).toBeUndefined()
  })
})

describe('chatStore — 点赞、收藏与开关', () => {
  it('toggleLike 先本地生效再落库；落库失败回滚并把原因写出来', async () => {
    const store = await freshStore()
    const like = vi.fn(async (_id: string, _liked: boolean) => { throw new Error('写不进去') })
    Object.defineProperty(window, 'electronAPI', {
      value: { chat: { toggleLike: like } },
      writable: true,
      configurable: true,
    })
    store.setState({ messages: [msg('a1'), msg('a2')] })
    await store.getState().toggleLike('a1', true)
    expect(like).toHaveBeenCalledWith('a1', true)
    const s = store.getState()
    expect(s.messages.find(m => m.id === 'a1')!.liked).toBe(false)
    expect(s.messages.find(m => m.id === 'a2')!.liked).toBeUndefined()
    expect(s.error).toBe('写不进去')
  })

  it('toggleLike 成功时不回滚，只留本地那一份', async () => {
    const { store, api } = await setup()
    store.setState({ messages: [msg('a1')] })
    await store.getState().toggleLike('a1', true)
    expect(api.toggleLike).toHaveBeenCalledWith('a1', true)
    expect(store.getState().messages[0].liked).toBe(true)
    expect(store.getState().error).toBeNull()
  })

  it('收藏列表已经拉过时，取消收藏的那条要跟着消失；没拉过就不为看不见的抽屉发请求', async () => {
    const withList = await setup({ getBookmarkedValue: [] })
    withList.store.setState({ messages: [msg('a1')], bookmarkedMessages: [bm('a1')] })
    await withList.store.getState().toggleBookmark('a1', false)
    expect(withList.api.getBookmarked).toHaveBeenCalledTimes(1)

    const noList = await setup()
    noList.store.setState({ messages: [msg('a1'), msg('a2')] })
    await noList.store.getState().toggleBookmark('a1', true)
    expect(noList.api.getBookmarked).not.toHaveBeenCalled()
    expect(noList.store.getState().messages[0].bookmarked).toBe(true)
    expect(noList.store.getState().messages[1].bookmarked).toBeUndefined()
  })

  it('收藏落库失败：本地那颗星回到原样并写出原因', async () => {
    const store = await freshStore()
    Object.defineProperty(window, 'electronAPI', {
      value: {
        chat: { toggleBookmark: vi.fn(async () => { throw new Error('收藏失败') }) },
        conversation: { getBookmarked: vi.fn(async () => []) },
      },
      writable: true,
      configurable: true,
    })
    store.setState({ messages: [msg('a1'), msg('a2')], bookmarkedMessages: [bm('a1')] })
    await store.getState().toggleBookmark('a1', false)
    const s = store.getState()
    expect(s.messages[0].bookmarked).toBe(true)
    expect(s.messages[1].bookmarked).toBeUndefined()
    expect(s.error).toBe('收藏失败')
  })

  it('loadBookmarked：库里给的不是数组就当没有，不拿 undefined 去渲染', async () => {
    const ok = await setup({ getBookmarkedValue: [bm('a1'), bm('a2')] })
    await ok.store.getState().loadBookmarked()
    expect(ok.store.getState().bookmarkedMessages.map(x => x.id)).toEqual(['a1', 'a2'])

    const weird = await setup({ getBookmarkedValue: { 不是数组: true } })
    await weird.store.getState().loadBookmarked()
    expect(weird.store.getState().bookmarkedMessages).toEqual([])

    const bad = await freshStore()
    Object.defineProperty(window, 'electronAPI', {
      value: { conversation: { getBookmarked: async () => { throw new Error('读不到收藏') } } },
      writable: true,
      configurable: true,
    })
    await bad.getState().loadBookmarked()
    expect(bad.getState().error).toBe('读不到收藏')
  })

  it('四个开关各改各的字段，clearError 只清错误', async () => {
    const { store } = await setup()
    const s = () => store.getState()
    store.setState({ error: '旧错误' })
    s().setCurrentBook('b1')
    expect(s().currentBookId).toBe('b1')
    s().setCurrentBook(null)
    expect(s().currentBookId).toBeNull()
    s().setPracticeMethodology('m1')
    expect(s().practiceMethodologyId).toBe('m1')
    s().setPracticeMethodology(null)
    expect(s().practiceMethodologyId).toBeNull()
    s().setEnableReasoning(true)
    expect(s().enableReasoning).toBe(true)
    s().clearError()
    expect(s().error).toBeNull()
    expect(s().currentBookId).toBeNull()
  })
})

// ===== 测试自己的小工具 =====

function msg(id: string): { id: string; role: 'assistant'; content: string } {
  return { id, role: 'assistant', content: '回答 ' + id }
}

function bm(id: string): BookmarkedMessageRow {
  return {
    id,
    conversation_id: 'c1',
    content: '收藏的句子',
    created_at: '2026-09-27 10:00:00',
    conversation_title: '新对话',
  }
}

/** 会话视图（界面拿到的那个驼峰形状，不是库里的行） */
function convView(
  id: string,
  over: Partial<{ title: string; bookId: string; messageCount: number }> = {},
): import('../src/renderer/src/utils/db-mapper').ConversationView {
  return {
    id,
    title: over.title ?? '新对话',
    bookId: over.bookId ?? '',
    createdAt: '2026-09-27 10:00:00',
    updatedAt: '2026-09-27 10:00:00',
    messageCount: over.messageCount ?? 0,
    bookTitle: '',
  }
}
