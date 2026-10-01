import type { MatchFormat } from '@footy-finder/shared';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { FormError } from '@/components/ui/FormError.js';
import { Input } from '@/components/ui/Input.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { GuestAction } from '@/features/public/components/SignUpPrompt.js';
import { usePublicMatches } from '@/features/public/hooks/usePublic.js';
import { GuestMatchCard, MatchCard } from '../components/MatchCard.js';
import { useMatches } from '../hooks/useMatches.js';

type Filters = { format: MatchFormat | ''; date: string; availableOnly: boolean };

// CEO touch-up batch 2, item 5: guests see this same page; their cards come from the public list
// (counts only, TKT-910) and "Create Match!" becomes "Sign up to play".
export function MatchListPage() {
  const { user } = useAuth();
  const [format, setFormat] = useState<MatchFormat | ''>('');
  const [date, setDate] = useState('');
  const [availableOnly, setAvailableOnly] = useState(true);
  const filters = { format, date, availableOnly };
  return (
    <section className="grid gap-7">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="anime-kicker">Match discovery</p>
          <h1 className="mt-3 text-4xl font-black uppercase leading-none text-content-strong">
            Find your next game
          </h1>
          <p className="mt-2 text-content-muted">Only public, upcoming matches appear here.</p>
        </div>
        {user ? (
          <Link className="button" to="/matches/new">
            Create Match!
          </Link>
        ) : (
          <GuestAction action="create a match" />
        )}
      </div>
      <div className="anime-panel grid gap-3 p-4 sm:grid-cols-3">
        <label className="grid gap-1 text-xs font-bold text-content-muted">
          Format
          <select
            className="min-h-11 rounded-xl border border-line-strong bg-surface px-3 text-sm text-content"
            value={format}
            onChange={(event) => setFormat(event.target.value as MatchFormat | '')}
          >
            <option value="">All formats</option>
            <option value="FIVE_A_SIDE">5v5</option>
            <option value="SEVEN_A_SIDE">7v7</option>
            <option value="ELEVEN_A_SIDE">11v11</option>
          </select>
        </label>
        <Input
          label="Date"
          type="date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <label className="flex min-h-11 items-center gap-2 self-end rounded-xl border border-line px-3 text-sm font-semibold text-content">
          <input
            type="checkbox"
            checked={availableOnly}
            onChange={(event) => setAvailableOnly(event.target.checked)}
          />
          Available spaces
        </label>
      </div>
      {user ? <MemberMatches filters={filters} /> : <GuestMatches filters={filters} />}
    </section>
  );
}

function MatchGrid({ pending, error, empty, children }: { pending: boolean; error?: string; empty: boolean; children: ReactNode }) {
  return (
    <>
      {pending && (
        <div className="match-grid">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-64 animate-pulse rounded-2xl bg-surface" />
          ))}
        </div>
      )}
      <FormError message={error} />
      {empty && (
        <div className="rounded-3xl border border-dashed border-line-strong bg-surface p-12 text-center">
          <h2 className="text-xl font-bold text-content-strong">No matching games</h2>
          <p className="mt-2 text-content-muted">
            Try another date or format, or create the first one.
          </p>
        </div>
      )}
      <div className="match-grid">{children}</div>
    </>
  );
}

function MemberMatches({ filters: { format, date, availableOnly } }: { filters: Filters }) {
  const matches = useMatches({
    format: format || undefined,
    dateFrom: date ? new Date(`${date}T00:00:00`).toISOString() : undefined,
    dateTo: date ? new Date(`${date}T23:59:59`).toISOString() : undefined,
    availableOnly,
  });
  return (
    <MatchGrid pending={matches.isPending} error={matches.error?.message} empty={matches.data?.length === 0}>
      {matches.data?.map((match) => <MatchCard key={match.id} match={match} />)}
    </MatchGrid>
  );
}

function GuestMatches({ filters: { format, date, availableOnly } }: { filters: Filters }) {
  const matches = usePublicMatches(format || undefined);
  const from = date ? new Date(`${date}T00:00:00`).getTime() : -Infinity;
  const to = date ? new Date(`${date}T23:59:59`).getTime() : Infinity;
  const shown = matches.data?.filter((match) => {
    const startsAt = new Date(match.startsAt).getTime();
    return startsAt >= from && startsAt <= to && (!availableOnly || match.capacity.filled < match.capacity.total);
  });
  return (
    <MatchGrid pending={matches.isPending} error={matches.error?.message} empty={shown?.length === 0}>
      {shown?.map((match) => <GuestMatchCard key={match.slug} match={match} />)}
    </MatchGrid>
  );
}
