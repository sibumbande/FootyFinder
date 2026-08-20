import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TeamRoster } from './TeamRoster.js';
describe('TeamRoster', () => {
  it('renders an empty team roster', () => {
    render(<TeamRoster team="HOME" participants={[]} />);
    expect(screen.getByRole('heading', { name: 'Home Team' })).toBeInTheDocument();
    expect(screen.getByText('No players yet.')).toBeInTheDocument();
  });
});
