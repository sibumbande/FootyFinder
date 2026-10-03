import type { MatchTicketContext } from '@footy-finder/shared';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { Sheet } from '@/components/ui/Sheet.js';
import { formatWholeRands } from '@/utils/format-currency.js';
import { useLeaveTicket } from '../hooks/useTickets.js';

/**
 * DEC-021 A2: the leave sheet says, before the player confirms, exactly what leaving gives back.
 * - More than 24 hours before kick-off (a paid place): 1 match credit (the highlighted, recommended choice: "Use it
 *   on any match") or a refund of the ticket price to the card or bank account they paid with.
 * - 24 hours or less: no refund and no credit; the place is released for someone else.
 * - A credit-paid place gets its credit back; a free place gives nothing back.
 * - A place a teammate paid for (A5): the player just leaves; more than 24 hours out the teammate who paid chooses
 *   the credit or refund, and both are told.
 */
export function TicketLeaveSheet({ matchId, context, onClose, onLeft }: { matchId: string; context: MatchTicketContext; onClose: () => void; onLeft: (message: string) => void }) {
  const leave = useLeaveTicket(matchId);
  const ticket = context.ticket;
  const free = ticket?.method === 'FREE';
  const price = formatWholeRands(ticket?.amountCents ?? context.feeCents);
  const submit = (choice?: 'CREDIT' | 'REFUND') =>
    leave.mutate(choice, {
      onSuccess: ({ outcome }) =>
        onLeft(
          outcome === 'CREDIT_ISSUED'
            ? '1 match credit was added to your account. Use it on any match.'
            : outcome === 'REFUNDED'
              ? `Your ${price} refund is on its way to the card or bank account you paid with.`
              : outcome === 'CREDIT_RETURNED'
                ? 'Your match credit was returned to you.'
                : outcome === 'PAYER_CHOOSES'
                  ? `You left the match. ${payer} paid for your place, so they choose a match credit or a refund.`
                  : 'You left the match.',
        ),
    });
  const notMine = Boolean(ticket && !ticket.paidByMe && !free);
  const payer = ticket?.payerDisplayName ?? 'The teammate who paid';
  return (
    <Sheet title="Leave this match?" onClose={onClose} busy={leave.isPending} testId="ticket-leave-sheet">
      {notMine && context.leave.outcome === 'CHOICE' ? (
        <>
          <p className="mt-4 rounded-xl bg-surface-muted p-3 text-sm text-content" data-testid="leave-payer-chooses">
            {payer} paid for your place, so they choose what comes back: 1 match credit or a refund of {price} to the card or bank account they paid with. Your place is released for someone else.
          </p>
          <Button className="mt-5 w-full !border-danger-700 !bg-danger-600" onClick={() => submit()} loading={leave.isPending}>Leave match</Button>
        </>
      ) : free ? (
        <>
          <p className="mt-4 text-sm text-content">This is a free match: nothing was paid, so nothing is refunded. Your place is released for someone else.</p>
          <Button className="mt-5 w-full !border-danger-700 !bg-danger-600" onClick={() => submit()} loading={leave.isPending}>Leave match</Button>
        </>
      ) : context.leave.outcome === 'CHOICE' ? (
        <>
          <p className="mt-4 text-sm text-content">You’re leaving more than 24 hours before kick-off, so you choose what you get back.</p>
          <div className="mt-4 grid gap-3">
            <button
              type="button"
              disabled={leave.isPending}
              onClick={() => submit('CREDIT')}
              className="grid min-h-16 gap-0.5 rounded-2xl border-2 border-brand-600 bg-brand-50 p-4 text-left shadow-sm hover:bg-brand-100 disabled:opacity-60"
            >
              <span className="flex items-center gap-2 font-black text-brand-700">
                Get 1 match credit
                <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-black uppercase text-content-inverse">Recommended</span>
              </span>
              <span className="text-sm text-content">Use it on any match. Valid for 3 years.</span>
            </button>
            <Button variant="secondary" disabled={leave.isPending} onClick={() => submit('REFUND')}>
              Refund {price} to my card / bank
            </Button>
          </div>
        </>
      ) : context.leave.outcome === 'CREDIT_BACK' ? (
        <>
          <p className="mt-4 text-sm text-content">You paid with a match credit, so your credit comes back to you.</p>
          <Button className="mt-5 w-full" onClick={() => submit()} loading={leave.isPending}>Leave and get my credit back</Button>
        </>
      ) : (
        <>
          <p className="mt-4 rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm font-semibold text-warning-700" data-testid="leave-no-refund">
            Kick-off is 24 hours or less away, so you get no refund and no credit. Your place is released for someone else to buy.
          </p>
          <Button className="mt-5 w-full !border-danger-700 !bg-danger-600" onClick={() => submit()} loading={leave.isPending}>Leave without a refund</Button>
        </>
      )}
      <FormError message={leave.error?.message} />
      <Button variant="ghost" className="mt-2 w-full" onClick={onClose} disabled={leave.isPending}>Stay in match</Button>
    </Sheet>
  );
}
