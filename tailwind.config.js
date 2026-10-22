/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      colors: {
        ink: {
          DEFAULT: '#0f172a',
          900: '#0f172a',
          800: '#1e293b',
          700: '#334155',
          600: '#475569',
          500: '#64748b',
          400: '#94a3b8',
        },
        canvas: '#f6f7f9',
        line: '#e6e8ec',
        brand: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#5b5bd6',
          600: '#4a47c9',
          700: '#3d3aa8',
          800: '#322f86',
          900: '#28266a',
        },
      },
      fontSize: {
        '2xs': ['0.6875rem', { lineHeight: '1rem' }],
      },
      boxShadow: {
        card: '0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 1px rgba(15, 23, 42, 0.02)',
        pop: '0 10px 30px -10px rgba(15, 23, 42, 0.25), 0 2px 6px rgba(15, 23, 42, 0.06)',
        drawer: '-12px 0 40px -12px rgba(15, 23, 42, 0.25)',
      },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'fade-out': { from: { opacity: '1' }, to: { opacity: '0' } },
        'slide-in-right': { from: { transform: 'translateX(100%)' }, to: { transform: 'translateX(0)' } },
        'slide-out-right': { from: { transform: 'translateX(0)' }, to: { transform: 'translateX(100%)' } },
        'scale-in': { from: { opacity: '0', transform: 'scale(0.97) translateY(4px)' }, to: { opacity: '1', transform: 'scale(1) translateY(0)' } },
        'slide-up': { from: { opacity: '0', transform: 'translateY(6px)' }, to: { opacity: '1', transform: 'translateY(0)' } },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 150ms ease-out',
        'fade-out': 'fade-out 150ms ease-in',
        'slide-in-right': 'slide-in-right 260ms cubic-bezier(0.32, 0.72, 0, 1)',
        'slide-out-right': 'slide-out-right 200ms ease-in',
        'scale-in': 'scale-in 160ms cubic-bezier(0.32, 0.72, 0, 1)',
        'slide-up': 'slide-up 220ms ease-out',
      },
    },
  },
  plugins: [],
};
