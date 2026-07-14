import { create } from 'zustand'
import { Highlight } from '../../../shared/types'

interface NoteState {
  highlights: Highlight[]
  filteredHighlights: Highlight[]
  loading: boolean
  error: string | null
  selectedBookId: string | null
  selectedSource: string | null
  fetchHighlights: (bookId?: string) => Promise<void>
  setFilter: (bookId: string | null, source: string | null) => void
}

export const useNoteStore = create<NoteState>((set, get) => ({
  highlights: [],
  filteredHighlights: [],
  loading: false,
  error: null,
  selectedBookId: null,
  selectedSource: null,

  fetchHighlights: async (bookId?: string) => {
    set({ loading: true, error: null })
    try {
      let highlights: Highlight[]
      if (bookId) {
        highlights = await window.electronAPI.highlight.getByBook(bookId)
      } else {
        highlights = await window.electronAPI.highlight.getAll()
      }
      set({ highlights, loading: false })
      get().setFilter(get().selectedBookId, get().selectedSource)
    } catch (error) {
      set({ error: (error as Error).message, loading: false })
    }
  },

  setFilter: (bookId: string | null, source: string | null) => {
    const { highlights } = get()
    let filtered = highlights

    if (bookId) {
      filtered = filtered.filter(h => h.bookId === bookId)
    }

    if (source) {
      filtered = filtered.filter(h => h.color === source)
    }

    set({
      selectedBookId: bookId,
      selectedSource: source,
      filteredHighlights: filtered
    })
  }
}))
