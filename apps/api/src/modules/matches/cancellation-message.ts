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
const CANCELLED_BECAUSE: Record<MatchCancellationReason, string> = {
  POSITIONS_UNFILLED: 'because not every position was filled 30 minutes before kickoff',
  ORGANISER_CANCELLED: 'by the host',
  // Gate 7 team matches (DEC-019).
  TEAM_FEES_UNFUNDED: "because a team fee wasn't fully paid 30 minutes before kickoff",
  NO_OPPONENT: "because the other side wasn't taken in time",
  TEAM_CANCELLED: 'by the home team',
  // Gate 8 (DEC-020, D2).
  NO_REFEREE: 'because no FootyFinder referee was available',
};

export const isMatchCancellationReason = (value: unknown): value is MatchCancellationReason =>
  typeof value === 'string' && value in CANCELLED_BECAUSE;

export const matchCancelledMessage = (input: {
  venueName: string;
  startsAt: Date;
  reason: MatchCancellationReason;
  refundedCents: number;
  /** Gate 7: the recipient is on a team whose held fill-meter money was released. */
  teamMember?: boolean;
}) => {
  const first = `Your match at ${input.venueName} on ${formatMatchDate(input.startsAt)} at ${formatKickoffTime(input.startsAt)} was cancelled ${CANCELLED_BECAUSE[input.reason]}.`;
  const refund = input.refundedCents > 0
    ? ` Your ${formatRands(input.refundedCents)} has been refunded to your FootyFinder wallet.`
    : '';
  const team = input.teamMember ? ' Any money held for this match has gone back to your team wallet.' : '';
  return `${first}${refund}${team}`;
};
