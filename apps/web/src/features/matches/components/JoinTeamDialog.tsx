import { getMaxParticipantsPerTeam, type Match, type TeamSide } from '@footy-finder/shared';
import { ApiError } from '@footy-finder/api-client';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { useNotifications } from '@/features/notifications/NotificationProvider.js';
import { formatRands } from '@/utils/format-currency.js';
import { QUICK_MATCH_SIDE_BADGES, QUICK_MATCH_SIDE_LABELS } from '../constants/quick-match-sides.js';
import { useJoinMatch } from '../hooks/useMatches.js';
import { formatClock, rands } from '../utils/go-no-go-format.js';
export function JoinTeamDialog({
  match,
  open,
  onClose,
}: {
  match: Match;
  open: boolean;
  onClose: () => void;
}) {
  const [team, setTeam] = useState<TeamSide>('HOME');
  const { user } = useAuth();
  const join = useJoinMatch(match.id);
  const { notify } = useNotifications();
  if (!open) return null;
  const limit = getMaxParticipantsPerTeam(match.format, match.substituteCapacityPerTeam);
  const insufficient = join.error instanceof ApiError && join.error.code === 'INSUFFICIENT_BALANCE';
  const submit = () =>
    join.mutate(
      { team },
      {
        onSuccess: () => {
          notify({
            variant: 'success',
            title: 'Place confirmed',
            message: `You joined the ${QUICK_MATCH_SIDE_LABELS[team]} reserves.`,
          });
          onClose();
        },
      },
    );
  const shortfallCents = Math.max(0, match.feeCents - (user?.balanceCents ?? 0));
  const topUpHref = `/wallet?amount=${Math.max(5_000, Math.ceil(shortfallCents / 100) * 100)}&returnTo=${encodeURIComponent(`/matches/${match.id}`)}#top-up`;
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-end bg-content-strong/40 p-0 sm:place-items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Choose a team"
    >
      <div className="w-full max-w-lg rounded-t-3xl border border-line bg-surface p-6 shadow-soft sm:rounded-3xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-bold text-content-strong">Choose your team</h2>
            <p className="mt-1 text-sm text-content-muted">
              You will start in reserves. After joining, tap an open position on your team to claim it.
            </p>
          </div>
          <button aria-label="Close" onClick={onClose} className="text-2xl text-content-muted">
            ×
          </button>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-3">
          {(['HOME', 'AWAY'] as const).map((side) => {
            const count = side === 'HOME' ? match.homeParticipantCount : match.awayParticipantCount;
            const full = count >= limit;
            return (
              <button
                key={side}
                disabled={full}
                onClick={() => setTeam(side)}
                className={`rounded-2xl border p-5 text-left ${side === 'HOME' ? 'border-team-home-border bg-team-home-muted text-team-home' : 'border-team-away-border bg-team-away-muted text-team-away'} ${team === side ? 'ring-4 ring-brand-100' : ''} disabled:opacity-50`}
              >
                <strong className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className={`grid size-6 place-items-center rounded-full text-xs font-black text-content-inverse ${side === 'HOME' ? 'bg-team-home' : 'bg-team-away'}`}
                  >
                    {QUICK_MATCH_SIDE_BADGES[side]}
                  </span>
                  {QUICK_MATCH_SIDE_LABELS[side]}
                </strong>
                <span className="mt-2 block text-sm">
                  {count}/{limit} players
                </span>
                <span className="mt-1 block text-xs font-bold">
                  {full ? 'Team full' : `${limit - count} spaces`}
                </span>
              </button>
            );
          })}
        </div>
        <dl className="mt-5 grid grid-cols-2 gap-3 rounded-xl bg-surface-muted p-4 text-sm">
          <div>
            <dt className="text-content-muted">Match fee</dt>
            <dd className="font-bold text-content-strong">{formatRands(match.feeCents)}</dd>
          </div>
          <div>
            <dt className="text-content-muted">Wallet</dt>
            <dd className="font-bold text-content-strong">
              {formatRands(user?.balanceCents ?? 0)}
            </dd>
          </div>
        </dl>
        {match.goNoGoAt && (
          <p
            data-testid="join-go-no-go-notice"
            className="mt-4 rounded-xl border border-warning-300 bg-warning-50 p-3 text-sm font-semibold text-content"
          >
            This match goes ahead only if every position is filled by {formatClock(match.goNoGoAt)} (30
            minutes before kickoff). If not, it&apos;s cancelled automatically and your{' '}
            {rands(match.feeCents)} is refunded to your wallet.
          </p>
        )}
        {join.error && (
          <p className="mt-4 text-sm font-semibold text-danger-700">{join.error.message}</p>
        )}
        {insufficient && (
          <div className="mt-4 rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm text-warning-700">
            You need {formatRands(shortfallCents)} more. Top up your wallet, then come back to join.
          </div>
        )}
        <div className="mt-5 grid gap-2 sm:grid-cols-2">
          {insufficient ? (
            <Link className="button text-center" to={topUpHref}>
              Top up wallet
            </Link>
          ) : (
            <Button loading={join.isPending} onClick={submit}>
              Pay & join {QUICK_MATCH_SIDE_LABELS[team]}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Not now
          </Button>
        </div>
      </div>
    </div>
  );
}
