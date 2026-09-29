import type { ReclaimableTeamContribution } from '@footy-finder/shared';
import { useRef } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { formatRands } from '@/utils/format-currency.js';
import { useReclaimableTeamMoney, useRefundTeamContribution } from '../hooks/useTeamWallet.js';

/**
 * Gate 7 / D8: on the personal wallet page, every team where the player still has unspent
 * contributions, including teams they have left, with a way to take that money back.
 */
export function ReclaimableTeamMoney() {
  const reclaimable = useReclaimableTeamMoney();
  if (!reclaimable.data?.length) return null;
  return (
    <section className="rounded-3xl border border-line bg-surface p-5 sm:p-6" aria-labelledby="team-money-heading">
      <h2 id="team-money-heading" className="text-xl font-black uppercase text-content-strong">Your money in team wallets</h2>
      <p className="mt-1 text-sm text-content-muted">
        Contributions a team hasn&apos;t spent yet. You can take them back to this wallet at any time, except money held for a team match.
      </p>
      <ul className="mt-3 grid gap-3">
        {reclaimable.data.map((row) => <Row key={row.team.id} row={row} />)}
      </ul>
    </section>
  );
}

function Row({ row }: { row: ReclaimableTeamContribution }) {
  const refund = useRefundTeamContribution(row.team.id);
  const attemptKey = useRef<string>();
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-line pb-3 last:border-b-0">
      <div>
        <Link className="font-bold underline" to={`/teams/${row.team.id}`}>{row.team.name}</Link>
        <p className="text-sm text-content-muted">
          {formatRands(row.unspentCents)} unspent
          {row.refundableCents < row.unspentCents && ` · ${formatRands(row.unspentCents - row.refundableCents)} held for a team match`}
        </p>
        <FormError message={refund.error?.message} />
      </div>
      {row.refundableCents > 0 && (
        <Button
          variant="secondary"
          loading={refund.isPending}
          onClick={() => {
            attemptKey.current ??= crypto.randomUUID();
            refund.mutate(
              { amountCents: row.refundableCents, idempotencyKey: attemptKey.current },
              { onSuccess: () => { attemptKey.current = undefined; } },
            );
          }}
        >
          Take back {formatRands(row.refundableCents)}
        </Button>
      )}
    </li>
  );
}
