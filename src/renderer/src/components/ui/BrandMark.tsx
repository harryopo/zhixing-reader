import type { CSSProperties } from 'react'

/**
 * 品牌徽标 — 几何与 brand/mark.svg 逐字一致（tests/brand-assets.test.ts 会比对），
 * 改形状请改 SVG 源，不要只改这里。
 *
 * 颜色刻意不跟主题走 --primary：暗色档的 --primary 是 emerald-500 (#10b981)，
 * 白色台阶压上去实测只有 2.54:1；恒用 emerald-600 时白台阶 3.77:1、
 * 对暗侧栏底 #131316 也有 4.92:1，两种主题下都不弱。
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
      <rect x="2" y="2" width="44" height="44" rx="10" fill="#059669" />
      <path fill="#ffffff" d="M12 36V28h8v-8h8v-8h8v24z" />
    </svg>
  )
}
