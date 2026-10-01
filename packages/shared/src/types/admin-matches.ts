import type { MatchFormat } from '../config/match-formats.js';
import type { MatchMode, MatchStatus, MatchVisibility } from './match.js';
import type { AdminRefereeMatch } from './referee.js';

/** CEO touch-up batch 3.5, item 5: one row in the admin Matches list. */
export interface AdminMatchListItem {
  matchId: string;
  name: string;
  mode: MatchMode;
  format: MatchFormat;
  status: MatchStatus;
  startsAt: string;
  venueName: string;
  visibility: MatchVisibility;
  filled: number;
  capacity: number;
  refereeName: string | null;
  freeOnFootyFinder: boolean;
  firstTimersOnly: boolean;
  hostedByFootyFinder: boolean;
  /** "FootyFinder", or the player who created the match. */
  hostName: string;
}

export interface AdminMatchList {
  matches: AdminMatchListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface AdminMatchPlayer {
  userId: string;
  displayName: string;
  side: 'HOME' | 'AWAY';
  position: string | null;
  status: 'JOINED' | 'LEFT' | 'REMOVED';
  joinedAt: string;
  leftAt: string | null;
  /** What the player paid from their wallet (0 in a free match). */
  paidCents: number;
  refundedCents: number;
}

/** Admin-only money picture for one match. The venue amount never reaches players. */
export interface AdminMatchMoney {
  feesTakenCents: number;
  refundedCents: number;
  /** Free "On FootyFinder" matches: the R80 per player FootyFinder covers (active records only). */
  promotionalCostCents: number;
  /** Team match fees are held and charged in team wallets, so they are not in feesTakenCents. */
  teamMatch: boolean;
  venue: { kind: 'PAYABLE' | 'EXPECTED' | 'NONE'; amountCents: number; payableStatus?: string };
}

/** Everything about one match on the admin match page (the referee and free-match parts reuse AdminRefereeMatch). */
export interface AdminMatchDetail extends AdminRefereeMatch {
  visibility: MatchVisibility;
  hostedByFootyFinder: boolean;
  hostName: string;
  fieldName: string | null;
  publicUrl: string | null;
  capacity: { filled: number; total: number };
  players: AdminMatchPlayer[];
  money: AdminMatchMoney;
  /** Whether the result section applies (the match has started or finished). */
  started: boolean;
  /** Before kick-off and not cancelled: FootyFinder can cancel it (team matches only before the 30-minute check). */
  cancellable: boolean;
}

export interface AdminCreatedMatch {
  matchId: string;
  name: string;
  startsAt: string;
  visibility: MatchVisibility;
  freeOnFootyFinder: boolean;
  firstTimersOnly: boolean;
  publicUrl?: string;
  /** Private matches only, shown once: anyone with it can join. */
  inviteUrl?: string;
}
