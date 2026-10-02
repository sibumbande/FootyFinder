import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareMatchActions, buildMatchShareText, whatsAppShareUrl } from './ShareMatchActions.js';

const facts = {
  canonicalUrl: 'https://footy.example/m/m-0123456789abcdef01234567',
  name: 'Friday football',
  venueName: 'Queens Park',
  startsAt: '2099-09-28T16:00:00.000Z',
  filled: 7,
  total: 10,
  feeCents: 8_000,
};

const setNavigator = (key: 'share' | 'clipboard', value: unknown) =>
  Object.defineProperty(navigator, key, { configurable: true, value });

afterEach(() => {
  cleanup();
  setNavigator('share', undefined);
  setNavigator('clipboard', undefined);
  vi.restoreAllMocks();
});

describe('ShareMatchActions', () => {
  it('uses Web Share with live facts and the canonical URL', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    setNavigator('share', share);
    setNavigator('clipboard', { writeText: vi.fn() });
    render(<ShareMatchActions facts={facts} />);

    fireEvent.click(screen.getByRole('button', { name: 'Share match' }));

    await waitFor(() =>
      expect(share).toHaveBeenCalledWith({
        title: facts.name,
        text: buildMatchShareText(facts),
        url: facts.canonicalUrl,
      }),
    );
  });

  it('copies the canonical URL when Web Share is unavailable', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    setNavigator('share', undefined);
    setNavigator('clipboard', { writeText });
    render(<ShareMatchActions facts={facts} />);

    fireEvent.click(screen.getByRole('button', { name: 'Share match' }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith(facts.canonicalUrl));
    expect(screen.getByText('Canonical match link copied.')).toBeInTheDocument();
  });

  it('encodes WhatsApp content without campaign or referral identifiers', () => {
    const url = new URL(whatsAppShareUrl(facts));
    const text = url.searchParams.get('text');
    expect(url.origin).toBe('https://wa.me');
    expect(text).toContain(facts.name);
    expect(text).toContain(facts.canonicalUrl);
    expect(text).toContain('7/10 players');
    expect(text).not.toMatch(/utm_|campaign|referral/i);
  });

  it('exposes the canonical URL when the Clipboard API is unavailable', async () => {
    setNavigator('share', undefined);
    setNavigator('clipboard', undefined);
    render(<ShareMatchActions facts={facts} />);

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));

    // Batch 5 brief, B2: shown in an in-app dialog, never a browser prompt.
    await waitFor(() => expect(screen.getByTestId('share-link')).toHaveTextContent(facts.canonicalUrl));
    expect(screen.getByRole('dialog', { name: 'Copy this match link' })).toBeInTheDocument();
    expect(screen.getByText('Canonical match link ready to copy.')).toBeInTheDocument();
  });
});
