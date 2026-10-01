import type { UndoableTopUp } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { walletClient } from '@/api/client.js';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { currentUserKey } from '@/features/auth/hooks/useAuth.js';
import { useNotifications } from '@/features/notifications/NotificationProvider.js';
import { formatRands } from '@/utils/format-currency.js';
import { parseRandInput } from './TopUpForm.js';
import { walletKey } from '../hooks/useWallet.js';

const undoableKey = [...walletKey, 'undoable'] as const;
const BLOCKED: Record<NonNullable<UndoableTopUp['blockedReason']>, string> = {
  ALREADY_UNDONE: 'Already undone',
  WALLET_RESTRICTED: 'Not available while your wallet is restricted',
  DISPUTED: 'Not available: this payment is disputed',
};

/**
 * CEO touch-up batch 3, item 6b: "Undo top-up". Within 24 hours of a top-up, the unspent part (full or partial)
 * goes back to the same card through Paystack, once per top-up (ToS 13.5).
 */
export function UndoTopUps() {
  const undoable = useQuery({ queryKey: undoableKey, queryFn: async () => (await walletClient.undoableTopUps()).data });
  if (!undoable.data?.length) return null;
  return (
    <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6" aria-labelledby="undo-top-up" data-testid="undo-top-ups">
      <h2 id="undo-top-up" className="text-xl font-black uppercase text-content-strong">Undo a top-up</h2>
      <p className="mt-1 text-sm text-content-muted">
        Made a mistake? Within 24 hours you can send the unspent part of a top-up back to the card you paid with, once per top-up.
      </p>
      <ul className="mt-4 grid gap-3">
        {undoable.data.map((topUp) => <UndoRow key={topUp.paymentId} topUp={topUp} />)}
      </ul>
    </section>
  );
}

function UndoRow({ topUp }: { topUp: UndoableTopUp }) {
  const cache = useQueryClient();
  const { notify } = useNotifications();
  const [amount, setAmount] = useState(String(topUp.refundableCents / 100));
  const [confirming, setConfirming] = useState(false);
  const [problem, setProblem] = useState<string>();
  // One key per confirmed attempt: a double tap or a retry can never refund twice.
  const attemptKey = useRef<string>();
  const amountCents = parseRandInput(amount);
  const undo = useMutation({
    mutationFn: (cents: number) => walletClient.undoTopUp(topUp.paymentId, cents, (attemptKey.current ??= crypto.randomUUID())),
    onSuccess: ({ data }) => {
      notify({ variant: 'success', title: 'Top-up undone', message: `${formatRands(data.amountCents)} is on its way back to your card.` });
      setConfirming(false);
      attemptKey.current = undefined;
      void cache.invalidateQueries({ queryKey: walletKey });
      void cache.invalidateQueries({ queryKey: currentUserKey });
    },
  });
  const blocked = topUp.blockedReason ? BLOCKED[topUp.blockedReason] : topUp.refundableCents === 0 ? 'Nothing left to undo: this top-up has been spent' : undefined;
  const submit = () => {
    if (amountCents === null || amountCents <= 0 || amountCents > topUp.refundableCents) {
      setProblem(`Enter an amount up to ${formatRands(topUp.refundableCents)}.`);
      return;
    }
    setProblem(undefined);
    if (!confirming) return setConfirming(true);
    undo.mutate(amountCents);
  };
  return (
    <li className="grid gap-3 rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <strong className="text-content-strong">Top-up of {formatRands(topUp.amountCents)}</strong>
        <span className="text-xs text-content-muted">Undo until {new Date(topUp.undoUntil).toLocaleString()}</span>
      </div>
      {blocked ? (
        <p className="text-sm text-content-muted">{blocked}</p>
      ) : (
        <>
          <label className="grid gap-1 text-sm font-bold text-content-strong">
            Amount to send back (up to {formatRands(topUp.refundableCents)})
            <input
              className="h-12 rounded-md border-2 border-line-strong bg-surface px-3 text-sm font-semibold"
              inputMode="decimal"
              value={amount}
              onChange={(event) => {
                setAmount(event.target.value);
                setConfirming(false);
                attemptKey.current = undefined;
              }}
            />
          </label>
          {confirming && amountCents !== null && (
            <p className="rounded-xl bg-canvas p-3 text-sm font-semibold text-content-strong" role="status">
              Send {formatRands(amountCents)} back to your card? This can only be done once for this top-up.
            </p>
          )}
          <FormError message={problem ?? undo.error?.message} />
          <div className="flex flex-wrap gap-2">
            <Button variant={confirming ? 'primary' : 'secondary'} loading={undo.isPending} onClick={submit}>
              {confirming && amountCents !== null ? `Yes, send ${formatRands(amountCents)} back` : 'Undo top-up'}
            </Button>
            {confirming && <Button variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>}
          </div>
        </>
      )}
    </li>
  );
}
