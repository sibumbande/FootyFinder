import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { TeamStatsPanel } from './TeamStatsPanel.js';

afterEach(cleanup);

describe('team statistics panel (CEO batch 4, item 2)', () => {
  it('shows P W D L GF GA GD and the last five, with the score on tap', () => {
    render(
      <TeamStatsPanel
        stats={{
          played: 3, wins: 1, draws: 1, losses: 1, goalsFor: 5, goalsAgainst: 7, goalDifference: -2,
          lastFive: [
            { matchId: 'm3', startsAt: '2026-09-21T16:00:00.000Z', outcome: 'L', opponent: 'Rival FC', goalsFor: 0, goalsAgainst: 4, forfeit: false },
            { matchId: 'm2', startsAt: '2026-09-14T16:00:00.000Z', outcome: 'D', opponent: 'Individual players', goalsFor: 2, goalsAgainst: 2, forfeit: false },
            { matchId: 'm1', startsAt: '2026-09-07T16:00:00.000Z', outcome: 'W', opponent: 'City FC', goalsFor: 0, goalsAgainst: 0, forfeit: true },
          ],
        }}
      />,
    );
    const panel = screen.getByTestId('team-stats');
    expect(within(panel).getAllByTitle('Goal difference')[0]).toHaveTextContent('-2');
    expect(screen.getAllByTestId('team-form-chip').map((chip) => chip.textContent?.charAt(0))).toEqual(['L', 'D', 'W']);
    fireEvent.click(screen.getAllByTestId('team-form-chip')[2]!);
    expect(screen.getByRole('status')).toHaveTextContent('Win v City FC: forfeit');
  });
});
