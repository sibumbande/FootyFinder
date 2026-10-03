import type { AdminPaymentDispute, PaymentDisputeEvidencePack } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { adminClient } from './api.js';
import { AdminActionError } from './FreshMfa.js';

const disputesKey = ['admin', 'finance', 'payment-disputes'] as const;
const rands = (cents: number) => `R${(cents / 100).toFixed(cents % 100 ? 2 : 0)}`;
const when = (value?: string) => (value ? new Date(value).toLocaleString() : '—');
const ATTENDANCE: Record<PaymentDisputeEvidencePack['tickets'][number]['attendance'], string> = {
  PLAYED: 'Played (referee lineup record)',
  DID_NOT_PLAY: 'Did not play (referee lineup record)',
  NOT_RECORDED: 'No lineup record yet',
  MATCH_NOT_PLAYED: 'Match cancelled, not played',
};

/**
 * DEC-021 A8 / D9: payment disputes (chargebacks). While a dispute is open the payer can't buy tickets or use match
 * credits; their tickets stay valid. We contest with the evidence pack (print it, or download the JSON). Won lifts
 * the restriction by itself; after a lost dispute an admin lifts it with a reason (fresh MFA, audited).
 */
export function PaymentDisputesPage() {
  const list = useQuery({ queryKey: disputesKey, queryFn: async () => (await adminClient.paymentDisputes()).data });
  const [selectedId, setSelectedId] = useState<string>();
  const current = list.data?.find(({ id }) => id === selectedId);
  return (
    <section>
      <div className="no-print">
        <p className="eyebrow">Money</p>
        <h2>Payment disputes</h2>
        <p className="muted">
          A player disputed a FootyFinder payment with their bank. While it is open they can’t buy match tickets or use match credits, and the
          tickets in that payment stay valid. Contest it with the evidence pack before the bank’s deadline.
        </p>
      </div>
      {list.error && <p className="error">{list.error.message}</p>}
      {list.data?.length === 0 && <p className="muted">No payment disputes.</p>}
      <div className="support-layout">
        <div className="ticket-list no-print">
          {list.data?.map((item) => (
            <button key={item.id} className={selectedId === item.id ? 'ticket active-ticket' : 'ticket'} onClick={() => setSelectedId(item.id)}>
              <strong>{item.payer.displayName ?? item.payer.username} · {rands(item.amountCents)}</strong>
              <span>{item.status.toLowerCase()} · {item.ticketCount} {item.ticketCount === 1 ? 'ticket' : 'tickets'}{item.matchName ? ` · ${item.matchName}` : ''}</span>
              <small>Opened {when(item.openedAt)}{item.status === 'OPEN' && item.dueAt ? ` · evidence due ${when(item.dueAt)}` : ''}</small>
            </button>
          ))}
        </div>
        <div>{current ? <DisputeDetail dispute={current} /> : <p className="empty no-print">Select a dispute.</p>}</div>
      </div>
    </section>
  );
}

function DisputeDetail({ dispute }: { dispute: AdminPaymentDispute }) {
  const cache = useQueryClient();
  const pack = useQuery({ queryKey: [...disputesKey, dispute.id, 'evidence'], queryFn: async () => (await adminClient.paymentDisputeEvidence(dispute.id)).data });
  const [reason, setReason] = useState('');
  const lift = useMutation({
    mutationFn: () => adminClient.liftBookingRestriction(dispute.payer.userId, reason),
    onSuccess: () => { setReason(''); void cache.invalidateQueries({ queryKey: disputesKey }); },
  });
  const download = () => {
    if (!pack.data) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(pack.data, null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `evidence-${dispute.reference}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  return (
    <article className="venue-card">
      <h3>{dispute.payer.displayName ?? dispute.payer.username} · {rands(dispute.amountCents)} · {dispute.status.toLowerCase()}</h3>
      <p className="muted">
        Reference <code>{dispute.reference}</code> · Paystack dispute {dispute.providerDisputeId}
        {dispute.resolvedAt && ` · resolved ${when(dispute.resolvedAt)} (${dispute.resolution ?? 'n/a'})`}
      </p>
      {dispute.payer.bookingRestrictedAt ? (
        <div className="no-print">
          <p>
            <strong>Bookings restricted</strong> since {when(dispute.payer.bookingRestrictedAt)}
            {dispute.payer.bookingRestrictionReason === 'PAYMENT_DISPUTE_LOST' ? ' (a dispute was lost, so an admin must lift it).' : ' (lifts by itself if every open dispute is won).'}
          </p>
          {dispute.status !== 'OPEN' && (
            <div className="row">
              <input aria-label="Reason for lifting" placeholder="Reason (required)" value={reason} onChange={(event) => setReason(event.target.value)} />
              <button type="button" disabled={lift.isPending || reason.trim().length < 5} onClick={() => lift.mutate()}>Lift booking restriction</button>
            </div>
          )}
          <AdminActionError error={lift.error} onVerified={() => lift.reset()} />
        </div>
      ) : (
        <p className="muted no-print">The payer can book normally.</p>
      )}
      <div className="row no-print">
        <button type="button" disabled={!pack.data} onClick={() => window.print()}>Print evidence pack</button>
        <button type="button" className="ghost" disabled={!pack.data} onClick={download}>Download JSON</button>
      </div>
      {pack.error && <p className="error">{pack.error.message}</p>}
      {pack.data && <EvidencePack pack={pack.data} />}
    </article>
  );
}

function EvidencePack({ pack }: { pack: PaymentDisputeEvidencePack }) {
  return (
    <div className="evidence-pack" data-testid="evidence-pack">
      <h4>Evidence pack · generated {when(pack.generatedAt)}</h4>
      <h4>Payment</h4>
      <p>
        {rands(pack.payment.amountCents)} {pack.payment.currency} · {pack.payment.channel ?? 'channel not recorded'} · started {when(pack.payment.createdAt)} · verified with Paystack {when(pack.payment.verifiedAt)}
        <br />Reference <code>{pack.payment.reference}</code>
      </p>
      <h4>Payer</h4>
      <p>{pack.payer.displayName ?? pack.payer.username} · {pack.payer.email}</p>
      <h4>Cancellation policy accepted at checkout</h4>
      {pack.policyAcceptance ? (
        <>
          <p>
            Ticked “I understand the cancellation policy” at {when(pack.policyAcceptance.acceptedAt)} under Terms v{pack.policyAcceptance.termsVersion}
            <br />IP address {pack.policyAcceptance.ipAddress ?? 'not recorded'} · browser {pack.policyAcceptance.userAgent ?? 'not recorded'}
          </p>
          <pre>{pack.policyAcceptance.policyText}</pre>
        </>
      ) : (
        <p className="muted">No ticket checkout is linked to this payment.</p>
      )}
      <h4>Tickets</h4>
      <div className="audit-list">
        {pack.tickets.map((ticket) => (
          <article key={ticket.id}>
            <strong>{ticket.playerDisplayName} · {rands(ticket.amountCents)} · {ticket.status.toLowerCase()}{ticket.outcome ? ` (${ticket.outcome.toLowerCase().replaceAll('_', ' ')})` : ''}</strong>
            <span>{ticket.match.name} · {ticket.match.venueName} · kick-off {when(ticket.match.startsAt)} · match {ticket.match.status.toLowerCase()}{ticket.match.cancelledAt ? `, cancelled ${when(ticket.match.cancelledAt)}: ${ticket.match.cancellationReason ?? ''}` : ''}</span>
            <span>Confirmed {when(ticket.confirmedAt)} · {ATTENDANCE[ticket.attendance]}{ticket.closedReason ? ` · ${ticket.closedReason}` : ''}</span>
          </article>
        ))}
      </div>
      <h4>Emails sent</h4>
      {pack.emails.length ? <ul>{pack.emails.map((email, index) => <li key={`${email.kind}-${index}`}>{when(email.sentAt)} · {email.subject} ({email.kind.toLowerCase().replaceAll('_', ' ')}) to {email.recipientDisplayName ?? 'the payer'}</li>)}</ul> : <p className="muted">None.</p>}
      <h4>Refunds and credits</h4>
      {pack.refunds.length || pack.creditEvents.length ? (
        <ul>
          {pack.refunds.map((refund) => <li key={refund.id}>{when(refund.createdAt)} · refund {rands(refund.amountCents)} · {refund.status.toLowerCase()} · {refund.reason}{refund.processedAt ? ` · processed ${when(refund.processedAt)}` : ''}</li>)}
          {pack.creditEvents.map((event, index) => <li key={`${event.ticketId}-${index}`}>{when(event.at)} · match credit {event.type.toLowerCase()}</li>)}
        </ul>
      ) : (
        <p className="muted">None.</p>
      )}
    </div>
  );
}
