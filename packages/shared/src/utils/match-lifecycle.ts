import type { MatchStatus } from '../types/match.js';

export interface LifecycleSource {
  status: MatchStatus;
  startsAt: string | Date;
  durationMinutes: number;
}

export function getMatchEndsAt(match: Pick<LifecycleSource, 'startsAt' | 'durationMinutes'>) {
  return new Date(new Date(match.startsAt).getTime() + match.durationMinutes * 60_000);
}

export function getEffectiveMatchStatus(match: LifecycleSource, now = new Date()): MatchStatus {
  if (match.status === 'CANCELLED' || match.status === 'COMPLETED') return match.status;
  if (match.status === 'DRAFT') return 'DRAFT';
  if (now >= getMatchEndsAt(match)) return 'AWAITING_RESULT';
  if (now >= new Date(match.startsAt)) return 'IN_PROGRESS';
  if (match.status === 'FULL') return 'FULL';
  return match.status === 'READY' ? 'READY' : 'OPEN';
}

export const canChangeLobby = (match: LifecycleSource, now = new Date()) =>
  ['DRAFT', 'OPEN', 'READY', 'FULL'].includes(getEffectiveMatchStatus(match, now));

/**
 * DEC-018 go/no-go. A Quick Match goes ahead only if every formation position is claimed by
 * GO_NO_GO_MINUTES_BEFORE_KICKOFF before kickoff (subs are optional). From that instant the lobby is
 * frozen (D1): no joins, leaves, claims, team changes, organiser moves, or host cancellation.
 * Example: kickoff 30 Oct 2026 14:00 -> go/no-go check at 13:30.
 */
export const GO_NO_GO_MINUTES_BEFORE_KICKOFF = 30;

export const getGoNoGoAt = (startsAt: string | Date) =>
  new Date(new Date(startsAt).getTime() - GO_NO_GO_MINUTES_BEFORE_KICKOFF * 60_000);

/** True once a DEC-018 match (goNoGoAt set) has reached its go/no-go instant. Legacy matches never freeze. */
export const isLobbyFrozen = (
  match: { goNoGoAt?: string | Date | null },
  now = new Date(),
) => Boolean(match.goNoGoAt) && now.getTime() >= new Date(match.goNoGoAt!).getTime();

export const CANCELLATION_CUTOFF_HOURS = 12;

export function getCancellationCreditCents(
  feeCents: number,
  startsAt: string | Date,
  now = new Date(),
) {
  const millisecondsUntilKickoff = new Date(startsAt).getTime() - now.getTime();
  if (millisecondsUntilKickoff <= 0) return null;
  return millisecondsUntilKickoff > CANCELLATION_CUTOFF_HOURS * 60 * 60 * 1_000 ? feeCents : 0;
}
