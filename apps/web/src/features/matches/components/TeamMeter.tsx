import {
  formatRandAmount,
  formatTeamFeeBreakdown,
  getGoNoGoAt,
  MAX_SUBSTITUTES_PER_TEAM,
  type Match,
  type TeamMeterView,
} from '@footy-finder/shared';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { useChangeTeamSubstitutes, useFillTeamMeter, useTeamMeter } from '../hooks/useMatches.js';
import { formatClock } from '../utils/go-no-go-format.js';

const breakdownOf = (meter: TeamMeterView) =>
  formatTeamFeeBreakdown({
    starterCount: meter.starterCount,
    substituteCount: meter.substituteCount,
    placeFeeCents: meter.placeFeeCents,
    startersCents: meter.starterCount * meter.placeFeeCents,
    substitutesCents: meter.substituteCount * meter.placeFeeCents,
    totalCents: meter.feeCents,
  });

/**
 * Gate 7 / DEC-019: the viewer's own team meter, e.g. "R0 / R1,120", filled from the team
 * wallet. Before an opponent is found only the fee breakdown shows. Owners and captains can fill
 * it and change their subs until the 30-minute check. Venue costs are never shown.
 */
export function TeamMeter({ match }: { match: Match }) {
  const side = match.viewerTeamSide ?? null;
  const meter = useTeamMeter(match.id, side);
  if (!side || !match.otherSideMode) return null;
  if (meter.isPending) return <div className="h-32 animate-pulse rounded-3xl bg-surface-muted" />;
  if (meter.error || !meter.data) return <FormError message={meter.error?.message ?? 'Your team meter could not be loaded.'} />;
  return <MeterCard match={match} meter={meter.data} />;
}

function MeterCard({ match, meter }: { match: Match; meter: TeamMeterView }) {
  const fill = useFillTeamMeter(match.id, meter.side);
  const subs = useChangeTeamSubstitutes(match.id, meter.side);
  const [amount, setAmount] = useState('');
  const [subsValue, setSubsValue] = useState(meter.substituteCount);
  const attemptKey = useRef<string>();
  const lockAt = formatClock(getGoNoGoAt(match.startsAt).toISOString());
  const paid = meter.heldCents + meter.capturedCents;
  const percent = meter.feeCents ? Math.min(100, Math.round((paid / meter.feeCents) * 100)) : 0;
  const canAct = meter.viewerCanManage && meter.active && !meter.locked;
  const submitFill = (amountCents?: number) => {
    attemptKey.current ??= crypto.randomUUID();
    fill.mutate({ amountCents, idempotencyKey: attemptKey.current }, { onSuccess: () => { attemptKey.current = undefined; setAmount(''); } });
  };
  return (
    <section className="grid gap-4 rounded-3xl border border-line bg-surface p-5 sm:p-6" aria-labelledby="team-meter-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="team-meter-heading" className="text-xl font-bold text-content-strong">{meter.teamName} team fee</h2>
        <p className="text-sm font-semibold text-content-muted">{breakdownOf(meter)}</p>
      </div>
      {meter.active ? (
        <>
          <p data-testid="team-meter" className="text-3xl font-black text-content-strong">
            {formatRandAmount(paid)} / {formatRandAmount(meter.feeCents)}
          </p>
          <div className="h-3 overflow-hidden rounded-full bg-surface-muted" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label="Team meter">
            <div className={`h-full ${meter.full ? 'bg-brand-600' : 'bg-warning-600'}`} style={{ width: `${percent}%` }} />
          </div>
          <p className="text-sm text-content-muted">
            {meter.capturedCents > 0
              ? 'The match went ahead, so this fee was taken from the team wallet.'
              : meter.full
                ? `Full. The money is held in your team wallet and taken only if the match goes ahead at ${lockAt}.`
                : `Fill this from your team wallet by ${lockAt}, or the match is cancelled and held money goes back to the team wallet.`}
          </p>
        </>
      ) : (
        <p data-testid="team-meter-inactive" className="rounded-2xl bg-surface-muted p-4 text-sm font-semibold text-content">
          Your meter opens once the other side is taken. Nothing is taken from the team wallet until then.
        </p>
      )}
      {canAct && !meter.full && (
        <div className="grid gap-2 rounded-2xl border border-line p-4">
          <p className="text-sm text-content-muted">
            Team wallet available: {formatRandAmount(meter.teamWalletAvailableCents ?? 0)}. Left to fill: {formatRandAmount(meter.remainingCents)}.
            {(meter.teamWalletAvailableCents ?? 0) < meter.remainingCents && (
              <> <Link className="font-bold underline" to={`/teams/${meter.teamId}?tab=wallet`}>Ask members to add money</Link></>
            )}
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <Button loading={fill.isPending} onClick={() => submitFill(undefined)}>Fill the rest ({formatRandAmount(meter.remainingCents)})</Button>
            <label className="grid gap-1 text-sm font-bold text-content-strong">
              Or an amount (R)
              <input className="w-28 rounded-xl border-2 border-line bg-canvas p-2" inputMode="numeric" value={amount} onChange={(event) => { setAmount(event.target.value); attemptKey.current = undefined; }} />
            </label>
            <Button variant="secondary" disabled={!/^\d+$/.test(amount)} loading={fill.isPending} onClick={() => submitFill(Number(amount) * 100)}>Fill</Button>
          </div>
        </div>
      )}
      {meter.viewerCanManage && !meter.locked && (
        <div className="flex flex-wrap items-end gap-2">
          <label className="grid gap-1 text-sm font-bold text-content-strong">
            Your subs
            <input
              className="w-24 rounded-xl border-2 border-line bg-canvas p-2"
              type="number"
              min={0}
              max={MAX_SUBSTITUTES_PER_TEAM}
              value={subsValue}
              onChange={(event) => setSubsValue(Math.max(0, Math.min(MAX_SUBSTITUTES_PER_TEAM, Math.trunc(Number(event.target.value) || 0))))}
            />
          </label>
          <Button variant="ghost" disabled={subsValue === meter.substituteCount} loading={subs.isPending} onClick={() => subs.mutate(subsValue)}>
            Change subs
          </Button>
          <span className="text-xs text-content-muted">Changes your fee. Money above the new fee goes back to the team wallet straight away.</span>
        </div>
      )}
      <FormError message={fill.error?.message ?? subs.error?.message} />
    </section>
  );
}
