import { MATCH_FORMAT_CONFIG, type TeamSummary } from '@footy-finder/shared';
import { Link } from 'react-router-dom';
import { TeamAvatar } from './TeamAvatar.js';

export function TeamCard({ team }: { team: TeamSummary }) {
  return (
    <Link
      to={`/teams/${team.id}`}
      className="group rounded-2xl border border-line bg-surface p-5 shadow-sm transition hover:-translate-y-1 hover:border-brand-200 hover:shadow-soft"
    >
      <div className="flex items-start gap-4">
        <TeamAvatar team={team} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-lg font-bold text-content-strong">{team.name}</p>
          <p className="mt-1 text-sm text-content-muted">
            {MATCH_FORMAT_CONFIG[team.primaryFormat].shortLabel} · {team.memberCount}{' '}
            {team.memberCount === 1 ? 'member' : 'members'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {team.viewerRole && (
              <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-bold text-brand-700">
                {team.viewerRole.toLowerCase()}
              </span>
            )}
            {team.locationText && (
              <span className="truncate text-xs text-content-muted">{team.locationText}</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}
