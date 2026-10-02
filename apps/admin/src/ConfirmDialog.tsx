import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/**
 * Batch 5 brief, B2: the admin app's in-app confirmation, replacing window.confirm / alert / prompt. Same behaviour
 * as the player app's ConfirmDialog: a bottom sheet on phones and a centred dialog on larger screens, plain-English
 * consequences, a red button for destructive actions, focus kept inside, Escape or the back button closes it, a
 * loading state while its action runs, and the action's error shown inline (the dialog stays open).
 */
export type ConfirmRequest = {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  /** Runs while the dialog shows its loading state. If it throws, the dialog stays open with the error shown. */
  action?: () => Promise<unknown> | unknown;
};
type Open = ConfirmRequest & { resolve: (confirmed: boolean) => void };

/** Render `confirmDialog` once, then: `if (await confirm({ title, message, confirmLabel })) …`. */
export function useConfirm() {
  const [open, setOpen] = useState<Open | null>(null);
  const confirm = useCallback((request: ConfirmRequest) => new Promise<boolean>((resolve) => setOpen({ ...request, resolve })), []);
  const confirmDialog = open ? (
    <ConfirmDialog
      {...open}
      onDone={(confirmed) => {
        open.resolve(confirmed);
        setOpen(null);
      }}
    />
  ) : null;
  return { confirm, confirmDialog };
}

const FOCUSABLE = 'button:not([disabled]), [href], textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function ConfirmDialog({ title, message, confirmLabel, cancelLabel = 'Cancel', destructive = false, action, onDone }: ConfirmRequest & { onDone: (confirmed: boolean) => void }) {
  const titleId = useId();
  const messageId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const done = useRef(false);
  const pushedHistory = useRef(false);

  const finish = useCallback((confirmed: boolean) => {
    if (done.current) return;
    done.current = true;
    if (pushedHistory.current && window.history.state?.ffConfirmDialog) window.history.back();
    onDone(confirmed);
  }, [onDone]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelButton.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    window.history.pushState({ ...(window.history.state ?? {}), ffConfirmDialog: true }, '');
    pushedHistory.current = true;
    const onPop = () => {
      pushedHistory.current = false;
      finish(false);
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [finish]);

  const submit = async () => {
    if (!action) return finish(true);
    setPending(true);
    setError(undefined);
    try {
      await action();
      finish(true);
    } catch (caught) {
      setError(caught instanceof Error && caught.message ? caught.message : 'Something went wrong. Please try again.');
      setPending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!pending) finish(false);
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

  return (
    <div className="confirm-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget && !pending) finish(false); }}>
      <div
        ref={panel}
        className="confirm-dialog"
        role={destructive ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onKeyDown={onKeyDown}
        data-testid="confirm-dialog"
      >
        <h2 id={titleId}>{title}</h2>
        <div id={messageId} className="confirm-message">{message}</div>
        {error && <p role="alert" className="error">{error}</p>}
        <div className="confirm-actions">
          <button ref={cancelButton} type="button" className="ghost" disabled={pending} onClick={() => finish(false)}>{cancelLabel}</button>
          <button type="button" className={destructive ? 'danger' : undefined} disabled={pending} aria-busy={pending} onClick={() => void submit()}>
            {pending ? 'Working…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
