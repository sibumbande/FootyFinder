import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UndoTopUps } from './UndoTopUps.js';

const mocks = vi.hoisted(() => ({ undoable: vi.fn(), undo: vi.fn() }));
vi.mock('@/api/client.js', () => ({ walletClient: { undoableTopUps: mocks.undoable, undoTopUp: mocks.undo } }));
vi.mock('@/features/notifications/NotificationProvider.js', () => ({ useNotifications: () => ({ notify: vi.fn() }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const renderPanel = () => render(<QueryClientProvider client={new QueryClient()}><UndoTopUps /></QueryClientProvider>);
const topUp = { paymentId: 'p1', amountCents: 80_000, creditedAt: new Date().toISOString(), undoUntil: new Date(Date.now() + 86_400_000).toISOString(), refundableCents: 72_000, blockedReason: null };

// CEO touch-up batch 3, item 6b.
describe('UndoTopUps', () => {
  it('offers the unspent part, asks to confirm, and sends one idempotency key for a double tap', async () => {
    mocks.undoable.mockResolvedValue({ data: [topUp] });
    mocks.undo.mockResolvedValue({ data: { refundId: 'r1', amountCents: 72_000, status: 'PROCESSING' } });
    renderPanel();
    expect(await screen.findByText(/up to R\s?720,00/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Undo top-up' }));
    expect(mocks.undo).not.toHaveBeenCalled();
    expect(screen.getByRole('status')).toHaveTextContent(/Send R\s?720,00 back to your card\?/);
    fireEvent.click(screen.getByRole('button', { name: /Yes, send/ }));
    await waitFor(() => expect(mocks.undo).toHaveBeenCalledWith('p1', 72_000, expect.any(String)));
  });

  it('refuses more than the unspent part and shows why a top-up cannot be undone', async () => {
    mocks.undoable.mockResolvedValue({ data: [topUp, { ...topUp, paymentId: 'p2', blockedReason: 'ALREADY_UNDONE', refundableCents: 0 }] });
    renderPanel();
    fireEvent.change(await screen.findByRole('textbox'), { target: { value: '800' } });
    fireEvent.click(screen.getByRole('button', { name: 'Undo top-up' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/up to R\s?720,00/);
    expect(screen.getByText('Already undone')).toBeInTheDocument();
    expect(mocks.undo).not.toHaveBeenCalled();
  });
});
