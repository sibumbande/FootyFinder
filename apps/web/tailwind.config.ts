import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        pitch: { 50: '#f2f8f4', 100: '#dcefe2', 500: '#278a4b', 600: '#1d713b', 700: '#185b32', 900: '#123522' },
        ink: '#142019',
      },
      boxShadow: { soft: '0 16px 40px -20px rgba(20, 32, 25, 0.28)' },
    },
  },
  plugins: [],
} satisfies Config;
