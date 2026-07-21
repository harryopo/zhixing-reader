/** @type {import('tailwindcss').Config} */
// Tailwind v4 主要 token 由 src/renderer/src/styles/design-tokens.css 的 @theme inline 定义
// 此文件保留 darkMode 和 content 扫描路径
module.exports = {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      // 字体族（与 design-tokens.css 中 --font-sans/mono 保持一致）
      fontFamily: {
        sans: ['DM Sans', 'ui-sans-serif', 'sans-serif', 'system-ui'],
        mono: ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
    },
  },
  plugins: [],
}
