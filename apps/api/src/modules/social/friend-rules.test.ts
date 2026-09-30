import { describe, expect, it } from 'vitest';
import { friendRequestExpiresAt, orderedPair, pairKey, relationshipState, sendLimitRefusal } from './friend-rules.js';

const base = { self: false, blocked: false, friends: false, requestable: true };

describe('Gate 9 friend rules', () => {
  it('uses one key and one stored order per pair, whichever way round', () => {
    expect(pairKey('b', 'a')).toBe(pairKey('a', 'b'));
    expect(orderedPair('b', 'a')).toEqual({ userLowId: 'a', userHighId: 'b' });
    expect(friendRequestExpiresAt(new Date('2026-10-01T00:00:00Z')).toISOString()).toBe('2026-10-31T00:00:00.000Z');
  });

  it('shows the right button state, and none for yourself, blocked players or players who turned requests off', () => {
    expect(relationshipState({ ...base, self: true })).toEqual({ state: 'SELF' });
    expect(relationshipState({ ...base, blocked: true, friends: true })).toEqual({ state: 'UNAVAILABLE' });
    expect(relationshipState({ ...base, friends: true, requestable: false })).toEqual({ state: 'FRIENDS' });
    expect(relationshipState({ ...base, outgoingRequestId: 'r1' })).toEqual({ state: 'REQUESTED', requestId: 'r1' });
    expect(relationshipState({ ...base, incomingRequestId: 'r2', requestable: false })).toEqual({ state: 'INCOMING', requestId: 'r2' });
    expect(relationshipState({ ...base, requestable: false })).toEqual({ state: 'UNAVAILABLE' });
    expect(relationshipState(base)).toEqual({ state: 'CAN_REQUEST' });
  });

  it('caps pending requests at 100 always, and daily requests at 20 unless you played together', () => {
    expect(sendLimitRefusal({ pendingOutgoing: 100, sentToday: 0, sharedLineup: true })).toBe('PENDING_LIMIT');
    expect(sendLimitRefusal({ pendingOutgoing: 5, sentToday: 20, sharedLineup: false })).toBe('DAILY_LIMIT');
    expect(sendLimitRefusal({ pendingOutgoing: 5, sentToday: 20, sharedLineup: true })).toBeNull();
    expect(sendLimitRefusal({ pendingOutgoing: 99, sentToday: 19, sharedLineup: false })).toBeNull();
  });
});
