import { useEffect, useId, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE = 'button:not([disabled]), [href], textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Batch 5 brief: the app's modal sheet (the confirm, leave and team checklist sheets), styled like the "Choose your
 * team" sheet: a bottom sheet on phones, a centred dialog above. Focus is trapped and returned, Escape and the
 * phone's back button close it, and it never grows past the visible screen (so the keyboard can't hide it). It renders
 * into document.body, so a transformed ancestor (such as the page-enter motion) can't trap it inside the page's box.
 */
export function Sheet({
  title,
  description,
  onClose,
  busy = false,
  children,
  testId,
}: {
  title: string;
  description?: ReactNode;
  onClose: () => void;
  /** While true, Escape, back and the backdrop do nothing (an action is running). */
  busy?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const closing = useRef(false);
  const busyRef = useRef(busy);
  busyRef.current = busy;

  const close = () => {
    if (busyRef.current || closing.current) return;
    closing.current = true;
    if (window.history.state?.ffSheet) window.history.back();
    onClose();
  };

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    window.history.pushState({ ...(window.history.state ?? {}), ffSheet: true }, '');
    const onPop = () => {
      if (closing.current) return;
      if (busyRef.current) {
        window.history.pushState({ ...(window.history.state ?? {}), ffSheet: true }, '');
        return;
      }
      closing.current = true;
      onClose();
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // The sheet owns one history entry for its whole life.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    const items = [...(panel.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])];
    if (!items.length) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-end bg-content-strong/40 p-0 sm:place-items-center sm:p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
        data-testid={testId}
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-line bg-surface p-6 shadow-soft sm:rounded-3xl"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id={titleId} className="text-2xl font-bold text-content-strong">{title}</h2>
            {description && <div className="mt-1 text-sm text-content-muted">{description}</div>}
          </div>
          <button type="button" aria-label="Close" onClick={close} disabled={busy} className="grid size-11 shrink-0 place-items-center rounded-full text-2xl text-content-muted hover:bg-surface-hover">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}
