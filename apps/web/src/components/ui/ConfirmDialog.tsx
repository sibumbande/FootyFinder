import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Button } from './Button.js';

/**
 * Batch 5 brief, B2: the one in-app confirmation, replacing every browser pop-up (window.confirm / alert / prompt).
 * Styled like the "Choose your team" sheet: a bottom sheet on phones and a centred dialog on larger screens, with a
 * title, plain-English consequences, a primary (red when destructive) button and a secondary button. It traps focus,
 * closes with Escape or the phone's back button, shows a loading state while its action runs, and shows the action's
 * error inline instead of closing. On phones it never grows past the visible screen, so the keyboard can't hide it.
 * It renders into document.body, so no transformed or blurred ancestor can pin the sheet above the screen's bottom edge.
 */
export type ConfirmRequest = {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  /** Default "Cancel". Use plain words, e.g. "Keep match". */
  cancelLabel?: string;
  /** No secondary button (an information dialog with one "Done" button). */
  hideCancel?: boolean;
  destructive?: boolean;
  /** A free-text answer, for example a reason. Passed to `action` and returned. */
  reason?: { label: string; required?: boolean; maxLength?: number; placeholder?: string };
  /** Runs while the dialog shows its loading state. If it throws, the dialog stays open with the error shown. */
  action?: (reason: string) => Promise<unknown> | unknown;
};
export type ConfirmResult = { confirmed: boolean; reason: string };
type Open = ConfirmRequest & { resolve: (result: ConfirmResult) => void };

/**
 * Ask for confirmation in the app. Render `confirmDialog` once in the component, then:
 * `if ((await confirm({ title, message, confirmLabel })).confirmed) …`
 */
export function useConfirm() {
  const [open, setOpen] = useState<Open | null>(null);
  const confirm = useCallback(
    (request: ConfirmRequest) => new Promise<ConfirmResult>((resolve) => setOpen({ ...request, resolve })),
    [],
  );
  const confirmDialog = open ? (
    <ConfirmDialog
      {...open}
      onDone={(result) => {
        open.resolve(result);
        setOpen(null);
      }}
    />
  ) : null;
  return { confirm, confirmDialog };
}

const FOCUSABLE = 'button:not([disabled]), [href], textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
const errorMessage = (error: unknown) => (error instanceof Error && error.message ? error.message : 'Something went wrong. Please try again.');

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  hideCancel = false,
  destructive = false,
  reason,
  action,
  onDone,
}: ConfirmRequest & { onDone: (result: ConfirmResult) => void }) {
  const titleId = useId();
  const messageId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const [text, setText] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const done = useRef(false);
  const pushedHistory = useRef(false);

  const finish = useCallback((result: ConfirmResult) => {
    if (done.current) return;
    done.current = true;
    // Undo the history entry added for the back button, unless the back button is what closed us.
    if (pushedHistory.current && window.history.state?.ffConfirmDialog) window.history.back();
    onDone(result);
  }, [onDone]);

  // Focus: the safe choice first (Cancel) when there is one, and back to where it was when the dialog closes.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (reason ? panel.current?.querySelector<HTMLElement>('textarea') : hideCancel ? confirmButton.current : cancelButton.current)?.focus();
    return () => previous?.focus?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The phone's back button closes the dialog instead of leaving the page.
  useEffect(() => {
    window.history.pushState({ ...(window.history.state ?? {}), ffConfirmDialog: true }, '');
    pushedHistory.current = true;
    const onPop = () => {
      pushedHistory.current = false;
      finish({ confirmed: false, reason: '' });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [finish]);

  const submit = async () => {
    const value = text.trim();
    if (reason?.required && !value) {
      setError(`${reason.label} is required.`);
      return;
    }
    if (!action) return finish({ confirmed: true, reason: value });
    setPending(true);
    setError(undefined);
    try {
      await action(value);
      finish({ confirmed: true, reason: value });
    } catch (caught) {
      setError(errorMessage(caught));
      setPending(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      if (!pending) finish({ confirmed: false, reason: '' });
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
        if (event.target === event.currentTarget && !pending) finish({ confirmed: false, reason: '' });
      }}
    >
      <div
        ref={panel}
        role={destructive ? 'alertdialog' : 'dialog'}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={messageId}
        onKeyDown={onKeyDown}
        data-testid="confirm-dialog"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-line bg-surface p-6 shadow-soft sm:rounded-3xl"
      >
        <h2 id={titleId} className="text-2xl font-bold text-content-strong">{title}</h2>
        <div id={messageId} className="mt-2 grid gap-2 text-sm text-content">{message}</div>
        {reason && (
          <label className="mt-4 grid gap-2 text-sm font-semibold text-content">
            {reason.label}
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={reason.maxLength ?? 500}
              placeholder={reason.placeholder}
              rows={3}
              className="w-full min-w-0 rounded-xl border border-line-strong bg-surface p-3 font-normal text-content"
            />
          </label>
        )}
        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-danger-200 bg-danger-50 p-3 text-sm font-semibold text-danger-700">
            {error}
          </p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          {!hideCancel && (
            <Button ref={cancelButton} type="button" variant="secondary" disabled={pending} onClick={() => finish({ confirmed: false, reason: '' })}>
              {cancelLabel}
            </Button>
          )}
          <Button
            ref={confirmButton}
            type="button"
            loading={pending}
            onClick={() => void submit()}
            className={destructive ? '!border-danger-700 !bg-danger-600 hover:!bg-danger-700' : ''}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
