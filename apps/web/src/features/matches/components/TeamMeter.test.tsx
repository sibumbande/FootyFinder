import type { Match, TeamMeterView } from '@footy-finder/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamMeter } from './TeamMeter.js';

const mocks = vi.hoisted(() => ({ meter: undefined as unknown, fill: vi.fn(), subs: vi.fn() }));
vi.mock('../hooks/useMatches.js', () => ({
  useTeamMeter: () => ({ isPending: false, error: null, data: mocks.meter }),
  useFillTeamMeter: () => ({ mutate: mocks.fill, isPending: false, error: null }),
  useChangeTeamSubstitutes: () => ({ mutate: mocks.subs, isPending: false, error: null }),
}));

const match = {
  id: 'm1', otherSideMode: 'TEAMS_ONLY', viewerTeamSide: 'HOME', startsAt: '2026-10-30T12:00:00.000Z',
} as unknown as Match;
const meter = (overrides: Partial<TeamMeterView> = {}): TeamMeterView => ({
  matchId: 'm1', side: 'HOME', teamId: 't1', teamName: 'Rondebosch FC', starterCount: 11, substituteCount: 3,
  placeFeeCents: 8_000, feeCents: 112_000, heldCents: 0, capturedCents: 0, remainingCents: 112_000,
  active: true, locked: false, full: false, viewerCanManage: true, teamWalletAvailableCents: 150_000, ...overrides,
});
const renderMeter = () => render(<MemoryRouter><TeamMeter match={match} /></MemoryRouter>);

afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

describe('TeamMeter (Gate 7 / DEC-019)', () => {
  it('shows only the fee breakdown before an opponent is found', () => {
    mocks.meter = meter({ active: false });
    renderMeter();
    expect(screen.getByText('R880 (11 players) + R240 (3 subs) = R1,120')).toBeInTheDocument();
    expect(screen.getByTestId('team-meter-inactive')).toBeInTheDocument();
    expect(screen.queryByTestId('team-meter')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Fill the rest/ })).not.toBeInTheDocument();
  });

  it('shows "R0 / R1,120" once active and lets a captain fill the rest with an idempotency key', () => {
    mocks.meter = meter();
    renderMeter();
    expect(screen.getByTestId('team-meter')).toHaveTextContent('R0 / R1,120');
    fireEvent.click(screen.getByRole('button', { name: 'Fill the rest (R1,120)' }));
    expect(mocks.fill).toHaveBeenCalledWith({ amountCents: undefined, idempotencyKey: expect.any(String) }, expect.anything());
    fireEvent.change(screen.getByLabelText(/Or an amount/), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Fill' }));
    expect(mocks.fill).toHaveBeenLastCalledWith({ amountCents: 30_000, idempotencyKey: expect.any(String) }, expect.anything());
  });

  it('lets a captain change subs, and shows members the meter without actions', () => {
    mocks.meter = meter();
    renderMeter();
    fireEvent.change(screen.getByLabelText('Your subs'), { target: { value: '1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Change subs' }));
    expect(mocks.subs).toHaveBeenCalledWith(1);
    cleanup();
    mocks.meter = meter({ viewerCanManage: false, teamWalletAvailableCents: undefined, heldCents: 50_000 });
    renderMeter();
    expect(screen.getByTestId('team-meter')).toHaveTextContent('R500 / R1,120');
    expect(screen.queryByRole('button', { name: /Fill/ })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Your subs')).not.toBeInTheDocument();
  });

  it('freezes everything from the 30-minute check', () => {
    mocks.meter = meter({ locked: true });
    renderMeter();
    expect(screen.queryByRole('button', { name: /Fill/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change subs' })).not.toBeInTheDocument();
  });
});
