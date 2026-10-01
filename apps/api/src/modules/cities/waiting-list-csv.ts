// CEO touch-up batch 3.5, item 4: the waiting-list CSV (pure helpers, unit-tested).
const SOURCES: Record<string, string> = { WAITING_LIST_PAGE: 'Waiting list page', ONBOARDING: 'Onboarding' };
export const sourceLabel = (source: string) => SOURCES[source] ?? source;
/** South African calendar date (UTC+2, no daylight saving), e.g. 2026-10-01. */
export const saDate = (at: Date) => new Date(at.getTime() + 2 * 3_600_000).toISOString().slice(0, 10);

/** One CSV cell: quoted, quotes doubled, and a leading = + - @ (or tab/CR) neutralised so Excel never runs it. */
export const csvCell = (value: string) => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
};

export const toWaitingListCsv = (rows: Array<{ email: string; cityName: string; signedUpAt: Date; source: string }>) =>
  [['Email', 'City', 'Signed up', 'Source'], ...rows.map((row) => [row.email, row.cityName, saDate(row.signedUpAt), sourceLabel(row.source)])]
    .map((cells) => cells.map(csvCell).join(','))
    .join('\r\n') + '\r\n';

