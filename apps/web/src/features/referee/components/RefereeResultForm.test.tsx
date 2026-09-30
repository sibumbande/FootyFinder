import type { RefereeMatchDetail } from '@footy-finder/shared';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const mutate = vi.fn();
vi.mock('../hooks/useReferee.js', () => ({
  useSubmitRefereeResult: () => ({ mutate, isPending: false, isSuccess: false, error: null }),
}));
const { RefereeResultForm } = await import('./RefereeResultForm.js');

const A = '00000000-0000-4000-8000-00000000000a';
const C = '00000000-0000-4000-8000-00000000000c';
const match: RefereeMatchDetail = {
  matchId: 'match-1',
  name: 'Friday five',
  mode: 'QUICK_GAME',
  format: 'FIVE_A_SIDE',
  status: 'AWAITING_RESULT',
  startsAt: '2026-10-30T12:00:00.000Z',
  matchEndsAt: '2026-10-30T13:00:00.000Z',
  goNoGoAt: '2026-10-30T11:30:00.000Z',
  confirmed: true,
  venue: { name: 'Italian Club', addressLine1: '1 Club Road', city: 'Cape Town' },
  sides: { HOME: 'Team A', AWAY: 'Team B' },
  hasResult: false,
  canDecline: false,
  canRecordResult: true,
  lineupRecorded: true,
  lineup: [
    { userId: A, displayName: 'Ann', side: 'HOME', role: 'STARTER', slotIndex: 0, didNotPlay: false },
    { userId: C, displayName: 'Cara', side: 'AWAY', role: 'STARTER', slotIndex: 0, didNotPlay: false },
  ],
  result: null,
};

describe('RefereeResultForm (Gate 8 / TKT-805)', () => {
  afterEach(cleanup);

  it('builds the score from goals and asks for confirmation that the result is final', () => {
    render(<RefereeResultForm match={match} />);
    expect(screen.getByTestId('referee-score')).toHaveTextContent('Team A 0 - 0 Team B');
    fireEvent.click(screen.getByRole('button', { name: 'Add a Team A goal' }));
    expect(screen.getByRole('button', { name: 'Review result' })).toBeDisabled();
    expect(screen.getByTestId('referee-result-problems')).toHaveTextContent('Pick the scorer');
    fireEvent.change(screen.getByLabelText('Scorer'), { target: { value: A } });
    expect(screen.getByTestId('referee-score')).toHaveTextContent('Team A 1 - 0 Team B');
    fireEvent.click(screen.getByRole('button', { name: 'Review result' }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('This result is final. You cannot change it after you submit.');
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Team A: Ann');
    fireEvent.click(screen.getByRole('button', { name: 'Submit final result' }));
    expect(mutate).toHaveBeenCalledWith({
      outcome: 'PLAYED',
      homeScore: 1,
      awayScore: 0,
      goals: [{ side: 'HOME', ownGoal: false, scorerUserId: A }],
      didNotPlayUserIds: [],
    });
  });

  it('only offers players of the scoring side who played, plus an own goal', () => {
    render(<RefereeResultForm match={match} />);
    fireEvent.click(screen.getByRole('checkbox', { name: /Ann/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add a Team A goal' }));
    const options = [...(screen.getByLabelText('Scorer') as HTMLSelectElement).options].map((option) => option.text);
    expect(options).toEqual(['Choose the scorer', 'Own goal by an opponent']);
  });
});
