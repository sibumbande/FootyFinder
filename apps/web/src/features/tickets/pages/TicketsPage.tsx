import type { MyMatchCredit, MyTicketRefund, MyTicketRow, MatchTicketOutcome, MatchTicketSeat } from '@footy-finder/shared';
import { Link } from 'react-router-dom';
import { FormError } from '@/components/ui/FormError.js';
import { formatDate } from '@/utils/format-date.js';
import { formatWholeRands } from '@/utils/format-currency.js';
import { useMyTickets } from '../hooks/useTickets.js';

/** "2 Oct 2029": credits are valid for 3 years from issue (DEC-021 A4, D3). */
const formatDay = (value: string) => new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));

const SEAT_LABEL: Record<MatchTicketSeat, string> = { POSITION: 'Position', SUBSTITUTE: 'Substitute', TEAM: 'Team place' };

const OUTCOME_LABEL: Record<MatchTicketOutcome, string> = {
  CREDIT_ISSUED: 'Left the match · 1 match credit',
  REFUNDED: 'Refunded to your card / bank',
  CREDIT_RETURNED: 'Match credit returned',
  FORFEITED: 'Left within 24 hours of kick-off · no refund',
  NOTHING_DUE: 'Free match · nothing to give back',
  LATE_PAYMENT_REFUNDED: 'Payment confirmed too late · refunded in full',
  DUPLICATE_REFUNDED: 'Paid twice · the extra payment was refunded',
};

const CREDIT_REASON: Record<MyMatchCredit['reason'], string> = {
  LEFT_MATCH: 'You left a match',
  MATCH_CANCELLED: 'A match was cancelled',
  CREDIT_RETURNED: 'Returned from a cancelled match',
  DEV_SEED: 'Test credit',
  GOODWILL: 'From FootyFinder',
};

const REFUND_STATE: Record<MyTicketRefund['state'], string> = {
  IN_PROGRESS: 'On its way back to you',
  REFUNDED: 'Refunded',
  NEEDS_BANK_DETAILS: 'Waiting for your bank details – support will contact you',
  HANDLED_BY_SUPPORT: 'Delayed – our finance team will contact you',
};

function paidWith(ticket: MyTicketRow) {
  if (ticket.method === 'FREE') return 'Free match';
  if (ticket.method === 'CREDIT') return 'Paid with 1 match credit';
  return `Paid ${formatWholeRands(ticket.amountCents)}${ticket.paymentMethodLabel ? ` · ${ticket.paymentMethodLabel}` : ''}`;
}

function ticketState(ticket: MyTicketRow) {
  if (ticket.status === 'CHOICE_PENDING')
    return `Match cancelled: choose a match credit or a refund${ticket.choiceDeadlineAt ? ` by ${formatDate(ticket.choiceDeadlineAt)}` : ''}`;
  if (ticket.status === 'HELD') return 'Being booked';
  if (ticket.outcome) return OUTCOME_LABEL[ticket.outcome];
  if (ticket.matchStatus === 'COMPLETED') return 'Played';
  if (ticket.matchStatus === 'CANCELLED') return 'Match cancelled';
  return ticket.status === 'CONFIRMED' ? 'Confirmed' : null;
}

function TicketItem({ ticket }: { ticket: MyTicketRow }) {
  const state = ticketState(ticket);
  const whose = ticket.isMine
    ? ticket.paidByMe ? null : `Paid for by ${ticket.payerDisplayName ?? 'a teammate'}`
    : `For ${ticket.playerDisplayName}`;
  return (
    <li className="grid gap-1 border-b border-line py-4 last:border-b-0" data-testid="ticket-row">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <Link className="min-w-0 font-bold text-content-strong underline-offset-2 hover:underline" to={`/matches/${ticket.matchId}`}>
          {ticket.matchName}
        </Link>
        <span className="text-sm font-bold text-content">{SEAT_LABEL[ticket.seat]}</span>
      </div>
      <p className="text-sm text-content-muted">{ticket.venueName} · {formatDate(ticket.startsAt)}</p>
      <p className="text-xs font-bold text-content-muted">
        {paidWith(ticket)}
        {whose && ` · ${whose}`}
      </p>
      {state && (
        <p className={`text-xs font-bold uppercase ${ticket.status === 'CHOICE_PENDING' ? 'text-warning-700' : 'text-content-muted'}`}>{state}</p>
      )}
    </li>
  );
}

function TicketList({ id, title, tickets, empty }: { id: string; title: string; tickets: MyTicketRow[]; empty: string }) {
  return (
    <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6" aria-labelledby={id}>
      <h2 id={id} className="text-xl font-black uppercase text-content-strong">{title}</h2>
      {tickets.length === 0 ? <p className="mt-3 text-content-muted">{empty}</p> : <ul className="mt-2">{tickets.map((ticket) => <TicketItem key={ticket.id} ticket={ticket} />)}</ul>}
    </section>
  );
}

function creditState(credit: MyMatchCredit) {
  switch (credit.status) {
    case 'AVAILABLE':
      return `Valid until ${formatDay(credit.expiresAt)}`;
    case 'USED':
      return `Used${credit.usedOnMatchName ? ` on ${credit.usedOnMatchName}` : ''}${credit.usedAt ? ` · ${formatDay(credit.usedAt)}` : ''}`;
    case 'EXPIRED':
      return `Expired on ${formatDay(credit.expiresAt)}`;
    case 'REFUNDED':
      return 'Refunded to your card / bank';
    default:
      return 'Lapsed';
  }
}

/**
 * DEC-021 "Tickets & credits" (replaces the wallet page): upcoming and past tickets, match credits with their expiry,
 * refunds and their status, and the payment method used. Credits are counted in matches, never in rands (A4).
 */
export function TicketsPage() {
  const mine = useMyTickets();
  const data = mine.data;
  return (
    <section className="grid gap-7">
      <header>
        <p className="anime-kicker">Tickets &amp; credits</p>
        <h1 className="mt-3 text-4xl font-black uppercase leading-none text-content-strong">Your tickets</h1>
        <p className="mt-2 text-content-muted">
          Every match you pay for is a ticket for one place in that match. Leave more than 24 hours before kick-off and you
          choose a match credit or a refund to your card or bank.
        </p>
      </header>

      <FormError message={mine.error?.message} />
      {mine.isPending && <div className="h-28 animate-pulse rounded-2xl bg-surface" />}
      {data?.bookingRestricted && (
        <p role="alert" className="rounded-xl border border-warning-200 bg-warning-50 p-4 text-warning-700">
          You can’t buy tickets or use match credits while a payment dispute is open. Your tickets stay valid. Contact{' '}
          <Link className="underline" to="/support">support</Link> if you need help.
        </p>
      )}

      {data && (
        <>
          <section className="rounded-3xl border-2 border-line-strong bg-brand-900 p-5 text-content-inverse sm:p-6" aria-labelledby="credits-heading" data-testid="match-credits">
            <h2 id="credits-heading" className="text-xs font-black uppercase tracking-[0.14em] text-hero-accent">Match credits</h2>
            <p className="mt-2 text-3xl font-black">
              {data.creditsAvailable === 0
                ? 'No match credits'
                : `You have ${data.creditsAvailable} match ${data.creditsAvailable === 1 ? 'credit' : 'credits'}`}
            </p>
            <p className="mt-1 text-sm text-content-inverse/80">
              1 credit = 1 ticket to any paid match. Credits are personal, can’t be transferred and have no cash value. Each is valid for 3 years.
            </p>
            {data.credits.length > 0 && (
              <ul className="mt-4 grid gap-2">
                {data.credits.map((credit) => (
                  <li key={credit.id} className="flex flex-wrap justify-between gap-x-3 rounded-xl bg-content-inverse/10 px-3 py-2 text-sm">
                    <span className="font-bold">{CREDIT_REASON[credit.reason]}</span>
                    <span className={credit.status === 'AVAILABLE' ? 'font-bold' : 'opacity-75'}>{creditState(credit)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <TicketList id="upcoming-tickets" title="Upcoming" tickets={data.upcoming} empty="No upcoming tickets. Find a match and claim a position." />

          <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6" aria-labelledby="refunds-heading">
            <h2 id="refunds-heading" className="text-xl font-black uppercase text-content-strong">Refunds</h2>
            {data.refunds.length === 0 ? (
              <p className="mt-3 text-content-muted">No refunds.</p>
            ) : (
              <ul className="mt-2">
                {data.refunds.map((refund) => (
                  <li key={refund.id} className="flex items-center justify-between gap-3 border-b border-line py-4 last:border-b-0" data-testid="refund-row">
                    <div className="min-w-0">
                      <p className="font-bold text-content-strong">{refund.matchName ?? 'Match ticket'}</p>
                      <p className="text-sm text-content-muted">
                        {formatDate(refund.createdAt)}
                        {refund.paymentMethodLabel && ` · Back to ${refund.paymentMethodLabel}`}
                      </p>
                      <p className="mt-1 text-xs font-bold uppercase text-content-muted">{REFUND_STATE[refund.state]}</p>
                    </div>
                    <p className="whitespace-nowrap text-lg font-black text-content-strong">{formatWholeRands(refund.amountCents)}</p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <TicketList id="past-tickets" title="Past tickets" tickets={data.past} empty="No past tickets yet." />
        </>
      )}
    </section>
  );
}
