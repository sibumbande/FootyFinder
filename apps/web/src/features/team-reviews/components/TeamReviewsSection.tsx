import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { teamReviewsClient } from '@/api/client.js';
import { FormError } from '@/components/ui/FormError.js';

/**
 * Gate 8 / TKT-810 (DEC-017): a team's public reviews. The average and count appear only with at
 * least three reviews that count; authors are never shown; only approved comments are public.
 * Members of the team may report a review, which stops it counting until FootyFinder decides.
 */
export function TeamReviewsSection({ teamId, isMember }: { teamId: string; isMember: boolean }) {
  const cache = useQueryClient();
  const key = ['teams', teamId, 'reviews'] as const;
  const summary = useQuery({ queryKey: key, queryFn: async () => (await teamReviewsClient.teamSummary(teamId)).data });
  const report = useMutation({
    mutationFn: (reviewId: string) => teamReviewsClient.report(teamId, reviewId),
    onSuccess: () => void cache.invalidateQueries({ queryKey: key }),
  });
  return (
    <section className="grid gap-3" aria-label="Team reviews" data-testid="team-reviews">
      <h2 className="text-xl font-bold text-content-strong">Reviews</h2>
      <FormError message={summary.error?.message ?? report.error?.message} />
      {summary.data && !summary.data.enoughReviews && <p className="text-content-muted">Not enough reviews.</p>}
      {summary.data?.enoughReviews && (
        <>
          <p className="text-lg font-black text-content-strong">
            {summary.data.averageRating} out of 5 <span className="text-sm font-semibold text-content-muted">({summary.data.reviewCount} reviews)</span>
          </p>
          <ul className="grid gap-2">
            {summary.data.reviews.map((review) => (
              <li key={review.id} className="rounded-xl border border-line p-3 text-sm text-content">
                <span className="font-bold">{review.rating}/5</span>
                {review.text && <span>: {review.text}</span>}
                {isMember && (
                  <button type="button" className="ml-3 text-xs font-bold text-content-muted" disabled={report.isPending} onClick={() => report.mutate(review.id)}>
                    Report
                  </button>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
