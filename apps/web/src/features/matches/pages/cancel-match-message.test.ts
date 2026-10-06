import { describe, expect, it } from 'vitest';
import { cancelMatchMessage } from './MatchLobbyPage.js';

describe('cancelMatchMessage (batch 5 brief, item 5)', () => {
  it('uses the DEC-021 wording for a paid match', () => {
    expect(cancelMatchMessage(9, false)).toBe('All 9 players will be asked to choose a match credit or a full refund, and are notified by email.');
    expect(cancelMatchMessage(1, false)).toBe('The 1 player will be asked to choose a match credit or a full refund, and is notified by email.');
  });

  it('has nothing to refund in a free match, or with nobody joined', () => {
    expect(cancelMatchMessage(4, true)).toBe('All 4 players are notified by email. It is a free match, so there is nothing to refund.');
    expect(cancelMatchMessage(0, false)).toBe('Nobody has joined yet. The match is cancelled and the slot is released.');
  });
});
