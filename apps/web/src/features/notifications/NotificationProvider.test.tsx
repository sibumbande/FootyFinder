import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider, useNotifications } from './NotificationProvider.js';

function NotificationTrigger() {
  const { notify } = useNotifications();
  return (
    <button
      onClick={() =>
        notify({ variant: 'success', title: 'Ticket confirmed', message: 'You’re in.' })
      }
    >
      Notify
    </button>
  );
}

describe('NotificationProvider', () => {
  afterEach(() => vi.useRealTimers());

  it('starts its exit animation after four seconds and then removes the notification', () => {
    vi.useFakeTimers();
    render(
      <NotificationProvider>
        <NotificationTrigger />
      </NotificationProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Notify' }));

    const notification = screen.getByRole('status');
    expect(notification).toHaveTextContent('Ticket confirmed');
    expect(notification).not.toHaveClass('notification-toast--exiting');

    act(() => vi.advanceTimersByTime(3_999));
    expect(notification).not.toHaveClass('notification-toast--exiting');

    act(() => vi.advanceTimersByTime(1));
    expect(notification).toHaveClass('notification-toast--exiting');

    act(() => vi.advanceTimersByTime(500));
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
