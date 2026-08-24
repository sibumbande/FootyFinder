import type { PublicUser } from './user.js';
import type { TeamSide } from './match.js';

export type DisputeType = 'MATCH_RESULT' | 'FIELD_BOOKING';
export type DisputeReason =
  | 'INCORRECT_SCORE'
  | 'INCORRECT_SCORERS'
  | 'FIELD_UNAVAILABLE'
  | 'FIELD_QUALITY'
  | 'BOOKING_SERVICE'
  | 'PAYMENT'
  | 'OTHER';
export type DisputeStatus = 'OPEN' | 'UNDER_REVIEW' | 'RESOLVED' | 'REJECTED';
export type DisputeResolutionOutcome =
  | 'RESULT_CONFIRMED'
  | 'RESULT_CORRECTED'
  | 'BOOKING_UPHELD'
  | 'BOOKING_REJECTED';

export interface ResultRevision {
  id: string;
  matchResultId: string;
  revisionNumber: number;
  homeScore: number;
  awayScore: number;
  scorers: Array<{ participantId: string; team: TeamSide; goals: number }>;
  reason: 'INITIAL_SUBMISSION' | 'ADMIN_CORRECTION';
  createdAt: string;
  createdByAdmin?: PublicUser;
}

export interface Dispute {
  id: string;
  type: DisputeType;
  referenceId: string;
  reason: DisputeReason;
  details: string;
  status: DisputeStatus;
  resolutionOutcome?: DisputeResolutionOutcome;
  resolutionSummary?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
  evidenceSnapshot?: Record<string, unknown>;
  openedBy?: PublicUser;
  assignedAdmin?: PublicUser;
  resultRevisions?: ResultRevision[];
}
