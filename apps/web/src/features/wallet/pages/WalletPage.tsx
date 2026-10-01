import type { WalletLedgerEntry } from '@footy-finder/shared';
import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { formatDate } from '@/utils/format-date.js';
import { formatRands } from '@/utils/format-currency.js';
import { ReclaimableTeamMoney } from '@/features/teams/components/ReclaimableTeamMoney.js';
import { TopUpForm } from '../components/TopUpForm.js';
import { useWalletHistory, useWalletSummary } from '../hooks/useWallet.js';

/** Only same-app match pages are offered as a way back after topping up. */
const safeReturnTo = (value: string | null) =>
  value && /^\/matches\/[0-9a-f-]{36}$/i.test(value) ? value : null;

const STATUS_LABEL: Record<WalletLedgerEntry['status'], string | null> = {
  SUCCEEDED: null,
  PENDING: 'Processing',
  FAILED: 'Failed – not charged to your wallet',
  ERROR: 'Failed – not charged to your wallet',
};

const CARD_REFUND_LABEL: Record<NonNullable<WalletLedgerEntry['cardRefund']>['state'], string> = {
  PENDING: 'On its way to your card',
  PROCESSING: 'On its way to your card',
  PROCESSED: 'Refunded to your card',
  FAILED: 'Card refund delayed – our finance team will contact you',
  RESTORED_TO_WALLET: 'Card refund failed – returned to your wallet',
};

function LedgerRow({ entry }: { entry: WalletLedgerEntry }) {
  const status = STATUS_LABEL[entry.status];
  const credit = entry.amountCents >= 0;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-4 last:border-b-0">
      <div className="min-w-0">
        <p className="font-bold text-content-strong">{entry.title}</p>
        <p className="text-sm text-content-muted">
          {formatDate(entry.createdAt)}
          {entry.related && (
            <>
              {' · '}
              <Link className="font-semibold underline" to={entry.related.type === 'team' ? `/teams/${entry.related.id}` : `/matches/${entry.related.id}`}>
                {entry.related.name}
              </Link>
            </>
          )}
        </p>
        {status && <p className="mt-1 text-xs font-bold uppercase text-warning-700">{status}</p>}
        {entry.cardRefund && (
          <p className="mt-1 text-xs font-bold uppercase text-content-muted">{CARD_REFUND_LABEL[entry.cardRefund.state]}</p>
        )}
      </div>
      <p
        className={`whitespace-nowrap text-lg font-black ${!entry.countsTowardsBalance ? 'text-content-subtle line-through' : credit ? 'text-brand-700' : 'text-content-strong'}`}
        aria-label={`${credit ? 'Credit' : 'Debit'} ${formatRands(Math.abs(entry.amountCents))}`}
      >
        {credit ? '+' : '−'}
        {formatRands(Math.abs(entry.amountCents))}
      </p>
    </li>
  );
}

export function WalletPage() {
  const summary = useWalletSummary();
  const history = useWalletHistory();
  const entries = history.data?.pages.flatMap((page) => page.entries) ?? [];
  const [params] = useSearchParams();
  const suggested = Number(params.get('amount'));
  const returnTo = safeReturnTo(params.get('returnTo'));

  return (
    <section className="grid gap-7">
      <header>
        <p className="anime-kicker">Wallet</p>
        <h1 className="mt-3 text-4xl font-black uppercase leading-none text-content-strong">
          Your wallet
        </h1>
        <p className="mt-2 text-content-muted">
          Wallet credit pays your R80 match fees. Refunds and cancellation credits come back here.
          Wallet credit cannot be withdrawn to a bank account.
        </p>
      </header>

      <FormError message={summary.error?.message} />
      {summary.isPending && <div className="h-28 animate-pulse rounded-2xl bg-surface" />}
      {summary.data && (
        <div className="grid gap-4 sm:grid-cols-3">
          <article className="rounded-2xl border-2 border-line-strong bg-brand-900 p-5 text-content-inverse">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-hero-accent">Balance</p>
            <p className="mt-2 text-3xl font-black">{formatRands(summary.data.balanceCents)}</p>
          </article>
          <article className="rounded-2xl border border-line bg-surface p-5">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">Available to spend</p>
            <p className="mt-2 text-2xl font-black text-content-strong">{formatRands(summary.data.availableCents)}</p>
          </article>
          <article className="rounded-2xl border border-line bg-surface p-5">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-content-muted">On hold</p>
            <p className="mt-2 text-2xl font-black text-content-strong">{formatRands(summary.data.heldCents)}</p>
          </article>
        </div>
      )}
      {summary.data?.spendingRestricted && (
        <p role="alert" className="rounded-xl border border-warning-200 bg-warning-50 p-4 text-warning-700">
          Spending from your wallet is paused while a card payment dispute is open or your balance is
          below zero. Contact <Link to="/support">support</Link> if you need help.
        </p>
      )}

      {returnTo && (
        <Link className="font-bold underline" to={returnTo}>
          Back to your match
        </Link>
      )}

      <TopUpForm initialCents={Number.isInteger(suggested) && suggested > 0 ? suggested : undefined} />

      <ReclaimableTeamMoney />

      <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6" aria-labelledby="wallet-history">
        <h2 id="wallet-history" className="text-xl font-black uppercase text-content-strong">
          History
        </h2>
        <FormError message={history.error?.message} />
        {history.isPending && (
          <div className="mt-4 grid gap-3">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="h-14 animate-pulse rounded-xl bg-canvas" />
            ))}
          </div>
        )}
        {history.data && entries.length === 0 && (
          <p className="mt-4 text-content-muted">No wallet activity yet.</p>
        )}
        {entries.length > 0 && (
          <ul className="mt-2">
            {entries.map((entry) => (
              <LedgerRow key={entry.id} entry={entry} />
            ))}
          </ul>
        )}
        {history.hasNextPage && (
          <Button
            variant="secondary"
            className="mt-4"
            loading={history.isFetchingNextPage}
            onClick={() => void history.fetchNextPage()}
          >
            Load more
          </Button>
        )}
      </section>
    </section>
  );
}
