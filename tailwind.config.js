/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#D97706',
          light: '#FEF3C7',
          hover: '#B45309'
        }
      }
    }
  },
  plugins: []
}
