import { describe, expect, it } from 'vitest';
import { toLineupEntryDrafts } from './lineup-record.js';

const user = (name: string) => ({ username: name.toLowerCase(), profile: { displayName: name } });

describe('kickoff lineup record (Gate 8 / TKT-803)', () => {
  it('records Quick Match participants: position holders start, everyone else is a substitute', () => {
    const drafts = toLineupEntryDrafts(
      [
        { userId: 'u3', team: 'AWAY', user: user('Cara'), formationSlot: { slotIndex: 0 } },
        { userId: 'u1', team: 'HOME', user: user('Ann'), formationSlot: { slotIndex: 1 } },
        { userId: 'u2', team: 'HOME', user: user('Ben'), formationSlot: null },
      ],
      [],
    );
    expect(drafts).toEqual([
      { side: 'AWAY', userId: 'u3', teamId: null, displayNameSnapshot: 'Cara', role: 'STARTER', source: 'PARTICIPANT', slotIndex: 0 },
      { side: 'HOME', userId: 'u1', teamId: null, displayNameSnapshot: 'Ann', role: 'STARTER', source: 'PARTICIPANT', slotIndex: 1 },
      { side: 'HOME', userId: 'u2', teamId: null, displayNameSnapshot: 'Ben', role: 'SUBSTITUTE', source: 'PARTICIPANT', slotIndex: null },
    ]);
  });

  it('records team selections (starters, claimed open positions, substitutes) and skips everyone else', () => {
    const drafts = toLineupEntryDrafts(
      [{ userId: 'p1', team: 'AWAY', user: user('Individual'), formationSlot: { slotIndex: 2 } }],
      [
        {
          side: 'HOME',
          teamId: 'team-1',
          selections: [
            { userId: 's1', status: 'SELECTED_STARTER', user: user('Starter'), lineupSlot: { slotIndex: 0 } },
            { userId: 's2', status: 'OPEN_SLOT_CLAIMED', user: user('Claimer'), lineupSlot: { slotIndex: 1 } },
            { userId: 's3', status: 'SELECTED_SUBSTITUTE', user: user('Sub'), lineupSlot: null },
            { userId: 's4', status: 'DECLINED', user: user('Declined'), lineupSlot: null },
            { userId: 's5', status: 'INVITED', user: user('Invited'), lineupSlot: null },
          ],
        },
      ],
    );
    expect(drafts.map(({ userId, role, source, teamId }) => [userId, role, source, teamId])).toEqual([
      ['p1', 'STARTER', 'PARTICIPANT', null],
      ['s1', 'STARTER', 'TEAM_SELECTION', 'team-1'],
      ['s2', 'STARTER', 'TEAM_SELECTION', 'team-1'],
      ['s3', 'SUBSTITUTE', 'TEAM_SELECTION', 'team-1'],
    ]);
  });

  it('lists a player only once', () => {
    const drafts = toLineupEntryDrafts(
      [{ userId: 'x', team: 'AWAY', user: user('Twice'), formationSlot: null }],
      [{ side: 'HOME', teamId: 'team-1', selections: [{ userId: 'x', status: 'SELECTED_STARTER', user: user('Twice'), lineupSlot: { slotIndex: 0 } }] }],
    );
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ side: 'HOME', source: 'TEAM_SELECTION' });
  });
});
