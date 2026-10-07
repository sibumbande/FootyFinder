import type { MatchTicketContext } from '@footy-finder/shared';
import { Link } from 'react-router-dom';
import { formatClock } from '@/features/matches/utils/go-no-go-format.js';

/**
 * DEC-021 A1.2: the viewer started paying for a place in this match and the payment is not confirmed yet. The place is
 * held for them (it is not a place in the lineup until the payment is confirmed), so the lobby says so instead of
 * leaving them looking like they are not in the match, and links to the payment's status page.
 */
export function PendingPaymentNotice({ context }: { context: MatchTicketContext }) {
  const ticket = context.ticket;
  if (!ticket || ticket.status !== 'HELD' || !ticket.paidByMe) return null;
  return (
    <section className="grid gap-2 rounded-3xl border-2 border-warning-300 bg-warning-50 p-5" role="status" data-testid="pending-payment-notice">
      <h2 className="text-lg font-black text-content-strong">Your payment is being confirmed</h2>
      <p className="text-sm text-content">
        Your place shows in the lineup once the payment provider confirms your payment to us. This usually takes a few seconds.
        {ticket.holdExpiresAt && ` If you didn’t finish paying, the place is released at ${formatClock(ticket.holdExpiresAt)} and you can buy it again then.`}
      </p>
      {ticket.paymentReference && (
        <Link className="w-fit text-sm font-bold text-brand-700 underline" to={`/tickets/return?reference=${encodeURIComponent(ticket.paymentReference)}`}>
          Check my payment
        </Link>
      )}
    </section>
  );
}
