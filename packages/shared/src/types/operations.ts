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
  finance24Hours: {
    succeededTransactions: number;
    failedTransactions: number;
    settledValueCents: number;
  };
  processMetrics: Record<string, number>;
}
