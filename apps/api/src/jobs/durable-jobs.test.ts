import { describe, expect, it } from 'vitest';
import { durableJobBackoffMs } from './durable-jobs.js';

describe('durable job retry schedule', () => {
  it('uses bounded exponential backoff', () => {
    expect(durableJobBackoffMs(1)).toBe(5_000);
    expect(durableJobBackoffMs(2)).toBe(10_000);
    expect(durableJobBackoffMs(20)).toBe(3_600_000);
  });
});
