import { TICKET_REFERENCE_PATTERN } from '@footy-finder/shared';
import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { Spinner } from '@/components/ui/Spinner.js';
import { formatClock } from '@/features/matches/utils/go-no-go-format.js';
import { useCheckoutByReference } from '../hooks/useTickets.js';

/**
 * DEC-021 A1.3: the payment provider (Paystack, or PayFast) sends the player back here. This page only asks our server
 * for the checkout's status; it never confirms anything itself. The ticket is confirmed once our server has verified
 * the payment with the provider, and the player is then taken to the match lobby, where their place shows.
 */
export function TicketReturnPage() {
  const [search] = useSearchParams();
  const raw = search.get('reference') ?? search.get('trxref');
  const reference = raw && TICKET_REFERENCE_PATTERN.test(raw) ? raw : null;
  const checkout = useCheckoutByReference(reference);
  const data = checkout.data;
  const matchLink = data ? `/matches/${data.matchId}` : '/matches';
  const navigate = useNavigate();
  const confirmed = data?.state === 'CONFIRMED';
  useEffect(() => {
    if (confirmed) navigate(matchLink, { replace: true });
  }, [confirmed, matchLink, navigate]);
  return (
    <section className="mx-auto grid max-w-lg gap-4 rounded-3xl border border-line bg-surface p-6 text-center shadow-soft" aria-live="polite">
      {!reference ? (
        <>
          <h1 className="text-2xl font-black text-content-strong">We couldn’t find that payment</h1>
          <p className="text-content">Open your match to see your ticket.</p>
          <Link className="button" to="/matches">Find matches</Link>
        </>
      ) : !data || data.state === 'PROCESSING' ? (
        <>
          <Spinner className="mx-auto size-8" />
          <h1 className="text-2xl font-black text-content-strong">Confirming your payment…</h1>
          <p className="text-content">This usually takes a few seconds. You don’t need to pay again.</p>
          {data?.holdExpiresAt && (
            <p className="text-sm text-content-muted">
              Your place is held until {formatClock(data.holdExpiresAt)}. If your payment isn’t confirmed by then, the place is released.
            </p>
          )}
          <FormError message={checkout.error?.message} />
          {data && !checkout.isFetching && checkout.dataUpdatedAt && (
            <Button variant="secondary" onClick={() => void checkout.refetch()}>Check again</Button>
          )}
        </>
      ) : data.state === 'CONFIRMED' ? (
        <>
          <h1 className="text-2xl font-black text-content-strong">You’re in</h1>
          <p className="text-content">Your match ticket is confirmed. We’ve emailed you a receipt.</p>
          <Link className="button" to={matchLink}>Go to your match</Link>
        </>
      ) : data.refundReason ? (
        <>
          <h1 className="text-2xl font-black text-content-strong">Your payment is being refunded</h1>
          <p className="text-content">{data.refundReason}</p>
          <p className="text-sm text-content-muted">The full amount goes back to the card or bank account you paid with. We’ve emailed you about it.</p>
          <Link className="button" to={matchLink}>Back to the match</Link>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-black text-content-strong">Payment not completed</h1>
          <p className="text-content">Nothing was charged for this ticket. The place was released.</p>
          <Link className="button" to={matchLink}>Back to the match</Link>
        </>
      )}
    </section>
  );
}
