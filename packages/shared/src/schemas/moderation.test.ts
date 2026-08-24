import { describe, expect, it } from 'vitest';
import {
  adminModerationReportQuerySchema,
  createAccountEnforcementSchema,
  updateModerationReportSchema,
} from './moderation.js';

describe('moderation contracts', () => {
  it('strictly parses assignment filters', () => {
    expect(adminModerationReportQuerySchema.parse({ assignedToMe: 'false' }).assignedToMe).toBe(false);
    expect(() => adminModerationReportQuerySchema.parse({ assignedToMe: '1' })).toThrow();
  });

  it('requires a future-shaped end for suspension and no end for a ban', () => {
    expect(createAccountEnforcementSchema.parse({ type: 'SUSPENSION', publicReason: 'Safety hold.', endsAt: '2026-09-01T18:00:00.000Z' }).type).toBe('SUSPENSION');
    expect(() => createAccountEnforcementSchema.parse({ type: 'BAN', publicReason: 'Safety hold.', endsAt: '2026-09-01T18:00:00.000Z' })).toThrow();
  });

  it('requires a resolution summary for terminal report states', () => {
    expect(() => updateModerationReportSchema.parse({ status: 'RESOLVED' })).toThrow();
    expect(updateModerationReportSchema.parse({ status: 'DISMISSED', resolutionSummary: 'No violation found.' }).status).toBe('DISMISSED');
  });
});
