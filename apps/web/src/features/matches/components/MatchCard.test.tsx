import type { Match } from '@footy-finder/shared';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import { MatchCard, teamMatchLabel } from './MatchCard.js';

afterEach(cleanup);
const base = {
  id: 'm1', name: 'Derby day', format: 'ELEVEN_A_SIDE', substituteCapacityPerTeam: 3, status: 'OPEN',
  participantCount: 0, venue: { name: 'Queens Park — Main', city: 'Cape Town' }, startsAt: '2026-10-30T12:00:00.000Z',
  feeCents: 8_000, currency: 'ZAR', teamSides: [{ side: 'HOME', teamNameSnapshot: 'Rondebosch FC' }],
} as unknown as Match;

describe('MatchCard (Gate 7 team matches)', () => {
  it('labels a team match in the lobby with the home team and who can take the other side', () => {
    render(<MemoryRouter><MatchCard match={{ ...base, otherSideMode: 'OPEN', otherSideTakenBy: null }} /></MemoryRouter>);
    expect(screen.getByText('Team match')).toBeInTheDocument();
    expect(screen.getByText('Rondebosch FC · Open to teams and players')).toBeInTheDocument();
    expect(screen.getByText(/Players R\s?80[,.]00 each/)).toBeInTheDocument();
  });

  it('describes every side state', () => {
    expect(teamMatchLabel({ otherSideMode: 'TEAMS_ONLY', otherSideTakenBy: null })).toBe('Teams only');
    expect(teamMatchLabel({ otherSideMode: 'OPEN', otherSideTakenBy: 'INDIVIDUALS' })).toBe('Open to players');
    expect(teamMatchLabel({ otherSideMode: 'OPEN', otherSideTakenBy: 'TEAM' })).toBe('Opponent found');
    expect(teamMatchLabel({})).toBeNull();
  });

  it('leaves Quick Match cards unchanged', () => {
    render(<MemoryRouter><MatchCard match={base} /></MemoryRouter>);
    expect(screen.queryByText('Team match')).not.toBeInTheDocument();
  });
});
