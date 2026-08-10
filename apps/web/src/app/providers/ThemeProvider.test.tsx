import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ThemeToggle } from '@/components/ThemeToggle.js';
import { ThemeProvider } from './ThemeProvider.js';

afterEach(() => {
  localStorage.clear();
  document.documentElement.classList.remove('dark');
});

describe('ThemeProvider', () => {
  it('toggles dark mode and persists the selection', () => {
    localStorage.setItem('footy-finder-theme', 'light');
    render(<ThemeProvider><ThemeToggle /></ThemeProvider>);

    fireEvent.click(screen.getByRole('button', { name: 'Switch to dark mode' }));

    expect(document.documentElement).toHaveClass('dark');
    expect(localStorage.getItem('footy-finder-theme')).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light mode' })).toBeInTheDocument();
  });
});
