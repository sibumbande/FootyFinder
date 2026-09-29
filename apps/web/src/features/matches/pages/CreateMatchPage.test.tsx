import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CreateMatchPage } from './CreateMatchPage.js';

const mocks = vi.hoisted(() => ({ mutate: vi.fn(), teams: [] as unknown[], wallet: undefined as unknown }));

vi.mock('@/features/teams/hooks/useTeams.js', () => ({ useMyTeams: () => ({ data: mocks.teams }) }));
vi.mock('@/features/teams/hooks/useTeamWallet.js', () => ({ useTeamWalletSummary: () => ({ data: mocks.wallet }) }));

vi.mock('../hooks/useMatches.js', () => ({
  useCreateMatch: () => ({
    mutate: mocks.mutate,
    isPending: false,
    error: null,
  }),
}));

vi.mock('@/features/venues/hooks/useVenues.js', () => ({
  useVenue: () => ({
    data: {
      venue: {
        name: 'Approved Arena',
        addressLine1: '1 Main Road',
        fields: [{ id: 'f03d12a0-9855-4a03-8948-739bad35e733', name: 'Field One' }],
      },
    },
  }),
}));

afterEach(() => {
  cleanup();
  mocks.mutate.mockReset();
  mocks.teams = [];
  mocks.wallet = undefined;
});

describe('CreateMatchPage', () => {
  it('persists match-specific capacity, rolling substitutions, and rules', () => {
    render(
      <MemoryRouter
        initialEntries={[
          '/matches/new?venue=approved-arena&field=f03d12a0-9855-4a03-8948-739bad35e733&format=FIVE_A_SIDE&startsAt=2099-08-23T18%3A00%3A00.000Z&price=300000',
        ]}
      >
        <CreateMatchPage />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByRole('spinbutton', { name: /Substitutes per team/ }), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: /Rolling substitutions/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: /Goalkeepers swap after every goal/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    fireEvent.change(screen.getByLabelText('Match name'), {
      target: { value: 'Friday football' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByTestId('fixed-fee-notice')).toHaveTextContent(/Every player pays R\s?80[,.]00 to join, including subs\./);
    expect(screen.queryByLabelText(/Entry fee/)).not.toBeInTheDocument();
    expect(screen.getByTestId('fixed-fee-notice')).toHaveTextContent(/no deposit or guarantee/);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Create match' }));

    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        managedFieldId: 'f03d12a0-9855-4a03-8948-739bad35e733',
        substituteCapacityPerTeam: 10,
        rollingSubstitutes: true,
        rules: ['GOALKEEPERS_SWAP_AFTER_EVERY_GOAL'],
      }),
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
    // DEC-018: the host never sends a fee; the server applies the fixed R80.
    expect(mocks.mutate.mock.calls[0]![0]).not.toHaveProperty('feeCents');
  });

  it('warns the host about the T-30 go/no-go with the computed time before they confirm', () => {
    // Kickoff 30 Oct 2026 14:00 SAST (12:00Z) -> go/no-go at 13:30.
    render(
      <MemoryRouter
        initialEntries={[
          '/matches/new?venue=approved-arena&field=f03d12a0-9855-4a03-8948-739bad35e733&format=FIVE_A_SIDE&startsAt=2026-10-30T12%3A00%3A00.000Z',
        ]}
      >
        <CreateMatchPage />
      </MemoryRouter>,
    );
    const expected =
      "Heads up: if every position isn't filled 30 minutes before kickoff (13:30), this match is cancelled automatically and every player gets their R80 refunded to their wallet.";
    for (let step = 0; step < 3; step += 1) fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.change(screen.getByLabelText('Match name'), { target: { value: 'Friday football' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByTestId('go-no-go-notice')).toHaveTextContent(expected);
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    // Review step: the notice sits right above the confirm button.
    expect(screen.getByTestId('go-no-go-notice')).toHaveTextContent(expected);
    expect(screen.getByRole('button', { name: 'Create match' })).toBeInTheDocument();
  });
});

describe('CreateMatchPage: team matches (Gate 7 / DEC-019)', () => {
  const slot = '/matches/new?venue=approved-arena&field=f03d12a0-9855-4a03-8948-739bad35e733&format=ELEVEN_A_SIDE&startsAt=2026-10-30T12%3A00%3A00.000Z';
  const team = { id: 'team-1', name: 'Rondebosch FC', viewerRole: 'CAPTAIN', archivedAt: null };
  const wallet = (availableCents: number) => ({ availableCents, balanceCents: availableCents, heldCents: 0 });
  const continueTimes = (count: number) => {
    for (let index = 0; index < count; index += 1) fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
  };

  it('offers "Play as" only to owners/captains, then asks who can take the other side and shows the fee', () => {
    mocks.teams = [team, { id: 'team-2', name: 'Member Only FC', viewerRole: 'MEMBER', archivedAt: null }];
    mocks.wallet = wallet(150_000);
    render(<MemoryRouter initialEntries={[slot]}><CreateMatchPage /></MemoryRouter>);
    expect(screen.getByRole('button', { name: /Myself \(quick match\)/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Member Only FC/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /My team Rondebosch FC/ }));
    continueTimes(1);
    fireEvent.change(screen.getByLabelText('Match name'), { target: { value: 'Derby day' } });
    continueTimes(3);
    expect(screen.getByRole('heading', { name: 'Who can take the other side?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Open to both/ }));
    continueTimes(1);
    expect(screen.getByTestId('team-fee-breakdown')).toHaveTextContent('R880 (11 players) + R240 (3 subs) = R1,120');
    continueTimes(1);
    expect(screen.getByTestId('team-wallet-check')).toHaveTextContent(/Team wallet available: R1,500/);
    expect(screen.getByTestId('team-go-no-go-notice')).toHaveTextContent(/by 13:30/);
    fireEvent.click(screen.getByRole('button', { name: 'Publish team match' }));
    expect(mocks.mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        playAsTeamId: 'team-1', otherSideMode: 'OPEN', teamSubstituteCount: 3, substituteCapacityPerTeam: 3,
        visibility: 'PUBLIC', format: 'ELEVEN_A_SIDE',
      }),
      expect.anything(),
    );
  });

  it('starts locked to the team from the team page and blocks publishing until the team wallet covers the fee', () => {
    mocks.teams = [team];
    mocks.wallet = wallet(30_000);
    render(<MemoryRouter initialEntries={[`${slot}&playAs=team%3Ateam-1&lock=1`]}><CreateMatchPage /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /Myself \(quick match\)/ })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Match name'), { target: { value: 'Derby day' } });
    continueTimes(3);
    fireEvent.click(screen.getByRole('button', { name: /Teams only/ }));
    continueTimes(2);
    expect(screen.getByTestId('team-wallet-check')).toHaveTextContent('Top up your team wallet to at least R1,120 to publish this match.');
    expect(screen.getByRole('link', { name: 'Open the team wallet' })).toHaveAttribute('href', '/teams/team-1?tab=wallet');
    expect(screen.getByRole('button', { name: 'Publish team match' })).toBeDisabled();
  });
});
