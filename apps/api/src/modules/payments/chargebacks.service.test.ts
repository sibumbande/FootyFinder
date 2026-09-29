import { describe, expect, it } from 'vitest';
import { disputeOutcome } from './chargebacks.service.js';

describe('disputeOutcome (TKT-606 / D2)', () => {
  it('restores the credit only when the chargeback was declined in our favour', () => {
    expect(disputeOutcome('declined')).toBe('WON');
    expect(disputeOutcome('auto-declined')).toBe('WON');
    expect(disputeOutcome('merchant-accepted')).toBe('LOST');
    expect(disputeOutcome('auto-accepted')).toBe('LOST');
  });

  it('leaves unknown resolutions open for finance', () => {
    expect(disputeOutcome(undefined)).toBeNull();
    expect(disputeOutcome('pending')).toBeNull();
  });
});
