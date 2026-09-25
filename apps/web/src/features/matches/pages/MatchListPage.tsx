import type { MatchFormat } from '@footy-finder/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { FormError } from '@/components/ui/FormError.js';
import { Input } from '@/components/ui/Input.js';
import { MatchCard } from '../components/MatchCard.js';
import { useMatches } from '../hooks/useMatches.js';
export function MatchListPage() {
  const [format, setFormat] = useState<MatchFormat | ''>('');
  const [date, setDate] = useState('');
  const [availableOnly, setAvailableOnly] = useState(true);
  const matches = useMatches({
    format: format || undefined,
    dateFrom: date ? new Date(`${date}T00:00:00`).toISOString() : undefined,
    dateTo: date ? new Date(`${date}T23:59:59`).toISOString() : undefined,
    availableOnly,
  });
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
        <Link className="button" to="/matches/new">
          Create Match!
        </Link>
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
      {matches.isPending && (
        <div className="match-grid">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-64 animate-pulse rounded-2xl bg-surface" />
          ))}
        </div>
      )}
      <FormError message={matches.error?.message} />
      {matches.data?.length === 0 && (
        <div className="rounded-3xl border border-dashed border-line-strong bg-surface p-12 text-center">
          <h2 className="text-xl font-bold text-content-strong">No matching games</h2>
          <p className="mt-2 text-content-muted">
            Try another date or format, or create the first one.
          </p>
        </div>
      )}
      <div className="match-grid">
        {matches.data?.map((match) => (
          <MatchCard key={match.id} match={match} />
        ))}
      </div>
    </section>
  );
}
