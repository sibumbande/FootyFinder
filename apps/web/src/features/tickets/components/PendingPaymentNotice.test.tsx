import type { MatchTicketContext, MyMatchTicket } from '@footy-finder/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { PendingPaymentNotice } from './PendingPaymentNotice.js';

const REF = `ff_ticket_${'b'.repeat(32)}`;
const context = (ticket: Partial<MyMatchTicket> | null): MatchTicketContext => ({
  matchId: 'm1',
  feeCents: 8_000,
  ticket: ticket && { id: 't1', status: 'HELD', seat: 'SUBSTITUTE', side: 'HOME', method: 'PAYMENT', amountCents: 8_000, paidByMe: true, ...ticket },
  creditsAvailable: 0,
  bookingRestricted: false,
  policy: [],
  pendingChoices: [],
  leave: { allowed: false, outcome: 'NOTHING', reason: 'NOT_IN_MATCH' },
});
const view = (value: MatchTicketContext) => render(<MemoryRouter><PendingPaymentNotice context={value} /></MemoryRouter>);

afterEach(cleanup);

describe('PendingPaymentNotice (DEC-021 A1.2)', () => {
  it('tells a player whose payment is still open that it is being confirmed, when the hold ends, and links to its status', () => {
    view(context({ holdExpiresAt: '2026-10-07T10:10:00Z', paymentReference: REF }));
    expect(screen.getByRole('heading', { name: 'Your payment is being confirmed' })).toBeInTheDocument();
    expect(screen.getByTestId('pending-payment-notice')).toHaveTextContent('the place is released at 12:10');
    expect(screen.getByRole('link', { name: 'Check my payment' })).toHaveAttribute('href', `/tickets/return?reference=${REF}`);
  });

  it('says nothing for a confirmed place, no ticket, or a place a teammate is paying for', () => {
    for (const value of [context({ status: 'CONFIRMED' }), context(null), context({ paidByMe: false })]) {
      view(value);
      expect(screen.queryByTestId('pending-payment-notice')).toBeNull();
      cleanup();
    }
  });
});
