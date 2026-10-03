import {
  MAX_SUBSTITUTES_PER_TEAM,
  ticketCancellationPolicy,
  TICKET_POLICY_TICK,
  type Match,
  type TeamPaymentMember,
  type TeamPaymentRoster,
} from '@footy-finder/shared';
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { PlayerName } from '@/components/ui/PlayerName.js';
import { useChangeTeamSubstitutes } from '@/features/matches/hooks/useMatches.js';
import { formatClock } from '@/features/matches/utils/go-no-go-format.js';
import { formatWholeRands } from '@/utils/format-currency.js';
import { usePayForTeammates, useTeamPaymentRoster } from '../hooks/useTickets.js';

const ROLE_LABEL = { STARTER: 'Starter', SUBSTITUTE: 'Sub' } as const;

/**
 * DEC-021 A5: the viewer's team payment checklist, which replaces the team fill meter. Every place is a match ticket
 * for a named player: any squad member can pay for themselves and for teammates in one payment ("Paid by Thabo"),
 * and only your own seat can be paid with your match credit. "11 of 14 paid · R240 still needed". The captain is
 * alerted 4 hours before kick-off if the team isn't fully paid; at 2 hours before, an unpaid team's match is
 * cancelled and everyone who paid chooses a match credit or a full refund. A link with ?pay=home|away (from the
 * alert) pre-ticks the unpaid players in the lineup. Venue costs are never shown.
 */
export function TeamPaymentChecklist({ match }: { match: Match }) {
  const side = match.viewerTeamSide ?? null;
  const roster = useTeamPaymentRoster(match.id, side);
  if (!side || !match.otherSideMode) return null;
  if (roster.isPending) return <div className="h-32 animate-pulse rounded-3xl bg-surface-muted" />;
  if (roster.error || !roster.data) return <FormError message={roster.error?.message ?? 'Your team’s payments could not be loaded.'} />;
  return <Checklist match={match} roster={roster.data} />;
}

function Checklist({ match, roster }: { match: Match; roster: TeamPaymentRoster }) {
  const [params] = useSearchParams();
  const preTick = params.get('pay')?.toUpperCase() === roster.side;
  const [selected, setSelected] = useState<Set<string>>(() =>
    new Set(preTick && roster.open ? roster.members.filter((member) => member.status === 'UNPAID' && member.lineupRole).map(({ userId }) => userId) : []),
  );
  const [accepted, setAccepted] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const pay = usePayForTeammates(match.id, roster.side);
  const busy = pay.isPending || pay.data?.kind === 'redirected';
  const me = roster.members.find(({ isMe }) => isMe);
  const percent = roster.seats ? Math.min(100, Math.round((roster.paidSeats / roster.seats) * 100)) : 0;
  const full = roster.paidSeats >= roster.seats;
  const toggle = (userId: string) => {
    setIdempotencyKey(crypto.randomUUID());
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };
  const submit = (method: 'PAYMENT' | 'CREDIT') => {
    const playerIds = method === 'CREDIT' && me ? [me.userId] : [...selected];
    if (!accepted || !playerIds.length) return;
    pay.mutate(
      { input: { playerIds, method, acceptPolicy: true }, idempotencyKey: `${idempotencyKey}:${method}` },
      { onSuccess: (outcome) => { if (outcome.kind === 'confirmed') { setSelected(new Set()); setIdempotencyKey(crypto.randomUUID()); } } },
    );
  };
  const total = selected.size * roster.placeFeeCents;
  const canUseCredit = roster.open && me?.status === 'UNPAID' && roster.viewerCreditsAvailable > 0;
  return (
    <section className="grid gap-4 rounded-3xl border border-line bg-surface p-5 sm:p-6" aria-labelledby="team-payments-heading" data-testid="team-payment-checklist">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="team-payments-heading" className="text-xl font-bold text-content-strong">{roster.teamName} match tickets</h2>
        <p className="text-sm font-semibold text-content-muted">{formatWholeRands(roster.placeFeeCents)} per player</p>
      </div>
      <div className="grid gap-2">
        <p data-testid="team-payment-progress" className="text-lg font-black text-content-strong">
          {roster.paidSeats} of {roster.seats} paid{!full && ` · ${formatWholeRands(roster.stillNeededCents)} still needed`}
        </p>
        <div className="h-3 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={roster.seats} aria-valuenow={roster.paidSeats} aria-label="Places paid for">
          <div className={`h-full ${full ? 'bg-brand-600' : 'bg-warning-600'}`} style={{ width: `${percent}%` }} />
        </div>
        <p className="text-sm text-content-muted" data-testid="team-payment-deadline">
          {roster.open
            ? full
              ? 'Every place is paid for. Your team is confirmed.'
              : `If your team isn’t fully paid by ${formatClock(roster.alertAt)}, your captain is alerted. If it still isn’t by ${formatClock(roster.cutoffAt)} (2 hours before kick-off), the match is cancelled and everyone who paid chooses a match credit or a full refund.`
            : roster.closedReason === 'OPPONENT_NOT_FOUND'
              ? 'Payments open once the other side is taken. Nobody pays before then.'
              : roster.closedReason === 'CUTOFF_PASSED'
                ? `Payments closed at ${formatClock(roster.cutoffAt)}, 2 hours before kick-off.`
                : 'Payments are closed for this match.'}
        </p>
      </div>
      <ul className="grid gap-2" aria-label="Team payments">
        {roster.members.map((member) => (
          <MemberRow key={member.userId} member={member} selectable={roster.open && member.status === 'UNPAID'} checked={selected.has(member.userId)} onToggle={() => toggle(member.userId)} disabled={busy} />
        ))}
      </ul>
      {roster.open && (selected.size > 0 || canUseCredit) && (
        <div className="grid gap-3 rounded-2xl border border-line p-4">
          <ul className="grid list-disc gap-1 pl-5 text-sm text-content">
            {ticketCancellationPolicy(roster.placeFeeCents).map((line) => <li key={line}>{line}</li>)}
            <li>If you pay for teammates, any refund or credit for their places goes to you.</li>
          </ul>
          <label className="flex min-h-11 items-center gap-3 text-sm font-bold text-content-strong">
            <input type="checkbox" className="h-5 w-5" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} disabled={busy} />
            {TICKET_POLICY_TICK}
          </label>
          {selected.size > 0 && (
            <Button className="w-full" disabled={!accepted} loading={busy} onClick={() => submit('PAYMENT')}>
              Pay {formatWholeRands(total)} for {selected.size} {selected.size === 1 ? 'player' : 'players'}
            </Button>
          )}
          {canUseCredit && (
            <Button variant="secondary" className="w-full" disabled={!accepted || busy} onClick={() => submit('CREDIT')}>
              Use my match credit for my seat
            </Button>
          )}
        </div>
      )}
      {roster.viewerCanManage && (roster.open || roster.closedReason === 'OPPONENT_NOT_FOUND') && <SubsControl match={match} roster={roster} />}
      <FormError message={pay.error?.message} />
    </section>
  );
}

function MemberRow({ member, selectable, checked, onToggle, disabled }: { member: TeamPaymentMember; selectable: boolean; checked: boolean; onToggle: () => void; disabled: boolean }) {
  const status = member.status === 'PAID'
    ? member.paidByMe ? (member.isMe ? 'Paid' : 'Paid by you') : `Paid by ${member.paidByDisplayName ?? 'a teammate'}`
    : member.status === 'BEING_PAID' ? 'Being paid for' : 'Not paid';
  const tone = member.status === 'PAID' ? 'text-brand-700' : member.status === 'BEING_PAID' ? 'text-warning-700' : 'text-content-muted';
  const body = (
    <>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="min-w-0 flex-1 font-bold text-content-strong">
          <PlayerName name={member.isMe ? `${member.displayName} (you)` : member.displayName} />
        </span>
        {member.lineupRole && <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-xs font-bold text-content">{ROLE_LABEL[member.lineupRole]}</span>}
      </span>
      <span className={`shrink-0 text-sm font-semibold ${tone}`}>{status}</span>
    </>
  );
  return (
    <li data-testid={`team-payment-${member.userId}`}>
      {selectable ? (
        <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-2xl border border-line p-3">
          <input type="checkbox" className="h-5 w-5 shrink-0" checked={checked} onChange={onToggle} disabled={disabled} aria-label={`Pay for ${member.displayName}`} />
          {body}
        </label>
      ) : (
        <div className="flex min-h-11 items-center gap-3 rounded-2xl border border-line p-3">
          <span aria-hidden className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-xs font-black ${member.status === 'PAID' ? 'bg-brand-600 text-content-inverse' : 'bg-surface-muted'}`}>{member.status === 'PAID' ? '✓' : ''}</span>
          {body}
        </div>
      )}
    </li>
  );
}

/** DEC-021 D1: subs can change until the T-2h cutoff, never below the places already paid for (no refunds come from it). */
function SubsControl({ match, roster }: { match: Match; roster: TeamPaymentRoster }) {
  const teamSide = match.teamSides.find(({ side }) => side === roster.side);
  const current = teamSide?.substituteCount ?? 0;
  const subs = useChangeTeamSubstitutes(match.id, roster.side);
  const [value, setValue] = useState(current);
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-sm font-bold text-content-strong">
          Your subs
          <input
            className="w-24 rounded-xl border-2 border-line bg-canvas p-2"
            type="number"
            min={0}
            max={MAX_SUBSTITUTES_PER_TEAM}
            value={value}
            onChange={(event) => setValue(Math.max(0, Math.min(MAX_SUBSTITUTES_PER_TEAM, Math.trunc(Number(event.target.value) || 0))))}
          />
        </label>
        <Button variant="ghost" disabled={value === current} loading={subs.isPending} onClick={() => subs.mutate(value)}>Change subs</Button>
      </div>
      <span className="text-xs text-content-muted">Changes how many places your team pays for. You can’t go below the places already paid for.</span>
      <FormError message={subs.error?.message} />
    </div>
  );
}
