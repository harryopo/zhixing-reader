import type { CSSProperties } from 'react'

/**
 * 品牌徽标「玉璧」— 环与方的坐标和 brand/mark.svg 逐字一致
 * （tests/brand-assets.test.ts 会比对四处派生物），改形状请改 SVG 源。
 *
 * 环走 --brand-mark：浅底是墨绿、深底自动反白成宣纸色；铜金方两种主题下都不动。
 * 刻意不复用 --primary：那是 UI 交互色（emerald），品牌墨是另一个口径。
 */
export default function BrandMark({ size = 40, style }: { size?: number; style?: CSSProperties }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0, display: 'block', ...style }}
    >
      <path d="M32 10.14A16 16 0 1 0 40 24" fill="none" stroke="var(--brand-mark)" stroke-width="6" />
      <rect x="35" y="13" width="6" height="6" fill="var(--brand-brass)" />
    </svg>
  )
}
