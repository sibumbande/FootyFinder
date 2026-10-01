import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VenueAbout } from './VenueAbout.js';

// CEO touch-up batch 3, item 2.
describe('VenueAbout', () => {
  it('shows the bio as plain text and opens links safely in a new tab', () => {
    render(<VenueAbout aboutText={'Floodlit pitches.\n<b>Not HTML</b>'} links={[{ type: 'INSTAGRAM', label: 'Instagram', url: 'https://instagram.com/club' }]} />);
    expect(screen.getByRole('heading', { name: 'About this venue' })).toBeInTheDocument();
    expect(screen.getByText(/<b>Not HTML<\/b>/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /Instagram/ });
    expect(link).toHaveAttribute('href', 'https://instagram.com/club');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  });
});
