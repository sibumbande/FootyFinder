import type { LeaderboardBoard, LeaderboardPeriod, LeaderboardRow } from '@footy-finder/shared';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { publicClient } from '@/api/client.js';
import { Avatar } from '@/components/ui/Avatar.js';
import { FormError } from '@/components/ui/FormError.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { publicKey } from '@/features/public/hooks/usePublic.js';
import { plural } from '@/utils/plural.js';

type Unit = readonly [singular: string, plural: string];
const BOARDS: Array<{ board: LeaderboardBoard; title: string; unit: Unit }> = [
  { board: 'matches', title: 'Most matches played', unit: ['match', 'matches'] },
  { board: 'goals', title: 'Most goals', unit: ['goal', 'goals'] },
  { board: 'assists', title: 'Most assists', unit: ['assist', 'assists'] },
];

const ordinal = (rank: number) => {
  const tens = rank % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th';
  return `${rank}${suffix}`;
};

/**
 * CEO touch-up batch 3.5, item 6: Cape Town leaderboards for matches played, goals and assists, this month or all
 * time. Only final results count (the same rules as profile statistics). Guests can see them; a signed-in player
 * outside the top 20 sees their own place under the list.
 */
export function LeaderboardsTab() {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div>
        <h2 className="text-2xl font-black uppercase text-content-strong">Cape Town leaderboards</h2>
        <p className="mt-1 text-sm text-content-muted">Only final results recorded by FootyFinder referees count. Players on the same number share a place.</p>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-3">
        {BOARDS.map((item) => <Board key={item.board} {...item} />)}
      </div>
    </div>
  );
}

function Board({ board, title, unit }: { board: LeaderboardBoard; title: string; unit: Unit }) {
  const { user } = useAuth();
  const [period, setPeriod] = useState<LeaderboardPeriod>('month');
  const data = useQuery({
    queryKey: [...publicKey, 'leaderboard', board, period, user?.id ?? 'guest'],
    queryFn: async () => (await publicClient.leaderboard(board, period)).data,
  });
  const headingId = `leaderboard-${board}`;
  return (
    <section className="min-w-0 rounded-2xl border border-line bg-surface-muted p-4" aria-labelledby={headingId} data-testid={`leaderboard-${board}`}>
      <h3 id={headingId} className="text-lg font-black uppercase text-content-strong">{title}</h3>
      <div className="mt-3 grid grid-cols-2 gap-1 rounded-full bg-surface p-1" role="group" aria-label={`${title}: period`}>
        {(['month', 'all'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={period === value}
            onClick={() => setPeriod(value)}
            className={`min-h-11 rounded-full px-3 text-xs font-black uppercase tracking-[0.06em] ${period === value ? 'bg-brand-600 text-content-inverse' : 'text-content-muted hover:text-content-strong'}`}
          >
            {value === 'month' ? 'This month' : 'All time'}
          </button>
        ))}
      </div>
      {data.isPending && <div className="mt-4 h-40 animate-pulse rounded-xl bg-surface" />}
      <FormError message={data.error?.message} />
      {data.data && (data.data.rows.length === 0 ? (
        <p className="mt-4 text-sm text-content-muted">{period === 'month' ? 'No results yet this month.' : 'No results yet.'}</p>
      ) : (
        <ol className="mt-4 grid gap-2">
          {data.data.rows.map((row) => <Row key={row.userId} row={row} unit={unit} mine={row.userId === user?.id} />)}
        </ol>
      ))}
      {data.data?.viewer && (
        <p className="mt-3 rounded-xl border border-line bg-surface p-3 text-sm font-bold text-content-strong" data-testid="leaderboard-viewer">
          Your place: {ordinal(data.data.viewer.rank)} ({plural(data.data.viewer.value, ...unit)})
        </p>
      )}
    </section>
  );
}

function Row({ row, unit, mine }: { row: LeaderboardRow; unit: Unit; mine: boolean }) {
  return (
    <li className={`flex min-w-0 items-center gap-3 rounded-xl p-2 ${mine ? 'bg-brand-50 ring-1 ring-brand-200' : 'bg-surface'}`}>
      <span className="w-8 shrink-0 text-center text-sm font-black text-content-strong" aria-label={`Place ${row.rank}`}>{row.rank}</span>
      <Avatar user={{ displayName: row.displayName, username: row.displayName, avatarUrl: row.avatarUrl }} size="sm" />
      <Link to={`/players/${row.userId}`} className="min-w-0 flex-1 truncate font-bold text-content-strong hover:underline">
        {row.displayName}{mine ? ' (you)' : ''}
      </Link>
      <span className="shrink-0 text-sm font-black text-content-strong" aria-label={plural(row.value, ...unit)}>{row.value}</span>
    </li>
  );
}
