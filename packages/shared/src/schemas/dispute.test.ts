import { describe, expect, it } from 'vitest';
import { createDisputeSchema, resolveDisputeSchema } from './dispute.js';

describe('dispute contracts', () => {
  it('keeps result and booking reasons within their domains', () => {
    expect(createDisputeSchema.parse({ type: 'MATCH_RESULT', referenceId: '11111111-1111-4111-8111-111111111111', reason: 'INCORRECT_SCORE', details: 'The recorded score is not correct.' }).type).toBe('MATCH_RESULT');
    expect(() => createDisputeSchema.parse({ type: 'MATCH_RESULT', referenceId: '11111111-1111-4111-8111-111111111111', reason: 'FIELD_QUALITY', details: 'The recorded score is not correct.' })).toThrow();
  });
  it('requires corrected result data only for a correction', () => {
    expect(resolveDisputeSchema.parse({ outcome: 'RESULT_CONFIRMED', resolutionSummary: 'Evidence confirms the submitted result.' }).outcome).toBe('RESULT_CONFIRMED');
    expect(() => resolveDisputeSchema.parse({ outcome: 'RESULT_CORRECTED', resolutionSummary: 'Evidence supports a correction.' })).toThrow();
  });
});
