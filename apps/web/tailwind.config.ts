import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--theme-canvas) / <alpha-value>)',
        surface: 'rgb(var(--theme-surface) / <alpha-value>)',
        'surface-muted': 'rgb(var(--theme-surface-muted) / <alpha-value>)',
        'surface-hover': 'rgb(var(--theme-surface-hover) / <alpha-value>)',
        content: {
          DEFAULT: 'rgb(var(--theme-content) / <alpha-value>)',
          strong: 'rgb(var(--theme-content-strong) / <alpha-value>)',
          muted: 'rgb(var(--theme-content-muted) / <alpha-value>)',
          subtle: 'rgb(var(--theme-content-subtle) / <alpha-value>)',
          inverse: 'rgb(var(--theme-content-inverse) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--theme-line) / <alpha-value>)',
          strong: 'rgb(var(--theme-line-strong) / <alpha-value>)',
        },
        brand: {
          50: 'rgb(var(--theme-brand-50) / <alpha-value>)',
          100: 'rgb(var(--theme-brand-100) / <alpha-value>)',
          200: 'rgb(var(--theme-brand-200) / <alpha-value>)',
          500: 'rgb(var(--theme-brand-500) / <alpha-value>)',
          600: 'rgb(var(--theme-brand-600) / <alpha-value>)',
          700: 'rgb(var(--theme-brand-700) / <alpha-value>)',
          900: 'rgb(var(--theme-brand-900) / <alpha-value>)',
        },
        danger: {
          50: 'rgb(var(--theme-danger-50) / <alpha-value>)',
          200: 'rgb(var(--theme-danger-200) / <alpha-value>)',
          400: 'rgb(var(--theme-danger-400) / <alpha-value>)',
          600: 'rgb(var(--theme-danger-600) / <alpha-value>)',
          700: 'rgb(var(--theme-danger-700) / <alpha-value>)',
        },
        info: {
          50: 'rgb(var(--theme-info-50) / <alpha-value>)',
          200: 'rgb(var(--theme-info-200) / <alpha-value>)',
          600: 'rgb(var(--theme-info-600) / <alpha-value>)',
          700: 'rgb(var(--theme-info-700) / <alpha-value>)',
        },
        warning: {
          50: 'rgb(var(--theme-warning-50) / <alpha-value>)',
          200: 'rgb(var(--theme-warning-200) / <alpha-value>)',
          600: 'rgb(var(--theme-warning-600) / <alpha-value>)',
          700: 'rgb(var(--theme-warning-700) / <alpha-value>)',
        },
        team: {
          home: 'rgb(var(--theme-team-home) / <alpha-value>)',
          'home-muted': 'rgb(var(--theme-team-home-muted) / <alpha-value>)',
          'home-border': 'rgb(var(--theme-team-home-border) / <alpha-value>)',
          away: 'rgb(var(--theme-team-away) / <alpha-value>)',
          'away-muted': 'rgb(var(--theme-team-away-muted) / <alpha-value>)',
          'away-border': 'rgb(var(--theme-team-away-border) / <alpha-value>)',
        },
        pitch: {
          DEFAULT: 'rgb(var(--theme-pitch) / <alpha-value>)',
          alt: 'rgb(var(--theme-pitch-alt) / <alpha-value>)',
          line: 'rgb(var(--theme-pitch-line) / <alpha-value>)',
          border: 'rgb(var(--theme-pitch-border) / <alpha-value>)',
        },
      },
      boxShadow: { soft: '0 16px 40px -20px rgb(var(--theme-shadow) / 0.35)' },
    },
  },
  plugins: [],
} satisfies Config;
