/** 知识卡片页的类型与常量表（从 KnowledgeCards.tsx 原样搬出，逻辑未改） */
import type { CSSProperties } from 'react'
import type { KnowledgeCardRow, KnowledgeCardType } from '../../utils/db-mapper'

export type CardType = KnowledgeCardType

export type FilterType = 'all' | 'concept' | 'methodology' | 'quote' | 'reflection'

export type TabKey = 'cards' | 'distill'

/** 界面口径 = 映射器保证会写出的那一组字段，不再自己另立一份行类型 */
export type KnowledgeCardItem = KnowledgeCardRow

export interface DistillProgress {
  bookId: string
  bookTitle?: string
  stage: 'fetch' | 'batch' | 'parse' | 'save' | 'done' | 'error'
  current: number
  total: number
  message?: string
  error?: string
}

export type { BookRow } from '../../utils/db-mapper'

// ===== 类型 → 视觉配置（设计稿 1:1） =====
export const typeConfig: Record<CardType, { label: string; badgeStyle: CSSProperties }> = {
  concept: {
    label: '概念',
    badgeStyle: {
      fontSize: '0.72rem',
      padding: '0.2rem 0.6rem',
      borderRadius: '999px',
      background: 'color-mix(in srgb, var(--chart-1) 14%, transparent)',
      color: 'var(--chart-1)',
      whiteSpace: 'nowrap',
      fontWeight: 600,
      display: 'inline-flex',
      alignItems: 'center',
    },
  },
  methodology: {
    label: '方法',
    badgeStyle: {
      fontSize: '0.72rem',
      padding: '0.2rem 0.6rem',
      borderRadius: '999px',
      background: 'color-mix(in srgb, var(--chart-5) 14%, transparent)',
      color: 'var(--chart-5)',
      whiteSpace: 'nowrap',
      fontWeight: 600,
      display: 'inline-flex',
      alignItems: 'center',
    },
  },
  quote: {
    label: '引用',
    badgeStyle: {
      fontSize: '0.72rem',
      padding: '0.2rem 0.6rem',
      borderRadius: '999px',
      background: 'color-mix(in srgb, var(--chart-3) 16%, transparent)',
      color: 'var(--chart-4)',
      whiteSpace: 'nowrap',
      fontWeight: 600,
      display: 'inline-flex',
      alignItems: 'center',
    },
  },
}

// 类型筛选 chips。
// 2026-09-16：「反思」已删除 —— 数据库 CHECK 只允许 concept/methodology/quote 三类，
// 这个筛选**永远筛不出任何卡片**，点了跟没点一样（筛选器在撒谎）。
export const TYPE_FILTERS: { key: FilterType; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'concept', label: '概念' },
  { key: 'methodology', label: '方法' },
  { key: 'quote', label: '引用' },
]

export const TABS: { key: TabKey; label: string }[] = [
  { key: 'cards', label: '卡片库' },
  { key: 'distill', label: '蒸馏中心' },
]

// ===== 错误分类（保留原逻辑） =====
export function classifyErrorMessage(msg: string): {
  type: 'timeout' | 'cancelled' | 'network' | 'config' | 'empty' | 'parse' | 'import' | 'unknown'
  text: string
} {
  if (msg.includes('已被取消') || msg.includes('用户取消') || msg.includes('aborted')) {
    return { type: 'cancelled', text: '蒸馏已取消' }
  }
  if (msg.includes('超时') || msg.includes('timeout')) {
    return { type: 'timeout', text: 'AI 响应超时。笔记较多时耗时较长，请稍后重试或减少笔记数量。' }
  }
  if (msg.includes('网络错误') || msg.includes('fetch failed') || msg.includes('ENOTFOUND') || msg.includes('ECONN')) {
    return { type: 'network', text: '网络连接失败，请检查网络后重试。' }
  }
  if (msg.includes('没有笔记') || msg.includes('无法蒸馏')) {
    return { type: 'empty', text: msg }
  }
  if (msg.includes('自动导入笔记失败')) {
    return { type: 'import', text: '自动导入笔记失败，请检查微信读书配置后重试。' }
  }
  if (msg.includes('JSON') || msg.includes('解析失败')) {
    return { type: 'parse', text: 'AI 响应格式异常，请重试或更换模型。' }
  }
  if (msg.includes('未配置') || msg.includes('not configured') || msg.includes('API Key')) {
    return { type: 'config', text: 'AI 服务未配置，请在设置中配置 API Key。' }
  }
  return { type: 'unknown', text: msg }
}
