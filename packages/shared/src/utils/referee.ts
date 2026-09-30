import { getMatchEndsAt } from './match-lifecycle.js';

/** Gate 8 / D27: travel time a referee needs between two matches. */
export const REFEREE_TRAVEL_BUFFER_MINUTES = 30;
/** Gate 8 / D2: admins are alerted this long before kickoff if a match still has no referee. */
export const REFEREE_UNASSIGNED_ALERT_HOURS = 24;

export interface RefereeWindowSource {
  startsAt: string | Date;
  durationMinutes: number;
}

/**
 * D27: the time a referee is busy with a match, from kickoff to the scheduled end plus the travel
 * buffer. Example: 14:00 kickoff, 60 minutes -> busy 14:00 to 15:30.
 */
export const getRefereeWindow = (match: RefereeWindowSource) => ({
  start: new Date(match.startsAt),
  end: new Date(getMatchEndsAt(match).getTime() + REFEREE_TRAVEL_BUFFER_MINUTES * 60_000),
});

/**
 * D27: two matches clash for one referee when their busy windows overlap. Windows that only touch
 * (one ends exactly when the other starts) do not clash.
 */
export const refereeWindowsOverlap = (a: RefereeWindowSource, b: RefereeWindowSource) => {
  const first = getRefereeWindow(a);
  const second = getRefereeWindow(b);
  return first.start < second.end && second.start < first.end;
};
