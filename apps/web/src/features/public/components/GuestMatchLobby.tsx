import { MATCH_FORMAT_CONFIG, type PublicMatchPreview } from '@footy-finder/shared';
import { Link, useLocation } from 'react-router-dom';
import { GoNoGoBanner } from '@/features/matches/components/GoNoGoBanner.js';
import { MatchTimer } from '@/features/matches/components/MatchTimer.js';
import { MatchVenuePhoto } from '@/features/matches/components/MatchVenuePhoto.js';
import { ShareMatchActions } from '@/features/matches/components/ShareMatchActions.js';
import { QUICK_MATCH_SIDE_BADGES, QUICK_MATCH_SIDE_LABELS } from '@/features/matches/constants/quick-match-sides.js';
import { formatCurrency } from '@/utils/format-currency.js';
import { formatDate } from '@/utils/format-date.js';
import { GuestAction } from './SignUpPrompt.js';
import { PublicResult } from './PublicResult.js';

/** Why a guest cannot join right now, in plain words (only shown when places are not open). */
export function joinMessage(reason: PublicMatchPreview['joinability']['reason']) {
  switch (reason) {
    case 'AVAILABLE':
      return 'Places are available.';
    case 'FULL':
      return 'This match is full. The page remains available for match details.';
    case 'CANCELLED':
      return 'This match has been cancelled and cannot be joined.';
    case 'STARTED':
      return 'This match has already started and cannot be joined.';
    case 'COMPLETED':
      return 'This match has finished and cannot be joined.';
    case 'LINEUP_LOCKED':
      return 'The lineup locked 30 minutes before kickoff, so this match can no longer be joined.';
    case 'TEAMS_ONLY':
      return 'Only teams can take the other side of this team match.';
    case 'TAKEN_BY_TEAM':
      return 'A team has already taken the other side of this match.';
    default:
      return 'This match is not accepting players.';
  }
}

/**
 * CEO touch-up batch 2, item 5: a guest sees the same match lobby as a member: the header, the
 * go/no-go banner, both teams and the chat panel. Gate 9 / TKT-910 still holds: before a match is
 * played a guest sees how many places each side has filled, never who. Join and chat become
 * "Sign up to play".
 */
export function GuestMatchLobby({ preview }: { preview: PublicMatchPreview }) {
  const location = useLocation();
  const config = MATCH_FORMAT_CONFIG[preview.format];
  const endsAt = new Date(new Date(preview.startsAt).getTime() + preview.durationMinutes * 60_000).toISOString();
  const sideName = (side: 'HOME' | 'AWAY') =>
    side === 'HOME' ? preview.teamMatch?.homeTeamName || QUICK_MATCH_SIDE_LABELS.HOME : preview.teamMatch?.awayTeamName || QUICK_MATCH_SIDE_LABELS.AWAY;
  return (
    <section className="grid gap-6" data-testid="guest-match">
      <header className="rounded-3xl bg-brand-900 p-6 text-content-inverse shadow-soft sm:p-8">
        <MatchVenuePhoto venue={preview.venue} />
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap gap-2">
              <span className="rounded-full bg-brand-100 px-3 py-1 text-xs font-bold text-brand-700">{config.shortLabel}</span>
              <span className="rounded-full bg-content-inverse/10 px-3 py-1 text-xs font-bold">{preview.status.replace('_', ' ')}</span>
              <span className="rounded-full bg-content-inverse/10 px-3 py-1 text-xs font-bold">public</span>
              {preview.teamMatch && <span className="rounded-full bg-content-inverse/10 px-3 py-1 text-xs font-bold">Team match</span>}
            </div>
            <h1 className="mt-4 text-3xl font-black [overflow-wrap:anywhere] sm:text-4xl">{preview.name}</h1>
            <p className="mt-2 font-semibold text-hero-muted">{preview.venue.name}, {preview.venue.city}</p>
            <p className="mt-2 text-sm text-hero-muted">
              {formatDate(preview.startsAt)} · {preview.durationMinutes} minutes · {preview.feeCents ? formatCurrency(preview.feeCents) : 'Free'}
            </p>
            {preview.description && <p className="mt-4 max-w-2xl text-hero-muted">{preview.description}</p>}
            <p className="mt-3 text-sm text-hero-muted">{config.startersPerTeam} starters per team</p>
            {preview.rules.length > 0 && <p className="mt-1 text-sm text-hero-muted">Rules: {preview.rules.map(({ label }) => label).join(', ')}</p>}
          </div>
          <div className="grid grid-cols-2 gap-2 sm:flex">
            <MatchTimer startsAt={preview.startsAt} endsAt={endsAt} />
            <div className="rounded-2xl bg-content-inverse/10 px-4 py-3 text-center">
              <span className="block text-xl font-black">{preview.capacity.filled}/{preview.capacity.total}</span>
              <span className="text-[10px] font-bold uppercase text-hero-muted">Players</span>
            </div>
          </div>
        </div>
        <div className="mt-6 flex flex-wrap items-center gap-2">
          <GuestAction action="join this match" />
          <Link className="button-secondary inline-flex" to={`/login?returnTo=${encodeURIComponent(`${location.pathname}${location.search}`)}`}>Log in</Link>
        </div>
        {!preview.joinability.canJoin && <p className="mt-3 text-sm font-semibold text-hero-muted">{joinMessage(preview.joinability.reason)}</p>}
        <div className="mt-4">
          <ShareMatchActions
            facts={{ canonicalUrl: preview.canonicalUrl, name: preview.name, venueName: preview.venue.name, startsAt: preview.startsAt, filled: preview.capacity.filled, total: preview.capacity.total, feeCents: preview.feeCents }}
          />
        </div>
      </header>
      <GoNoGoBanner
        facts={preview}
        status={preview.status}
        feeCents={preview.feeCents}
        filled={preview.positions.filled}
        total={preview.positions.total}
        venueName={preview.venue.name}
        startsAt={preview.startsAt}
      />
      {preview.result && <PublicResult result={preview.result} />}
      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(20rem,1fr)]">
        <div className="grid gap-4 rounded-3xl border border-line bg-surface p-4 shadow-sm sm:p-6 md:grid-cols-2">
          {(['HOME', 'AWAY'] as const).map((side) => {
            const count = preview.sides[side === 'HOME' ? 'home' : 'away'];
            return (
              <section
                key={side}
                data-testid={`guest-side-${side.toLowerCase()}`}
                className={`grid gap-3 rounded-2xl border-2 p-4 ${side === 'HOME' ? 'border-team-home-border' : 'border-team-away-border'}`}
              >
                <h2 className={`flex items-center gap-2 text-xl font-black ${side === 'HOME' ? 'text-team-home' : 'text-team-away'}`}>
                  <span aria-hidden="true" className={`grid size-6 place-items-center rounded-full text-xs font-black text-on-team ${side === 'HOME' ? 'bg-team-home' : 'bg-team-away'}`}>
                    {QUICK_MATCH_SIDE_BADGES[side]}
                  </span>
                  <span className="min-w-0 [overflow-wrap:anywhere]">{sideName(side)} · {side === 'HOME' ? 'Home' : 'Away'}</span>
                </h2>
                <div className="relative grid aspect-[4/5] place-items-center overflow-hidden rounded-2xl border-4 border-pitch-border bg-pitch">
                  <div aria-hidden="true" className="absolute inset-x-0 top-1/2 h-0.5 bg-pitch-line/80" />
                  <div aria-hidden="true" className="absolute left-1/2 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-pitch-line/80" />
                  <div className="relative rounded-2xl bg-surface px-4 py-3 text-center shadow-soft">
                    <span className="block text-2xl font-black text-content-strong">{count.filled} of {count.total}</span>
                    <span className="text-xs font-bold uppercase text-content-muted">positions filled</span>
                  </div>
                </div>
              </section>
            );
          })}
          <p className="text-sm text-content-muted md:col-span-2">Who plays where is shown to signed-in players. Sign up to pick your position.</p>
        </div>
        <section className="grid gap-3 rounded-3xl border border-line bg-surface p-5 shadow-sm">
          <h2 className="text-2xl font-black text-content-strong">Lobby chat</h2>
          <p className="text-sm text-content-muted">The organiser and players talk here before kickoff. Sign up to join in.</p>
          <GuestAction action="chat with the players" />
        </section>
      </div>
    </section>
  );
}
