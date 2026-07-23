import { create } from 'zustand'

interface ReasoningBlock {
  /** 思考内容（明文） */
  content: string
  /** 是否流式中 */
  isStreaming: boolean
  /** 思考耗时（秒） */
  duration?: number
}

interface Source {
  bookId: string
  bookTitle: string
  chunkId: string
  relevanceScore: number
}

interface Message {
  id?: string
  role: 'user' | 'assistant' | 'system'
  content: string
  intent?: string
  toolsUsed?: string[]
  bloomLevel?: number
  masteryAssessment?: {
    concept: string
    level: number
    confidence: number
  }
  sources?: Source[]
  reasoning?: ReasoningBlock
  /** 是否已点赞（仅 assistant 消息） */
  liked?: boolean
  /** 是否已收藏（仅 assistant 消息） */
  bookmarked?: boolean
  createdAt?: string
}

interface RawMessage {
  id?: string
  role: string
  content: string
  intent?: string
  tools_used?: string | string[]
  bloom_level?: number
  mastery_assessment?: string | Record<string, unknown>
  sources?: string | Source[]
  /** DB 存 INTEGER 0/1 */
  liked?: number | boolean
  /** DB 存 INTEGER 0/1 */
  bookmarked?: number | boolean
  created_at?: string
}

function mapMessage(raw: RawMessage): Message {
  return {
    id: raw.id,
    role: raw.role as Message['role'],
    content: raw.content,
    intent: raw.intent,
    toolsUsed: typeof raw.tools_used === 'string' ? JSON.parse(raw.tools_used || '[]') : raw.tools_used,
    bloomLevel: raw.bloom_level,
    masteryAssessment: typeof raw.mastery_assessment === 'string'
      ? JSON.parse(raw.mastery_assessment || 'null')
      : raw.mastery_assessment as Message['masteryAssessment'],
    sources: typeof raw.sources === 'string' ? JSON.parse(raw.sources || '[]') : raw.sources,
    liked: raw.liked != null ? Boolean(raw.liked) : false,
    bookmarked: raw.bookmarked != null ? Boolean(raw.bookmarked) : false,
    createdAt: raw.created_at,
  }
}

interface Session {
  id: string
  title: string
  bookId?: string
  createdAt: string
  updatedAt: string
  messageCount: number
}

/** DB/IPC returns snake_case; UI Session is camelCase */
function mapSession(raw: Record<string, unknown>): Session {
  const bookId = raw.book_id ?? raw.bookId
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? '新对话'),
    bookId: bookId != null && bookId !== '' ? String(bookId) : undefined,
    createdAt: String(raw.created_at ?? raw.createdAt ?? ''),
    updatedAt: String(raw.updated_at ?? raw.updatedAt ?? ''),
    messageCount: Number(raw.message_count ?? raw.messageCount ?? 0),
  }
}

interface ChatState {
  sessions: Session[]
  currentSessionId: string | null
  messages: Message[]
  loading: boolean
  streaming: boolean
  streamingContent: string
  /** 流式中的思考过程内容 */
  streamingReasoning: string
  /** 当前流式的思考开始时间戳（ms）；用于计算 duration） */
  reasoningStartTime: number | null
  error: string | null
  currentBookId: string | null
  /** 深度思考模式开关（开启后下一次 sendMessage 生效） */
  enableReasoning: boolean

  loadSessions: () => Promise<void>
  createSession: (bookId?: string) => Promise<void>
  switchSession: (id: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  sendMessage: (content: string) => Promise<void>
  /** Soft-stop: keep partial reply, free UI (main process stream may still finish) */
  stopStreaming: () => void
  setCurrentBook: (bookId: string | null) => void
  clearError: () => void
  /** 切换深度思考模式 */
  setEnableReasoning: (enabled: boolean) => void
  /** 点赞 / 取消点赞 assistant 消息（持久化到 DB） */
  toggleLike: (messageId: string, liked: boolean) => Promise<void>
  /** 收藏 / 取消收藏 assistant 消息（持久化到 DB） */
  toggleBookmark: (messageId: string, bookmarked: boolean) => Promise<void>
}

/** Active stream control for stop button (module-level, not in zustand state) */
let activeStreamStop: (() => void) | null = null

export const useChatStore = create<ChatState>((set, get) => ({
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
  enableReasoning: false,

  loadSessions: async () => {
    try {
      if (!window.electronAPI?.conversation) return
      const raw = await window.electronAPI.conversation.getAll() as Record<string, unknown>[]
      set({ sessions: (raw || []).map(mapSession) })
    } catch (error) {
      console.error('加载会话列表失败:', error)
    }
  },

  createSession: async (bookId?: string) => {
    try {
      const raw = await window.electronAPI.conversation.create(undefined, bookId) as Record<string, unknown>
      const session = mapSession(raw)
      set(state => ({
        sessions: [session, ...state.sessions],
        currentSessionId: session.id,
        messages: [],
      }))
    } catch (error) {
      set({ error: (error as Error).message })
    }
  },

  switchSession: async (id: string) => {
    try {
      const rawMessages = await window.electronAPI.conversation.getMessages(id) as RawMessage[]
      const session = get().sessions.find(s => s.id === id)
      set({
        currentSessionId: id,
        messages: rawMessages.map(mapMessage),
        currentBookId: session?.bookId || null,
      })
    } catch (error) {
      set({ error: (error as Error).message })
    }
  },

  deleteSession: async (id: string) => {
    try {
      await window.electronAPI.conversation.delete(id)
      set(state => {
        const sessions = state.sessions.filter(s => s.id !== id)
        const isCurrentSession = state.currentSessionId === id
        return {
          sessions,
          currentSessionId: isCurrentSession ? null : state.currentSessionId,
          messages: isCurrentSession ? [] : state.messages,
        }
      })
    } catch (error) {
      set({ error: (error as Error).message })
    }
  },

  sendMessage: async (content: string) => {
    const { currentSessionId, currentBookId, loading, streaming, messages, enableReasoning } = get()
    if (loading || streaming) return

    let sessionId = currentSessionId

    if (!sessionId) {
      try {
        const raw = await window.electronAPI.conversation.create(undefined, currentBookId || undefined) as Record<string, unknown>
        const session = mapSession(raw)
        sessionId = session.id
        set(state => ({
          sessions: [session, ...state.sessions],
          currentSessionId: sessionId,
        }))
      } catch (error) {
        set({ error: (error as Error).message })
        return
      }
    }

    set({ loading: true, error: null })

    const userMessage: Message = { role: 'user', content }
    set(state => ({ messages: [...state.messages, userMessage] }))

    try {
      await window.electronAPI.conversation.addMessage(sessionId!, {
        role: 'user',
        content,
      })
      // bump local message count + title hint
      set(state => ({
        sessions: state.sessions.map(s =>
          s.id === sessionId
            ? {
                ...s,
                messageCount: (s.messageCount || 0) + 1,
                title: s.title === '新对话' ? content.slice(0, 24) : s.title,
                updatedAt: new Date().toISOString(),
              }
            : s
        ),
      }))
    } catch (error) {
      console.error('保存用户消息失败:', error)
    }

    try {
      set({
        streaming: true,
        streamingContent: '',
        streamingReasoning: '',
        reasoningStartTime: enableReasoning ? Date.now() : null,
      })

      let settled = false
      let finishing = false
      let removeChunkListener: (() => void) | undefined
      let removeReasoningListener: (() => void) | undefined
      let removeErrorListener: (() => void) | undefined
      let removeCompleteListener: (() => void) | undefined

      const cleanupListeners = () => {
        removeChunkListener?.()
        removeReasoningListener?.()
        removeErrorListener?.()
        removeCompleteListener?.()
        activeStreamStop = null
      }

      const streamPromise = new Promise<void>((resolve, reject) => {
        const settle = (fn: () => void) => {
          if (settled) return
          settled = true
          cleanupListeners()
          fn()
        }

        // 异步：先持久化 assistant 消息拿到 DB id，再写入本地 state（id 用于点赞/收藏）
        const finishWithContent = async (fullContent: string, resolveStream: boolean) => {
          // 守卫：防止 onStreamComplete 与 activeStreamStop 并发触发导致重复消息
          if (finishing || settled) return
          finishing = true

          const state = get()
          const fullReasoning = state.streamingReasoning
          const reasoningDuration = state.reasoningStartTime
            ? Math.max(1, Math.ceil((Date.now() - state.reasoningStartTime) / 1000))
            : undefined

          // 持久化到 DB 并取回消息 id（点赞/收藏按钮依赖 id）
          let assistantMessageId: string | undefined
          if (sessionId && fullContent) {
            try {
              assistantMessageId = await window.electronAPI.conversation.addMessage(sessionId, {
                role: 'assistant',
                content: fullContent,
              })
            } catch (error) {
              console.error('保存助手消息失败:', error)
            }
          }

          set(state => {
            const assistantMessage: Message = {
              id: assistantMessageId,
              role: 'assistant',
              content: fullContent,
              reasoning: fullReasoning
                ? { content: fullReasoning, isStreaming: false, duration: reasoningDuration }
                : undefined,
            }
            const allMessages = fullContent
              ? [...state.messages, assistantMessage]
              : state.messages

            return {
              messages: allMessages,
              streaming: false,
              streamingContent: '',
              streamingReasoning: '',
              reasoningStartTime: null,
              loading: false,
              sessions: state.sessions.map(s =>
                s.id === sessionId && fullContent
                  ? { ...s, messageCount: (s.messageCount || 0) + 1, updatedAt: new Date().toISOString() }
                  : s
              ),
            }
          })
          settle(() => (resolveStream ? resolve() : resolve()))
        }

        removeChunkListener = window.electronAPI.ai.onStreamChunk?.((chunk: string) => {
          // Ignore late chunks after soft-stop
          if (settled) return
          set(state => ({ streamingContent: state.streamingContent + chunk }))
        })

        // 思考过程流式（DeepSeek R1 reasoning_content / Claude thinking / OpenAI o-series summary）
        removeReasoningListener = window.electronAPI.ai.onStreamReasoningChunk?.((chunk: string) => {
          if (settled) return
          set(state => ({
            streamingReasoning: state.streamingReasoning + chunk,
            // 第一次收到 reasoning chunk 时记下开始时间（若尚未设置）
            reasoningStartTime: state.reasoningStartTime ?? Date.now(),
          }))
        })

        removeErrorListener = window.electronAPI.ai.onStreamError?.((error: string) => {
          set({ streaming: false, loading: false, error, streamingReasoning: '', reasoningStartTime: null })
          settle(() => reject(new Error(error)))
        })

        removeCompleteListener = window.electronAPI.ai.onStreamComplete?.(() => {
          if (settled) return
          finishWithContent(get().streamingContent, true)
        })

        activeStreamStop = () => {
          const partial = get().streamingContent
          finishWithContent(partial, true)
        }
      })

      const conversationHistory = [
        ...messages.slice(-5).map(m => ({ role: m.role, content: m.content })),
        { role: 'user' as const, content },
      ]

      await window.electronAPI.ai.streamChatWithContext({
        sessionId: sessionId!,
        bookId: currentBookId || undefined,
        userMessage: content,
        conversationHistory,
        enableReasoning,
      })

      await streamPromise
    } catch (error) {
      activeStreamStop = null
      const errorMessage = (error as Error).message
      // Soft-stop uses resolve path; only real errors land here
      if (get().streaming || get().loading) {
        set({ error: errorMessage, loading: false, streaming: false, streamingContent: '', streamingReasoning: '', reasoningStartTime: null })
      }
    }
  },

  stopStreaming: () => {
    // Hard abort main-process network stream (best-effort)
    void window.electronAPI?.ai?.cancelStream?.().catch(() => {})
    if (activeStreamStop) {
      activeStreamStop()
    } else {
      set({ streaming: false, loading: false })
    }
  },

  setCurrentBook: (bookId: string | null) => {
    set({ currentBookId: bookId })
  },

  clearError: () => {
    set({ error: null })
  },

  setEnableReasoning: (enabled: boolean) => {
    set({ enableReasoning: enabled })
  },

  toggleLike: async (messageId: string, liked: boolean) => {
    // 乐观更新：先改本地状态，再持久化到 DB
    set(state => ({
      messages: state.messages.map(m =>
        m.id === messageId ? { ...m, liked } : m
      ),
    }))
    try {
      await window.electronAPI.chat.toggleLike(messageId, liked)
    } catch (error) {
      // 持久化失败：回滚本地状态
      set(state => ({
        messages: state.messages.map(m =>
          m.id === messageId ? { ...m, liked: !liked } : m
        ),
        error: (error as Error).message,
      }))
    }
  },

  toggleBookmark: async (messageId: string, bookmarked: boolean) => {
    set(state => ({
      messages: state.messages.map(m =>
        m.id === messageId ? { ...m, bookmarked } : m
      ),
    }))
    try {
      await window.electronAPI.chat.toggleBookmark(messageId, bookmarked)
    } catch (error) {
      set(state => ({
        messages: state.messages.map(m =>
          m.id === messageId ? { ...m, bookmarked: !bookmarked } : m
        ),
        error: (error as Error).message,
      }))
    }
  },
}))
