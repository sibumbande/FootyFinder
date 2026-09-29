import { describe, expect, it } from 'vitest';
import { teamContributionRefundSchema, teamContributionSchema, teamWalletHistoryQuerySchema } from './team-wallet.js';

describe('teamContributionSchema (DEC-014 / D4)', () => {
  it.each([1_000, 8_000, 112_000, 500_000])('accepts %d cents', (amountCents) => {
    expect(teamContributionSchema.parse({ amountCents })).toEqual({ amountCents });
  });

  it.each([
    ['below R10', 900],
    ['one cent below R10', 999],
    ['above R5,000', 500_100],
    ['zero', 0],
    ['negative', -1_000],
    ['non-whole rand', 1_050],
    ['fractional cents', 1_000.5],
  ])('rejects %s', (_label, amountCents) => {
    expect(teamContributionSchema.safeParse({ amountCents }).success).toBe(false);
  });

  it('rejects strings and missing amounts', () => {
    expect(teamContributionSchema.safeParse({ amountCents: '1000' }).success).toBe(false);
    expect(teamContributionSchema.safeParse({}).success).toBe(false);
  });
});

describe('teamContributionRefundSchema (D8)', () => {
  it('accepts a whole-rand amount and rejects part rands and zero', () => {
    expect(teamContributionRefundSchema.parse({ amountCents: 100 })).toEqual({ amountCents: 100 });
    expect(teamContributionRefundSchema.safeParse({ amountCents: 150 }).success).toBe(false);
    expect(teamContributionRefundSchema.safeParse({ amountCents: 0 }).success).toBe(false);
  });
});

describe('teamWalletHistoryQuerySchema', () => {
  it('defaults and bounds the page size', () => {
    expect(teamWalletHistoryQuerySchema.parse({})).toEqual({ limit: 20 });
    expect(teamWalletHistoryQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
  });
});
