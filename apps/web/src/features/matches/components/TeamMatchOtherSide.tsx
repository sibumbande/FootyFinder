import {
  decideOtherSide,
  effectiveOtherSide,
  formatTeamFeeBreakdown,
  getGoNoGoAt,
  getTeamFee,
  isLobbyFrozen,
  MAX_SUBSTITUTES_PER_TEAM,
  OTHER_SIDE_REFUSAL_MESSAGE,
  type Match,
} from '@footy-finder/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { useNotifications } from '@/features/notifications/NotificationProvider.js';
import { useMyTeams } from '@/features/teams/hooks/useTeams.js';
import { formatRands } from '@/utils/format-currency.js';
import {
  useClaimPosition,
  useJoinMatch,
  useLeaveMatch,
  useLoadTeamIntoMatch,
  useWithdrawTeamFromMatch,
} from '../hooks/useMatches.js';
import { formatClock } from '../utils/go-no-go-format.js';
import { FriendButton } from '@/features/social/components/FriendButton.js';

/**
 * Gate 7 / DEC-019 decisions B, C, N1, N5: the other side of a public team match. The first team
 * to "Load my team" or (for "Open to both") the first player to join takes it straight away.
 * The team that took it may withdraw only itself before the 30-minute check.
 */
export function TeamMatchOtherSide({ match }: { match: Match }) {
  const { user } = useAuth();
  const { notify } = useNotifications();
  const myTeams = useMyTeams();
  const load = useLoadTeamIntoMatch(match.id);
  const withdraw = useWithdrawTeamFromMatch(match.id);
  const join = useJoinMatch(match.id);
  const leave = useLeaveMatch(match.id);
  const claim = useClaimPosition(match.id);
  const [loading, setLoading] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [subs, setSubs] = useState(3);
  if (!match.otherSideMode) return null;
  const home = match.teamSides.find(({ side }) => side === 'HOME');
  const away = match.teamSides.find(({ side }) => side === 'AWAY');
  const individuals = (match.participants ?? []).filter(({ team }) => team === 'AWAY');
  const takenBy = effectiveOtherSide(match.otherSideTakenBy ?? null, individuals.length);
  const locked = isLobbyFrozen(match) || !['OPEN', 'READY', 'FULL'].includes(match.status);
  const lockAt = formatClock(getGoNoGoAt(match.startsAt).toISOString());
  const myParticipant = individuals.find(({ userId }) => userId === user?.id);
  const onHomeTeam = match.viewerTeamSide === 'HOME';
  const loadableTeams = (myTeams.data ?? []).filter(
    (team) => (team.viewerRole === 'OWNER' || team.viewerRole === 'CAPTAIN') && !team.archivedAt && team.id !== home?.teamId,
  );
  const teamDecision = decideOtherSide({ mode: match.otherSideMode, takenBy, joinedIndividuals: individuals.length }, 'TEAM');
  const playerDecision = decideOtherSide({ mode: match.otherSideMode, takenBy, joinedIndividuals: individuals.length }, 'INDIVIDUAL');
  const fee = getTeamFee(match.format, subs);
  const awaySlots = (match.formationSlots ?? []).filter(({ team }) => team === 'AWAY');

  return (
    <section className="grid gap-4 rounded-3xl border border-line bg-surface p-5 sm:p-6" aria-labelledby="other-side-heading">
      <div>
        <h2 id="other-side-heading" className="text-xl font-bold text-content-strong">The other side</h2>
        <p className="mt-1 text-sm text-content-muted">
          {match.otherSideMode === 'TEAMS_ONLY'
            ? 'Teams only: the first team to load its squad takes the other side.'
            : 'Open to both: the first team to load its squad, or individual players (R80 each), take the other side, whichever comes first.'}
          {' '}It locks at {lockAt}.
        </p>
      </div>

      {takenBy === 'TEAM' && away && (
        <div className="rounded-2xl bg-surface-muted p-4">
          <p className="font-bold text-content-strong">{away.teamNameSnapshot} took the other side.</p>
          {match.viewerManagedTeamSide === 'AWAY' && !locked && (
            <Button
              className="mt-3"
              variant="secondary"
              loading={withdraw.isPending}
              onClick={() => {
                if (!window.confirm(`Withdraw ${away.teamNameSnapshot} from this match? Any money held from your team wallet is released, and the other side opens again.`)) return;
                withdraw.mutate(undefined, { onSuccess: () => notify({ variant: 'info', title: 'Team withdrawn', message: 'Your team left the match. Held money went back to your team wallet.' }) });
              }}
            >
              Withdraw my team
            </Button>
          )}
          <FormError message={withdraw.error?.message} />
        </div>
      )}

      {takenBy !== 'TEAM' && !locked && loadableTeams.length > 0 && !onHomeTeam && (
        <div className="rounded-2xl border border-line p-4">
          {'reason' in teamDecision ? (
            <p className="text-sm text-content-muted">{OTHER_SIDE_REFUSAL_MESSAGE[teamDecision.reason]}</p>
          ) : !loading ? (
            <Button onClick={() => { setLoading(true); setTeamId(loadableTeams[0]!.id); }}>Load my team</Button>
          ) : (
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                load.mutate({ teamId, substituteCount: subs }, {
                  onSuccess: () => {
                    setLoading(false);
                    notify({ variant: 'success', title: 'Your team is in', message: 'Fill your team meter from the team wallet before the 30-minute check.' });
                  },
                });
              }}
            >
              <label className="grid gap-1 text-sm font-bold text-content-strong">
                Team
                <select className="rounded-xl border-2 border-line bg-canvas p-2" value={teamId} onChange={(event) => setTeamId(event.target.value)}>
                  {loadableTeams.map((team) => <option key={team.id} value={team.id}>{team.name}</option>)}
                </select>
              </label>
              <label className="grid gap-1 text-sm font-bold text-content-strong">
                Subs your team brings
                <input
                  className="rounded-xl border-2 border-line bg-canvas p-2"
                  type="number"
                  min={0}
                  max={MAX_SUBSTITUTES_PER_TEAM}
                  value={subs}
                  onChange={(event) => setSubs(Math.max(0, Math.min(MAX_SUBSTITUTES_PER_TEAM, Math.trunc(Number(event.target.value) || 0))))}
                />
              </label>
              <p data-testid="load-team-fee" className="rounded-xl bg-brand-50 p-3 text-sm font-black text-brand-800">{formatTeamFeeBreakdown(fee)}</p>
              <p className="text-xs text-content-muted">
                Your team takes the side straight away. Nothing is taken now: a captain fills your team meter from the team wallet, and it is taken only if the match goes ahead.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" loading={load.isPending}>Confirm and load my team</Button>
                <Button type="button" variant="ghost" onClick={() => setLoading(false)}>Not now</Button>
              </div>
            </form>
          )}
          <FormError message={load.error?.message} />
        </div>
      )}

      {match.otherSideMode === 'OPEN' && takenBy !== 'TEAM' && (
        <div className="rounded-2xl border border-line p-4">
          <p className="font-bold text-content-strong">
            Players on the other side: {individuals.length}
            {' · '}
            {awaySlots.filter(({ participantId }) => participantId).length} of {awaySlots.length} positions claimed
          </p>
          {!myParticipant && !locked && !onHomeTeam && !('reason' in playerDecision) && (
            <Button
              className="mt-3"
              variant="secondary"
              loading={join.isPending}
              onClick={() => {
                if (!window.confirm(`Join the other side for ${formatRands(match.feeCents)} from your wallet? The match goes ahead only if it's ready by ${lockAt}; otherwise your ${formatRands(match.feeCents)} is refunded.`)) return;
                join.mutate({ team: 'AWAY' });
              }}
            >
              Join as a player ({formatRands(match.feeCents)})
            </Button>
          )}
          {join.error && (
            <p className="mt-2 text-sm">
              <FormError message={join.error.message} />
              {/enough funds/i.test(join.error.message) && (
                <Link className="font-bold underline" to={`/wallet?returnTo=${encodeURIComponent(`/matches/${match.id}`)}#top-up`}>Top up your wallet</Link>
              )}
            </p>
          )}
          {myParticipant && (
            <div className="mt-3 grid gap-2">
              <ul className="grid gap-1 text-sm">
                {awaySlots.map((slot) => (
                  <li key={slot.id} className="flex items-center justify-between gap-2">
                    <span>Position {slot.slotIndex + 1}: {slot.participant?.user?.displayName ?? slot.participant?.user?.username ?? 'open'}</span>
                    {slot.participant && <FriendButton userId={slot.participant.userId} />}
                    {!slot.participantId && !locked && (
                      <Button variant="ghost" loading={claim.isPending} onClick={() => claim.mutate(slot.id)}>Claim</Button>
                    )}
                  </li>
                ))}
              </ul>
              {!locked && (
                <Button variant="ghost" loading={leave.isPending} onClick={() => { if (window.confirm('Leave this match? More than 12 hours before kickoff your R80 comes back to your wallet; after that, only if a paid player takes your place.')) leave.mutate(); }}>
                  Leave the match
                </Button>
              )}
              <FormError message={claim.error?.message ?? leave.error?.message} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
