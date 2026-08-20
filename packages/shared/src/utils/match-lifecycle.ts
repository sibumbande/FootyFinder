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
  if (now >= getMatchEndsAt(match)) return 'AWAITING_RESULT';
  if (now >= new Date(match.startsAt)) return 'IN_PROGRESS';
  return match.status === 'READY' ? 'READY' : 'OPEN';
}

export const canChangeLobby = (match: LifecycleSource, now = new Date()) =>
  ['OPEN', 'READY'].includes(getEffectiveMatchStatus(match, now));

export function getCancellationCreditCents(
  feeCents: number,
  startsAt: string | Date,
  now = new Date(),
) {
  const millisecondsUntilKickoff = new Date(startsAt).getTime() - now.getTime();
  if (millisecondsUntilKickoff <= 0) return null;
  return millisecondsUntilKickoff > 8 * 60 * 60 * 1_000 ? feeCents : Math.floor(feeCents / 2);
}
