import { describe, expect, it } from 'vitest';
import { AppError } from '../../errors/app-error.js';
import { assertNonOverlappingAvailability } from './admin-catalog.service.js';

describe('Admin catalogue validation', () => {
  it('accepts adjacent operating periods and separate days', () => {
    expect(() => assertNonOverlappingAvailability({ periods: [
      { dayOfWeek: 1, startMinute: 480, endMinute: 720 },
      { dayOfWeek: 1, startMinute: 720, endMinute: 1080 },
      { dayOfWeek: 2, startMinute: 600, endMinute: 700 },
    ] })).not.toThrow();
  });

  it('rejects overlapping operating periods with a stable public error', () => {
    try {
      assertNonOverlappingAvailability({ periods: [
        { dayOfWeek: 5, startMinute: 600, endMinute: 900 },
        { dayOfWeek: 5, startMinute: 800, endMinute: 1000 },
      ] });
      throw new Error('Expected overlap to be rejected.');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('FIELD_AVAILABILITY_OVERLAP');
    }
  });
});
