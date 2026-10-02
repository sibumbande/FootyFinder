/**
 * CEO batch 5, item 4: the Terms retention table (clause 8, "How long we keep it") as rules.
 * Every category starts in REPORT mode (a dry run); an admin may switch a category to APPLY (D12).
 * FINANCIAL is REPORT-only: the ledger is protected by database triggers and nothing qualifies before 2032.
 */
export const RETENTION_CATEGORIES = ['MESSAGES', 'ENDED_SOCIAL', 'CLOSED_ACCOUNTS', 'WAITING_LIST', 'CONDUCT', 'FINANCIAL'] as const;
export type RetentionCategory = (typeof RETENTION_CATEGORIES)[number];
export const isRetentionCategory = (value: string): value is RetentionCategory =>
  (RETENTION_CATEGORIES as readonly string[]).includes(value);
export const REPORT_ONLY_CATEGORIES: readonly RetentionCategory[] = ['FINANCIAL'];

export const RETENTION_RULES: Record<RetentionCategory, { label: string; rule: string }> = {
  MESSAGES: {
    label: 'Chat, messages and support requests',
    rule: 'Direct messages, Lobby chat and Team chat older than 12 months, and support requests closed more than 12 months ago. Anything reported and still under investigation is kept.',
  },
  ENDED_SOCIAL: {
    label: 'Friend requests, invites, requests to join, recruitment posts and looking cards',
    rule: 'Deleted 12 months after they ended (declined, cancelled, expired, closed, removed or switched off).',
  },
  CLOSED_ACCOUNTS: {
    label: 'Closed accounts',
    rule: 'Deletion records 12 months after the account was deleted (once finance has settled it), cancelled or refused requests after 12 months, and notifications left on deleted accounts. Accounts we banned more than 12 months ago are only listed for an admin to review, never changed automatically.',
  },
  WAITING_LIST: {
    label: 'City waiting-list entries',
    rule: 'Removed once the person has unsubscribed.',
  },
  CONDUCT: {
    label: 'Conduct and safety records',
    rule: 'Resolved or dismissed reports, ended suspensions and bans, and closed disputes older than 3 years. Anything unresolved is kept.',
  },
  FINANCIAL: {
    label: 'Financial and transaction records',
    rule: '5 years from the end of the tax year (28 or 29 February) they belong to, as the Tax Administration Act requires. Report only.',
  },
};

const subtractMonths = (date: Date, months: number) => {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() - months);
  return result;
};

export const twelveMonthsBefore = (now: Date) => subtractMonths(now, 12);
export const threeYearsBefore = (now: Date) => subtractMonths(now, 36);

/**
 * Financial records are kept for 5 years from the end of the South African tax year they belong to
 * (1 March to the last day of February). Returns the first instant that is still kept: anything created
 * before it has passed its 5 years. Example: on 2 October 2031 the cutoff is 1 March 2026 00:00 (Johannesburg),
 * so records from the tax year ending 28 February 2026 qualify only from 1 March 2031.
 */
export function financialRetentionCutoff(now: Date) {
  // Work in Johannesburg time (UTC+2, no daylight saving).
  const local = new Date(now.getTime() + 2 * 3_600_000);
  const fiveYearsAgoYear = local.getUTCFullYear() - 5;
  const fiveYearsAgo = new Date(Date.UTC(fiveYearsAgoYear, local.getUTCMonth(), local.getUTCDate()));
  // The most recent tax year that ended on or before that day ends on the last day of February of:
  const endYear = fiveYearsAgo.getUTCMonth() >= 2 ? fiveYearsAgoYear : fiveYearsAgoYear - 1;
  // Records created before 1 March of that year (00:00 Johannesburg) belong to tax years that have ended.
  return new Date(Date.UTC(endYear, 2, 1) - 2 * 3_600_000);
}
