import type { PublicUser } from '@footy-finder/shared';
import { Link } from 'react-router-dom';
import { Avatar } from '@/components/ui/Avatar.js';
export function UserCard({ user }: { user: PublicUser }) {
  return (
    <article className="flex min-w-0 flex-col gap-4 rounded-2xl border border-line bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-brand-200 hover:shadow-soft">
      <div className="flex min-w-0 items-center gap-4">
        <Avatar user={user} size="lg" />
        <div className="min-w-0">
          <h3 className="truncate font-bold text-content-strong">{user.displayName}</h3>
          <p className="truncate text-sm font-medium text-brand-700">@{user.username}</p>
          <p className="mt-1 truncate text-xs text-content-muted">
            {user.homeArea || 'Area not set'} ·{' '}
            {user.preferredPositions.map((item) => item.toLowerCase()).join(', ') ||
              'Positions not set'}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <Link className="button min-h-10 text-sm" to={`/players/${user.id}`}>
          View profile
        </Link>
        <Link
          className="inline-flex min-h-10 items-center justify-center rounded-xl border border-line-strong bg-surface text-sm font-semibold text-content hover:bg-surface-hover"
          to={`/messages/new/${user.id}`}
        >
          Message
        </Link>
        <Link className="inline-flex min-h-10 items-center justify-center rounded-xl text-sm font-semibold text-content-muted hover:bg-danger-50 hover:text-danger-700" to={`/report/USER/${user.id}`}>
          Report
        </Link>
      </div>
    </article>
  );
}
