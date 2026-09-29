import type { MatchCancellationReason } from '@footy-finder/shared';

/** Cape Town is the launch city; venue times are shown in South African time. */
const VENUE_TIME_ZONE = 'Africa/Johannesburg';

const part = (parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) =>
  parts.find((item) => item.type === type)?.value ?? '';

/** "Fri 30 Oct 2026" in venue time. */
export const formatMatchDate = (date: Date) => {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: VENUE_TIME_ZONE,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatToParts(date);
  return `${part(parts, 'weekday')} ${part(parts, 'day')} ${part(parts, 'month')} ${part(parts, 'year')}`;
};

/** "14:00" in venue time. */
export const formatKickoffTime = (date: Date) =>
  new Intl.DateTimeFormat('en-ZA', {
    timeZone: VENUE_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);

export const formatRands = (cents: number) =>
  `R${Number.isInteger(cents / 100) ? cents / 100 : (cents / 100).toFixed(2)}`;

/**
 * Player-facing cancellation wording shared by the in-app notification and the email, so both
 * always say the same thing. The refund sentence is only added when this user was refunded.
 */
export const matchCancelledMessage = (input: {
  venueName: string;
  startsAt: Date;
  reason: MatchCancellationReason;
  refundedCents: number;
}) => {
  const why =
    input.reason === 'POSITIONS_UNFILLED'
      ? 'because not every position was filled 30 minutes before kickoff'
      : 'by the host';
  const first = `Your match at ${input.venueName} on ${formatMatchDate(input.startsAt)} at ${formatKickoffTime(input.startsAt)} was cancelled ${why}.`;
  return input.refundedCents > 0
    ? `${first} Your ${formatRands(input.refundedCents)} has been refunded to your FootyFinder wallet.`
    : first;
};
