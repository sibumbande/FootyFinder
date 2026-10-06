import type { MyTicketsOverview } from '@footy-finder/shared';
import { cleanup, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TicketsPage } from './TicketsPage.js';

const mocks = vi.hoisted(() => ({ query: { data: undefined as MyTicketsOverview | undefined, error: null, isPending: false } }));
vi.mock('../hooks/useTickets.js', () => ({ useMyTickets: () => mocks.query }));

const ticket = (overrides: Partial<MyTicketsOverview['upcoming'][number]> = {}): MyTicketsOverview['upcoming'][number] => ({
  id: 't1',
  matchId: 'm1',
  matchName: 'Friday 5s',
  venueName: 'Italian Club',
  startsAt: '2026-10-30T12:00:00.000Z',
  matchStatus: 'OPEN',
  seat: 'POSITION',
  side: 'HOME',
  status: 'CONFIRMED',
  method: 'PAYMENT',
  amountCents: 8_000,
  playerDisplayName: 'Sibulele',
  isMine: true,
  paidByMe: true,
  paymentMethodLabel: 'Card',
  ...overrides,
});
const overview = (overrides: Partial<MyTicketsOverview> = {}): MyTicketsOverview => ({
  upcoming: [],
  past: [],
  creditsAvailable: 0,
  credits: [],
  refunds: [],
  bookingRestricted: false,
  ...overrides,
});
const view = () => render(<MemoryRouter><TicketsPage /></MemoryRouter>);

afterEach(() => {
  cleanup();
  mocks.query.data = undefined;
});

describe('TicketsPage (DEC-021 "Tickets & credits")', () => {
  it('counts credits in matches with their expiry, never in rands or as a wallet', () => {
    mocks.query.data = overview({
      creditsAvailable: 2,
      credits: [
        { id: 'c1', status: 'AVAILABLE', reason: 'LEFT_MATCH', issuedAt: '2026-10-02T10:00:00.000Z', expiresAt: '2029-10-02T10:00:00.000Z' },
        { id: 'c2', status: 'AVAILABLE', reason: 'MATCH_CANCELLED', issuedAt: '2026-10-03T10:00:00.000Z', expiresAt: '2029-10-03T10:00:00.000Z' },
        { id: 'c3', status: 'USED', reason: 'LEFT_MATCH', issuedAt: '2026-09-01T10:00:00.000Z', expiresAt: '2029-09-01T10:00:00.000Z', usedOnMatchName: 'Sunday 7s' },
      ],
    });
    view();
    const credits = screen.getByTestId('match-credits');
    expect(credits).toHaveTextContent('You have 2 match credits');
    expect(credits).toHaveTextContent('Valid until 2 Oct 2029');
    expect(credits).toHaveTextContent('Used on Sunday 7s');
    expect(credits).not.toHaveTextContent(/R\d/);
    expect(screen.queryByText(/\b(wallet|balance|top.?up|funds)\b/i)).toBeNull();
  });

  it('shows upcoming tickets with the method used, teammates paid for, and a pending cancellation choice', () => {
    mocks.query.data = overview({
      upcoming: [
        ticket(),
        ticket({ id: 't2', seat: 'TEAM', isMine: false, playerDisplayName: 'Sipho Ndlovu' }),
        ticket({ id: 't3', status: 'CHOICE_PENDING', matchStatus: 'CANCELLED', choiceDeadlineAt: '2026-11-06T12:00:00.000Z' }),
      ],
      past: [ticket({ id: 't4', method: 'CREDIT', amountCents: 0, outcome: 'FORFEITED', paymentMethodLabel: undefined })],
    });
    view();
    const rows = screen.getAllByTestId('ticket-row');
    expect(rows[0]).toHaveTextContent('Paid R80 · Card');
    expect(within(rows[0]!).getByRole('link', { name: 'Friday 5s' })).toHaveAttribute('href', '/matches/m1');
    expect(rows[1]).toHaveTextContent('For Sipho Ndlovu');
    expect(rows[2]).toHaveTextContent(/Match cancelled: choose a match credit or a refund by/);
    expect(rows[3]).toHaveTextContent('Paid with 1 match credit');
    expect(rows[3]).toHaveTextContent('Left within 24 hours of kick-off · no refund');
  });

  it('lists refunds with their status and where the money goes, and explains a dispute restriction', () => {
    mocks.query.data = overview({
      bookingRestricted: true,
      refunds: [{ id: 'r1', amountCents: 8_000, state: 'NEEDS_BANK_DETAILS', matchName: 'Friday 5s', paymentMethodLabel: 'Instant EFT', createdAt: '2026-10-02T10:00:00.000Z' }],
    });
    view();
    const refund = screen.getByTestId('refund-row');
    expect(refund).toHaveTextContent('Back to Instant EFT');
    expect(refund).toHaveTextContent('Waiting for your bank details');
    expect(refund).toHaveTextContent('R80');
    expect(screen.getByRole('alert')).toHaveTextContent('payment dispute is open');
  });
});
