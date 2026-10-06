/** Why a DEC-018 T-30 go/no-go check needs an admin's attention before kickoff. */
export type GoNoGoProblem = 'OVERDUE' | 'FAILED' | 'STALE_RUNNING' | 'UNCONFIRMED_PAST_KICKOFF';

export interface GoNoGoHealthItem {
  jobId: string | null;
  matchId: string | null;
  matchName: string | null;
  startsAt: string | null;
  runAt: string | null;
  status: 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | null;
  attempts: number;
  lastError: string | null;
  problem: GoNoGoProblem;
}

export interface GoNoGoHealth {
  overdue: number;
  staleRunning: number;
  failed: number;
  unconfirmedPastKickoff: number;
  /** Up to 20 problems, oldest first. */
  items: GoNoGoHealthItem[];
}

export interface OperationsSummary {
  generatedAt: string;
  runtime: {
    startedAt: string;
    uptimeSeconds: number;
    nodeEnvironment: 'development' | 'test' | 'production';
  };
  database: { status: 'ready'; responseTimeMs: number };
  accounts: { active: number; suspended: number; banned: number; admins: number };
  workQueues: {
    openSupportTickets: number;
    urgentSupportTickets: number;
    openModerationReports: number;
    openDisputes: number;
    fundingReservations: number;
  };
  matches: { draft: number; open: number; inProgress: number; awaitingResult: number };
  durableJobs: { pending: number; running: number; failed: number; overdue: number };
  goNoGo: GoNoGoHealth;
  /** DEC-021: match ticket payments started in the last 24 hours (succeeded, failed, value verified by Paystack). */
  finance24Hours: {
    succeededTransactions: number;
    failedTransactions: number;
    settledValueCents: number;
  };
  processMetrics: Record<string, number>;
}
