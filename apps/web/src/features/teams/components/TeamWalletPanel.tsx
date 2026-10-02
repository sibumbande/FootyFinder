import {
  TEAM_CONTRIBUTION_MAX_CENTS,
  TEAM_CONTRIBUTION_MIN_CENTS,
  type TeamDetail,
  type TeamWalletEntry,
  type TeamWalletSummary,
} from '@footy-finder/shared';
import { type FormEvent, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/Button.js';
import { FormError } from '@/components/ui/FormError.js';
import { useConfirm } from '@/components/ui/ConfirmDialog.js';
import { useNotifications } from '@/features/notifications/NotificationProvider.js';
import { formatDate } from '@/utils/format-date.js';
import { formatRands } from '@/utils/format-currency.js';
import {
  useContributeToTeam,
  useRefundTeamContribution,
  useTeamWalletHistory,
  useTeamWalletHolds,
  useTeamWalletSummary,
} from '../hooks/useTeamWallet.js';

/** Parses a whole-rand amount typed by the user; null when it is not a whole number of rands. */
export const parseRands = (value: string) => {
  const trimmed = value.trim().replace(/^R\s*/i, '').replace(/[\s,]/g, '');
  return /^\d+$/.test(trimmed) ? Number(trimmed) * 100 : null;
};

/**
 * Gate 7 / TKT-703 (DEC-014): the Team Wallet tab. Members see the balance and every movement
 * with the contributor's name, and can contribute or take back their own unspent money. Only
 * owners and captains see money held for team matches.
 */
export function TeamWalletPanel({ team }: { team: TeamDetail }) {
  const summary = useTeamWalletSummary(team.id);
  const canManage = team.viewerRole === 'OWNER' || team.viewerRole === 'CAPTAIN';
  if (summary.isPending) return <div className="h-40 animate-pulse rounded-2xl bg-surface-muted" />;
  if (summary.error || !summary.data) return <FormError message={summary.error?.message ?? 'The team wallet could not be loaded.'} />;
  return (
    <section className="grid gap-6" aria-labelledby="team-wallet-heading">
      <div>
        <h2 id="team-wallet-heading" className="text-xl font-bold text-content-strong">Team wallet</h2>
        <p className="mt-1 text-sm text-content-muted">
          Money in the team wallet pays your team&apos;s match fees. Any member can add money from their own wallet.
          It can&apos;t be withdrawn to a bank account or card.
        </p>
      </div>
      <Balances wallet={summary.data} />
      {summary.data.viewerCanContribute && <ContributeForm teamId={team.id} />}
      <YourMoney teamId={team.id} wallet={summary.data} />
      {canManage && <Holds teamId={team.id} />}
      <History teamId={team.id} />
    </section>
  );
}

function Balances({ wallet }: { wallet: TeamWalletSummary }) {
  const cards = [
    { label: 'Balance', value: wallet.balanceCents },
    { label: 'Held for team matches', value: wallet.heldCents },
    { label: 'Available', value: wallet.availableCents },
  ];
  return (
    <dl className="grid gap-3 sm:grid-cols-3">
      {cards.map((card) => (
        <div key={card.label} className="rounded-2xl border border-line bg-canvas p-4">
          <dt className="text-xs font-black uppercase tracking-[0.08em] text-content-muted">{card.label}</dt>
          <dd className="mt-1 text-2xl font-black text-content-strong">{formatRands(card.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function ContributeForm({ teamId }: { teamId: string }) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string>();
  const [confirming, setConfirming] = useState(false);
  const attemptKey = useRef<string>();
  const contribute = useContributeToTeam(teamId);
  const { notify } = useNotifications();
  const amountCents = parseRands(value);
  const reset = () => {
    setConfirming(false);
    setError(undefined);
    attemptKey.current = undefined;
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (amountCents === null || amountCents < TEAM_CONTRIBUTION_MIN_CENTS || amountCents > TEAM_CONTRIBUTION_MAX_CENTS) {
      setError(`Enter a whole rand amount from ${formatRands(TEAM_CONTRIBUTION_MIN_CENTS)} to ${formatRands(TEAM_CONTRIBUTION_MAX_CENTS)}.`);
      return;
    }
    if (!confirming) {
      setConfirming(true);
      return;
    }
    attemptKey.current ??= crypto.randomUUID();
    contribute.mutate(
      { amountCents, idempotencyKey: attemptKey.current },
      {
        onSuccess: () => {
          notify({ variant: 'success', title: 'Added to the team wallet', message: `${formatRands(amountCents)} moved from your wallet to the team wallet.` });
          setValue('');
          reset();
        },
      },
    );
  };
  return (
    <form onSubmit={submit} noValidate className="rounded-2xl border border-line p-4" aria-labelledby="contribute-heading">
      <h3 id="contribute-heading" className="font-bold text-content-strong">Add money from your wallet</h3>
      <label className="mt-3 block text-sm font-bold text-content-strong">
        Amount in rands
        <input
          className="mt-1 block w-full rounded-xl border-2 border-line bg-canvas px-3 py-2"
          inputMode="numeric"
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            reset();
          }}
          placeholder="e.g. 200"
          aria-describedby="contribute-range"
        />
        <span id="contribute-range" className="mt-1 block text-xs font-normal text-content-muted">
          {formatRands(TEAM_CONTRIBUTION_MIN_CENTS)} to {formatRands(TEAM_CONTRIBUTION_MAX_CENTS)}, at most R5,000 and 10 times per team in 24 hours.
        </span>
      </label>
      {confirming && amountCents !== null && (
        <p className="mt-3 rounded-xl bg-brand-50 p-3 text-sm font-semibold text-brand-700">
          Move {formatRands(amountCents)} from your wallet to the team wallet? You can take back money the team hasn&apos;t spent.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="submit" loading={contribute.isPending}>{confirming ? 'Confirm contribution' : 'Contribute'}</Button>
        {confirming && <Button type="button" variant="ghost" onClick={reset}>Change amount</Button>}
      </div>
      <FormError message={error ?? contribute.error?.message} />
      {contribute.error && /enough/i.test(contribute.error.message) && (
        <Link className="mt-2 inline-block text-sm font-bold underline" to="/wallet#top-up">Top up your wallet</Link>
      )}
    </form>
  );
}

function YourMoney({ teamId, wallet }: { teamId: string; wallet: TeamWalletSummary }) {
  const refund = useRefundTeamContribution(teamId);
  const attemptKey = useRef<string>();
  const { notify } = useNotifications();
  const { confirm, confirmDialog } = useConfirm();
  if (!wallet.viewerUnspentCents) return null;
  const amountCents = wallet.viewerRefundableCents;
  return (
    <div className="rounded-2xl border border-line p-4">
      {confirmDialog}
      <h3 className="font-bold text-content-strong">Your unspent contributions</h3>
      <p className="mt-1 text-sm text-content-muted">
        {formatRands(wallet.viewerUnspentCents)} of what you put in hasn&apos;t been spent yet. The team spends the oldest contributions first.
        {amountCents < wallet.viewerUnspentCents && ' Money held for a team match can only be taken back if that match is cancelled.'}
      </p>
      {amountCents > 0 && (
        <Button
          className="mt-3"
          variant="secondary"
          loading={refund.isPending}
          onClick={async () => {
            const { confirmed } = await confirm({ title: `Move ${formatRands(amountCents)} back to your own wallet?`, message: <p>It leaves the team wallet straight away.</p>, confirmLabel: 'Take it back' });
            if (!confirmed) return;
            attemptKey.current ??= crypto.randomUUID();
            refund.mutate(
              { amountCents, idempotencyKey: attemptKey.current },
              {
                onSuccess: () => {
                  attemptKey.current = undefined;
                  notify({ variant: 'success', title: 'Money returned', message: `${formatRands(amountCents)} is back in your wallet.` });
                },
              },
            );
          }}
        >
          Take back {formatRands(amountCents)}
        </Button>
      )}
      <FormError message={refund.error?.message} />
    </div>
  );
}

function Holds({ teamId }: { teamId: string }) {
  const holds = useTeamWalletHolds(teamId, true);
  if (!holds.data?.length) return null;
  return (
    <div className="rounded-2xl border border-line p-4">
      <h3 className="font-bold text-content-strong">Held for team matches</h3>
      <p className="mt-1 text-sm text-content-muted">Taken only if the match goes ahead; otherwise released back to the team wallet.</p>
      <ul className="mt-3 grid gap-2">
        {holds.data.map((hold) => (
          <li key={hold.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <Link className="font-semibold underline" to={`/matches/${hold.match.id}`}>{hold.match.name}</Link>
            <span className="text-content-muted">{formatDate(hold.match.startsAt)}</span>
            <span className="font-black text-content-strong">{formatRands(hold.amountCents)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function EntryRow({ entry }: { entry: TeamWalletEntry }) {
  const credit = entry.amountCents >= 0;
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-3 last:border-b-0">
      <div className="min-w-0">
        <p className="font-bold text-content-strong">{entry.title}</p>
        <p className="text-sm text-content-muted">
          {formatDate(entry.createdAt)}
          {entry.contributor && ` · ${entry.contributor.displayName}`}
          {entry.related && (
            <>
              {' · '}
              <Link className="font-semibold underline" to={`/matches/${entry.related.id}`}>{entry.related.name}</Link>
            </>
          )}
        </p>
      </div>
      <p className={`whitespace-nowrap text-lg font-black ${credit ? 'text-brand-700' : 'text-content-strong'}`}>
        {credit ? '+' : '−'}
        {formatRands(Math.abs(entry.amountCents))}
      </p>
    </li>
  );
}

function History({ teamId }: { teamId: string }) {
  const history = useTeamWalletHistory(teamId);
  const entries = history.data?.pages.flatMap((page) => page.entries) ?? [];
  return (
    <div>
      <h3 className="font-bold text-content-strong">History</h3>
      {history.isPending ? (
        <div className="mt-3 h-24 animate-pulse rounded-2xl bg-surface-muted" />
      ) : history.error ? (
        <FormError message={history.error.message} />
      ) : entries.length === 0 ? (
        <p className="mt-2 text-sm text-content-muted">No money has moved yet. Contributions and team match fees will show here.</p>
      ) : (
        <ul className="mt-2">{entries.map((entry) => <EntryRow key={entry.id} entry={entry} />)}</ul>
      )}
      {history.hasNextPage && (
        <Button className="mt-3" variant="secondary" loading={history.isFetchingNextPage} onClick={() => void history.fetchNextPage()}>
          Load more
        </Button>
      )}
    </div>
  );
}
