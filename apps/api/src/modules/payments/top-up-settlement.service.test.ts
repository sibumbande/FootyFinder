import { describe, expect, it } from 'vitest';
import { evaluateVerification } from './top-up-settlement.service.js';

const payment = {
  id: 'payment-1',
  userId: 'user-1',
  reference: 'ff_topup_1',
  amountCents: 16_000,
  createdAt: new Date('2026-10-01T10:00:00Z'),
};
const verified = (overrides: Record<string, unknown> = {}) => ({
  id: '42',
  reference: 'ff_topup_1',
  status: 'success',
  amountCents: 16_000,
  currency: 'ZAR',
  channel: 'card',
  metadata: { providerPaymentId: 'payment-1', userId: 'user-1' },
  ...overrides,
});
const open = { finalAttempt: false };
const final = { finalAttempt: true };

describe('evaluateVerification (TKT-604 / D11)', () => {
  it('credits only a matching, successful card payment in ZAR', () => {
    expect(evaluateVerification(payment, verified(), open)).toEqual({ kind: 'CREDIT' });
    expect(evaluateVerification(payment, verified({ metadata: {} }), open)).toEqual({ kind: 'CREDIT' });
  });

  it.each([
    ['amount', { amountCents: 15_900 }, 'amount_mismatch'],
    ['currency', { currency: 'NGN' }, 'currency_mismatch'],
    ['channel', { channel: 'eft' }, 'channel_not_card'],
    ['reference', { reference: 'ff_topup_2' }, 'reference_mismatch'],
    ['payment metadata', { metadata: { providerPaymentId: 'other' } }, 'metadata_payment_mismatch'],
    ['user metadata', { metadata: { userId: 'someone-else' } }, 'metadata_user_mismatch'],
  ])('sends a %s mismatch to review instead of crediting', (_label, overrides, reason) => {
    expect(evaluateVerification(payment, verified(overrides), open)).toEqual({ kind: 'REVIEW', reason });
  });

  it('fails declined and reversed payments', () => {
    expect(evaluateVerification(payment, verified({ status: 'failed' }), open)).toEqual({ kind: 'FAIL', reason: 'failed' });
    expect(evaluateVerification(payment, verified({ status: 'reversed' }), open)).toEqual({ kind: 'FAIL', reason: 'reversed' });
  });

  it('waits on open states until the final attempt', () => {
    for (const status of ['abandoned', 'ongoing', 'pending', 'processing', 'queued'])
      expect(evaluateVerification(payment, verified({ status }), open)).toEqual({ kind: 'WAIT' });
    expect(evaluateVerification(payment, verified({ status: 'abandoned' }), final)).toEqual({ kind: 'FAIL', reason: 'abandoned' });
    expect(evaluateVerification(payment, verified({ status: 'ongoing' }), final)).toEqual({
      kind: 'REVIEW',
      reason: 'still_ongoing_after_max_age',
    });
  });

  it('treats a reference Paystack has never seen as open, then failed', () => {
    expect(evaluateVerification(payment, null, open)).toEqual({ kind: 'WAIT' });
    expect(evaluateVerification(payment, null, final)).toEqual({ kind: 'FAIL', reason: 'not_found_at_provider' });
  });
});
