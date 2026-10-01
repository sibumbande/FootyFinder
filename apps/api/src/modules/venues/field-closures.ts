/**
 * CEO touch-up batch 3, item 3: field closures. A one-off closure is an absolute time range; a weekly closure is a
 * day and local times in the venue's timezone (e.g. Mondays 18:00-20:00) from `startsOn`, optionally until
 * `endsOn` (both local dates, inclusive). Used by slot listing and by booking, so a closed time can never be
 * offered or booked.
 */
export interface FieldClosureRow {
  kind: 'ONE_OFF' | 'WEEKLY';
  startsAt: Date | null;
  endsAt: Date | null;
  dayOfWeek: number | null;
  startMinute: number | null;
  endMinute: number | null;
  startsOn: Date | null;
  endsOn: Date | null;
}

const localDayOf = (date: Date, timezone: string) => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short' }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return {
    iso: `${value('year')}-${value('month')}-${value('day')}`,
    weekday: ({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 } as const)[value('weekday') as 'Sun'],
  };
};

/** The UTC instant of a local date and minute of day in `timezone` (minute 1440 = the next midnight). */
const localInstant = (isoDate: string, minuteOfDay: number, timezone: string) => {
  const [year, month, day] = isoDate.split('-').map(Number) as [number, number, number];
  const desired = Date.UTC(year, month - 1, day, 0, minuteOfDay);
  let instant = desired;
  for (let pass = 0; pass < 4; pass += 1) {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant));
    const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? 0);
    const observed = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'));
    const delta = desired - observed;
    if (!delta) break;
    instant += delta;
  }
  return new Date(instant);
};

const isoDate = (date: Date) => date.toISOString().slice(0, 10);

/** True when [startsAt, endsAt) overlaps any of the closures. */
export function overlapsClosure(closures: FieldClosureRow[], startsAt: Date, endsAt: Date, timezone: string) {
  if (!closures.length) return false;
  // A booking spans at most two local days; check each day it touches.
  const days = [localDayOf(startsAt, timezone), localDayOf(new Date(endsAt.getTime() - 1), timezone)];
  return closures.some((closure) => {
    if (closure.kind === 'ONE_OFF') return Boolean(closure.startsAt && closure.endsAt && closure.startsAt < endsAt && closure.endsAt > startsAt);
    if (closure.dayOfWeek === null || closure.startMinute === null || closure.endMinute === null || !closure.startsOn) return false;
    return days.some((day) => {
      if (day.weekday !== closure.dayOfWeek) return false;
      if (day.iso < isoDate(closure.startsOn!) || (closure.endsOn && day.iso > isoDate(closure.endsOn))) return false;
      const from = localInstant(day.iso, closure.startMinute!, timezone);
      const to = localInstant(day.iso, closure.endMinute!, timezone);
      return from < endsAt && to > startsAt;
    });
  });
}

/** Active (not removed) closures, for Prisma includes. */
export const activeClosures = { where: { removedAt: null } } as const;
