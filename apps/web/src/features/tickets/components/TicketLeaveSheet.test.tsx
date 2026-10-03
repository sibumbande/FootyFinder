import type { MatchTicketContext } from '@footy-finder/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CancelledMatchChoice } from './CancelledMatchChoice.js';
import { TicketLeaveSheet } from './TicketLeaveSheet.js';

const mocks = vi.hoisted(() => ({ leave: vi.fn(), choose: vi.fn() }));
vi.mock('../hooks/useTickets.js', () => ({
  useLeaveTicket: () => ({ mutate: mocks.leave, isPending: false, error: null }),
  useTicketChoice: () => ({ mutate: mocks.choose, isPending: false, error: null, isSuccess: false }),
}));

const context = (overrides: Partial<MatchTicketContext> = {}): MatchTicketContext => ({
  matchId: 'm1',
  feeCents: 8_000,
  ticket: { id: 't1', status: 'CONFIRMED', seat: 'SUBSTITUTE', side: 'HOME', method: 'PAYMENT', amountCents: 8_000, paidByMe: true },
  creditsAvailable: 0,
  bookingRestricted: false,
  policy: [],
  pendingChoices: [],
  leave: { allowed: true, outcome: 'CHOICE' },
  ...overrides,
});

afterEach(() => {
  cleanup();
  mocks.leave.mockReset();
  mocks.choose.mockReset();
});

describe('TicketLeaveSheet (DEC-021 A2)', () => {
  it('more than 24 hours before kick-off: a highlighted match credit, or a refund of R80', () => {
    render(<TicketLeaveSheet matchId="m1" context={context()} onClose={vi.fn()} onLeft={vi.fn()} />);
    const credit = screen.getByRole('button', { name: /Get 1 match credit.*Use it on any match/ });
    expect(credit).toHaveTextContent('Recommended');
    fireEvent.click(credit);
    expect(mocks.leave).toHaveBeenCalledWith('CREDIT', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Refund R80 to my card / bank' }));
    expect(mocks.leave).toHaveBeenLastCalledWith('REFUND', expect.anything());
  });

  it('24 hours or less: says clearly that nothing comes back before leaving', () => {
    render(<TicketLeaveSheet matchId="m1" context={context({ leave: { allowed: true, outcome: 'NOTHING' } })} onClose={vi.fn()} onLeft={vi.fn()} />);
    expect(screen.getByTestId('leave-no-refund')).toHaveTextContent('no refund and no credit');
    expect(screen.queryByRole('button', { name: /match credit/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Leave without a refund' }));
    expect(mocks.leave).toHaveBeenCalledWith(undefined, expect.anything());
  });

  it('a place paid for by a teammate (A5): the player just leaves and the teammate who paid chooses', () => {
    const ticket = { ...context().ticket!, paidByMe: false, payerDisplayName: 'Thabo' };
    const onLeft = vi.fn();
    mocks.leave.mockImplementation((_choice, options: { onSuccess: (result: { outcome: string }) => void }) => options.onSuccess({ outcome: 'PAYER_CHOOSES' }));
    render(<TicketLeaveSheet matchId="m1" context={context({ ticket })} onClose={vi.fn()} onLeft={onLeft} />);
    expect(screen.getByTestId('leave-payer-chooses')).toHaveTextContent('Thabo paid for your place, so they choose what comes back');
    expect(screen.queryByRole('button', { name: /Get 1 match credit/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Leave match' }));
    expect(mocks.leave).toHaveBeenCalledWith(undefined, expect.anything());
    expect(onLeft).toHaveBeenCalledWith('You left the match. Thabo paid for your place, so they choose a match credit or a refund.');
  });
});

describe('CancelledMatchChoice (DEC-021 A3)', () => {
  it('asks the payer to choose a credit or a full refund, with the automatic-refund date', () => {
    const pendingChoices = [{ ticketId: 't1', playerDisplayName: 'Me', amountCents: 8_000, choiceDeadlineAt: '2026-10-10T10:00:00.000Z' }];
    render(<MemoryRouter><CancelledMatchChoice matchId="m1" context={context({ pendingChoices })} /></MemoryRouter>);
    expect(screen.getByTestId('cancelled-match-choice')).toHaveTextContent('If you don’t choose by');
    fireEvent.click(screen.getByRole('button', { name: /Get 1 match credit/ }));
    expect(mocks.choose).toHaveBeenCalledWith('CREDIT');
    fireEvent.click(screen.getByRole('button', { name: 'Refund R80 to my card / bank' }));
    expect(mocks.choose).toHaveBeenLastCalledWith('REFUND');
  });

  it('shows nothing when there is nothing to choose', () => {
    const { container } = render(<MemoryRouter><CancelledMatchChoice matchId="m1" context={context()} /></MemoryRouter>);
    expect(container).toBeEmptyDOMElement();
  });
});
