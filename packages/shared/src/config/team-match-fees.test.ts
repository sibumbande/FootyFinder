import { describe, expect, it } from 'vitest';
import { formatRandAmount, formatTeamFeeBreakdown, getTeamFee } from './team-match-fees.js';

describe('DEC-019 team fee', () => {
  it('charges R80 per starting position plus R80 per chosen sub (the CEO example)', () => {
    const fee = getTeamFee('ELEVEN_A_SIDE', 3);
    expect(fee).toMatchObject({ starterCount: 11, substituteCount: 3, startersCents: 88_000, substitutesCents: 24_000, totalCents: 112_000 });
    expect(formatTeamFeeBreakdown(fee)).toBe('R880 (11 players) + R240 (3 subs) = R1,120');
  });

  it('calculates each format and allows zero to ten subs', () => {
    expect(getTeamFee('FIVE_A_SIDE', 0).totalCents).toBe(40_000);
    expect(getTeamFee('SEVEN_A_SIDE', 1).totalCents).toBe(64_000);
    expect(formatTeamFeeBreakdown(getTeamFee('SEVEN_A_SIDE', 1))).toBe('R560 (7 players) + R80 (1 sub) = R640');
    expect(getTeamFee('ELEVEN_A_SIDE', 10).totalCents).toBe(168_000);
    expect(() => getTeamFee('FIVE_A_SIDE', 11)).toThrow(RangeError);
    expect(() => getTeamFee('FIVE_A_SIDE', -1)).toThrow(RangeError);
    expect(() => getTeamFee('FIVE_A_SIDE', 1.5)).toThrow(RangeError);
  });

  it('formats rand amounts without locale surprises', () => {
    expect(formatRandAmount(112_000)).toBe('R1,120');
    expect(formatRandAmount(8_000)).toBe('R80');
    expect(formatRandAmount(1_250)).toBe('R12.50');
    expect(formatRandAmount(123_456_700)).toBe('R1,234,567');
  });
});
