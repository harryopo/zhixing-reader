import { create } from 'zustand'
import { Book } from '../../../shared/types'

interface BookState {
  books: Book[]
  loading: boolean
  error: string | null
  fetchBooks: () => Promise<void>
  syncBookshelf: () => Promise<void>
  importNotes: (bookId: string) => Promise<void>
  generateCards: (bookId: string) => Promise<void>
}

export const useBookStore = create<BookState>((set, get) => ({
  books: [],
  loading: false,
  error: null,

  fetchBooks: async () => {
    set({ loading: true, error: null })
    try {
      const books = await window.electronAPI.book.getAll()
      set({ books, loading: false })
    } catch (error) {
      set({ error: (error as Error).message, loading: false })
    }
  },

  syncBookshelf: async () => {
    set({ loading: true, error: null })
    try {
      await window.electronAPI.weread.getBookshelf()
      await get().fetchBooks()
    } catch (error) {
      set({ error: (error as Error).message, loading: false })
    }
  },

  importNotes: async (bookId: string) => {
    set({ loading: true, error: null })
    try {
      await window.electronAPI.weread.fetchNotes(bookId)
      set({ loading: false })
    } catch (error) {
      set({ error: (error as Error).message, loading: false })
    }
  },

  generateCards: async (bookId: string) => {
    set({ loading: true, error: null })
    try {
      const highlights = await window.electronAPI.highlight.getByBook(bookId)
      const book = get().books.find(b => b.id === bookId)
      if (book) {
        await window.electronAPI.ai.generateCards(
          highlights.map(h => ({ content: h.content, note: h.note })),
          book.title
        )
      }
      set({ loading: false })
    } catch (error) {
      set({ error: (error as Error).message, loading: false })
    }
  }
}))
