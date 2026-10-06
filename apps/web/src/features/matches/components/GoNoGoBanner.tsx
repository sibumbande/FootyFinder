import type { MatchGoNoGoFacts, MatchStatus } from '@footy-finder/shared';
import { formatClock, formatGoNoGoTime, formatMatchDay, rands } from '../utils/go-no-go-format.js';

export { formatGoNoGoTime };

/**
 * DEC-018 player messaging: a Quick Match goes ahead only if every formation position is claimed
 * by T-30. Shows the rule, the live "X of Y positions filled" count (which updates with the
 * realtime formation cache), and the confirmed outcome. A cancelled match (T-30 auto-cancel or host
 * cancel, including legacy matches) shows the same explanation as the cancellation alert and email.
 * Otherwise renders nothing for legacy matches without a go/no-go time.
 */
export function GoNoGoBanner({
  facts,
  status,
  feeCents,
  filled,
  total,
  venueName,
  startsAt,
  viewerJoined = false,
  now = new Date(),
}: {
  facts: MatchGoNoGoFacts;
  status: MatchStatus;
  feeCents: number;
  filled: number;
  total: number;
  /** Used for the cancellation explanation, which matches the alert and email wording. */
  venueName?: string;
  startsAt?: string;
  /** A joined viewer reads "Your R80…"; anyone else reads "Every player's R80…". */
  viewerJoined?: boolean;
  now?: Date;
}) {
  if (status === 'CANCELLED' && facts.cancellationReason) {
    const unfilled = facts.cancellationReason === 'POSITIONS_UNFILLED';
    // Gate 8 (DEC-020, D2): cancelled at T-30 because no FootyFinder referee was assigned.
    const noReferee = facts.cancellationReason === 'NO_REFEREE';
    const where = venueName ? ` at ${venueName}` : '';
    const onWhen = startsAt ? ` on ${formatMatchDay(startsAt)} at ${formatClock(startsAt)}` : '';
    const refund =
      feeCents > 0
        ? viewerJoined
          ? ` If you paid ${rands(feeCents)}, choose a match credit or a full refund. Without a choice within 7 days you're refunded automatically.`
          : ` Everyone who paid ${rands(feeCents)} chooses a match credit or a full refund.`
        : '';
    return (
      <section role="status" className="rounded-2xl border border-danger-200 bg-danger-50 p-5">
        <p className="font-black text-danger-700">
          {noReferee
            ? 'Cancelled: no referee was available'
            : unfilled
              ? 'Cancelled: not every position was filled'
              : 'Cancelled by the host'}
        </p>
        <p className="mt-1 text-sm text-content">
          This match{where}{onWhen} was cancelled{' '}
          {noReferee
            ? 'because no FootyFinder referee was available.'
            : unfilled
              ? 'because not every position was filled 30 minutes before kickoff.'
              : 'by the host.'}
          {refund}
        </p>
      </section>
    );
  }
  if (!facts.goNoGoAt) return null;
  const when = formatGoNoGoTime(facts.goNoGoAt);
  const fee = rands(feeCents);
  const count = (
    <p data-testid="positions-filled" className="mt-2 text-lg font-black text-content-strong">
      {filled} of {total} positions filled
    </p>
  );

  if (facts.confirmedAt)
    return (
      <section role="status" className="rounded-2xl border border-brand-200 bg-brand-50 p-5">
        <p className="font-black text-brand-700">Confirmed: all positions filled</p>
        <p className="mt-1 text-sm text-content">
          Every position was filled by {when}, so this match goes ahead.
        </p>
        {count}
      </section>
    );
  if (status === 'CANCELLED') return null;
  const checking = now.getTime() >= new Date(facts.goNoGoAt).getTime();
  return (
    <section role="status" className="rounded-2xl border border-warning-300 bg-warning-50 p-5">
      <p className="text-sm font-semibold text-content">
        This match goes ahead only if all positions are filled and a FootyFinder referee is assigned
        by {when}. Otherwise it&apos;s
        cancelled and you choose a match credit or a full refund of your {fee}.
      </p>
      {count}
      {checking && (
        <p className="mt-1 text-xs font-bold uppercase text-content-muted">
          The lineup is locked while positions are checked.
        </p>
      )}
    </section>
  );
}
