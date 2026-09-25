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
