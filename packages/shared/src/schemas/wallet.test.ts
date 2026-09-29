import { describe, expect, it } from 'vitest';
import { topUpAmountSchema, walletHistoryQuerySchema } from './wallet.js';

describe('topUpAmountSchema (DEC-011)', () => {
  it.each([5_000, 16_000, 500_000])('accepts R%d cents', (amountCents) => {
    expect(topUpAmountSchema.parse({ amountCents })).toEqual({ amountCents });
  });

  it.each([
    ['below R50', 4_900],
    ['one cent below R50', 4_999],
    ['above R5,000', 500_001],
    ['R5,001', 500_100],
    ['zero', 0],
    ['negative', -5_000],
    ['non-whole rand', 5_050],
    ['fractional cents', 5_000.5],
  ])('rejects %s', (_label, amountCents) => {
    expect(topUpAmountSchema.safeParse({ amountCents }).success).toBe(false);
  });

  it('rejects strings, missing amounts and currency confusion', () => {
    expect(topUpAmountSchema.safeParse({ amountCents: '5000' }).success).toBe(false);
    expect(topUpAmountSchema.safeParse({}).success).toBe(false);
    expect(topUpAmountSchema.parse({ amountCents: 5_000, currency: 'USD' })).toEqual({ amountCents: 5_000 });
  });
});

describe('walletHistoryQuerySchema', () => {
  it('defaults and bounds the page size', () => {
    expect(walletHistoryQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(walletHistoryQuerySchema.parse({ limit: '50' })).toEqual({ limit: 50 });
    expect(walletHistoryQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
  });
});
