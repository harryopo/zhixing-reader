import { create } from 'zustand'

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

interface ChatState {
  sessions: Session[]
  currentSessionId: string | null
  messages: Message[]
  loading: boolean
  streaming: boolean
  streamingContent: string
  error: string | null
  currentBookId: string | null

  loadSessions: () => Promise<void>
  createSession: (bookId?: string) => Promise<void>
  switchSession: (id: string) => Promise<void>
  deleteSession: (id: string) => Promise<void>
  sendMessage: (content: string) => Promise<void>
  setCurrentBook: (bookId: string | null) => void
  clearError: () => void
}

export const useChatStore = create<ChatState>((set, get) => ({
  sessions: [],
  currentSessionId: null,
  messages: [],
  loading: false,
  streaming: false,
  streamingContent: '',
  error: null,
  currentBookId: null,

  loadSessions: async () => {
    try {
      if (!window.electronAPI?.conversation) return
      const sessions = await window.electronAPI.conversation.getAll() as Session[]
      set({ sessions })
    } catch (error) {
      console.error('加载会话列表失败:', error)
    }
  },

  createSession: async (bookId?: string) => {
    try {
      const session = await window.electronAPI.conversation.create(undefined, bookId) as Session
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
    const { currentSessionId, currentBookId, loading, streaming, messages } = get()
    if (loading || streaming) return

    let sessionId = currentSessionId

    if (!sessionId) {
      try {
        const session = await window.electronAPI.conversation.create(undefined, currentBookId || undefined) as Session
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
    } catch (error) {
      console.error('保存用户消息失败:', error)
    }

    try {
      set({ streaming: true, streamingContent: '' })

      const removeChunkListener = window.electronAPI.ai.onStreamChunk?.((chunk: string) => {
        set(state => ({ streamingContent: state.streamingContent + chunk }))
      })

      const removeErrorListener = window.electronAPI.ai.onStreamError?.((error: string) => {
        set({ streaming: false, loading: false, error })
        removeChunkListener?.()
        removeErrorListener?.()
        removeCompleteListener?.()
      })

      let removeCompleteListener: (() => void) | undefined

      const streamPromise = new Promise<void>((resolve) => {
        removeCompleteListener = window.electronAPI.ai.onStreamComplete?.(() => {
          set(state => {
            const fullContent = state.streamingContent
            const assistantMessage: Message = { role: 'assistant', content: fullContent }
            const allMessages = [...state.messages, assistantMessage]

            if (sessionId) {
              window.electronAPI.conversation.addMessage(sessionId, {
                role: 'assistant',
                content: fullContent,
              }).catch(console.error)
            }

            return {
              messages: allMessages,
              streaming: false,
              streamingContent: '',
              loading: false,
            }
          })

          removeChunkListener?.()
          removeErrorListener?.()
          removeCompleteListener?.()
          resolve()
        })
      })

      const conversationHistory = messages.slice(-6).map(m => ({
        role: m.role,
        content: m.content,
      }))

      await window.electronAPI.ai.streamChatWithContext({
        conversationId: sessionId!,
        bookId: currentBookId || undefined,
        question: content,
        context: conversationHistory,
      })

      await streamPromise
    } catch (error) {
      const errorMessage = (error as Error).message
      set({ error: errorMessage, loading: false, streaming: false, streamingContent: '' })
    }
  },

  setCurrentBook: (bookId: string | null) => {
    set({ currentBookId: bookId })
  },

  clearError: () => {
    set({ error: null })
  },
}))
