/** 掌握度标签/进度与触发场景配色（从 Methodologies.tsx 原样搬出，逻辑未改） */
import { safeNum, safeStr } from '../../utils/db-mapper'
import { TRIGGER_PALETTE, type MethodologyItem } from './model'


/** 掌握度等级标签（与设计稿一致：精通 / 熟练 / 进阶 / 入门） */
function getMasteryLabel(level: number): string {
  const pct = Math.min(Math.max(safeNum(level), 0), 100)
  if (pct >= 80) return '精通'
  if (pct >= 60) return '熟练'
  if (pct >= 30) return '进阶'
  return '入门'
}

/** 掌握度进度（0-100，clamp） */
function getMasteryProgress(level: number): number {
  return Math.min(Math.max(safeNum(level), 0), 100)
}

/** 为方法论计算触发徽章（文本 + 配色） */
function getTriggerBadge(
  m: MethodologyItem,
  index: number,
): { text: string; bg: string; color: string } | null {
  let text = ''
  if (m.tags && m.tags.length > 0) {
    text = safeStr(m.tags[0])
  } else if (m.triggerScenario) {
    const s = safeStr(m.triggerScenario)
    text = s.length > 6 ? `${s.slice(0, 6)}…` : s
  }
  if (!text) return null
  const palette = TRIGGER_PALETTE[index % TRIGGER_PALETTE.length]
  return { text, bg: palette.bg, color: palette.color }
}

export { getMasteryLabel, getMasteryProgress, getTriggerBadge }
