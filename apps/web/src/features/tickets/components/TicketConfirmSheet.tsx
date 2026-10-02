import { ticketCancellationPolicy, TICKET_POLICY_TICK, type Match, type TeamSide } from '@footy-finder/shared';
import { useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { Sheet } from '@/components/ui/Sheet.js';
import { formatDate } from '@/utils/format-date.js';
import { formatWholeRands as formatRands } from '@/utils/format-currency.js';
import { useBuyTicket } from '../hooks/useTickets.js';

export type TicketPlace = { seat: 'POSITION'; side: TeamSide; slotId: string; slotIndex: number } | { seat: 'SUBSTITUTE'; side?: TeamSide };

const SIDE_NAME: Record<TeamSide, string> = { HOME: 'Home', AWAY: 'Away' };

/**
 * DEC-021 A1.1: the confirm sheet before paying. It shows the match, venue, kick-off, the place, the price and the
 * cancellation policy in plain words, and the player must tick "I understand the cancellation policy" before the
 * pay button works (A8). Paying goes to Paystack's hosted checkout; nothing is confirmed until our server verifies
 * the payment.
 */
export function TicketConfirmSheet({
  match,
  place,
  sides = ['HOME', 'AWAY'],
  onClose,
  onConfirmed,
}: {
  match: Match;
  place: TicketPlace;
  /** Sides a substitute place may be bought on (an "Open to both" team match: the away side only). */
  sides?: TeamSide[];
  onClose: () => void;
  onConfirmed: () => void;
}) {
  const buy = useBuyTicket(match.id);
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [accepted, setAccepted] = useState(false);
  const [side, setSide] = useState<TeamSide | undefined>(place.side ?? (sides.length === 1 ? sides[0] : undefined));
  const free = match.freeOnFootyFinder || match.feeCents === 0;
  const policy = free
    ? ['This is a free match: nothing is paid, so nothing is refunded if you leave or the match is cancelled.', 'You can’t leave in the last 30 minutes before kick-off, when the lineup is locked.']
    : ticketCancellationPolicy(match.feeCents);
  const placeText = place.seat === 'POSITION'
    ? `Position ${place.slotIndex} · ${SIDE_NAME[place.side]} side`
    : side ? `Substitute · ${SIDE_NAME[side]} side` : 'Substitute';
  const submit = () => {
    if (!side || !accepted) return;
    buy.mutate(
      {
        input: place.seat === 'POSITION'
          ? { seat: 'POSITION', side: place.side, slotId: place.slotId, method: 'PAYMENT', acceptPolicy: true }
          : { seat: 'SUBSTITUTE', side, method: 'PAYMENT', acceptPolicy: true },
        idempotencyKey,
      },
      { onSuccess: (outcome) => outcome.kind === 'confirmed' && onConfirmed() },
    );
  };
  const busy = buy.isPending || buy.data?.kind === 'redirected';
  return (
    <Sheet title={free ? 'Join this free match' : 'Buy your match ticket'} onClose={onClose} busy={busy} testId="ticket-confirm-sheet">
      <dl className="mt-4 grid gap-2 rounded-2xl bg-surface-muted p-4 text-sm">
        <Row label="Match" value={match.name} />
        <Row label="Venue" value={`${match.venue.name}, ${match.venue.city}`} />
        <Row label="Kick-off" value={formatDate(match.startsAt)} />
        <Row label="Your place" value={placeText} />
        <Row label="Price" value={free ? 'Free (R0)' : formatRands(match.feeCents)} strong />
      </dl>
      {place.seat === 'SUBSTITUTE' && sides.length > 1 && (
        <fieldset className="mt-4">
          <legend className="text-sm font-bold text-content-strong">Which side?</legend>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {sides.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={side === item}
                onClick={() => setSide(item)}
                className={`min-h-11 rounded-xl border-2 px-3 text-sm font-black ${side === item ? 'border-brand-600 bg-brand-50 text-brand-700' : 'border-line text-content'}`}
              >
                {SIDE_NAME[item]}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <section className="mt-4" aria-labelledby="ticket-policy-heading">
        <h3 id="ticket-policy-heading" className="text-sm font-bold text-content-strong">Cancellation policy</h3>
        <ul className="mt-2 grid list-disc gap-1 pl-5 text-sm text-content" data-testid="ticket-policy">
          {policy.map((line) => <li key={line}>{line}</li>)}
        </ul>
      </section>
      <label className="mt-4 flex min-h-11 items-start gap-3 rounded-xl border border-line p-3 text-sm font-semibold text-content-strong">
        <input type="checkbox" className="mt-0.5 size-5 shrink-0" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} />
        <span>{TICKET_POLICY_TICK}</span>
      </label>
      <FormError message={buy.error?.message} />
      <Button className="mt-4 w-full" onClick={submit} disabled={!accepted || !side} loading={busy}>
        {free ? 'Join for free' : `Pay ${formatRands(match.feeCents)} · Card / Instant EFT`}
      </Button>
      {!free && <p className="mt-2 text-center text-xs text-content-muted">You pay on Paystack’s secure page. Your place is held for 10 minutes while you pay.</p>}
    </Sheet>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-content-muted">{label}</dt>
      <dd className={`min-w-0 text-right [overflow-wrap:anywhere] ${strong ? 'text-lg font-black text-content-strong' : 'font-semibold text-content-strong'}`}>{value}</dd>
    </div>
  );
}
