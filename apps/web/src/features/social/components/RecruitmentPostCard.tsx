import type { RecruitmentPostView } from '@footy-finder/shared';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/features/auth/hooks/useAuth.js';
import { TeamAvatar } from '@/features/teams/components/TeamAvatar.js';
import { useRecruitmentAction } from '../hooks/useRecruitment.js';
import { FORMAT_LABELS, LEVEL_LABELS, availabilityLabel, positionLabel } from '../recruitment-labels.js';

const badge = 'rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-black uppercase text-content-muted';

/** A "Teams recruiting" post with Ask to join (or its state). */
export function RecruitmentPostCard({ post, footer, signUpAction }: { post: RecruitmentPostView; footer?: ReactNode; signUpAction?: ReactNode }) {
  const { user } = useAuth();
  const action = useRecruitmentAction();
  const request = post.viewerRequest;
  const open = post.status === 'OPEN' && !post.expired;
  return (
    <article className="grid gap-3 rounded-2xl border border-line bg-surface p-4" data-testid="recruitment-post">
      <div className="flex items-start gap-3">
        <Link to={`/teams/${post.team.id}`}>
          <TeamAvatar team={{ ...post.team, shortName: null }} size="sm" />
        </Link>
        <div className="min-w-0 flex-1">
          <Link to={`/teams/${post.team.id}`} className="block truncate font-black text-content-strong hover:underline">{post.team.name}</Link>
          <p className="text-xs font-bold uppercase text-brand-700">
            {post.playersWanted} {post.playersWanted === 1 ? 'player' : 'players'} wanted · {FORMAT_LABELS[post.format]} · {LEVEL_LABELS[post.level]}
          </p>
        </div>
        {post.status === 'REMOVED' && <span className={badge}>Removed by FootyFinder</span>}
        {post.status === 'CLOSED' && <span className={badge}>Closed</span>}
        {post.status === 'OPEN' && post.expired && <span className={badge}>Expired</span>}
      </div>
      <p className="flex flex-wrap gap-1">
        {post.positions.map((position) => (
          <span key={position} className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-black uppercase text-content-muted">{positionLabel(position)}</span>
        ))}
      </p>
      <p className="text-sm text-content-muted">{post.area} · {availabilityLabel(post.days, post.times)}</p>
      {post.note && <p className="text-sm text-content">{post.note}</p>}
      <p className="text-xs text-content-muted">{post.joinedCount} of {post.playersWanted} joined through this post</p>
      <div className="flex flex-wrap items-center gap-3">
        {!user && open && signUpAction}
        {user && !post.viewerIsMember && open && (request ? (
          <button type="button" className="button-secondary" disabled={action.isPending} onClick={() => action.mutate({ kind: 'cancel-request', requestId: request.id })}>
            Requested · Cancel
          </button>
        ) : (
          <button type="button" className="button" disabled={action.isPending} onClick={() => action.mutate({ kind: 'ask', postId: post.id })}>
            Ask to join
          </button>
        ))}
        {post.viewerIsMember && <span className="text-xs font-black uppercase text-content-muted">Your team</span>}
        {user && !post.viewerIsMember && (
          <Link className="text-[11px] font-black uppercase text-content-muted hover:text-content-strong" to={`/report/RECRUITMENT_POST/${post.id}`}>Report</Link>
        )}
        {footer}
      </div>
      {action.error && <p role="alert" className="text-sm text-danger-700">{action.error.message}</p>}
    </article>
  );
}
