import type { Match } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { teamReviewsClient } from '@/api/client.js';
import { FormError } from '@/components/ui/FormError.js';

const reviewKey = (matchId: string) => ['matches', matchId, 'review'] as const;
const at = (iso: string) =>
  new Intl.DateTimeFormat('en-ZA', { timeZone: 'Africa/Johannesburg', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

/** 1-5 rating as five large radio buttons, easy to tap on a phone. */
export function RatingInput({ value, onChange }: { value: number; onChange: (rating: number) => void }) {
  return (
    <fieldset className="flex gap-2">
      <legend className="mb-2 text-sm font-bold text-content-strong">Rating</legend>
      {[1, 2, 3, 4, 5].map((rating) => (
        <label key={rating} className={`flex size-11 cursor-pointer items-center justify-center rounded-xl border-2 text-lg font-black ${rating <= value ? 'border-warning-300 bg-warning-50 text-warning-700' : 'border-line text-content-muted'}`}>
          <input className="sr-only" type="radio" name="rating" value={rating} checked={value === rating} onChange={() => onChange(rating)} aria-label={`${rating} out of 5`} />
          {rating}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Gate 8 / TKT-810 (DEC-017, D24): after the final result, a player who played can rate the
 * opposing team once (1-5 and an optional comment). Comments appear publicly only after approval;
 * the author's name is never shown. A review can be left for 14 days after the final result; it is
 * editable for 7 days after the final result and deletable any time.
 */
export function MatchReviewPanel({ match }: { match: Match }) {
  const cache = useQueryClient();
  const final = Boolean(match.result && match.result.finalSource && match.result.finalSource !== 'LEGACY' && match.result.outcomeType !== 'ABANDONED');
  const context = useQuery({
    queryKey: reviewKey(match.id),
    queryFn: async () => (await teamReviewsClient.context(match.id)).data,
    enabled: final,
  });
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(0);
  const [text, setText] = useState('');
  const refresh = () => void cache.invalidateQueries({ queryKey: reviewKey(match.id) });
  const save = useMutation({
    mutationFn: () => (context.data?.review ? teamReviewsClient.update : teamReviewsClient.create)(match.id, { rating, text }),
    onSuccess: () => {
      setEditing(false);
      refresh();
    },
  });
  const remove = useMutation({ mutationFn: () => teamReviewsClient.remove(match.id), onSuccess: refresh });
  const data = context.data;
  if (!final || !data || !data.team || (!data.eligible && !data.review)) return null;
  const review = data.review;
  const canEdit = Boolean(review && data.editableUntil && Date.now() < new Date(data.editableUntil).getTime());
  const submit = (event: FormEvent) => {
    event.preventDefault();
    save.mutate();
  };

  if (review && !editing)
    return (
      <section className="grid gap-2 rounded-2xl border border-line bg-surface p-4" aria-label="Your team review" data-testid="my-team-review">
        <h2 className="font-black text-content-strong">Your review of {data.team.name}</h2>
        <p className="text-sm text-content">
          {review.rating} out of 5{review.text ? `: “${review.text}”` : ''}
          {review.textStatus === 'PENDING' && <span className="text-content-muted"> (comment waiting for approval)</span>}
          {review.textStatus === 'REJECTED' && <span className="text-content-muted"> (comment not approved)</span>}
        </p>
        <div className="flex flex-wrap gap-3 text-sm font-bold">
          {canEdit && (
            <button type="button" className="text-brand-700" onClick={() => { setRating(review.rating); setText(review.text ?? ''); setEditing(true); }}>
              Edit (until {at(data.editableUntil!)})
            </button>
          )}
          <button type="button" className="text-danger-700" disabled={remove.isPending} onClick={() => { if (window.confirm('Delete your review?')) remove.mutate(); }}>
            Delete
          </button>
        </div>
        <FormError message={remove.error?.message} />
      </section>
    );

  return (
    <form className="grid gap-3 rounded-2xl border border-line bg-surface p-4" onSubmit={submit} aria-label="Rate the opposing team">
      <h2 className="font-black text-content-strong">Rate {data.team.name}</h2>
      <p className="text-sm text-content-muted">
        Your name is not shown with your review. A comment appears only after FootyFinder approves it.
        {!review && data.reviewableUntil && <> You can leave a review until {at(data.reviewableUntil)}.</>}
      </p>
      <RatingInput value={rating} onChange={setRating} />
      <label className="grid gap-1 text-sm font-bold text-content-strong">
        Comment (optional)
        <textarea value={text} onChange={(event) => setText(event.target.value)} maxLength={1000} className="min-h-20 rounded-xl border-2 border-line bg-surface p-3 text-sm font-normal text-content" />
      </label>
      <div className="flex gap-2">
        <button className="button" disabled={rating < 1 || save.isPending}>{review ? 'Save changes' : 'Send review'}</button>
        {editing && <button type="button" className="button-secondary" onClick={() => setEditing(false)}>Cancel</button>}
      </div>
      <FormError message={save.error?.message} />
    </form>
  );
}
