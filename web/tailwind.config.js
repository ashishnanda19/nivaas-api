const c = (n) => `rgb(var(--${n}) / <alpha-value>)`
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: c('bg'), surface: c('surface'), sunken: c('sunken'), line: c('line'), 'line-strong': c('line-strong'),
        fg: c('fg'), muted: c('muted'), accent: c('accent'), 'accent-hover': c('accent-hover'),
        'accent-tint': c('accent-tint'), ink: c('accent-ink'),
        success: c('success'), 'success-tint': c('success-tint'),
        warning: c('warning'), 'warning-tint': c('warning-tint'),
        danger: c('danger'), 'danger-tint': c('danger-tint'),
      },
      fontFamily: { sans: ['"Inter Variable"', '"Noto Sans Devanagari"', 'system-ui', 'sans-serif'] },
      borderRadius: { card: '12px', ctl: '8px' },
      boxShadow: { float: '0 8px 30px rgb(15 23 42 / 0.14)' },
      keyframes: { shimmer: { '100%': { transform: 'translateX(100%)' } } },
    },
  },
  plugins: [],
}
