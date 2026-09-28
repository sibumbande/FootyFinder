import type { FormationSnapshot, Match } from '@footy-finder/shared';
import type { QueryClient } from '@tanstack/react-query';

export const matchQueryKey = (id: string) => ['matches', id] as const;

/**
 * Replace the cached lobby formation with an authoritative server snapshot, but only when it is
 * newer than what the cache already holds. Duplicate and out-of-order snapshots are ignored, so a
 * late socket echo can never overwrite a fresher committed formation. Returns whether it applied.
 */
export function applyFormationSnapshot(cache: QueryClient, snapshot: FormationSnapshot) {
  let applied = false;
  cache.setQueryData<Match>(matchQueryKey(snapshot.matchId), (current) => {
    if (!current || snapshot.formationVersion <= (current.formationVersion ?? 0)) return current;
    applied = true;
    return { ...current, formationVersion: snapshot.formationVersion, formationSlots: snapshot.slots };
  });
  return applied;
}

export const isFormationSnapshot = (value: unknown): value is FormationSnapshot =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as FormationSnapshot).matchId === 'string' &&
  typeof (value as FormationSnapshot).formationVersion === 'number' &&
  Array.isArray((value as FormationSnapshot).slots);
