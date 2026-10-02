import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { nameVariants } from '@/utils/short-name.js';

/**
 * CEO touch-up batch 4, item 5: a player's name that always stays inside its box. It shows the full name when it fits,
 * otherwise first name + surname initial ("Sibulele M."), otherwise the first name (cut with "…" if even that is too
 * long). The full name is the hover title, is always read by screen readers, and with `revealOnTap` a tap shows it
 * (use that only where the name is not already inside a link or button).
 */
export function PlayerName({ name, className = '', revealOnTap = false }: { name: string; className?: string; revealOnTap?: boolean }) {
  const variants = useMemo(() => nameVariants(name), [name]);
  // The shortening level belongs to one name: a new name starts again from the full form.
  const [state, setState] = useState({ name, level: 0, resized: 0 });
  const level = state.name === name ? state.level : 0;
  const setLevel = (next: number) => setState((current) => ({ name, level: next, resized: current.resized }));
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const width = useRef(0);

  // Step to a shorter form while the current one overflows; start again from the full name when the box grows.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element && element.scrollWidth > element.clientWidth + 1 && level < variants.length - 1) setLevel(level + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [level, variants, state.resized]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      const next = Math.round(entry?.contentRect.width ?? 0);
      if (next === width.current) return;
      const first = width.current === 0;
      width.current = next;
      // Any width change: start again from the full name and step down until it fits.
      if (!first) setState((current) => ({ name, level: 0, resized: current.resized + 1 }));
    });
    observer.observe(element);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [variants]);

  const shown = variants[level] ?? name;
  const shortened = shown !== variants[0];
  // Only the visible text is measured; the full name for screen readers sits beside it, outside the measured box.
  const text = (
    <span className="relative block min-w-0" title={shortened ? name : undefined}>
      {/* w-0 + min-w-full: fills its box without ever widening it (grids, flex rows). */}
      <span ref={ref} className={`block w-0 min-w-full truncate ${className}`} aria-hidden={shortened || undefined} data-testid="player-name">
        {shown}
      </span>
      {shortened && <span className="sr-only">{name}</span>}
    </span>
  );
  if (!revealOnTap || !shortened) return text;
  return (
    <span className="relative block min-w-0">
      <button type="button" className="block w-full min-w-0 text-left" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
        {text}
      </button>
      {open && (
        <span role="tooltip" className="absolute left-0 top-full z-20 mt-1 max-w-[16rem] rounded-lg border border-line bg-surface px-2 py-1 text-sm font-semibold text-content-strong shadow-soft">
          {name}
        </span>
      )}
    </span>
  );
}
