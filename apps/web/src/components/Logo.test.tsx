import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Logo } from './Logo.js';

// CEO touch-up batch 2, item 2.
describe('Logo', () => {
  it('shows the FF mark and links home', () => {
    const { container } = render(<MemoryRouter><Logo /></MemoryRouter>);
    const link = screen.getByRole('link', { name: 'FootyFinder home' });
    expect(link).toHaveAttribute('href', '/');
    expect(container.querySelector('img')).toHaveAttribute('src', '/logo-96.png');
  });
});
