import { describe, expect, it } from 'vitest';
import { moderateTeamReviewSchema, teamReviewInputSchema } from './team-review.js';

describe('team review schemas (Gate 8 / TKT-809, DEC-017)', () => {
  it('accepts a 1-5 rating and treats an empty comment as none', () => {
    expect(teamReviewInputSchema.parse({ rating: 5, text: '  ' })).toEqual({ rating: 5, text: undefined });
    expect(teamReviewInputSchema.parse({ rating: 1, text: ' Fair game ' })).toEqual({ rating: 1, text: 'Fair game' });
    expect(teamReviewInputSchema.safeParse({ rating: 0 }).success).toBe(false);
    expect(teamReviewInputSchema.safeParse({ rating: 6 }).success).toBe(false);
    expect(teamReviewInputSchema.safeParse({ rating: 3, text: 'x'.repeat(1001) }).success).toBe(false);
  });

  it('allows only the moderation actions', () => {
    expect(moderateTeamReviewSchema.parse({ action: 'HIDE', note: 'Abusive' })).toEqual({ action: 'HIDE', note: 'Abusive' });
    expect(moderateTeamReviewSchema.safeParse({ action: 'DELETE' }).success).toBe(false);
  });
});
