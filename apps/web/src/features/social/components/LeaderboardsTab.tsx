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
import { PlayerName } from '@/components/ui/PlayerName.js';

type Unit = readonly [singular: string, plural: string];
type BoardInfo = { board: LeaderboardBoard; title: string; tab: string; column: string; unit: Unit; ranking: string };
/** Batch 5 brief, B3 (CEO D16): each board says how it is ranked and how ties are broken. */
const BOARDS: BoardInfo[] = [
  {
    board: 'matches',
    title: 'Most matches played',
    tab: 'Matches',
    column: 'Matches',
    unit: ['match', 'matches'],
    ranking: 'Ranked by matches played; ties go to most goals + assists, then whoever got there first.',
  },
  {
    board: 'goals',
    title: 'Most goals',
    tab: 'Goals',
    column: 'Goals',
    unit: ['goal', 'goals'],
    ranking: 'Ranked by goals; ties go to fewer matches played, then most assists, then whoever got there first.',
  },
  {
    board: 'assists',
    title: 'Most assists',
    tab: 'Assists',
    column: 'Assists',
    unit: ['assist', 'assists'],
    ranking: 'Ranked by assists; ties go to fewer matches played, then most goals, then whoever got there first.',
  },
];

const ordinal = (rank: number) => {
  const tens = rank % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][rank % 10] ?? 'th';
  return `${rank}${suffix}`;
};

/** Gold, silver and bronze for places 1 to 3 (fixed colours, readable in light and dark mode). */
const MEDAL: Record<number, string> = {
  1: 'bg-[#E8C547] text-[#3B2F00]',
  2: 'bg-[#C9CED6] text-[#1F2933]',
  3: 'bg-[#D19A66] text-[#3A1F05]',
};

/**
 * Cape Town leaderboards for matches played, goals and assists, this month or all time. Only final results count
 * (the same rules as profile statistics). Guests can see them. Batch 5 brief, B3: a strict 1, 2, 3 order with
 * tie-breakers, the top 10 plus "Your position" for a signed-in player outside it, and on phones one board at a
 * time behind tabs (Matches · Goals · Assists) instead of three squeezed columns.
 */
export function LeaderboardsTab() {
  const [active, setActive] = useState<LeaderboardBoard>('matches');
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5">
      <div>
        <h2 className="text-2xl font-black uppercase text-content-strong">Cape Town leaderboards</h2>
        <p className="mt-1 text-sm text-content-muted">Only final results recorded by FootyFinder referees count.</p>
      </div>
      <div className="grid grid-cols-3 gap-1 rounded-full bg-surface-muted p-1 lg:hidden" role="tablist" aria-label="Leaderboards">
        {BOARDS.map(({ board, tab }) => (
          <button
            key={board}
            type="button"
            role="tab"
            id={`leaderboard-tab-${board}`}
            aria-selected={active === board}
            aria-controls={`leaderboard-panel-${board}`}
            onClick={() => setActive(board)}
            className={`min-h-11 rounded-full px-2 text-sm font-black uppercase tracking-[0.04em] ${active === board ? 'bg-brand-600 text-content-inverse' : 'text-content-muted hover:text-content-strong'}`}
          >
            {tab}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-3">
        {BOARDS.map((item) => <Board key={item.board} info={item} hiddenOnPhone={active !== item.board} />)}
      </div>
    </div>
  );
}

function Board({ info, hiddenOnPhone }: { info: BoardInfo; hiddenOnPhone: boolean }) {
  const { board, title, column, unit, ranking } = info;
  const { user } = useAuth();
  const [period, setPeriod] = useState<LeaderboardPeriod>('month');
  const data = useQuery({
    queryKey: [...publicKey, 'leaderboard', board, period, user?.id ?? 'guest'],
    queryFn: async () => (await publicClient.leaderboard(board, period)).data,
  });
  const headingId = `leaderboard-${board}`;
  return (
    <section
      id={`leaderboard-panel-${board}`}
      className={`min-w-0 rounded-2xl border border-line bg-surface-muted p-4 ${hiddenOnPhone ? 'hidden lg:block' : ''}`}
      aria-labelledby={headingId}
      data-testid={`leaderboard-${board}`}
    >
      <h3 id={headingId} className="text-lg font-black uppercase text-content-strong">{title}</h3>
      <p className="mt-1 text-xs text-content-muted" data-testid="leaderboard-ranking">{ranking}</p>
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
        <>
          <div className="mt-4 flex items-center gap-3 px-2 text-xs font-black uppercase tracking-[0.06em] text-content-muted" aria-hidden="true">
            <span className="w-8 shrink-0 text-center">#</span>
            <span className="min-w-0 flex-1">Player</span>
            <span className="shrink-0">{column}</span>
          </div>
          <ol className="mt-1 grid gap-2" aria-label={title}>
            {data.data.rows.map((row) => <Row key={row.userId} row={row} unit={unit} mine={row.userId === user?.id} />)}
          </ol>
        </>
      ))}
      {data.data?.viewer && (
        <p className="mt-3 rounded-xl border border-line bg-surface p-3 text-sm font-bold text-content-strong" data-testid="leaderboard-viewer">
          Your position: {ordinal(data.data.viewer.rank)} ({plural(data.data.viewer.value, ...unit)})
        </p>
      )}
    </section>
  );
}

function Row({ row, unit, mine }: { row: LeaderboardRow; unit: Unit; mine: boolean }) {
  const medal = MEDAL[row.rank];
  return (
    <li
      className={`flex min-w-0 items-center gap-3 rounded-xl p-2 ${mine ? 'bg-brand-50 ring-2 ring-brand-500' : 'bg-surface'}`}
      data-testid="leaderboard-row"
    >
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-black ${medal ?? 'text-content-strong'}`}
        aria-label={`Place ${row.rank}`}
      >
        {row.rank}
      </span>
      <Avatar user={{ displayName: row.displayName, username: row.displayName, avatarUrl: row.avatarUrl }} size="sm" />
      <Link to={`/players/${row.userId}`} className="flex min-w-0 flex-1 items-center gap-2 font-bold text-content-strong hover:underline">
        {/* flex-1 gives the name its width: PlayerName never widens its box by itself (w-0 + min-w-full). */}
        <span className="min-w-0 flex-1"><PlayerName name={row.displayName} /></span>
        {mine && <span className="shrink-0 rounded-full bg-brand-600 px-2 py-0.5 text-xs font-black uppercase text-content-inverse">You</span>}
      </Link>
      <span className="shrink-0 text-sm font-black text-content-strong" aria-label={plural(row.value, ...unit)}>{row.value}</span>
    </li>
  );
}
