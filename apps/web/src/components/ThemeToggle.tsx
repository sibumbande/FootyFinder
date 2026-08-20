import { useTheme } from '@/app/providers/ThemeProvider.js';

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  const nextTheme = theme === 'light' ? 'dark' : 'light';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className="grid size-10 shrink-0 place-items-center rounded-xl border border-line bg-surface text-content-muted transition hover:bg-surface-hover hover:text-content-strong focus:outline-none focus:ring-4 focus:ring-brand-100"
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
    >
      {theme === 'light' ? (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M12 3V1m0 22v-2m9-9h2M1 12h2m16.36-6.36 1.42-1.42M3.22 20.78l1.42-1.42m14.72 0 1.42 1.42M3.22 3.22l1.42 1.42" />
          <circle cx="12" cy="12" r="4" />
        </svg>
      ) : (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        >
          <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z" />
        </svg>
      )}
    </button>
  );
}
