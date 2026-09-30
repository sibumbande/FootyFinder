import type { Match, MatchResultContext } from '@footy-finder/shared';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const context: MatchResultContext = {
  referee: { id: 'ref-1', displayName: 'Sam Ref' },
  lineupRecorded: true,
  lineup: [],
  viewerSide: null,
  canSubmitVersion: true,
  submitVersionFrom: '2026-10-30T13:00:00.000Z',
  submitVersionUntil: '2026-10-31T13:00:00.000Z',
  mySubmission: null,
  canReportProblem: true,
  reportProblemUntil: '2026-10-31T13:10:00.000Z',
  myReports: [],
};
vi.mock('@/api/client.js', () => ({
  matchClient: { resultContext: vi.fn(async () => ({ data: context })), submitResultVersion: vi.fn(), reportResultProblem: vi.fn() },
}));
const { MatchResultPanel } = await import('./MatchResultPanel.js');

const match = {
  id: 'match-1',
  mode: 'QUICK_GAME',
  status: 'COMPLETED',
  goNoGoAt: '2026-10-30T11:30:00.000Z',
  teamSides: [],
  result: {
    id: 'result-1',
    homeScore: 2,
    awayScore: 1,
    submittedAt: '2026-10-30T13:10:00.000Z',
    revisionNumber: 1,
    scorers: [],
    outcomeType: 'PLAYED',
    forfeitWinner: null,
    finalSource: 'REFEREE',
    finalizedAt: '2026-10-30T13:10:00.000Z',
    goals: [
      { side: 'HOME', ownGoal: false, scorer: { userId: 'a', displayName: 'Ann' }, assist: { userId: 'b', displayName: 'Ben' } },
      { side: 'HOME', ownGoal: true, scorer: null, assist: null },
      { side: 'AWAY', ownGoal: false, scorer: { userId: 'c', displayName: 'Cara' }, assist: null },
    ],
  },
} as unknown as Match;

const renderPanel = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MatchResultPanel match={match} />
    </QueryClientProvider>,
  );

describe('MatchResultPanel (Gate 8 / TKT-806)', () => {
  afterEach(cleanup);

  it("shows the referee's final result with scorers, assists and own goals, and no dispute button", async () => {
    renderPanel();
    expect(screen.getByTestId('final-result')).toHaveTextContent('Team A 2 - 1 Team B');
    expect(screen.getByTestId('final-result')).toHaveTextContent('Team A: Ann (assist Ben)');
    expect(screen.getByTestId('final-result')).toHaveTextContent('Team A: own goal');
    expect(await screen.findByText(/Recorded by the FootyFinder referee, Sam Ref/)).toBeInTheDocument();
    expect(screen.queryByText(/Dispute/)).not.toBeInTheDocument();
  });

  it('offers the optional own version and the 24-hour problem report to captains and hosts', async () => {
    renderPanel();
    expect(await screen.findByRole('button', { name: 'Send your version (optional)' })).toBeInTheDocument();
    expect(screen.getByLabelText('Report a problem with the result')).toBeInTheDocument();
  });
});
