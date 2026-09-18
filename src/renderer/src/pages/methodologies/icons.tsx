/** 设计稿特有的内联 SVG 图标（从 Methodologies.tsx 原样搬出） */

/** AI 提取方法论（麦克风样式） */
function IconAI({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M12 3a1 1 0 0 0-1 1v9a1 1 0 0 0 2 0V4a1 1 0 0 0-1-1z" />
      <path d="M5.5 8a6.5 6.5 0 1 0 13 0" />
      <path d="M5 21h14" />
    </svg>
  )
}

/** 提取/魔杖 */
function IconWand({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M5 3v4" />
      <path d="M19 17v4" />
      <path d="M3 5h4" />
      <path d="M17 19h4" />
      <path d="m14 7 3 3" />
      <path d="m7 14-3-3" />
      <path d="M7 7 4.636 4.636a3 3 0 0 0-0.953 2.16v3.408a3 3 0 0 0 .879 2.121l9.578 9.578a3 3 0 0 0 4.243 0l1.768-1.768a3 3 0 0 0 0-4.243z" />
    </svg>
  )
}

/** 卡片网格视图 */
function IconGrid({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
    </svg>
  )
}

/** 列表视图 */
function IconList({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <line x1="8" x2="21" y1="6" y2="6" />
      <line x1="8" x2="21" y1="12" y2="12" />
      <line x1="8" x2="21" y1="18" y2="18" />
      <line x1="3" x2="3.01" y1="6" y2="6" />
      <line x1="3" x2="3.01" y1="12" y2="12" />
      <line x1="3" x2="3.01" y1="18" y2="18" />
    </svg>
  )
}

/** 按书分组视图 */
function IconBookGroup({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <rect x="7" y="7" width="10" height="10" />
    </svg>
  )
}

/** 练习次数（带勾的圆） */
function IconCheckCircle({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}

/** 书籍（打开的书） */
function IconBookOpen({ size = 14 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" width={size} height={size} aria-hidden="true">
      <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20" />
    </svg>
  )
}

/** 通用 SVG 图标映射（视图切换） */
function ViewToggleIcon({ name, size }: { name: 'grid' | 'list' | 'book-group'; size: number }) {
  if (name === 'grid') return <IconGrid size={size} />
  if (name === 'list') return <IconList size={size} />
  return <IconBookGroup size={size} />
}

export { IconAI, IconWand, IconGrid, IconList, IconBookGroup, IconCheckCircle, IconBookOpen, ViewToggleIcon }
