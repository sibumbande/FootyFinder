import type { DeclineRefereeInput } from '@footy-finder/shared';
import type { ApiClient } from './client.js';

const id = encodeURIComponent;

/** Gate 8 (DEC-020): what a FootyFinder referee does in the main app. */
export const refereeApi = (client: ApiClient) => ({
  /** D16: decline an assigned match, until 30 minutes before kickoff. */
  decline: (matchId: string, input: DeclineRefereeInput = {}) =>
    client.request<{ data: { matchId: string; declined: true } }>(`/referee/matches/${id(matchId)}/decline`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
});
