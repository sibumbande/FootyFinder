import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

export const menuItemClass =
  'flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm font-semibold text-content hover:bg-surface-hover focus:bg-surface-hover focus:outline-none disabled:opacity-60';

/**
 * CEO touch-up batch 3, item 9: a small "⋯" menu for secondary actions on a card (Invite to team, Remove,
 * Report). Same behaviour as the account menu: closes on an outside tap, on Escape and after an item is chosen.
 * Children receive `close` so an item can shut the menu.
 */
export function ActionMenu({ label, children }: { label: string; children: (close: () => void) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);
  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((value) => !value)}
        className="grid size-11 place-items-center rounded-xl border border-line bg-surface text-xl font-black leading-none text-content-strong hover:bg-surface-hover"
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {open && (
        <div id={menuId} role="menu" className="anime-panel absolute right-0 z-30 mt-2 w-60 max-w-[calc(100vw-2rem)] origin-top-right p-2">
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
