import type { AccountDeletionPreview } from '@footy-finder/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DeleteAccountPage } from './DeleteAccountPage.js';

const mocks = vi.hoisted(() => ({ preview: undefined as AccountDeletionPreview | undefined }));
vi.mock('../hooks/useAccount.js', () => ({
  useDeletionPreview: () => ({ data: mocks.preview, isPending: false, error: null, refetch: vi.fn() }),
  useRequestDeletion: () => ({ mutate: vi.fn(), isPending: false, error: null }),
}));

const preview = (overrides: Partial<AccountDeletionPreview> = {}): AccountDeletionPreview => ({
  canDelete: true,
  blockers: [],
  matches: [],
  teams: [],
  credits: { refunded: 0, lapsing: 0, paymentMethods: [] },
  graceDays: 14,
  scheduledFor: '2026-10-20T10:00:00.000Z',
  ...overrides,
});
const view = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <DeleteAccountPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

afterEach(() => cleanup());

describe('DeleteAccountPage (DEC-021 D11)', () => {
  it('says unused credits from a paid ticket are refunded to the card/bank, and other credits lapse', () => {
    mocks.preview = preview({ credits: { refunded: 2, lapsing: 1, paymentMethods: ['card', 'eft'] } });
    view();
    expect(screen.getByTestId('credits-refunded')).toHaveTextContent('Your 2 unused match credits will be refunded to your card/bank (card, Instant EFT)');
    expect(screen.getByTestId('credits-lapsing')).toHaveTextContent('Your 1 unused match credit that did not come from a payment');
    expect(screen.queryByText(/\b(wallet|balance|top.?up|funds)\b/i)).toBeNull();
  });

  it('explains each upcoming ticket by the 24-hour rule', () => {
    mocks.preview = preview({
      matches: [
        { matchId: 'm1', name: 'Friday 5s', startsAt: '2026-10-09T16:00:00.000Z', outcome: 'REFUNDED', refundCents: 8_000 },
        { matchId: 'm2', name: 'Saturday 7s', startsAt: '2026-10-06T16:00:00.000Z', outcome: 'FORFEITED', refundCents: 0 },
      ],
    });
    view();
    expect(screen.getByText(/R80 is refunded to the card or bank you paid with/)).toBeInTheDocument();
    expect(screen.getByText(/24 hours or less before kick-off, so nothing is refunded/)).toBeInTheDocument();
  });
});
