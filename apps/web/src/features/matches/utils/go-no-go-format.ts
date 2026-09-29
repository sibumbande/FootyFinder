/** Cape Town is the launch city; venue times are shown in South African time. */
const VENUE_TIME_ZONE = 'Africa/Johannesburg';

/** "13:30" in venue time. */
export const formatClock = (iso: string) =>
  new Intl.DateTimeFormat('en-ZA', {
    timeZone: VENUE_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));

/** "Fri 30 Oct 2026" in venue time. */
export const formatMatchDay = (iso: string) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: VENUE_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatToParts(new Date(iso));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')} ${part('year')}`;
};

/** "13:30 on 30 Oct 2026" in venue time. */
export const formatGoNoGoTime = (iso: string) => {
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: VENUE_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(iso));
  return `${formatClock(iso)} on ${day}`;
};

export const rands = (cents: number) =>
  `R${Number.isInteger(cents / 100) ? cents / 100 : (cents / 100).toFixed(2)}`;
