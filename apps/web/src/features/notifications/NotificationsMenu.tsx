import { SocketEvents, type AppNotification } from '@footy-finder/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { notificationsClient } from '@/api/client.js';
import { formatDate } from '@/utils/format-date.js';
import { useNotifications } from './NotificationProvider.js';
import { ensureSocketConnected } from '@/socket/socket.js';
import { currentUserKey } from '@/features/auth/hooks/useAuth.js';
const key = ['notifications'] as const;
export function NotificationsMenu() {
  const [open, setOpen] = useState(false);
  const initialized = useRef(false);
  const seen = useRef(new Set<string>());
  const { notify } = useNotifications();
  const cache = useQueryClient();
  const notifications = useQuery({
    queryKey: key,
    queryFn: async () => (await notificationsClient.list()).data,
    refetchInterval: 15_000,
  });
  const markAll = useMutation({
    mutationFn: () => notificationsClient.markAllRead(),
    onSuccess: () => void cache.invalidateQueries({ queryKey: key }),
  });
  useEffect(() => {
    if (!notifications.data) return;
    if (!initialized.current) {
      notifications.data.forEach((item) => seen.current.add(item.id));
      initialized.current = true;
      return;
    }
    notifications.data
      .filter((item) => !seen.current.has(item.id))
      .forEach((item) => {
        seen.current.add(item.id);
        notify({
          variant: item.type.includes('CANCEL') ? 'warning' : 'info',
          title: item.title,
          message: item.message,
        });
      });
  }, [notifications.data, notify]);
  useEffect(() => {
    const socket = ensureSocketConnected();
    const receive = (item: AppNotification) => {
      if (seen.current.has(item.id)) return;
      seen.current.add(item.id);
      cache.setQueryData<AppNotification[]>(key, (current) => [item, ...(current ?? [])]);
      notify({
        variant: item.type.includes('CANCEL') ? 'warning' : 'info',
        title: item.title,
        message: item.message,
      });
    };
    const refreshWallet = () => void cache.invalidateQueries({ queryKey: currentUserKey });
    const sessionRevoked = () => {
      cache.clear();
      cache.setQueryData(currentUserKey, null);
    };
    socket.on(SocketEvents.notificationCreated, receive);
    socket.on(SocketEvents.walletUpdated, refreshWallet);
    socket.on(SocketEvents.sessionRevoked, sessionRevoked);
    return () => {
      socket.off(SocketEvents.notificationCreated, receive);
      socket.off(SocketEvents.walletUpdated, refreshWallet);
      socket.off(SocketEvents.sessionRevoked, sessionRevoked);
    };
  }, [cache, notify]);
  const unread = notifications.data?.filter((item) => !item.readAt).length ?? 0;
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((value) => !value)}
        className="relative grid size-11 place-items-center rounded-md text-content-muted hover:bg-surface-hover"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`}
      >
        <svg
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
        </svg>
        {unread > 0 && (
          <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-danger-600 px-1 text-[9px] font-bold text-content-inverse">
            {unread}
          </span>
        )}
      </button>
      {open && (
        <div className="anime-panel absolute right-0 mt-2 w-[min(22rem,calc(100vw-2rem))] p-2">
          <div className="flex items-center justify-between px-3 py-2">
            <strong className="font-black uppercase tracking-wide text-content-strong">
              Notifications
            </strong>
            {unread > 0 && (
              <button onClick={() => markAll.mutate()} className="text-xs font-bold text-brand-700">
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-96 overflow-y-auto">
            {notifications.data?.map((item) => (
              <Link
                key={item.id}
                to={item.targetPath ?? '#'}
                onClick={() => {
                  if (!item.readAt)
                    void notificationsClient
                      .markRead(item.id)
                      .then(() => cache.invalidateQueries({ queryKey: key }));
                  setOpen(false);
                }}
                className={`block rounded-xl p-3 hover:bg-surface-hover ${item.readAt ? '' : 'bg-brand-50'}`}
              >
                <p className="text-sm font-bold text-content-strong">{item.title}</p>
                <p className="mt-1 text-xs text-content-muted">{item.message}</p>
                <p className="mt-1 text-[10px] text-content-subtle">{formatDate(item.createdAt)}</p>
              </Link>
            ))}
            {notifications.data?.length === 0 && (
              <p className="p-5 text-center text-sm text-content-muted">No notifications yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
