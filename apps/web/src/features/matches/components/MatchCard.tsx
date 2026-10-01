import { getMaxMatchParticipants, MATCH_FORMAT_CONFIG, type Match, type PublicMatchPreview } from '@footy-finder/shared';
import { Link } from 'react-router-dom';
import { formatCurrency } from '@/utils/format-currency.js';
import { formatDate } from '@/utils/format-date.js';
import { FreeMatchBadge } from './FreeMatchBadge.js';
/** Gate 7 / DEC-019: how a public team match is labelled in the lobby. */
export const teamMatchLabel = (match: Pick<Match, 'otherSideMode' | 'otherSideTakenBy'>) =>
  !match.otherSideMode ? null
    : match.otherSideTakenBy === 'TEAM' ? 'Opponent found'
      : match.otherSideMode === 'TEAMS_ONLY' ? 'Teams only'
        : match.otherSideTakenBy === 'INDIVIDUALS' ? 'Open to players'
          : 'Open to teams and players';

const feeLabel = (match: Pick<Match, 'otherSideMode' | 'otherSideTakenBy' | 'feeCents'> & { currency?: string }) =>
  match.otherSideMode
    ? match.otherSideMode === 'OPEN' && match.otherSideTakenBy !== 'TEAM'
      ? `Players ${formatCurrency(match.feeCents, match.currency)} each`
      : 'Team fee from the team wallet'
    : match.feeCents === 0 ? 'Free' : formatCurrency(match.feeCents, match.currency);

type MatchCardViewProps = {
  name: string;
  format: Match['format'];
  status: string;
  teamMatch: boolean;
  substitutesPerTeam?: number;
  filled: number;
  capacity: number;
  teamLine?: string;
  venueName: string;
  city: string;
  startsAt: string;
  fee: string;
  href: string;
  /** CEO touch-up batch 3, item 5. */
  free?: boolean;
  firstTimersOnly?: boolean;
};

/** CEO touch-up batch 2, item 5: one card for members and guests alike (guests get counts only). */
function MatchCardView(props: MatchCardViewProps) {
  return (
    <article className="anime-panel flex h-full flex-col p-5 transition hover:-translate-y-1 hover:border-brand-500">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {props.teamMatch && <span className="score-chip bg-danger-600 text-content-inverse">Team match</span>}
          <span className="score-chip bg-brand-600 text-content-inverse">{MATCH_FORMAT_CONFIG[props.format].shortLabel}</span>
          <span className="score-chip bg-surface-muted text-content-muted">{props.status.replace('_', ' ').toLowerCase()}</span>
          {props.substitutesPerTeam !== undefined && (
            <span className="score-chip bg-warning-50 text-warning-700">+{props.substitutesPerTeam} subs/team</span>
          )}
        </div>
        <span className="text-sm font-bold text-content-muted">{props.filled}/{props.capacity}</span>
      </div>
      {props.free && <div className="mt-3 flex flex-wrap gap-2"><FreeMatchBadge firstTimersOnly={props.firstTimersOnly} /></div>}
      <h2 className="mt-4 text-2xl font-bold uppercase leading-tight text-content-strong">{props.name}</h2>
      {props.teamLine && <p className="mt-2 text-sm font-bold text-content-strong">{props.teamLine}</p>}
      <p className="mt-2 text-sm font-semibold text-brand-700">{props.venueName}</p>
      <p className="mt-1 text-sm text-content-muted">{props.city} · {formatDate(props.startsAt)}</p>
      <div className="mt-4 flex items-center justify-between text-sm">
        <span className="font-bold text-content-strong">{props.fee}</span>
      </div>
      <div className="mt-auto pt-5">
        <Link className="button w-full" to={props.href}>View match</Link>
      </div>
    </article>
  );
}

export function MatchCard({ match }: { match: Match }) {
  const home = match.otherSideMode ? match.teamSides.find((side) => side.side === 'HOME') : undefined;
  return (
    <MatchCardView
      name={match.name}
      format={match.format}
      status={match.status}
      teamMatch={Boolean(match.otherSideMode)}
      substitutesPerTeam={match.substituteCapacityPerTeam}
      filled={match.participantCount}
      capacity={getMaxMatchParticipants(match.format, match.substituteCapacityPerTeam)}
      teamLine={home ? `${home.teamNameSnapshot} · ${teamMatchLabel(match)}` : undefined}
      venueName={match.venue.name}
      city={match.venue.city}
      startsAt={match.startsAt}
      fee={match.freeOnFootyFinder ? 'Free, on FootyFinder' : feeLabel(match)}
      href={`/matches/${match.id}`}
      free={match.freeOnFootyFinder}
      firstTimersOnly={match.firstTimersOnly}
    />
  );
}

/** Gate 9 / TKT-910: the guest version reads the public preview (venue, time, fee, places; no names). */
export function GuestMatchCard({ match }: { match: PublicMatchPreview }) {
  const teamMatch = match.teamMatch;
  return (
    <MatchCardView
      name={match.name}
      format={match.format}
      status={match.status}
      teamMatch={Boolean(teamMatch)}
      substitutesPerTeam={match.substitutesPerTeam}
      filled={match.capacity.filled}
      capacity={match.capacity.total}
      teamLine={teamMatch ? `${teamMatch.homeTeamName} · ${teamMatchLabel(teamMatch)}` : undefined}
      venueName={match.venue.name}
      city={match.venue.city}
      startsAt={match.startsAt}
      fee={match.freeOnFootyFinder ? 'Free, on FootyFinder' : feeLabel({ otherSideMode: teamMatch?.otherSideMode, otherSideTakenBy: teamMatch?.otherSideTakenBy ?? null, feeCents: match.feeCents, currency: match.currency })}
      href={`/m/${match.slug}`}
      free={match.freeOnFootyFinder}
      firstTimersOnly={match.firstTimersOnly}
    />
  );
}
