import { MATCH_FORMAT_CONFIG, type TeamSummary } from '@footy-finder/shared';
import { Link } from 'react-router-dom';
import { TeamAvatar } from './TeamAvatar.js';

export function TeamCard({ team }: { team: TeamSummary }) {
  return (
    <Link
      to={`/teams/${team.id}`}
      className="anime-panel group p-5 transition hover:-translate-y-1 hover:border-brand-500"
    >
      <div className="flex items-start gap-4">
        <TeamAvatar team={team} />
        <div className="min-w-0 flex-1">
          <p className="break-words text-xl font-bold uppercase leading-snug text-content-strong">{team.name}</p>
          <p className="mt-1 text-sm text-content-muted">
            {MATCH_FORMAT_CONFIG[team.primaryFormat].shortLabel} · {team.memberCount}{' '}
            {team.memberCount === 1 ? 'member' : 'members'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {team.viewerRole && (
              <span className="score-chip bg-brand-50 text-brand-700">
                {team.viewerRole.toLowerCase()}
              </span>
            )}
            {team.locationText && (
              <span className="break-words text-xs text-content-muted">{team.locationText}</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
