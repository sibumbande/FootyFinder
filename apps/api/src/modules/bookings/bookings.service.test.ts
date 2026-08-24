import { describe, expect, it } from 'vitest';
import { isWithinFieldAvailability } from './bookings.service.js';

const field = {
  venue: { timezone: 'Africa/Johannesburg' },
  availabilityPeriods: [{ dayOfWeek: 1, startMinute: 8 * 60, endMinute: 22 * 60 }],
  exceptions: [] as Array<{ startsAt: Date; endsAt: Date; available: boolean }>,
};
describe('field booking availability', () => {
  it('uses the venue timezone and weekly operating interval', () => {
    expect(isWithinFieldAvailability(field, new Date('2026-08-24T16:00:00Z'), new Date('2026-08-24T17:30:00Z'))).toBe(true);
    expect(isWithinFieldAvailability(field, new Date('2026-08-24T21:00:00Z'), new Date('2026-08-24T22:30:00Z'))).toBe(false);
  });
  it('lets a closure override weekly hours and an opening exception cover closed time', () => {
    const start = new Date('2026-08-24T16:00:00Z'); const end = new Date('2026-08-24T17:30:00Z');
    expect(isWithinFieldAvailability({ ...field, exceptions: [{ startsAt: start, endsAt: end, available: false }] }, start, end)).toBe(false);
    const lateStart = new Date('2026-08-24T21:00:00Z'); const lateEnd = new Date('2026-08-24T22:30:00Z');
    expect(isWithinFieldAvailability({ ...field, exceptions: [{ startsAt: lateStart, endsAt: lateEnd, available: true }] }, lateStart, lateEnd)).toBe(true);
  });
});
