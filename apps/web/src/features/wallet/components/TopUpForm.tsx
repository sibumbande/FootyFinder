import {
  TOP_UP_DEFAULT_CENTS,
  TOP_UP_LARGE_WARNING_CENTS,
  TOP_UP_MAX_CENTS,
  TOP_UP_MIN_CENTS,
  TOP_UP_QUICK_PICK_CENTS,
  topUpAmountSchema,
} from '@footy-finder/shared';
import { type FormEvent, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { useNotifications } from '@/features/notifications/NotificationProvider.js';
import { formatRands } from '@/utils/format-currency.js';
import { useTopUp, useTopUpOptions } from '../hooks/useWallet.js';

const rands = (cents: number) => `R${(cents / 100).toLocaleString('en-ZA')}`;

/** Parses a rand amount typed by the player ("160", "R 1 500") into cents, or null. */
export const parseRandInput = (value: string): number | null => {
  const cleaned = value.replace(/[R\s,]/gi, '');
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Math.round(Number(cleaned) * 100);
};

export function TopUpForm({ initialCents }: { initialCents?: number }) {
  const options = useTopUpOptions();
  const topUp = useTopUp(options.data?.provider);
  const card = options.data?.provider === 'paystack';
  const { notify } = useNotifications();
  const quickPicks = options.data?.quickPickCents ?? [...TOP_UP_QUICK_PICK_CENTS];
  const minCents = options.data?.minCents ?? TOP_UP_MIN_CENTS;
  const maxCents = options.data?.maxCents ?? TOP_UP_MAX_CENTS;
  const startCents =
    initialCents && initialCents >= minCents && initialCents <= maxCents
      ? Math.ceil(initialCents / 100) * 100
      : TOP_UP_DEFAULT_CENTS;
  const [selected, setSelected] = useState<number | 'custom'>(
    quickPicks.includes(startCents) ? startCents : 'custom',
  );
  const [custom, setCustom] = useState(quickPicks.includes(startCents) ? '' : String(startCents / 100));
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string>();
  // One key per confirmed attempt, so a retry of the same attempt can never credit twice.
  const attemptKey = useRef<string>();

  const amountCents = selected === 'custom' ? parseRandInput(custom) : selected;
  const validate = () => {
    const parsed = topUpAmountSchema.safeParse({ amountCents: amountCents ?? Number.NaN });
    if (!parsed.success) return parsed.error.issues[0]?.message ?? 'Enter a valid amount.';
    return undefined;
  };

  const choose = (value: number | 'custom') => {
    setSelected(value);
    setConfirming(false);
    setError(undefined);
    attemptKey.current = undefined;
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const problem = validate();
    setError(problem);
    if (problem || amountCents === null) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    attemptKey.current ??= crypto.randomUUID();
    topUp.mutate(
      { amountCents, idempotencyKey: attemptKey.current },
      {
        onSuccess: (result) => {
          if (result.kind === 'redirected') return; // Paystack checkout is loading.
          notify({ variant: 'success', title: 'Wallet topped up', message: `${formatRands(amountCents)} was added to your wallet.` });
          attemptKey.current = undefined;
          setConfirming(false);
        },
      },
    );
  };

  return (
    <form
      id="top-up"
      onSubmit={submit}
      noValidate
      className="rounded-3xl border border-line bg-surface p-5 sm:p-6"
      aria-labelledby="top-up-heading"
    >
      <h2 id="top-up-heading" className="text-xl font-black uppercase text-content-strong">
        Top up
      </h2>
      <p className="mt-1 text-sm text-content-muted">
        Card top-ups from {rands(minCents)} to {rands(maxCents)}. We pay the card fees, so the full
        amount goes into your wallet. Wallet credit cannot be withdrawn.
      </p>
      <fieldset className="mt-4">
        <legend className="text-sm font-bold text-content-strong">Choose an amount</legend>
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
          {quickPicks.map((cents) => (
            <button
              key={cents}
              type="button"
              aria-pressed={selected === cents}
              onClick={() => choose(cents)}
              className={`min-h-11 rounded-xl border-2 px-3 font-black ${selected === cents ? 'border-brand-900 bg-brand-600 text-content-inverse' : 'border-line bg-canvas text-content-strong hover:border-line-strong'}`}
            >
              {rands(cents)}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={selected === 'custom'}
            onClick={() => choose('custom')}
            className={`min-h-11 rounded-xl border-2 px-3 font-black ${selected === 'custom' ? 'border-brand-900 bg-brand-600 text-content-inverse' : 'border-line bg-canvas text-content-strong hover:border-line-strong'}`}
          >
            Other
          </button>
        </div>
      </fieldset>
      {selected === 'custom' && (
        <label className="mt-4 block text-sm font-bold text-content-strong">
          Amount in rands
          <input
            className="mt-1 block w-full rounded-xl border-2 border-line bg-canvas px-3 py-2"
            inputMode="numeric"
            value={custom}
            onChange={(event) => {
              setCustom(event.target.value);
              setConfirming(false);
              setError(undefined);
              attemptKey.current = undefined;
            }}
            placeholder="e.g. 300"
            aria-describedby="top-up-range"
          />
          <span id="top-up-range" className="mt-1 block text-xs font-normal text-content-muted">
            Whole rands, {rands(minCents)} to {rands(maxCents)}.
          </span>
        </label>
      )}
      <FormError message={error ?? topUp.error?.message ?? options.error?.message} />
      {confirming && amountCents !== null && (
        <div className="mt-4 grid gap-2 rounded-xl bg-canvas p-3 text-sm text-content-strong" role="status" data-testid="top-up-confirm">
          {/* CEO touch-up batch 3, item 6a: one clear check before checkout. */}
          <p className="font-semibold">You&apos;re adding {formatRands(amountCents)} to your wallet. Correct?</p>
          {amountCents >= TOP_UP_LARGE_WARNING_CENTS && (
            <p className="rounded-lg border border-warning-200 bg-warning-50 p-2 font-semibold text-warning-700" data-testid="top-up-large-warning">
              That&apos;s a large top-up. Check the amount: wallet credit cannot be withdrawn, though you can undo a top-up within 24 hours.
            </p>
          )}
          {card && <p className="text-content-muted">You will pay securely by card on Paystack, then come back here.</p>}
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="submit" loading={topUp.isPending}>
          {confirming && amountCents !== null
            ? `Yes, ${card ? 'pay' : 'add'} ${formatRands(amountCents)}`
            : 'Continue'}
        </Button>
        {confirming && (
          <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
            Change amount
          </Button>
        )}
      </div>
    </form>
  );
}
