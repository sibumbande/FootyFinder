import type { MatchGoNoGoFacts, MatchStatus } from '@footy-finder/shared';

/** Cape Town is the launch city; venue times are shown in South African time. */
const VENUE_TIME_ZONE = 'Africa/Johannesburg';

export const formatGoNoGoTime = (iso: string) => {
  const date = new Date(iso);
  const time = new Intl.DateTimeFormat('en-ZA', {
    timeZone: VENUE_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  const day = new Intl.DateTimeFormat('en-GB', {
    timeZone: VENUE_TIME_ZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
  return `${time} on ${day}`;
};

const rands = (cents: number) => `R${Number.isInteger(cents / 100) ? cents / 100 : (cents / 100).toFixed(2)}`;

/**
 * DEC-018 player messaging: a Quick Match goes ahead only if every formation position is claimed
 * by T-30. Shows the rule, the live "X of Y positions filled" count (which updates with the
 * realtime formation cache), and the confirmed/cancelled outcome. Renders nothing for legacy
 * matches without a go/no-go time.
 */
export function GoNoGoBanner({
  facts,
  status,
  feeCents,
  filled,
  total,
  now = new Date(),
}: {
  facts: MatchGoNoGoFacts;
  status: MatchStatus;
  feeCents: number;
  filled: number;
  total: number;
  now?: Date;
}) {
  if (!facts.goNoGoAt) return null;
  const when = formatGoNoGoTime(facts.goNoGoAt);
  const fee = rands(feeCents);
  const count = (
    <p data-testid="positions-filled" className="mt-2 text-lg font-black text-content-strong">
      {filled} of {total} positions filled
    </p>
  );

  if (status === 'CANCELLED' && facts.cancellationReason === 'POSITIONS_UNFILLED')
    return (
      <section role="status" className="rounded-2xl border border-danger-200 bg-danger-50 p-5">
        <p className="font-black text-danger-700">Cancelled: not all positions were filled</p>
        <p className="mt-1 text-sm text-content">
          Not every position was filled by {when}, so this match was cancelled. Your {fee} was
          refunded to your wallet.
        </p>
      </section>
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
        This match goes ahead only if all positions are filled by {when}. Otherwise it&apos;s
        cancelled and your {fee} is refunded to your wallet.
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
