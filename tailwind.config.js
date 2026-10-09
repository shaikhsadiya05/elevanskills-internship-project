/** @type {import('tailwindcss').Config} */
const neutralShades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];
const themeScale = (prefix) => Object.fromEntries(neutralShades.map((shade) => [shade, `rgb(var(--theme-${prefix}-${shade}) / <alpha-value>)`]));

module.exports = {
  darkMode: 'class',
  content: ['./app/**/*.{js,ts,jsx,tsx,mdx}', './src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        zinc: themeScale('zinc'),
        yellow: {
          300: 'rgb(var(--theme-yellow-300) / <alpha-value>)',
          400: 'rgb(var(--theme-yellow-400) / <alpha-value>)',
          500: 'rgb(var(--theme-yellow-500) / <alpha-value>)',
        },
      },
    },
  },
  plugins: [],
}

