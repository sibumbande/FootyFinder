import type { RefereeMatchDetail } from '@footy-finder/shared';
import { useSubmitRefereeResult } from '../hooks/useReferee.js';
import { ResultEntryForm } from './ResultEntryForm.js';

/** Gate 8 / TKT-805: the referee records the final result (D5). */
export function RefereeResultForm({ match }: { match: RefereeMatchDetail }) {
  const submit = useSubmitRefereeResult(match.matchId);
  return (
    <ResultEntryForm
      sides={match.sides}
      lineup={match.lineup}
      mode="referee"
      onSubmit={(input) => submit.mutate(input)}
      pending={submit.isPending}
      submitted={submit.isSuccess}
      error={submit.error?.message}
    />
  );
}
