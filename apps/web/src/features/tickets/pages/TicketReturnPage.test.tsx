import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TicketReturnPage } from './TicketReturnPage.js';

const mocks = vi.hoisted(() => ({ query: { data: undefined as unknown, error: null, isFetching: false, dataUpdatedAt: 0, refetch: vi.fn() }, reference: null as string | null }));
vi.mock('../hooks/useTickets.js', () => ({
  useCheckoutByReference: (reference: string | null) => {
    mocks.reference = reference;
    return mocks.query;
  },
}));
const REF = `ff_ticket_${'a'.repeat(32)}`;
const view = (search: string) => render(<MemoryRouter initialEntries={[`/tickets/return${search}`]}><TicketReturnPage /></MemoryRouter>);
const result = (state: string, extra = {}) => ({ checkoutId: 'c1', matchId: 'm1', method: 'PAYMENT', state, amountCents: 8_000, ticketIds: ['t1'], ...extra });

afterEach(() => {
  cleanup();
  mocks.query.data = undefined;
});

describe('TicketReturnPage (DEC-021 A1.3)', () => {
  it('only asks our server about a valid ticket reference', () => {
    view('?reference=../../wallet');
    expect(mocks.reference).toBeNull();
    expect(screen.getByRole('heading', { name: 'We couldn’t find that payment' })).toBeInTheDocument();
  });

  it('waits for our server, then takes the player to the match lobby with their place confirmed', () => {
    mocks.query.data = result('PROCESSING');
    const routes = () => (
      <MemoryRouter initialEntries={[`/tickets/return?trxref=${REF}`]}>
        <Routes>
          <Route path="/tickets/return" element={<TicketReturnPage />} />
          <Route path="/matches/:matchId" element={<h1>Match lobby</h1>} />
        </Routes>
      </MemoryRouter>
    );
    const { rerender } = render(routes());
    expect(mocks.reference).toBe(REF);
    expect(screen.getByRole('heading', { name: 'Confirming your payment…' })).toBeInTheDocument();
    mocks.query.data = result('CONFIRMED');
    rerender(routes());
    expect(screen.getByRole('heading', { name: 'Match lobby' })).toBeInTheDocument();
  });

  it('reads the reference PayFast returns with (our own return_url)', () => {
    mocks.query.data = result('PROCESSING');
    view(`?reference=${REF}`);
    expect(mocks.reference).toBe(REF);
  });

  it('explains an automatic refund when the place was gone, and an unpaid checkout', () => {
    mocks.query.data = result('FAILED', { refundReason: 'Someone else took that position while you were paying.' });
    view(`?reference=${REF}`);
    expect(screen.getByRole('heading', { name: 'Your payment is being refunded' })).toBeInTheDocument();
    cleanup();
    mocks.query.data = result('EXPIRED');
    view(`?reference=${REF}`);
    expect(screen.getByRole('heading', { name: 'Payment not completed' })).toBeInTheDocument();
  });
});
