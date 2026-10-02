import type { Match } from '@footy-finder/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TicketConfirmSheet } from './TicketConfirmSheet.js';

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), state: { isPending: false, error: null as Error | null, data: undefined as unknown }, context: { creditsAvailable: 0, bookingRestricted: false } }));
vi.mock('../hooks/useTickets.js', () => ({
  useBuyTicket: () => ({ mutate: mocks.mutate, ...mocks.state }),
  useTicketContext: () => ({ data: mocks.context }),
}));

const match = {
  id: 'm1',
  name: 'Thursday 5s',
  startsAt: '2026-10-08T16:00:00.000Z',
  feeCents: 8_000,
  freeOnFootyFinder: false,
  venue: { name: 'Green Point Astro', city: 'Cape Town' },
} as unknown as Match;

afterEach(() => {
  cleanup();
  mocks.mutate.mockReset();
  mocks.state = { isPending: false, error: null, data: undefined };
  mocks.context = { creditsAvailable: 0, bookingRestricted: false };
});

describe('TicketConfirmSheet (DEC-021 A1.1)', () => {
  it('shows the match, place, price and policy, and needs the tick before paying R80', () => {
    render(<TicketConfirmSheet match={match} place={{ seat: 'POSITION', side: 'HOME', slotId: 's1', slotIndex: 3 }} onClose={vi.fn()} onConfirmed={vi.fn()} />);
    const sheet = screen.getByRole('dialog', { name: 'Buy your match ticket' });
    expect(sheet).toHaveTextContent('Thursday 5s');
    expect(sheet).toHaveTextContent('Green Point Astro, Cape Town');
    expect(sheet).toHaveTextContent('Position 3 · Home side');
    expect(sheet).toHaveTextContent('R80');
    expect(screen.getByTestId('ticket-policy')).toHaveTextContent('Leave more than 24 hours before kick-off');
    expect(screen.getByTestId('ticket-policy')).toHaveTextContent('refunded automatically');
    const pay = screen.getByRole('button', { name: 'Pay R80 · Card / Instant EFT' });
    expect(pay).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand the cancellation policy' }));
    fireEvent.click(pay);
    expect(mocks.mutate).toHaveBeenCalledWith(
      { input: { seat: 'POSITION', side: 'HOME', slotId: 's1', method: 'PAYMENT', acceptPolicy: true }, idempotencyKey: expect.any(String) },
      expect.anything(),
    );
  });

  it('with a match credit, "Use 1 match credit" is the main button and paying is the alternative (A4)', () => {
    mocks.context = { creditsAvailable: 2, bookingRestricted: false };
    render(<TicketConfirmSheet match={match} place={{ seat: 'SUBSTITUTE', side: 'HOME' }} onClose={vi.fn()} onConfirmed={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand the cancellation policy' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('You have 2 match credits.');
    fireEvent.click(screen.getByRole('button', { name: 'Use 1 match credit' }));
    expect(mocks.mutate.mock.calls[0]![0].input.method).toBe('CREDIT');
    fireEvent.click(screen.getByRole('button', { name: 'Pay R80 instead' }));
    expect(mocks.mutate.mock.calls[1]![0].input.method).toBe('PAYMENT');
    expect(mocks.mutate.mock.calls[0]![0].idempotencyKey).not.toBe(mocks.mutate.mock.calls[1]![0].idempotencyKey);
  });

  it('a disputed payment blocks buying, with the reason (D9)', () => {
    mocks.context = { creditsAvailable: 0, bookingRestricted: true };
    render(<TicketConfirmSheet match={match} place={{ seat: 'SUBSTITUTE', side: 'HOME' }} onClose={vi.fn()} onConfirmed={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand the cancellation policy' }));
    expect(screen.getByRole('alert')).toHaveTextContent('disputed with your bank');
    expect(screen.getByRole('button', { name: 'Pay R80 · Card / Instant EFT' })).toBeDisabled();
  });

  it('asks which side for a substitute place, and offers a free match for R0', () => {
    render(<TicketConfirmSheet match={{ ...match, freeOnFootyFinder: true, feeCents: 0 }} place={{ seat: 'SUBSTITUTE' }} onClose={vi.fn()} onConfirmed={vi.fn()} />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'I understand the cancellation policy' }));
    const join = screen.getByRole('button', { name: 'Join for free' });
    expect(join).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Away' }));
    fireEvent.click(join);
    expect(mocks.mutate.mock.calls[0]![0].input).toEqual({ seat: 'SUBSTITUTE', side: 'AWAY', method: 'PAYMENT', acceptPolicy: true });
    expect(screen.getByTestId('ticket-policy')).toHaveTextContent('nothing is paid');
  });

  it('shows the error inline and keeps the sheet open', () => {
    mocks.state.error = new Error('Someone is paying for that position right now.');
    render(<TicketConfirmSheet match={match} place={{ seat: 'SUBSTITUTE', side: 'HOME' }} onClose={vi.fn()} onConfirmed={vi.fn()} />);
    expect(screen.getByRole('dialog')).toHaveTextContent('Someone is paying for that position right now.');
  });
});
