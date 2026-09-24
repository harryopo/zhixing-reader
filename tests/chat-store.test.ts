// @vitest-environment happy-dom
//
// chatStore 单元测试 —— 助手消息的「意图 + 引用来源」落库
//
// 背景（2026-09-16 实测）：chat_messages 共 38 条，intent 有值 0 条、sources 有值 0 条。
// 根因是这两样东西主进程都算好并下发了，但保存助手消息时**只写了 role 和 content**；
// 而气泡那侧读取 sources 的渲染代码（MessageBubble 的 SourceList）一直存在 ——
// 整条链路只断在保存这一步。这里把它钉死。

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { useChatStore } from '../src/renderer/src/stores/chatStore'
import type { RagSourceRef } from '../src/shared/types'

const RAG_SOURCES: RagSourceRef[] = [
  {
    highlightId: 'hl_1',
    bookId: 'b1',
    bookTitle: '认知觉醒',
    chapterTitle: '第一章',
    content: '元认知就是对自己的思考过程进行思考',
    relevanceScore: 0.83,
  },
]

/** 安装 electronAPI stub，并把事件回调记录下来供测试驱动 */
function installApi(overrides: { ragSources?: RagSourceRef[]; intent?: string; error?: Error } = {}) {
  const listeners: Record<string, ((...args: unknown[]) => void) | null> = {
    chunk: null,
    reasoning: null,
    error: null,
    complete: null,
    retrieval: null,
  }
  // 参数签名与 src/types/renderer.d.ts 的 conversation.addMessage 一致 ——
  // 不写签名的话 mock.calls 的元素类型是空元组，取 c[1] 全靠 as，测试自己的类型也盯不住了
  const addMessage = vi.fn(
    async (
      _conversationId: string,
      _message: { role: string; content: string; intent?: string; sources?: RagSourceRef[] },
    ) => 'msg_assistant',
  )
  const streamChatWithContext = vi.fn(async () => {
    if (overrides.error) throw overrides.error
    // 顺序与主进程一致：先检索完成（带意图与引用来源），再流式，最后 complete
    listeners.retrieval?.({
      stage: 'done',
      sources: [],
      intent: overrides.intent ?? 'knowledge_query',
      ragSources: overrides.ragSources ?? RAG_SOURCES,
    })
    listeners.chunk?.('这是回答')
    listeners.complete?.()
  })

  Object.defineProperty(window, 'electronAPI', {
    value: {
      ai: {
        streamChatWithContext,
        onStreamChunk: (cb: never) => { listeners.chunk = cb; return () => {} },
        onStreamReasoningChunk: (cb: never) => { listeners.reasoning = cb; return () => {} },
        onStreamError: (cb: never) => { listeners.error = cb; return () => {} },
        onStreamComplete: (cb: never) => { listeners.complete = cb; return () => {} },
        onRetrievalStatus: (cb: never) => { listeners.retrieval = cb; return () => {} },
      },
      conversation: { addMessage },
    },
    writable: true,
    configurable: true,
  })
  return { addMessage, streamChatWithContext }
}

const INITIAL = {
  sessions: [],
  currentSessionId: 's1',
  messages: [],
  loading: false,
  streaming: false,
  streamingContent: '',
  streamingReasoning: '',
  reasoningStartTime: null,
  error: null,
  currentBookId: null,
  enableReasoning: false,
  retrieval: null,
}

describe('chatStore — 助手消息的意图与引用来源', () => {
  beforeEach(() => {
    useChatStore.setState({ ...INITIAL } as never)
  })

  it('保存助手消息时带上 intent 与 sources', async () => {
    const api = installApi()
    await useChatStore.getState().sendMessage('什么是元认知')

    const assistantCall = api.addMessage.mock.calls.find(
      (c) => c[1].role === 'assistant',
    )
    expect(assistantCall).toBeTruthy()
    expect(assistantCall![1]).toMatchObject({
      role: 'assistant',
      content: '这是回答',
      intent: 'knowledge_query',
      sources: RAG_SOURCES,
    })
  })

  it('本地消息状态也带上 sources（当轮即可见，不必重新加载会话）', async () => {
    installApi()
    await useChatStore.getState().sendMessage('什么是元认知')
    const assistant = useChatStore.getState().messages.find((m) => m.role === 'assistant')
    expect(assistant?.sources).toEqual(RAG_SOURCES)
    expect(assistant?.intent).toBe('knowledge_query')
  })

  it('没有检索命中时不写 sources（保持 undefined，而不是空数组）', async () => {
    const api = installApi({ ragSources: [] })
    await useChatStore.getState().sendMessage('随便聊聊')
    const assistantCall = api.addMessage.mock.calls.find(
      (c) => c[1].role === 'assistant',
    )
    expect(assistantCall![1].sources).toBeUndefined()
  })

  it('意图缺失时不写 intent', async () => {
    const api = installApi({ intent: '' })
    await useChatStore.getState().sendMessage('随便聊聊')
    const assistantCall = api.addMessage.mock.calls.find(
      (c) => c[1].role === 'assistant',
    )
    expect(assistantCall![1].intent).toBeUndefined()
  })

  it('流式失败时不保存助手消息', async () => {
    const api = installApi({ error: new Error('网络错误') })
    await useChatStore.getState().sendMessage('会失败的问题')
    const assistantCall = api.addMessage.mock.calls.find(
      (c) => c[1].role === 'assistant',
    )
    expect(assistantCall).toBeUndefined()
  })
})
