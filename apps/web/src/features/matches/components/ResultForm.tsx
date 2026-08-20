import type { MatchParticipant } from '@footy-finder/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { Input } from '@/components/ui/Input.js';
import { useNotifications } from '@/features/notifications/NotificationProvider.js';
import { useSubmitResult } from '../hooks/useMatches.js';
export function ResultForm({
  matchId,
  participants,
}: {
  matchId: string;
  participants: MatchParticipant[];
}) {
  const [homeScore, setHomeScore] = useState('0');
  const [awayScore, setAwayScore] = useState('0');
  const [goals, setGoals] = useState<Record<string, string>>({});
  const result = useSubmitResult(matchId);
  const { notify } = useNotifications();
  const submit = () =>
    result.mutate(
      {
        homeScore: Number(homeScore),
        awayScore: Number(awayScore),
        scorers: participants.flatMap((participant) =>
          Number(goals[participant.id] ?? 0) > 0
            ? [{ participantId: participant.id, goals: Number(goals[participant.id]) }]
            : [],
        ),
      },
      {
        onSuccess: () =>
          notify({
            variant: 'success',
            title: 'Full-time result saved',
            message: 'The score and scorers are now final.',
          }),
      },
    );
  return (
    <section className="rounded-3xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="text-xl font-bold text-content-strong">Submit full-time result</h2>
      <p className="mt-1 text-sm text-content-muted">Scorer totals must match each team score.</p>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <Input
          label="Home score"
          type="number"
          min="0"
          value={homeScore}
          onChange={(event) => setHomeScore(event.target.value)}
        />
        <Input
          label="Away score"
          type="number"
          min="0"
          value={awayScore}
          onChange={(event) => setAwayScore(event.target.value)}
        />
      </div>
      <div className="mt-4 grid gap-2">
        {participants.map((participant) => (
          <label
            key={participant.id}
            className="flex items-center gap-3 rounded-xl bg-surface-muted p-3 text-sm"
          >
            <span
              className={`size-2 rounded-full ${participant.team === 'HOME' ? 'bg-team-home' : 'bg-team-away'}`}
            />
            <span className="min-w-0 flex-1 truncate font-semibold text-content">
              {participant.user?.displayName}
            </span>
            <input
              aria-label={`Goals by ${participant.user?.displayName}`}
              className="w-20 rounded-lg border border-line-strong bg-surface px-2 py-1"
              type="number"
              min="0"
              value={goals[participant.id] ?? '0'}
              onChange={(event) =>
                setGoals((current) => ({ ...current, [participant.id]: event.target.value }))
              }
            />
          </label>
        ))}
      </div>
      <FormError message={result.error?.message} />
      <Button className="mt-4 w-full" loading={result.isPending} onClick={submit}>
        Submit final result
      </Button>
    </section>
  );
}
