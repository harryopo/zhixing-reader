/** 每日学习页的类型与常量表（从 DailyLearning.tsx 原样搬出，逻辑未改） */
import type { DailyTaskTag, DailyTaskQueue } from '../../../../shared/daily-tasks'

export interface Article {
  id: string
  title_en: string
  title_zh?: string
  content_en: string
  content_zh?: string
  summary_zh?: string
  source: string
  source_url?: string
  source_website?: string
  category: string
  difficulty: string
  vocabulary_json?: string
  is_read: boolean
  is_favorite: boolean
  created_at: string
}

export interface Vocabulary {
  id: string
  word: string
  phonetic?: string
  part_of_speech?: string
  meaning_zh: string
  example_en?: string
  example_zh?: string
  cefr_level?: string
  is_mastered: boolean
  learning_stage?: number
  next_review_at?: string
  /** 上一次复习的**真实时间戳**（用于判断"今天学过没有"） */
  last_review_at?: string
}

export type DifficultyFilter = 'all' | 'cet4' | 'cet6' | 'graduate'
export type StatusFilter = 'all' | 'unread' | 'read' | 'favorite'
export type TaskTag = DailyTaskTag

/** 卡片队列（来自 CARDS.GET_QUEUE_STATS，与首页同一个数据源） */
export interface CardQueue extends DailyTaskQueue {
  newAvailable: number
  newPerDay: number
  newIntroducedToday: number
}

// ===== 常量 =====

export const STAGE_LABELS: Record<number, string> = { 0: '新词', 1: '学习中', 2: '复习中' }

export const TASK_TAG_STYLES: Record<TaskTag, { background: string; color: string; label: string }> = {
  read: { background: 'var(--chart-1)', color: 'var(--primary-foreground)', label: '阅读' },
  review: { background: 'var(--chart-2)', color: 'var(--primary-foreground)', label: '复习' },
  vocab: { background: 'var(--chart-3)', color: 'var(--foreground)', label: '生词' },
  chat: { background: 'var(--chart-4)', color: 'var(--primary-foreground)', label: '对话' },
}

export const DIFFICULTY_LABELS: Record<DifficultyFilter, string> = {
  all: '全部',
  cet4: '四级',
  cet6: '六级',
  graduate: '考研',
}

export const STATUS_LABELS: Record<StatusFilter, string> = {
  all: '全部',
  unread: '未读',
  read: '已读',
  favorite: '收藏',
}

// ===== 工具函数 =====

/** 相对时间格式化（生词下次复习） */
