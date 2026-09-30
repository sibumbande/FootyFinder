import { useState } from 'react';
import { Avatar } from '@/components/ui/Avatar.js';
import { FormError } from '@/components/ui/FormError.js';
import { useRecruitmentAction, useTeamJoinRequests, useTeamRecruitmentPosts } from '../hooks/useRecruitment.js';
import { RecruitmentPostCard } from './RecruitmentPostCard.js';
import { RecruitmentPostForm } from './RecruitmentPostForm.js';

const link = 'text-[11px] font-black uppercase tracking-[0.06em] text-brand-700 hover:underline';

/** Gate 9 / TKT-909: on the team page, join requests to answer and the team's recruitment posts. */
export function TeamRecruitmentPanel({ team }: { team: { id: string; name: string } }) {
  const requests = useTeamJoinRequests(team.id);
  const posts = useTeamRecruitmentPosts(team.id);
  const action = useRecruitmentAction();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  return (
    <section className="grid gap-4 rounded-2xl border border-line p-4" data-testid="team-recruitment">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-black text-content-strong">Recruiting</h3>
          <p className="text-sm text-content-muted">Posts show on the Social recruitment board for 30 days and can be renewed.</p>
        </div>
        {editing !== 'new' && <button type="button" className="button-secondary" onClick={() => setEditing('new')}>New post</button>}
      </div>
      <FormError message={action.error?.message ?? requests.error?.message} />
      {(requests.data?.length ?? 0) > 0 && (
        <div className="grid gap-2" data-testid="join-requests">
          <p className="text-xs font-black uppercase tracking-[0.12em] text-content-muted">Requests to join ({requests.data!.length})</p>
          {requests.data!.map((request) => (
            <div key={request.id} className="flex flex-wrap items-center gap-3 rounded-xl bg-surface-muted p-3">
              <Avatar user={request.player} size="sm" />
              <span className="min-w-0 flex-1 truncate text-sm font-bold text-content-strong">{request.player.displayName}</span>
              <button type="button" className="button" disabled={action.isPending} onClick={() => action.mutate({ kind: 'accept', teamId: team.id, requestId: request.id })}>Accept</button>
              <button type="button" className="button-secondary" disabled={action.isPending} onClick={() => action.mutate({ kind: 'decline', teamId: team.id, requestId: request.id })}>Decline</button>
            </div>
          ))}
        </div>
      )}
      {editing === 'new' && <RecruitmentPostForm teams={[team]} onDone={() => setEditing(null)} />}
      <div className="grid gap-3 md:grid-cols-2">
        {posts.data?.map((post) =>
          editing === post.id ? (
            <RecruitmentPostForm key={post.id} teams={[team]} post={post} onDone={() => setEditing(null)} />
          ) : (
            <RecruitmentPostCard
              key={post.id}
              post={post}
              footer={post.status !== 'REMOVED' && (
                <span className="flex gap-3">
                  <button type="button" className={link} onClick={() => setEditing(post.id)}>Edit</button>
                  <button type="button" className={link} onClick={() => action.mutate({ kind: 'renew', teamId: team.id, postId: post.id })}>Renew 30 days</button>
                  {post.status === 'OPEN' && <button type="button" className={link} onClick={() => action.mutate({ kind: 'close', teamId: team.id, postId: post.id })}>Close</button>}
                </span>
              )}
            />
          ),
        )}
      </div>
    </section>
  );
}
