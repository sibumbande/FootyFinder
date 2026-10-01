/**
 * CEO touch-up batch 3.5, item 5: who is the host in the player app. A match FootyFinder hosts has none: the admin
 * who created it gets no host powers, notifications or result-evidence role (FootyFinder runs it from the admin app).
 */
export const playerHostId = (match: { createdById: string; hostedByFootyFinder: boolean }) =>
  match.hostedByFootyFinder ? null : match.createdById;

/** The host as notification recipients: none for a FootyFinder-hosted match. */
export const hostAudience = (match: { createdById: string; hostedByFootyFinder: boolean }) =>
  match.hostedByFootyFinder ? [] : [match.createdById];
