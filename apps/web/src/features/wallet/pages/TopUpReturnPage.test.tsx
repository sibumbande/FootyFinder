import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TopUpReturnPage } from './TopUpReturnPage.js';

const mocks = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock('../hooks/useWallet.js', () => ({ useTopUpStatus: mocks.status }));

afterEach(cleanup);

const reference = `ff_topup_${'a'.repeat(32)}`;
const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <TopUpReturnPage />
    </MemoryRouter>,
  );
const state = (data: Record<string, unknown> | undefined) => ({
  isPending: !data,
  isFetching: false,
  error: null,
  data: data && { reference, amountCents: 16_000, currency: 'ZAR', underReview: false, createdAt: '', ...data },
  refetch: vi.fn(),
});

describe('TopUpReturnPage', () => {
  it('only asks the server about a well-formed reference from the return URL', () => {
    mocks.status.mockReturnValue(state(undefined));
    renderAt(`/wallet/top-up/return?trxref=${reference}&reference=${reference}`);
    expect(mocks.status).toHaveBeenCalledWith(reference);
    renderAt('/wallet/top-up/return?reference=../../admin');
    expect(mocks.status).toHaveBeenLastCalledWith(null);
    expect(screen.getByText('We could not find that top-up.')).toBeInTheDocument();
  });

  it('shows processing until the server confirms, without claiming success', () => {
    mocks.status.mockReturnValue(state({ state: 'PROCESSING' }));
    renderAt(`/wallet/top-up/return?reference=${reference}`);
    expect(screen.getByRole('status')).toHaveTextContent(/Confirming your R\s?160,00 payment with Paystack/);
    expect(screen.queryByText(/was added to your wallet/)).not.toBeInTheDocument();
  });

  it('shows review, success and failure outcomes', () => {
    mocks.status.mockReturnValue(state({ state: 'PROCESSING', underReview: true }));
    renderAt(`/wallet/top-up/return?reference=${reference}`);
    expect(screen.getByRole('status')).toHaveTextContent(/being checked by our finance team/);
    cleanup();
    mocks.status.mockReturnValue(state({ state: 'SUCCEEDED' }));
    renderAt(`/wallet/top-up/return?reference=${reference}`);
    expect(screen.getByRole('status')).toHaveTextContent(/R\s?160,00 was added to your wallet/);
    cleanup();
    mocks.status.mockReturnValue(state({ state: 'FAILED' }));
    renderAt(`/wallet/top-up/return?reference=${reference}`);
    expect(screen.getByRole('status')).toHaveTextContent(/did not go through, so nothing was added/);
  });
});
