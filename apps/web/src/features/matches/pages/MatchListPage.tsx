import { Link } from 'react-router-dom';
import { FormError } from '@/components/ui/FormError.js';
import { MatchCard } from '../components/MatchCard.js';
import { useMatches } from '../hooks/useMatches.js';

export function MatchListPage() {
  const matches = useMatches();
  return <section className="grid gap-7"><div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-sm font-bold uppercase tracking-[0.16em] text-brand-600">Match discovery</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-content-strong">Available match lobbies</h1><p className="mt-2 text-content-muted">Join an open squad or book a new field.</p></div><Link className="button" to="/matches/new">Create Match!</Link></div>{matches.isPending && <div className="match-grid">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-64 animate-pulse rounded-2xl border border-line bg-surface" />)}</div>}<FormError message={matches.error instanceof Error ? matches.error.message : undefined} />{matches.data?.length === 0 && <div className="rounded-3xl border border-dashed border-line-strong bg-surface p-12 text-center"><h2 className="text-xl font-bold text-content-strong">No upcoming matches yet</h2><p className="mt-2 text-content-muted">Be the first to book a field and open a lobby.</p><Link className="button mt-5" to="/matches/new">Create Match!</Link></div>}<div className="match-grid">{matches.data?.map((match) => <MatchCard key={match.id} match={match} />)}</div></section>;
}
