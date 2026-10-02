import { KIT_COLOURS, nearestKitColour, readableTextOn, type KitColourHex } from '@footy-finder/shared';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/**
 * Batch 5 brief, B1 (CEO D17): pick a kit colour by name from the colours kits actually come in. No hex, RGB or
 * eyedropper, and no text input anywhere, so a phone keyboard never opens. On phones it opens as a bottom sheet no
 * taller than half the screen, with a mini preview pinned inside it that updates instantly; on larger screens it is
 * a popover under the button. One component for the primary and the secondary colour.
 */
export function KitColourPicker({
  label,
  value,
  onChange,
  preview,
}: {
  label: string;
  value: string;
  onChange: (hex: KitColourHex) => void;
  /** A small live preview, shown inside the phone sheet (the page's own preview may be under it). */
  preview?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const current = nearestKitColour(value);
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const swatches = useRef<Array<HTMLButtonElement | null>>([]);
  const titleId = useId();
  const selectedIndex = KIT_COLOURS.findIndex(({ hex }) => hex === current.hex);

  const close = (returnFocus = true) => {
    setOpen(false);
    if (returnFocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    swatches.current[selectedIndex]?.focus();
    const outside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
    // Focus the selected swatch only when the picker opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    const step = { ArrowRight: 1, ArrowDown: 6, ArrowLeft: -1, ArrowUp: -6 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = Math.min(KIT_COLOURS.length - 1, Math.max(0, selectedIndex + step));
    onChange(KIT_COLOURS[next]!.hex);
    swatches.current[next]?.focus();
  };

  return (
    <div ref={container} className="relative grid gap-2 text-sm font-semibold text-content">
      <span id={`${titleId}-label`}>{label}</span>
      <button
        ref={trigger}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`${label}: ${current.name}. Change`}
        onClick={() => setOpen((value) => !value)}
        className="flex min-h-12 w-full min-w-0 items-center gap-3 rounded-xl border border-line-strong bg-surface px-3 text-left font-bold text-content-strong"
      >
        <span className="size-7 shrink-0 rounded-full border border-line-strong" style={{ background: current.hex }} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate">{current.name}</span>
        <span className="shrink-0 text-xs font-black uppercase text-brand-700" aria-hidden="true">Change</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-labelledby={titleId}
          onKeyDown={onKeyDown}
          data-testid="kit-colour-sheet"
          className="fixed inset-x-0 bottom-0 z-50 max-h-[50vh] overflow-y-auto rounded-t-3xl border border-line bg-surface p-4 shadow-soft sm:absolute sm:inset-x-auto sm:bottom-auto sm:left-0 sm:top-full sm:mt-2 sm:max-h-none sm:w-[23rem] sm:rounded-2xl"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 id={titleId} className="font-black text-content-strong">{label}</h3>
            <button type="button" onClick={() => close()} className="min-h-11 rounded-full px-4 text-sm font-black uppercase text-brand-700 hover:bg-surface-hover">
              Done
            </button>
          </div>
          {preview && <div className="mt-2 sm:hidden" data-testid="kit-colour-mini-preview">{preview}</div>}
          <div role="radiogroup" aria-labelledby={titleId} className="mt-3 grid grid-cols-6 gap-x-1 gap-y-2">
            {KIT_COLOURS.map((colour, index) => {
              const selected = colour.hex === current.hex;
              return (
                <button
                  key={colour.hex}
                  ref={(element) => {
                    swatches.current[index] = element;
                  }}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={colour.name}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => onChange(colour.hex)}
                  className="grid min-w-0 justify-items-center gap-1 rounded-xl p-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand-600"
                >
                  <span
                    className={`grid size-11 place-items-center rounded-full border ${selected ? 'border-2 border-content-strong ring-2 ring-brand-500 ring-offset-2 ring-offset-surface' : 'border-line-strong'}`}
                    style={{ background: colour.hex }}
                    aria-hidden="true"
                  >
                    {selected && (
                      <svg viewBox="0 0 20 20" className="size-5" fill="none" stroke={readableTextOn(colour.hex)} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M4 10.5l4 4 8-9" />
                      </svg>
                    )}
                  </span>
                  <span className="w-full text-center text-[11px] font-semibold leading-tight text-content" aria-hidden="true">{colour.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
