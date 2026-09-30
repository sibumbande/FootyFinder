import { useFriendAction, useRelationship } from '../hooks/useSocial.js';

const base =
  'inline-flex min-h-8 items-center justify-center gap-1 rounded-md px-2.5 py-1 text-[11px] font-black uppercase tracking-[0.06em] transition disabled:cursor-not-allowed disabled:opacity-60';
const styles = {
  primary: `${base} border-2 border-brand-900 bg-brand-600 text-content-inverse shadow-[2px_2px_0_rgb(var(--theme-accent-gold))] hover:bg-brand-700`,
  secondary: `${base} border-2 border-line-strong bg-surface text-content hover:bg-surface-hover`,
  quiet: `${base} border border-line bg-surface-muted text-content-muted`,
};

/**
 * Gate 9 (CEO "friends everywhere"): the Add friend button, or its state (Requested / Accept /
 * Friends), for any other player. Nothing is shown for yourself, blocked players or players who
 * turned off incoming requests.
 */
export function FriendButton({ userId, className = '' }: { userId: string; className?: string }) {
  const relationship = useRelationship(userId);
  const action = useFriendAction();
  const state = relationship.data?.state;
  if (!state || state === 'SELF' || state === 'UNAVAILABLE') return null;
  const busy = action.isPending;
  if (state === 'FRIENDS')
    return (
      <span className={`${styles.quiet} ${className}`} data-testid="friend-state">
        <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="m3 8 3 3 7-7" /></svg>
        Friends
      </span>
    );
  if (state === 'REQUESTED')
    return (
      <button
        type="button"
        className={`${styles.secondary} ${className}`}
        disabled={busy}
        title="Cancel friend request"
        onClick={() => relationship.data?.requestId && action.mutate({ kind: 'cancel', requestId: relationship.data.requestId })}
      >
        Requested
      </button>
    );
  if (state === 'INCOMING')
    return (
      <span className={`inline-flex gap-1 ${className}`}>
        <button type="button" className={styles.primary} disabled={busy} onClick={() => action.mutate({ kind: 'accept', requestId: relationship.data!.requestId! })}>
          Accept
        </button>
        <button type="button" className={styles.secondary} disabled={busy} aria-label="Decline friend request" onClick={() => action.mutate({ kind: 'decline', requestId: relationship.data!.requestId! })}>
          ✕
        </button>
      </span>
    );
  return (
    <span className={`inline-flex flex-col items-start gap-1 ${className}`}>
    <button type="button" className={styles.primary} disabled={busy} onClick={() => action.mutate({ kind: 'send', userId })}>
      <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true"><path d="M8 3v10M3 8h10" /></svg>
      Add friend
    </button>
    {action.error && <span role="alert" className="max-w-48 text-[11px] font-semibold text-danger-700">{action.error.message}</span>}
    </span>
  );
}
