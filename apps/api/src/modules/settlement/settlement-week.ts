/**
 * TKT-608 / D10: venues are settled weekly, Monday 00:00 to the next Monday 00:00 in
 * Africa/Johannesburg (UTC+02:00 all year; South Africa has no daylight saving).
 */
export const SETTLEMENT_OFFSET = '+02:00';

export function settlementWeek(weekStart: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStart)) return null;
  const periodStart = new Date(`${weekStart}T00:00:00.000${SETTLEMENT_OFFSET}`);
  if (Number.isNaN(periodStart.getTime())) return null;
  // Monday in Johannesburg: the UTC instant is Sunday 22:00, so check the local calendar day.
  const local = new Date(periodStart.getTime() + 2 * 3_600_000);
  if (local.getUTCDay() !== 1 || local.toISOString().slice(0, 10) !== weekStart) return null;
  return { periodStart, periodEnd: new Date(periodStart.getTime() + 7 * 86_400_000) };
}

/** The Monday (YYYY-MM-DD, Johannesburg) of the week containing the instant. */
export function settlementWeekOf(instant: Date) {
  const local = new Date(instant.getTime() + 2 * 3_600_000);
  const back = (local.getUTCDay() + 6) % 7;
  local.setUTCDate(local.getUTCDate() - back);
  return local.toISOString().slice(0, 10);
}
