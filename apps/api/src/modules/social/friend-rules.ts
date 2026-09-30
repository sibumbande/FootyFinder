import {
  FRIEND_REQUESTS_PENDING_MAX,
  FRIEND_REQUESTS_PER_DAY,
  FRIEND_REQUEST_EXPIRY_DAYS,
  type RelationshipState,
} from '@footy-finder/shared';

const DAY_MS = 86_400_000;

/** One key per pair of players, whichever way the request goes. */
export const pairKey = (a: string, b: string) => [a, b].sort().join(':');
/** Friendships are stored once per pair, lowest id first (matches the DB CHECK on uuid order). */
export const orderedPair = (a: string, b: string) => (a < b ? { userLowId: a, userHighId: b } : { userLowId: b, userHighId: a });
export const friendRequestExpiresAt = (now: Date) => new Date(now.getTime() + FRIEND_REQUEST_EXPIRY_DAYS * DAY_MS);
export const dailyWindowStart = (now: Date) => new Date(now.getTime() - DAY_MS);

export type RelationshipFacts = {
  self: boolean;
  blocked: boolean;
  friends: boolean;
  outgoingRequestId?: string;
  incomingRequestId?: string;
  /** The other player can receive requests: active, onboarded, incoming requests on. */
  requestable: boolean;
};

/** CEO Gate 9: the button is never shown for yourself, blocked players or players who turned requests off. */
export function relationshipState(facts: RelationshipFacts): { state: RelationshipState; requestId?: string } {
  if (facts.self) return { state: 'SELF' };
  if (facts.blocked) return { state: 'UNAVAILABLE' };
  if (facts.friends) return { state: 'FRIENDS' };
  if (facts.outgoingRequestId) return { state: 'REQUESTED', requestId: facts.outgoingRequestId };
  if (facts.incomingRequestId) return { state: 'INCOMING', requestId: facts.incomingRequestId };
  return { state: facts.requestable ? 'CAN_REQUEST' : 'UNAVAILABLE' };
}

export type SendLimitFacts = { pendingOutgoing: number; sentToday: number; sharedLineup: boolean };
/** 100 pending outgoing always applies; the 20-a-day limit skips players you shared a Lineup Record with. */
export function sendLimitRefusal(facts: SendLimitFacts): 'PENDING_LIMIT' | 'DAILY_LIMIT' | null {
  if (facts.pendingOutgoing >= FRIEND_REQUESTS_PENDING_MAX) return 'PENDING_LIMIT';
  if (!facts.sharedLineup && facts.sentToday >= FRIEND_REQUESTS_PER_DAY) return 'DAILY_LIMIT';
  return null;
}
