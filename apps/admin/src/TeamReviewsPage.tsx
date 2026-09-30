import type { AdminTeamReview, ModerateTeamReviewInput } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { teamReviewsClient } from './api.js';
import { AdminActionError } from './FreshMfa.js';

const rootKey = ['admin', 'team-reviews'] as const;

/**
 * Gate 8 / TKT-810 (DEC-017): team review moderation. Comments are public only once approved;
 * reported reviews stop counting until restored or hidden. Admins see the author (never public).
 */
export function TeamReviewsPage() {
  const [queue, setQueue] = useState<'pending' | 'reported' | 'all'>('pending');
  const reviews = useQuery({ queryKey: [...rootKey, queue], queryFn: async () => (await teamReviewsClient.adminList(queue)).data });
  return (
    <section>
      <p className="eyebrow">Community</p>
      <h2>Team reviews</h2>
      <p className="muted">
        Ratings count straight away. Comments stay hidden until approved. Reported reviews do not count until you restore
        or hide them. Authors are shown here for moderation only; the public never sees them.
      </p>
      <div className="row">
        {([['pending', 'Comments to approve'], ['reported', 'Reported'], ['all', 'All']] as const).map(([key, label]) => (
          <button key={key} className={queue === key ? '' : 'ghost'} onClick={() => setQueue(key)}>{label}</button>
        ))}
      </div>
      {reviews.error && <p className="error">{reviews.error.message}</p>}
      {reviews.data?.length === 0 && <p className="muted">Nothing here.</p>}
      {reviews.data?.map((review) => <ReviewCard key={review.id} review={review} />)}
    </section>
  );
}

function ReviewCard({ review }: { review: AdminTeamReview }) {
  const cache = useQueryClient();
  const [note, setNote] = useState('');
  const moderate = useMutation({
    mutationFn: (action: ModerateTeamReviewInput['action']) => teamReviewsClient.moderate(review.id, { action, ...(note.trim() ? { note } : {}) }),
    onSuccess: () => {
      setNote('');
      void cache.invalidateQueries({ queryKey: rootKey });
    },
  });
  return (
    <article className="venue-card">
      <strong>{review.team.name}: {review.rating}/5</strong>
      <p className="muted">
        {review.match.name} · by {review.author.displayName} · {new Date(review.createdAt).toLocaleString()} · {review.status}
        {review.reportedAt ? ' · REPORTED' : ''}
      </p>
      {review.text && <p>“{review.text}” <span className="muted">({review.textStatus?.toLowerCase()})</span></p>}
      {review.moderationNote && <p className="muted">Last note: {review.moderationNote}</p>}
      <div className="row">
        <input aria-label="Moderation note" placeholder="Note (optional)" value={note} onChange={(event) => setNote(event.target.value)} />
        {review.text && review.textStatus !== 'APPROVED' && <button type="button" disabled={moderate.isPending} onClick={() => moderate.mutate('APPROVE_TEXT')}>Approve comment</button>}
        {review.text && review.textStatus !== 'REJECTED' && <button type="button" className="ghost" disabled={moderate.isPending} onClick={() => moderate.mutate('REJECT_TEXT')}>Reject comment</button>}
        {review.status === 'VISIBLE' && <button type="button" className="danger" disabled={moderate.isPending} onClick={() => moderate.mutate('HIDE')}>Hide review</button>}
        {(review.status === 'HIDDEN' || review.reportedAt) && <button type="button" className="ghost" disabled={moderate.isPending} onClick={() => moderate.mutate('RESTORE')}>Restore</button>}
      </div>
      <AdminActionError error={moderate.error} />
    </article>
  );
}
