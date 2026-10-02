/** CEO touch-up batch 3, item 5: shown on free "On FootyFinder" matches (cards, lobby, guest lobby). */
export function FreeMatchBadge({ firstTimersOnly = false, onDark = false }: { firstTimersOnly?: boolean; onDark?: boolean }) {
  const base = 'inline-flex items-center rounded-full px-3 py-1 text-xs font-black';
  return (
    <>
      <span className={`${base} ${onDark ? 'bg-hero-accent text-ink' : 'bg-warning-50 text-warning-700 ring-1 ring-warning-200'}`} data-testid="free-match-badge">
        Free match, on FootyFinder
      </span>
      {firstTimersOnly && (
        <span className={`${base} ${onDark ? 'bg-content-inverse/10 text-content-inverse' : 'bg-surface-muted text-content'}`}>First-time players only</span>
      )}
    </>
  );
}

/** CEO touch-up batch 3.5, item 5: a match FootyFinder created and runs (no player host). */
export function HostedByFootyFinderBadge({ onDark = false }: { onDark?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-black ${onDark ? 'bg-content-inverse/10 text-content-inverse' : 'bg-brand-50 text-brand-700 ring-1 ring-brand-200'}`}
      data-testid="hosted-by-footyfinder"
    >
      Hosted by FootyFinder
    </span>
  );
}

/** CEO touch-up batch 4, item 1: only female players can take part. */
export function GirlsOnlyBadge({ onDark = false }: { onDark?: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-black ${onDark ? 'bg-content-inverse/10 text-content-inverse' : 'bg-danger-50 text-danger-700 ring-1 ring-danger-200'}`}
      data-testid="girls-only-badge"
    >
      Girls only
    </span>
  );
}
