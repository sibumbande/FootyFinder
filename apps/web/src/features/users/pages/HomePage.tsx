import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FormError } from '@/components/ui/FormError.js';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { GuestMatchCard, MatchCard } from '@/features/matches/components/MatchCard.js';
import { useMatches } from '@/features/matches/hooks/useMatches.js';
import { GuestAction } from '@/features/public/components/SignUpPrompt.js';
import { usePublicMatches } from '@/features/public/hooks/usePublic.js';
import { VenueCard } from '@/features/venues/components/VenueCard.js';
import { useVenues } from '@/features/venues/hooks/useVenues.js';

// CEO touch-up batch 2, item 5: guests get this same home page (venues and upcoming matches); only the
// action buttons change to "Sign up to play", and guest match cards carry counts only (TKT-910).
export function HomePage() {
  const { user } = useAuth();
  const venues = useVenues();
  const [params] = useSearchParams();
  const playAs = params.get('playAs');
  const venueSearch = playAs?.startsWith('team:') ? `?playAs=${encodeURIComponent(playAs)}${params.get('lock') === '1' ? '&lock=1' : ''}` : '';
  const name = user?.displayName || user?.username || 'player';
  return <section className="grid gap-10">
    <div className="relative min-h-[25rem] overflow-hidden rounded-[1.4rem_1.4rem_1.4rem_0.45rem] border-2 border-brand-900 bg-brand-900 bg-cover bg-[72%_center] text-content-inverse shadow-[8px_9px_0_rgb(var(--theme-accent-scarlet))] sm:min-h-[30rem]" style={{ backgroundImage: "url('/art/matchday-heroes.png')" }}>
      <div className="absolute inset-0 bg-[linear-gradient(90deg,rgb(var(--theme-brand-900)/0.98)_0%,rgb(var(--theme-brand-900)/0.9)_38%,rgb(var(--theme-brand-900)/0.25)_72%,transparent_100%)]" />
      <div className="relative flex min-h-[25rem] max-w-2xl flex-col justify-center p-6 sm:min-h-[30rem] sm:p-10 lg:p-12"><p className="inline-flex w-fit -skew-x-6 bg-danger-600 px-3 py-1.5 text-xs font-black uppercase tracking-[0.2em] text-content-inverse">Matchday is calling</p>{user ? <h1 className="mt-5 text-4xl font-black uppercase leading-[0.92] sm:text-6xl">Welcome back,<span className="block text-hero-accent">{name}</span></h1> : <h1 className="mt-5 text-4xl font-black uppercase leading-[0.92] sm:text-6xl">Find players. Build a squad.<span className="block text-hero-accent">Get on the pitch.</span></h1>}<p className="mt-5 max-w-lg text-lg font-semibold text-content-inverse/90">Choose an approved venue, select a live slot, and build your next match.</p><div className="mt-7 flex flex-wrap gap-3"><a href="#venues" className="inline-flex min-h-12 items-center rounded-md bg-hero-accent px-5 text-sm font-black uppercase text-ink">Find a venue</a>{user ? <Link to="/teams/create" className="inline-flex min-h-12 items-center rounded-md border-2 border-content-inverse px-5 text-sm font-black uppercase text-content-inverse">Create Team</Link> : <GuestAction action="create a team" className="inline-flex min-h-12 items-center rounded-md border-2 border-content-inverse px-5 text-sm font-black uppercase text-content-inverse" />}</div></div>
    </div>
    <section id="venues" className="grid gap-5"><div><p className="anime-kicker">Cape Town pitches</p><h2 className="mt-2 text-3xl font-black uppercase text-content-strong">Choose a venue</h2><p className="mt-1 text-sm text-content-muted">Every match is R80 a player, with a FootyFinder referee.</p></div>
      {venues.isPending && <div className="grid gap-5 md:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-72 animate-pulse rounded-3xl bg-surface" />)}</div>}<FormError message={venues.error?.message} />
      {venues.data?.length === 0 && <div className="rounded-2xl border border-warning-300 bg-warning-50 p-5"><strong className="text-content-strong">No venues are open yet.</strong><p className="mt-2 text-sm text-content-muted">New FootyFinder venues will appear here as soon as they open.</p></div>}
      <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{venues.data?.map((venue) => <VenueCard key={venue.slug} venue={venue} search={venueSearch} />)}</div>
      <Link className="w-fit font-bold text-brand-700 underline" to="/waiting-list">Outside Cape Town? Join a city waiting list</Link>
    </section>
    <section className="grid gap-5"><div className="flex items-end justify-between gap-4"><div><p className="anime-kicker">Players wanted</p><h2 className="mt-2 text-3xl font-black uppercase text-content-strong">Upcoming matches</h2><p className="mt-1 text-sm text-content-muted">Future public matches with paid capacity still available.</p></div><Link className="font-bold text-brand-700 underline" to="/matches">View all</Link></div>
      {user ? <MemberUpcoming /> : <GuestUpcoming />}
    </section>
  </section>;
}

function UpcomingGrid({ pending, error, empty, children }: { pending: boolean; error?: string; empty: boolean; children: ReactNode }) {
  return <>
    {pending && <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <div key={index} className="h-56 animate-pulse rounded-2xl bg-surface" />)}</div>}<FormError message={error} />
    {empty && <p className="rounded-2xl bg-surface p-5 text-content-muted">No open upcoming matches yet.</p>}
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
  </>;
}

function MemberUpcoming() {
  const upcoming = useMatches({ availableOnly: true, limit: 6 });
  return <UpcomingGrid pending={upcoming.isPending} error={upcoming.error?.message} empty={upcoming.data?.length === 0}>{upcoming.data?.map((match) => <MatchCard key={match.id} match={match} />)}</UpcomingGrid>;
}

function GuestUpcoming() {
  const upcoming = usePublicMatches();
  const open = upcoming.data?.filter((match) => match.capacity.filled < match.capacity.total).slice(0, 6);
  return <UpcomingGrid pending={upcoming.isPending} error={upcoming.error?.message} empty={open?.length === 0}>{open?.map((match) => <GuestMatchCard key={match.slug} match={match} />)}</UpcomingGrid>;
}
