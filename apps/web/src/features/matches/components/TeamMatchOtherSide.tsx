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
  useLoadTeamIntoMatch,
  useWithdrawTeamFromMatch,
} from '../hooks/useMatches.js';
import { formatClock } from '../utils/go-no-go-format.js';
import { FriendButton } from '@/features/social/components/FriendButton.js';
import { useConfirm } from '@/components/ui/ConfirmDialog.js';
import { TicketConfirmSheet, type TicketPlace } from '@/features/tickets/components/TicketConfirmSheet.js';
import { TicketLeaveSheet } from '@/features/tickets/components/TicketLeaveSheet.js';
import { useTicketContext } from '@/features/tickets/hooks/useTickets.js';

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
  const claim = useClaimPosition(match.id);
  const [loading, setLoading] = useState(false);
  const [teamId, setTeamId] = useState('');
  const [subs, setSubs] = useState(3);
  const { confirm, confirmDialog } = useConfirm();
  // DEC-021 A1: individuals buy a ticket for one place on the other side, exactly like a Quick Match.
  const [buying, setBuying] = useState<TicketPlace | null>(null);
  const [leaving, setLeaving] = useState(false);
  const ticketContext = useTicketContext(match.id, Boolean(user));
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
      {confirmDialog}
      {leaving && ticketContext.data && (
        <TicketLeaveSheet
          matchId={match.id}
          context={ticketContext.data}
          onClose={() => setLeaving(false)}
          onLeft={(message) => {
            setLeaving(false);
            notify({ variant: 'info', title: 'You left the match', message });
          }}
        />
      )}
      {buying && (
        <TicketConfirmSheet
          match={match}
          place={buying}
          sides={['AWAY']}
          onClose={() => setBuying(null)}
          onConfirmed={() => {
            setBuying(null);
            notify({ variant: 'success', title: 'You’re in', message: 'Your match ticket is confirmed.' });
          }}
        />
      )}
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
              onClick={async () => {
                const { confirmed } = await confirm({
                  title: `Withdraw ${away.teamNameSnapshot}?`,
                  message: <p>Anyone who paid for your team’s places chooses a match credit or a full refund, and the other side opens again.</p>,
                  confirmLabel: 'Withdraw my team',
                  cancelLabel: 'Stay in match',
                  destructive: true,
                  action: () => withdraw.mutateAsync(undefined),
                });
                if (confirmed) notify({ variant: 'info', title: 'Team withdrawn', message: 'Your team left the match. Anyone who paid chooses a match credit or a full refund.' });
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
                    notify({ variant: 'success', title: 'Your team is in', message: 'Pay for your players’ places by 2 hours before kick-off.' });
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
              <p data-testid="load-team-fee" className="rounded-xl bg-brand-50 p-3 text-sm font-black text-brand-700">{formatTeamFeeBreakdown(fee)}</p>
              <p className="text-xs text-content-muted">
                Your team takes the side straight away. Your squad then pays R80 per player as match tickets, by 2 hours before kick-off.
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
              onClick={() => setBuying({ seat: 'SUBSTITUTE', side: 'AWAY' })}
            >
              Join as a player ({formatRands(match.feeCents)})
            </Button>
          )}
          {!myParticipant && !locked && !onHomeTeam && !('reason' in playerDecision) && (
            <ul className="mt-3 grid gap-1 text-sm">
              {awaySlots.filter((slot) => !slot.participantId).map((slot) => {
                const booked = match.bookingHolds?.slotIds.includes(slot.id);
                return (
                  <li key={slot.id} className="flex items-center justify-between gap-2">
                    <span>Position {slot.slotIndex + 1}: {booked ? 'being booked' : 'open'}</span>
                    {!booked && (
                      <Button variant="ghost" onClick={() => setBuying({ seat: 'POSITION', side: 'AWAY', slotId: slot.id, slotIndex: slot.slotIndex + 1 })}>
                        Buy ticket
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
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
                <Button variant="ghost" disabled={!ticketContext.data?.ticket} onClick={() => setLeaving(true)}>
                  Leave the match
                </Button>
              )}
              <FormError message={claim.error?.message} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
