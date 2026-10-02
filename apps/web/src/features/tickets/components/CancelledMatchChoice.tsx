import type { MatchTicketContext } from '@footy-finder/shared';
import { useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { formatDate } from '@/utils/format-date.js';
import { formatWholeRands } from '@/utils/format-currency.js';
import { useTicketChoice } from '../hooks/useTickets.js';

/**
 * DEC-021 A3: a cancelled match asks every payer to choose 1 match credit or a full refund for each place they paid
 * for. Without a choice within 7 days they are refunded automatically. The email links (?choice=credit|refund) open
 * this panel with that choice highlighted; nothing happens until the payer confirms here.
 */
export function CancelledMatchChoice({ matchId, context }: { matchId: string; context: MatchTicketContext }) {
  const choose = useTicketChoice(matchId);
  const [search] = useSearchParams();
  const suggested = search.get('choice');
  const pending = context.pendingChoices;
  if (!pending.length) return null;
  const total = pending.reduce((sum, item) => sum + item.amountCents, 0);
  const deadline = pending.map(({ choiceDeadlineAt }) => choiceDeadlineAt).sort()[0]!;
  const places = pending.length === 1 ? 'your place' : `your ${pending.length} places`;
  return (
    <section className="grid gap-3 rounded-3xl border-2 border-brand-600 bg-brand-50 p-5" aria-labelledby="cancelled-choice-heading" data-testid="cancelled-match-choice">
      <h2 id="cancelled-choice-heading" className="text-xl font-black text-content-strong">This match was cancelled: choose what you get back</h2>
      <p className="text-sm text-content">
        You paid {formatWholeRands(total)} for {places}
        {pending.length > 1 ? ` (${pending.map(({ playerDisplayName }) => playerDisplayName).join(', ')})` : ''}. Choose a match credit or a full refund.
        If you don’t choose by {formatDate(deadline)}, you’re refunded automatically.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          disabled={choose.isPending}
          onClick={() => choose.mutate('CREDIT')}
          className={`grid min-h-16 gap-0.5 rounded-2xl border-2 p-4 text-left disabled:opacity-60 ${suggested === 'refund' ? 'border-line bg-surface' : 'border-brand-600 bg-surface shadow-sm'}`}
        >
          <span className="font-black text-brand-700">{pending.length === 1 ? 'Get 1 match credit' : `Get ${pending.length} match credits`}</span>
          <span className="text-sm text-content">Use {pending.length === 1 ? 'it' : 'them'} on any match. Valid for 3 years.</span>
        </button>
        <Button variant={suggested === 'refund' ? 'primary' : 'secondary'} disabled={choose.isPending} onClick={() => choose.mutate('REFUND')}>
          Refund {formatWholeRands(total)} to my card / bank
        </Button>
      </div>
      <FormError message={choose.error?.message} />
      {choose.isSuccess && <p role="status" className="text-sm font-bold text-content-strong">Done. {choose.data.choice === 'CREDIT' ? 'Your credit is ready to use.' : 'Your refund is on its way.'}</p>}
    </section>
  );
}
