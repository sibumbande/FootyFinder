import { describe, expect, it } from 'vitest';
import { ticketPlanFor } from './account-deletion.preview.js';

const now = new Date('2026-10-06T10:00:00Z');
const in48h = new Date('2026-10-08T10:00:00Z');
const in12h = new Date('2026-10-06T22:00:00Z');
const ticket = (overrides: Partial<{ method: 'PAYMENT' | 'CREDIT' | 'FREE'; payerId: string; amountCents: number }> = {}) => ({
  method: 'PAYMENT' as const,
  payerId: 'me',
  amountCents: 8_000,
  ...overrides,
});

describe('ticketPlanFor (DEC-021 D11: what deleting your account does to an upcoming ticket)', () => {
  it('refunds a place you paid for more than 24 hours before kick-off, to the payment method', () => {
    expect(ticketPlanFor(ticket(), 'me', in48h, now)).toEqual({ outcome: 'REFUNDED', refundCents: 8_000 });
  });

  it('gives a credit-paid place its credit back, and leaves a teammate-paid place to the payer', () => {
    expect(ticketPlanFor(ticket({ method: 'CREDIT', amountCents: 0 }), 'me', in48h, now)).toEqual({ outcome: 'CREDIT_BACK', refundCents: 0 });
    expect(ticketPlanFor(ticket({ payerId: 'thabo' }), 'me', in48h, now)).toEqual({ outcome: 'PAYER_CHOOSES', refundCents: 0 });
  });

  it('forfeits any paid place 24 hours or less before kick-off, and a free place has nothing to give back', () => {
    expect(ticketPlanFor(ticket(), 'me', in12h, now)).toEqual({ outcome: 'FORFEITED', refundCents: 0 });
    expect(ticketPlanFor(ticket({ payerId: 'thabo' }), 'me', in12h, now)).toEqual({ outcome: 'FORFEITED', refundCents: 0 });
    expect(ticketPlanFor(ticket({ method: 'FREE', amountCents: 0 }), 'me', in48h, now)).toEqual({ outcome: 'NOTHING_PAID', refundCents: 0 });
    expect(ticketPlanFor(undefined, 'me', in48h, now)).toEqual({ outcome: 'NOTHING_PAID', refundCents: 0 });
  });
});
