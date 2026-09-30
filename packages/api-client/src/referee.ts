import type { DeclineRefereeInput, RefereeMatchDetail, RefereeMatchSummary, RefereeResultInput } from '@footy-finder/shared';
import type { ApiClient } from './client.js';

const id = encodeURIComponent;

/** Gate 8 (DEC-020): what a FootyFinder referee does in the main app. */
export const refereeApi = (client: ApiClient) => ({
  /** TKT-805: my assigned matches (upcoming, awaiting result, and the last 7 days). */
  matches: () => client.request<{ data: RefereeMatchSummary[] }>('/referee/matches'),
  match: (matchId: string) => client.request<{ data: RefereeMatchDetail }>(`/referee/matches/${id(matchId)}`),
  /** D16: decline an assigned match, until 30 minutes before kickoff. */
  decline: (matchId: string, input: DeclineRefereeInput = {}) =>
    client.request<{ data: { matchId: string; declined: true } }>(`/referee/matches/${id(matchId)}/decline`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  /** TKT-804: record the final result (D5). */
  submitResult: (matchId: string, input: RefereeResultInput) =>
    client.request<{ data: { matchId: string; revisionNumber: number; final: true } }>(`/referee/matches/${id(matchId)}/result`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
});
