import { createContext, type PropsWithChildren, useCallback, useContext, useEffect, useRef, useState } from 'react';

export type NotificationVariant = 'info' | 'success' | 'warning' | 'error';

export interface NotificationInput {
  title: string;
  message?: string;
  variant?: NotificationVariant;
  durationMs?: number;
}

type NotificationItem = Required<Pick<NotificationInput, 'title' | 'variant' | 'durationMs'>> &
  Pick<NotificationInput, 'message'> & { id: string; exiting: boolean };

interface NotificationContextValue {
  notify: (notification: NotificationInput) => string;
  dismiss: (id: string) => void;
}

const DEFAULT_DURATION_MS = 4_000;
const EXIT_DURATION_MS = 500;
const NotificationContext = createContext<NotificationContextValue | null>(null);

const variantClasses: Record<NotificationVariant, string> = {
  info: 'notification-toast--info border-info-200 bg-info-50 text-info-700',
  success: 'notification-toast--success border-brand-200 bg-brand-50 text-brand-700',
  warning: 'notification-toast--warning border-warning-200 bg-warning-50 text-warning-700',
  error: 'notification-toast--error border-danger-200 bg-danger-50 text-danger-700',
};

export function NotificationProvider({ children }: PropsWithChildren) {
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const autoDismissTimers = useRef(new Map<string, number>());
  const removalTimers = useRef(new Map<string, number>());

  const dismiss = useCallback((id: string) => {
    const autoDismissTimer = autoDismissTimers.current.get(id);
    if (autoDismissTimer !== undefined) window.clearTimeout(autoDismissTimer);
    autoDismissTimers.current.delete(id);
    if (removalTimers.current.has(id)) return;

    setNotifications((items) => items.map((item) => item.id === id ? { ...item, exiting: true } : item));
    const removalTimer = window.setTimeout(() => {
      setNotifications((items) => items.filter((item) => item.id !== id));
      removalTimers.current.delete(id);
    }, EXIT_DURATION_MS);
    removalTimers.current.set(id, removalTimer);
  }, []);

  const notify = useCallback((input: NotificationInput) => {
    const id = globalThis.crypto?.randomUUID?.() ?? `notification-${Date.now()}-${Math.random()}`;
    const durationMs = input.durationMs ?? DEFAULT_DURATION_MS;
    const notification: NotificationItem = {
      id,
      title: input.title,
      message: input.message,
      variant: input.variant ?? 'info',
      durationMs,
      exiting: false,
    };

    setNotifications((items) => [...items.slice(-4), notification]);
    autoDismissTimers.current.set(id, window.setTimeout(() => dismiss(id), durationMs));
    return id;
  }, [dismiss]);

  useEffect(() => () => {
    autoDismissTimers.current.forEach((timer) => window.clearTimeout(timer));
    removalTimers.current.forEach((timer) => window.clearTimeout(timer));
  }, []);

  return <NotificationContext.Provider value={{ notify, dismiss }}>
    {children}
    <div aria-live="polite" aria-label="Notifications" className="pointer-events-none fixed inset-x-4 top-20 z-50 flex flex-col items-end gap-3 sm:left-auto sm:w-[24rem]">
      {notifications.map((notification) => <article
        key={notification.id}
        role={notification.variant === 'error' ? 'alert' : 'status'}
        className={`notification-toast pointer-events-auto relative flex w-full items-start gap-3 overflow-visible rounded-2xl border p-4 shadow-soft ${variantClasses[notification.variant]} ${notification.exiting ? 'notification-toast--exiting' : ''}`}
      >
        <NotificationIcon variant={notification.variant} />
        <div className="min-w-0 flex-1">
          <p className="font-bold">{notification.title}</p>
          {notification.message && <p className="mt-1 text-sm leading-5 opacity-90">{notification.message}</p>}
        </div>
        <button type="button" aria-label="Dismiss notification" onClick={() => dismiss(notification.id)} className="grid size-8 shrink-0 place-items-center rounded-lg transition hover:bg-surface/60 focus:outline-none focus:ring-2 focus:ring-current">
          <svg viewBox="0 0 20 20" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
        </button>
      </article>)}
    </div>
  </NotificationContext.Provider>;
}

export function useNotifications() {
  const context = useContext(NotificationContext);
  if (!context) throw new Error('useNotifications must be used within NotificationProvider.');
  return context;
}

function NotificationIcon({ variant }: { variant: NotificationVariant }) {
  if (variant === 'success') return <span className="grid size-9 shrink-0 place-items-center rounded-full bg-brand-100"><svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="m4 10 4 4 8-8" /></svg></span>;
  if (variant === 'error') return <span className="grid size-9 shrink-0 place-items-center rounded-full bg-danger-200/60"><svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M10 6v5M10 14h.01" /><circle cx="10" cy="10" r="8" /></svg></span>;
  if (variant === 'warning') return <span className="grid size-9 shrink-0 place-items-center rounded-full bg-warning-200/60"><svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="m10 3 8 14H2L10 3ZM10 8v4M10 15h.01" /></svg></span>;
  return <span className="grid size-9 shrink-0 place-items-center rounded-full bg-info-200/60"><svg viewBox="0 0 20 20" className="size-5" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><circle cx="10" cy="10" r="8" /><path d="M10 9v5M10 6h.01" /></svg></span>;
}
