import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRandInput, TopUpForm } from './TopUpForm.js';

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), notify: vi.fn() }));
vi.mock('../hooks/useWallet.js', () => ({
  useTopUpOptions: () => ({
    data: { provider: 'demo', minCents: 5_000, maxCents: 500_000, quickPickCents: [20_000, 40_000, 80_000], defaultCents: 40_000, channels: ['card', 'capitec_pay', 'eft'] },
    error: null,
  }),
  useTopUp: () => ({ mutate: mocks.mutate, isPending: false, error: null }),
}));
vi.mock('@/features/notifications/NotificationProvider.js', () => ({
  useNotifications: () => ({ notify: mocks.notify }),
}));

afterEach(cleanup);
beforeEach(() => {
  mocks.mutate.mockReset();
});

const pressed = () =>
  screen.getAllByRole('button', { pressed: true }).map((button) => button.textContent);

describe('TopUpForm', () => {
  it('offers R200, R400 and R800 with match hints, R400 selected by default (CEO batch 4, item 3)', () => {
    render(<TopUpForm />);
    for (const label of ['R200 2 matches + R40', 'R400 5 matches', 'R800 10 matches', 'Other'])
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    expect(pressed()).toEqual(['R4005 matches']);
    expect(screen.getByText(/by card, Capitec Pay or Instant EFT/)).toBeInTheDocument();
  });

  it('asks for confirmation, then sends one amount with a stable idempotency key', () => {
    render(<TopUpForm />);
    fireEvent.click(screen.getByRole('button', { name: /^R200/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(mocks.mutate).not.toHaveBeenCalled();
    // CEO touch-up batch 3, item 6a.
    expect(screen.getByRole('status')).toHaveTextContent(/You.re adding R\s?200,00 to your wallet. Correct\?/);
    expect(screen.queryByTestId('top-up-large-warning')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Yes, add R\s?200,00/ }));
    fireEvent.click(screen.getByRole('button', { name: /Yes, add R\s?200,00/ }));
    expect(mocks.mutate).toHaveBeenCalledTimes(2);
    const [first] = mocks.mutate.mock.calls[0]!;
    const [second] = mocks.mutate.mock.calls[1]!;
    expect(first).toMatchObject({ amountCents: 20_000 });
    expect(second.idempotencyKey).toBe(first.idempotencyKey);
  });

  it.each([
    ['49', 'The minimum top-up is R50.'],
    ['5001', 'The maximum top-up is R5,000.'],
    ['50.50', 'Enter a whole rand amount.'],
    ['abc', 'Enter an amount in rands.'],
  ])('rejects a custom amount of %s', (value, message) => {
    render(<TopUpForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Other' }));
    fireEvent.change(screen.getByLabelText(/Amount in rands/), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('alert')).toHaveTextContent(message);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('accepts a custom whole-rand amount within range', () => {
    render(<TopUpForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Other' }));
    fireEvent.change(screen.getByLabelText(/Amount in rands/), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // CEO touch-up batch 3, item 6a: R500 or more gets an extra warning.
    expect(screen.getByTestId('top-up-large-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Yes, add/ }));
    expect(mocks.mutate.mock.calls[0]![0]).toMatchObject({ amountCents: 500_000 });
  });

  it('pre-selects a suggested shortfall amount as a custom value', () => {
    render(<TopUpForm initialCents={5_000} />);
    expect(pressed()).toEqual(['Other']);
    expect(screen.getByLabelText(/Amount in rands/)).toHaveValue('50');
  });

  it('parses rand input', () => {
    expect(parseRandInput('160')).toBe(16_000);
    expect(parseRandInput('R 1 500')).toBe(150_000);
    expect(parseRandInput('12.5')).toBe(1_250);
    expect(parseRandInput('')).toBeNull();
    expect(parseRandInput('-50')).toBeNull();
  });
});
