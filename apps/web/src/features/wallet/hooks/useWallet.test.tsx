import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const client = vi.hoisted(() => ({ startTopUp: vi.fn(), demoDeposit: vi.fn() }));
vi.mock('@/api/client.js', () => ({ walletClient: client }));

const { checkoutNavigation, isPaystackCheckoutUrl, useTopUp } = await import('./useWallet.js');

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
);

afterEach(() => vi.restoreAllMocks());

describe('useTopUp', () => {
  it('sends the player to Paystack hosted checkout and credits nothing itself', async () => {
    const go = vi.spyOn(checkoutNavigation, 'go').mockImplementation(() => undefined);
    client.startTopUp.mockResolvedValue({
      data: { state: 'PROCESSING', authorizationUrl: 'https://checkout.paystack.com/abc', reference: 'r' },
    });
    const { result } = renderHook(() => useTopUp('paystack'), { wrapper });
    await act(() => result.current.mutateAsync({ amountCents: 16_000, idempotencyKey: 'k' }));
    expect(client.startTopUp).toHaveBeenCalledWith(16_000, 'k');
    expect(go).toHaveBeenCalledWith('https://checkout.paystack.com/abc');
    expect(client.demoDeposit).not.toHaveBeenCalled();
  });

  it('refuses to navigate anywhere but Paystack checkout', async () => {
    const go = vi.spyOn(checkoutNavigation, 'go').mockImplementation(() => undefined);
    client.startTopUp.mockResolvedValue({ data: { state: 'PROCESSING', authorizationUrl: 'https://evil.invalid/pay' } });
    const { result } = renderHook(() => useTopUp('paystack'), { wrapper });
    act(() => result.current.mutate({ amountCents: 16_000, idempotencyKey: 'k' }));
    await waitFor(() => expect(result.current.error?.message).toMatch(/could not be started/));
    expect(go).not.toHaveBeenCalled();
  });

  it('uses the demo operator only when the server says so', async () => {
    client.demoDeposit.mockResolvedValue({ data: { status: 'success', user: { id: 'u' } } });
    const { result } = renderHook(() => useTopUp('demo'), { wrapper });
    await act(() => result.current.mutateAsync({ amountCents: 8_000, idempotencyKey: 'k' }));
    expect(client.demoDeposit).toHaveBeenCalledWith(8_000, 'k');
  });

  it('recognises Paystack checkout URLs', () => {
    expect(isPaystackCheckoutUrl('https://checkout.paystack.com/x')).toBe(true);
    expect(isPaystackCheckoutUrl('https://checkout.paystack.com.evil.invalid/x')).toBe(false);
  });
});
