import { Link, useSearchParams } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { formatRands } from '@/utils/format-currency.js';
import { useTopUpStatus } from '../hooks/useWallet.js';

const REFERENCE = /^ff_topup_[0-9a-f]{32}$/;

/**
 * Paystack sends the player back here with ?reference=…. Returning never credits anything: the
 * page only asks our server for the status, and the server confirms the payment with Paystack.
 */
export function TopUpReturnPage() {
  const [params] = useSearchParams();
  const raw = params.get('reference') ?? params.get('trxref');
  const reference = raw && REFERENCE.test(raw) ? raw : null;
  const status = useTopUpStatus(reference);

  return (
    <section className="mx-auto grid max-w-xl gap-5">
      <p className="anime-kicker">Wallet</p>
      <h1 className="text-3xl font-black uppercase text-content-strong">Card top-up</h1>
      {!reference && <FormError message="We could not find that top-up." />}
      <FormError message={status.error?.message} />
      {reference && status.isPending && <p className="text-content-muted">Checking your payment…</p>}
      {status.data?.state === 'PROCESSING' && (
        <div className="rounded-2xl border border-line bg-surface p-5" role="status">
          <p className="font-bold text-content-strong">
            {status.data.underReview
              ? 'Your payment is being checked by our finance team.'
              : `Confirming your ${formatRands(status.data.amountCents)} payment with Paystack…`}
          </p>
          <p className="mt-1 text-sm text-content-muted">
            Your wallet is credited as soon as the payment is confirmed. You can leave this page; we
            will notify you.
          </p>
          {!status.isFetching && (
            <Button variant="secondary" className="mt-3" onClick={() => void status.refetch()}>
              Check again
            </Button>
          )}
        </div>
      )}
      {status.data?.state === 'SUCCEEDED' && (
        <div className="rounded-2xl border border-line bg-surface p-5" role="status">
          <p className="font-bold text-content-strong">
            {formatRands(status.data.amountCents)} was added to your wallet.
          </p>
        </div>
      )}
      {status.data?.state === 'FAILED' && (
        <div className="rounded-2xl border border-warning-200 bg-warning-50 p-5 text-warning-700" role="status">
          <p className="font-bold">The card payment did not go through, so nothing was added.</p>
          <p className="mt-1 text-sm">If your card was charged, contact support and we will refund it to your card.</p>
        </div>
      )}
      <Link className="button text-center" to="/wallet">
        Back to wallet
      </Link>
    </section>
  );
}
